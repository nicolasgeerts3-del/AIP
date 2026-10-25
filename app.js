const GRID_W = 600;
const GRID_H = 900;
const MAX_PREVIEW_WIDTH = 700;
const CELL_CM = 0.5;
const CELL_MM = 5;
const ROTATIONS = 24;
const SAFE_CLEARANCE = 2;
const PIECES = {
  DOS: [[0,0],[52,0],[52,46],[50,58],[46,68],[36,73],[34,73],[30,70],[22,70],[18,73],[16,73],[6,68],[2,58],[0,46]],
  DEVANT: [[0,0],[52,0],[52,46],[50,58],[46,68],[36,72],[34,72],[32,66],[26,64],[20,66],[18,72],[16,72],[6,68],[2,58],[0,46]],
  MANCHE: [[0,0],[40,0],[37,10],[32,20],[23,26],[17,26],[8,20],[3,10]],
  BANDE: [[0,0],[58,0],[58,8],[0,8]]
};
const COLORS = { DOS: '#3979b5', DEVANT: '#4f9b69', MANCHE: '#e58b3e', BANDE: '#8d6bb3' };
const $ = (selector) => document.querySelector(selector);
const video = $('#video');
const captureCanvas = $('#captureCanvas');
const sourcePreview = $('#sourcePreview');
const maskCanvas = $('#maskCanvas');
const resultCanvas = $('#resultCanvas');
const maskContext = maskCanvas.getContext('2d');
let originalMask = new Uint8Array(GRID_W * GRID_H);
let defectMask = new Uint8Array(GRID_W * GRID_H);
let imageDefectMask = new Uint8Array(GRID_W * GRID_H);
let originalImageMask = new Uint8Array(GRID_W * GRID_H);
let placements = [];
let pieceMasks = {};
let brushMode = 1;
let stream = null;
let isPainting = false;
let imageRatio = GRID_W / GRID_H;
let IMAGE_W = GRID_W;
let IMAGE_H = GRID_H;

