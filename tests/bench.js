// Banc d'essai du nesting : mêmes scénarios avant/après une modification.
// Usage : npm run bench
import { CELL_CM, ORIENTATION_MODES, PIECES } from '../src/config.js';
import { gridForFabric } from '../src/core/fabric.js';
import { createMask } from '../src/core/mask.js';
import { buildPieceShapes, nestPieces } from '../src/core/nesting.js';
import { rectMask, seededRandom } from './helpers/fixtures.js';

function speckles(grid, count, seed) {
  const random = seededRandom(seed);
  return rectMask(grid.width, grid.height, Array.from({ length: count }, () => {
    const x0 = Math.floor(random() * (grid.width - 3)); const y0 = Math.floor(random() * (grid.height - 3));
    return { x0, y0, x1: x0 + 3, y1: y0 + 3 };
  }));
}

function disc(grid, cx, cy, r) {
  const mask = createMask(grid.width, grid.height);
  for (let y = 0; y < grid.height; y += 1) for (let x = 0; x < grid.width; x += 1) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask.data[y * grid.width + x] = 1;
  return mask;
}

const portrait = gridForFabric({ widthCm: 300, heightCm: 450 });
const landscape = gridForFabric({ widthCm: 300, heightCm: 200 });
const SCENARIOS = [
  ['3,00 × 4,50 m sain', createMask(portrait.width, portrait.height)],
  ['3,00 × 2,00 m, grosse tache centrale', disc(landscape, 300, 170, 70)],
  ['3,00 × 4,50 m, 50 petites taches', speckles(portrait, 50, 51)],
  ['3,00 × 4,50 m, 300 petites taches', speckles(portrait, 300, 1)]
];

for (const mode of ['droit-fil', 'libre']) {
  const shapes = buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: ORIENTATION_MODES[mode].angles });
  console.log(`\nOrientation : ${mode}`);
  for (const [name, gridMask] of SCENARIOS) {
    const start = Date.now();
    const result = await nestPieces({ gridMask, shapes, yieldToUi: async () => {} });
    const healthy = gridMask.data.reduce((sum, value) => sum + (value ? 0 : 1), 0) * CELL_CM * CELL_CM;
    const usage = (result.score.usedAreaCm2 / healthy * 100).toFixed(1);
    console.log(`  ${name.padEnd(38)} ${String(result.score.completeKits).padStart(2)} T-shirts · ${String(result.score.pieceCount).padStart(3)} pièces · ${usage.padStart(5)} % · ${((Date.now() - start) / 1000).toFixed(1)} s${result.validation.ok ? '' : ' · PLAN INVALIDE'}`);
  }
}
