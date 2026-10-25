// Contrôleur de l'interface : relie le DOM, l'état de l'application et les
// modules de src/. Aucun calcul métier ici : détection, nesting, statistiques
// et PDF vivent dans src/core et src/export, testés sans navigateur.
import {
  CELL_CM, CELL_MM, COLORS, DEFAULT_ORIENTATION_MODE, FABRIC, GRID, KIT, MAX_IMAGE_WIDTH, ORIENTATION_MODES, PIECES,
  SAFE_CLEARANCE_CELLS, STRATEGIES
} from './src/config.js';
import { computeChroma, detectDefects } from './src/core/detection.js';
import { combineLayers, countMask, createMask, paintStroke, resampleMaxPool } from './src/core/mask.js';
import { buildPieceShapes, nestPieces } from './src/core/nesting.js';
import { computeSurfaceStats } from './src/core/stats.js';
import { buildCutPlanPdf } from './src/export/pdf.js';
import { startCamera, stopCamera } from './src/ui/camera.js';
import { clearCanvas, drawMaskOverlay, drawPlan } from './src/ui/render.js';

const $ = (selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Élément introuvable dans la page : ${selector}`);
  return element;
};

const ui = {
  status: $('#statusText'),
  video: $('#video'), captureCanvas: $('#captureCanvas'), sourcePreview: $('#sourcePreview'),
  cameraStage: $('#cameraStage'), cameraPlaceholder: $('#cameraPlaceholder'),
  cameraButton: $('#cameraButton'), captureButton: $('#captureButton'), fileInput: $('#fileInput'),
  analysisPill: $('#analysisPill'), analysisSummary: $('#analysisSummary p'),
  sensitivity: $('#sensitivity'), sensitivityValue: $('#sensitivityValue'), analyzeButton: $('#analyzeButton'),
  stepAnalyze: $('#stepAnalyze'), stepPlan: $('#stepPlan'),
  maskStage: $('.mask-stage'), maskCanvas: $('#maskCanvas'), editorEmpty: $('#editorEmpty'), maskCount: $('#maskCount'),
  addTool: $('#addTool'), eraseTool: $('#eraseTool'), brushSize: $('#brushSize'), brushValue: $('#brushValue'),
  resetMaskButton: $('#resetMaskButton'), orientationMode: $('#orientationMode'), planButton: $('#planButton'),
  progressBar: $('#progressBar'), progressText: $('#progressText'),
  resultCanvas: $('#resultCanvas'), resultEmpty: $('#resultEmpty'), resultStats: $('#resultStats'),
  optimizationState: $('#optimizationState'), downloadButton: $('#downloadButton')
};

const DEFAULT_SUMMARY = ui.analysisSummary.textContent;
const CELL_AREA_CM2 = CELL_CM * CELL_CM;

// D-21 : formes rastérisées par mode d'orientation, calculées à la demande.
const shapesByMode = new Map();
function getShapes(mode) {
  if (!ORIENTATION_MODES[mode]) throw new Error(`Mode d’orientation inconnu : ${mode}`);
  if (!shapesByMode.has(mode)) shapesByMode.set(mode, buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: ORIENTATION_MODES[mode].angles }));
  return shapesByMode.get(mode);
}

const state = {
  image: null,        // { width, height, chroma } ; les pixels sont dans ui.captureCanvas
  autoMask: null,     // détection automatique, résolution de l'image
  addedMask: null,    // zones ajoutées au pinceau
  erasedMask: null,   // zones effacées au pinceau
  analyzed: false,
  maskVersion: 0,     // incrémenté à chaque changement de masque ou d'image
  derived: null,      // cache { version, imageMask, gridMask }
  plan: null,         // { placements, stats, gridMask }
  nesting: false,
  stream: null,
  brushMode: 'add',
  orientationMode: DEFAULT_ORIENTATION_MODE,
  painting: false,
  lastPoint: null,    // dernier point du trait en cours, en pixels image
  maskRenderQueued: false,
  analysisQueued: false
};

// ---------- Utilitaires d'affichage ----------

function setStatus(text) { ui.status.textContent = text; }
function setProgress(percent, text) { ui.progressBar.style.width = `${percent}%`; ui.progressText.textContent = text; }
function formatArea(cm2) { return `${cm2 >= 1 || cm2 === 0 ? cm2.toFixed(0) : '<1'} cm²`; }

/** Enveloppe un gestionnaire d'événement : toute erreur s'affiche dans la barre de statut. */
function guard(handler) {
  return async (event) => {
    try { await handler(event); } catch (error) { console.error(error); setStatus(`Erreur : ${error.message}`); }
  };
}

// ---------- Masques ----------

/** Masque courant à la résolution de l'image et sur la grille physique (avec cache). */
function getMasks() {
  if (!state.image) return { imageMask: null, gridMask: createMask(GRID.width, GRID.height) };
  if (state.derived?.version !== state.maskVersion) {
    const imageMask = combineLayers(state.autoMask, state.addedMask, state.erasedMask);
    state.derived = { version: state.maskVersion, imageMask, gridMask: resampleMaxPool(imageMask, GRID.width, GRID.height) };
  }
  return state.derived;
}

function defectAreaCm2() { return countMask(getMasks().gridMask) * CELL_AREA_CM2; }

function renderMask() {
  if (!state.image) { ui.editorEmpty.style.display = ''; ui.maskCount.textContent = '0 cm²'; return; }
  drawMaskOverlay(ui.maskCanvas, ui.captureCanvas, getMasks().imageMask);
  ui.editorEmpty.style.display = 'none';
  ui.maskCount.textContent = formatArea(defectAreaCm2());
}

function scheduleMaskRender() {
  if (state.maskRenderQueued) return;
  state.maskRenderQueued = true;
  requestAnimationFrame(() => { state.maskRenderQueued = false; renderMask(); });
}

function maskChanged() {
  state.maskVersion += 1;
  invalidatePlan();
  scheduleMaskRender();
}

// ---------- Plan et statistiques ----------

function renderStats() {
  const { gridMask } = state.plan ?? getMasks();
  const stats = state.plan?.stats ?? computeSurfaceStats({ gridMask, placements: [], cellCm: CELL_CM, kit: KIT });
  const cells = [
    ['T-SHIRTS COMPLETS', String(stats.completeKits)],
    ['PIÈCES PLACÉES', String(stats.pieceCount)],
    ['SURFACE TOTALE', `${stats.totalCm2.toFixed(0)} cm²`],
    ['SURFACE DÉFECTUEUSE', `${stats.defectCm2.toFixed(0)} cm²`],
    ['SURFACE UTILISÉE', `${stats.usedCm2.toFixed(0)} cm²`],
    ['PERDUE / SAINE', `${stats.lostCm2.toFixed(0)} cm² perdus · ${(stats.usageRatio * 100).toFixed(1)} % utilisés`]
  ];
  ui.resultStats.replaceChildren(...cells.map(([label, value]) => {
    const cell = document.createElement('div');
    const title = document.createElement('span'); title.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    cell.append(title, strong);
    return cell;
  }));
}

function invalidatePlan() {
  state.plan = null;
  clearCanvas(ui.resultCanvas);
  ui.resultEmpty.style.display = '';
  ui.downloadButton.disabled = true;
  ui.optimizationState.textContent = state.nesting ? 'CALCUL…' : state.image ? 'À RECALCULER' : 'EN ATTENTE';
  ui.stepPlan.classList.remove('active');
  renderStats();
}

// ---------- Image source ----------

function loadImage(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) throw new Error('image vide ou pas encore prête');
  const scale = Math.min(1, MAX_IMAGE_WIDTH / width);
  const imageWidth = Math.max(1, Math.round(width * scale));
  const imageHeight = Math.max(1, Math.round(height * scale));

  ui.captureCanvas.width = imageWidth; ui.captureCanvas.height = imageHeight;
  const context = ui.captureCanvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, imageWidth, imageHeight);
  ui.sourcePreview.width = imageWidth; ui.sourcePreview.height = imageHeight;
  ui.sourcePreview.getContext('2d').drawImage(ui.captureCanvas, 0, 0);

  state.image = { width: imageWidth, height: imageHeight, chroma: computeChroma(context.getImageData(0, 0, imageWidth, imageHeight)) };
  state.autoMask = createMask(imageWidth, imageHeight);
  state.addedMask = createMask(imageWidth, imageHeight);
  state.erasedMask = createMask(imageWidth, imageHeight);
  state.analyzed = false; state.derived = null; state.maskVersion += 1;

  const ratio = width / height;
  ui.cameraStage.style.aspectRatio = `${ratio}`;
  ui.maskStage.style.aspectRatio = `${ratio}`;
  ui.cameraStage.classList.add('has-image'); ui.cameraPlaceholder.classList.add('hidden');
  ui.analyzeButton.disabled = false; ui.analysisPill.textContent = 'PRÊT'; ui.analysisSummary.textContent = DEFAULT_SUMMARY;
  ui.stepAnalyze.classList.remove('active'); ui.planButton.disabled = true;
  setProgress(0, 'Nesting en attente');
  invalidatePlan(); renderMask();

  const fabricRatio = FABRIC.widthCm / FABRIC.heightCm;
  if (Math.abs(ratio / fabricRatio - 1) > 0.05) {
    setStatus(`Image prête — attention : proportions ${ratio.toFixed(2)} ≠ tissu ${fabricRatio.toFixed(2)}, le plan sera étiré`);
  } else {
    setStatus('Image prête — proportions conservées');
  }
}

function runAnalysis() {
  if (!state.image) return;
  const { mask } = detectDefects(state.image.chroma, { madFactor: Number(ui.sensitivity.value) });
  state.autoMask = mask; state.analyzed = true;
  maskChanged();
  ui.analysisPill.textContent = 'ANALYSÉ';
  ui.analysisSummary.textContent = `${formatArea(defectAreaCm2())} de défauts au total. Ajuste le masque si nécessaire.`;
  ui.planButton.disabled = state.nesting;
  ui.stepAnalyze.classList.add('active');
  setStatus('Masque analysé');
}

// ---------- Pinceau ----------

function eventToImagePoint(event) {
  const rect = ui.maskCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: (event.clientX - rect.left) / rect.width * state.image.width,
    y: (event.clientY - rect.top) / rect.height * state.image.height
  };
}

/** Rayons du pinceau en pixels image : le diamètre affiché est en cm sur le tissu. */
function brushRadii() {
  const radiusCm = Number(ui.brushSize.value) / 2;
  return { rx: radiusCm * state.image.width / FABRIC.widthCm, ry: radiusCm * state.image.height / FABRIC.heightCm };
}

function paintTo(point) {
  const { rx, ry } = brushRadii();
  const from = state.lastPoint ?? point;
  const [target, opposite] = state.brushMode === 'add' ? [state.addedMask, state.erasedMask] : [state.erasedMask, state.addedMask];
  const changed = paintStroke(target, from, point, rx, ry, 1) + paintStroke(opposite, from, point, rx, ry, 0);
  state.lastPoint = point;
  if (changed) maskChanged();
}

function setBrushMode(mode) {
  state.brushMode = mode;
  ui.addTool.classList.toggle('active', mode === 'add');
  ui.eraseTool.classList.toggle('active', mode === 'erase');
}

// ---------- Nesting ----------

async function runNesting() {
  if (state.nesting || !state.image) return;
  const version = state.maskVersion;
  const { gridMask } = getMasks();
  const shapes = getShapes(state.orientationMode);
  state.nesting = true;
  ui.planButton.disabled = true; ui.optimizationState.textContent = 'CALCUL…';
  setProgress(0, 'Optimisation · 0 %');
  try {
    const result = await nestPieces({
      gridMask, shapes, strategies: STRATEGIES, clearance: SAFE_CLEARANCE_CELLS, kit: KIT,
      onProgress: (fraction) => setProgress(fraction * 100, `Optimisation · ${Math.round(fraction * 100)} %`),
      shouldAbort: () => state.maskVersion !== version
    });
    if (result.aborted) {
      setProgress(0, 'Calcul interrompu');
      ui.optimizationState.textContent = 'À RECALCULER';
      setStatus('Masque modifié pendant le calcul : relance l’imbrication');
      return;
    }
    if (!result.validation.ok) {
      setProgress(0, 'Plan refusé');
      ui.optimizationState.textContent = 'ÉCHEC DU CONTRÔLE';
      setStatus(`Plan refusé : ${result.validation.reason}`);
      return;
    }
    const { placements } = result;
    state.plan = { placements, gridMask, stats: computeSurfaceStats({ gridMask, placements, cellCm: CELL_CM, kit: KIT }) };
    drawPlan(ui.resultCanvas, { imageCanvas: ui.captureCanvas, gridMask, placements, colors: COLORS });
    ui.resultEmpty.style.display = 'none';
    renderStats();
    ui.downloadButton.disabled = placements.length === 0;
    ui.optimizationState.textContent = 'TERMINÉ'; ui.stepPlan.classList.add('active');
    setStatus(`${placements.length} pièces placées · ${state.plan.stats.completeKits} T-shirts complets`);
    setProgress(100, 'Nesting terminé');
  } finally {
    state.nesting = false;
    ui.planButton.disabled = !state.analyzed;
  }
}

// ---------- Export ----------

async function exportPdf() {
  if (!state.plan?.placements.length) return;
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) { setStatus('PDF indisponible : la bibliothèque jsPDF n’a pas pu être chargée (connexion Internet ?)'); return; }
  ui.downloadButton.disabled = true; setStatus('Génération du PDF…');
  await new Promise((resolve) => setTimeout(resolve, 30)); // laisse le navigateur afficher le statut
  try {
    const pdf = buildCutPlanPdf(JsPdf, {
      placements: state.plan.placements, overviewPng: ui.resultCanvas.toDataURL('image/png'),
      completeKits: state.plan.stats.completeKits, fabric: FABRIC, cellMm: CELL_MM, colors: COLORS
    });
    pdf.save('retiss-plan-1-1.pdf');
    setStatus(`PDF généré (${pdf.getNumberOfPages()} pages)`);
  } finally {
    ui.downloadButton.disabled = !state.plan;
  }
}

// ---------- Événements ----------

ui.cameraButton.addEventListener('click', guard(async () => {
  stopCamera(state.stream); state.stream = null;
  ui.captureButton.disabled = true;
  setStatus('Connexion à la caméra…');
  try {
    state.stream = await startCamera(ui.video);
  } catch (error) {
    setStatus(`Caméra indisponible : ${error.message}`);
    return;
  }
  ui.cameraStage.style.aspectRatio = `${ui.video.videoWidth / ui.video.videoHeight}`;
  ui.cameraStage.classList.remove('has-image'); ui.cameraPlaceholder.classList.add('hidden');
  ui.captureButton.disabled = false;
  setStatus('Caméra connectée');
}));

ui.captureButton.addEventListener('click', guard(() => {
  loadImage(ui.video);
  stopCamera(state.stream); state.stream = null;
  ui.captureButton.disabled = true;
}));

ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files[0];
  ui.fileInput.value = ''; // permet de réimporter le même fichier
  if (!file) return;
  const image = new Image(); const url = URL.createObjectURL(file);
  image.onload = guard(() => { URL.revokeObjectURL(url); loadImage(image); });
  image.onerror = () => { URL.revokeObjectURL(url); setStatus('Impossible de lire cette image'); };
  image.src = url;
});

ui.analyzeButton.addEventListener('click', guard(runAnalysis));

ui.sensitivity.addEventListener('input', () => {
  ui.sensitivityValue.textContent = Number(ui.sensitivity.value).toFixed(1);
  if (!state.image || state.analysisQueued) return;
  state.analysisQueued = true;
  requestAnimationFrame(guard(() => { state.analysisQueued = false; runAnalysis(); }));
});

ui.brushSize.addEventListener('input', () => { ui.brushValue.textContent = `${ui.brushSize.value} cm`; });
ui.addTool.addEventListener('click', () => setBrushMode('add'));
ui.eraseTool.addEventListener('click', () => setBrushMode('erase'));

ui.resetMaskButton.addEventListener('click', () => {
  if (!state.image) return;
  state.addedMask = createMask(state.image.width, state.image.height);
  state.erasedMask = createMask(state.image.width, state.image.height);
  maskChanged();
  setStatus('Retouches manuelles supprimées');
});

ui.maskCanvas.addEventListener('pointerdown', guard((event) => {
  if (!state.image || event.button !== 0) return;
  const point = eventToImagePoint(event);
  if (!point) return;
  state.painting = true; state.lastPoint = null;
  ui.maskCanvas.setPointerCapture(event.pointerId);
  paintTo(point);
}));
ui.maskCanvas.addEventListener('pointermove', guard((event) => {
  if (!state.painting) return;
  const point = eventToImagePoint(event);
  if (point) paintTo(point);
}));
const endStroke = () => { state.painting = false; state.lastPoint = null; };
ui.maskCanvas.addEventListener('pointerup', endStroke);
ui.maskCanvas.addEventListener('pointercancel', endStroke);

ui.orientationMode.replaceChildren(...Object.entries(ORIENTATION_MODES).map(([value, { label }]) => new Option(label, value, false, value === state.orientationMode)));
ui.orientationMode.addEventListener('change', () => {
  state.orientationMode = ui.orientationMode.value;
  // Un plan calculé avec d'autres orientations n'est plus valable.
  state.maskVersion += 1;
  invalidatePlan();
  setStatus(state.orientationMode === 'droit-fil' ? 'Pièces alignées sur le droit-fil' : 'Attention : ce mode ne respecte pas le droit-fil');
});

ui.planButton.addEventListener('click', guard(runNesting));
ui.downloadButton.addEventListener('click', guard(exportPdf));

renderMask(); renderStats();

// Accès en lecture pour les tests de bout en bout (tests/e2e.js).
window.retissDebug = Object.freeze({ get state() { return state; }, getMasks, getShapes });
