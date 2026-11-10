// Fenêtre de projection (D-24) : reçoit le plan de la fenêtre principale par
// BroadcastChannel et le dessine sur le tissu via l'homographie de calibrage.
// D-55 : les défauts sont projetés avec leur contour réel.
// D-60 : découpe guidée, pièce par pièce, comme sur les projecteurs de patrons
// du commerce (une pièce mise en avant, les pièces coupées cochées).
import { APP_VERSION } from '../config.js';
import {
  calibrationPattern, cuttingOrder, defaultCorners, grainLine, isUsableQuad, moveCorner, nearestCorner, pixelSizeMm, polygonCentroid,
  projectionMatrix, projectPoints
} from '../core/projection.js';

const CHANNEL_NAME = 'retiss-projection';
// « pièces » : chaque pièce garde sa couleur du plan affiché à l'écran.
const LINE_COLORS = [['blanc', '#ffffff'], ['vert', '#00ff66'], ['jaune', '#ffee00'], ['cyan', '#00e5ff'], ['magenta', '#ff3df5'], ['pièces', null]];
const DEFECT_COLOR = '#ff3b3b';
const CUT_COLOR = '#6f7a8a';

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
  showGrain: true,     // flèches du droit-fil
  colorIndex: 0,
  lineWidth: 2,
  guided: false,       // découpe guidée : une pièce à la fois
  order: [],           // ordre de découpe (indices des pièces)
  cursor: 0,           // position dans `order` de la pièce en cours
  cut: new Set(),      // indices des pièces déjà coupées
  selected: 0,         // coin déplacé au clavier
  dragging: -1,        // coin déplacé à la souris
  drawQueued: false
};

// ---------- Calibrage mémorisé (projecteur fixe → même calibrage d'une séance à l'autre) ----------

