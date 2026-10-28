// Pilotage de Chrome/Edge headless via le protocole DevTools (WebSocket natif
// de Node 22), sans dépendance à installer. Partagé par e2e.js et usability.js.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchBrowser() {
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

export function connect(wsUrl) {
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

/** Évalue une expression dans la page et renvoie sa valeur (promesses attendues). */
export async function evaluate(connection, expression) {
  const { result, exceptionDetails } = await connection.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

export async function waitFor(connection, expression, { timeout = 10000, message } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(connection, expression)) return;
    await delay(50);
  }
  throw new Error(message ?? `Délai dépassé en attendant : ${expression}`);
}

export function check(condition, message) { if (!condition) throw new Error(message); }

/** Suite d'étapes nommées : une étape en échec n'arrête pas les suivantes. */
export function createRunner() {
  const results = [];
  async function step(name, body) {
    const start = Date.now();
    try {
      const note = await body();
      results.push({ name, status: note === 'SKIP' ? 'SKIP' : 'OK', ms: Date.now() - start });
    } catch (error) {
      results.push({ name, status: 'ÉCHEC', ms: Date.now() - start, error: error.message });
    }
  }
  function report(skipNote = '') {
    for (const { name, status, ms, error } of results) {
      console.log(`${status === 'OK' ? '✔' : status === 'SKIP' ? '○' : '✖'} ${name} (${ms} ms)${status === 'SKIP' ? skipNote : ''}`);
      if (error) console.log(`    → ${error}`);
    }
    const failed = results.filter((result) => result.status === 'ÉCHEC').length;
    console.log(`\n${results.length - failed}/${results.length} étapes réussies`);
    return failed;
  }
  return { step, report, results };
}

/** Clic de souris réel sur un élément, en fractions de sa taille affichée. */
export async function clickAt(connection, selector, fx = 0.5, fy = 0.5) {
  await evaluate(connection, `document.querySelector('${selector}').scrollIntoView({ block: 'center' })`);
  const rect = await evaluate(connection, `(() => { const r = document.querySelector('${selector}').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
  const point = { x: rect.x + fx * rect.w, y: rect.y + fy * rect.h };
  await connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
  await connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
}

/** Appui sur une touche (avec modificateurs CDP : 2 = Ctrl). */
export async function pressKey(connection, key, { code = key, keyCode = 0, modifiers = 0 } = {}) {
  await connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
  await connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}
