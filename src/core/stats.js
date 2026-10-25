// Bilan matière d'un plan de découpe.
import { KIT } from '../config.js';
import { countMask } from './mask.js';
import { countCompleteKits } from './nesting.js';

/**
 * Surfaces en cm². La surface utilisée est celle des patrons (polygones),
 * pas celle des cellules rastérisées qui débordent légèrement du contour.
 */
export function computeSurfaceStats({ gridMask, placements = [], cellCm, kit = KIT }) {
  const cellArea = cellCm * cellCm;
  const totalCm2 = gridMask.width * gridMask.height * cellArea;
  const defectCm2 = countMask(gridMask) * cellArea;
  const usedCm2 = placements.reduce((sum, placement) => sum + placement.shape.areaCm2, 0);
  const healthyCm2 = Math.max(0, totalCm2 - defectCm2);
  return {
    totalCm2,
    defectCm2,
    usedCm2,
    healthyCm2,
    lostCm2: Math.max(0, healthyCm2 - usedCm2),
    usageRatio: healthyCm2 > 0 ? usedCm2 / healthyCm2 : 0,
    pieceCount: placements.length,
    completeKits: placements.length ? countCompleteKits(placements, kit) : 0
  };
}
