// Placement glouton « bas-gauche » des pièces sur la grille physique.
//
// Un placement est { name, pass, x, y, shape } : la pièce `name`, posée au
// passage `pass`, avec la forme rastérisée `shape` (une orientation) à
// l'origine (x, y) de la grille. Voir rasterizePiece pour le repère.
import { KIT, SAFE_CLEARANCE_CELLS, STRATEGIES } from '../config.js';
import { rasterizePiece } from './geometry.js';
import { componentBounds, dilate } from './mask.js';

/** Pré-calcule les orientations autorisées de chaque patron : { NOM: shape[] }. */
export function buildPieceShapes(pieces, { cellCm, angles }) {
  if (!Array.isArray(angles) || angles.length === 0 || !angles.every(Number.isFinite)) {
    throw new RangeError(`Liste d’orientations invalide : ${JSON.stringify(angles)}`);
  }
  const unique = [...new Set(angles.map((angle) => ((angle % 360) + 360) % 360))];
  return Object.fromEntries(Object.entries(pieces).map(([name, polygon]) => [name, unique.map((angle) => rasterizePiece(polygon, angle, cellCm))]));
}

/** Image intégrale : integral[(y) * (w + 1) + x] = nombre de cellules occupées dans [0, x[ × [0, y[. */
export function buildIntegral(occupancy) {
  const { width, height, data } = occupancy;
  const stride = width + 1;
  const integral = new Uint32Array((height + 1) * stride);
  for (let y = 0; y < height; y += 1) {
    let rowTotal = 0;
    for (let x = 0; x < width; x += 1) {
      rowTotal += data[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowTotal;
    }
  }
  return integral;
}

export function shapeBox(shape, x, y) {
  const left = x + shape.minX; const top = y + shape.minY;
  return { x0: left, y0: top, x1: left + shape.width, y1: top + shape.height };
}

function insideGrid(box, grid) {
  return box.x0 >= 0 && box.y0 >= 0 && box.x1 <= grid.width && box.y1 <= grid.height;
}

/** Vrai si la forme posée en (x, y) sort de la grille ou touche une cellule occupée. */
export function collides(shape, x, y, occupancy, integral) {
  const box = shapeBox(shape, x, y);
  if (!insideGrid(box, occupancy)) return true;
  const stride = occupancy.width + 1;
  const occupiedInBox = integral[box.y1 * stride + box.x1] - integral[box.y0 * stride + box.x1]
    - integral[box.y1 * stride + box.x0] + integral[box.y0 * stride + box.x0];
  // Raccourci : boîte entièrement libre → aucune collision possible.
  if (occupiedInBox === 0) return false;
  for (let row = 0; row < shape.height; row += 1) {
    const rowOffset = (box.y0 + row) * occupancy.width + box.x0;
    for (const column of shape.rows[row]) if (occupancy.data[rowOffset + column]) return true;
  }
  return false;
}

/** Marque la pièce et sa marge de sécurité comme occupées (modifie `occupancy`). */
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

/** Nombre maximal de positions candidates par axe issues des défauts (D-23). */
export const MAX_DEFECT_ANCHORS = 120;

/**
 * Positions candidates d'une orientation, par axe : bord du tissu, puis bords
 * des pièces déjà posées (exacts, pour un rangement serré), puis bords des
 * défauts. D-23 : chaque défaut ajoutait 4 positions par axe et le nombre de
 * combinaisons x × y explosait (50 taches → 36 s). Au-delà de
 * MAX_DEFECT_ANCHORS, les positions issues des défauts sont arrondies sur un
 * pas régulier, vers l'extérieur du défaut pour ne pas s'en rapprocher.
 */
export function collectAnchors(shape, { pieces, defects }, gap, grid, maxDefectAnchors = MAX_DEFECT_ANCHORS) {
  const axis = (start, end, size, gridSize, offset) => {
    const anchors = new Set();
    const add = (low) => { if (low >= 0 && low + size <= gridSize) anchors.add(low - offset); };
    add(0);
    for (const box of pieces) { add(box[start]); add(box[end] + gap); add(box[start] - size); add(box[start] - size - gap); }
    if (defects.length * 4 <= maxDefectAnchors) {
      for (const box of defects) { add(box[start]); add(box[end] + gap); add(box[start] - size); add(box[start] - size - gap); }
    } else {
      const step = Math.ceil(2 * gridSize / maxDefectAnchors);
      for (const box of defects) {
        add(Math.ceil((box[end] + gap) / step) * step);
        add(Math.floor((box[start] - size - gap) / step) * step);
      }
    }
    return [...anchors].sort((a, b) => a - b);
  };
  return {
    xs: axis('x0', 'x1', shape.width, grid.width, shape.minX),
    ys: axis('y0', 'y1', shape.height, grid.height, shape.minY)
  };
}

/**
 * Cherche la meilleure position (la plus basse, puis la plus à gauche) parmi
 * les positions candidates de collectAnchors. `obstacles` = { pieces, defects },
 * deux listes de boîtes. Renvoie null si rien ne rentre.
 */
export function findPlacement(name, orientations, occupancy, obstacles, clearance) {
  const integral = buildIntegral(occupancy);
  const gap = clearance + 1;
  let best = null; let bestBottom = Infinity; let bestRight = Infinity;
  for (const shape of orientations) {
    const { xs, ys } = collectAnchors(shape, obstacles, gap, occupancy);
    for (const y of ys) {
      const bottom = y + shape.minY + shape.height;
      if (bottom > bestBottom) break;
      for (const x of xs) {
        const right = x + shape.minX + shape.width;
        if (bottom === bestBottom && right >= bestRight) break;
        if (!collides(shape, x, y, occupancy, integral)) {
          best = { name, x, y, shape }; bestBottom = bottom; bestRight = right;
          break;
        }
      }
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
    usedAreaCm2: placements.reduce((sum, placement) => sum + placement.shape.areaCm2, 0)
  };
}

/** Priorité : T-shirts complets, puis surface utilisée, puis nombre de pièces. */
export function isBetterScore(candidate, reference) {
  if (candidate.completeKits !== reference.completeKits) return candidate.completeKits > reference.completeKits;
  if (Math.abs(candidate.usedAreaCm2 - reference.usedAreaCm2) > 1e-9) return candidate.usedAreaCm2 > reference.usedAreaCm2;
  return candidate.pieceCount > reference.pieceCount;
}

/**
 * Vérifie un plan indépendamment de l'algorithme qui l'a produit :
 * chaque pièce dans le tissu, hors défauts + marge, sans chevaucher les autres.
 */
export function validatePlan(placements, gridMask, clearance = SAFE_CLEARANCE_CELLS) {
  const occupancy = dilate(gridMask, clearance);
  for (let index = 0; index < placements.length; index += 1) {
    const { shape, x, y, name } = placements[index];
    if (!shape || !Array.isArray(shape.rows) || !Number.isInteger(x) || !Number.isInteger(y)) {
      return { ok: false, index, reason: `Placement ${index + 1} (${name}) mal formé` };
    }
    if (!insideGrid(shapeBox(shape, x, y), occupancy)) return { ok: false, index, reason: `${name} sort du tissu` };
    const box = shapeBox(shape, x, y);
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

/** Borne haute du nombre de kits, d'après la surface saine disponible. */
export function estimateMaxKits(gridMask, shapes, kit = KIT) {
  const kitCells = Object.entries(kit).reduce((sum, [name, count]) => sum + count * Math.min(...shapes[name].map((shape) => shape.cellCount)), 0);
  let free = 0;
  for (const value of gridMask.data) if (!value) free += 1;
  return Math.max(1, Math.floor(free / kitCells) + 1);
}

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Applique un ordre de placement jusqu'à ce que plus aucune pièce ne rentre. */
export async function runStrategy({ order, gridMask, shapes, clearance, maxKits, onStep = () => {}, yieldToUi = nextTick, shouldAbort = () => false }) {
  const occupancy = dilate(gridMask, clearance);
  const obstacles = { pieces: [], defects: componentBounds(gridMask) };
  const placements = []; const exhausted = new Set(); const distinct = new Set(order).size;
  for (let pass = 1; pass <= maxKits; pass += 1) {
    let placedThisPass = 0;
    for (let index = 0; index < order.length; index += 1) {
      if (shouldAbort()) return { placements, aborted: true };
      const name = order[index];
      if (exhausted.has(name)) continue;
      const placement = findPlacement(name, shapes[name], occupancy, obstacles, clearance);
      if (!placement) { exhausted.add(name); continue; }
      placements.push({ ...placement, pass }); placedThisPass += 1;
      stampPiece(occupancy, placement.shape, placement.x, placement.y, clearance);
      obstacles.pieces.push(shapeBox(placement.shape, placement.x, placement.y));
      onStep({ pass, index, orderLength: order.length });
      await yieldToUi();
    }
    if (!placedThisPass || exhausted.size === distinct) break;
  }
  return { placements, aborted: false };
}

/**
 * Essaie chaque stratégie et garde le meilleur plan, puis le revalide.
 * onProgress(fraction 0–1) ; shouldAbort() permet d'annuler si le masque change.
 * Renvoie { placements, score, strategyIndex, validation, aborted }.
 */
export async function nestPieces({
  gridMask, shapes, strategies = STRATEGIES, clearance = SAFE_CLEARANCE_CELLS, kit = KIT,
  maxKits, onProgress = () => {}, yieldToUi = nextTick, shouldAbort = () => false
}) {
  if (!strategies.length) throw new RangeError('Aucune stratégie de placement fournie');
  for (const order of strategies) {
    for (const name of order) if (!shapes[name]) throw new RangeError(`Pièce inconnue dans une stratégie : ${name}`);
  }
  const kitLimit = maxKits ?? estimateMaxKits(gridMask, shapes, kit);
  let best = null;
  for (let strategyIndex = 0; strategyIndex < strategies.length; strategyIndex += 1) {
    const { placements, aborted } = await runStrategy({
      order: strategies[strategyIndex], gridMask, shapes, clearance, maxKits: kitLimit, yieldToUi, shouldAbort,
      onStep: ({ pass, index, orderLength }) => onProgress(Math.min(1, (strategyIndex + (pass - 1 + (index + 1) / orderLength) / kitLimit) / strategies.length))
    });
    if (aborted) return { placements: [], score: scorePlan([], kit), strategyIndex: -1, validation: { ok: false, reason: 'Calcul annulé' }, aborted: true };
    const score = scorePlan(placements, kit);
    if (!best || isBetterScore(score, best.score)) best = { placements, score, strategyIndex };
  }
  onProgress(1);
  return { ...best, validation: validatePlan(best.placements, gridMask, clearance), aborted: false };
}
