// Données de test synthétiques partagées par les tests unitaires.
import { createMask } from '../../src/core/mask.js';

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomMask(width, height, density, seed = 1) {
  const random = seededRandom(seed);
  const mask = createMask(width, height);
  for (let i = 0; i < mask.data.length; i += 1) mask.data[i] = random() < density ? 1 : 0;
  return mask;
}

export function rectMask(width, height, rects) {
  const mask = createMask(width, height);
  for (const { x0, y0, x1, y1 } of rects) {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) mask.data[y * width + x] = 1;
  }
  return mask;
}

/**
 * Image RGBA de tissu beige légèrement bruité, avec des taches circulaires
 * { cx, cy, r, color: [r, g, b] }. `illumination(x, y)` renvoie un facteur
 * multiplicatif (ombre, dégradé d'éclairage). Renvoie un objet compatible ImageData.
 */
export function fabricImage(width, height, { base = [214, 200, 172], noise = 6, stains = [], seed = 7, illumination = () => 1 } = {}) {
  const random = seededRandom(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      let color = base;
      for (const stain of stains) if ((x - stain.cx) ** 2 + (y - stain.cy) ** 2 <= stain.r ** 2) color = stain.color;
      const jitter = (random() - 0.5) * 2 * noise;
      const light = illumination(x, y);
      data[out] = (color[0] + jitter) * light; data[out + 1] = (color[1] + jitter) * light; data[out + 2] = (color[2] + jitter) * light; data[out + 3] = 255;
    }
  }
  return { width, height, data };
}
