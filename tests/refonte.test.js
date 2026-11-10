// Refonte D-54 à D-60 : traits fins, contours des défauts, matières, découpe guidée.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_CM, DEFAULT_MATERIAL, DEFAULT_QUANTITY, MATERIALS, materialAngles } from '../src/config.js';
import { computeColorPlanes, detectDefects } from '../src/core/detection.js';
import { pointInPolygon, polygonArea } from '../src/core/geometry.js';
import { countMask, createMask, filterComponents, maskContours } from '../src/core/mask.js';
import { buildPieceShapes, nestPieces } from '../src/core/nesting.js';
import { cuttingOrder, grainLine, planForProjection, polygonCentroid } from '../src/core/projection.js';
import { MODELS } from '../src/patterns.js';
import { fabricImage, rectMask, seededRandom } from './helpers/fixtures.js';

/** Tissu blanc légèrement bruité avec un trait de crayon gris d'un pixel de large, en biais. */
function pencilImage(width, height, { lineValue = 205, noise = 3 } = {}) {
  const image = fabricImage(width, height, { base: [244, 244, 246], noise, seed: 11 });
  const random = seededRandom(5);
  const line = [];
  for (let x = 30; x < width - 30; x += 1) {
    const y = Math.round(40 + (x - 30) * 0.45);
    const out = (y * width + x) * 4; const value = lineValue + (random() - 0.5) * noise;
    image.data[out] = value; image.data[out + 1] = value; image.data[out + 2] = value;
    line.push([x, y]);
  }
  return { image, line };
}

describe('[D-54] détection des traits fins', () => {
  it('détecte un trait de crayon d’un pixel de large, sur toute sa longueur', () => {
    const { image, line } = pencilImage(240, 180);
    const { mask } = detectDefects(computeColorPlanes(image));
    const covered = line.filter(([x, y]) => mask.data[y * mask.width + x]).length;
    assert.ok(covered / line.length > 0.95, `seulement ${covered}/${line.length} points du trait détectés`);
  });

  it('ne marque rien loin du trait, à toutes les sensibilités du curseur', () => {
    const { image, line } = pencilImage(240, 180);
    const planes = computeColorPlanes(image);
    for (const madFactor of [2, 3.5, 5, 7]) {
      const { mask } = detectDefects(planes, { madFactor });
      let stray = 0;
      for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
          if (mask.data[y * mask.width + x] && Math.abs(y - (40 + (x - 30) * 0.45)) > 6) stray += 1;
        }
      }
      assert.equal(stray, 0, `sensibilité ${madFactor} : ${stray} pixels marqués loin du trait`);
      assert.ok(line.filter(([x, y]) => mask.data[y * mask.width + x]).length / line.length > 0.8, `sensibilité ${madFactor} : trait perdu`);
    }
  });

  it('un tissu blanc sans défaut reste vide, même au réglage le plus sensible', () => {
    const planes = computeColorPlanes(fabricImage(200, 160, { base: [244, 244, 246], noise: 4, seed: 3 }));
    for (const madFactor of [2, 3.5, 7]) assert.equal(countMask(detectDefects(planes, { madFactor }).mask), 0, `sensibilité ${madFactor}`);
  });

  it('filterComponents garde les composantes choisies', () => {
    const mask = rectMask(20, 10, [{ x0: 1, y0: 1, x1: 3, y1: 3 }, { x0: 8, y0: 2, x1: 16, y1: 8 }]);
    assert.equal(countMask(filterComponents(mask, (cells) => cells.length > 10)), 48);
  });
});

