// Imbrication des patrons sur la grille physique (D-30).
//
// Principe :
//  1. On cherche le plus grand nombre K de T-shirts complets qui rentrent
//     (recherche dichotomique sur K) ; on ne pose que les pièces de ces K
//     T-shirts, donc pas de manches ou de bandes orphelines (D-22).
//  2. Chaque pièce va au premier emplacement libre « le plus bas puis le plus
//     à gauche », cherché sur TOUTE la grille, cellule par cellule. La
//     recherche saute d'un coup les zones occupées et les trous trop courts
//     grâce aux longueurs de cases consécutives de chaque ligne (Occupancy.run).
//  3. Plusieurs ordres de pose sont essayés ; on garde le plan avec le plus
//     de T-shirts, puis le plus compact (la plus grande chute réutilisable).
//
// Un placement est { name, pass, x, y, shape } : la pièce `name` du T-shirt
// numéro `pass`, avec la forme rastérisée `shape` (une orientation) posée à
// l'origine (x, y) de la grille. Voir rasterizePiece pour le repère.
import { KIT, PLACEMENT_ORDERS, SAFE_CLEARANCE_CELLS } from '../config.js';
import { rasterizePiece } from './geometry.js';
import { createMask, dilate } from './mask.js';

/** Segments horizontaux [ligne, colonneDébut, colonneFin[ d'une forme, du plus large au plus étroit. */
export function shapeSpans(shape) {
  const spans = [];
  shape.rows.forEach((columns, row) => {
    let start = null;
    columns.forEach((column, index) => {
      if (start === null) start = column;
      if (index === columns.length - 1 || columns[index + 1] !== column + 1) { spans.push([row, start, column + 1]); start = null; }
    });
  });
  // Les segments larges rejettent une position bloquée plus vite et donnent de plus grands sauts.
  return spans.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]));
}

/** Pré-calcule les orientations autorisées de chaque patron : { NOM: shape[] }. */
export function buildPieceShapes(pieces, { cellCm, angles }) {
  if (!Array.isArray(angles) || angles.length === 0 || !angles.every(Number.isFinite)) {
    throw new RangeError(`Liste d’orientations invalide : ${JSON.stringify(angles)}`);
  }
  const unique = [...new Set(angles.map((angle) => ((angle % 360) + 360) % 360))];
  return Object.fromEntries(Object.entries(pieces).map(([name, polygon]) => [name, unique.map((angle) => {
    const shape = rasterizePiece(polygon, angle, cellCm);
    return { ...shape, spans: shapeSpans(shape) };
  })]));
}

export function shapeBox(shape, x, y) {
  const left = x + shape.minX; const top = y + shape.minY;
  return { x0: left, y0: top, x1: left + shape.width, y1: top + shape.height };
}

function insideGrid(box, grid) {
  return box.x0 >= 0 && box.y0 >= 0 && box.x1 <= grid.width && box.y1 <= grid.height;
}

/** Marque la pièce et sa marge de sécurité comme occupées dans un masque { width, height, data }. */
export function stampPiece(occupancy, shape, x, y, clearance) {
  const { width, height, data } = occupancy;
  const box = shapeBox(shape, x, y);
  for (let row = 0; row < shape.height; row += 1) {
    for (const column of shape.rows[row]) {
      const cx = box.x0 + column; const cy = box.y0 + row;
      for (let dy = -clearance; dy <= clearance; dy += 1) {
        const ny = cy + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -clearance; dx <= clearance; dx += 1) {
          const nx = cx + dx;
          if (nx >= 0 && nx < width) data[ny * width + nx] = 1;
        }
      }
    }
  }
}

/**
 * Grille d'occupation (défauts dilatés de la marge, puis pièces posées avec
 * leur marge) et, pour chaque case, la longueur de la série de cases de même
 * état vers la droite sur sa ligne : run > 0 pour une série libre, run < 0
 * (moins la longueur) pour une série occupée.
 */
export class Occupancy {
  constructor(gridMask, clearance) {
    const { width, height, data } = dilate(gridMask, clearance);
    Object.assign(this, { width, height, data, clearance });
    this.run = new Int32Array(width * height);
    this.refreshRows(0, height);
  }

