import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeChroma, detectDefects } from '../src/core/detection.js';
import { countMask } from '../src/core/mask.js';
import { fabricImage } from './helpers/fixtures.js';

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

describe('computeChroma', () => {
  it('produit des plans a*/b* de la taille de l’image', () => {
    const chroma = computeChroma(fabricImage(8, 5));
    assert.equal(chroma.a.length, 40);
    assert.equal(chroma.b.length, 40);
  });

  it('refuse une image incohérente', () => {
    assert.throws(() => computeChroma({ width: 2, height: 2, data: new Uint8ClampedArray(15) }), RangeError);
    assert.throws(() => computeChroma({ width: 0, height: 2, data: new Uint8ClampedArray(0) }), RangeError);
    assert.throws(() => computeChroma(null), RangeError);
  });
});

describe('detectDefects', () => {
  const redStain = { cx: 60, cy: 40, r: 9, color: [170, 60, 50] };
  const blueStain = { cx: 25, cy: 100, r: 6, color: [80, 90, 160] };

  it('détecte des taches colorées sur un tissu uni, sans faux positifs', () => {
    const stains = [redStain, blueStain];
    const { mask } = detectDefects(computeChroma(fabricImage(120, 140, { stains })));
    assert.equal(mask.width, 120);
    assert.ok(stainCoverage(mask, redStain) > 0.95, 'tache rouge non couverte');
    assert.ok(stainCoverage(mask, blueStain) > 0.95, 'tache bleue non couverte');
    assert.equal(falsePositives(mask, stains, 4), 0);
  });

  it('ne signale rien sur un tissu sain', () => {
    const { mask } = detectDefects(computeChroma(fabricImage(80, 80)));
    assert.equal(countMask(mask), 0);
  });

  it('un facteur MAD plus grand donne un masque plus petit ou égal', () => {
    const chroma = computeChroma(fabricImage(120, 140, { stains: [redStain, { cx: 90, cy: 110, r: 7, color: [200, 175, 150] }], noise: 10 }));
    const counts = [1.5, 3.5, 8].map((madFactor) => countMask(detectDefects(chroma, { madFactor }).mask));
    assert.ok(counts[0] >= counts[1] && counts[1] >= counts[2], counts.join(' ≥ '));
  });

  it('ignore une ombre légère de même teinte (−10 % de luminosité)', () => {
    const shadow = { cx: 40, cy: 40, r: 12, color: [193, 180, 155] };
    const { mask } = detectDefects(computeChroma(fabricImage(80, 80, { stains: [shadow] })));
    assert.ok(stainCoverage(mask, shadow) < 0.05);
  });

  it('LIMITE CONNUE : une ombre marquée (−20 %) est prise pour une tache', () => {
    // En L*a*b*, assombrir réduit aussi a* et b* : la chromaticité n'est pas
    // invariante à l'éclairage. Ce test documente le comportement actuel.
    const shadow = { cx: 40, cy: 40, r: 12, color: [171, 160, 138] };
    const { mask } = detectDefects(computeChroma(fabricImage(80, 80, { stains: [shadow] })));
    assert.ok(stainCoverage(mask, shadow) > 0.9);
  });

  it('trouve la couleur médiane du tissu sain comme centre', () => {
    const { center } = detectDefects(computeChroma(fabricImage(60, 60, { noise: 0, stains: [redStain] })));
    const expected = computeChroma(fabricImage(1, 1, { noise: 0 }));
    assert.ok(Math.abs(center.a - expected.a[0]) < 1e-6 && Math.abs(center.b - expected.b[0]) < 1e-6);
  });

  it('refuse des paramètres invalides', () => {
    const chroma = computeChroma(fabricImage(10, 10));
    assert.throws(() => detectDefects(chroma, { madFactor: 0 }), RangeError);
    assert.throws(() => detectDefects(chroma, { madFactor: Number.NaN }), RangeError);
    assert.throws(() => detectDefects(chroma, { sampleStep: 0 }), RangeError);
  });
});
