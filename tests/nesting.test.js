import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_CM, DEFAULT_ORIENTATION_MODE, KIT, ORIENTATION_MODES, PIECES, SAFE_CLEARANCE_CELLS } from '../src/config.js';
import { placementOutline, pointInPolygon, polygonBounds } from '../src/core/geometry.js';
import { createMask, dilate } from '../src/core/mask.js';
import {
  buildPieceShapes, countCompleteKits, estimateMaxKits, FILL_CORNERS, findFirstFit, isBetterScore, mirrorShape, nestPieces, Occupancy,
  packSequence, pieceSequence, scorePlan, shapeBox, shapeSpans, shuffledSequence, seededRandom, stampPiece, validatePlan
} from '../src/core/nesting.js';
import { randomMask, rectMask } from './helpers/fixtures.js';

const shapes = buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: ORIENTATION_MODES[DEFAULT_ORIENTATION_MODE].angles });
const quarterShapes = buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: ORIENTATION_MODES.quarts.angles });
const instant = async () => {};
const fast = { yieldToUi: instant, timeBudgetMs: 0 };

/** Grille 600 × 900 parsemée de `count` taches de 3 × 3 cellules (1,5 cm). */
function speckledGrid(count, seed = 1) {
  const random = seededRandom(seed);
  const rects = Array.from({ length: count }, () => {
    const x0 = Math.floor(random() * 597); const y0 = Math.floor(random() * 897);
    return { x0, y0, x1: x0 + 3, y1: y0 + 3 };
  });
  return rectMask(600, 900, rects);
}

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
  it('crée une forme par orientation autorisée, sans doublon', () => {
    assert.equal(quarterShapes.DOS.length, 4);
    assert.equal(buildPieceShapes({ BANDE: PIECES.BANDE }, { cellCm: CELL_CM, angles: ORIENTATION_MODES.libre.angles }).BANDE.length, 24);
    assert.equal(buildPieceShapes({ BANDE: PIECES.BANDE }, { cellCm: CELL_CM, angles: [0, 360, -180, 180] }).BANDE.length, 2);
  });

  it('refuse une liste d’orientations vide ou invalide', () => {
    assert.throws(() => buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: [] }), RangeError);
    assert.throws(() => buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: [0, Number.NaN] }), RangeError);
  });

  it('les segments couvrent exactement les cellules de la forme', () => {
    for (const shape of [...shapes.DOS, ...quarterShapes.MANCHE]) {
      const covered = shapeSpans(shape).reduce((sum, [, start, end]) => sum + end - start, 0);
      assert.equal(covered, shape.cellCount);
      // L'encolure du DOS coupe certaines lignes en deux segments.
    }
    assert.ok(shapeSpans(shapes.DOS[0]).length > shapes.DOS[0].height, 'encolure non détectée');
  });
});

describe('[D-21] droit-fil', () => {
  it('[D-21] le mode par défaut ne garde que 0° et 180°', () => {
    assert.deepEqual(ORIENTATION_MODES[DEFAULT_ORIENTATION_MODE].angles, [0, 180]);
  });

  it('[D-21] en mode droit-fil, toutes les pièces placées gardent le droit-fil vertical', async () => {
    const result = await nestPieces({ gridMask: createMask(600, 900), shapes, ...fast });
    assert.ok(result.validation.ok);
    assert.ok(result.placements.every((placement) => placement.shape.angle % 180 === 0));
  });
});

describe('Occupancy', () => {
  it('[D-04] blockedShift équivaut à un test cellule par cellule', () => {
    for (const seed of [1, 2, 3]) {
      const mask = randomMask(160, 160, 0.002 * seed, seed);
      const occupancy = new Occupancy(mask, 0);
      for (const shape of [quarterShapes.MANCHE[1], quarterShapes.BANDE[0]]) {
        for (let y = 20; y < 140; y += 9) {
          for (let x = 30; x < 130; x += 7) {
            const box = shapeBox(shape, x, y);
            if (box.x0 < 0 || box.y0 < 0 || box.x1 > 160 || box.y1 > 160) continue;
            let blocked = false;
            for (let row = 0; row < shape.height && !blocked; row += 1) {
              for (const column of shape.rows[row]) if (mask.data[(box.y0 + row) * 160 + box.x0 + column]) { blocked = true; break; }
            }
            assert.equal(occupancy.blockedShift(shape, x, y) > 0, blocked, `seed ${seed} (${x}, ${y})`);
          }
        }
      }
    }
  });

  it('le saut proposé ne fait jamais manquer une position libre', () => {
    const mask = randomMask(200, 120, 0.01, 9);
    const occupancy = new Occupancy(mask, 0);
    const shape = quarterShapes.BANDE[1];
    for (let top = 0; top + shape.height <= 120; top += 5) {
      const y = top - shape.minY;
      for (let left = 0; left + shape.width <= 200;) {
        const shift = occupancy.blockedShift(shape, left - shape.minX, y);
        if (shift === 0) { left += 1; continue; }
        for (let skipped = left + 1; skipped < Math.min(left + shift, 200 - shape.width + 1); skipped += 1) {
          assert.ok(occupancy.blockedShift(shape, skipped - shape.minX, y) > 0, `position libre sautée en ${skipped}`);
        }
        left += shift;
      }
    }
  });

  it('place() met à jour l’occupation et la marge', () => {
    const occupancy = new Occupancy(createMask(100, 100), 2);
    const shape = quarterShapes.BANDE[0];
    occupancy.place(shape, 10 - shape.minX, 10 - shape.minY);
    assert.equal(occupancy.data[8 * 100 + 8], 1);
    assert.equal(occupancy.data[7 * 100 + 7], 0);
    assert.ok(occupancy.blockedShift(shape, 10 - shape.minX, 10 - shape.minY) > 0);
  });
});

