// Campagne de tests d'ergonomie (U-01 à U-24) : rejoue la prise en main d'un
// nouvel utilisateur dans Chrome/Edge headless, sur ordinateur portable et sur
// téléphone, et vérifie des critères mesurables (action visible sans défiler,
// une seule action mise en avant, guidage toujours visible, cibles tactiles,
// contraste, clavier…). Détail des critères : docs/ERGONOMIE.md.
// Usage : npm run test:usability   (USABILITY_SHOTS=dossier pour garder des captures)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as browserTools from './helpers/browser.js';
import { startServer } from './helpers/server.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = process.env.USABILITY_SHOTS;
const { check, connect, delay, launchBrowser } = browserTools;
const VIEWPORTS = { pc: { width: 1366, height: 768, mobile: false }, tel: { width: 390, height: 844, mobile: true } };

const runner = browserTools.createRunner();
const { step } = runner;
let cdp;
const evaluate = (expression) => browserTools.evaluate(cdp, expression);
const waitFor = (expression, options) => browserTools.waitFor(cdp, expression, options);
const pressKey = (key, options) => browserTools.pressKey(cdp, key, options);

async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'));
}

async function open(baseUrl, viewport) {
  const { width, height, mobile } = VIEWPORTS[viewport];
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await cdp.send('Page.navigate', { url: baseUrl });
  await waitFor('!!window.retissDebug', { message: 'app.js ne s’est pas initialisé' });
  await delay(300);
}

// Photo de synthèse : tissu beige, deux taches nettes (le plan contient des T-shirts).
const SYNTHETIC_FILE = `(async () => {
  const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 600;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(214,200,172)'; ctx.fillRect(0, 0, 400, 600);
  ctx.fillStyle = 'rgb(170,60,50)'; ctx.beginPath(); ctx.arc(100, 150, 20, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgb(80,90,160)'; ctx.beginPath(); ctx.arc(300, 450, 15, 0, 7); ctx.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob], 'tissu.png', { type: 'image/png' });
})()`;
// Vraie photo du dépôt : drap froissé, une grosse tache et des gouttes ; les plis créent de fausses taches.
const REAL_FILE = "(async () => new File([await (await fetch('phot%20tache/16361363.webp')).blob()], 'drap.webp', { type: 'image/webp' }))()";

async function importWith(fileExpression) {
  await evaluate(`(async () => {
    const transfer = new DataTransfer(); transfer.items.add(await ${fileExpression});
    const input = document.querySelector('#fileInput'); input.files = transfer.files; input.dispatchEvent(new Event('change'));
  })()`);
  await waitFor('!!retissDebug.state.image && retissDebug.state.analyzed', { message: 'photo non chargée ou non analysée' });
  await delay(150);
}

/** Attend la fin d'un défilement animé (position stable pendant 200 ms). */
async function settleScroll() {
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    await delay(100);
    const y = await evaluate('scrollY');
    if (y === last) return;
    last = y;
  }
}

async function nest() {
  await evaluate("document.querySelector('#planButton').click()");
  await waitFor('!retissDebug.state.nesting && retissDebug.state.plan !== null', { timeout: 90000, message: 'imbrication non terminée' });
  await delay(150);
}

// ---------- Mesures dans la page ----------

/**
 * L'élément est-il affiché, dans la fenêtre, et non recouvert ? Un élément
 * qui laisse passer les clics (pointer-events: none, comme une consigne posée
 * sur la photo) est seulement vérifié non caché par la barre du haut.
 */