// D-38 : les coins sont en pixels de la fenêtre ; un calibrage fait en plein
// écran n'est valable qu'en plein écran. La clé inclut donc la taille de la
// fenêtre (et celle du tissu), pas seulement celle de l'écran.
function storageKey() {
  return `retiss.projection.${window.innerWidth}x${window.innerHeight}.${state.fabric.widthCm}x${state.fabric.heightCm}`;
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

function tracePolyline(points, closed) {
  context.beginPath();
  points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  if (closed) context.closePath();
}
function strokePolyline(points, closed) { tracePolyline(points, closed); context.stroke(); }

/** « PORTE-BILLETS » → « Porte-billets », avec le numéro d'exemplaire s'il y en a plusieurs. */
function pieceTitle(piece, numbered) {
  const name = piece.name.charAt(0) + piece.name.slice(1).toLowerCase();
  return numbered ? `${name} n° ${piece.pass}` : name;
}

/** Double flèche du droit-fil d'une pièce (le fil du tissu suit la longueur du coupon). */
function drawGrain(piece, map) {
  const [from, to] = map(grainLine(piece, 0.45, 0.3));
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length < 36) return;
  const ux = (to[0] - from[0]) / length; const uy = (to[1] - from[1]) / length; const head = 8;
  context.save();
  context.lineWidth = 1.5; context.setLineDash([8, 6]);
  strokePolyline([from, to], false);
  context.setLineDash([]);
  for (const [[x, y], sign] of [[from, 1], [to, -1]]) {
    strokePolyline([[x + sign * head * ux - head * 0.6 * uy, y + sign * head * uy + head * 0.6 * ux], [x, y], [x + sign * head * ux + head * 0.6 * uy, y + sign * head * uy - head * 0.6 * ux]], false);
  }
  context.restore();
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
  const lineColor = LINE_COLORS[state.colorIndex][1];
  const accent = lineColor ?? '#ffffff';

  const { grid, border, square } = calibrationPattern(fabric, 50);
  // D-37 : le bord du tissu reste visible pendant le calibrage (il sert à caler
  // les coins) ; M ne masque que le quadrillage et le carré témoin.
  if (state.showPattern || state.calibrating) {
    context.lineWidth = 2; context.strokeStyle = '#9a9a9a';
    for (const segment of border) strokePolyline(map(segment), false);
  }
  if (state.showPattern) {
    context.lineWidth = 1; context.strokeStyle = '#4a4a4a';
    for (const segment of grid) strokePolyline(map(segment), false);
    context.lineWidth = 2; context.strokeStyle = accent;
    for (const segment of square) strokePolyline(map(segment), false);
    const [labelX, labelY] = map([[12, 6]])[0];
    context.fillStyle = accent; context.font = '14px Manrope, system-ui, sans-serif'; context.textBaseline = 'middle';
    context.fillText('10 cm', labelX, labelY);
  }

  if (state.plan) {
    if (state.showDefects) {
      // D-55 : contour réel de chaque défaut, légèrement rempli pour le repérer sur le tissu.
      context.lineWidth = 2; context.strokeStyle = DEFECT_COLOR; context.fillStyle = 'rgba(255,59,59,0.22)'; context.lineJoin = 'round';
      context.beginPath();
      for (const polygon of state.plan.defects) {
        map(polygon).forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
        context.closePath();
      }
      context.fill('evenodd'); context.stroke();
    }
    const { pieces } = state.plan;
    const numbered = pieces.some((piece) => piece.pass > 1);
    const current = state.guided ? state.order[state.cursor] : -1;
    context.lineJoin = 'round'; context.textAlign = 'center'; context.textBaseline = 'middle';
    pieces.forEach((piece, index) => {
      const isCut = state.cut.has(index); const isCurrent = index === current;
      const color = isCut ? CUT_COLOR : lineColor ?? piece.color;
      const dimmed = state.guided && !isCurrent;
      const outline = map(piece.polygon);
      context.globalAlpha = dimmed && !isCut ? 0.45 : 1;
      context.strokeStyle = color; context.fillStyle = color;
      context.lineWidth = isCurrent ? state.lineWidth + 3 : state.lineWidth;
      context.setLineDash(isCut ? [6, 6] : []);
      strokePolyline(outline, true);
      context.setLineDash([]);
      if (state.showGrain && !isCut && !dimmed) drawGrain(piece, map);
      if (state.showLabels) {
        const [cx, cy] = map([polygonCentroid(piece.polygon)])[0];
        context.font = `${isCurrent ? '700 17px' : '600 13px'} Manrope, system-ui, sans-serif`;
        context.fillText(`${isCut ? '✓ ' : ''}${pieceTitle(piece, numbered)}`, cx, cy);
      }
      context.globalAlpha = 1;
    });
    context.textAlign = 'start';
  } else {
    context.fillStyle = '#8a8a8a'; context.font = '18px Manrope, system-ui, sans-serif'; context.textAlign = 'center';
    context.fillText('En attente du plan : lance « Calculer le plan de découpe » dans ReTiss', width / 2, height / 2);
    context.textAlign = 'start';
  }

  if (state.calibrating) {
    state.corners.forEach(([x, y], index) => {
      context.beginPath(); context.arc(x, y, 14, 0, Math.PI * 2);
      context.fillStyle = index === state.selected ? '#8f8bff' : '#ffffff'; context.fill();
      context.fillStyle = '#000'; context.font = 'bold 14px Manrope, system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
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
  const { pieces } = state.plan;
  const guided = state.guided
    ? `Découpe guidée : pièce ${state.cursor + 1}/${pieces.length} — ${pieceTitle(pieces[state.order[state.cursor]], pieces.some((piece) => piece.pass > 1))} · ${state.cut.size} coupée${state.cut.size > 1 ? 's' : ''}. Espace : coupée, N / P : suivante / précédente. `
    : '';
  info.textContent = `${guided}${pieces.length} pièces · tissu ${state.fabric.widthCm} × ${state.fabric.heightCm} cm · 1 pixel ≈ ${pixel.toFixed(1)} mm sur le tissu · couleur ${LINE_COLORS[state.colorIndex][0]}, trait ${state.lineWidth} px.${versionWarning}`;
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

/** Avance (ou recule) jusqu'à la prochaine pièce de l'ordre de découpe. */
function stepPiece(direction) {
  if (!state.plan || !state.order.length) return;
  state.guided = true;
  state.cursor = (state.cursor + direction + state.order.length) % state.order.length;
}
/** Coche la pièce en cours comme coupée (ou la décoche) et passe à la suivante non coupée. */
function toggleCut() {
  if (!state.plan || !state.guided) return;
  const index = state.order[state.cursor];
  if (state.cut.has(index)) { state.cut.delete(index); return; }
  state.cut.add(index);
  for (let step = 1; step <= state.order.length; step += 1) {
    const next = (state.cursor + step) % state.order.length;
    if (!state.cut.has(state.order[next])) { state.cursor = next; return; }
  }
}

const COMMANDS = {
  f: toggleFullscreen,
  c: () => { state.calibrating = !state.calibrating; },
  m: () => { state.showPattern = !state.showPattern; },
  l: () => { state.showLabels = !state.showLabels; },
  d: () => { state.showDefects = !state.showDefects; },
  a: () => { state.showGrain = !state.showGrain; },
  k: () => { state.colorIndex = (state.colorIndex + 1) % LINE_COLORS.length; },
  '[': () => { state.lineWidth = Math.max(1, state.lineWidth - 1); },
  ']': () => { state.lineWidth = Math.min(10, state.lineWidth + 1); },
  r: () => { resetCorners(); saveCorners(); },
  g: () => { state.guided = !state.guided; if (state.guided) state.calibrating = false; },
  n: () => stepPiece(1),
  p: () => stepPiece(-1),
  ' ': toggleCut,
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
  // Hors calibrage, les flèches gauche / droite parcourent les pièces de la découpe guidée.
  if (state.guided && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) { event.preventDefault(); run(event.key === 'ArrowRight' ? 'n' : 'p'); return; }
  const key = event.key.toLowerCase();
  if (!COMMANDS[key]) return;
  event.preventDefault();
  run(key);
});

// blur() : sinon Espace réactiverait le bouton cliqué en plus de sa commande.
help.querySelectorAll('button[data-key]').forEach((button) => button.addEventListener('click', () => { button.blur(); run(button.dataset.key); }));

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
// Fenêtre redimensionnée ou passage en plein écran : on reprend le calibrage
// enregistré pour cette taille de fenêtre, sinon les coins par défaut (D-38).
window.addEventListener('resize', () => { state.corners = loadCorners(); if (!state.corners) resetCorners(); scheduleDraw(); });

// ---------- Réception du plan ----------

/** Deux plans ont-ils les mêmes pièces aux mêmes endroits ? (un plan renvoyé à l'identique garde les pièces cochées) */
function samePieces(a, b) {
  return !!a && !!b && a.pieces.length === b.pieces.length && a.pieces.every((piece, index) => piece.name === b.pieces[index].name
    && piece.polygon.length === b.pieces[index].polygon.length && piece.polygon.every(([x, y], k) => x === b.pieces[index].polygon[k][0] && y === b.pieces[index].polygon[k][1]));
}

const channel = new BroadcastChannel(CHANNEL_NAME);
channel.addEventListener('message', (event) => {
  if (event.data?.type !== 'plan') return;
  const fabricChanged = event.data.fabric.widthCm !== state.fabric.widthCm || event.data.fabric.heightCm !== state.fabric.heightCm;
  state.fabric = event.data.fabric;
  // Plan vide = plan invalidé dans la fenêtre principale : on n'affiche plus d'anciens contours.
  const plan = event.data.pieces.length ? { ...event.data, defects: event.data.defects ?? [] } : null;
  if (!samePieces(plan, state.plan)) { state.cut = new Set(); state.cursor = 0; state.order = plan ? cuttingOrder(plan.pieces) : []; }
  state.plan = plan;
  if (fabricChanged || !state.corners) { state.corners = loadCorners(); if (!state.corners) resetCorners(); }
  scheduleDraw();
});
channel.postMessage({ type: 'hello' });

state.corners = loadCorners();
scheduleDraw();
window.projectionDebug = Object.freeze({ get state() { return state; } });
