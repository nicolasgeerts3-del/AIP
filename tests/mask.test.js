import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cloneMask, combineLayers, componentBounds, countMask, createMask, dilate, erode,
  paintEllipse, paintStroke, removeSmallComponents, resampleMaxPool
} from '../src/core/mask.js';
import { randomMask, rectMask } from './helpers/fixtures.js';

// Implémentations naïves de référence (celles de l'ancienne version).
function naiveMorph(mask, radius, erodeMode) {
  const { width, height } = mask;
  const output = createMask(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = erodeMode ? 1 : 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = x + dx; const sy = y + dy;
          const inside = sx >= 0 && sx < width && sy >= 0 && sy < height;
          const on = inside && mask.data[sy * width + sx];
          if (erodeMode && !on) value = 0;
          if (!erodeMode && on) value = 1;
        }
      }
      output.data[y * width + x] = value;
    }
  }
  return output;
}

describe('createMask', () => {
  it('crée un masque vide aux bonnes dimensions', () => {
    const mask = createMask(3, 2);
    assert.equal(mask.data.length, 6);
    assert.equal(countMask(mask), 0);
  });

  it('refuse des dimensions ou des données incohérentes', () => {
    assert.throws(() => createMask(0, 5), RangeError);
    assert.throws(() => createMask(2.5, 5), RangeError);
    assert.throws(() => createMask(2, 2, new Uint8Array(3)), RangeError);
  });

  it('cloneMask produit une copie indépendante', () => {
    const mask = createMask(2, 2); const copy = cloneMask(mask);
    copy.data[0] = 1;
    assert.equal(mask.data[0], 0);
  });
});

describe('dilate / erode', () => {
  for (const radius of [0, 1, 2, 3]) {
    it(`donnent le même résultat que l’implémentation naïve (rayon ${radius})`, () => {
      for (const [seed, density] of [[1, 0.05], [2, 0.5], [3, 0.9]]) {
        const mask = randomMask(37, 23, density, seed);
        assert.deepEqual(dilate(mask, radius).data, naiveMorph(mask, radius, false).data);
        assert.deepEqual(erode(mask, radius).data, naiveMorph(mask, radius, true).data);
      }
    });
  }

  it('dilate un point en carré de côté 2r + 1', () => {
    const mask = rectMask(11, 11, [{ x0: 5, y0: 5, x1: 6, y1: 6 }]);
    assert.equal(countMask(dilate(mask, 2)), 25);
  });

  it('l’érosion considère l’extérieur comme vide', () => {
    const full = rectMask(5, 5, [{ x0: 0, y0: 0, x1: 5, y1: 5 }]);
    assert.equal(countMask(erode(full, 1)), 9);
  });

  it('refuse un rayon négatif ou non entier', () => {
    assert.throws(() => dilate(createMask(3, 3), -1), RangeError);
    assert.throws(() => erode(createMask(3, 3), 1.5), RangeError);
  });
});

describe('composantes connexes', () => {
  const mask = rectMask(20, 10, [{ x0: 1, y0: 1, x1: 4, y1: 3 }, { x0: 10, y0: 5, x1: 11, y1: 6 }, { x0: 15, y0: 0, x1: 20, y1: 10 }]);

  it('componentBounds renvoie une boîte par composante (bornes hautes exclusives)', () => {
    const bounds = componentBounds(mask).sort((a, b) => a.x0 - b.x0);
    assert.deepEqual(bounds, [
      { x0: 1, y0: 1, x1: 4, y1: 3, size: 6 },
      { x0: 10, y0: 5, x1: 11, y1: 6, size: 1 },
      { x0: 15, y0: 0, x1: 20, y1: 10, size: 50 }
    ]);
  });

  it('ne relie pas les bords gauche et droit de deux lignes consécutives', () => {
    const wrap = rectMask(4, 2, [{ x0: 3, y0: 0, x1: 4, y1: 1 }, { x0: 0, y0: 1, x1: 1, y1: 2 }]);
    assert.equal(componentBounds(wrap).length, 2);
  });

  it('removeSmallComponents supprime uniquement les petites composantes', () => {
    const filtered = removeSmallComponents(mask, 4);
    assert.equal(countMask(filtered), 56);
    assert.equal(filtered.data[5 * 20 + 10], 0);
  });
});