describe('findFirstFit', () => {
  it('place la première pièce dans le coin haut-gauche de la grille', () => {
    const occupancy = new Occupancy(createMask(300, 300), SAFE_CLEARANCE_CELLS);
    const placement = findFirstFit('BANDE', shapes.BANDE, occupancy);
    const box = shapeBox(placement.shape, placement.x, placement.y);
    assert.equal(box.x0, 0); assert.equal(box.y0, 0);
  });

  it('trouve un trou étroit entre deux défauts (une recherche par ancres le manquait)', () => {
    // Couloir libre de 20 × 140 cellules au milieu d'un tissu plein : seule une bande verticale y entre.
    const mask = rectMask(200, 200, [{ x0: 0, y0: 0, x1: 90, y1: 200 }, { x0: 110, y0: 0, x1: 200, y1: 200 }, { x0: 90, y0: 150, x1: 110, y1: 200 }]);
    const placement = findFirstFit('BANDE', quarterShapes.BANDE, new Occupancy(mask, 1));
    assert.ok(placement, 'trou non trouvé');
    const box = shapeBox(placement.shape, placement.x, placement.y);
    assert.ok(box.x0 >= 91 && box.x1 <= 109);
  });

  it('renvoie null quand la pièce ne rentre pas et refuse un critère inconnu', () => {
    assert.equal(findFirstFit('DOS', shapes.DOS, new Occupancy(createMask(50, 50), 2)), null);
    assert.throws(() => findFirstFit('DOS', shapes.DOS, new Occupancy(createMask(50, 50), 2), 'au-hasard'), RangeError);
  });
});

describe('séquences et scores', () => {
  const fake = (name) => ({ name, shape: { areaCm2: 10, minX: 0, minY: 0, width: 1, height: 1 }, x: 0, y: 0 });

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

  it('[D-26] pieceSequence numérote les pièces par T-shirt', () => {
    for (const order of ['par-taille', 'par-tshirt']) {
      const sequence = pieceSequence(3, order, KIT, shapes);
      assert.equal(sequence.length, 15);
      for (let pass = 1; pass <= 3; pass += 1) {
        const pieces = sequence.filter((item) => item.pass === pass).map((item) => item.name).sort();
        assert.deepEqual(pieces, ['BANDE', 'DEVANT', 'DOS', 'MANCHE', 'MANCHE']);
      }
    }
    assert.throws(() => pieceSequence(1, 'en-vrac', KIT, shapes), RangeError);
  });

  it('shuffledSequence garde les mêmes pièces, dans un ordre qui varie', () => {
    const random = seededRandom(3);
    const reference = pieceSequence(4, 'par-taille', KIT, shapes).map((item) => `${item.name}${item.pass}`).sort();
    const orders = new Set();
    for (let i = 0; i < 5; i += 1) {
      const sequence = shuffledSequence(4, KIT, shapes, random);
      assert.deepEqual(sequence.map((item) => `${item.name}${item.pass}`).sort(), reference);
      orders.add(sequence.map((item) => item.name).join());
    }
    assert.ok(orders.size > 1);
  });
});

describe('validatePlan', () => {
  const grid = createMask(300, 300);
  const band = quarterShapes.BANDE[0];
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

  it('stampPiece marque la pièce et sa marge', () => {
    const occupancy = createMask(100, 100);
    stampPiece(occupancy, band, 10 - band.minX, 10 - band.minY, 2);
    assert.equal(occupancy.data[8 * 100 + 8], 1);
    assert.equal(occupancy.data[7 * 100 + 7], 0);
  });
});

