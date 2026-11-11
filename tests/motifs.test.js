// D-61 : détection des taches sur les tissus à motif (rayures, carreaux, pois).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeColorPlanes, detectDefects, detectOnPattern } from '../src/core/detection.js';
import { countMask } from '../src/core/mask.js';
import { fabricImage, seededRandom } from './helpers/fixtures.js';

const WIDTH = 320; const HEIGHT = 240;
const STAIN = { cx: 190, cy: 110, r: 26 };

/**
 * Tissu à motif : `colorAt(x, y)` donne la couleur du motif, une tache ronde
 * multiplie les couleurs par `tint` (comme un liquide absorbé), puis bruit et
 * dégradé d'éclairage de 12 %.
 */
function patternedImage(colorAt, { tint = null, noise = 4, seed = 9 } = {}) {
  const random = seededRandom(seed);
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let color = colorAt(x, y);
      if (tint && (x - STAIN.cx) ** 2 + (y - STAIN.cy) ** 2 <= STAIN.r ** 2) color = color.map((value, channel) => value * tint[channel]);
      const light = 1 - 0.12 * x / WIDTH; const jitter = (random() - 0.5) * 2 * noise; const out = (y * WIDTH + x) * 4;
      data[out] = (color[0] + jitter) * light; data[out + 1] = (color[1] + jitter) * light; data[out + 2] = (color[2] + jitter) * light; data[out + 3] = 255;
    }
  }
  return { width: WIDTH, height: HEIGHT, data };
}

const PATTERNS = {
  rayures: (x, y) => (Math.floor(y / 9) % 2 ? [44, 58, 96] : [238, 232, 220]),
  carreaux: (x, y) => { const a = Math.floor(x / 12) % 2; const b = Math.floor(y / 12) % 2; return a && b ? [196, 52, 58] : a || b ? [226, 150, 150] : [244, 240, 236]; },
  pois: (x, y) => (Math.hypot(((x + (Math.floor(y / 24) % 2) * 12) % 24) - 12, (y % 24) - 12) < 5 ? [244, 244, 240] : [52, 96, 170])
};
const COFFEE = [0.6, 0.45, 0.3];

/** Part de la tache couverte, et part du tissu sain marquée à plus de `margin` pixels de la tache. */
function score(mask, margin = 5) {
  let inside = 0; let hit = 0; let stray = 0; let healthy = 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const distance = Math.hypot(x - STAIN.cx, y - STAIN.cy); const marked = mask.data[y * WIDTH + x];
      if (distance <= STAIN.r) { inside += 1; if (marked) hit += 1; } else if (distance > STAIN.r + margin) { healthy += 1; if (marked) stray += 1; }
    }
  }
  return { coverage: hit / inside, stray: stray / healthy };
}

describe('[D-61] taches sur tissu à motif', () => {
  for (const [name, colorAt] of Object.entries(PATTERNS)) {
    it(`${name} : le motif est reconnu, la tache trouvée, le motif laissé tranquille`, () => {
      const result = detectDefects(computeColorPlanes(patternedImage(colorAt, { tint: COFFEE })));
      assert.equal(result.patterned, true, 'tissu à motif non reconnu');
      const { coverage, stray } = score(result.mask);
      assert.ok(coverage > 0.9, `tache couverte à ${(coverage * 100).toFixed(0)} %`);
      assert.ok(stray < 0.01, `${(stray * 100).toFixed(1)} % du motif marqué à tort`);
    });

    it(`${name} sans tache : presque rien n’est marqué`, () => {
      const { mask, patterned } = detectDefects(computeColorPlanes(patternedImage(colorAt)));
      assert.equal(patterned, true);
      assert.ok(countMask(mask) / mask.data.length < 0.005, `${countMask(mask)} pixels marqués sur un tissu sain`);
    });
  }

  it('l’ancienne méthode (tissu uni) échoue sur ces motifs : c’est bien la nouvelle qui les traite', () => {
    const planes = computeColorPlanes(patternedImage(PATTERNS.pois, { tint: COFFEE }));
    assert.ok(score(detectDefects(planes, { pattern: false }).mask).stray > 0.05, 'les pois devraient être pris pour des taches');
    assert.ok(score(detectDefects(planes, { pattern: true }).mask).stray < 0.01);
  });

  it('un tissu uni reste traité comme uni, avec ou sans tache', () => {
    const stain = { cx: 60, cy: 60, r: 10, color: [150, 60, 60] };
    assert.equal(detectDefects(computeColorPlanes(fabricImage(160, 120, { stains: [stain] }))).patterned, false);
    assert.equal(detectDefects(computeColorPlanes(fabricImage(160, 120))).patterned, false);
  });

  it('le mode peut être forcé, et le curseur règle la finesse des couleurs comparées', () => {
    const planes = computeColorPlanes(fabricImage(160, 120));
    assert.equal(detectDefects(planes, { pattern: true }).patterned, true);
    assert.equal(detectDefects(planes, { pattern: false }).patterned, false);
    assert.ok(detectOnPattern(planes, { madFactor: 2 }).binSize < detectOnPattern(planes, { madFactor: 7 }).binSize);
    assert.throws(() => detectOnPattern(planes, { madFactor: 0 }), RangeError);
  });
});
