// Détection automatique des taches. Deux tests complémentaires, combinés par OU :
//  1. teinte : écart de chromaticité à la couleur médiane du tissu, mesuré
//     après normalisation de l'intensité, donc insensible aux ombres (D-17) ;
//  2. luminosité : écart à la luminosité locale (moyenne glissante), qui
//     détecte les taches sans changement de teinte (D-18) tout en ignorant les
//     variations lentes d'éclairage.
import { DEFAULT_MAD_FACTOR } from '../config.js';
import { linearLuminance, linearToLab, median, srgbToLinear } from './color.js';
import { createMask, dilate, erode, fillHoles, removeSmallComponents } from './mask.js';

const MIN_LUMINANCE = 1e-4;

/**
 * Convertit une image RGBA ({ width, height, data } comme un ImageData) en
 * trois plans : L* (luminosité) et a*, b* calculés comme si chaque pixel avait
 * la luminance médiane de l'image. Calcul fait une seule fois par image : le
 * curseur MAD ne relance ensuite que le seuillage.
 */
export function computeColorPlanes(image) {
  const { width, height, data } = image ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Image de dimensions invalides : ${width} × ${height}`);
  }
  if (!data || data.length !== width * height * 4) throw new RangeError('Les données de l’image ne correspondent pas à ses dimensions (RGBA attendu)');
  const count = width * height;
  const linear = new Float32Array(count * 3);
  const luminance = new Float32Array(count);
  const L = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    const rl = srgbToLinear(data[pixel * 4]); const gl = srgbToLinear(data[pixel * 4 + 1]); const bl = srgbToLinear(data[pixel * 4 + 2]);
    linear[pixel * 3] = rl; linear[pixel * 3 + 1] = gl; linear[pixel * 3 + 2] = bl;
    luminance[pixel] = linearLuminance(rl, gl, bl);
    L[pixel] = linearToLab(rl, gl, bl)[0];
  }
  const sampled = [];
  for (let pixel = 0; pixel < count; pixel += 7) sampled.push(luminance[pixel]);
  const reference = Math.max(MIN_LUMINANCE, median(sampled));

  const a = new Float32Array(count); const b = new Float32Array(count);
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (luminance[pixel] < MIN_LUMINANCE) continue; // noir : teinte indéfinie, gérée par le test de luminosité
    const scale = reference / luminance[pixel];
    const lab = linearToLab(linear[pixel * 3] * scale, linear[pixel * 3 + 1] * scale, linear[pixel * 3 + 2] * scale);
    a[pixel] = lab[1]; b[pixel] = lab[2];
  }
  return { width, height, L, a, b };
}

/** Moyenne sur une fenêtre carrée de côté 2·radius + 1, bornée aux bords de l'image. */
export function boxMean(values, width, height, radius) {
  const rows = new Float32Array(values.length);
  const prefix = new Float64Array(Math.max(width, height) + 1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) prefix[x + 1] = prefix[x] + values[y * width + x];
    for (let x = 0; x < width; x += 1) {
      const low = Math.max(0, x - radius); const high = Math.min(width - 1, x + radius);
      rows[y * width + x] = (prefix[high + 1] - prefix[low]) / (high - low + 1);
    }
  }
  const output = new Float32Array(values.length);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) prefix[y + 1] = prefix[y] + rows[y * width + x];
    for (let y = 0; y < height; y += 1) {
      const low = Math.max(0, y - radius); const high = Math.min(height - 1, y + radius);
      output[y * width + x] = (prefix[high + 1] - prefix[low]) / (high - low + 1);
    }
  }
  return output;
}

/**
 * Moyenne glissante qui ignore les pixels exclus (excluded[i] = 1). Là où
 * toute la fenêtre est exclue, on retombe sur la moyenne simple.
 */
export function maskedBoxMean(values, excluded, width, height, radius, plain = boxMean(values, width, height, radius)) {
  const kept = new Float32Array(values.length); const weights = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    if (!excluded[index]) { kept[index] = values[index]; weights[index] = 1; }
  }
  const sum = boxMean(kept, width, height, radius); const weight = boxMean(weights, width, height, radius);
  for (let index = 0; index < values.length; index += 1) sum[index] = weight[index] > 1e-6 ? sum[index] / weight[index] : plain[index];
  return sum;
}

/** Seuil robuste sur des distances échantillonnées : médiane + facteur × MAD. */
function robustThreshold(sampledDistances, madFactor, minMad) {
  const center = median(sampledDistances);
  const mad = Math.max(minMad, median(sampledDistances.map((value) => Math.abs(value - center))));
  return { threshold: center + madFactor * mad, mad };
}

/**
 * Renvoie { mask, threshold, luminanceThreshold, center, mad } ; mask a la
 * résolution de l'image.
 * Options : madFactor (sensibilité commune aux deux tests), sampleStep,
 * minMad, useLuminance, localWindowFraction (taille de la fenêtre locale,
 * en fraction du petit côté de l'image), minLuminanceDelta (écart minimal
 * de L* pour éviter de signaler la texture du tissu).
 */
export function detectDefects(planes, {
  madFactor = DEFAULT_MAD_FACTOR, sampleStep = 4, minMad = 0.5,
  useLuminance = true, localWindowFraction = 0.1, minLuminanceDelta = 4
} = {}) {
  if (!Number.isFinite(madFactor) || madFactor <= 0) throw new RangeError(`Facteur MAD invalide : ${madFactor}`);
  if (!Number.isInteger(sampleStep) || sampleStep < 1) throw new RangeError(`Pas d’échantillonnage invalide : ${sampleStep}`);
  const { width, height, L, a, b } = planes;
  const sampledIndexes = [];
  for (let y = 0; y < height; y += sampleStep) for (let x = 0; x < width; x += sampleStep) sampledIndexes.push(y * width + x);

  // 1. Teinte (intensité normalisée).
  const center = { a: median(sampledIndexes.map((index) => a[index])), b: median(sampledIndexes.map((index) => b[index])) };
  const chromaDistance = (index) => { const da = a[index] - center.a; const db = b[index] - center.b; return Math.sqrt(da * da + db * db); };
  const chroma = robustThreshold(sampledIndexes.map(chromaDistance), madFactor, minMad);
  const raw = createMask(width, height);
  for (let pixel = 0; pixel < raw.data.length; pixel += 1) raw.data[pixel] = chromaDistance(pixel) > chroma.threshold ? 1 : 0;

  // 2. Luminosité locale. Le fond est recalculé en excluant les taches déjà
  // trouvées : sinon une tache sombre assombrit le fond autour d'elle et le
  // tissu sain voisin ressort comme « trop clair ».
  let luminanceThreshold = Infinity;
  if (useLuminance) {
    const radius = Math.max(2, Math.round(Math.min(width, height) * localWindowFraction));
    const plain = boxMean(L, width, height, radius);
    let excluded = raw.data.slice();
    let luminanceHits = new Uint8Array(raw.data.length);
    for (let pass = 0; pass < 3; pass += 1) {
      const background = maskedBoxMean(L, excluded, width, height, radius, plain);
      const residual = (index) => Math.abs(L[index] - background[index]);
      luminanceThreshold = Math.max(minLuminanceDelta, robustThreshold(sampledIndexes.map(residual), madFactor, minMad).threshold);
      luminanceHits = new Uint8Array(raw.data.length);
      for (let pixel = 0; pixel < raw.data.length; pixel += 1) if (residual(pixel) > luminanceThreshold) luminanceHits[pixel] = 1;
      excluded = raw.data.map((value, index) => value | luminanceHits[index]);
    }
    for (let pixel = 0; pixel < raw.data.length; pixel += 1) if (luminanceHits[pixel]) raw.data[pixel] = 1;
  }

  // Ouverture (supprime le bruit isolé), dilatation de sécurité, puis on bouche
  // l'intérieur des grandes taches dont seul le bord ressort du fond local.
  // D-31 : un trou n'est bouché que s'il ne ressemble pas au tissu sain (sinon
  // un fond détecté tout autour de la photo ferait disparaître tout le tissu).
  const healthyL = median(sampledIndexes.map((index) => L[index]));
  const looksLikeStain = (cells) => {
    let lightGap = 0; let chromaGap = 0;
    for (const cell of cells) { lightGap += Math.abs(L[cell] - healthyL); chromaGap += chromaDistance(cell); }
    return lightGap / cells.length > Math.min(luminanceThreshold, 3 * minLuminanceDelta) || chromaGap / cells.length > chroma.threshold;
  };
  const mask = fillHoles(removeSmallComponents(dilate(erode(raw, 1), 2), 4), looksLikeStain);
  return { mask, threshold: chroma.threshold, luminanceThreshold, center, mad: chroma.mad };
}
