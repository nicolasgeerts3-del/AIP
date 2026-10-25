// Géométrie des patrons : polygones en cm, rotation et rastérisation sur la grille.

export function polygonArea(polygon) {
  let twice = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    twice += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  }
  return Math.abs(twice) / 2;
}

export function polygonBounds(polygon) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function validatePolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) throw new TypeError('Un patron doit avoir au moins 3 sommets');
  for (const point of polygon) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw new TypeError(`Sommet de patron invalide : ${JSON.stringify(point)}`);
  }
  if (polygonArea(polygon) <= 0) throw new RangeError('Un patron doit avoir une surface non nulle');
}

/**
 * Tourne le patron autour du centre de sa boîte englobante puis le rastérise
 * sur une grille de pas cellCm.
 *
 * Repère (D-01) : une forme placée à l'origine (x, y) occupe les cellules
 * (x + minX + colonne, y + minY + ligne) et son contour est `outline` décalé de
 * (x, y). Cellules et contour partagent donc exactement le même repère.
 *
 * Une cellule fait partie de la pièce dès que son centre, un de ses coins ou un
 * sommet du patron tombe dedans : la forme rastérisée recouvre tout le contour
 * de découpe, ce qui rend le contrôle de collision conservateur.
 */
export function rasterizePiece(polygon, angleDeg, cellCm) {
  validatePolygon(polygon);
  if (!(cellCm > 0)) throw new RangeError(`Taille de cellule invalide : ${cellCm}`);
  const bounds = polygonBounds(polygon);
  const pivotX = (bounds.minX + bounds.maxX) / 2; const pivotY = (bounds.minY + bounds.maxY) / 2;
  const radians = angleDeg * Math.PI / 180; const cos = Math.cos(radians); const sin = Math.sin(radians);
  const outline = polygon.map(([x, y]) => [
    ((x - pivotX) * cos - (y - pivotY) * sin) / cellCm,
    ((x - pivotX) * sin + (y - pivotY) * cos) / cellCm
  ]);
  const local = polygonBounds(outline);
  // Arrondi à 1e-9 près pour éviter une colonne vide due aux erreurs flottantes.
  const minX = Math.floor(local.minX + 1e-9); const minY = Math.floor(local.minY + 1e-9);
  const width = Math.max(1, Math.ceil(local.maxX - 1e-9) - minX);
  const height = Math.max(1, Math.ceil(local.maxY - 1e-9) - minY);
  const cells = new Uint8Array(width * height);
  const inside = (x, y) => pointInPolygon(x, y, outline);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = minX + column; const y = minY + row;
      if (inside(x + 0.5, y + 0.5) || inside(x, y) || inside(x + 1, y) || inside(x, y + 1) || inside(x + 1, y + 1)) cells[row * width + column] = 1;
    }
  }
  for (const [x, y] of outline) {
    const column = Math.max(0, Math.min(width - 1, Math.floor(x) - minX));
    const row = Math.max(0, Math.min(height - 1, Math.floor(y) - minY));
    cells[row * width + column] = 1;
  }
  const rows = Array.from({ length: height }, () => []);
  const offsets = [];
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (cells[row * width + column]) { rows[row].push(column); offsets.push(row * width + column); }
    }
  }
  return { angle: angleDeg, minX, minY, width, height, rows, offsets, cellCount: offsets.length, outline, areaCm2: polygonArea(polygon) };
}

/** Contour d'une pièce placée, en coordonnées de grille (cellules), dans le repère de ses cellules (D-01). */
export function placementOutline(placement) {
  return placement.shape.outline.map(([x, y]) => [placement.x + x, placement.y + y]);
}
