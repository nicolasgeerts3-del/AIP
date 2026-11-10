// Projection du plan sur le tissu (D-24). Le projecteur affiche une fenêtre
// plein écran ; l'utilisateur place ses 4 coins sur les 4 coins réels du
// tissu. L'homographie tissu (cm) → écran (px) ainsi définie corrige à la fois
// l'échelle, la position, la rotation et la déformation trapézoïdale du
// projecteur (et même un éventuel effet miroir).
// Coins : [haut-gauche, haut-droit, bas-droit, bas-gauche] du tissu, dans le
// repère du plan (x vers la droite, y vers le bas, origine en haut à gauche).
import { placementOutline } from './geometry.js';
import { maskContours } from './mask.js';
import { applyHomography, computeHomography } from './perspective.js';

/** Message envoyé à la fenêtre de projection : tout en centimètres, sans référence aux formes internes. */
export function planForProjection({ placements, gridMask, fabric, cellCm, colors }) {
  return {
    type: 'plan',
    fabric: { widthCm: fabric.widthCm, heightCm: fabric.heightCm },
    pieces: placements.map((placement) => ({
      name: placement.name,
      pass: placement.pass,
      color: colors[placement.name] ?? '#ffffff',
      angle: placement.shape.angle ?? 0, // rotation de la pièce : le droit-fil du patron est vertical à 0°
      polygon: placementOutline(placement).map(([x, y]) => [x * cellCm, y * cellCm])
    })),
    // D-55 : contour réel de chaque défaut (polygones fermés), pas sa boîte englobante.
    defects: gridMask ? maskContours(gridMask).map((loop) => loop.map(([x, y]) => [x * cellCm, y * cellCm])) : []
  };
}

/** Centre de gravité d'un polygone (repli sur la moyenne des sommets si la surface est nulle). */
export function polygonCentroid(polygon) {
  let twice = 0; let cx = 0; let cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const cross = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    twice += cross; cx += (polygon[j][0] + polygon[i][0]) * cross; cy += (polygon[j][1] + polygon[i][1]) * cross;
  }
  if (Math.abs(twice) < 1e-9) return [polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length, polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length];
  return [cx / (3 * twice), cy / (3 * twice)];
}

/**
 * Ordre de découpe guidée : par bandes de `bandCm` de haut, de gauche à droite
 * puis de droite à gauche (en serpentin), pour limiter les déplacements autour
 * de la table. Renvoie les indices des pièces.
 */
export function cuttingOrder(pieces, bandCm = 40) {
  const centers = pieces.map((piece) => polygonCentroid(piece.polygon));
  return pieces.map((_, index) => index).sort((i, j) => {
    const bandI = Math.floor(centers[i][1] / bandCm); const bandJ = Math.floor(centers[j][1] / bandCm);
    if (bandI !== bandJ) return bandI - bandJ;
    return bandI % 2 === 0 ? centers[i][0] - centers[j][0] : centers[j][0] - centers[i][0];
  });
}

/**
 * Flèche du droit-fil d'une pièce, en cm : segment [[x1, y1], [x2, y2]] centré
 * sur la pièce, parallèle à la longueur du tissu une fois la pièce tournée.
 * `shift` la décale sur le côté (fraction de la largeur) pour dégager l'étiquette.
 */
export function grainLine(piece, fraction = 0.45, shift = 0) {
  const [cx, cy] = polygonCentroid(piece.polygon);
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const [x, y] of piece.polygon) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const radians = (piece.angle ?? 0) * Math.PI / 180;
  const dx = -Math.sin(radians); const dy = Math.cos(radians);
  const half = fraction / 2 * (Math.abs(dx) * (maxX - minX) + Math.abs(dy) * (maxY - minY));
  const across = shift * (Math.abs(dy) * (maxX - minX) + Math.abs(dx) * (maxY - minY));
  const ox = cx - dy * across; const oy = cy + dx * across;
  return [[ox - dx * half, oy - dy * half], [ox + dx * half, oy + dy * half]];
}