describe('combineLayers', () => {
  it('applique (auto OU ajout) ET NON effacement', () => {
    const auto = createMask(4, 1, Uint8Array.from([1, 1, 0, 0]));
    const added = createMask(4, 1, Uint8Array.from([0, 0, 1, 0]));
    const erased = createMask(4, 1, Uint8Array.from([0, 1, 1, 0]));
    assert.deepEqual([...combineLayers(auto, added, erased).data], [1, 0, 0, 0]);
  });

  it('refuse des calques de tailles différentes', () => {
    assert.throws(() => combineLayers(createMask(2, 2), createMask(2, 2), createMask(3, 2)), RangeError);
  });
});

describe('resampleMaxPool', () => {
  it('ne perd jamais un défaut d’un pixel en réduisant la résolution (régression)', () => {
    for (const [x, y] of [[0, 0], [699, 0], [350, 466], [698, 932], [123, 777]]) {
      const source = createMask(700, 933); source.data[y * 700 + x] = 1;
      const grid = resampleMaxPool(source, 600, 900);
      assert.ok(countMask(grid) >= 1, `défaut en (${x}, ${y}) perdu`);
    }
  });

  it('agrandit sans trou et conserve la position relative', () => {
    const source = rectMask(10, 10, [{ x0: 5, y0: 5, x1: 6, y1: 6 }]);
    const big = resampleMaxPool(source, 30, 30);
    assert.equal(countMask(big), 9);
    assert.equal(big.data[16 * 30 + 16], 1);
  });

  it('un masque plein reste plein, un masque vide reste vide', () => {
    assert.equal(countMask(resampleMaxPool(rectMask(7, 9, [{ x0: 0, y0: 0, x1: 7, y1: 9 }]), 13, 4)), 52);
    assert.equal(countMask(resampleMaxPool(createMask(7, 9), 13, 4)), 0);
  });
});

describe('pinceau', () => {
  it('paintEllipse peint un disque de surface ≈ πr² et compte les changements', () => {
    const mask = createMask(50, 50);
    const changed = paintEllipse(mask, 25, 25, 10, 10, 1);
    assert.equal(changed, countMask(mask));
    assert.ok(Math.abs(changed - Math.PI * 100) < 20);
    assert.equal(paintEllipse(mask, 25, 25, 10, 10, 1), 0, 'repeindre la même zone ne change rien');
  });

  it('paintEllipse touche toujours au moins le pixel visé, même avec un rayon nul', () => {
    const mask = createMask(5, 5);
    paintEllipse(mask, 2.2, 3.7, 0, 0, 1);
    assert.equal(mask.data[3 * 5 + 2], 1);
  });

  it('paintEllipse respecte les bords sans erreur', () => {
    const mask = createMask(5, 5);
    paintEllipse(mask, -1, -1, 4, 4, 1);
    paintEllipse(mask, 100, 100, 4, 4, 1);
    assert.equal(mask.data[0], 1);
    assert.ok(countMask(mask) < 25);
  });

  it('paintStroke trace un trait continu même pour un mouvement rapide (régression)', () => {
    const mask = createMask(200, 20);
    paintStroke(mask, { x: 5, y: 10 }, { x: 195, y: 10 }, 2, 2, 1);
    for (let x = 5; x < 195; x += 1) assert.equal(mask.data[10 * 200 + x], 1, `trou en x=${x}`);
  });

  it('paintStroke en mode 0 efface', () => {
    const mask = rectMask(20, 20, [{ x0: 0, y0: 0, x1: 20, y1: 20 }]);
    paintStroke(mask, { x: 10, y: 10 }, { x: 10, y: 10 }, 3, 3, 0);
    assert.equal(mask.data[10 * 20 + 10], 0);
  });
});
