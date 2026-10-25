// Fenêtre de projection (D-24) : reçoit le plan de la fenêtre principale par
// BroadcastChannel et le dessine sur le tissu via l'homographie de calibrage.
import { APP_VERSION } from '../config.js';
import {
  calibrationPattern, defaultCorners, isUsableQuad, moveCorner, nearestCorner, pixelSizeMm, projectionMatrix, projectPoints
} from '../core/projection.js';

const CHANNEL_NAME = 'retiss-projection';
const LINE_COLORS = [['blanc', '#ffffff'], ['vert', '#00ff66'], ['jaune', '#ffee00'], ['cyan', '#00e5ff'], ['magenta', '#ff3df5']];

const canvas = document.querySelector('#projectionCanvas');
const help = document.querySelector('#projectionHelp');
const info = document.querySelector('#projectionInfo');
const context = canvas.getContext('2d');

const state = {
  fabric: { widthCm: 300, heightCm: 450 }, // tissu courant, envoyé par la fenêtre principale même sans plan
  plan: null,          // dernier plan reçu (voir planForProjection), null s'il n'y en a pas ou s'il a été invalidé
  corners: null,       // coins du tissu à l'écran, en px CSS : [HG, HD, BD, BG]
  calibrating: true,
  showPattern: true,
  showLabels: true,
  showDefects: true,
  colorIndex: 0,
  lineWidth: 2,
  selected: 0,         // coin déplacé au clavier
  dragging: -1,        // coin déplacé à la souris
  drawQueued: false
};

// ---------- Calibrage mémorisé (projecteur fixe → même calibrage d'une séance à l'autre) ----------

function storageKey() {
  return `retiss.projection.${window.screen.width}x${window.screen.height}.${state.fabric.widthCm}x${state.fabric.heightCm}`;
}
function loadCorners() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey()));
    if (isUsableQuad(saved)) return saved;
  } catch { /* stockage indisponible ou valeur corrompue */ }
  return null;
}
function saveCorners() {
  try { localStorage.setItem(storageKey(), JSON.stringify(state.corners)); } catch { /* navigation privée */ }
}
function resetCorners() { state.corners = defaultCorners(state.fabric, { width: window.innerWidth, height: window.innerHeight }); }

// ---------- Dessin ----------

function scheduleDraw() {
  if (state.drawQueued) return;
  state.drawQueued = true;
  requestAnimationFrame(() => { state.drawQueued = false; draw(); });
}

function strokePolyline(points, closed) {
  context.beginPath();
  points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  if (closed) context.closePath();
  context.stroke();
}

function draw() {
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth; const height = window.innerHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
  if (!state.corners) resetCorners();
  const fabric = state.fabric;
  const matrix = projectionMatrix(fabric, state.corners);
  const map = (points) => projectPoints(matrix, points);
  const color = LINE_COLORS[state.colorIndex][1];

  if (state.showPattern || state.calibrating) {
    const { grid, border, square } = calibrationPattern(fabric, 50);
    context.lineWidth = 1; context.strokeStyle = '#4a4a4a';
    for (const segment of grid) strokePolyline(map(segment), false);
    context.lineWidth = 2; context.strokeStyle = '#9a9a9a';
    for (const segment of border) strokePolyline(map(segment), false);
    context.strokeStyle = color;
    for (const segment of square) strokePolyline(map(segment), false);
    const [labelX, labelY] = map([[12, 6]])[0];
    context.fillStyle = color; context.font = '14px Manrope, system-ui, sans-serif'; context.textBaseline = 'middle';
    context.fillText('10 cm', labelX, labelY);
  }

  if (state.plan) {
    if (state.showDefects) {
      context.lineWidth = 1.5; context.strokeStyle = '#ff3b3b';
      for (const { x0, y0, x1, y1 } of state.plan.defects) {
        strokePolyline(map([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]), true);
        strokePolyline(map([[x0, y0], [x1, y1]]), false); strokePolyline(map([[x1, y0], [x0, y1]]), false);
      }
    }
    context.lineWidth = state.lineWidth; context.strokeStyle = color; context.lineJoin = 'round';
    context.fillStyle = color; context.textAlign = 'center'; context.font = '13px Manrope, system-ui, sans-serif';
    for (const piece of state.plan.pieces) {
      const outline = map(piece.polygon);
      strokePolyline(outline, true);
      if (state.showLabels) {
        const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length; const cy = outline.reduce((sum, p) => sum + p[1], 0) / outline.length;
        context.fillText(`${piece.name} #${piece.pass}`, cx, cy);
      }
    }
    context.textAlign = 'start';
  } else {
    context.fillStyle = '#8a8a8a'; context.font = '18px Manrope, system-ui, sans-serif'; context.textAlign = 'center';
    context.fillText('En attente du plan : lance « Imbriquer les patrons » dans ReTiss', width / 2, height / 2);
    context.textAlign = 'start';
  }

  if (state.calibrating) {
    state.corners.forEach(([x, y], index) => {
      context.beginPath(); context.arc(x, y, 14, 0, Math.PI * 2);
      context.fillStyle = index === state.selected ? '#e58b3e' : '#ffffff'; context.fill();
      context.fillStyle = '#000'; context.font = 'bold 14px Manrope, system-ui, sans-serif'; context.textAlign = 'center';
      context.fillText(String(index + 1), x, y + 1);
      context.textAlign = 'start';
    });
  }
  updateInfo();
}

