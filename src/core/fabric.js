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
