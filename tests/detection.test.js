import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boxMean, computeColorPlanes, detectDefects } from '../src/core/detection.js';
import { countMask, fillHoles } from '../src/core/mask.js';
import { fabricImage, rectMask } from './helpers/fixtures.js';

function stainCoverage(mask, { cx, cy, r }) {
  let inside = 0; let hit = 0;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      inside += 1; if (mask.data[y * mask.width + x]) hit += 1;
    }
  }
  return hit / inside;
}

function falsePositives(mask, stains, margin) {
  let count = 0;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      const nearStain = stains.some((stain) => (x - stain.cx) ** 2 + (y - stain.cy) ** 2 <= (stain.r + margin) ** 2);
      if (!nearStain && mask.data[y * mask.width + x]) count += 1;
    }
  }
  return count;
}

const detect = (image, options) => detectDefects(computeColorPlanes(image), options);
const scaled = (color, factor) => color.map((value) => Math.round(value * factor));
const BEIGE = [214, 200, 172];

describe('computeColorPlanes', () => {
  it('produit des plans L*, a*, b* de la taille de l’image', () => {
    const planes = computeColorPlanes(fabricImage(8, 5));
    for (const plane of [planes.L, planes.a, planes.b]) assert.equal(plane.length, 40);
  });

  it('[D-17] a* et b* ne changent pas quand seule l’intensité lumineuse change', () => {
    const planes = computeColorPlanes(fabricImage(2, 1, { noise: 0, illumination: (x) => (x === 0 ? 1 : 0.6) }));
    assert.ok(Math.abs(planes.a[0] - planes.a[1]) < 0.6, `${planes.a[0]} ≠ ${planes.a[1]}`);
    assert.ok(Math.abs(planes.b[0] - planes.b[1]) < 0.6, `${planes.b[0]} ≠ ${planes.b[1]}`);
    assert.ok(planes.L[0] - planes.L[1] > 10, 'L* doit, lui, baisser');
  });

  it('refuse une image incohérente', () => {
    assert.throws(() => computeColorPlanes({ width: 2, height: 2, data: new Uint8ClampedArray(15) }), RangeError);
    assert.throws(() => computeColorPlanes({ width: 0, height: 2, data: new Uint8ClampedArray(0) }), RangeError);
    assert.throws(() => computeColorPlanes(null), RangeError);
  });
});

describe('boxMean / fillHoles', () => {
  it('boxMean d’une image constante est constante, y compris aux bords', () => {
    const values = new Float32Array(30).fill(7);
    assert.ok(boxMean(values, 6, 5, 2).every((value) => Math.abs(value - 7) < 1e-6));
  });

  it('boxMean moyenne bien la fenêtre', () => {
    const values = Float32Array.from([0, 0, 9, 0, 0]);
    assert.deepEqual([...boxMean(values, 5, 1, 1)], [0, 3, 3, 3, 0]);
  });

  it('fillHoles bouche l’intérieur d’un anneau mais pas une zone ouverte sur le bord', () => {
    const ring = rectMask(10, 10, [{ x0: 2, y0: 2, x1: 8, y1: 3 }, { x0: 2, y0: 7, x1: 8, y1: 8 }, { x0: 2, y0: 2, x1: 3, y1: 8 }, { x0: 7, y0: 2, x1: 8, y1: 8 }]);
    const filled = fillHoles(ring);
    assert.equal(filled.data[5 * 10 + 5], 1);
    assert.equal(countMask(filled), 36);
    const corner = rectMask(10, 10, [{ x0: 0, y0: 3, x1: 4, y1: 4 }, { x0: 3, y0: 0, x1: 4, y1: 4 }]);
    assert.equal(countMask(fillHoles(corner)), countMask(corner));
  });
});

