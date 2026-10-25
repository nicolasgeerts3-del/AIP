// Test de bout en bout : pilote Chrome/Edge en mode headless via le protocole
// DevTools (WebSocket natif de Node 22), sans dépendance à installer.
// Usage : npm run test:e2e   (variable CHROME_PATH pour choisir le navigateur)
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers/server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launchBrowser() {
  const executable = BROWSERS.find((path) => existsSync(path));
  if (!executable) throw new Error('Aucun Chrome/Edge trouvé : définir CHROME_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'retiss-e2e-'));
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,1600', 'about:blank'
  ], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i += 1) await delay(100);
  if (!existsSync(portFile)) throw new Error('Le navigateur n’a pas ouvert son port de débogage');
  await delay(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  const close = () => { child.kill(); setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500); };
  return { wsUrl: page.webSocketDebuggerUrl, port, close };
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map(); const listeners = [];
  let nextId = 1;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    } else if (message.method) listeners.forEach((listener) => listener(message));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve({ send, on: (listener) => listeners.push(listener), close: () => socket.close() }));
    socket.addEventListener('error', () => reject(new Error('Connexion DevTools impossible')));
  });
}

// ---------- Scénario ----------

const results = [];
let cdp;

async function evaluate(expression, connection = cdp) {
  const { result, exceptionDetails } = await connection.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function waitFor(expression, { timeout = 10000, message, connection = cdp } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression, connection)) return;
    await delay(50);
  }
  throw new Error(message ?? `Délai dépassé en attendant : ${expression}`);
}

function check(condition, message) { if (!condition) throw new Error(message); }

async function step(name, body) {
  const start = Date.now();
  try {
    const note = await body();
    results.push({ name, status: note === 'SKIP' ? 'SKIP' : 'OK', ms: Date.now() - start });
  } catch (error) {
    results.push({ name, status: 'ÉCHEC', ms: Date.now() - start, error: error.message });
  }
}

/** Glisse la souris sur le masque entre deux points exprimés en fractions de l'image. */
async function drag(points) {
  await evaluate("document.querySelector('#maskCanvas').scrollIntoView({ block: 'center' })");
  const rect = await evaluate("(() => { const r = document.querySelector('#maskCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
  const toScreen = ([fx, fy]) => ({ x: rect.x + fx * rect.w, y: rect.y + fy * rect.h });
  const first = toScreen(points[0]);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...first, button: 'left', buttons: 1, clickCount: 1 });
  for (const point of points.slice(1)) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...toScreen(point), button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...toScreen(points.at(-1)), button: 'left', buttons: 0, clickCount: 1 });
  await delay(80); // laisse passer le requestAnimationFrame du rendu
}