describe('[D-55] contour réel des défauts', () => {
  it('maskContours suit la forme : un L n’est pas un rectangle', () => {
    const mask = rectMask(12, 12, [{ x0: 2, y0: 2, x1: 4, y1: 10 }, { x0: 4, y0: 8, x1: 10, y1: 10 }]);
    const [loop] = maskContours(mask, 0);
    assert.equal(loop.length, 6);
    assert.equal(polygonArea(loop), countMask(mask));
    assert.ok(!pointInPolygon(7, 4, loop), 'le creux du L ne fait pas partie du défaut');
  });

  it('un anneau donne un contour extérieur et un trou ; un masque vide ne donne rien', () => {
    const ring = rectMask(10, 10, [{ x0: 2, y0: 2, x1: 8, y1: 8 }]);
    for (let y = 4; y < 6; y += 1) for (let x = 4; x < 6; x += 1) ring.data[y * 10 + x] = 0;
    assert.deepEqual(maskContours(ring, 0).map((loop) => polygonArea(loop)).sort((a, b) => a - b), [4, 36]);
    assert.deepEqual(maskContours(createMask(5, 5)), []);
  });

  it('la simplification reste proche du contour exact', () => {
    const mask = createMask(80, 80);
    for (let y = 0; y < 80; y += 1) for (let x = 0; x < 80; x += 1) if ((x - 40) ** 2 + (y - 40) ** 2 < 30 ** 2) mask.data[y * 80 + x] = 1;
    const [exact] = maskContours(mask, 0); const [simple] = maskContours(mask, 0.75);
    assert.ok(simple.length < exact.length / 2, `${simple.length} sommets au lieu de ${exact.length}`);
    assert.ok(Math.abs(polygonArea(simple) - polygonArea(exact)) / polygonArea(exact) < 0.03);
  });

  it('planForProjection transmet un trait en biais sans recouvrir le tissu sain autour', () => {
    const mask = createMask(60, 60);
    for (let i = 5; i < 55; i += 1) { mask.data[i * 60 + i] = 1; mask.data[i * 60 + i + 1] = 1; }
    const { defects } = planForProjection({ placements: [], gridMask: mask, fabric: { widthCm: 30, heightCm: 30 }, cellCm: CELL_CM, colors: {} });
    const area = defects.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
    // La boîte englobante ferait 25 × 25 cm = 625 cm² ; le contour réel en fait moins de 40.
    assert.ok(area < 40, `surface projetée : ${area} cm²`);
    assert.ok(defects.every((polygon) => !pointInPolygon(22, 6, polygon)), 'un coin sain est marqué comme défaut');
  });
});

describe('[D-56][D-57] matières et quantité', () => {
  it('chaque matière est complète ; un tissu à poil n’autorise qu’un sens', () => {
    assert.ok(MATERIALS[DEFAULT_MATERIAL]);
    assert.equal(DEFAULT_QUANTITY, 1);
    for (const [id, material] of Object.entries(MATERIALS)) {
      assert.ok(material.label && material.tip, id);
      assert.ok(Number.isInteger(material.clearanceCells) && material.clearanceCells >= 2, `${id} : marge`);
      assert.ok(material.texture >= 1, `${id} : texture`);
      assert.deepEqual(materialAngles(material), material.oneWay ? [0] : [0, 180]);
    }
    assert.ok(MATERIALS.velours.oneWay && !MATERIALS.coton.oneWay);
  });

  it('une quantité demandée limite le plan à ce nombre d’exemplaires', async () => {
    const model = MODELS.portefeuille;
    const shapes = buildPieceShapes(model.pieces, { cellCm: CELL_CM, angles: materialAngles(MATERIALS.velours) });
    const gridMask = createMask(300, 300);
    for (const quantity of [1, 3]) {
      const result = await nestPieces({ gridMask, shapes, kit: model.kit, clearance: MATERIALS.velours.clearanceCells, maxKits: quantity, yieldToUi: async () => {} });
      assert.equal(result.score.completeKits, quantity);
      assert.ok(result.validation.ok);
      assert.ok(result.placements.every((placement) => placement.shape.angle === 0), 'velours : toutes les pièces dans le même sens');
    }
  });
});

describe('[D-60] découpe guidée', () => {
  const square = (x, y, angle = 0) => ({ name: 'A', pass: 1, angle, polygon: [[x, y], [x + 10, y], [x + 10, y + 20], [x, y + 20]] });

  it('cuttingOrder parcourt le tissu en serpentin, bande par bande', () => {
    const pieces = [square(100, 0), square(0, 0), square(50, 0), square(0, 50), square(100, 50)];
    assert.deepEqual(cuttingOrder(pieces), [1, 2, 0, 4, 3]);
  });

  it('grainLine suit la longueur du tissu et reste dans la pièce', () => {
    const piece = square(10, 10);
    const [from, to] = grainLine(piece);
    assert.equal(from[0], to[0]);
    assert.ok(Math.abs(Math.abs(to[1] - from[1]) - 9) < 1e-9);
    assert.ok(pointInPolygon(...from, piece.polygon) && pointInPolygon(...to, piece.polygon));
    const flipped = grainLine(square(10, 10, 180));
    assert.ok(Math.abs(flipped[0][0] - flipped[1][0]) < 1e-9, 'une pièce retournée garde un droit-fil vertical');
    assert.deepEqual(polygonCentroid(piece.polygon), [15, 20]);
  });
});
