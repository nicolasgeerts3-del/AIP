// Projection du plan sur le tissu (D-24). Le projecteur affiche une fenêtre
// plein écran ; l'utilisateur place ses 4 coins sur les 4 coins réels du
// tissu. L'homographie tissu (cm) → écran (px) ainsi définie corrige à la fois
// l'échelle, la position, la rotation et la déformation trapézoïdale du
// projecteur (et même un éventuel effet miroir).
// Coins : [haut-gauche, haut-droit, bas-droit, bas-gauche] du tissu, dans le
// repère du plan (x vers la droite, y vers le bas, origine en haut à gauche).
import { placementOutline } from './geometry.js';
import { componentBounds } from './mask.js';
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
      polygon: placementOutline(placement).map(([x, y]) => [x * cellCm, y * cellCm])
    })),
    defects: gridMask ? componentBounds(gridMask).map(({ x0, y0, x1, y1 }) => ({ x0: x0 * cellCm, y0: y0 * cellCm, x1: x1 * cellCm, y1: y1 * cellCm })) : []
  };
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
