// Détection automatique des taches par écart de chromaticité au tissu sain.
import { DEFAULT_MAD_FACTOR } from '../config.js';
import { median, rgbToLab } from './color.js';
import { createMask, dilate, erode, removeSmallComponents } from './mask.js';

/**
 * Convertit une image RGBA ({ width, height, data } comme un ImageData) en
 * plans a* et b*. Calcul fait une seule fois par image : le curseur MAD ne
 * relance ensuite que le seuillage.
 */
export function computeChroma(image) {
  const { width, height, data } = image ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Image de dimensions invalides : ${width} × ${height}`);
  }
  if (!data || data.length !== width * height * 4) throw new RangeError('Les données de l’image ne correspondent pas à ses dimensions (RGBA attendu)');
  const a = new Float32Array(width * height);
  const b = new Float32Array(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const lab = rgbToLab(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]);
    a[pixel] = lab[1]; b[pixel] = lab[2];
  }
  return { width, height, a, b };
}

/**
 * Seuil robuste : médiane + madFactor × MAD des distances chromatiques à la
 * couleur médiane du tissu. La luminance est ignorée volontairement pour ne
 * pas confondre plis et ombres avec des taches.
 * Renvoie { mask, threshold, center, mad } ; mask a la résolution de l'image.
 */
export function detectDefects(chroma, { madFactor = DEFAULT_MAD_FACTOR, sampleStep = 4, minMad = 0.5 } = {}) {
  if (!Number.isFinite(madFactor) || madFactor <= 0) throw new RangeError(`Facteur MAD invalide : ${madFactor}`);
  if (!Number.isInteger(sampleStep) || sampleStep < 1) throw new RangeError(`Pas d’échantillonnage invalide : ${sampleStep}`);
  const { width, height, a, b } = chroma;
  const sampledA = []; const sampledB = [];
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) { sampledA.push(a[y * width + x]); sampledB.push(b[y * width + x]); }
  }
  const center = { a: median(sampledA), b: median(sampledB) };
  const distances = sampledA.map((value, index) => Math.hypot(value - center.a, sampledB[index] - center.b));
  const distanceMedian = median(distances);
  const mad = Math.max(minMad, median(distances.map((value) => Math.abs(value - distanceMedian))));
  const threshold = distanceMedian + madFactor * mad;

  const raw = createMask(width, height);
  for (let pixel = 0; pixel < raw.data.length; pixel += 1) {
    raw.data[pixel] = Math.hypot(a[pixel] - center.a, b[pixel] - center.b) > threshold ? 1 : 0;
  }
  // Ouverture (supprime le bruit isolé) puis dilatation de sécurité.
  const mask = removeSmallComponents(dilate(erode(raw, 1), 2), 4);
  return { mask, threshold, center, mad };
}
