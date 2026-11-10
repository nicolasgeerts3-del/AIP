// Dessin sur les canvas. Ces fonctions ne lisent aucun état global : elles
// reçoivent tout ce qu'elles affichent.
import { placementOutline, polygonBounds } from '../core/geometry.js';

const DEFECT_RGBA = [220, 55, 55, 195];

/** Affiche l'image source avec les défauts en rouge, à la résolution de l'image. */
export function drawMaskOverlay(canvas, imageCanvas, imageMask) {
  if (canvas.width !== imageMask.width) canvas.width = imageMask.width;
  if (canvas.height !== imageMask.height) canvas.height = imageMask.height;
  const context = canvas.getContext('2d');
  const pixels = imageCanvas.getContext('2d').getImageData(0, 0, imageMask.width, imageMask.height);
  const { data } = pixels;
  for (let index = 0; index < imageMask.data.length; index += 1) {
    if (!imageMask.data[index]) continue;
    const out = index * 4;
    data[out] = DEFECT_RGBA[0]; data[out + 1] = DEFECT_RGBA[1]; data[out + 2] = DEFECT_RGBA[2]; data[out + 3] = DEFECT_RGBA[3];
  }
  context.putImageData(pixels, 0, 0);
}

export function clearCanvas(canvas) {
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

/** Largeur visée du canvas du plan, en pixels : le plan reste net une fois agrandi à l'écran. */
const PLAN_TARGET_WIDTH = 1800;

/** Facteur d'agrandissement du plan : nombre entier de pixels par cellule de grille (2 à 6). */
export function planScale(gridWidth) {
  return Math.max(2, Math.min(6, Math.round(PLAN_TARGET_WIDTH / gridWidth)));
}

/** Centre de gravité d'un polygone (repli sur le centre de la boîte si la surface est nulle). */
function polygonCentroid(polygon) {
  let twice = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const cross = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    twice += cross; cx += (polygon[j][0] + polygon[i][0]) * cross; cy += (polygon[j][1] + polygon[i][1]) * cross;
  }
  if (Math.abs(twice) < 1e-9) { const box = polygonBounds(polygon); return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]; }
  return [cx / (3 * twice), cy / (3 * twice)];
}

/** Nom lisible d'une pièce : « PORTE-BILLETS » → « Porte-billets ». */
function pieceLabel(name) { return name.charAt(0) + name.slice(1).toLowerCase(); }

function tracePolygon(context, polygon, scale) {
  context.beginPath();
  polygon.forEach(([x, y], index) => (index ? context.lineTo(x * scale, y * scale) : context.moveTo(x * scale, y * scale)));
  context.closePath();
}

const labelFont = (size, weight) => `${weight} ${size}px Manrope, sans-serif`;

/** Boîte utile (en pixels du canvas) et point d'ancrage de l'étiquette d'une pièce. */
function labelFrame(polygon, scale) {
  const box = polygonBounds(polygon);
  const [cx, cy] = polygonCentroid(polygon).map((value) => value * scale);
  return { width: (box.maxX - box.minX) * scale * 0.82, height: (box.maxY - box.minY) * scale * 0.82, cx, cy };
}

/** Plus grande taille de police (px) à laquelle `text` tient dans la largeur `width`. */
function fitText(context, text, weight, width) {
  context.font = labelFont(100, weight);
  return 100 * width / context.measureText(text).width;
}

/** Taille des étiquettes « nom + n° » d'une pièce, sur deux lignes. */
function namedLabelSize(context, placement, frame, maxSize) {
  return Math.min(maxSize, fitText(context, pieceLabel(placement.name), 700, frame.width), fitText(context, `n° ${placement.pass}`, 600, frame.width), frame.height / 2.6);
}

/**
 * Étiquette d'une pièce : nom + numéro sur deux lignes si `named`, sinon le
 * numéro seul (la légende sous le menu donne la couleur de chaque pièce).
 */
function drawPieceLabel(context, placement, frame, { named, minSize, maxSize }) {
  let size; const lines = [];
  if (named) {
    size = namedLabelSize(context, placement, frame, maxSize);
    lines.push([pieceLabel(placement.name), 700, size], [`n° ${placement.pass}`, 600, size * 0.85]);
  } else {
    size = Math.min(maxSize * 0.75, fitText(context, String(placement.pass), 700, frame.width), frame.height / 1.4);
    if (size < minSize * 0.7) return;
    lines.push([String(placement.pass), 700, size]);
  }
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineJoin = 'round';
  lines.forEach(([text, weight, lineSize], index) => {
    const y = frame.cy + (index - (lines.length - 1) / 2) * size * 1.15;
    context.font = labelFont(lineSize, weight);
    context.lineWidth = Math.max(2, lineSize / 4); context.strokeStyle = 'rgba(255,255,255,0.85)';
    context.strokeText(text, frame.cx, y);
    context.fillStyle = '#1d2420'; context.fillText(text, frame.cx, y);
  });
}

