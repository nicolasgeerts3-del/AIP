// Paramètres physiques et métier de l'application. Toute la logique lit ses
// constantes ici : changer la taille du tissu ou la résolution ne doit se faire
// qu'à un seul endroit.

/** Version du code, comparée à celle de index.html au démarrage (D-33). À changer à chaque livraison. */
export const APP_VERSION = '2026-11-12.4';

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

/**
 * Matières proposées à l'étape 3 (D-56). Chacune règle trois choses :
 *  - oneWay : tissu à sens (poil, reflet) → toutes les pièces dans le même sens
 *    (0° seulement) ; sinon elles peuvent être posées tête-bêche (0° / 180°) ;
 *  - clearanceCells : marge autour des défauts et entre les pièces, plus large
 *    pour les tissus épais ou qui s'effilochent (1 cellule = 0,5 cm) ;
 *  - texture : relève les seuils de détection pour ne pas prendre le grain
 *    naturel du tissu (côtes, armure, poil) pour des taches.
 */
export const MATERIALS = Object.freeze({
  coton: { label: 'Coton (toile, popeline)', oneWay: false, clearanceCells: 2, texture: 1, tip: 'Tissu stable : les pièces peuvent être posées tête-bêche pour gagner de la place.' },
  jersey: { label: 'Jersey, maille', oneWay: false, clearanceCells: 2, texture: 1, tip: 'Maille extensible : pose le tissu sans le tendre, sinon les pièces rétrécissent après la coupe.' },
  jean: { label: 'Jean (denim)', oneWay: false, clearanceCells: 2, texture: 1.3, tip: 'Sergé épais : le grain en diagonale est normal, la détection en tient compte.' },
  lin: { label: 'Lin', oneWay: false, clearanceCells: 3, texture: 1.4, tip: 'Le lin s’effiloche et a des fils irréguliers : marge portée à 1,5 cm, grain ignoré.' },
  velours: { label: 'Velours', oneWay: true, clearanceCells: 3, texture: 1.4, tip: 'Tissu à poil : toutes les pièces dans le même sens, sinon la couleur change d’une pièce à l’autre.' },
  laine: { label: 'Laine (drap, lainage)', oneWay: true, clearanceCells: 3, texture: 1.5, tip: 'Lainage épais avec un sens : pièces dans le même sens, marge portée à 1,5 cm.' },
  satin: { label: 'Soie, satin', oneWay: true, clearanceCells: 2, texture: 1, tip: 'Tissu à reflet : pièces dans le même sens. Le tissu glisse, fixe-le avant de couper.' },
  polaire: { label: 'Polaire', oneWay: true, clearanceCells: 2, texture: 1.2, tip: 'Tissu à poil : toutes les pièces dans le même sens.' }
});
export const DEFAULT_MATERIAL = 'coton';

/** Orientations autorisées pour une matière : un seul sens pour les tissus à poil ou à reflet. */
export function materialAngles(material) { return material.oneWay ? [0] : [0, 180]; }

/**
 * Photos de test proposées sous « Importer une photo » (D-62), dans photos-test/.
 * Les n° 1 à 8 sont des images de synthèse ; les autres sont de vraies photos.
 */
export const SAMPLE_PHOTOS = Object.freeze([
  { file: '0-coton-plis-tache.webp', label: 'Coton froissé, grande tache' },
  { file: '9-jean-reel-taches.png', label: 'Jean, taches de terre' },
  { file: '1-rayures-cafe.jpg', label: 'Rayures, café' },
  { file: '2-vichy-graisse.jpg', label: 'Vichy, graisse' },
  { file: '3-tartan-javel.jpg', label: 'Tartan, javel' },
  { file: '4-pois-vin.jpg', label: 'Pois, vin' },
  { file: '5-jean-huile.jpg', label: 'Jean, huile' },
  { file: '6-fleuri-encre.jpg', label: 'Fleuri, encre et stylo' },
  { file: '7-chevrons-rouille.jpg', label: 'Chevrons, rouille' },
  { file: '8-lin-uni-herbe.jpg', label: 'Lin uni, herbe' }
]);
export const SAMPLE_FOLDER = 'photos-test';

/** Nombre d'exemplaires demandé par défaut, et borne du champ (D-57). */
export const DEFAULT_QUANTITY = 1;
export const MAX_QUANTITY = 200;

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
