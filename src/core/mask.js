// Masques binaires : { width, height, data: Uint8Array } avec data[y * width + x] ∈ {0, 1}.
// Toutes les fonctions renvoient un nouveau masque, sauf paint* qui modifient
// explicitement celui qu'on leur passe.

export function createMask(width, height, data) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Dimensions de masque invalides : ${width} × ${height}`);
  }
  if (data && data.length !== width * height) {
    throw new RangeError(`Données de masque de taille ${data.length}, attendu ${width * height}`);
  }
  return { width, height, data: data ?? new Uint8Array(width * height) };
}

export function cloneMask(mask) {
  return { width: mask.width, height: mask.height, data: mask.data.slice() };
}

export function countMask(mask) {
  let count = 0;
  for (let index = 0; index < mask.data.length; index += 1) if (mask.data[index]) count += 1;
  return count;
}

export function assertSameSize(...masks) {
  const [first] = masks;
  for (const mask of masks) {
    if (mask.width !== first.width || mask.height !== first.height) {
      throw new RangeError(`Masques de tailles différentes : ${first.width}×${first.height} et ${mask.width}×${mask.height}`);
    }
  }
}

/** Masque final = (détection automatique OU ajouts manuels) ET NON effacements manuels (D-07). */
export function combineLayers(base, added, erased) {
  assertSameSize(base, added, erased);
  const output = createMask(base.width, base.height);
  for (let index = 0; index < output.data.length; index += 1) {
    output.data[index] = (base.data[index] || added.data[index]) && !erased.data[index] ? 1 : 0;
  }
  return output;
}

// Morphologie 1D sur les lignes (horizontal) ou les colonnes, par sommes cumulées.
// Un élément structurant carré est séparable : appliquer les deux passes donne
// le même résultat que le carré complet, en O(n) au lieu de O(n·r²).
function morph1D(source, width, height, radius, horizontal, erode) {
  const output = new Uint8Array(source.length);
  const length = horizontal ? width : height;
  const lines = horizontal ? height : width;
  const prefix = new Int32Array(length + 1);
  const full = 2 * radius + 1;
  for (let line = 0; line < lines; line += 1) {
    for (let i = 0; i < length; i += 1) {
      const index = horizontal ? line * width + i : i * width + line;
      prefix[i + 1] = prefix[i] + (source[index] ? 1 : 0);
    }
    for (let i = 0; i < length; i += 1) {
      const low = i - radius; const high = i + radius;
      let value;
      if (erode) value = low >= 0 && high < length && prefix[high + 1] - prefix[low] === full ? 1 : 0;
      else value = prefix[Math.min(length - 1, high) + 1] - prefix[Math.max(0, low)] > 0 ? 1 : 0;
      output[horizontal ? line * width + i : i * width + line] = value;
    }
  }
  return output;
}

function morph(mask, radius, erode) {
  if (!Number.isInteger(radius) || radius < 0) throw new RangeError(`Rayon morphologique invalide : ${radius}`);
  if (radius === 0) return cloneMask(mask);
  const rows = morph1D(mask.data, mask.width, mask.height, radius, true, erode);
  return createMask(mask.width, mask.height, morph1D(rows, mask.width, mask.height, radius, false, erode));
}

/** Dilatation par un carré de côté 2·radius + 1. */
export function dilate(mask, radius) { return morph(mask, radius, false); }

/** Érosion par un carré de côté 2·radius + 1 (l'extérieur du masque compte comme vide). */
export function erode(mask, radius) { return morph(mask, radius, true); }

/** Parcourt les composantes 4-connexes et appelle visit(cells, bounds) pour chacune. */
function forEachComponent(mask, visit) {
  const { width, height, data } = mask;
  const seen = new Uint8Array(data.length);
  const queue = new Int32Array(data.length);
  for (let start = 0; start < data.length; start += 1) {
    if (!data[start] || seen[start]) continue;
    let head = 0; let tail = 0;
    queue[tail++] = start; seen[start] = 1;
    let x0 = width; let y0 = height; let x1 = 0; let y1 = 0;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width; const y = (current - x) / width;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && data[current - 1] && !seen[current - 1]) { seen[current - 1] = 1; queue[tail++] = current - 1; }
      if (x < width - 1 && data[current + 1] && !seen[current + 1]) { seen[current + 1] = 1; queue[tail++] = current + 1; }
      if (y > 0 && data[current - width] && !seen[current - width]) { seen[current - width] = 1; queue[tail++] = current - width; }
      if (y < height - 1 && data[current + width] && !seen[current + width]) { seen[current + width] = 1; queue[tail++] = current + width; }
    }
    visit(queue.subarray(0, tail), { x0, y0, x1: x1 + 1, y1: y1 + 1, size: tail });
  }
}

/** Supprime les composantes de moins de minSize pixels. */
export function removeSmallComponents(mask, minSize) {
  const output = createMask(mask.width, mask.height);
  forEachComponent(mask, (cells) => {
    if (cells.length >= minSize) for (const cell of cells) output.data[cell] = 1;
  });
  return output;
}

/**
 * Bouche les trous : une zone saine entièrement entourée de défaut devient
 * défaut si accept(cellules) le confirme. Sert à remplir l'intérieur d'une
 * grande tache dont seul le bord a été détecté (D-18). `accept` évite de
 * remplir du tissu sain simplement entouré par le fond de la photo (D-31).
 */
export function fillHoles(mask, accept = () => true) {
  const { width, height, data } = mask;
  const outside = new Uint8Array(data.length);
  const queue = new Int32Array(data.length);
  let tail = 0;
  const seed = (index) => { if (!data[index] && !outside[index]) { outside[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < width; x += 1) { seed(x); seed((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { seed(y * width); seed(y * width + width - 1); }
  for (let head = 0; head < tail; head += 1) {
    const current = queue[head]; const x = current % width;
    if (x > 0) seed(current - 1);
    if (x < width - 1) seed(current + 1);
    if (current >= width) seed(current - width);
    if (current < data.length - width) seed(current + width);
  }
  const holes = createMask(width, height);
  for (let index = 0; index < data.length; index += 1) holes.data[index] = !data[index] && !outside[index] ? 1 : 0;
  const output = cloneMask(mask);
  forEachComponent(holes, (cells) => { if (accept(cells)) for (const cell of cells) output.data[cell] = 1; });
  return output;
}

/** Boîtes englobantes des composantes ({x0, y0, x1, y1} avec x1/y1 exclusifs). */
export function componentBounds(mask) {
  const bounds = [];
  forEachComponent(mask, (_cells, box) => bounds.push(box));
  return bounds;
}

/**
 * Change la résolution d'un masque. Une cellule cible vaut 1 si AU MOINS un
 * pixel source qu'elle recouvre vaut 1 : en réduisant la résolution, un petit
 * défaut ne peut donc jamais disparaître (D-03).
 */
export function resampleMaxPool(mask, targetWidth, targetHeight) {
  const output = createMask(targetWidth, targetHeight);
  const { width, height, data } = mask;
  const xRanges = new Int32Array(targetWidth * 2);
  for (let x = 0; x < targetWidth; x += 1) {
    xRanges[2 * x] = Math.floor(x * width / targetWidth);
    xRanges[2 * x + 1] = Math.max(xRanges[2 * x] + 1, Math.ceil((x + 1) * width / targetWidth));
  }
  for (let y = 0; y < targetHeight; y += 1) {
    const sy0 = Math.floor(y * height / targetHeight);
    const sy1 = Math.max(sy0 + 1, Math.ceil((y + 1) * height / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx0 = xRanges[2 * x]; const sx1 = xRanges[2 * x + 1];
      let hit = 0;
      for (let sy = sy0; sy < sy1 && !hit; sy += 1) {
        const row = sy * width;
        for (let sx = sx0; sx < sx1; sx += 1) if (data[row + sx]) { hit = 1; break; }
      }
      output.data[y * targetWidth + x] = hit;
    }
  }
  return output;
}

/**
 * Peint une ellipse centrée en (cx, cy), coordonnées en pixels (le pixel i
 * couvre [i, i + 1[). Les rayons sont bornés à 0,5 px pour toujours toucher au
 * moins le pixel central. Modifie `mask` et renvoie le nombre de pixels changés.
 */
export function paintEllipse(mask, cx, cy, rx, ry, value) {
  const radiusX = Math.max(0.5, rx); const radiusY = Math.max(0.5, ry);
  const bit = value ? 1 : 0;
  const yStart = Math.max(0, Math.floor(cy - radiusY)); const yEnd = Math.min(mask.height - 1, Math.floor(cy + radiusY));
  const xStart = Math.max(0, Math.floor(cx - radiusX)); const xEnd = Math.min(mask.width - 1, Math.floor(cx + radiusX));
  let changed = 0;
  for (let y = yStart; y <= yEnd; y += 1) {
    const dy = (y + 0.5 - cy) / radiusY;
    for (let x = xStart; x <= xEnd; x += 1) {
      const dx = (x + 0.5 - cx) / radiusX;
      const inside = dx * dx + dy * dy <= 1 || (x === Math.floor(cx) && y === Math.floor(cy));
      if (!inside) continue;
      const index = y * mask.width + x;
      if (mask.data[index] !== bit) { mask.data[index] = bit; changed += 1; }
    }
  }
  return changed;
}

/** Peint un trait continu entre deux points (pas de trous si la souris va vite, D-09). */
export function paintStroke(mask, from, to, rx, ry, value) {
  const step = Math.max(0.5, Math.min(rx, ry) * 0.5);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / step));
  let changed = 0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    changed += paintEllipse(mask, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, rx, ry, value);
  }
  return changed;
}
