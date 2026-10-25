import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_CM, CELL_MM, COLORS, FABRIC, PIECES } from '../src/config.js';
import { buildPieceShapes } from '../src/core/nesting.js';
import { computeSurfaceStats } from '../src/core/stats.js';
import { A4, buildCutPlanPdf, computeTiles, outlineMm, polygonTouchesTile } from '../src/export/pdf.js';
import { rectMask } from './helpers/fixtures.js';

const shapes = buildPieceShapes(PIECES, { cellCm: CELL_CM, rotationStepDeg: 90 });
const place = (name, left, top, angleIndex = 0, pass = 1) => {
  const shape = shapes[name][angleIndex];
  return { name, pass, shape, x: left - shape.minX, y: top - shape.minY };
};

/** Faux jsPDF qui enregistre les appels de dessin. */
class RecorderPdf {
  constructor(options) { this.options = options; this.pages = [[]]; }
  get current() { return this.pages.at(-1); }
  addPage() { this.pages.push([]); }
  getNumberOfPages() { return this.pages.length; }
  lines(segments, x, y, scale, style, closed) { this.current.push({ type: 'lines', segments, x, y, closed }); }
  text(value, x, y) { this.current.push({ type: 'text', value, x, y }); }
  line() {} rect(...args) { this.current.push({ type: 'rect', args }); } addImage(...args) { this.current.push({ type: 'image', args }); }
  setDrawColor() {} setLineWidth() {} setFontSize() {}
}

describe('computeSurfaceStats', () => {
  it('calcule surfaces et taux d’utilisation', () => {
    const gridMask = rectMask(600, 900, [{ x0: 0, y0: 0, x1: 20, y1: 20 }]);
    const placements = [place('BANDE', 100, 100)];
    const stats = computeSurfaceStats({ gridMask, placements, cellCm: CELL_CM });
    assert.equal(stats.totalCm2, 135000);
    assert.equal(stats.defectCm2, 100);
    assert.equal(stats.usedCm2, 464);
    assert.equal(stats.healthyCm2, 134900);
    assert.equal(stats.lostCm2, 134900 - 464);
    assert.ok(Math.abs(stats.usageRatio - 464 / 134900) < 1e-12);
    assert.equal(stats.pieceCount, 1);
    assert.equal(stats.completeKits, 0);
  });

  it('ne divise pas par zéro sur un tissu entièrement défectueux', () => {
    const gridMask = rectMask(4, 4, [{ x0: 0, y0: 0, x1: 4, y1: 4 }]);
    assert.equal(computeSurfaceStats({ gridMask, cellCm: 1 }).usageRatio, 0);
  });
});

describe('computeTiles', () => {
  it('recouvre tout le tissu sans trou ni chevauchement', () => {
    const { tiles, rows, columns } = computeTiles({ fabricWidthMm: 3000, fabricHeightMm: 4500 });
    assert.equal(columns, 16); assert.equal(rows, 17); assert.equal(tiles.length, 272);
    const area = tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
    assert.equal(area, 3000 * 4500);
    for (const tile of tiles) {
      assert.ok(tile.width > 0 && tile.width <= A4.width - 20);
      assert.ok(tile.height > 0 && tile.height <= A4.height - 20);
    }
  });

  it('refuse des marges plus grandes que la page', () => {
    assert.throws(() => computeTiles({ fabricWidthMm: 100, fabricHeightMm: 100, margin: 120 }), RangeError);
  });
});

describe('buildCutPlanPdf', () => {
  it('exporte les contours à l’échelle 1:1 (1 cm de patron = 10 mm)', () => {
    const polygon = outlineMm(place('BANDE', 0, 0), CELL_MM);
    const xs = polygon.map((point) => point[0]); const ys = polygon.map((point) => point[1]);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 580) < 1e-6);
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 80) < 1e-6);
  });

  it('crée une page de synthèse puis une page par tuile', () => {
    const pdf = buildCutPlanPdf(RecorderPdf, { placements: [place('DOS', 10, 10)], completeKits: 0, fabric: FABRIC, cellMm: CELL_MM, colors: COLORS });
    assert.equal(pdf.getNumberOfPages(), 1 + 272);
    assert.equal(pdf.options.format, 'a4');
  });

  it('dessine une pièce sur toutes les pages qu’elle traverse, même sans sommet dedans (régression)', () => {
    // Bande verticale de 58 cm qui traverse entièrement la 2e rangée de pages (277 mm).
    const band = place('BANDE', 40, 50, 1);
    const pdf = buildCutPlanPdf(RecorderPdf, { placements: [band], completeKits: 0, fabric: FABRIC, cellMm: CELL_MM, colors: COLORS });
    const { tiles } = computeTiles({ fabricWidthMm: 3000, fabricHeightMm: 4500 });
    const polygon = outlineMm(band, CELL_MM);
    const expectedPages = tiles.filter((tile) => polygonTouchesTile(polygon, tile)).length;
    const drawnPages = pdf.pages.slice(1).filter((page) => page.some((call) => call.type === 'lines')).length;
    assert.ok(expectedPages >= 2);
    assert.equal(drawnPages, expectedPages);
    assert.ok(pdf.pages.slice(1).every((page) => page.filter((call) => call.type === 'lines').every((call) => call.closed)));
  });

  it('refuse un export vide ou sans jsPDF', () => {
    assert.throws(() => buildCutPlanPdf(RecorderPdf, { placements: [], fabric: FABRIC, cellMm: CELL_MM, colors: COLORS }), RangeError);
    assert.throws(() => buildCutPlanPdf(undefined, { placements: [place('DOS', 0, 0)], fabric: FABRIC, cellMm: CELL_MM, colors: COLORS }), TypeError);
  });

  it('les pièces exportées restent dans le tissu', () => {
    const sleeve = shapes.MANCHE[2];
    const placements = [place('DOS', 0, 0), place('MANCHE', 600 - sleeve.width, 900 - sleeve.height, 2)];
    for (const placement of placements) {
      for (const [x, y] of outlineMm(placement, CELL_MM)) {
        assert.ok(x >= -1e-6 && x <= 3000 + 1e-6 && y >= -1e-6 && y <= 4500 + 1e-6, `${placement.name} déborde (${x}, ${y})`);
      }
    }
  });
});
