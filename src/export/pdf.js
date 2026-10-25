// Export PDF : une page de synthèse puis le plan à l'échelle 1:1 découpé en pages A4.
import { placementOutline, polygonBounds } from '../core/geometry.js';

export const A4 = Object.freeze({ width: 210, height: 297 });

/** Découpe le tissu (en mm) en tuiles qui tiennent dans la zone imprimable d'une page. */
export function computeTiles({ fabricWidthMm, fabricHeightMm, page = A4, margin = 10 }) {
  const tileWidth = page.width - 2 * margin; const tileHeight = page.height - 2 * margin;
  if (!(tileWidth > 0 && tileHeight > 0)) throw new RangeError('Marges trop grandes pour la page');
  const columns = Math.ceil(fabricWidthMm / tileWidth); const rows = Math.ceil(fabricHeightMm / tileHeight);
  const tiles = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * tileWidth; const y = row * tileHeight;
      tiles.push({ row, column, x, y, width: Math.min(tileWidth, fabricWidthMm - x), height: Math.min(tileHeight, fabricHeightMm - y) });
    }
  }
  return { tiles, rows, columns, margin };
}

/** Contour d'une pièce placée, en mm depuis le coin haut-gauche du tissu. */
export function outlineMm(placement, cellMm) {
  return placementOutline(placement).map(([x, y]) => [x * cellMm, y * cellMm]);
}

/** Vrai si la boîte du polygone recoupe la tuile (un contour peut traverser une page sans y avoir de sommet). */
export function polygonTouchesTile(polygon, tile) {
  const box = polygonBounds(polygon);
  return box.maxX >= tile.x && box.minX <= tile.x + tile.width && box.maxY >= tile.y && box.minY <= tile.y + tile.height;
}

function drawCropMarks(pdf, x, y, width, height) {
  const size = 4;
  pdf.setDrawColor(80); pdf.setLineWidth(0.2);
  for (const [cx, cy] of [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]) {
    pdf.line(cx - size, cy, cx + size, cy); pdf.line(cx, cy - size, cx, cy + size);
  }
}

function drawClosedPolygon(pdf, polygon) {
  const segments = polygon.slice(1).map((point, index) => [point[0] - polygon[index][0], point[1] - polygon[index][1]]);
  pdf.lines(segments, polygon[0][0], polygon[0][1], [1, 1], 'S', true);
}

/**
 * Construit le document. `JsPdf` est le constructeur jsPDF (injecté pour
 * pouvoir tester sans navigateur). Renvoie l'instance, prête pour .save().
 */
export function buildCutPlanPdf(JsPdf, { placements, overviewPng, completeKits, fabric, cellMm, colors, margin = 10 }) {
  if (typeof JsPdf !== 'function') throw new TypeError('Bibliothèque jsPDF indisponible');
  if (!placements.length) throw new RangeError('Aucune pièce à exporter');
  const fabricWidthMm = fabric.widthCm * 10; const fabricHeightMm = fabric.heightCm * 10;
  const pdf = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  pdf.setFontSize(16); pdf.text('ReTiss — plan de découpe 1:1', 15, 18);
  pdf.setFontSize(10); pdf.text(`${completeKits} T-shirts complets · ${placements.length} pièces · tissu ${(fabric.widthCm / 100).toFixed(2)} m × ${(fabric.heightCm / 100).toFixed(2)} m`, 15, 26);
  if (overviewPng) pdf.addImage(overviewPng, 'PNG', 15, 35, 80, 80 * fabric.heightCm / fabric.widthCm);
  pdf.setDrawColor(0); pdf.setLineWidth(0.3); pdf.rect(15, 165, 100, 100);
  pdf.setFontSize(9); pdf.text('Carré témoin 10 cm × 10 cm — vérifier : ce carré doit mesurer 10 cm à l’impression', 15, 272);

  const outlines = placements.map((placement) => ({ placement, polygon: outlineMm(placement, cellMm) }));
  const { tiles } = computeTiles({ fabricWidthMm, fabricHeightMm, margin });
  for (const tile of tiles) {
    pdf.addPage();
    for (const { placement, polygon } of outlines) {
      if (!polygonTouchesTile(polygon, tile)) continue;
      const local = polygon.map(([x, y]) => [x - tile.x + margin, y - tile.y + margin]);
      pdf.setDrawColor(colors[placement.name] ?? '#000000'); pdf.setLineWidth(0.3);
      drawClosedPolygon(pdf, local);
      const box = polygonBounds(local);
      const labelX = (box.minX + box.maxX) / 2; const labelY = (box.minY + box.maxY) / 2;
      if (labelX >= margin && labelX <= margin + tile.width && labelY >= margin && labelY <= margin + tile.height) {
        pdf.setFontSize(8); pdf.text(`${placement.name} #${placement.pass}`, labelX, labelY, { align: 'center' });
      }
    }
    drawCropMarks(pdf, margin, margin, tile.width, tile.height);
    pdf.setFontSize(8); pdf.text(`ReTiss — page L${tile.row + 1}C${tile.column + 1} — échelle 1:1`, 15, A4.height - 4);
  }
  return pdf;
}
