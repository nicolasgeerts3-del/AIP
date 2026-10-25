// Conversions de couleur et statistiques robustes.

/** Convertit un pixel sRGB (0–255) en CIE L*a*b* (illuminant D65). */
export function rgbToLab(r, g, b) {
  const linear = (channel) => {
    const value = channel / 255;
    return value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92;
  };
  const rl = linear(r); const gl = linear(g); const bl = linear(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/**
 * Médiane (valeur haute pour un nombre pair d'éléments).
 * Ne modifie pas le tableau reçu : trier en place désaligne les tableaux
 * parallèles (ex. composantes a* et b* d'un même pixel).
 */
export function median(values) {
  if (!values || values.length === 0) throw new RangeError('Impossible de calculer la médiane d’une liste vide');
  const sorted = Float64Array.from(values).sort();
  return sorted[Math.floor(sorted.length / 2)];
}