function setStatus(text) { $('#statusText').textContent = text; }
function setProgress(value, text) { $('#progressBar').style.width = `${value}%`; $('#progressText').textContent = text; }
function invalidatePlan() {
  placements = [];
  if (resultCanvas.width) resultCanvas.getContext('2d').clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  $('#resultEmpty').style.display = 'grid'; $('#downloadButton').disabled = true;
  $('#optimizationState').textContent = captureCanvas.width ? 'À RECALCULER' : 'EN ATTENTE';
  $('#stepPlan').classList.remove('active');
  updateSurfaceStats();
}
function median(values) { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; }
function rgbToLab(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  r = r > .04045 ? ((r + .055) / 1.055) ** 2.4 : r / 12.92;
  g = g > .04045 ? ((g + .055) / 1.055) ** 2.4 : g / 12.92;
  b = b > .04045 ? ((b + .055) / 1.055) ** 2.4 : b / 12.92;
  const x = (r * .4124 + g * .3576 + b * .1805) / .95047;
  const y = r * .2126 + g * .7152 + b * .0722;
  const z = (r * .0193 + g * .1192 + b * .9505) / 1.08883;
  const f = (value) => value > .008856 ? value ** (1 / 3) : 7.787 * value + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function dilate(input, radius) {
  const output = new Uint8Array(input.length); const width = IMAGE_W; const height = IMAGE_H;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let hit = 0;
    for (let dy = -radius; dy <= radius && !hit; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = x + dx; const sy = y + dy;
      if (sx >= 0 && sx < width && sy >= 0 && sy < height && input[sy * width + sx]) { hit = 1; break; }
    }
    output[y * width + x] = hit;
  }
  return output;
}
function erode(input, radius) {
  const output = new Uint8Array(input.length); const width = IMAGE_W; const height = IMAGE_H;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let hit = 1;
    for (let dy = -radius; dy <= radius && hit; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = x + dx; const sy = y + dy;
      if (sx < 0 || sx >= width || sy < 0 || sy >= height || !input[sy * width + sx]) { hit = 0; break; }
    }
    output[y * width + x] = hit;
  }
  return output;
}
function filterComponents(input) {
  const width = IMAGE_W; const height = IMAGE_H;
  const output = new Uint8Array(input.length); const seen = new Uint8Array(input.length); const queue = [];
  for (let index = 0; index < input.length; index += 1) {
    if (!input[index] || seen[index]) continue;
    queue.length = 0; queue.push(index); seen[index] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head]; const x = current % width; const y = Math.floor(current / width);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx; const ny = y + dy; const next = ny * width + nx; if (nx >= 0 && nx < width && ny >= 0 && ny < height && input[next] && !seen[next]) { seen[next] = 1; queue.push(next); } }
    }
    if (queue.length >= 4) queue.forEach((cell) => { output[cell] = 1; });
  }
  return output;
}
function analyzeImage() {
  const source = captureCanvas.getContext('2d').getImageData(0, 0, captureCanvas.width, captureCanvas.height).data;
  const lValues = []; const aValues = []; const bValues = [];
  const width = IMAGE_W; const height = IMAGE_H;
  const right = width; const bottom = height;
  const sampleStep = 4;
  for (let y = 0; y < bottom; y += sampleStep) for (let x = 0; x < right; x += sampleStep) {
    const si = (y * width + x) * 4;
    const lab = rgbToLab(source[si], source[si + 1], source[si + 2]);
    lValues.push(lab[0]); aValues.push(lab[1]); bValues.push(lab[2]);
  }
  const centerA = median(aValues); const centerB = median(bValues);
  const chromaDistances = aValues.map((value, index) => Math.hypot(value - centerA, bValues[index] - centerB));
  const chromaMedian = median(chromaDistances);
  const mad = Math.max(.5, median(chromaDistances.map((value) => Math.abs(value - chromaMedian))));
  const threshold = chromaMedian + Number($('#sensitivity').value) * mad;
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < bottom; y += 1) for (let x = 0; x < right; x += 1) {
    const pixel = y * width + x; const si = pixel * 4; const lab = rgbToLab(source[si], source[si + 1], source[si + 2]);
    const chromaDistance = Math.hypot(lab[1] - centerA, lab[2] - centerB);
    raw[pixel] = chromaDistance > threshold ? 1 : 0;
  }
  imageDefectMask = filterComponents(dilate(erode(raw, 1), 2));
  defectMask = new Uint8Array(GRID_W * GRID_H);
  for (let y = 0; y < GRID_H; y += 1) for (let x = 0; x < GRID_W; x += 1) {
    const sourceX = Math.min(width - 1, Math.floor(x * width / GRID_W));
    const sourceY = Math.min(height - 1, Math.floor(y * height / GRID_H));
    defectMask[y * GRID_W + x] = imageDefectMask[sourceY * width + sourceX];
  }
  originalMask = defectMask.slice(); originalImageMask = imageDefectMask.slice();
  renderMask(); updateMaskCount(); invalidatePlan();
  const physicalCount = defectMask.reduce((sum, value) => sum + value, 0);
  return { mad, count: physicalCount };
}
function renderMask() {
  const hasImage = Boolean(captureCanvas.width);
  const width = hasImage ? IMAGE_W : GRID_W; const height = hasImage ? IMAGE_H : GRID_H;
  maskCanvas.width = width; maskCanvas.height = height;
  const image = maskContext.createImageData(width, height);
  const source = hasImage ? captureCanvas.getContext('2d').getImageData(0, 0, width, height).data : null;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x; const out = index * 4; const si = out;
    const gridX = Math.min(GRID_W - 1, Math.floor(x * GRID_W / width));
    const gridY = Math.min(GRID_H - 1, Math.floor(y * GRID_H / height));
    const physicalIndex = gridY * GRID_W + gridX;
    image.data[out] = source ? source[si] : 231; image.data[out + 1] = source ? source[si + 1] : 232;
    image.data[out + 2] = source ? source[si + 2] : 223; image.data[out + 3] = source ? 255 : 0;
    if (hasImage && imageDefectMask[index]) { image.data[out] = 220; image.data[out + 1] = 55; image.data[out + 2] = 55; image.data[out + 3] = 195; }
    else if (!hasImage && defectMask[physicalIndex]) { image.data[out] = 220; image.data[out + 1] = 55; image.data[out + 2] = 55; image.data[out + 3] = 195; }
  }
  maskContext.putImageData(image, 0, 0);
  $('#editorEmpty').style.display = hasImage ? 'none' : 'block';
}
function updateMaskCount() { $('#maskCount').textContent = `${(defectMask.reduce((sum, value) => sum + value, 0) * CELL_CM * CELL_CM).toFixed(1)} cm²`; }
function copyImage(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) return;
  const previewScale = Math.min(1, MAX_PREVIEW_WIDTH / width);
  const displayWidth = Math.max(1, Math.round(width * previewScale));
  const displayHeight = Math.max(1, Math.round(height * previewScale));
  IMAGE_W = displayWidth; IMAGE_H = displayHeight;
  captureCanvas.width = displayWidth; captureCanvas.height = displayHeight;
  const context = captureCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, displayWidth, displayHeight);
  sourcePreview.width = displayWidth; sourcePreview.height = displayHeight;
  sourcePreview.getContext('2d').drawImage(captureCanvas, 0, 0);
  imageRatio = width / height;
  $('#cameraStage').style.aspectRatio = `${imageRatio}`;
  $('.mask-stage').style.aspectRatio = `${imageRatio}`;
  maskCanvas.style.width = '100%'; maskCanvas.style.height = '100%';
  $('#cameraStage').classList.add('has-image'); $('#cameraPlaceholder').classList.add('hidden');
  $('#analyzeButton').disabled = false; $('#analysisPill').textContent = 'PRÊT';
  $('#stepAnalyze').classList.remove('active'); $('#stepPlan').classList.remove('active');
  $('#planButton').disabled = true; $('#downloadButton').disabled = true;
  defectMask = new Uint8Array(GRID_W * GRID_H); originalMask = defectMask.slice();
  imageDefectMask = new Uint8Array(IMAGE_W * IMAGE_H);
  originalImageMask = imageDefectMask.slice();
  placements = []; resultCanvas.getContext('2d').clearRect(0, 0, resultCanvas.width, resultCanvas.height);
  $('#resultEmpty').style.display = 'grid'; $('#analysisPill').textContent = 'PRÊT';
    $('#optimizationState').textContent = 'EN ATTENTE'; renderMask(); updateMaskCount(); updateSurfaceStats();
  setStatus('Image prête — proportions conservées');
}
async function startCamera() { try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); video.srcObject = stream; await video.play(); await new Promise((resolve) => video.videoWidth ? resolve() : video.addEventListener('loadeddata', resolve, { once: true })); imageRatio = video.videoWidth / video.videoHeight; $('#cameraStage').style.aspectRatio = `${imageRatio}`; $('#cameraStage').classList.remove('has-image'); $('#captureButton').disabled = false; $('#cameraPlaceholder').classList.add('hidden'); setStatus('Caméra connectée'); } catch (error) { setStatus('Caméra indisponible'); } }
function paintMask(event) {
  if (!captureCanvas.width) return;
  const rect = maskCanvas.getBoundingClientRect();
  const imageX = Math.floor((event.clientX - rect.left) / rect.width * IMAGE_W);
  const imageY = Math.floor((event.clientY - rect.top) / rect.height * IMAGE_H);
  const radius = Math.max(1, Math.round(Number($('#brushSize').value) / CELL_CM / 2));
  const imageRadius = Math.max(1, Math.round(radius * IMAGE_W / GRID_W));
  for (let dy = -imageRadius; dy <= imageRadius; dy += 1) for (let dx = -imageRadius; dx <= imageRadius; dx += 1) {
    if (dx * dx + dy * dy > imageRadius * imageRadius) continue;
    const x = imageX + dx; const y = imageY + dy;
    if (x < 0 || x >= IMAGE_W || y < 0 || y >= IMAGE_H) continue;
    imageDefectMask[y * IMAGE_W + x] = brushMode;
    const startY = Math.floor(y * GRID_H / IMAGE_H); const endY = Math.max(startY + 1, Math.ceil((y + 1) * GRID_H / IMAGE_H));
    const startX = Math.floor(x * GRID_W / IMAGE_W); const endX = Math.max(startX + 1, Math.ceil((x + 1) * GRID_W / IMAGE_W));
    for (let py = startY; py < endY; py += 1) {
      for (let px = startX; px < endX; px += 1) {
        if (px >= 0 && px < GRID_W && py >= 0 && py < GRID_H) {
          defectMask[py*GRID_W+px] = brushMode;
        }
      }
    }
  }
  renderMask(); updateMaskCount(); invalidatePlan();
}
function pointInPolygon(x, y, polygon) { let inside = false; for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) { const xi = polygon[i][0]; const yi = polygon[i][1]; const xj = polygon[j][0]; const yj = polygon[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; } return inside; }
function rasterizePolygon(polygon, angle) { const radians = angle * Math.PI / 180; const cos = Math.cos(radians); const sin = Math.sin(radians); const cx = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length; const cy = polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length; const rotated = polygon.map(([x, y]) => [(x - cx) * cos - (y - cy) * sin, (x - cx) * sin + (y - cy) * cos]); const minX = Math.floor(Math.min(...rotated.map((point) => point[0])) / CELL_CM); const maxX = Math.ceil(Math.max(...rotated.map((point) => point[0])) / CELL_CM); const minY = Math.floor(Math.min(...rotated.map((point) => point[1])) / CELL_CM); const maxY = Math.ceil(Math.max(...rotated.map((point) => point[1])) / CELL_CM); const width = maxX - minX + 1; const height = maxY - minY + 1; const rows = Array.from({ length: height }, () => []); const offsets = []; for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) { const localX = x * CELL_CM; const localY = y * CELL_CM; const px = localX * cos + localY * sin + cx; const py = -localX * sin + localY * cos + cy; if (pointInPolygon(px, py, polygon)) { const row = y - minY; const column = x - minX; offsets.push(row * width + column); rows[row].push(column); } } return { offsets, rows, width, height, minX, minY, angle }; }
function preparePieceMasks() { for (const [name, polygon] of Object.entries(PIECES)) pieceMasks[name] = Array.from({ length: ROTATIONS }, (_, index) => rasterizePolygon(polygon, index * 15)); }
function buildOccupancyIntegral(occupied) {
  const stride = GRID_W + 1; const integral = new Uint32Array((GRID_H + 1) * stride);
  for (let y = 0; y < GRID_H; y += 1) {
    let rowTotal = 0;
    for (let x = 0; x < GRID_W; x += 1) {
      rowTotal += occupied[y * GRID_W + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowTotal;
    }
  }
  return integral;
}
function collides(mask, originX, originY, occupied, integral) {
  const left = originX + mask.minX; const top = originY + mask.minY;
  if (left < 0 || top < 0 || left + mask.width > GRID_W || top + mask.height > GRID_H) return true;
  const stride = GRID_W + 1; const x2 = left + mask.width; const y2 = top + mask.height;
  const occupiedInBounds = integral[y2 * stride + x2] - integral[top * stride + x2] - integral[y2 * stride + left] + integral[top * stride + left];
  if (occupiedInBounds > mask.offsets.length) return true;
  for (let row = 0; row < mask.height; row += 1) {
    const rowOffset = (top + row) * GRID_W + left;
    for (const column of mask.rows[row]) if (occupied[rowOffset + column]) return true;
  }
  return false;
}
function stamp(mask, originX, originY, occupied) {
  const left = originX + mask.minX; const top = originY + mask.minY; const clearance = 2;
  for (let row = 0; row < mask.height; row += 1) for (const column of mask.rows[row]) {
    const x = left + column; const y = top + row;
    for (let dy = -clearance; dy <= clearance; dy += 1) for (let dx = -clearance; dx <= clearance; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) occupied[ny * GRID_W + nx] = 1;
    }
  }
}
function expandOccupied(occupied, radius) { const expanded = occupied.slice(); for (let y = 0; y < GRID_H; y += 1) for (let x = 0; x < GRID_W; x += 1) if (occupied[y * GRID_W + x]) for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) { const nx = x + dx; const ny = y + dy; if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) expanded[ny * GRID_W + nx] = 1; } return expanded; }
function getDefectObstacleBounds(mask) {
  const seen = new Uint8Array(mask.length); const queue = new Int32Array(mask.length); const bounds = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    let head = 0; let tail = 0; queue[tail++] = start; seen[start] = 1;
    let minX = GRID_W; let minY = GRID_H; let maxX = 0; let maxY = 0;
    while (head < tail) {
      const current = queue[head++]; const x = current % GRID_W; const y = Math.floor(current / GRID_W);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      const neighbors = [current - 1, current + 1, current - GRID_W, current + GRID_W];
      for (let direction = 0; direction < neighbors.length; direction += 1) {
        const next = neighbors[direction];
        if ((direction < 2 && Math.floor(next / GRID_W) !== y) || next < 0 || next >= mask.length || !mask[next] || seen[next]) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    bounds.push({ x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 });
  }
  return bounds;
}
function findPlacement(name, occupied, obstacles) {
  const integral = buildOccupancyIntegral(occupied); const clearance = SAFE_CLEARANCE + 1;
  let best = null; let bestBottom = Infinity; let bestRight = Infinity;
  for (const mask of pieceMasks[name]) {
    const xAnchors = new Set(); const yAnchors = new Set();
    const addX = (left) => { const origin = left - mask.minX; if (origin + mask.minX >= 0 && origin + mask.minX + mask.width <= GRID_W) xAnchors.add(origin); };
    const addY = (top) => { const origin = top - mask.minY; if (origin + mask.minY >= 0 && origin + mask.minY + mask.height <= GRID_H) yAnchors.add(origin); };
    addX(0); addY(0);
    for (const obstacle of obstacles) {
      addX(obstacle.x0); addX(obstacle.x1 + clearance); addX(obstacle.x0 - mask.width); addX(obstacle.x0 - mask.width - clearance);
      addY(obstacle.y0); addY(obstacle.y1 + clearance); addY(obstacle.y0 - mask.height); addY(obstacle.y0 - mask.height - clearance);
    }
    const xs = [...xAnchors].sort((a, b) => a - b); const ys = [...yAnchors].sort((a, b) => a - b);
    for (const originY of ys) {
      const top = originY + mask.minY; const bottom = top + mask.height;
      if (bottom > bestBottom) continue;
      for (const originX of xs) {
        const left = originX + mask.minX; const right = left + mask.width;
        if (bottom === bestBottom && right >= bestRight) continue;
        if (!collides(mask, originX, originY, occupied, integral)) {
          best = { name, x: originX, y: originY, mask };
          bestBottom = bottom; bestRight = right;
        }
      }
    }
  }
  return best;
}
async function runStrategy(order, strategyIndex, defectObstacles) {
  const result = []; const maxKits = 15; const exhausted = new Set();
  const occupied = expandOccupied(defectMask, SAFE_CLEARANCE);
  const obstacles = defectObstacles.map((bounds) => ({ ...bounds }));
  for (let kit = 1; kit <= maxKits; kit += 1) {
    let placedThisPass = 0;
    for (let index = 0; index < order.length; index += 1) {
      const name = order[index];
      if (exhausted.has(name)) continue;
      const placement = findPlacement(name, occupied, obstacles);
      if (!placement) { exhausted.add(name); continue; }
      result.push({ ...placement, kit }); placedThisPass += 1;
      stamp(placement.mask, placement.x, placement.y, occupied);
      obstacles.push({
        x0: placement.x + placement.mask.minX,
        y0: placement.y + placement.mask.minY,
        x1: placement.x + placement.mask.minX + placement.mask.width,
        y1: placement.y + placement.mask.minY + placement.mask.height
      });
      setProgress(((strategyIndex + (kit - 1 + (index + 1) / order.length) / maxKits) / 3) * 100, `Optimisation ${strategyIndex + 1} · recherche des pièces`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!placedThisPass || exhausted.size === new Set(order).size) break;
  }
  return result;
}
function validatePlacements(candidate) {
  const occupied = expandOccupied(defectMask, SAFE_CLEARANCE);
  for (const placement of candidate) {
    const left = placement.x + placement.mask.minX; const top = placement.y + placement.mask.minY;
    if (left < 0 || top < 0 || left + placement.mask.width > GRID_W || top + placement.mask.height > GRID_H) return false;
    for (const offset of placement.mask.offsets) {
      const row = Math.floor(offset / placement.mask.width); const column = offset - row * placement.mask.width;
      if (occupied[(top + row) * GRID_W + left + column]) return false;
    }
    stamp(placement.mask, placement.x, placement.y, occupied);
  }
  return true;
}
async function nest() {
  $('#planButton').disabled = true; $('#optimizationState').textContent = 'CALCUL…';
  const strategies = [['DOS', 'DEVANT', 'MANCHE', 'MANCHE', 'BANDE'], ['MANCHE', 'MANCHE', 'DOS', 'DEVANT', 'BANDE'], ['DEVANT', 'DOS', 'BANDE', 'MANCHE', 'MANCHE']];
  const defectObstacles = getDefectObstacleBounds(defectMask);
  let best = [];
  for (let index = 0; index < strategies.length; index += 1) {
    const candidate = await runStrategy(strategies[index], index, defectObstacles);
    if (candidate.length > best.length) best = candidate;
  }
  if (!validatePlacements(best)) {
    placements = []; renderResult(); updateSurfaceStats();
    $('#planButton').disabled = false; $('#downloadButton').disabled = true;
    $('#optimizationState').textContent = 'ÉCHEC DU CONTRÔLE';
    setStatus('Plan refusé : collision détectée');
    return;
  }
  placements = best; renderResult(); updateSurfaceStats();
  $('#planButton').disabled = false; $('#downloadButton').disabled = placements.length === 0;
  $('#optimizationState').textContent = 'TERMINÉ'; $('#stepPlan').classList.add('active');
  setStatus(`${placements.length} pièces placées`); setProgress(100, 'Nesting terminé');
}
function updateSurfaceStats() {
  const total = GRID_W * GRID_H * CELL_CM * CELL_CM;
  const defect = defectMask.reduce((sum, value) => sum + value, 0) * CELL_CM * CELL_CM;
  const used = placements.reduce((sum, placement) => sum + placement.mask.offsets.length, 0) * CELL_CM * CELL_CM;
  const healthy = Math.max(0, total - defect); const lost = Math.max(0, healthy - used);
  const complete = getCompleteTshirtCount();
  $('#resultStats').innerHTML = `<div><span>T-SHIRTS COMPLETS</span><strong>${complete}</strong></div><div><span>PIÈCES PLACÉES</span><strong>${placements.length}</strong></div><div><span>SURFACE TOTALE</span><strong>${total.toFixed(0)} cm²</strong></div><div><span>SURFACE DÉFECTUEUSE</span><strong>${defect.toFixed(0)} cm²</strong></div><div><span>SURFACE UTILISÉE</span><strong>${used.toFixed(0)} cm²</strong></div><div><span>PERDUE / SAINE</span><strong>${lost.toFixed(0)} cm² · ${healthy ? (used / healthy * 100).toFixed(1) : 0}%</strong></div>`;
}
function getCompleteTshirtCount() {
  const counts = placements.reduce((result, placement) => { result[placement.name] += 1; return result; }, { DOS: 0, DEVANT: 0, MANCHE: 0, BANDE: 0 });
  return Math.min(counts.DOS, counts.DEVANT, counts.BANDE, Math.floor(counts.MANCHE / 2));
}
function polygonForPlacement(placement) { const polygon = PIECES[placement.name]; const radians = placement.mask.angle * Math.PI / 180; const cos = Math.cos(radians); const sin = Math.sin(radians); const cx = polygon.reduce((sum, point) => sum + point[0], 0) / polygon.length; const cy = polygon.reduce((sum, point) => sum + point[1], 0) / polygon.length; return polygon.map(([x, y]) => { const rx = (x - cx) / CELL_CM * cos - (y - cy) / CELL_CM * sin + placement.x + placement.mask.minX; const ry = (x - cx) / CELL_CM * sin + (y - cy) / CELL_CM * cos + placement.y + placement.mask.minY; return [rx, ry]; }); }
function renderResult() { resultCanvas.width = GRID_W; resultCanvas.height = GRID_H; const context = resultCanvas.getContext('2d'); context.fillStyle = '#f5f5ed'; context.fillRect(0, 0, GRID_W, GRID_H); if (captureCanvas.width) { context.globalAlpha = .75; context.drawImage(captureCanvas, 0, 0, GRID_W, GRID_H); context.globalAlpha = 1; } context.fillStyle = '#d9424280'; for (let index = 0; index < defectMask.length; index += 1) if (defectMask[index]) context.fillRect(index % GRID_W, Math.floor(index / GRID_W), 1, 1); placements.forEach((placement) => { const polygon = polygonForPlacement(placement); context.beginPath(); polygon.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath(); context.fillStyle = `${COLORS[placement.name]}99`; context.fill(); context.strokeStyle = COLORS[placement.name]; context.lineWidth = 1.5; context.setLineDash([3, 3]); context.stroke(); context.setLineDash([]); const center = polygon.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / polygon.length); context.fillStyle = '#202623'; context.font = '8px Manrope'; context.fillText(`${placement.name} #${placement.kit}`, center[0] - 18, center[1]); }); $('#resultEmpty').style.display = 'none'; }
function drawCropMarks(pdf, x, y, width, height) { pdf.setDrawColor(80); pdf.line(x - 4, y, x + 4, y); pdf.line(x, y - 4, x, y + 4); pdf.line(x + width - 4, y, x + width + 4, y); pdf.line(x + width, y - 4, x + width, y + 4); pdf.line(x - 4, y + height, x + 4, y + height); pdf.line(x, y + height - 4, x, y + height + 4); pdf.line(x + width - 4, y + height, x + width + 4, y + height); pdf.line(x + width, y + height - 4, x + width, y + height + 4); }
function exportPdf() { if (!window.jspdf || !placements.length) return; const { jsPDF } = window.jspdf; const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }); pdf.setFontSize(16); pdf.text('ReTiss — plan de découpe 1:1', 15, 18); pdf.setFontSize(10); pdf.text(`${getCompleteTshirtCount()} T-shirts complets · tissu 3,00 m × 4,50 m`, 15, 26); pdf.addImage(resultCanvas.toDataURL('image/png'), 'PNG', 15, 35, 80, 120); pdf.rect(15, 165, 100, 100); pdf.setFontSize(9); pdf.text('Carré témoin 10 cm × 10 cm — vérifier : ce carré doit mesurer 10 cm à l’impression', 15, 272); const pageW = 200; const pageH = 287; const cols = Math.ceil((3000 - 10) / (pageW - 10)); const rows = Math.ceil((4500 - 10) / (pageH - 10)); for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) { pdf.addPage(); const offsetX = col * (pageW - 10); const offsetY = row * (pageH - 10); placements.forEach((placement) => { const polygon = polygonForPlacement(placement).map(([x, y]) => [(x * CELL_MM - offsetX) + 5, (y * CELL_MM - offsetY) + 5]); if (polygon.some(([x, y]) => x >= 0 && x <= pageW && y >= 0 && y <= pageH)) { pdf.setDrawColor(COLORS[placement.name]); pdf.setLineWidth(.3); pdf.lines(polygon.slice(1).map((point, index) => [point[0] - polygon[index][0], point[1] - polygon[index][1]]), polygon[0][0], polygon[0][1], [1, 1], 'S', true); } }); drawCropMarks(pdf, 5, 5, pageW - 10, pageH - 10); pdf.setFontSize(8); pdf.text(`ReTiss — page L${row + 1}C${col + 1} — échelle 1:1`, 15, 292); } pdf.save('retiss-plan-1-1.pdf'); }