const inView = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el || el.hidden || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
  if (getComputedStyle(el).pointerEvents === 'none') return r.top >= (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) - 1;
  const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)); const y = Math.min(innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, (innerHeight - r.top) / 2)));
  const top = document.elementFromPoint(x, y);
  return !!top && (el === top || el.contains(top) || top.contains(el));
})()`;

/** Identifiants des éléments visibles mis en avant comme « action suivante ». */
const NEXT_ACTIONS = "[...document.querySelectorAll('.next-action')].filter((el) => !el.closest('[hidden]') && el.getClientRects().length).map((el) => el.id || el.className)";

/** Éléments interactifs visibles plus petits que 44 × 44 px (WCAG 2.5.5). */
const SMALL_TARGETS = `[...document.querySelectorAll('button, .button, input:not([type=hidden]), select, summary, [role=button]')]
  .filter((el) => !el.closest('[hidden], dialog:not([open])') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
  .map((el) => { const r = el.getBoundingClientRect(); return { id: el.id || el.textContent.trim().slice(0, 30) || el.type, w: Math.round(r.width), h: Math.round(r.height), range: el.type === 'range' }; })
  .filter(({ w, h, range }) => (range ? h < 28 : h < 44 || w < 44))`;

/** Textes visibles : taille de police et contraste avec le fond réel (en remontant les parents). */
const TEXT_AUDIT = `(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g) || [0, 0, 0, 0]; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const background = (el) => {
    let layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null; // dégradé ou image : non mesurable
      const c = parse(style.backgroundColor);
      if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let out = { r: 255, g: 255, b: 255 };
    for (const c of layers.reverse()) out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
    return out;
  };
  const small = []; const lowContrast = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.textContent.trim() || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('[hidden], dialog:not([open]), script, style, option, footer') || !el.getClientRects().length) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || +style.opacity === 0) continue;
    if (el.closest(':disabled, [aria-disabled=true]')) continue; // WCAG : éléments inactifs exemptés
    const label = el.textContent.trim().slice(0, 40);
    const size = parseFloat(style.fontSize);
    if (size < 12) small.push(label + ' (' + size + ' px)');
    const bg = background(el); if (!bg) continue;
    const fg = parse(style.color);
    const blended = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const [hi, lo] = [lum(blended), lum(bg)].sort((x, y) => y - x);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const large = size >= 24 || (size >= 18.66 && +style.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5)) lowContrast.push(label + ' (' + ratio.toFixed(2) + ')');
  }
  return { small, lowContrast };
})()`;

const list = (items, max = 6) => `${items.length} : ${items.slice(0, max).join(' · ')}${items.length > max ? ' …' : ''}`;

// ---------- Campagne ----------

async function campaign(baseUrl) {
  const errors = [];
  cdp.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');

  // --- Première visite ---
  for (const viewport of ['pc', 'tel']) {
    await step(`[U-01] ${viewport} : la première action (importer une photo) est visible sans défiler`, async () => {
      await open(baseUrl, viewport);
      await shot(`${viewport}-1-accueil`);
      check(await evaluate(inView('#importButton')), 'le bouton « Importer une photo » est hors de l’écran ou absent au premier affichage');
    });
  }

  await step('[U-02] Une seule action mise en avant à chaque étape, et c’est la bonne', async () => {
    await open(baseUrl, 'pc');
    const expect = async (moment, id) => {
      const actions = await evaluate(NEXT_ACTIONS);
      check(actions.length === 1 && actions[0] === id, `${moment} : action suivante attendue #${id}, trouvé [${actions.join(', ')}]`);
    };
    await expect('à l’ouverture', 'importButton');
    await importWith(SYNTHETIC_FILE);
    await expect('photo analysée', 'planButton');
    await nest();
    await expect('plan calculé', 'projectButton');
    await evaluate("document.querySelector('#cameraButton').click()");
    await waitFor("!document.querySelector('#captureButton').disabled", { message: 'caméra simulée non démarrée' });
    await expect('caméra en direct', 'captureButton');
    await evaluate("document.querySelector('#captureButton').click()");
  });

  for (const viewport of ['pc', 'tel']) {
    await step(`[U-03] ${viewport} : le message de guidage reste visible en bas de page`, async () => {
      await open(baseUrl, viewport);
      await importWith(SYNTHETIC_FILE);
      await evaluate('window.scrollTo(0, document.body.scrollHeight)'); await delay(200);
      await shot(`${viewport}-3-bas-de-page`);
      check(await evaluate(inView('#statusText')), 'le message de guidage disparaît quand on fait défiler la page');
      const size = await evaluate("parseFloat(getComputedStyle(document.querySelector('#statusText')).fontSize)");
      check(size >= 13, `message de guidage trop petit (${size} px)`);
    });
  }

  await step('[U-04] Le fil d’étapes indique l’étape en cours et permet d’y aller', async () => {
    await open(baseUrl, 'pc');
    const current = () => evaluate("document.querySelector('[aria-current=step]')?.id ?? null");
    check(await current() === 'stepCapture', `étape en cours au départ : ${await current()}`);
    await importWith(SYNTHETIC_FILE);
    check(await current() === 'stepAnalyze', `étape en cours après la photo : ${await current()}`);
    await nest();
    check(await current() === 'stepPlan', `étape en cours après le plan : ${await current()}`);
    await evaluate("window.scrollTo(0, 0); document.querySelector('#stepPlan').click()");
    await settleScroll();
    const top = await evaluate("document.querySelector('#step3').getBoundingClientRect().top");
    check(Math.abs(top) < VIEWPORTS.pc.height / 2, `cliquer l’étape 3 n’amène pas à la section du plan (haut de la section à ${Math.round(top)} px)`);
  });

  await step('[U-05] Aucun jargon technique dans le texte visible', async () => {
    await open(baseUrl, 'pc');
    await importWith(SYNTHETIC_FILE);
    const words = await evaluate("['MAD', 'nesting', 'homographie', 'raster', 'masque binaire'].filter((word) => new RegExp('\\\\b' + word + '\\\\b', 'i').test(document.body.innerText))");
    check(words.length === 0, `jargon visible : ${words.join(', ')}`);
  });

  // --- Importer la photo ---
  await step('[U-06] Glisser-déposer une photo sur la zone d’image l’importe', async () => {
    await open(baseUrl, 'pc');
    await evaluate(`(async () => {
      const transfer = new DataTransfer(); transfer.items.add(await ${SYNTHETIC_FILE});
      const zone = document.querySelector('#cameraStage');
      zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      zone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    })()`);
    await waitFor('!!retissDebug.state.image', { timeout: 3000, message: 'la photo déposée n’a pas été importée' });
  });

  await step('[U-07] Coller une image (Ctrl + V) l’importe', async () => {
    await open(baseUrl, 'pc');
    await evaluate(`(async () => {
      const transfer = new DataTransfer(); transfer.items.add(await ${SYNTHETIC_FILE});
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    })()`);
    await waitFor('!!retissDebug.state.image', { timeout: 3000, message: 'l’image collée n’a pas été importée' });
  });

  await step('[U-08] Cliquer sur la zone d’image vide ouvre le choix de fichier', async () => {
    await open(baseUrl, 'pc');
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });
    let opened = false;
    cdp.on((message) => { if (message.method === 'Page.fileChooserOpened') opened = true; });
    try {
      await browserTools.clickAt(cdp, '#cameraStage', 0.5, 0.5);
      await delay(300);
    } finally {
      await cdp.send('Page.setInterceptFileChooserDialog', { enabled: false });
    }
    check(opened, 'cliquer sur la zone vide ne fait rien');
  });

  await step('[U-09] Pas de bouton inutilisable affiché (Figer sans caméra, Recadrer sans photo)', async () => {
    await open(baseUrl, 'pc');
    const shown = await evaluate("['#captureButton', '#cropButton'].filter((s) => { const el = document.querySelector(s); return el.getClientRects().length && !el.closest('[hidden]'); })");
    check(shown.length === 0, `boutons affichés alors qu’ils ne servent à rien : ${shown.join(', ')}`);
    await importWith(SYNTHETIC_FILE);
    check(await evaluate(inView('#cropButton')) || await evaluate("document.querySelector('#cropButton').getClientRects().length > 0"), 'Recadrer n’apparaît pas une fois la photo chargée');
  });

  // --- Recadrer ---
  await step('[U-10] Recadrage : consigne et compteur affichés sur la photo', async () => {
    await open(baseUrl, 'pc');
    await importWith(SYNTHETIC_FILE);
    await evaluate("document.querySelector('#cropButton').click()"); await delay(150);
    await shot('pc-10-recadrage');
    check(await evaluate(inView('#cropHint')), 'aucune consigne sur la photo pendant le recadrage');
    check(await evaluate("/1\\s*\\/\\s*4|0\\s*\\/\\s*4|coin 1/i.test(document.querySelector('#cropHint').textContent)"), 'la consigne n’indique pas quel coin cliquer');
    check(await evaluate("getComputedStyle(document.querySelector('#sourcePreview')).cursor === 'crosshair'"), 'le curseur ne change pas pendant le recadrage');
    // Photo en portrait : les 4 coins doivent être visibles ensemble, sous la barre du haut.
    const fits = await evaluate("(() => { const r = document.querySelector('#sourcePreview').getBoundingClientRect(); const top = document.querySelector('.topbar').getBoundingClientRect().bottom; return r.top >= top - 1 && r.bottom <= innerHeight + 1; })()");
    check(fits, 'la photo dépasse de l’écran : impossible de voir les 4 coins à la fois');
  });

  await step('[U-11] Recadrage : Retour arrière annule le dernier coin, Échap annule tout', async () => {
    await browserTools.clickAt(cdp, '#sourcePreview', 0.1, 0.1);
    await browserTools.clickAt(cdp, '#sourcePreview', 0.9, 0.1);
    check(await evaluate('retissDebug.state.crop.points.length') === 2, 'les clics ne posent pas de coin');
    await pressKey('Backspace', { keyCode: 8 });
    check(await evaluate('retissDebug.state.crop.points.length') === 1, 'Retour arrière n’annule pas le dernier coin');
    await pressKey('Escape', { keyCode: 27 });
    check(await evaluate('!retissDebug.state.crop.picking'), 'Échap n’annule pas le recadrage');
  });

  // --- Vérifier les taches ---
  await step('[U-12] Le réglage de détection dit dans quel sens aller', async () => {
    await open(baseUrl, 'pc');
    const label = await evaluate("document.querySelector('label[for=sensitivity]').textContent");
    check(!/MAD/.test(label), `réglage nommé « ${label.trim()} »`);
    const ends = await evaluate("[...document.querySelectorAll('.range-ends span')].map((el) => el.textContent.trim())");
    check(ends.length === 2 && ends.every(Boolean), 'les deux extrémités du curseur ne sont pas expliquées');
  });

  await step('[U-13] Photo réelle avec plis : alerte « beaucoup de zones marquées » et piste de réglage', async () => {
    await open(baseUrl, 'pc');
    await importWith(REAL_FILE);
    await shot('pc-13-photo-reelle');
    const summary = await evaluate("document.querySelector('#analysisSummary').textContent");
    check(/plis|reflets|tolérant|ignore/i.test(summary), `aucune alerte alors que les plis sont pris pour des taches : « ${summary.trim()} »`);
  });

  await step('[U-14] Pinceau : la taille réelle est prévisualisée sous la souris', async () => {
    await evaluate("document.querySelector('#maskCanvas').scrollIntoView({ block: 'center' })");
    const rect = await evaluate("(() => { const r = document.querySelector('#maskCanvas').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y });
    await delay(100);
    const cursor = await evaluate("(() => { const c = document.querySelector('#brushCursor'); if (!c || c.hidden) return null; const r = c.getBoundingClientRect(); return { w: r.width, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; })()");
    check(cursor && cursor.w > 2, 'aucun aperçu du pinceau sous la souris');
    check(Math.abs(cursor.cx - rect.x) < 3 && Math.abs(cursor.cy - rect.y) < 3, 'l’aperçu du pinceau n’est pas centré sur la souris');
  });

  await step('[U-15] Pinceau : annuler un trait (bouton et Ctrl + Z)', async () => {
    const before = await evaluate("document.querySelector('#maskCount').textContent");
    const stroke = async () => {
      const r = await evaluate("(() => { const r = document.querySelector('#maskCanvas').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + 0.2 * r.w, y: r.y + 0.9 * r.h, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + 0.8 * r.w, y: r.y + 0.9 * r.h, button: 'left', buttons: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + 0.8 * r.w, y: r.y + 0.9 * r.h, button: 'left', buttons: 0, clickCount: 1 });
      await delay(120);
    };
    await stroke();
    check(await evaluate("document.querySelector('#maskCount').textContent") !== before, 'le trait n’a rien changé');
    check(await evaluate("!!document.querySelector('#undoButton') && !document.querySelector('#undoButton').disabled"), 'pas de bouton « Annuler » actif après un trait');
    await evaluate("document.querySelector('#undoButton').click()"); await delay(120);
    check(await evaluate("document.querySelector('#maskCount').textContent") === before, 'le bouton Annuler ne rétablit pas le masque');
    await stroke();
    await pressKey('z', { code: 'KeyZ', keyCode: 90, modifiers: 2 }); await delay(120);
    check(await evaluate("document.querySelector('#maskCount').textContent") === before, 'Ctrl + Z ne rétablit pas le masque');
  });

  await step('[U-16] Les outils à bascule annoncent leur état (aria-pressed)', async () => {
    const states = await evaluate("[document.querySelector('#addTool').getAttribute('aria-pressed'), document.querySelector('#eraseTool').getAttribute('aria-pressed')]");
    check(states[0] === 'true' && states[1] === 'false', `aria-pressed : ${JSON.stringify(states)}`);
  });

  // --- Plan ---
  await step('[U-17] Plan sans aucun T-shirt : explication et bouton pour corriger', async () => {
    await open(baseUrl, 'pc');
    await importWith(REAL_FILE);
    await nest();
    await shot('pc-17-zero');
    const kits = await evaluate('retissDebug.state.plan.stats.completeKits');
    if (kits > 0) return 'SKIP';
    check(await evaluate(inView('#planAdvice')), 'aucune explication visible quand le plan ne contient aucun T-shirt');
    const advice = await evaluate("document.querySelector('#planAdvice').textContent");
    check(/sensibilit|plis|pinceau|effac/i.test(advice), `l’explication ne propose pas de solution : « ${advice.trim()} »`);
    check(await evaluate("!!document.querySelector('#planAdvice button')"), 'pas de bouton pour aller corriger la détection');
    await evaluate("document.querySelector('#planAdvice button').click()");
    await settleScroll();
    check(await evaluate(inView('#sensitivity')), 'le bouton ne mène pas au réglage de détection');
    return undefined;
  });

  for (const viewport of ['pc', 'tel']) {
    await step(`[U-18] ${viewport} : le résultat apparaît à l’écran après « Imbriquer », sans chercher`, async () => {
      await open(baseUrl, viewport);
      await importWith(SYNTHETIC_FILE);
      await evaluate("document.querySelector('#planButton').scrollIntoView({ block: 'center' })");
      await nest(); await settleScroll();
      await shot(`${viewport}-18-plan`);
      check(await evaluate(inView('#resultCanvas')), 'le plan calculé est hors de l’écran');
    });
  }

  await step('[U-19] Parcours le plus court : photo → plan en 2 actions', async () => {
    await open(baseUrl, 'pc');
    await importWith(SYNTHETIC_FILE); // action 1
    check(await evaluate("!document.querySelector('#planButton').disabled"), 'une action intermédiaire est encore nécessaire avant d’imbriquer');
    await nest(); // action 2
    check(await evaluate('retissDebug.state.plan.stats.completeKits > 0'), 'aucun T-shirt sur la photo de synthèse');
  });

  // --- Confort et accessibilité ---
  await step('[U-20] Téléphone : toutes les cibles tactiles font au moins 44 px', async () => {
    await open(baseUrl, 'tel');
    await importWith(SYNTHETIC_FILE);
    const small = await evaluate(SMALL_TARGETS);
    check(small.length === 0, `cibles trop petites ${list(small.map(({ id, w, h }) => `${id} ${w}×${h}`))}`);
  });

  for (const viewport of ['pc', 'tel']) {
    await step(`[U-21][U-22] ${viewport} : texte ≥ 12 px et contraste suffisant (WCAG AA)`, async () => {
      await open(baseUrl, viewport);
      await importWith(SYNTHETIC_FILE);
      await nest();
      const { small, lowContrast } = await evaluate(TEXT_AUDIT);
      check(small.length === 0 && lowContrast.length === 0, [small.length ? `textes trop petits ${list(small)}` : '', lowContrast.length ? `contraste insuffisant ${list(lowContrast)}` : ''].filter(Boolean).join('\n      '));
    });
  }

  await step('[U-23] Téléphone : aucun défilement horizontal', async () => {
    await open(baseUrl, 'tel');
    await importWith(SYNTHETIC_FILE);
    const overflow = await evaluate('document.documentElement.scrollWidth - innerWidth');
    check(overflow <= 0, `la page déborde de ${overflow} px en largeur`);
  });

  await step('[U-24] Clavier : « Importer une photo » atteint en 5 tabulations au plus, focus visible', async () => {
    await open(baseUrl, 'pc');
    let reached = 0;
    for (let i = 1; i <= 5 && !reached; i += 1) {
      await pressKey('Tab', { keyCode: 9 });
      if (await evaluate("document.activeElement?.id === 'importButton'")) reached = i;
    }
    check(reached, '« Importer une photo » n’est pas atteint en 5 tabulations');
    check(await evaluate("getComputedStyle(document.activeElement).outlineStyle !== 'none'"), 'focus clavier invisible');
  });

  await step('Aucune erreur JavaScript pendant la campagne', async () => {
    check(errors.length === 0, errors.join('\n'));
  });
}

const server = await startServer(ROOT, 0);
const browser = await launchBrowser();
try {
  cdp = await connect(browser.wsUrl);
  await campaign(server.url);
} finally {
  cdp?.close(); browser.close(); server.close();
}
const failed = runner.report(' — sans objet (la photo réelle donne déjà des T-shirts)');
process.exitCode = failed ? 1 : 0;