/** Plan de découpe : photo du tissu, défauts en rouge, pièces colorées étiquetées (planScale pixels par cellule). */
export function drawPlan(canvas, { imageCanvas, gridMask, placements, colors }) {
  const { width, height } = gridMask;
  const scale = planScale(width);
  canvas.width = width * scale; canvas.height = height * scale;
  canvas.dataset.scale = String(scale);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.fillStyle = '#f5f5ed'; context.fillRect(0, 0, canvas.width, canvas.height);
  // Photo légèrement éclaircie : les pièces ressortent mieux.
  if (imageCanvas) {
    context.globalAlpha = 0.8; context.drawImage(imageCanvas, 0, 0, canvas.width, canvas.height); context.globalAlpha = 1;
    context.fillStyle = 'rgba(255,255,250,0.25)'; context.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Défauts : couche à la résolution de la grille, agrandie avec lissage pour des bords doux.
  const overlay = new ImageData(width, height);
  for (let index = 0; index < gridMask.data.length; index += 1) {
    if (gridMask.data[index]) overlay.data.set([214, 58, 58, 150], index * 4);
  }
  const layer = document.createElement('canvas');
  layer.width = width; layer.height = height;
  layer.getContext('2d').putImageData(overlay, 0, 0);
  context.drawImage(layer, 0, 0, canvas.width, canvas.height);

  const outlines = placements.map((placement) => placementOutline(placement));
  // Ombre portée discrète, puis remplissage et contour net de chaque pièce.
  context.save();
  context.shadowColor = 'rgba(20,30,25,0.28)'; context.shadowBlur = 3 * scale; context.shadowOffsetY = scale / 2;
  placements.forEach((placement, index) => {
    tracePolygon(context, outlines[index], scale);
    context.fillStyle = `${colors[placement.name] ?? '#777777'}d0`; context.fill();
  });
  context.restore();
  context.lineJoin = 'round';
  placements.forEach((placement, index) => {
    tracePolygon(context, outlines[index], scale);
    context.strokeStyle = 'rgba(255,255,255,0.9)'; context.lineWidth = Math.max(1.5, scale * 0.9); context.stroke();
    context.strokeStyle = shade(colors[placement.name] ?? '#777777', -0.35); context.lineWidth = Math.max(1, scale * 0.45); context.stroke();
  });
  // Texte lisible à l'écran (≈ 9 px affichés au minimum), quelle que soit la taille d'affichage du canvas.
  const displayWidth = canvas.clientWidth || canvas.parentElement?.clientWidth || 800;
  const minSize = 9 * canvas.width / displayWidth; const maxSize = minSize * 2;
  const frames = outlines.map((outline) => labelFrame(outline, scale));
  // Même style pour toutes les pièces : les noms seulement s'ils tiennent partout.
  const named = placements.every((placement, index) => namedLabelSize(context, placement, frames[index], maxSize) >= minSize);
  placements.forEach((placement, index) => drawPieceLabel(context, placement, frames[index], { named, minSize, maxSize }));
}

/** Assombrit (amount < 0) ou éclaircit une couleur #rrggbb. */
function shade(hex, amount) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const target = amount < 0 ? 0 : 255;
  return `#${channels.map((value) => Math.round(value + (target - value) * Math.abs(amount)).toString(16).padStart(2, '0')).join('')}`;
}

/** D-19 : affiche la photo d'origine avec les coins déjà cliqués et le contour en cours. */
export function drawCropPoints(canvas, sourceCanvas, points) {
  canvas.width = sourceCanvas.width; canvas.height = sourceCanvas.height;
  const context = canvas.getContext('2d');
  context.drawImage(sourceCanvas, 0, 0);
  const unit = Math.max(2, Math.round(Math.max(canvas.width, canvas.height) / 250));
  context.strokeStyle = '#e58b3e'; context.fillStyle = '#e58b3e'; context.lineWidth = unit;
  if (points.length > 1) {
    context.beginPath();
    points.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
    if (points.length === 4) context.closePath();
    context.stroke();
  }
  for (const [x, y] of points) { context.beginPath(); context.arc(x, y, unit * 3, 0, Math.PI * 2); context.fill(); }
}