  refreshRows(y0, y1) {
    const { width, data, run } = this;
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y += 1) {
      let free = 0; let occupied = 0;
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x;
        if (data[index]) { occupied += 1; free = 0; run[index] = -occupied; } else { free += 1; occupied = 0; run[index] = free; }
      }
    }
  }

  /**
   * 0 si la forme tient à l'origine (x, y), sinon le nombre de colonnes dont
   * il faut au moins la décaler vers la droite avant qu'elle ait une chance de
   * tenir (Infinity si elle sort de la grille).
   */
  blockedShift(shape, x, y) {
    const box = shapeBox(shape, x, y);
    if (!insideGrid(box, this)) return Infinity;
    for (const [row, start, end] of shape.spans) {
      const index = (box.y0 + row) * this.width + box.x0 + start;
      const run = this.run[index];
      if (run < 0) return -run; // case occupée : sauter toute la série occupée
      if (run < end - start) {
        // Trou trop court qui touche le bord droit : rien ne rentrera plus loin sur cette ligne.
        if (box.x0 + start + run >= this.width) return Infinity;
        return run - this.run[index + run]; // sauter le trou et la série occupée qui le suit
      }
    }
    return 0;
  }

  place(shape, x, y) {
    stampPiece(this, shape, x, y, this.clearance);
    const box = shapeBox(shape, x, y);
    this.refreshRows(box.y0 - this.clearance, box.y1 + this.clearance);
  }
}

/** Critères de placement : quel bord de la pièce doit être le plus haut possible sur la grille. */
export const FIT_CRITERIA = Object.freeze(['bord-bas', 'bord-haut']);

/**
 * Premier emplacement libre parmi les orientations, puis le plus à gauche :
 *  - 'bord-bas' : le bas de la pièce le plus haut possible ;
 *  - 'bord-haut' : le haut de la pièce le plus haut possible.
 * null si rien ne rentre.
 */
export function findFirstFit(name, orientations, occupancy, criterion = 'bord-bas') {
  if (!FIT_CRITERIA.includes(criterion)) throw new RangeError(`Critère de placement inconnu : ${criterion}`);
  const byBottom = criterion === 'bord-bas';
  let best = null; let bestKey = Infinity; let bestLeft = Infinity;
  for (const shape of orientations) {
    const maxTop = occupancy.height - shape.height; const maxLeft = occupancy.width - shape.width;
    for (let top = 0; top <= maxTop; top += 1) {
      const key = byBottom ? top + shape.height : top;
      if (key > bestKey) break; // les lignes suivantes ne peuvent que faire moins bien
      let found = false;
      for (let left = 0; left <= maxLeft;) {
        if (key === bestKey && left >= bestLeft) break;
        const x = left - shape.minX; const y = top - shape.minY;
        const shift = occupancy.blockedShift(shape, x, y);
        if (shift === 0) { best = { name, x, y, shape }; bestKey = key; bestLeft = left; found = true; break; }
        left += shift;
      }
      if (found) break;
    }
  }
  return best;
}

export function countCompleteKits(placements, kit = KIT) {
  const counts = Object.fromEntries(Object.keys(kit).map((name) => [name, 0]));
  for (const placement of placements) if (placement.name in counts) counts[placement.name] += 1;
  return Math.min(...Object.entries(kit).map(([name, needed]) => Math.floor(counts[name] / needed)));
}

export function scorePlan(placements, kit = KIT) {
  return {
    completeKits: countCompleteKits(placements, kit),
    pieceCount: placements.length,
    usedAreaCm2: placements.reduce((sum, placement) => sum + placement.shape.areaCm2, 0),
    // Bas de la pièce la plus basse : plus il est haut, plus la chute restante est grande.
    extentCells: placements.reduce((max, placement) => Math.max(max, shapeBox(placement.shape, placement.x, placement.y).y1), 0)
  };
}

