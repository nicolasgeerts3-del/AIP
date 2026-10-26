// Paramètres physiques et métier de l'application. Toute la logique lit ses
// constantes ici : changer la taille du tissu ou la résolution ne doit se faire
// qu'à un seul endroit.

/** Version du code, comparée à celle de index.html au démarrage (D-33). À changer à chaque livraison. */
export const APP_VERSION = '2026-10-26.1';

/** Dimensions du coupon proposées par défaut ; modifiables dans l'interface (D-20). */
export const FABRIC = Object.freeze({ widthCm: 300, heightCm: 450 });

/** Bornes acceptées pour chaque côté du coupon, en cm. */
export const FABRIC_LIMITS = Object.freeze({ minCm: 20, maxCm: 1000 });

/** Taille d'une cellule de la grille physique (0,5 cm = 5 mm). */
export const CELL_CM = 0.5;
export const CELL_MM = CELL_CM * 10;

/** Marge de sécurité autour des défauts et entre les pièces (2 cellules = 1 cm). */
export const SAFE_CLEARANCE_CELLS = 2;

/**
 * Orientations autorisées pour les pièces (D-21). Les patrons sont dessinés
 * avec le droit-fil vertical, aligné sur la longueur du tissu : seuls 0° et
 * 180° le respectent. Les autres modes gagnent un peu de matière mais
 * déforment le vêtement.
 */
export const ORIENTATION_MODES = Object.freeze({
  'droit-fil': { label: 'Droit-fil (0° / 180°)', angles: [0, 180] },
  quarts: { label: 'Quarts de tour (0° / 90° / 180° / 270°)', angles: [0, 90, 180, 270] },
  libre: { label: 'Libre, pas de 15° (ignore le droit-fil)', angles: Array.from({ length: 24 }, (_, index) => index * 15) }
});
export const DEFAULT_ORIENTATION_MODE = 'droit-fil';

/** Largeur maximale de l'image analysée (en pixels). */
export const MAX_IMAGE_WIDTH = 700;

/** Largeur maximale conservée de la photo d'origine, pour un recadrage net (D-19). */
export const MAX_SOURCE_WIDTH = 1600;

/** Facteur MAD par défaut de la détection de taches. */
export const DEFAULT_MAD_FACTOR = 3.5;

/** Patrons d'un T-shirt, en centimètres. */
export const PIECES = Object.freeze({
  DOS: [[0,0],[52,0],[52,46],[50,58],[46,68],[36,73],[34,73],[30,70],[22,70],[18,73],[16,73],[6,68],[2,58],[0,46]],
  DEVANT: [[0,0],[52,0],[52,46],[50,58],[46,68],[36,72],[34,72],[32,66],[26,64],[20,66],[18,72],[16,72],[6,68],[2,58],[0,46]],
  MANCHE: [[0,0],[40,0],[37,10],[32,20],[23,26],[17,26],[8,20],[3,10]],
  BANDE: [[0,0],[58,0],[58,8],[0,8]]
});

/** Composition d'un T-shirt complet. */
export const KIT = Object.freeze({ DOS: 1, DEVANT: 1, MANCHE: 2, BANDE: 1 });

/**
 * Ordres de pose essayés par le nesting (D-30) ; le meilleur plan est conservé.
 * Voir pieceSequence dans src/core/nesting.js.
 */
export const PLACEMENT_ORDERS = Object.freeze([
  { id: 'par-taille', label: 'Grandes pièces d’abord, petites dans les trous' },
  { id: 'par-tshirt', label: 'T-shirt par T-shirt' }
]);

export const COLORS = Object.freeze({ DOS: '#3979b5', DEVANT: '#4f9b69', MANCHE: '#e58b3e', BANDE: '#8d6bb3' });
