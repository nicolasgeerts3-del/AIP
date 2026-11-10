import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CELL_CM, ORIENTATION_MODES, SAFE_CLEARANCE_CELLS } from '../src/config.js';
import { polygonArea, polygonBounds, validatePolygon } from '../src/core/geometry.js';
import { createMask } from '../src/core/mask.js';
import { buildPieceShapes, nestPieces } from '../src/core/nesting.js';
import { DEFAULT_MODEL, MODELS } from '../src/patterns.js';

describe('patrons proposés (src/patterns.js)', () => {
  it('le modèle par défaut est le T-shirt', () => {
    assert.equal(DEFAULT_MODEL, 't-shirt');
    assert.ok(MODELS[DEFAULT_MODEL]);
  });

  for (const [id, model] of Object.entries(MODELS)) {
    it(`${id} : pièces valides, composition et couleurs cohérentes`, () => {
      assert.ok(model.label && model.one && model.many);
      for (const polygon of Object.values(model.pieces)) validatePolygon(polygon);
      for (const [name, count] of Object.entries(model.kit)) {
        assert.ok(model.pieces[name], `${name} sans patron`);
        assert.ok(Number.isInteger(count) && count > 0, `${name} : quantité ${count}`);
        assert.match(model.colors[name], /^#[0-9a-f]{6}$/);
      }
      // Toutes les pièces partent de (0, 0) : la boîte englobante sert de repère.
      for (const [name, polygon] of Object.entries(model.pieces)) {
        const bounds = polygonBounds(polygon);
        assert.ok(Math.abs(bounds.minX) < 1e-9 && Math.abs(bounds.minY) < 1e-9, `${name} ne commence pas en (0, 0)`);
      }
    });

    it(`${id} : un exemplaire complet tient sur 1,2 m × 1,2 m sans chevauchement`, async () => {
      const shapes = buildPieceShapes(model.pieces, { cellCm: CELL_CM, angles: ORIENTATION_MODES['droit-fil'].angles });
      const gridMask = createMask(120 / CELL_CM, 120 / CELL_CM);
      const result = await nestPieces({ gridMask, shapes, kit: model.kit, clearance: SAFE_CLEARANCE_CELLS, maxKits: 1, timeBudgetMs: 0, yieldToUi: async () => {} });
      assert.equal(result.score.completeKits, 1);
      assert.ok(result.validation.ok, result.validation.reason);
    });
  }

  it('dimensions relevées dans les PDF (marges comprises)', () => {
    const size = (polygon) => { const b = polygonBounds(polygon); return [b.maxX - b.minX, b.maxY - b.minY]; };
    assert.deepEqual(size(MODELS['porte-gourde'].pieces.CORPS), [16, 26]);
    assert.ok(Math.abs(polygonArea(MODELS['porte-gourde'].pieces.BASE) - Math.PI * 25) < 1, 'base : disque de 10 cm');
    assert.deepEqual(size(MODELS.portefeuille.pieces.PRINCIPALE), [16, 22]); // 8 × 22 au pli, dépliée
    // Porte-monnaie : grand côté de 19,5 cm aligné sur le droit-fil (vertical).
    const [a, , , d] = MODELS['porte-monnaie'].pieces['PORTE-MONNAIE'];
    assert.ok(Math.abs(a[0] - d[0]) < 0.05 && Math.abs(Math.hypot(d[0] - a[0], d[1] - a[1]) - 19.5) < 0.1);
    // Pièces scannées : à 3 mm près.
    const [dosWidth, dosHeight] = size(MODELS['sac-banane'].pieces.DOS);
    assert.ok(Math.abs(dosWidth - 35.6) < 0.3 && Math.abs(dosHeight - 17.1) < 0.3, `dos ${dosWidth} × ${dosHeight}`);
    const [bodyWidth, bodyHeight] = size(MODELS.monstre.pieces.CORPS);
    assert.ok(Math.abs(bodyWidth - 12.5) < 0.3 && Math.abs(bodyHeight - 14.3) < 0.3, `corps ${bodyWidth} × ${bodyHeight}`);
  });
});