function updateInfo() {
  if (!state.plan) { info.textContent = 'En attente du plan… Calibre dès maintenant si tu veux : les coins seront gardés.'; info.className = 'projection-info'; return; }
  const versionWarning = state.plan.version && state.plan.version !== APP_VERSION
    ? ` Attention : versions différentes (${state.plan.version} / ${APP_VERSION}), recharge les deux fenêtres avec Ctrl + F5.` : '';
  const pixel = pixelSizeMm(state.fabric, state.corners);
  info.textContent = `${state.plan.pieces.length} pièces · tissu ${state.fabric.widthCm} × ${state.fabric.heightCm} cm · 1 pixel ≈ ${pixel.toFixed(1)} mm sur le tissu · couleur ${LINE_COLORS[state.colorIndex][0]}, trait ${state.lineWidth} px.${versionWarning}`;
  info.className = versionWarning || pixel > 5 ? 'projection-info warning' : 'projection-info';
}

// ---------- Commandes ----------

async function toggleFullscreen() {
  if (document.fullscreenElement) { await document.exitFullscreen(); return; }
  let options;
  if ('getScreenDetails' in window) {
    // Chrome / Edge : plein écran directement sur l'écran du projecteur (écran secondaire).
    try {
      const details = await window.getScreenDetails();
      const target = details.currentScreen && !details.currentScreen.isPrimary ? details.currentScreen : details.screens.find((screen) => !screen.isPrimary);
      if (target) options = { screen: target };
    } catch { /* permission refusée : plein écran sur l'écran actuel */ }
  }
  await document.documentElement.requestFullscreen(options);
  help.hidden = true; // l'aide serait projetée sur le tissu
}

const COMMANDS = {
  f: toggleFullscreen,
  c: () => { state.calibrating = !state.calibrating; },
  m: () => { state.showPattern = !state.showPattern; },
  l: () => { state.showLabels = !state.showLabels; },
  d: () => { state.showDefects = !state.showDefects; },
  k: () => { state.colorIndex = (state.colorIndex + 1) % LINE_COLORS.length; },
  '[': () => { state.lineWidth = Math.max(1, state.lineWidth - 1); },
  ']': () => { state.lineWidth = Math.min(10, state.lineWidth + 1); },
  r: () => { resetCorners(); saveCorners(); },
  h: () => { help.hidden = !help.hidden; }
};

async function run(key) {
  try { await COMMANDS[key](); } catch (error) { info.textContent = `Erreur : ${error.message}`; info.className = 'projection-info warning'; }
  scheduleDraw();
}

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (state.calibrating && event.key === 'Tab') { event.preventDefault(); state.selected = (state.selected + (event.shiftKey ? 3 : 1)) % 4; scheduleDraw(); return; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (state.calibrating && arrows[event.key]) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1; const [dx, dy] = arrows[event.key]; const [x, y] = state.corners[state.selected];
    state.corners = moveCorner(state.corners, state.selected, x + dx * step, y + dy * step);
    saveCorners(); scheduleDraw();
    return;
  }
  const key = event.key.toLowerCase();
  if (!COMMANDS[key]) return;
  event.preventDefault();
  run(key);
});

help.querySelectorAll('button[data-key]').forEach((button) => button.addEventListener('click', () => run(button.dataset.key)));

canvas.addEventListener('pointerdown', (event) => {
  if (!state.calibrating) return;
  const index = nearestCorner(state.corners, [event.clientX, event.clientY], 60);
  if (index < 0) return;
  state.dragging = index; state.selected = index;
  canvas.setPointerCapture(event.pointerId);
  scheduleDraw();
});
canvas.addEventListener('pointermove', (event) => {
  if (state.dragging < 0) return;
  state.corners = moveCorner(state.corners, state.dragging, event.clientX, event.clientY);
  scheduleDraw();
});
const endDrag = () => { if (state.dragging >= 0) { state.dragging = -1; saveCorners(); } };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('resize', () => { if (!loadCorners()) resetCorners(); scheduleDraw(); });

// ---------- Réception du plan ----------

const channel = new BroadcastChannel(CHANNEL_NAME);
channel.addEventListener('message', (event) => {
  if (event.data?.type !== 'plan') return;
  const fabricChanged = event.data.fabric.widthCm !== state.fabric.widthCm || event.data.fabric.heightCm !== state.fabric.heightCm;
  state.fabric = event.data.fabric;
  // Plan vide = plan invalidé dans la fenêtre principale : on n'affiche plus d'anciens contours.
  state.plan = event.data.pieces.length ? event.data : null;
  if (fabricChanged || !state.corners) { state.corners = loadCorners(); if (!state.corners) resetCorners(); }
  scheduleDraw();
});
channel.postMessage({ type: 'hello' });

state.corners = loadCorners();
scheduleDraw();
window.projectionDebug = Object.freeze({ get state() { return state; } });
