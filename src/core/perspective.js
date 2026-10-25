// Redressement de perspective (D-19) : l'utilisateur désigne les 4 coins du
// tissu sur la photo ; on calcule l'homographie qui envoie ce quadrilatère sur
// un rectangle aux proportions du tissu, puis on rééchantillonne l'image.
// Points : [x, y] en pixels, y vers le bas.

function assertPoints(points, count) {
  if (!Array.isArray(points) || points.length !== count || !points.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
    throw new TypeError(`${count} points [x, y] attendus`);
  }
}

function signedArea(polygon) {
  let twice = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) twice += polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
  return twice / 2;
}

/**
 * Remet 4 coins cliqués dans n'importe quel ordre dans l'ordre
 * haut-gauche, haut-droit, bas-droit, bas-gauche. Refuse un quadrilatère
 * croisé, concave ou quasi plat (minArea en px²).
 */
export function orderCorners(points, minArea = 100) {
  assertPoints(points, 4);
  const cx = points.reduce((sum, p) => sum + p[0], 0) / 4; const cy = points.reduce((sum, p) => sum + p[1], 0) / 4;
  // Tri angulaire autour du centre : sens horaire à l'écran (y vers le bas).
  const sorted = [...points].sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  let start = 0;
  for (let i = 1; i < 4; i += 1) if (sorted[i][0] + sorted[i][1] < sorted[start][0] + sorted[start][1]) start = i;
  const ordered = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  if (Math.abs(signedArea(ordered)) < minArea) throw new RangeError('Les 4 coins sont trop rapprochés ou alignés');
  for (let i = 0; i < 4; i += 1) {
    const [a, b, c] = [ordered[i], ordered[(i + 1) % 4], ordered[(i + 2) % 4]];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) <= 0) throw new RangeError('Les 4 coins ne forment pas un quadrilatère convexe');
  }
  return ordered;
}

/** Résout A·x = b (Gauss avec pivot partiel). Lève une erreur si le système est singulier. */
function solveLinear(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) < 1e-12) throw new RangeError('Homographie impossible : points dégénérés');
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= n; k += 1) a[row][k] -= factor * a[column][k];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

/** Homographie H (3 × 3, à plat, h33 = 1) telle que H(src[i]) = dst[i]. */
export function computeHomography(src, dst) {
  assertPoints(src, 4); assertPoints(dst, 4);
  const matrix = []; const vector = [];
  for (let i = 0; i < 4; i += 1) {
    const [x, y] = src[i]; const [u, v] = dst[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); vector.push(v);
  }
  return [...solveLinear(matrix, vector), 1];
}

export function applyHomography(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/**
 * Taille de l'image redressée : aux proportions du tissu, aussi large que le
 * plus long des bords haut et bas du quadrilatère, sans dépasser maxWidth.
 */
export function rectifiedSize(corners, fabric, maxWidth) {
  const [tl, tr, br, bl] = corners;
  const edge = Math.max(Math.hypot(tr[0] - tl[0], tr[1] - tl[1]), Math.hypot(br[0] - bl[0], br[1] - bl[1]));
  const width = Math.max(1, Math.round(Math.min(maxWidth, edge)));
  return { width, height: Math.max(1, Math.round(width * fabric.heightCm / fabric.widthCm)) };
}

/**
 * Redresse `image` (RGBA, { width, height, data }) : le quadrilatère `corners`
 * (ordonné par orderCorners) devient une image de outWidth × outHeight.
 * Échantillonnage bilinéaire, bords de l'image source prolongés.
 */
export function warpPerspective(image, corners, outWidth, outHeight) {
  const { width, height, data } = image;
  if (!data || data.length !== width * height * 4) throw new RangeError('Image source incohérente');
  // H envoie le rectangle de sortie (coins des pixels) vers la photo.
  const h = computeHomography([[0, 0], [outWidth, 0], [outWidth, outHeight], [0, outHeight]], corners);
  const output = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    for (let x = 0; x < outWidth; x += 1) {
      const [sx, sy] = applyHomography(h, x + 0.5, y + 0.5);
      const fx = Math.min(width - 1, Math.max(0, sx - 0.5)); const fy = Math.min(height - 1, Math.max(0, sy - 0.5));
      const x0 = Math.floor(fx); const y0 = Math.floor(fy);
      const x1 = Math.min(width - 1, x0 + 1); const y1 = Math.min(height - 1, y0 + 1);
      const tx = fx - x0; const ty = fy - y0;
      const out = (y * outWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = data[(y0 * width + x0) * 4 + channel] * (1 - tx) + data[(y0 * width + x1) * 4 + channel] * tx;
        const bottom = data[(y1 * width + x0) * 4 + channel] * (1 - tx) + data[(y1 * width + x1) * 4 + channel] * tx;
        output[out + channel] = top * (1 - ty) + bottom * ty;
      }
    }
  }
  return { width: outWidth, height: outHeight, data: output };
}