describe('nestPieces', () => {
  it('remplit un coupon de 1,50 × 1,20 m avec un plan valide', async () => {
    const progress = [];
    const result = await nestPieces({ gridMask: createMask(300, 240), shapes, ...fast, onProgress: (value) => progress.push(value) });
    assert.equal(result.aborted, false);
    assert.ok(result.validation.ok, result.validation.reason);
    assert.ok(result.score.completeKits >= 1);
    assert.equal(progress.at(-1), 1);
    assert.ok(progress.every((value) => value >= 0 && value <= 1));
  });

  it('[D-22] ne pose que des T-shirts complets : aucune pièce orpheline', async () => {
    const result = await nestPieces({ gridMask: createMask(600, 900), shapes, ...fast });
    const kits = result.score.completeKits;
    assert.equal(result.placements.length, kits * 5);
    for (const [name, count] of Object.entries(KIT)) {
      assert.equal(result.placements.filter((placement) => placement.name === name).length, kits * count, name);
    }
  });

  it('[D-30] au moins 11 T-shirts en droit-fil sur 3 × 4,5 m (ancien algorithme : 10)', async () => {
    const result = await nestPieces({ gridMask: createMask(600, 900), shapes, yieldToUi: instant, timeBudgetMs: 1000 });
    assert.ok(result.validation.ok);
    assert.ok(result.score.completeKits >= 11, `seulement ${result.score.completeKits} T-shirts`);
  });

  it('[D-30] 12 T-shirts en orientation libre sur 3 × 4,5 m (ancien algorithme : 11)', async () => {
    const free = buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: ORIENTATION_MODES.libre.angles });
    const result = await nestPieces({ gridMask: createMask(600, 900), shapes: free, yieldToUi: instant, timeBudgetMs: 1500 });
    assert.ok(result.validation.ok);
    assert.ok(result.score.completeKits >= 12, `seulement ${result.score.completeKits} T-shirts`);
  });

  it('évite les défauts et leur marge, contour compris', async () => {
    const gridMask = rectMask(300, 240, [
      { x0: 40, y0: 30, x1: 60, y1: 50 }, { x0: 150, y0: 100, x1: 155, y1: 180 }, { x0: 230, y0: 10, x1: 232, y1: 12 }
    ]);
    const result = await nestPieces({ gridMask, shapes: quarterShapes, ...fast });
    assert.ok(result.validation.ok);
    assert.ok(result.placements.length > 0);
    assertOutlinesAvoidDefects(result.placements, dilate(gridMask, SAFE_CLEARANCE_CELLS - 1));
  });

  it('ne place rien sur un tissu entièrement défectueux', async () => {
    const gridMask = rectMask(300, 240, [{ x0: 0, y0: 0, x1: 300, y1: 240 }]);
    const result = await nestPieces({ gridMask, shapes, ...fast });
    assert.equal(result.placements.length, 0);
    assert.ok(result.validation.ok);
  });

  it('[D-08] s’arrête proprement si une entrée change pendant le calcul', async () => {
    let calls = 0;
    const result = await nestPieces({ gridMask: createMask(300, 240), shapes, ...fast, shouldAbort: () => (calls += 1) > 3 });
    assert.equal(result.aborted, true);
    assert.equal(result.placements.length, 0);
  });

  it('refuse un T-shirt dont une pièce n’a pas de patron, ou aucun ordre de pose', async () => {
    await assert.rejects(nestPieces({ gridMask: createMask(10, 10), shapes, kit: { CAPUCHE: 1 } }), RangeError);
    await assert.rejects(nestPieces({ gridMask: createMask(10, 10), shapes, orders: [] }), RangeError);
  });

  it('même graine → même plan', async () => {
    const run = () => nestPieces({ gridMask: createMask(300, 300), shapes, yieldToUi: instant, timeBudgetMs: 200, seed: 7 });
    const [a, b] = [await run(), await run()];
    assert.equal(a.score.completeKits, b.score.completeKits);
  });

  it('estimateMaxKits borne le nombre de T-shirts par la surface libre', () => {
    assert.ok(estimateMaxKits(createMask(600, 900), shapes) >= 12);
    assert.equal(estimateMaxKits(rectMask(10, 10, [{ x0: 0, y0: 0, x1: 10, y1: 10 }]), shapes), 0);
  });

  it('packSequence s’arrête dès qu’une pièce ne rentre pas', async () => {
    const result = await packSequence({ sequence: pieceSequence(50, 'par-taille', KIT, shapes), gridMask: createMask(300, 240), shapes, clearance: 2 });
    assert.equal(result.ok, false);
    assert.ok(result.placements.length > 0);
  });
});

