import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_CM, PIECES } from '../src/config.js';
import { placementOutline, pointInPolygon, polygonArea, polygonBounds, rasterizePiece, validatePolygon } from '../src/core/geometry.js';

const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

describe('polygones', () => {
  it('polygonArea calcule l’aire quel que soit le sens de parcours', () => {
    assert.equal(polygonArea(square), 100);
    assert.equal(polygonArea([...square].reverse()), 100);
    assert.equal(polygonArea(PIECES.BANDE), 58 * 8);
  });

  it('pointInPolygon distingue intérieur et extérieur, y compris pour une forme concave', () => {
    assert.ok(pointInPolygon(5, 5, square));
    assert.ok(!pointInPolygon(15, 5, square));
    // Encolure du DOS : creux entre (22,70) et (30,70), sommet à y = 73.
    assert.ok(!pointInPolygon(26, 72, PIECES.DOS));
    assert.ok(pointInPolygon(26, 60, PIECES.DOS));
  });

  it('validatePolygon refuse les patrons dégénérés', () => {
    assert.throws(() => validatePolygon([[0, 0], [1, 1]]), TypeError);
    assert.throws(() => validatePolygon([[0, 0], [1, 1], [2, 2]]), RangeError);
    assert.throws(() => validatePolygon([[0, 0], [1, Number.NaN], [2, 0]]), TypeError);
    for (const polygon of Object.values(PIECES)) validatePolygon(polygon);
  });
});

describe('rasterizePiece', () => {
  for (const [name, polygon] of Object.entries(PIECES)) {
    for (const angle of [0, 15, 45, 90, 135, 270, 345]) {
      it(`${name} à ${angle}° : cellules et contour dans le même repère`, () => {
        const shape = rasterizePiece(polygon, angle, CELL_CM);
        const outlineBox = polygonBounds(shape.outline);
        // Le contour tient dans la boîte des cellules (régression : décalage de 26 × 55 cm).
        assert.ok(outlineBox.minX >= shape.minX - 1e-6 && outlineBox.maxX <= shape.minX + shape.width + 1e-6);
        assert.ok(outlineBox.minY >= shape.minY - 1e-6 && outlineBox.maxY <= shape.minY + shape.height + 1e-6);

        // Toute cellule dont le centre est dans le contour fait partie de la forme.
        const included = new Set(shape.offsets);
        for (let row = 0; row < shape.height; row += 1) {
          for (let column = 0; column < shape.width; column += 1) {
            if (pointInPolygon(shape.minX + column + 0.5, shape.minY + row + 0.5, shape.outline)) {
              assert.ok(included.has(row * shape.width + column), `cellule (${column}, ${row}) manquante`);
            }
          }
        }
        // Rastérisation conservatrice : un peu plus grande que le patron, jamais beaucoup plus.
        const rasterArea = shape.cellCount * CELL_CM * CELL_CM;
        assert.ok(rasterArea >= shape.areaCm2 * 0.98, `${rasterArea} < ${shape.areaCm2}`);
        assert.ok(rasterArea <= shape.areaCm2 * 1.25, `${rasterArea} ≫ ${shape.areaCm2}`);
        assert.equal(shape.rows.reduce((sum, row) => sum + row.length, 0), shape.cellCount);
      });
    }
  }

  it('les sommets du contour tombent dans des cellules de la forme', () => {
    const shape = rasterizePiece(PIECES.MANCHE, 30, CELL_CM);
    const included = new Set(shape.offsets);
    for (const [x, y] of shape.outline) {
      const column = Math.min(shape.width - 1, Math.floor(x) - shape.minX);
      const row = Math.min(shape.height - 1, Math.floor(y) - shape.minY);
      assert.ok(included.has(row * shape.width + column));
    }
  });

  it('une rotation de 90° échange largeur et hauteur', () => {
    const flat = rasterizePiece(PIECES.BANDE, 0, CELL_CM);
    const upright = rasterizePiece(PIECES.BANDE, 90, CELL_CM);
    assert.equal(flat.width, 116); assert.equal(flat.height, 16);
    assert.equal(upright.width, 16); assert.equal(upright.height, 116);
    assert.equal(flat.cellCount, upright.cellCount);
  });

  it('refuse une taille de cellule invalide', () => {
    assert.throws(() => rasterizePiece(square, 0, 0), RangeError);
  });
});

describe('placementOutline', () => {
  it('décale le contour de l’origine du placement', () => {
    const shape = rasterizePiece(square, 0, 1);
    const outline = placementOutline({ shape, x: 100, y: 50 });
    const box = polygonBounds(outline);
    assert.deepEqual(box, { minX: 95, minY: 45, maxX: 105, maxY: 55 });
    assert.equal(100 + shape.minX, 95);
  });
});
