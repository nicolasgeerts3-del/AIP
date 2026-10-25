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
  return { wsUrl: page.webSocketDebuggerUrl, close };
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

async function evaluate(expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

async function waitFor(expression, { timeout = 10000, message } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
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

const gridAt = (fx, fy) => `(() => { const m = retissDebug.getMasks().gridMask; return m.data[Math.floor(${fy} * m.height) * m.width + Math.floor(${fx} * m.width)]; })()`;
const text = (selector) => `document.querySelector('${selector}').textContent`;

async function scenario(baseUrl) {
  const errors = [];
  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '));
  });
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: baseUrl });

  await step('Chargement de la page et des modules', async () => {
    await waitFor('!!window.retissDebug', { message: 'app.js ne s’est pas initialisé' });
    const disabled = await evaluate("['#analyzeButton', '#planButton', '#downloadButton', '#captureButton'].every((s) => document.querySelector(s).disabled)");
    check(disabled, 'des boutons sont actifs alors qu’aucune image n’est chargée');
    check(await evaluate(`${text('#maskCount')} === '0 cm²'`), 'compteur de défauts non nul au départ');
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
    check(await evaluate(`${text('#statusText')}.includes('Masque modifié')`), 'pas de message expliquant l’annulation');
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

  await step('[D-12] Caméra (périphérique simulé) : capture puis arrêt', async () => {
    await evaluate("document.querySelector('#cameraButton').click()");
    await waitFor("!document.querySelector('#captureButton').disabled", { message: 'caméra non démarrée' });
    await evaluate("document.querySelector('#captureButton').click()");
    await waitFor("document.querySelector('#cameraStage').classList.contains('has-image')");
    const info = await evaluate("({ w: retissDebug.state.image.width, h: retissDebug.state.image.height, stream: retissDebug.state.stream, status: document.querySelector('#statusText').textContent, plan: document.querySelector('#planButton').disabled })");
    check(info.w > 0 && info.h > 0, 'image capturée vide');
    check(info.stream === null, 'la caméra reste allumée après la capture');
    check(info.plan, 'le bouton Imbriquer reste actif sur une nouvelle image non analysée');
    // Le flux simulé est en paysage : l'appli doit prévenir que le plan sera étiré.
    check(info.status.includes('attention'), `pas d’avertissement de proportions : « ${info.status} »`);
  });

  await step('Aucune erreur JavaScript pendant le scénario', async () => {
    check(errors.length === 0, errors.join('\n'));
  });
}

const server = await startServer(ROOT, 0);
const browser = await launchBrowser();
try {
  cdp = await connect(browser.wsUrl);
  await scenario(server.url);
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
