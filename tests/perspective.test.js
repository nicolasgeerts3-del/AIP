import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyHomography, computeHomography, orderCorners, rectifiedSize, warpPerspective } from '../src/core/perspective.js';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

/** Photo synthétique : fond vert, quadrilatère de tissu beige avec une tache rouge en son centre. */
function photoWithFabric(width, height, corners, stainRadius) {
  const data = new Uint8ClampedArray(width * height * 4);
  // Repère du tissu : homographie photo → carré unité, pour savoir si un pixel est dans le tissu.
  const toUnit = computeHomography(corners, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [u, v] = applyHomography(toUnit, x + 0.5, y + 0.5);
      const inFabric = u >= 0 && u <= 1 && v >= 0 && v <= 1;
      const inStain = inFabric && Math.hypot(u - 0.5, v - 0.5) < stainRadius;
      const color = inStain ? [200, 40, 40] : inFabric ? [214, 200, 172] : [40, 120, 60];
      data.set([...color, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

const pixel = (image, x, y) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];

describe('[D-19] recadrage et perspective', () => {
  it('[D-19] orderCorners remet les coins dans l’ordre quel que soit l’ordre des clics', () => {
    const expected = [[10, 12], [200, 8], [210, 300], [5, 290]];
    for (const order of [[0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]]) {
      assert.deepEqual(orderCorners(order.map((i) => expected[i])), expected);
    }
  });

  it('[D-19] orderCorners refuse des coins alignés ou trop proches', () => {
    assert.throws(() => orderCorners([[0, 0], [10, 0], [20, 0], [30, 0]]), RangeError);
    assert.throws(() => orderCorners([[0, 0], [1, 0], [1, 1], [0, 1]]), RangeError);
    assert.throws(() => orderCorners([[0, 0], [1, 0]]), TypeError);
  });

  it('[D-19] l’homographie envoie exactement chaque coin sur sa cible', () => {
    const src = [[12, 30], [410, 18], [450, 600], [-5, 580]];
    const dst = [[0, 0], [300, 0], [300, 450], [0, 450]];
    const h = computeHomography(src, dst);
    src.forEach(([x, y], i) => { const [u, v] = applyHomography(h, x, y); close(u, dst[i][0]); close(v, dst[i][1]); });
  });

  it('[D-19] homographie identité pour un carré envoyé sur lui-même', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const h = computeHomography(square, square);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((value, i) => close(h[i], value));
  });

  it('[D-19] rectifiedSize respecte les proportions du tissu et la largeur maximale', () => {
    const corners = [[0, 0], [1000, 0], [1000, 800], [0, 800]];
    assert.deepEqual(rectifiedSize(corners, { widthCm: 300, heightCm: 450 }, 700), { width: 700, height: 1050 });
    assert.deepEqual(rectifiedSize(corners, { widthCm: 200, heightCm: 100 }, 2000), { width: 1000, height: 500 });
  });

  it('[D-19] le redressement supprime le fond et remet la tache au centre', () => {
    // Tissu photographié en biais (trapèze) sur un fond vert.
    const corners = [[60, 40], [330, 70], [360, 420], [30, 380]];
    const photo = photoWithFabric(400, 460, corners, 0.08);
    const rectified = warpPerspective(photo, orderCorners(corners), 200, 300);
    assert.equal(rectified.width, 200); assert.equal(rectified.height, 300);
    // Plus aucun pixel de fond vert (hors bordure d'1 px due au lissage).
    let green = 0;
    for (let y = 1; y < 299; y += 1) for (let x = 1; x < 199; x += 1) { const [r, g] = pixel(rectified, x, y); if (g > r) green += 1; }
    assert.equal(green, 0, `${green} pixels de fond restent dans l’image redressée`);
    // La tache, au centre du tissu, est au centre de l'image redressée.
    assert.deepEqual(pixel(rectified, 100, 150), [200, 40, 40]);
    assert.deepEqual(pixel(rectified, 20, 20), [214, 200, 172]);
  });

  it('[D-19] refuse une image source incohérente', () => {
    assert.throws(() => warpPerspective({ width: 2, height: 2, data: new Uint8ClampedArray(3) }, [[0, 0], [1, 0], [1, 1], [0, 1]], 2, 2), RangeError);
  });
});
