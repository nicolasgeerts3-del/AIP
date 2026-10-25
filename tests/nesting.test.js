import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_CM, KIT, PIECES, SAFE_CLEARANCE_CELLS, STRATEGIES } from '../src/config.js';
import { placementOutline, pointInPolygon, polygonBounds } from '../src/core/geometry.js';
import { createMask, dilate } from '../src/core/mask.js';
import {
  buildIntegral, buildPieceShapes, collectAnchors, collides, countCompleteKits, estimateMaxKits, findPlacement,
  isBetterScore, MAX_DEFECT_ANCHORS, nestPieces, scorePlan, shapeBox, stampPiece, validatePlan
} from '../src/core/nesting.js';
import { randomMask, rectMask, seededRandom } from './helpers/fixtures.js';

/** Grille 600 × 900 parsemée de `count` taches de 3 × 3 cellules (1,5 cm). */
function speckledGrid(count, seed = 1) {
  const random = seededRandom(seed);
  const rects = Array.from({ length: count }, () => {
    const x0 = Math.floor(random() * 597); const y0 = Math.floor(random() * 897);
    return { x0, y0, x1: x0 + 3, y1: y0 + 3 };
  });
  return rectMask(600, 900, rects);
}

// Pas de 90° pour garder les tests rapides ; le pas de 15° est testé en bout de chaîne (e2e).
const shapes = buildPieceShapes(PIECES, { cellCm: CELL_CM, rotationStepDeg: 90 });
const instant = async () => {};

