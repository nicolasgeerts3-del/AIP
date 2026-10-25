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

/** Plan de découpe : une cellule de grille = un pixel du canvas. */
export function drawPlan(canvas, { imageCanvas, gridMask, placements, colors }) {
  const { width, height } = gridMask;
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f5f5ed'; context.fillRect(0, 0, width, height);
  if (imageCanvas) { context.globalAlpha = 0.75; context.drawImage(imageCanvas, 0, 0, width, height); context.globalAlpha = 1; }

  const overlay = new ImageData(width, height);
  for (let index = 0; index < gridMask.data.length; index += 1) {
    if (!gridMask.data[index]) continue;
    overlay.data.set([217, 66, 66, 128], index * 4);
  }
  const layer = document.createElement('canvas');
  layer.width = width; layer.height = height;
  layer.getContext('2d').putImageData(overlay, 0, 0);
  context.drawImage(layer, 0, 0);

  context.font = '8px Manrope, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  for (const placement of placements) {
    const polygon = placementOutline(placement);
    context.beginPath();
    polygon.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
    context.closePath();
    context.fillStyle = `${colors[placement.name]}99`; context.fill();
    context.strokeStyle = colors[placement.name]; context.lineWidth = 1.5; context.setLineDash([3, 3]); context.stroke(); context.setLineDash([]);
    const box = polygonBounds(polygon);
    context.fillStyle = '#202623';
    context.fillText(`${placement.name} #${placement.pass}`, (box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2);
  }
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
