// Détection automatique des taches. Deux tests complémentaires, combinés par OU :
//  1. teinte : écart de chromaticité à la couleur médiane du tissu, mesuré
//     après normalisation de l'intensité, donc insensible aux ombres (D-17) ;
//  2. luminosité : écart à la luminosité locale (moyenne glissante), qui
//     détecte les taches sans changement de teinte (D-18) tout en ignorant les
//     variations lentes d'éclairage.
// Les seuils sont exprimés en écarts-types du bruit du tissu (estimés de façon
// robuste) : le grain d'un tissu texturé relève le seuil tout seul.
// Le nettoyage se fait par hystérésis (D-54) : un pixel « faible » n'est gardé
// que s'il appartient à un groupe assez grand ou contenant un pixel « fort ».
// Un trait fin (crayon, fil tiré) forme un long groupe et reste détecté, alors
// que le bruit isolé disparaît — l'ancienne érosion effaçait les deux.
import { DEFAULT_MAD_FACTOR } from '../config.js';
import { linearLuminance, linearToLab, median, srgbToLinear } from './color.js';
import { createMask, dilate, fillHoles, filterComponents } from './mask.js';

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

/** Écart-type robuste d'écarts signés centrés sur 0 : 1,4826 × médiane des valeurs absolues. */
function robustSigma(sampledResiduals, minSigma) {
  return Math.max(minSigma, 1.4826 * median(sampledResiduals.map(Math.abs)));
}

/** Rapport entre un pixel « fort » et le seuil de détection (hystérésis). */
const STRONG_FACTOR = 1.6;
/** Rapport entre un pixel « ténu » (prolonge une tache déjà retenue) et le seuil de détection. */
const FAINT_FACTOR = 0.6;

/**
 * Étend `mask` aux pixels de `candidates` qui le touchent, de proche en proche
 * (8 voisins) : prolonge un trait dont une partie est trop pâle pour être
 * détectée seule, sans créer de nouvelle tache.
 */
function growInto(mask, candidates) {
  const { width, height, data } = mask;
  const queue = [];
  for (let index = 0; index < data.length; index += 1) if (data[index]) queue.push(index);
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]; const x = current % width; const y = (current - x) / width;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= height) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        const next = ny * width + nx;
        if (!data[next] && candidates[next]) { data[next] = 1; queue.push(next); }
      }
    }
  }
  return mask;
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
  useLuminance = true, localWindowFraction = 0.1, minLuminanceDelta = 4, minChromaDelta = 4, minGroupSize
} = {}) {
  if (!Number.isFinite(madFactor) || madFactor <= 0) throw new RangeError(`Facteur MAD invalide : ${madFactor}`);
  if (!Number.isInteger(sampleStep) || sampleStep < 1) throw new RangeError(`Pas d’échantillonnage invalide : ${sampleStep}`);
  const { width, height, L, a, b } = planes;
  const sampledIndexes = [];
  for (let y = 0; y < height; y += sampleStep) for (let x = 0; x < width; x += sampleStep) sampledIndexes.push(y * width + x);

  // 1. Teinte (intensité normalisée).
  const center = { a: median(sampledIndexes.map((index) => a[index])), b: median(sampledIndexes.map((index) => b[index])) };
  const chromaDistance = (index) => { const da = a[index] - center.a; const db = b[index] - center.b; return Math.sqrt(da * da + db * db); };
  // Les planchers suivent le curseur : plus sensible = écarts plus faibles acceptés.
  const floorScale = madFactor / DEFAULT_MAD_FACTOR;
  // La distance de teinte suit une loi de Rayleigh : médiane = 1,177 × écart-type.
  const chromaSigma = Math.max(minMad, median(sampledIndexes.map(chromaDistance)) / 1.177);
  const chroma = { threshold: Math.max(minChromaDelta * floorScale, madFactor * chromaSigma), mad: chromaSigma };
  const raw = createMask(width, height);
  const strong = new Uint8Array(raw.data.length);
  const faint = new Uint8Array(raw.data.length);
  for (let pixel = 0; pixel < raw.data.length; pixel += 1) {
    const distance = chromaDistance(pixel);
    if (distance > FAINT_FACTOR * chroma.threshold) faint[pixel] = 1;
    if (distance > chroma.threshold) { raw.data[pixel] = 1; if (distance > STRONG_FACTOR * chroma.threshold) strong[pixel] = 1; }
  }

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
      const sigma = robustSigma(sampledIndexes.filter((index) => !excluded[index]).map((index) => L[index] - background[index]), minMad);
      luminanceThreshold = Math.max(minLuminanceDelta * floorScale, madFactor * sigma);
      luminanceHits = new Uint8Array(raw.data.length);
      for (let pixel = 0; pixel < raw.data.length; pixel += 1) {
        const gap = residual(pixel);
        if (gap > luminanceThreshold) luminanceHits[pixel] = gap > STRONG_FACTOR * luminanceThreshold ? 2 : 1;
      }
      excluded = raw.data.map((value, index) => (value || luminanceHits[index] ? 1 : 0));
    }
    const background = maskedBoxMean(L, excluded, width, height, radius, plain);
    for (let pixel = 0; pixel < raw.data.length; pixel += 1) {
      if (luminanceHits[pixel]) { raw.data[pixel] = 1; if (luminanceHits[pixel] === 2) strong[pixel] = 1; }
      if (Math.abs(L[pixel] - background[pixel]) > FAINT_FACTOR * luminanceThreshold) faint[pixel] = 1;
    }
  }

  // Hystérésis (D-54) : les pixels détectés sont regroupés (dilatation d'un
  // pixel, qui relie aussi les traits en diagonale et sert de marge de
  // sécurité) ; un groupe est gardé s'il est assez grand ou contient un pixel
  // fort. Puis on bouche l'intérieur des grandes taches dont seul le bord
  // ressort du fond local.
  // D-31 : un trou n'est bouché que s'il ne ressemble pas au tissu sain (sinon
  // un fond détecté tout autour de la photo ferait disparaître tout le tissu).
  const healthyL = median(sampledIndexes.map((index) => L[index]));
  const looksLikeStain = (cells) => {
    let lightGap = 0; let chromaGap = 0;
    for (const cell of cells) { lightGap += Math.abs(L[cell] - healthyL); chromaGap += chromaDistance(cell); }
    return lightGap / cells.length > Math.min(luminanceThreshold, 3 * minLuminanceDelta) || chromaGap / cells.length > chroma.threshold;
  };
  const groupSize = minGroupSize ?? Math.max(16, Math.round(width * height / 9000));
  const kept = filterComponents(dilate(raw, 1), (cells) => cells.length >= groupSize || cells.some((cell) => strong[cell]));
  const mask = fillHoles(growInto(kept, faint), looksLikeStain);
  return { mask, threshold: chroma.threshold, luminanceThreshold, center, mad: chroma.mad };
}