/** Coins par défaut : le tissu centré dans l'écran, proportions conservées, avec une marge. */
export function defaultCorners(fabric, screen, marginFraction = 0.05) {
  const usableWidth = screen.width * (1 - 2 * marginFraction); const usableHeight = screen.height * (1 - 2 * marginFraction);
  const scale = Math.min(usableWidth / fabric.widthCm, usableHeight / fabric.heightCm);
  const width = fabric.widthCm * scale; const height = fabric.heightCm * scale;
  const left = (screen.width - width) / 2; const top = (screen.height - height) / 2;
  return [[left, top], [left + width, top], [left + width, top + height], [left, top + height]];
}

/** Homographie tissu (cm) → écran (px). */
export function projectionMatrix(fabric, corners) {
  const { widthCm: w, heightCm: h } = fabric;
  return computeHomography([[0, 0], [w, 0], [w, h], [0, h]], corners);
}

export function projectPoints(matrix, points) {
  return points.map(([x, y]) => applyHomography(matrix, x, y));
}

/** Les 4 coins forment-ils un quadrilatère non croisé et non plat (dans un sens ou dans l'autre, miroir accepté) ? */
export function isUsableQuad(corners, minArea = 400) {
  if (!Array.isArray(corners) || corners.length !== 4 || !corners.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return false;
  const crosses = [];
  for (let i = 0; i < 4; i += 1) {
    const [a, b, c] = [corners[i], corners[(i + 1) % 4], corners[(i + 2) % 4]];
    crosses.push((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
  }
  const convex = crosses.every((value) => value > 0) || crosses.every((value) => value < 0);
  let twiceArea = 0;
  for (let i = 0, j = 3; i < 4; j = i++) twiceArea += corners[j][0] * corners[i][1] - corners[i][0] * corners[j][1];
  return convex && Math.abs(twiceArea) / 2 >= minArea;
}

/** Indice du coin le plus proche de `point`, ou -1 au-delà de maxDistance px. */
export function nearestCorner(corners, point, maxDistance = 40) {
  let best = -1; let bestDistance = maxDistance;
  corners.forEach(([x, y], index) => {
    const distance = Math.hypot(x - point[0], y - point[1]);
    if (distance <= bestDistance) { best = index; bestDistance = distance; }
  });
  return best;
}

/** Nouveaux coins avec le coin `index` déplacé ; refuse un déplacement qui rendrait le quadrilatère inutilisable. */
export function moveCorner(corners, index, x, y) {
  const next = corners.map((corner, i) => (i === index ? [x, y] : [...corner]));
  return isUsableQuad(next) ? next : corners;
}

/**
 * Mire de contrôle, en cm : bord du tissu, quadrillage tous les `stepCm`, et
 * un carré témoin de 10 × 10 cm dans le coin haut-gauche pour vérifier
 * l'échelle au mètre ruban. Renvoie des segments [[x1, y1], [x2, y2]].
 */
export function calibrationPattern(fabric, stepCm = 50) {
  const { widthCm: w, heightCm: h } = fabric;
  const grid = [];
  for (let x = stepCm; x < w; x += stepCm) grid.push([[x, 0], [x, h]]);
  for (let y = stepCm; y < h; y += stepCm) grid.push([[0, y], [w, y]]);
  const border = [[[0, 0], [w, 0]], [[w, 0], [w, h]], [[w, h], [0, h]], [[0, h], [0, 0]]];
  const side = Math.min(10, w, h);
  const square = [[[0, 0], [side, 0]], [[side, 0], [side, side]], [[side, side], [0, side]], [[0, side], [0, 0]]];
  return { grid, border, square };
}

/** Taille d'un pixel du projecteur sur le tissu, en mm (le plus grand des deux axes), pour informer l'utilisateur. */
export function pixelSizeMm(fabric, corners) {
  const [tl, tr, br, bl] = corners;
  const widthPx = (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
  const heightPx = (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2;
  return Math.max(fabric.widthCm * 10 / widthPx, fabric.heightCm * 10 / heightPx);
}
