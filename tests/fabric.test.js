import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_MM, COLORS, ORIENTATION_MODES, PIECES } from '../src/config.js';
import { fabricWithRatio, formatFabric, gridForFabric, validateFabric } from '../src/core/fabric.js';
import { quadRatio } from '../src/core/perspective.js';
import { createMask } from '../src/core/mask.js';
import { buildPieceShapes, nestPieces } from '../src/core/nesting.js';
import { buildCutPlanPdf, overviewBox } from '../src/export/pdf.js';

describe('[D-20] taille du tissu', () => {
  it('[D-20] accepte une taille valide et l’arrondit au demi-centimètre', () => {
    assert.deepEqual({ ...validateFabric({ widthCm: '150', heightCm: 225.3 }) }, { widthCm: 150, heightCm: 225.5 });
  });

  it('[D-20] refuse une saisie vide, non numérique ou hors limites', () => {
    assert.throws(() => validateFabric({ widthCm: 'abc', heightCm: 200 }), /Largeur/);
    assert.throws(() => validateFabric({ widthCm: 300, heightCm: '' }), /Longueur/);
    assert.throws(() => validateFabric({ widthCm: 10, heightCm: 200 }), /hors limites/);
    assert.throws(() => validateFabric({ widthCm: 300, heightCm: 5000 }), /hors limites/);
  });

  it('[D-20] la grille suit la taille du tissu (1 cellule = 5 mm)', () => {
    assert.deepEqual(gridForFabric({ widthCm: 300, heightCm: 450 }), { width: 600, height: 900 });
    assert.deepEqual(gridForFabric({ widthCm: 150, heightCm: 80.5 }), { width: 300, height: 161 });
  });

  it('[D-20] affiche la taille en mètres', () => {
    assert.equal(formatFabric({ widthCm: 300, heightCm: 450 }), '3,00 m × 4,50 m');
    assert.equal(formatFabric({ widthCm: 145, heightCm: 80.5 }), '1,45 m × 0,81 m');
  });

  it('[D-20] la vignette du PDF tient dans la page quelle que soit la forme du tissu', () => {
    for (const fabric of [{ widthCm: 300, heightCm: 450 }, { widthCm: 100, heightCm: 1000 }, { widthCm: 1000, heightCm: 50 }]) {
      const box = overviewBox(fabric);
      assert.ok(box.width <= 180 + 1e-9 && box.height <= 120 + 1e-9, JSON.stringify(box));
      assert.ok(Math.abs(box.width / box.height - fabric.widthCm / fabric.heightCm) < 1e-9, 'proportions déformées');
    }
  });

  it('[D-20] nesting et PDF sur un coupon de 1,50 × 2,25 m', async () => {
    const fabric = validateFabric({ widthCm: 150, heightCm: 225 });
    const grid = gridForFabric(fabric);
    const shapes = buildPieceShapes(PIECES, { cellCm: 0.5, angles: ORIENTATION_MODES['droit-fil'].angles });
    const result = await nestPieces({ gridMask: createMask(grid.width, grid.height), shapes, yieldToUi: async () => {} });
    assert.ok(result.validation.ok);
    assert.ok(result.score.completeKits >= 1);

    const pages = [];
    class CountingPdf {
      constructor() { pages.push(1); }
      addPage() { pages.push(1); } getNumberOfPages() { return pages.length; }
      text() {} lines() {} line() {} rect() {} addImage() {} setDrawColor() {} setLineWidth() {} setFontSize() {}
    }
    const pdf = buildCutPlanPdf(CountingPdf, { placements: result.placements, completeKits: 1, fabric, cellMm: CELL_MM, colors: COLORS });
    // 1500 mm / 190 mm → 8 colonnes, 2250 mm / 277 mm → 9 rangées, plus la synthèse.
    assert.equal(pdf.getNumberOfPages(), 8 * 9 + 1);
  });
});

describe('[D-29] proportions du plan = proportions de la photo', () => {
  it('[D-29] garde la largeur et calcule la longueur d’après la photo', () => {
    assert.deepEqual({ ...fabricWithRatio(300, 1.5) }, { widthCm: 300, heightCm: 200 });
    assert.deepEqual({ ...fabricWithRatio(300, 2 / 3) }, { widthCm: 300, heightCm: 450 });
  });

  it('[D-29] réduit les deux côtés ensemble si la longueur dépasse la limite', () => {
    const fabric = fabricWithRatio(300, 0.25);
    assert.equal(fabric.heightCm, 1000);
    assert.equal(fabric.widthCm, 250);
  });

  it('[D-29] refuse des proportions invalides', () => {
    assert.throws(() => fabricWithRatio(300, 0), RangeError);
    assert.throws(() => fabricWithRatio(300, Number.NaN), RangeError);
  });

  it('[D-29] quadRatio estime les proportions d’un tissu photographié en biais', () => {
    assert.ok(Math.abs(quadRatio([[0, 0], [300, 0], [300, 200], [0, 200]]) - 1.5) < 1e-9);
    const trapezoid = quadRatio([[60, 40], [330, 70], [360, 420], [30, 380]]);
    assert.ok(trapezoid > 0.7 && trapezoid < 0.9, String(trapezoid));
  });
});