describe('[D-23] tissu avec beaucoup de petites taches', () => {
  it('[D-23] 300 taches : réponse en moins de 5 s avec un plan valide', async () => {
    const start = Date.now();
    const result = await nestPieces({ gridMask: speckledGrid(300), shapes, ...fast });
    const seconds = (Date.now() - start) / 1000;
    assert.ok(seconds < 5, `${seconds.toFixed(1)} s`);
    assert.ok(result.validation.ok, result.validation.reason);
  });

  it('[D-23] 50 taches : au moins 9 T-shirts (ancien algorithme : 8) en moins de 10 s', async () => {
    const start = Date.now();
    const result = await nestPieces({ gridMask: speckledGrid(50, 51), shapes, yieldToUi: instant, timeBudgetMs: 1000 });
    const seconds = (Date.now() - start) / 1000;
    assert.ok(seconds < 10, `${seconds.toFixed(1)} s`);
    assert.ok(result.validation.ok, result.validation.reason);
    assert.ok(result.score.completeKits >= 9, `seulement ${result.score.completeKits} T-shirts`);
  });
});

describe('[D-30] remplissage depuis les 4 coins', () => {
  it('[D-30] retourner deux fois une forme redonne la forme d’origine', () => {
    for (const shape of [shapes.DOS[0], quarterShapes.MANCHE[1]]) {
      const back = mirrorShape(mirrorShape(shape, true, true), true, true);
      assert.deepEqual(back.rows, shape.rows);
      assert.equal(back.minX, shape.minX); assert.equal(back.minY, shape.minY);
    }
  });

  it('[D-30] chaque coin donne un plan valide sur le tissu d’origine, collé au bon coin', async () => {
    const gridMask = rectMask(300, 240, [{ x0: 140, y0: 100, x1: 160, y1: 130 }]);
    for (const { id, flipX, flipY } of FILL_CORNERS) {
      const result = await packSequence({ sequence: pieceSequence(1, 'par-taille', KIT, shapes), gridMask, shapes, clearance: 2, corner: id });
      assert.ok(result.ok, id);
      assert.ok(validatePlan(result.placements, gridMask).ok, `${id} : plan invalide`);
      const box = shapeBox(result.placements[0].shape, result.placements[0].x, result.placements[0].y);
      assert.equal(flipX ? box.x1 : box.x0, flipX ? 300 : 0, `${id} : mauvais bord horizontal`);
      assert.equal(flipY ? box.y1 : box.y0, flipY ? 240 : 0, `${id} : mauvais bord vertical`);
      assert.ok(result.placements.every((placement) => !placement.shape.source), 'forme retournée renvoyée');
    }
    await assert.rejects(packSequence({ sequence: [], gridMask, shapes, clearance: 2, corner: 'milieu' }), RangeError);
  });

  it('[D-30] tissu en paysage avec une grosse tache centrale : au moins 3 T-shirts', async () => {
    // Reproduit la photo de test : 3,00 × 2,25 m, tache de ~70 cm, bords inutilisables.
    const gridMask = rectMask(600, 449, [
      { x0: 0, y0: 0, x1: 600, y1: 57 }, { x0: 0, y0: 425, x1: 600, y1: 449 }, { x0: 0, y0: 0, x1: 20, y1: 449 }, { x0: 575, y0: 0, x1: 600, y1: 449 },
      { x0: 280, y0: 200, x1: 420, y1: 265 }
    ]);
    const result = await nestPieces({ gridMask, shapes, ...fast });
    assert.ok(result.validation.ok);
    assert.ok(result.score.completeKits >= 3, `seulement ${result.score.completeKits} T-shirts`);
  });
});

describe('[D-36] compacité indépendante de la position du plan', () => {
  it('[D-36] le même plan décalé vers le bas du tissu est aussi compact', async () => {
    const gridMask = createMask(300, 300);
    const top = await packSequence({ sequence: pieceSequence(1, 'par-taille', KIT, shapes), gridMask, shapes, clearance: 2 });
    const lowest = Math.max(...top.placements.map((p) => shapeBox(p.shape, p.x, p.y).y1));
    const shifted = top.placements.map((p) => ({ ...p, y: p.y + (300 - lowest) }));
    assert.ok(validatePlan(shifted, gridMask).ok);
    assert.equal(scorePlan(shifted).footprintCells, scorePlan(top.placements).footprintCells);
    assert.ok(!isBetterScore(scorePlan(top.placements), scorePlan(shifted)), 'le plan collé en haut est jugé meilleur à tort');
  });
});
