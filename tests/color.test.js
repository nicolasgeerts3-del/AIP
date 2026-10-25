import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { median, rgbToLab } from '../src/core/color.js';

const close = (actual, expected, tolerance = 0.05) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected} ± ${tolerance}`);

describe('rgbToLab', () => {
  it('convertit le blanc, le noir et le gris en couleurs neutres', () => {
    const white = rgbToLab(255, 255, 255);
    // Tolérance 0,02 : les coefficients de la matrice sRGB sont arrondis à 4 décimales.
    close(white[0], 100); close(white[1], 0, 0.02); close(white[2], 0, 0.02);
    assert.deepEqual(rgbToLab(0, 0, 0).map((value) => Math.round(value * 100) / 100), [0, 0, 0]);
    const grey = rgbToLab(128, 128, 128);
    close(grey[1], 0, 0.02); close(grey[2], 0, 0.02);
  });

  it('donne les valeurs de référence pour les primaires sRGB', () => {
    const [l, a, b] = rgbToLab(255, 0, 0);
    close(l, 53.24, 0.1); close(a, 80.09, 0.2); close(b, 67.2, 0.2);
    const blue = rgbToLab(0, 0, 255);
    close(blue[0], 32.3, 0.1); close(blue[2], -107.86, 0.3);
  });
});

describe('median', () => {
  it('renvoie la médiane (valeur haute si nombre pair)', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 3);
    assert.equal(median([-5]), -5);
  });

  it('[D-02] ne modifie pas le tableau reçu (sinon a* et b* se désalignent)', () => {
    const values = [5, 1, 4, 2, 3];
    median(values);
    assert.deepEqual(values, [5, 1, 4, 2, 3]);
  });

  it('refuse une liste vide', () => {
    assert.throws(() => median([]), RangeError);
  });
});