/** Priorité : T-shirts complets, puis plan le plus compact, puis surface utilisée (D-05). */
export function isBetterScore(candidate, reference) {
  if (candidate.completeKits !== reference.completeKits) return candidate.completeKits > reference.completeKits;
  if (candidate.extentCells !== reference.extentCells) return candidate.extentCells < reference.extentCells;
  return candidate.usedAreaCm2 > reference.usedAreaCm2 + 1e-9;
}

/**
 * Liste ordonnée des pièces à poser pour `kits` T-shirts.
 *  - 'par-taille' : toutes les grandes pièces, puis les plus petites dans les trous ;
 *  - 'par-tshirt' : T-shirt par T-shirt, de la plus grande à la plus petite pièce.
 * Chaque entrée est { name, pass } où pass est le numéro du T-shirt (D-26).
 */
export function pieceSequence(kits, order, kit, shapes) {
  const area = (name) => shapes[name][0].areaCm2;
  const names = Object.keys(kit).sort((a, b) => area(b) - area(a));
  const sequence = [];
  if (order === 'par-taille') {
    for (const name of names) for (let pass = 1; pass <= kits; pass += 1) for (let i = 0; i < kit[name]; i += 1) sequence.push({ name, pass });
  } else if (order === 'par-tshirt') {
    for (let pass = 1; pass <= kits; pass += 1) for (const name of names) for (let i = 0; i < kit[name]; i += 1) sequence.push({ name, pass });
  } else {
    throw new RangeError(`Ordre de pose inconnu : ${order}`);
  }
  return sequence;
}

/**
 * Validation indépendante de l'algorithme qui a produit le plan :
 * chaque pièce dans le tissu, hors défauts + marge, sans chevaucher les autres.
 */
export function validatePlan(placements, gridMask, clearance = SAFE_CLEARANCE_CELLS) {
  const occupancy = dilate(gridMask, clearance);
  for (let index = 0; index < placements.length; index += 1) {
    const { shape, x, y, name } = placements[index];
    if (!shape || !Array.isArray(shape.rows) || !Number.isInteger(x) || !Number.isInteger(y)) {
      return { ok: false, index, reason: `Placement ${index + 1} (${name}) mal formé` };
    }
    const box = shapeBox(shape, x, y);
    if (!insideGrid(box, occupancy)) return { ok: false, index, reason: `${name} sort du tissu` };
    for (let row = 0; row < shape.height; row += 1) {
      for (const column of shape.rows[row]) {
        if (occupancy.data[(box.y0 + row) * occupancy.width + box.x0 + column]) {
          return { ok: false, index, reason: `${name} touche un défaut ou une autre pièce` };
        }
      }
    }
    stampPiece(occupancy, shape, x, y, clearance);
  }
  return { ok: true };
}