$('#cameraButton').addEventListener('click', async () => {
  stream?.getTracks().forEach((track) => track.stop());
  await startCamera();
});
$('#captureButton').addEventListener('click', () => copyImage(video));
$('#fileInput').addEventListener('change', () => {
  const file = $('#fileInput').files[0];
  if (!file) return;
  const image = new Image(); const url = URL.createObjectURL(file);
  image.onload = () => { copyImage(image); URL.revokeObjectURL(url); };
  image.onerror = () => { URL.revokeObjectURL(url); setStatus('Impossible de lire cette image'); };
  image.src = url;
});
$('#analyzeButton').addEventListener('click', () => {
  const result = analyzeImage();
  $('#analysisPill').textContent = 'ANALYSÉ';
  $('#analysisSummary p').textContent = `${result.count * .25 >= 1 ? (result.count * .25).toFixed(0) : '<1'} cm² de défauts détectés. Ajuste le masque si nécessaire.`;
  $('#planButton').disabled = false; $('#stepAnalyze').classList.add('active'); setStatus('Masque analysé');
});
$('#sensitivity').addEventListener('input', () => {
  $('#sensitivityValue').textContent = Number($('#sensitivity').value).toFixed(1);
  if (!captureCanvas.width) return;
  const result = analyzeImage();
  $('#analysisPill').textContent = 'ANALYSÉ';
  $('#analysisSummary p').textContent = `${result.count * .25 >= 1 ? (result.count * .25).toFixed(0) : '<1'} cm² de défauts détectés. Ajuste le masque si nécessaire.`;
  $('#planButton').disabled = false;
});
$('#brushSize').addEventListener('input', () => { $('#brushValue').textContent = `${$('#brushSize').value} cm`; });
$('#addTool').addEventListener('click', () => { brushMode = 1; $('#addTool').classList.add('active'); $('#eraseTool').classList.remove('active'); });
$('#eraseTool').addEventListener('click', () => { brushMode = 0; $('#eraseTool').classList.add('active'); $('#addTool').classList.remove('active'); });
$('#resetMaskButton').addEventListener('click', () => { defectMask = originalMask.slice(); imageDefectMask = originalImageMask.slice(); renderMask(); updateMaskCount(); invalidatePlan(); });
maskCanvas.addEventListener('pointerdown', (event) => { isPainting = true; maskCanvas.setPointerCapture(event.pointerId); paintMask(event); });
maskCanvas.addEventListener('pointermove', (event) => { if (isPainting) paintMask(event); });
maskCanvas.addEventListener('pointerup', () => { isPainting = false; });
maskCanvas.addEventListener('pointercancel', () => { isPainting = false; });
$('#planButton').addEventListener('click', nest);
$('#downloadButton').addEventListener('click', exportPdf);
preparePieceMasks(); renderMask();