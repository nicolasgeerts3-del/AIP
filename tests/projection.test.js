import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CELL_CM, COLORS, ORIENTATION_MODES, PIECES } from '../src/config.js';
import { createMask } from '../src/core/mask.js';
import { buildPieceShapes } from '../src/core/nesting.js';
import {
  calibrationPattern, defaultCorners, isUsableQuad, moveCorner, nearestCorner, pixelSizeMm, planForProjection, projectionMatrix, projectPoints
} from '../src/core/projection.js';
import { rectMask } from './helpers/fixtures.js';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
const fabric = { widthCm: 300, heightCm: 450 };
const screen = { width: 1920, height: 1080 };

describe('[D-24] projection du plan sur le tissu', () => {
  it('[D-24] planForProjection convertit les contours et les défauts en cm', () => {
    const shapes = buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: ORIENTATION_MODES['droit-fil'].angles });
    const shape = shapes.BANDE[0];
    const placement = { name: 'BANDE', pass: 2, shape, x: 10 - shape.minX, y: 20 - shape.minY };
    const message = planForProjection({ placements: [placement], gridMask: rectMask(600, 900, [{ x0: 100, y0: 200, x1: 110, y1: 220 }]), fabric, cellCm: CELL_CM, colors: COLORS });
    assert.equal(message.type, 'plan');
    assert.deepEqual(message.fabric, fabric);
    const xs = message.pieces[0].polygon.map((p) => p[0]); const ys = message.pieces[0].polygon.map((p) => p[1]);
    close(Math.max(...xs) - Math.min(...xs), 58); close(Math.max(...ys) - Math.min(...ys), 8);
    assert.ok(Math.min(...xs) >= 5 - 1e-9 && Math.min(...ys) >= 10 - 1e-9, 'position en cm incorrecte');
    assert.equal(message.pieces[0].pass, 2);
    assert.equal(message.pieces[0].color, COLORS.BANDE);
    assert.deepEqual(message.defects, [{ x0: 50, y0: 100, x1: 55, y1: 110 }]);
    assert.ok(!('shape' in message.pieces[0]), 'données internes transmises');
    assert.doesNotThrow(() => structuredClone(message));
  });

  it('[D-24] coins par défaut : tissu centré, proportions conservées', () => {
    const corners = defaultCorners(fabric, screen);
    const [tl, tr, br, bl] = corners;
    close((tr[0] - tl[0]) / (bl[1] - tl[1]), 300 / 450);
    close((tl[0] + tr[0]) / 2, 960); close((tl[1] + bl[1]) / 2, 540);
    close(br[1] - tr[1], 1080 * 0.9);
  });

  it('[D-24] l’homographie envoie les coins du tissu sur les coins de l’écran', () => {
    const corners = [[100, 80], [900, 120], [950, 1000], [60, 950]];
    const matrix = projectionMatrix(fabric, corners);
    const projected = projectPoints(matrix, [[0, 0], [300, 0], [300, 450], [0, 450]]);
    projected.forEach(([x, y], i) => { close(x, corners[i][0], 1e-6); close(y, corners[i][1], 1e-6); });
  });

  it('[D-24] isUsableQuad accepte un quadrilatère miroir, refuse un croisé ou plat', () => {
    assert.ok(isUsableQuad([[0, 0], [100, 0], [100, 100], [0, 100]]));
    assert.ok(isUsableQuad([[100, 0], [0, 0], [0, 100], [100, 100]]), 'projecteur en miroir refusé');
    assert.ok(!isUsableQuad([[0, 0], [100, 100], [100, 0], [0, 100]]), 'quadrilatère croisé accepté');
    assert.ok(!isUsableQuad([[0, 0], [5, 0], [5, 5], [0, 5]]), 'quadrilatère minuscule accepté');
    assert.ok(!isUsableQuad([[0, 0], [1, 0]]));
  });

  it('[D-24] nearestCorner et moveCorner', () => {
    const corners = defaultCorners(fabric, screen);
    assert.equal(nearestCorner(corners, [corners[2][0] + 10, corners[2][1] - 5]), 2);
    assert.equal(nearestCorner(corners, [960, 540]), -1);
    const moved = moveCorner(corners, 0, corners[0][0] - 30, corners[0][1] - 20);
    assert.deepEqual(moved[0], [corners[0][0] - 30, corners[0][1] - 20]);
    assert.notEqual(moved, corners);
    // Un déplacement qui croiserait le quadrilatère est ignoré.
    assert.equal(moveCorner(corners, 0, corners[2][0] + 50, corners[2][1] + 50), corners);
  });

  it('[D-24] mire de contrôle : bord, quadrillage, carré témoin de 10 cm', () => {
    const { grid, border, square } = calibrationPattern(fabric, 50);
    assert.equal(border.length, 4); assert.equal(square.length, 4);
    assert.equal(grid.length, 5 + 8);
    assert.deepEqual(square[0], [[0, 0], [10, 0]]);
  });

  it('[D-24] taille d’un pixel sur le tissu', () => {
    // 450 cm sur 972 px → ≈ 4,6 mm par pixel.
    close(pixelSizeMm(fabric, defaultCorners(fabric, screen)), 4500 / 972, 1e-9);
  });

  it('[D-24] plan vide accepté (aucune pièce à projeter)', () => {
    const message = planForProjection({ placements: [], gridMask: createMask(10, 10), fabric, cellCm: CELL_CM, colors: COLORS });
    assert.deepEqual(message.pieces, []);
  });
});