/** Clic de souris réel sur un élément, en fractions de sa taille affichée. */
async function clickAt(selector, fx, fy) {
  await evaluate(`document.querySelector('${selector}').scrollIntoView({ block: 'center' })`);
  const rect = await evaluate(`(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const point = { x: rect.x + fx * rect.w, y: rect.y + fy * rect.h };
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
}

const gridAt = (fx, fy) => `(() => { const m = retissDebug.getMasks().gridMask; return m.data[Math.floor(${fy} * m.height) * m.width + Math.floor(${fx} * m.width)]; })()`;
const text = (selector) => `document.querySelector('${selector}').textContent`;

async function scenario(baseUrl, browser) {
  const errors = [];
  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  });
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  // Toute violation de la politique de sécurité (vercel.json) est une erreur du scénario.
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: "document.addEventListener('securitypolicyviolation', (e) => console.error('CSP bloque ' + e.violatedDirective + ' : ' + e.blockedURI))" });
  await cdp.send('Page.navigate', { url: baseUrl });

  await step('Chargement de la page et des modules', async () => {
    await waitFor('!!window.retissDebug', { message: 'app.js ne s’est pas initialisé' });
    const disabled = await evaluate("['#analyzeButton', '#planButton', '#downloadButton', '#captureButton'].every((s) => document.querySelector(s).disabled)");
    check(disabled, 'des boutons sont actifs alors qu’aucune image n’est chargée');
    check(await evaluate(`${text('#maskCount')} === '0 cm²'`), 'compteur de défauts non nul au départ');
    await delay(1800);
    check(await evaluate("document.querySelector('#appBanner').hidden"), `[D-33] bandeau affiché au démarrage normal : ${await evaluate("document.querySelector('#appBanner').textContent")}`);
  });

  await step('Import d’une photo (2:3) avec trois taches et une ombre', async () => {
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(214,200,172)'; ctx.fillRect(0, 0, 400, 600);
      ctx.fillStyle = 'rgb(170,60,50)'; ctx.beginPath(); ctx.arc(100, 150, 20, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgb(80,90,160)'; ctx.beginPath(); ctx.arc(300, 450, 15, 0, 7); ctx.fill();
      // D-18 : tache de graisse, même teinte que le tissu mais 25 % plus sombre.
      ctx.fillStyle = 'rgb(161,150,129)'; ctx.beginPath(); ctx.arc(100, 450, 15, 0, 7); ctx.fill();
      // D-17 : ombre en dégradé sur toute la largeur (jusqu'à −35 %).
      const shade = ctx.createLinearGradient(0, 0, 400, 0); shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, 400, 600);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'tissu.png', { type: 'image/png' }));
      const input = document.querySelector('#fileInput'); input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    })()`);
    await waitFor("!document.querySelector('#analyzeButton').disabled", { message: 'bouton Analyser toujours désactivé' });
    const image = await evaluate('({ w: retissDebug.state.image.width, h: retissDebug.state.image.height })');
    check(image.w === 400 && image.h === 600, `image chargée en ${image.w}×${image.h}`);
    check(await evaluate(`${text('#statusText')}.includes('proportions conservées')`), 'statut inattendu');
  });

  await step('[D-11] L’aperçu de la photo est visible (pas masqué par la vidéo)', async () => {
    const visible = await evaluate(`(() => {
      const stage = document.querySelector('#cameraStage').getBoundingClientRect();
      const preview = document.querySelector('#sourcePreview').getBoundingClientRect();
      return getComputedStyle(document.querySelector('#video')).display === 'none' && preview.height > 0 && preview.top >= stage.top - 1 && preview.bottom <= stage.bottom + 1;
    })()`);
    check(visible, 'l’image importée n’est pas visible dans le cadre');
  });

  await step('[D-17][D-18] Analyse automatique : taches détectées, ombre et tissu sain ignorés', async () => {
    await evaluate("document.querySelector('#analyzeButton').click()");
    await waitFor(`${text('#analysisPill')} === 'ANALYSÉ'`);
    check(await evaluate(gridAt(0.25, 0.25)) === 1, 'tache rouge non détectée');
    check(await evaluate(gridAt(0.75, 0.75)) === 1, 'tache bleue non détectée');
    check(await evaluate(gridAt(0.25, 0.75)) === 1, '[D-18] tache de graisse non détectée');
    check(await evaluate(gridAt(0.75, 0.25)) === 0, '[D-17] faux défaut dans la zone d’ombre');
    const healthyDefects = await evaluate("(() => { const m = retissDebug.getMasks().gridMask; let n = 0; for (let y = 0; y < m.height; y += 1) for (let x = 0; x < m.width; x += 1) { const near = [[150, 225], [450, 675], [150, 675]].some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 < 60 ** 2); if (!near && m.data[y * m.width + x]) n += 1; } return n; })()");
    check(healthyDefects === 0, `[D-17] ${healthyDefects} cellules saines marquées comme défaut`);
    check(await evaluate("!document.querySelector('#planButton').disabled"), 'bouton Imbriquer désactivé');
    await waitFor(`${text('#maskCount')} !== '0 cm²'`, { message: 'compteur de défauts non mis à jour' });
  });

  await step('[D-09] Pinceau « ajouter » : trait continu, plan invalidé', async () => {
    await drag([[0.5, 0.1], [0.9, 0.1]]);
    for (const fx of [0.55, 0.65, 0.75, 0.85]) check(await evaluate(gridAt(fx, 0.1)) === 1, `trou dans le trait en x=${fx}`);
    check(await evaluate(`${text('#optimizationState')} === 'À RECALCULER'`), 'le plan n’est pas marqué à recalculer');
  });

  await step('[D-07] Curseur MAD : recalcule sans perdre les retouches manuelles', async () => {
    await evaluate("(() => { const s = document.querySelector('#sensitivity'); s.value = '6'; s.dispatchEvent(new Event('input')); })()");
    await delay(150);
    check(await evaluate(`${text('#sensitivityValue')} === '6.0'`), 'valeur du curseur non affichée');
    check(await evaluate(gridAt(0.7, 0.1)) === 1, 'le trait manuel a été perdu');
    check(await evaluate(gridAt(0.25, 0.25)) === 1, 'la tache rouge a disparu');
  });

  await step('Gomme : efface une tache détectée', async () => {
    await evaluate("document.querySelector('#eraseTool').click(); (() => { const b = document.querySelector('#brushSize'); b.value = '20'; b.dispatchEvent(new Event('input')); })()");
    await drag([[0.2, 0.22], [0.3, 0.22], [0.3, 0.28], [0.2, 0.28], [0.25, 0.25]]);
    check(await evaluate(gridAt(0.25, 0.25)) === 0, 'la tache n’a pas été effacée');
  });

  await step('Réinitialiser : supprime les retouches, garde la détection', async () => {
    await evaluate("document.querySelector('#resetMaskButton').click()");
    check(await evaluate(gridAt(0.25, 0.25)) === 1, 'la tache détectée n’est pas revenue');
    check(await evaluate(gridAt(0.7, 0.1)) === 0, 'le trait manuel est resté');
    await evaluate("document.querySelector('#addTool').click()");
  });

  await step('[D-01][D-21] Imbrication : plan valide, hors taches, droit-fil respecté', async () => {
    await evaluate("document.querySelector('#planButton').click()");
    await waitFor(`${text('#optimizationState')} === 'TERMINÉ'`, { timeout: 90000, message: 'nesting non terminé en 90 s' });
    const report = await evaluate(`(async () => {
      const { validatePlan } = await import('./src/core/nesting.js');
      const { placementOutline, pointInPolygon } = await import('./src/core/geometry.js');
      const { placements } = retissDebug.state.plan;
      const grid = retissDebug.getMasks().gridMask;
      const stains = [[150, 225], [450, 675]];
      const overlap = placements.some((p) => stains.some(([x, y]) => pointInPolygon(x, y, placementOutline(p))));
      const outside = placements.some((p) => placementOutline(p).some(([x, y]) => x < -1e-6 || y < -1e-6 || x > grid.width + 1e-6 || y > grid.height + 1e-6));
      const grain = placements.every((p) => p.shape.angle % 180 === 0);
      return { count: placements.length, valid: validatePlan(placements, grid).ok, overlap, outside, grain, kits: retissDebug.state.plan.stats.completeKits };
    })()`);
    const png = await evaluate("document.querySelector('#resultCanvas').toDataURL('image/png').split(',')[1]");
    writeFileSync(join(tmpdir(), 'retiss-e2e-plan.png'), Buffer.from(png, 'base64'));
    check(report.count > 0, 'aucune pièce placée');
    check(report.valid, 'le plan affiché ne passe pas le contrôle');
    check(!report.overlap, 'une pièce recouvre une tache');
    check(!report.outside, 'une pièce dessinée sort du tissu');
    check(report.grain, '[D-21] une pièce ne respecte pas le droit-fil');
    check(await evaluate("document.querySelector('#orientationMode').value === 'droit-fil'"), '[D-21] le mode par défaut n’est pas le droit-fil');
    check(report.kits >= 8, `seulement ${report.kits} T-shirts complets`);
    check(await evaluate("document.querySelector('#resultEmpty').style.display === 'none' && !document.querySelector('#downloadButton').disabled"), 'résultat non affiché ou PDF indisponible');
    check(await evaluate(`[...document.querySelectorAll('#resultStats strong')][0].textContent === String(${report.kits})`), 'statistiques non mises à jour');
    return undefined;
  });

  await step('[D-08] Retouche pendant le calcul : résultat périmé rejeté', async () => {
    await evaluate("document.querySelector('#planButton').click()");
    await drag([[0.6, 0.5], [0.62, 0.5]]);
    await waitFor("!retissDebug.state.nesting", { timeout: 90000 });
    check(await evaluate('retissDebug.state.plan === null'), 'un plan calculé sur l’ancien masque a été conservé');
    check(await evaluate(`${text('#statusText')}.includes('modifié pendant le calcul')`), 'pas de message expliquant l’annulation');
  });

  await step('Export PDF 1:1', async () => {
    await evaluate("document.querySelector('#planButton').click()");
    await waitFor(`${text('#optimizationState')} === 'TERMINÉ'`, { timeout: 90000 });
    if (!(await evaluate('!!window.jspdf'))) return 'SKIP';
    await evaluate("window.__saved = null; window.jspdf.jsPDF.API.save = function (name) { window.__saved = { name, pages: this.getNumberOfPages() }; return this; }");
    await evaluate("document.querySelector('#downloadButton').click()");
    await waitFor('window.__saved !== null', { timeout: 60000, message: 'PDF non généré' });
    const saved = await evaluate('window.__saved');
    check(saved.pages === 273 && saved.name === 'retiss-plan-1-1.pdf', `PDF inattendu : ${JSON.stringify(saved)}`);
    return undefined;
  });

  await step('[D-24] Projection : plan reçu, contours dessinés, calibrage à la souris', async () => {
    check(await evaluate("!document.querySelector('#projectButton').disabled"), 'bouton Projeter désactivé');
    // Ouvre projection.html dans un second onglet (même origine → même BroadcastChannel).
    const target = await (await fetch(`http://127.0.0.1:${browser.port}/json/new?${encodeURIComponent(baseUrl + 'projection.html')}`, { method: 'PUT' })).json();
    const projection = await connect(target.webSocketDebuggerUrl);
    try {
      await projection.send('Runtime.enable');
      await waitFor('!!window.projectionDebug', { connection: projection, message: 'page de projection non démarrée' });
      const pieces = await evaluate('retissDebug.state.plan.placements.length');
      await waitFor(`window.projectionDebug.state.plan && window.projectionDebug.state.plan.pieces.length === ${pieces}`, { connection: projection, message: 'plan non reçu par la projection' });
      const lit = await evaluate("(() => { const c = document.querySelector('#projectionCanvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 300) n += 1; return n; })()", projection);
      check(lit > 500, `contours non dessinés (${lit} pixels allumés)`);

      // Glisse le coin 1 de 40 × 30 px : le calibrage doit suivre et être mémorisé.
      const [x, y] = await evaluate('window.projectionDebug.state.corners[0]', projection);
      await projection.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await projection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 40, y: y + 30, button: 'left', buttons: 1 });
      await projection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 40, y: y + 30, button: 'left', buttons: 0, clickCount: 1 });
      const moved = await evaluate('window.projectionDebug.state.corners[0]', projection);
      check(Math.abs(moved[0] - x - 40) < 1 && Math.abs(moved[1] - y - 30) < 1, `coin non déplacé : ${JSON.stringify(moved)}`);
      check(await evaluate("Object.keys(localStorage).some((key) => key.startsWith('retiss.projection.'))", projection), 'calibrage non mémorisé');

      // Raccourci clavier : M masque la mire.
      const before = await evaluate('window.projectionDebug.state.showPattern', projection);
      await projection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'm', text: 'm' });
      await projection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'm' });
      check(await evaluate('window.projectionDebug.state.showPattern', projection) === !before, 'raccourci M sans effet');

      // Plan invalidé dans la fenêtre principale → plus aucun contour projeté.
      await evaluate("(() => { const s = document.querySelector('#orientationMode'); s.value = 'quarts'; s.dispatchEvent(new Event('change')); s.value = 'droit-fil'; s.dispatchEvent(new Event('change')); })()");
      await waitFor('window.projectionDebug.state.plan === null', { connection: projection, message: 'plan périmé toujours projeté' });
    } finally {
      projection.close();
      await fetch(`http://127.0.0.1:${browser.port}/json/close/${target.id}`);
    }
    // Recalcule un plan pour les étapes suivantes.
    await evaluate("document.querySelector('#planButton').click()");
    await waitFor(`${text('#optimizationState')} === 'TERMINÉ'`, { timeout: 90000 });
  });

  await step('[D-20] Taille du tissu modifiable : grille, plan et PDF suivent', async () => {
    const setFabric = (w, h) => evaluate(`(() => { const W = document.querySelector('#fabricWidth'); const H = document.querySelector('#fabricHeight'); W.value = '${w}'; H.value = '${h}'; W.dispatchEvent(new Event('change')); H.dispatchEvent(new Event('change')); })()`);
    await setFabric(5, 225);
    check(await evaluate("document.querySelector('#fabricWidth').getAttribute('aria-invalid') === 'true'"), 'saisie invalide non signalée');
    check(await evaluate('retissDebug.state.fabric.widthCm === 300'), 'une saisie invalide a été appliquée');
    await setFabric(150, 225);
    check(await evaluate("retissDebug.state.fabric.widthCm === 150 && retissDebug.state.fabric.heightCm === 225"), 'taille non appliquée');
    check(await evaluate(`${text('#fabricBadge')} === '1,50 m × 2,25 m'`), 'badge non mis à jour');
    check(await evaluate('retissDebug.state.plan === null'), 'l’ancien plan reste affiché');
    check(await evaluate(gridAt(0.25, 0.25)) === 1, 'la tache a disparu après le changement de taille');
    await evaluate("document.querySelector('#planButton').click()");
    await waitFor(`${text('#optimizationState')} === 'TERMINÉ'`, { timeout: 90000 });
    check(await evaluate("document.querySelector('#resultCanvas').width === 300 && document.querySelector('#resultCanvas').height === 450"), 'plan non redimensionné');
    if (!(await evaluate('!!window.jspdf'))) return 'SKIP';
    await evaluate("window.__saved = null; document.querySelector('#downloadButton').click()");
    await waitFor('window.__saved !== null', { timeout: 60000, message: 'PDF non généré' });
    const saved = await evaluate('window.__saved');
    check(saved.pages === 73, `${saved.pages} pages au lieu de 73`);
    return undefined;
  });

  await step('[D-19] Recadrage 4 coins : fond supprimé, perspective corrigée', async () => {
    // Photo 600 × 450 : fond vert, tissu beige photographié en biais, tache rouge au centre du tissu.
    const corners = [[90, 40], [520, 70], [560, 420], [50, 400]];
    await evaluate(`(async () => {
      const corners = ${JSON.stringify(corners)};
      const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 450;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(40,120,60)'; ctx.fillRect(0, 0, 600, 450);
      ctx.fillStyle = 'rgb(214,200,172)'; ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.fill();
      // Centre du tissu en perspective = intersection des diagonales.
      const [[x1, y1], [x2, y2], [x3, y3], [x4, y4]] = [corners[0], corners[2], corners[1], corners[3]];
      const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
      ctx.fillStyle = 'rgb(170,60,50)'; ctx.beginPath(); ctx.arc(x1 + t * (x2 - x1), y1 + t * (y2 - y1), 14, 0, 7); ctx.fill();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer(); transfer.items.add(new File([blob], 'biais.png', { type: 'image/png' }));
      const input = document.querySelector('#fileInput'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
    })()`);
    await waitFor("retissDebug.state.image && retissDebug.state.image.width === 600", { message: 'photo non chargée' });
    // D-29 : sans recadrage, le tissu prend les proportions de la photo (paysage 4:3).
    check(await evaluate('Math.abs(retissDebug.state.fabric.widthCm / retissDebug.state.fabric.heightCm - 600 / 450) < 0.01'), '[D-29] le tissu ne suit pas les proportions de la photo');
    check(await evaluate("document.querySelector('#fabricHeight').disabled"), '[D-29] la longueur reste modifiable alors qu’elle suit la photo');
    check(await evaluate("!document.querySelector('#cropButton').disabled"), 'bouton Recadrer désactivé');

    await evaluate("document.querySelector('#cropButton').click()");
    for (const index of [2, 0, 3, 1]) await clickAt('#sourcePreview', corners[index][0] / 600, corners[index][1] / 450);
    await waitFor(`${text('#statusText')}.includes('recadré')`, { message: 'recadrage non appliqué' });
    check(await evaluate("!document.querySelector('#fabricHeight').disabled"), 'la longueur n’est pas modifiable après recadrage');
    const ratio = await evaluate('retissDebug.state.image.width / retissDebug.state.image.height');
    const fabricRatio = await evaluate('retissDebug.state.fabric.widthCm / retissDebug.state.fabric.heightCm');
    check(Math.abs(ratio / fabricRatio - 1) < 0.01, `proportions ${ratio.toFixed(3)} ≠ tissu ${fabricRatio.toFixed(3)}`);

    await evaluate("document.querySelector('#analyzeButton').click()");
    await waitFor(`${text('#analysisPill')} === 'ANALYSÉ'`);
    check(await evaluate(gridAt(0.5, 0.5)) === 1, 'la tache n’est pas au centre du tissu redressé');
    // Le liseré de bord (≤ 3 cm) mélange tissu et fond : il est marqué défaut, ce qui est prudent.
    // À l'intérieur, plus aucun défaut hors de la tache : le fond a bien disparu.
    const stray = await evaluate("(() => { const m = retissDebug.getMasks().gridMask; let n = 0; for (let y = 0; y < m.height; y += 1) for (let x = 0; x < m.width; x += 1) { const edge = Math.min(x, y, m.width - 1 - x, m.height - 1 - y); if (m.data[y * m.width + x] && edge > 6 && Math.hypot(x / m.width - 0.5, y / m.height - 0.5) > 0.2) n += 1; } return n; })()");
    check(stray === 0, `${stray} cellules de défaut loin de la tache et du bord (fond resté dans l’image ?)`);

    await evaluate("(() => { const W = document.querySelector('#fabricWidth'); W.value = '200'; W.dispatchEvent(new Event('change')); })()");
    const newRatio = await evaluate('retissDebug.state.image.width / retissDebug.state.image.height');
    const expectedRatio = await evaluate('retissDebug.state.fabric.widthCm / retissDebug.state.fabric.heightCm');
    check(await evaluate('retissDebug.state.fabric.widthCm === 200'), 'largeur non appliquée');
    check(Math.abs(newRatio / expectedRatio - 1) < 0.01, 'le recadrage n’a pas suivi la nouvelle taille de tissu');
    check(await evaluate(gridAt(0.5, 0.5)) === 1, 'tache perdue après changement de taille');
  });

  await step('[D-32] Autre caméra : liste, choix, flux en direct, figer l’image', async () => {
    await evaluate("document.querySelector('#externalCameraButton').click()");
    await waitFor("document.querySelector('#cameraDialog').open", { message: 'fenêtre non ouverte' });
    await waitFor("document.querySelector('#cameraSelect').options.length > 0 && document.querySelector('#cameraSelect').options[0].value !== ''", { message: 'aucune caméra listée' });
    const label = await evaluate("document.querySelector('#cameraSelect').selectedOptions[0].textContent");
    check(label && !/^Caméra d/.test(label), `nom de caméra non obtenu : « ${label} »`);
    check(await evaluate(`${text('#cameraDialogStatus')}.includes('trouvée')`), 'statut de la recherche absent');
    await evaluate("document.querySelector('#useCameraButton').click()");
    await waitFor("!document.querySelector('#captureButton').disabled", { message: 'flux non démarré' });
    check(await evaluate("!document.querySelector('#cameraDialog').open"), 'la fenêtre reste ouverte');
    check(await evaluate("retissDebug.state.cameraDeviceId === document.querySelector('#cameraSelect').value"), 'caméra choisie non mémorisée');
    check(await evaluate("document.querySelector('#video').videoWidth > 0 && getComputedStyle(document.querySelector('#video')).display !== 'none'"), 'flux en direct non affiché');
    check(await evaluate(`${text('#statusText')}.includes('connectée')`), 'statut de connexion absent');
    await evaluate("document.querySelector('#captureButton').click()");
    await waitFor("document.querySelector('#cameraStage').classList.contains('has-image')", { message: 'image non figée' });
    check(await evaluate('retissDebug.state.stream === null'), 'la caméra reste allumée après avoir figé l’image');
    check(await evaluate("!document.querySelector('#analyzeButton').disabled"), 'image figée non analysable');
  });

  await step('[D-12][D-29] Caméra (périphérique simulé) : capture, arrêt, proportions', async () => {
    await evaluate("document.querySelector('#cameraButton').click()");
    await waitFor("!document.querySelector('#captureButton').disabled", { message: 'caméra non démarrée' });
    await evaluate("document.querySelector('#captureButton').click()");
    await waitFor("document.querySelector('#cameraStage').classList.contains('has-image')");
    const info = await evaluate("({ w: retissDebug.state.image.width, h: retissDebug.state.image.height, stream: retissDebug.state.stream, status: document.querySelector('#statusText').textContent, plan: document.querySelector('#planButton').disabled })");
    check(info.w > 0 && info.h > 0, 'image capturée vide');
    check(info.stream === null, 'la caméra reste allumée après la capture');
    check(info.plan, 'le bouton Imbriquer reste actif sur une nouvelle image non analysée');
    // D-29 : le flux simulé est en paysage, le tissu (donc le plan) doit l'être aussi.
    check(await evaluate('Math.abs(retissDebug.state.fabric.widthCm / retissDebug.state.fabric.heightCm - retissDebug.state.image.width / retissDebug.state.image.height) < 0.01'), '[D-29] le plan n’a pas les proportions de la photo');
  });

  await step('Aucune erreur JavaScript pendant le scénario', async () => {
    check(errors.length === 0, errors.join('\n'));
  });

  await step('[D-33] Ancienne version en cache : bandeau explicite', async () => {
    await cdp.send('Page.navigate', { url: baseUrl });
    await waitFor('!!window.retissDebug');
    // Simule un app.js d'une version antérieure à celle de index.html.
    await evaluate("document.documentElement.dataset.appLoaded = '2000-01-01'");
    await waitFor("!document.querySelector('#appBanner').hidden", { timeout: 5000, message: 'aucun bandeau' });
    check(await evaluate(`${text('#appBanner')}.includes('ancienne version') && ${text('#appBanner')}.includes('Ctrl + F5')`), 'message de cache peu clair');
  });

  await step('[D-33] Code qui ne démarre pas : bandeau explicite', async () => {
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*app.js*'] });
    await cdp.send('Page.navigate', { url: baseUrl });
    try {
      await waitFor("!document.querySelector('#appBanner').hidden", { timeout: 6000, message: 'aucun bandeau' });
      check(await evaluate(`${text('#appBanner')}.includes('n’a pas démarré')`), 'message de démarrage peu clair');
    } finally {
      await cdp.send('Network.setBlockedURLs', { urls: [] });
    }
  });
}

const server = await startServer(ROOT, 0);
const browser = await launchBrowser();
try {
  cdp = await connect(browser.wsUrl);
  await scenario(server.url, browser);
} finally {
  cdp?.close(); browser.close(); server.close();
}

for (const { name, status, ms, error } of results) {
  console.log(`${status === 'OK' ? '✔' : status === 'SKIP' ? '○' : '✖'} ${name} (${ms} ms)${status === 'SKIP' ? ' — ignoré (jsPDF non chargé, pas d’Internet ?)' : ''}`);
  if (error) console.log(`    → ${error}`);
}
const failed = results.filter((result) => result.status === 'ÉCHEC').length;
console.log(`\n${results.length - failed}/${results.length} étapes réussies`);
process.exitCode = failed ? 1 : 0;
