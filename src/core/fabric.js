// Dimensions du coupon de tissu et grille physique associée (D-20).
import { CELL_CM, FABRIC_LIMITS } from '../config.js';

/**
 * Vérifie et normalise une taille de tissu saisie par l'utilisateur.
 * Renvoie { widthCm, heightCm } arrondis au demi-centimètre, ou lève une
 * RangeError avec un message affichable.
 */
export function validateFabric({ widthCm, heightCm }, limits = FABRIC_LIMITS) {
  const check = (value, label) => {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new RangeError(`${label} du tissu invalide`);
    if (number < limits.minCm || number > limits.maxCm) {
      throw new RangeError(`${label} du tissu hors limites : ${number} cm (de ${limits.minCm} à ${limits.maxCm} cm)`);
    }
    return Math.round(number / CELL_CM) * CELL_CM;
  };
  return Object.freeze({ widthCm: check(widthCm, 'Largeur'), heightCm: check(heightCm, 'Longueur') });
}

/** Grille de nesting d'un tissu : une cellule par CELL_CM. */
export function gridForFabric(fabric, cellCm = CELL_CM) {
  return { width: Math.round(fabric.widthCm / cellCm), height: Math.round(fabric.heightCm / cellCm) };
}

/** « 3,00 m × 4,50 m » */
export function formatFabric(fabric) {
  const meters = (cm) => (cm / 100).toFixed(2).replace('.', ',');
  return `${meters(fabric.widthCm)} m × ${meters(fabric.heightCm)} m`;
}

/**
 * D-29 : tissu aux proportions `ratio` (largeur / longueur) en gardant la
 * largeur demandée ; si la longueur sort des bornes, les deux côtés sont
 * réduits ou agrandis ensemble pour garder le rapport.
 */
export function fabricWithRatio(widthCm, ratio, limits = FABRIC_LIMITS) {
  if (!(ratio > 0) || !Number.isFinite(ratio)) throw new RangeError(`Proportions invalides : ${ratio}`);
  let width = Number(widthCm); let height = width / ratio;
  const scale = Math.min(1, limits.maxCm / Math.max(width, height));
  width *= scale; height *= scale;
  const grow = Math.max(1, limits.minCm / Math.min(width, height));
  return validateFabric({ widthCm: Math.min(limits.maxCm, width * grow), heightCm: Math.min(limits.maxCm, height * grow) }, limits);
}
