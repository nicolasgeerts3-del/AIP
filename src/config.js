// Paramètres physiques et métier de l'application. Toute la logique lit ses
// constantes ici : changer la taille du tissu ou la résolution ne doit se faire
// qu'à un seul endroit.

/** Dimensions réelles du coupon de tissu. */
export const FABRIC = Object.freeze({ widthCm: 300, heightCm: 450 });

/** Taille d'une cellule de la grille physique (0,5 cm = 5 mm). */
export const CELL_CM = 0.5;
export const CELL_MM = CELL_CM * 10;

/** Grille physique utilisée pour le nesting : 600 × 900 cellules. */
export const GRID = Object.freeze({
  width: Math.round(FABRIC.widthCm / CELL_CM),
  height: Math.round(FABRIC.heightCm / CELL_CM)
});

/** Marge de sécurité autour des défauts et entre les pièces (2 cellules = 1 cm). */
export const SAFE_CLEARANCE_CELLS = 2;

/** Pas angulaire testé pour chaque pièce (15° → 24 orientations). */
export const ROTATION_STEP_DEG = 15;

/** Largeur maximale de l'image analysée (en pixels). */
export const MAX_IMAGE_WIDTH = 700;

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

/** Ordres de placement essayés ; le meilleur plan est conservé. */
export const STRATEGIES = Object.freeze([
  ['DOS', 'DEVANT', 'MANCHE', 'MANCHE', 'BANDE'],
  ['MANCHE', 'MANCHE', 'DOS', 'DEVANT', 'BANDE'],
  ['DEVANT', 'DOS', 'BANDE', 'MANCHE', 'MANCHE']
]);

export const COLORS = Object.freeze({ DOS: '#3979b5', DEVANT: '#4f9b69', MANCHE: '#e58b3e', BANDE: '#8d6bb3' });