describe('detectDefects', () => {
  const redStain = { cx: 60, cy: 40, r: 9, color: [170, 60, 50] };
  const blueStain = { cx: 25, cy: 100, r: 6, color: [80, 90, 160] };

  it('détecte des taches colorées sur un tissu uni, sans faux positifs', () => {
    const stains = [redStain, blueStain];
    const { mask } = detect(fabricImage(120, 140, { stains }));
    assert.equal(mask.width, 120);
    assert.ok(stainCoverage(mask, redStain) > 0.95, 'tache rouge non couverte');
    assert.ok(stainCoverage(mask, blueStain) > 0.95, 'tache bleue non couverte');
    assert.equal(falsePositives(mask, stains, 4), 0);
  });

  it('ne signale rien sur un tissu sain, même avec un bruit marqué', () => {
    assert.equal(countMask(detect(fabricImage(80, 80)).mask), 0);
    assert.equal(countMask(detect(fabricImage(120, 120, { noise: 10, seed: 3 })).mask), 0);
  });

  it('un facteur MAD plus grand donne un masque plus petit ou égal', () => {
    const planes = computeColorPlanes(fabricImage(120, 140, { stains: [redStain, { cx: 90, cy: 110, r: 7, color: [200, 175, 150] }], noise: 10 }));
    const counts = [1.5, 3.5, 8].map((madFactor) => countMask(detectDefects(planes, { madFactor }).mask));
    assert.ok(counts[0] >= counts[1] && counts[1] >= counts[2], counts.join(' ≥ '));
  });

  it('trouve la couleur médiane du tissu sain comme centre', () => {
    const { center } = detect(fabricImage(60, 60, { noise: 0, stains: [redStain] }));
    const expected = computeColorPlanes(fabricImage(1, 1, { noise: 0 }));
    assert.ok(Math.abs(center.a - expected.a[0]) < 1e-4 && Math.abs(center.b - expected.b[0]) < 1e-4);
  });

  it('refuse des paramètres invalides', () => {
    const planes = computeColorPlanes(fabricImage(10, 10));
    assert.throws(() => detectDefects(planes, { madFactor: 0 }), RangeError);
    assert.throws(() => detectDefects(planes, { madFactor: Number.NaN }), RangeError);
    assert.throws(() => detectDefects(planes, { sampleStep: 0 }), RangeError);
  });
});

describe('[D-17] ombres et éclairage', () => {
  it('[D-17] un dégradé d’éclairage (100 % → 55 %) ne crée aucun défaut', () => {
    const image = fabricImage(160, 200, { illumination: (x) => 1 - 0.45 * x / 159 });
    assert.equal(countMask(detect(image).mask), 0);
  });

  it('[D-17] une grande ombre douce (−35 %) ne crée aucun défaut', () => {
    const image = fabricImage(160, 200, { illumination: (x, y) => 1 - 0.35 * Math.exp(-((x - 80) ** 2 + (y - 100) ** 2) / (2 * 30 ** 2)) });
    assert.equal(countMask(detect(image).mask), 0);
  });

  it('[D-17] le test de teinte seul ignore une ombre nette (−30 %)', () => {
    const shadow = { cx: 50, cy: 50, r: 20, color: scaled(BEIGE, 0.7) };
    assert.equal(countMask(detect(fabricImage(100, 100, { stains: [shadow] }), { useLuminance: false }).mask), 0);
  });

  it('[D-17] une tache colorée reste détectée dans une zone d’ombre', () => {
    const stain = { cx: 120, cy: 100, r: 8, color: [170, 60, 50] };
    const image = fabricImage(160, 200, { stains: [stain], illumination: (x) => 1 - 0.45 * x / 159 });
    const { mask } = detect(image);
    assert.ok(stainCoverage(mask, stain) > 0.95);
    assert.equal(falsePositives(mask, [stain], 4), 0);
  });
});

describe('[D-18] taches sans changement de teinte', () => {
  it('[D-18] détecte une tache de graisse (même teinte, −25 %)', () => {
    const grease = { cx: 60, cy: 70, r: 8, color: scaled(BEIGE, 0.75) };
    const { mask } = detect(fabricImage(140, 160, { stains: [grease] }));
    assert.ok(stainCoverage(mask, grease) > 0.95, `couverture ${stainCoverage(mask, grease)}`);
    assert.equal(falsePositives(mask, [grease], 4), 0);
  });

  it('[D-18] détecte une tache grise sur un tissu gris', () => {
    const stain = { cx: 50, cy: 50, r: 7, color: [95, 95, 95] };
    const { mask } = detect(fabricImage(120, 120, { base: [140, 140, 140], stains: [stain] }));
    assert.ok(stainCoverage(mask, stain) > 0.95);
  });

  it('[D-18] détecte une décoloration plus claire (javel)', () => {
    const bleach = { cx: 70, cy: 50, r: 8, color: scaled(BEIGE, 1.18) };
    const { mask } = detect(fabricImage(140, 120, { stains: [bleach] }));
    assert.ok(stainCoverage(mask, bleach) > 0.95);
  });

  it('[D-18] couvre entièrement une grande tache, plus large que la fenêtre locale', () => {
    const big = { cx: 80, cy: 100, r: 45, color: scaled(BEIGE, 0.7) };
    const { mask } = detect(fabricImage(160, 200, { stains: [big] }));
    assert.ok(stainCoverage(mask, big) > 0.99, `couverture ${stainCoverage(mask, big)}`);
  });
});