/** Borne haute du nombre de T-shirts, d'après la surface saine disponible. */
export function estimateMaxKits(gridMask, shapes, kit = KIT) {
  const kitCells = Object.entries(kit).reduce((sum, [name, count]) => sum + count * Math.min(...shapes[name].map((shape) => shape.cellCount)), 0);
  let free = 0;
  for (const value of gridMask.data) if (!value) free += 1;
  return Math.max(0, Math.floor(free / kitCells));
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine → même plan. */
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

/**
 * Variante bruitée de l'ordre « par taille » : chaque pièce est triée sur sa
 * surface multipliée par un facteur aléatoire, si bien que des pièces de
 * tailles voisines changent d'ordre d'un essai à l'autre.
 */
export function shuffledSequence(kits, kit, shapes, random, noise = 0.35) {
  return pieceSequence(kits, 'par-taille', kit, shapes)
    .map((item) => ({ item, key: shapes[item.name][0].areaCm2 * (1 - noise + 2 * noise * random()) }))
    .sort((a, b) => b.key - a.key)
    .map(({ item }) => item);
}

/**
 * Coins de départ du remplissage (D-30). Remplir depuis le bas ou la droite
 * revient à appliquer le même algorithme au tissu retourné : selon la place
 * des taches, un coin donne souvent un T-shirt de plus qu'un autre.
 */
export const FILL_CORNERS = Object.freeze([
  { id: 'haut-gauche', flipX: false, flipY: false },
  { id: 'bas-gauche', flipX: false, flipY: true },
  { id: 'haut-droite', flipX: true, flipY: false },
  { id: 'bas-droite', flipX: true, flipY: true }
]);

export function mirrorMask(mask, flipX, flipY) {
  if (!flipX && !flipY) return mask;
  const { width, height, data } = mask;
  const output = createMask(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceRow = (flipY ? height - 1 - y : y) * width;
    for (let x = 0; x < width; x += 1) output.data[y * width + x] = data[sourceRow + (flipX ? width - 1 - x : x)];
  }
  return output;
}

/**
 * Forme retournée, pour le tissu retourné. `source` garde la forme d'origine :
 * une forme retournée posée en x' sur un tissu retourné de largeur W
 * correspond exactement à la forme d'origine posée en W − x' (idem en y).
 */
export function mirrorShape(shape, flipX, flipY) {
  if (!flipX && !flipY) return shape;
  const { width, height } = shape;
  const rows = Array.from({ length: height }, (_, row) => {
    const columns = shape.rows[flipY ? height - 1 - row : row];
    return flipX ? columns.map((column) => width - 1 - column).reverse() : [...columns];
  });
  const mirrored = {
    ...shape, rows, source: shape,
    offsets: rows.flatMap((columns, row) => columns.map((column) => row * width + column)),
    minX: flipX ? -(shape.minX + width) : shape.minX,
    minY: flipY ? -(shape.minY + height) : shape.minY,
    outline: shape.outline.map(([x, y]) => [flipX ? -x : x, flipY ? -y : y])
  };
  return { ...mirrored, spans: shapeSpans(mirrored) };
}

const mirroredShapeCache = new WeakMap();
function shapesForCorner(shapes, corner) {
  if (!corner.flipX && !corner.flipY) return shapes;
  if (!mirroredShapeCache.has(shapes)) mirroredShapeCache.set(shapes, new Map());
  const cache = mirroredShapeCache.get(shapes);
  if (!cache.has(corner.id)) {
    cache.set(corner.id, Object.fromEntries(Object.entries(shapes).map(([name, list]) => [name, list.map((shape) => mirrorShape(shape, corner.flipX, corner.flipY))])));
  }
  return cache.get(corner.id);
}

/**
 * Pose les pièces de `sequence` dans l'ordre, chacune au premier emplacement
 * libre, en remplissant depuis le coin `corner`. S'arrête dès qu'une pièce
 * ne rentre pas. Les placements renvoyés sont toujours exprimés sur le tissu
 * d'origine. Renvoie { ok, placements, aborted }.
 */
export async function packSequence({
  sequence, gridMask, shapes, clearance, criterion = 'bord-bas', corner = 'haut-gauche', tick = async () => {}, shouldAbort = () => false
}) {
  const fill = FILL_CORNERS.find((candidate) => candidate.id === corner);
  if (!fill) throw new RangeError(`Coin de départ inconnu : ${corner}`);
  const localShapes = shapesForCorner(shapes, fill);
  const occupancy = new Occupancy(mirrorMask(gridMask, fill.flipX, fill.flipY), clearance);
  const placements = [];
  const result = (ok, aborted) => ({
    ok, aborted,
    placements: placements.map((placement) => ({
      ...placement,
      shape: placement.shape.source ?? placement.shape,
      x: fill.flipX ? gridMask.width - placement.x : placement.x,
      y: fill.flipY ? gridMask.height - placement.y : placement.y
    }))
  });
  for (const { name, pass } of sequence) {
    if (shouldAbort()) return result(false, true);
    const placement = findFirstFit(name, localShapes[name], occupancy, criterion);
    if (!placement) return result(false, false);
    occupancy.place(placement.shape, placement.x, placement.y);
    placements.push({ ...placement, pass });
    await tick();
  }
  return result(true, false);
}

/**
 * Phase 1 : combinaisons déterministes (ordre de pose × coin de départ). La
 * première fait une recherche dichotomique du nombre de T-shirts ; les
 * suivantes tentent seulement d'en caser un de plus que le meilleur plan.
 * Phase 2 : pendant `timeBudgetMs`, essais aléatoires (ordre bruité, coin et
 * critère tirés au sort) pour gagner encore un T-shirt.
 * Le meilleur plan est revalidé indépendamment de l'algorithme.
 * onProgress(fraction 0–1) ; shouldAbort() annule si une entrée change (D-08).
 * Renvoie { placements, score, origin, validation, aborted }.
 */
export async function nestPieces({
  gridMask, shapes, orders = PLACEMENT_ORDERS, clearance = SAFE_CLEARANCE_CELLS, kit = KIT,
  maxKits, timeBudgetMs = 2500, seed = 1, onProgress = () => {}, yieldToUi = nextTick, shouldAbort = () => false, yieldEveryMs = 40
}) {
  if (!orders.length) throw new RangeError('Aucun ordre de pose fourni');
  for (const name of Object.keys(kit)) if (!shapes[name]) throw new RangeError(`Pièce du T-shirt sans patron : ${name}`);
  const upper = maxKits ?? estimateMaxKits(gridMask, shapes, kit);
  // Laisse respirer l'interface toutes les ~40 ms plutôt qu'à chaque pièce
  // (setTimeout(0) coûte au moins 4 ms dans un navigateur).
  let lastYield = Date.now();
  const tick = async () => { if (Date.now() - lastYield >= yieldEveryMs) { await yieldToUi(); lastYield = Date.now(); } };
  const pack = (sequence, options) => packSequence({ sequence, gridMask, shapes, clearance, tick, shouldAbort, ...options });
  const cancelled = { placements: [], score: scorePlan([], kit), origin: null, validation: { ok: false, reason: 'Calcul annulé' }, aborted: true };

  let best = { placements: [], score: scorePlan([], kit), origin: null };
  const consider = (placements, origin) => {
    const score = scorePlan(placements, kit);
    if (isBetterScore(score, best.score)) best = { placements, score, origin };
  };

  // Phase 1 (≈ 40 % de la barre de progression).
  const combos = orders.flatMap(({ id }) => FILL_CORNERS.map((corner) => ({ order: id, corner: corner.id, criterion: 'bord-bas' })));
  for (let index = 0; index < combos.length; index += 1) {
    const combo = combos[index];
    const origin = `${combo.order} / ${combo.corner}`;
    if (index === 0) {
      // Invariant : `low` T-shirts rentrent, plus de `high` ne rentrent pas.
      let low = 0; let high = upper;
      while (low < high) {
        const kits = Math.ceil((low + high) / 2);
        const result = await pack(pieceSequence(kits, combo.order, kit, shapes), combo);
        if (result.aborted) return cancelled;
        if (result.ok) { consider(result.placements, origin); low = kits; } else high = kits - 1;
      }
    } else {
      while (best.score.completeKits < upper) {
        const result = await pack(pieceSequence(best.score.completeKits + 1, combo.order, kit, shapes), combo);
        if (result.aborted) return cancelled;
        if (!result.ok) break;
        consider(result.placements, origin);
      }
    }
    onProgress(0.4 * (index + 1) / combos.length);
  }

  // Phase 2 : un T-shirt de plus ?
  const random = seededRandom(seed);
  const pick = (list) => list[Math.floor(random() * list.length)];
  const start = Date.now();
  while (best.score.completeKits < upper && Date.now() - start < timeBudgetMs) {
    // Bruit variable d'un essai à l'autre : petits échanges locaux comme grands bouleversements.
    const noise = pick([0.1, 0.25, 0.4, 0.6]);
    const options = { corner: pick(FILL_CORNERS).id, criterion: pick(FIT_CRITERIA) };
    const result = await pack(shuffledSequence(best.score.completeKits + 1, kit, shapes, random, noise), options);
    onProgress(0.4 + 0.6 * Math.min(1, (Date.now() - start) / timeBudgetMs));
    if (result.aborted) return cancelled;
    if (result.ok) consider(result.placements, `aléatoire / ${options.corner} / ${options.criterion}`);
  }
  onProgress(1);
  return { ...best, validation: validatePlan(best.placements, gridMask, clearance), aborted: false };
}