/** Vérification géométrique indépendante : aucune cellule défectueuse sous le contour d'une pièce. */
function assertOutlinesAvoidDefects(placements, gridMask) {
  for (const placement of placements) {
    const outline = placementOutline(placement);
    const box = polygonBounds(outline);
    for (let y = Math.floor(box.minY); y < Math.ceil(box.maxY); y += 1) {
      for (let x = Math.floor(box.minX); x < Math.ceil(box.maxX); x += 1) {
        if (!gridMask.data[y * gridMask.width + x]) continue;
        for (const [px, py] of [[x + 0.5, y + 0.5], [x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
          assert.ok(!pointInPolygon(px, py, outline), `${placement.name} recouvre le défaut (${x}, ${y})`);
        }
      }
    }
  }
}

describe('buildPieceShapes', () => {
  it('crée 360 / pas orientations par pièce', () => {
    assert.equal(shapes.DOS.length, 4);
    assert.equal(buildPieceShapes({ BANDE: PIECES.BANDE }, { cellCm: CELL_CM, rotationStepDeg: 15 }).BANDE.length, 24);
  });

  it('refuse un pas qui ne divise pas 360°', () => {
    assert.throws(() => buildPieceShapes(PIECES, { cellCm: CELL_CM, rotationStepDeg: 7 }), RangeError);
    assert.throws(() => buildPieceShapes(PIECES, { cellCm: CELL_CM, rotationStepDeg: 0 }), RangeError);
  });
});

describe('collides', () => {
  const shape = shapes.MANCHE[1];

  it('détecte la sortie du tissu', () => {
    const occupancy = createMask(200, 200);
    const integral = buildIntegral(occupancy);
    assert.ok(collides(shape, -shape.minX - 1, -shape.minY, occupancy, integral));
    assert.ok(!collides(shape, -shape.minX, -shape.minY, occupancy, integral));
    assert.ok(collides(shape, 200 - shape.minX - shape.width + 1, -shape.minY, occupancy, integral));
  });

  it('[D-04] équivaut à un test cellule par cellule', () => {
    for (const seed of [1, 2, 3, 4]) {
      const occupancy = randomMask(160, 160, 0.0015 * seed, seed);
      const integral = buildIntegral(occupancy);
      for (let y = 30; y < 130; y += 7) {
        for (let x = 30; x < 130; x += 7) {
          const box = shapeBox(shape, x, y);
          let expected = false;
          for (let row = 0; row < shape.height && !expected; row += 1) {
            for (const column of shape.rows[row]) if (occupancy.data[(box.y0 + row) * 160 + box.x0 + column]) { expected = true; break; }
          }
          assert.equal(collides(shape, x, y, occupancy, integral), expected, `seed ${seed} (${x}, ${y})`);
        }
      }
    }
  });

  it('[D-04] accepte une pièce dont seuls les coins vides de la boîte sont occupés', () => {
    const triangle = buildPieceShapes({ T: [[0, 0], [20, 0], [0, 20]] }, { cellCm: 1, rotationStepDeg: 360 }).T[0];
    const occupancy = createMask(60, 60);
    const x = 20 - triangle.minX; const y = 20 - triangle.minY;
    for (let dy = 12; dy < 20; dy += 1) for (let dx = 12; dx < 20; dx += 1) occupancy.data[(20 + dy) * 60 + 20 + dx] = 1;
    assert.ok(!collides(triangle, x, y, occupancy, buildIntegral(occupancy)));
  });
});

describe('stampPiece / findPlacement', () => {
  it('stampPiece marque la pièce et sa marge', () => {
    const occupancy = createMask(100, 100);
    const shape = shapes.BANDE[0];
    stampPiece(occupancy, shape, 10 - shape.minX, 10 - shape.minY, 2);
    assert.equal(occupancy.data[8 * 100 + 8], 1);
    assert.equal(occupancy.data[7 * 100 + 7], 0);
  });

  it('place la première pièce dans le coin bas-gauche disponible (haut-gauche de la grille)', () => {
    const occupancy = createMask(300, 300);
    const placement = findPlacement('BANDE', shapes.BANDE, occupancy, { pieces: [], defects: [] }, SAFE_CLEARANCE_CELLS);
    const box = shapeBox(placement.shape, placement.x, placement.y);
    assert.equal(box.x0, 0); assert.equal(box.y0, 0);
    assert.equal(placement.shape.angle % 180, 0, 'la bande doit être posée à plat');
  });

  it('renvoie null quand la pièce ne rentre pas', () => {
    assert.equal(findPlacement('DOS', shapes.DOS, createMask(50, 50), { pieces: [], defects: [] }, SAFE_CLEARANCE_CELLS), null);
  });
});

describe('scores', () => {
  const fake = (name) => ({ name, shape: { areaCm2: 10 } });

  it('countCompleteKits demande 2 manches par T-shirt', () => {
    const placements = ['DOS', 'DEVANT', 'BANDE', 'MANCHE', 'DOS', 'DEVANT', 'BANDE', 'MANCHE', 'MANCHE'].map(fake);
    assert.equal(countCompleteKits(placements, KIT), 1);
    assert.equal(countCompleteKits([...placements, fake('MANCHE')], KIT), 2);
    assert.equal(countCompleteKits([], KIT), 0);
  });

  it('[D-05] préfère plus de T-shirts complets à plus de pièces', () => {
    const manySleeves = scorePlan(Array.from({ length: 12 }, () => fake('MANCHE')));
    const oneKit = scorePlan(['DOS', 'DEVANT', 'BANDE', 'MANCHE', 'MANCHE'].map(fake));
    assert.ok(isBetterScore(oneKit, manySleeves));
    assert.ok(!isBetterScore(manySleeves, oneKit));
  });
});

describe('validatePlan', () => {
  const grid = createMask(300, 300);
  const band = shapes.BANDE[0];
  const at = (left, top, shape = band, name = 'BANDE') => ({ name, pass: 1, shape, x: left - shape.minX, y: top - shape.minY });

  it('accepte un plan sans conflit', () => {
    assert.deepEqual(validatePlan([at(0, 0), at(0, 30)], grid), { ok: true });
  });

  it('refuse une pièce hors du tissu', () => {
    assert.equal(validatePlan([at(250, 0)], grid).ok, false);
  });

  it('refuse deux pièces trop proches (marge de 1 cm)', () => {
    assert.equal(validatePlan([at(0, 0), at(0, 17)], grid).ok, false);
    assert.equal(validatePlan([at(0, 0), at(0, 19)], grid).ok, true);
  });

  it('refuse une pièce posée sur un défaut ou dans sa marge', () => {
    // La bande couvre les lignes 0–15 ; défaut en ligne 17 → marge en lignes 15–19.
    const defect = rectMask(300, 300, [{ x0: 50, y0: 17, x1: 51, y1: 18 }]);
    assert.equal(validatePlan([at(0, 0)], defect).ok, false);
    assert.equal(validatePlan([at(0, 21)], defect).ok, true);
  });

  it('refuse un placement mal formé', () => {
    assert.equal(validatePlan([{ name: 'X', x: 0, y: 0 }], grid).ok, false);
    assert.equal(validatePlan([{ ...at(0, 0), x: 1.5 }], grid).ok, false);
  });
});

describe('nestPieces', () => {
  // Coupon de 150 × 120 cm pour des tests rapides.
  const width = 300; const height = 240;

  it('remplit un tissu sain avec des T-shirts complets et un plan valide', async () => {
    const gridMask = createMask(width, height);
    const progress = [];
    const result = await nestPieces({ gridMask, shapes, yieldToUi: instant, onProgress: (value) => progress.push(value) });
    assert.equal(result.aborted, false);
    assert.ok(result.validation.ok, result.validation.reason);
    assert.ok(result.score.completeKits >= 1, `seulement ${result.score.completeKits} T-shirt`);
    assert.ok(result.score.usedAreaCm2 / (width * height * CELL_CM * CELL_CM) > 0.7, 'moins de 70 % du tissu utilisé');
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value) => value >= 0 && value <= 1));
  });

  it('obtient au moins 10 T-shirts sur le coupon réel de 3 × 4,5 m', async () => {
    const result = await nestPieces({ gridMask: createMask(600, 900), shapes, yieldToUi: instant });
    assert.ok(result.validation.ok);
    assert.ok(result.score.completeKits >= 10, `seulement ${result.score.completeKits} T-shirts`);
  });

  it('évite les défauts et leur marge, contour compris', async () => {
    const gridMask = rectMask(width, height, [
      { x0: 40, y0: 30, x1: 60, y1: 50 }, { x0: 150, y0: 100, x1: 155, y1: 180 }, { x0: 230, y0: 10, x1: 232, y1: 12 }
    ]);
    const result = await nestPieces({ gridMask, shapes, yieldToUi: instant });
    assert.ok(result.validation.ok);
    assert.ok(result.placements.length > 0);
    assertOutlinesAvoidDefects(result.placements, dilate(gridMask, SAFE_CLEARANCE_CELLS - 1));
  });

  it('ne place rien sur un tissu entièrement défectueux', async () => {
    const gridMask = rectMask(width, height, [{ x0: 0, y0: 0, x1: width, y1: height }]);
    const result = await nestPieces({ gridMask, shapes, yieldToUi: instant });
    assert.equal(result.placements.length, 0);
    assert.ok(result.validation.ok);
  });

  it('[D-08] s’arrête proprement si le masque change pendant le calcul', async () => {
    let calls = 0;
    const result = await nestPieces({ gridMask: createMask(width, height), shapes, yieldToUi: instant, shouldAbort: () => (calls += 1) > 3 });
    assert.equal(result.aborted, true);
    assert.equal(result.placements.length, 0);
  });

  it('refuse une stratégie contenant une pièce inconnue', async () => {
    await assert.rejects(nestPieces({ gridMask: createMask(10, 10), shapes, strategies: [['CAPUCHE']] }), RangeError);
    await assert.rejects(nestPieces({ gridMask: createMask(10, 10), shapes, strategies: [] }), RangeError);
  });

  it('estimateMaxKits borne le nombre de passages par la surface libre', () => {
    assert.ok(estimateMaxKits(createMask(600, 900), shapes) >= 15);
    assert.equal(estimateMaxKits(rectMask(10, 10, [{ x0: 0, y0: 0, x1: 10, y1: 10 }]), shapes), 1);
  });

  it('utilise toutes les stratégies de la configuration', () => {
    for (const order of STRATEGIES) for (const name of order) assert.ok(shapes[name]);
  });
});

describe('[D-23] tissu avec beaucoup de petites taches', () => {
  it('[D-23] limite le nombre de positions candidates issues des défauts', () => {
    const defects = Array.from({ length: 500 }, (_, i) => ({ x0: i, y0: i, x1: i + 3, y1: i + 3 }));
    const { xs, ys } = collectAnchors(shapes.MANCHE[0], { pieces: [], defects }, 3, { width: 600, height: 900 });
    assert.ok(xs.length <= MAX_DEFECT_ANCHORS + 1, `${xs.length} positions en x`);
    assert.ok(ys.length <= MAX_DEFECT_ANCHORS + 1, `${ys.length} positions en y`);
  });

  it('[D-23] garde les positions exactes quand il y a peu de défauts', () => {
    const { xs } = collectAnchors(shapes.BANDE[0], { pieces: [], defects: [{ x0: 100, y0: 0, x1: 110, y1: 5 }] }, 3, { width: 600, height: 900 });
    assert.ok(xs.includes(113 - shapes.BANDE[0].minX), 'position juste après le défaut absente');
  });

  it('[D-23] 300 taches : réponse en moins de 20 s avec un plan valide', async () => {
    // Avec une tache tous les ~21 cm, aucun DOS (52 × 73 cm) ne peut rentrer :
    // on vérifie la rapidité et la validité, pas le nombre de T-shirts.
    const start = Date.now();
    const result = await nestPieces({ gridMask: speckledGrid(300), shapes, yieldToUi: instant });
    const seconds = (Date.now() - start) / 1000;
    assert.ok(seconds < 20, `${seconds.toFixed(1)} s`);
    assert.ok(result.validation.ok, result.validation.reason);
    assert.ok(result.score.pieceCount >= 10, `seulement ${result.score.pieceCount} pièces`);
  });

  it('[D-23] 50 taches, rotations de 15° : au moins 8 T-shirts (résultat de l’ancien calcul exact) en moins de 20 s', async () => {
    const fineShapes = buildPieceShapes(PIECES, { cellCm: CELL_CM, rotationStepDeg: 15 });
    const start = Date.now();
    const result = await nestPieces({ gridMask: speckledGrid(50, 51), shapes: fineShapes, yieldToUi: instant });
    const seconds = (Date.now() - start) / 1000;
    assert.ok(seconds < 20, `${seconds.toFixed(1)} s`);
    assert.ok(result.validation.ok, result.validation.reason);
    assert.ok(result.score.completeKits >= 8, `seulement ${result.score.completeKits} T-shirts`);
  });
});
