// Contrôleur de l'interface : relie le DOM, l'état de l'application et les
// modules de src/. Aucun calcul métier ici : détection, nesting, statistiques
// et PDF vivent dans src/core et src/export, testés sans navigateur.
import {
  APP_VERSION, CELL_CM, CELL_MM, COLORS, DEFAULT_ORIENTATION_MODE, FABRIC, FABRIC_LIMITS, KIT, MAX_IMAGE_WIDTH, MAX_SOURCE_WIDTH, ORIENTATION_MODES, PIECES,
  SAFE_CLEARANCE_CELLS
} from './src/config.js';
import { computeColorPlanes, detectDefects } from './src/core/detection.js';
import { fabricWithRatio, formatFabric, gridForFabric, validateFabric } from './src/core/fabric.js';
import { combineLayers, countMask, createMask, paintStroke, resampleMaxPool } from './src/core/mask.js';
import { buildPieceShapes, nestPieces } from './src/core/nesting.js';
import { orderCorners, quadRatio, rectifiedSize, warpPerspective } from './src/core/perspective.js';
import { planForProjection } from './src/core/projection.js';
import { computeSurfaceStats } from './src/core/stats.js';
import { buildCutPlanPdf } from './src/export/pdf.js';
import { listCameras, startCamera, stopCamera } from './src/ui/camera.js';
import { clearCanvas, drawCropPoints, drawMaskOverlay, drawPlan } from './src/ui/render.js';

const $ = (selector) => {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Élément introuvable dans la page : ${selector}`);
  return element;
};

const ui = {
  status: $('#statusText'),
  video: $('#video'), captureCanvas: $('#captureCanvas'), sourcePreview: $('#sourcePreview'),
  cameraStage: $('#cameraStage'), cameraPlaceholder: $('#cameraPlaceholder'),
  cameraButton: $('#cameraButton'), captureButton: $('#captureButton'), externalCameraButton: $('#externalCameraButton'),
  cameraDialog: $('#cameraDialog'), cameraSelect: $('#cameraSelect'), refreshCamerasButton: $('#refreshCamerasButton'),
  useCameraButton: $('#useCameraButton'), cameraDialogStatus: $('#cameraDialogStatus'), cropButton: $('#cropButton'), fileInput: $('#fileInput'), fileLabel: $('label[for="fileInput"]'),
  fabricWidth: $('#fabricWidth'), fabricHeight: $('#fabricHeight'), fabricLengthHint: $('#fabricLengthHint'), fabricBadge: $('#fabricBadge'), fabricIntro: $('#fabricIntro'),
  analysisPill: $('#analysisPill'), analysisSummary: $('#analysisSummary p'),
  sensitivity: $('#sensitivity'), sensitivityValue: $('#sensitivityValue'), analyzeButton: $('#analyzeButton'),
  stepAnalyze: $('#stepAnalyze'), stepPlan: $('#stepPlan'),
  maskStage: $('.mask-stage'), maskCanvas: $('#maskCanvas'), editorEmpty: $('#editorEmpty'), maskCount: $('#maskCount'),
  addTool: $('#addTool'), eraseTool: $('#eraseTool'), brushSize: $('#brushSize'), brushValue: $('#brushValue'),
  resetMaskButton: $('#resetMaskButton'), orientationMode: $('#orientationMode'), planButton: $('#planButton'),
  progressBar: $('#progressBar'), progressText: $('#progressText'),
  resultFrame: $('.result-frame'), resultCanvas: $('#resultCanvas'), resultEmpty: $('#resultEmpty'), resultStats: $('#resultStats'),
  optimizationState: $('#optimizationState'), downloadButton: $('#downloadButton'), projectButton: $('#projectButton')
};

const DEFAULT_SUMMARY = ui.analysisSummary.textContent;
const CROP_LABEL = ui.cropButton.textContent;
const CELL_AREA_CM2 = CELL_CM * CELL_CM;

// D-21 : formes rastérisées par mode d'orientation, calculées à la demande.
const shapesByMode = new Map();
function getShapes(mode) {
  if (!ORIENTATION_MODES[mode]) throw new Error(`Mode d’orientation inconnu : ${mode}`);
  if (!shapesByMode.has(mode)) shapesByMode.set(mode, buildPieceShapes(PIECES, { cellCm: CELL_CM, angles: ORIENTATION_MODES[mode].angles }));
  return shapesByMode.get(mode);
}

const state = {
  source: null,       // photo d'origine (canvas), avant recadrage (D-19)
  crop: { picking: false, points: [], corners: null }, // coins cliqués / appliqués, en pixels de la photo d'origine
  image: null,        // { width, height, planes } ; les pixels sont dans ui.captureCanvas
  autoMask: null,     // détection automatique, résolution de l'image
  addedMask: null,    // zones ajoutées au pinceau
  erasedMask: null,   // zones effacées au pinceau
  analyzed: false,
  fabric: FABRIC,     // taille du coupon en cm (D-20)
  lengthFromImage: true, // D-29 : tant que la photo n'est pas recadrée, la longueur suit ses proportions
  inputVersion: 0,    // incrémenté dès qu'une entrée du calcul change : image, masque, tissu, orientation
  derived: null,      // cache { version, imageMask, gridMask }
  plan: null,         // { placements, stats, gridMask }
  nesting: false,
  stream: null,
  cameraDeviceId: readStoredCamera(), // D-32 : caméra choisie (téléphone, webcam…), mémorisée sur ce navigateur
  brushMode: 'add',
  orientationMode: DEFAULT_ORIENTATION_MODE,
  painting: false,
  lastPoint: null,    // dernier point du trait en cours, en pixels image
  maskRenderQueued: false,
  analysisQueued: false
};

// ---------- Utilitaires d'affichage ----------

// Préférence de confort uniquement : l'appli fonctionne si le stockage est indisponible.
function readStoredCamera() { try { return localStorage.getItem('retiss.cameraDeviceId') || null; } catch { return null; } }
function storeCamera(deviceId) { try { localStorage.setItem('retiss.cameraDeviceId', deviceId); } catch { /* navigation privée */ } }

function setStatus(text) { ui.status.textContent = text; }
function setProgress(percent, text) { ui.progressBar.style.width = `${percent}%`; ui.progressText.textContent = text; }
// Nombres au format français : espaces fines entre milliers, virgule décimale.
const integerFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const decimalFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const squareMeterFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Surface lisible : en cm² sous 1 m², en m² au-delà. */
function formatArea(cm2) {
  if (cm2 === 0) return '0 cm²';
  if (cm2 < 1) return '<1 cm²';
  return cm2 < 10000 ? `${integerFormat.format(cm2)} cm²` : `${squareMeterFormat.format(cm2 / 10000)} m²`;
}

/** Erreur bien visible en haut de la page, en plus de la barre de statut (D-33). */
function showError(message) {
  const banner = document.getElementById('appBanner');
  banner.textContent = message; banner.hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => { banner.hidden = true; }, 12000);
}

/** Enveloppe un gestionnaire d'événement : toute erreur s'affiche dans la barre de statut et le bandeau. */
function guard(handler) {
  return async (event) => {
    try { await handler(event); } catch (error) { console.error(error); setStatus(`Erreur : ${error.message}`); showError(`Erreur : ${error.message}`); }
  };
}

// ---------- Canal vers la fenêtre de projection (D-24) ----------

// Canal partagé avec projection.html (même origine) : la fenêtre de projection
// dit « hello » à l'ouverture, on lui répond avec le plan courant.
const projectionChannel = 'BroadcastChannel' in window ? new BroadcastChannel('retiss-projection') : null;

function publishPlan() {
  if (!projectionChannel) return;
  const message = state.plan
    ? planForProjection({ placements: state.plan.placements, gridMask: state.plan.gridMask, fabric: state.fabric, cellCm: CELL_CM, colors: COLORS })
    : { type: 'plan', fabric: state.fabric, pieces: [], defects: [] };
  projectionChannel.postMessage({ ...message, version: APP_VERSION });
}
projectionChannel?.addEventListener('message', (event) => { if (event.data?.type === 'hello') publishPlan(); });

// ---------- Masques ----------

/** Masque courant à la résolution de l'image et sur la grille physique (avec cache). */
function getMasks() {
  const grid = gridForFabric(state.fabric);
  if (!state.image) return { imageMask: null, gridMask: createMask(grid.width, grid.height) };
  if (state.derived?.version !== state.inputVersion) {
    const imageMask = combineLayers(state.autoMask, state.addedMask, state.erasedMask);
    state.derived = { version: state.inputVersion, imageMask, gridMask: resampleMaxPool(imageMask, grid.width, grid.height) };
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
  state.inputVersion += 1;
  invalidatePlan();
  scheduleMaskRender();
}

// ---------- Plan et statistiques ----------

function renderStats() {
  const { gridMask } = state.plan ?? getMasks();
  const stats = state.plan?.stats ?? computeSurfaceStats({ gridMask, placements: [], cellCm: CELL_CM, kit: KIT });
  // [titre, valeur, précision affichée en petit]. D-41 : sans plan, les
  // valeurs qui en dépendent restent vides au lieu d'annoncer « 0 % » ou une
  // chute égale à tout le tissu.
  const planned = (value) => (state.plan ? value : '—');
  const cells = [
    ['T-SHIRTS COMPLETS', planned(String(stats.completeKits)), state.plan ? `${stats.pieceCount} pièces` : 'lance l’imbrication'],
    ['TISSU SAIN UTILISÉ', planned(`${decimalFormat.format(stats.usageRatio * 100)} %`), 'part du tissu sans défaut'],
    ['SURFACE DÉCOUPÉE', planned(formatArea(stats.usedCm2)), 'surface des patrons'],
    ['CHUTE', planned(formatArea(stats.lostCm2)), 'tissu sain non utilisé'],
    ['DÉFAUTS', formatArea(stats.defectCm2), 'taches et zones exclues'],
    ['TISSU', formatArea(stats.totalCm2), formatFabric(state.fabric)]
  ];
  ui.resultStats.replaceChildren(...cells.map(([label, value, detail]) => {
    const cell = document.createElement('div');
    const title = document.createElement('span'); title.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    const small = document.createElement('small'); small.textContent = detail;
    cell.append(title, strong, small);
    return cell;
  }));
}

function invalidatePlan() {
  state.plan = null;
  publishPlan(); // la projection ne doit jamais montrer un plan périmé
  clearCanvas(ui.resultCanvas);
  ui.resultEmpty.style.display = '';
  ui.resultFrame.classList.remove('has-plan');
  ui.downloadButton.disabled = true;
  ui.optimizationState.textContent = state.nesting ? 'CALCUL…' : state.image ? 'À RECALCULER' : 'EN ATTENTE';
  ui.stepPlan.classList.remove('active');
  renderStats();
}

// ---------- Image source ----------

/** Nouvelle photo (fichier ou caméra) : la conserve comme source puis l'analyse telle quelle. */
function loadSource(source) {
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) throw new Error('image vide ou pas encore prête');
  const scale = Math.min(1, MAX_SOURCE_WIDTH / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, canvas.width, canvas.height);
  state.source = canvas;
  state.crop = { picking: false, points: [], corners: null };
  ui.cropButton.disabled = false; ui.cropButton.textContent = CROP_LABEL;
  // D-29 : le plan est imbriqué sur une image aux proportions de la photo.
  state.lengthFromImage = true;
  setFabric(fabricWithRatio(state.fabric.widthCm, canvas.width / canvas.height));
  loadImage(canvas);
}

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

  state.image = { width: imageWidth, height: imageHeight, planes: computeColorPlanes(context.getImageData(0, 0, imageWidth, imageHeight)) };
  state.autoMask = createMask(imageWidth, imageHeight);
  state.addedMask = createMask(imageWidth, imageHeight);
  state.erasedMask = createMask(imageWidth, imageHeight);
  state.analyzed = false; state.derived = null; state.inputVersion += 1;

  const ratio = width / height;
  ui.cameraStage.style.aspectRatio = `${ratio}`;
  ui.maskStage.style.aspectRatio = `${ratio}`;
  ui.cameraStage.classList.add('has-image'); ui.cameraPlaceholder.classList.add('hidden');
  ui.analyzeButton.disabled = false; ui.analysisPill.textContent = 'PRÊT'; ui.analysisSummary.textContent = DEFAULT_SUMMARY; // D-16
  ui.stepAnalyze.classList.remove('active'); ui.planButton.disabled = true;
  setProgress(0, 'Imbrication en attente');
  invalidatePlan(); renderMask();
  // L'analyse est instantanée : on la lance d'office, l'utilisateur n'a plus qu'à ajuster.
  runAnalysis();
  setStatus(`Image analysée — ${proportionMessage()}`);
}

/** Compare les proportions de l'image à celles du tissu saisi. */
function proportionMessage() {
  if (!state.image) return formatFabric(state.fabric);
  const imageRatio = state.image.width / state.image.height;
  const fabricRatio = state.fabric.widthCm / state.fabric.heightCm;
  return Math.abs(imageRatio / fabricRatio - 1) > 0.05
    ? `attention : proportions ${imageRatio.toFixed(2)} ≠ tissu ${fabricRatio.toFixed(2)}, le plan sera étiré`
    : 'proportions conservées';
}

/**
 * Applique une taille de tissu : champs, badges, puis grille et plan s'il y a
 * un changement. Renvoie true si la taille a changé.
 */
function setFabric(fabric) {
  ui.fabricWidth.value = String(fabric.widthCm); ui.fabricHeight.value = String(fabric.heightCm);
  ui.fabricHeight.disabled = state.lengthFromImage;
  ui.fabricLengthHint.textContent = state.lengthFromImage
    ? 'Longueur calculée d’après les proportions de la photo. Recadre le tissu pour la saisir.'
    : 'Longueur saisie : l’image redressée suit ces proportions.';
  if (fabric.widthCm === state.fabric.widthCm && fabric.heightCm === state.fabric.heightCm) return false;
  state.fabric = fabric;
  ui.fabricBadge.textContent = formatFabric(fabric); ui.fabricIntro.textContent = formatFabric(fabric);
  state.inputVersion += 1; // la grille change de taille : masque physique et plan à recalculer
  invalidatePlan(); scheduleMaskRender();
  return true;
}

/** D-20 : applique la taille saisie ; une saisie invalide est signalée et ignorée. */
function applyFabricInputs() {
  let fabric;
  try {
    if (state.lengthFromImage && state.image) {
      // D-29 : seule la largeur est saisie, la longueur suit la photo.
      const { widthCm } = validateFabric({ widthCm: ui.fabricWidth.value, heightCm: FABRIC_LIMITS.minCm });
      fabric = fabricWithRatio(widthCm, state.image.width / state.image.height);
    } else {
      fabric = validateFabric({ widthCm: ui.fabricWidth.value, heightCm: ui.fabricHeight.value });
    }
  } catch (error) {
    ui.fabricWidth.setAttribute('aria-invalid', 'true'); ui.fabricHeight.setAttribute('aria-invalid', 'true');
    setStatus(error.message);
    return;
  }
  ui.fabricWidth.removeAttribute('aria-invalid'); ui.fabricHeight.removeAttribute('aria-invalid');
  if (!setFabric(fabric)) return;
  if (state.crop.picking) stopCropPicking();
  if (state.crop.corners) {
    // L'image redressée doit avoir les proportions du nouveau tissu : on la
    // recalcule (loadImage relance l'analyse ; les retouches au pinceau,
    // dessinées sur l'ancienne image, sont perdues).
    const hadEdits = countMask(state.addedMask) + countMask(state.erasedMask) > 0;
    applyCrop(state.crop.corners);
    setStatus(`Tissu : ${formatFabric(fabric)} — image redressée et réanalysée${hadEdits ? ' (retouches au pinceau effacées)' : ''}`);
    return;
  }
  setStatus(`Tissu : ${formatFabric(fabric)} — ${proportionMessage()}`);
}

// ---------- Recadrage (D-19) ----------

function startCropPicking() {
  state.crop.picking = true; state.crop.points = [];
  ui.cameraStage.style.aspectRatio = `${state.source.width / state.source.height}`;
  drawCropPoints(ui.sourcePreview, state.source, []);
  ui.cropButton.textContent = '✕ Annuler le recadrage';
  setStatus('Clique les 4 coins du tissu sur la photo (0/4)');
}

function stopCropPicking() {
  state.crop.picking = false; state.crop.points = [];
  ui.cropButton.textContent = CROP_LABEL;
  ui.cameraStage.style.aspectRatio = `${state.image.width / state.image.height}`;
  ui.sourcePreview.width = state.image.width; ui.sourcePreview.height = state.image.height;
  ui.sourcePreview.getContext('2d').drawImage(ui.captureCanvas, 0, 0);
}

function addCropPoint(event) {
  const rect = ui.sourcePreview.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  state.crop.points.push([(event.clientX - rect.left) / rect.width * state.source.width, (event.clientY - rect.top) / rect.height * state.source.height]);
  drawCropPoints(ui.sourcePreview, state.source, state.crop.points);
  if (state.crop.points.length < 4) { setStatus(`Clique les 4 coins du tissu sur la photo (${state.crop.points.length}/4)`); return; }
  let corners;
  try {
    corners = orderCorners(state.crop.points);
  } catch (error) {
    state.crop.points = [];
    drawCropPoints(ui.sourcePreview, state.source, []);
    setStatus(`${error.message} — recommence (0/4)`);
    return;
  }
  applyCrop(corners);
}

/** Redresse la photo d'origine selon les coins, aux proportions du tissu saisi, et la charge pour analyse. */
function applyCrop(corners) {
  if (state.lengthFromImage) {
    // Premier recadrage : longueur estimée d'après les coins, puis modifiable à la main.
    state.lengthFromImage = false;
    setFabric(fabricWithRatio(state.fabric.widthCm, quadRatio(corners)));
  }
  const { width, height } = rectifiedSize(corners, state.fabric, MAX_IMAGE_WIDTH);
  const pixels = state.source.getContext('2d').getImageData(0, 0, state.source.width, state.source.height);
  const warped = warpPerspective(pixels, corners, width, height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(warped.data, width, height), 0, 0);
  state.crop = { picking: false, points: [], corners };
  ui.cropButton.textContent = CROP_LABEL;
  loadImage(canvas);
  setStatus(`Tissu recadré, perspective corrigée — ${formatFabric(state.fabric)} (saisis la longueur réelle si besoin)`);
}

function runAnalysis() {
  if (!state.image) return;
  const { mask } = detectDefects(state.image.planes, { madFactor: Number(ui.sensitivity.value) });
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

/** Rayons du pinceau en pixels image : le diamètre affiché est en cm sur le tissu, en x comme en y (D-10). */
function brushRadii() {
  const radiusCm = Number(ui.brushSize.value) / 2;
  return { rx: radiusCm * state.image.width / state.fabric.widthCm, ry: radiusCm * state.image.height / state.fabric.heightCm };
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

// ---------- Imbrication (nesting) ----------

async function runNesting() {
  if (state.nesting || !state.image) return;
  const version = state.inputVersion;
  const { gridMask } = getMasks();
  const shapes = getShapes(state.orientationMode);
  state.nesting = true;
  ui.planButton.disabled = true; ui.optimizationState.textContent = 'CALCUL…';
  setProgress(0, 'Optimisation · 0 %');
  try {
    const result = await nestPieces({
      gridMask, shapes, clearance: SAFE_CLEARANCE_CELLS, kit: KIT,
      onProgress: (fraction) => setProgress(fraction * 100, `Optimisation · ${Math.round(fraction * 100)} %`),
      shouldAbort: () => state.inputVersion !== version // D-08 : résultat périmé si une entrée a changé
    });
    if (result.aborted) {
      setProgress(0, 'Calcul interrompu');
      ui.optimizationState.textContent = 'À RECALCULER';
      setStatus('Masque, tissu ou orientation modifié pendant le calcul : relance l’imbrication');
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
    ui.resultFrame.classList.add('has-plan');
    renderStats();
    ui.downloadButton.disabled = placements.length === 0;
    ui.optimizationState.textContent = 'TERMINÉ'; ui.stepPlan.classList.add('active');
    setStatus(`${placements.length} pièces placées · ${state.plan.stats.completeKits} T-shirts complets`);
    publishPlan();
    setProgress(100, 'Imbrication terminée');
  } finally {
    state.nesting = false;
    ui.planButton.disabled = !state.analyzed;
  }
}

// ---------- Projection (D-24) ----------

function openProjection() {
  if (!projectionChannel) throw new Error('ce navigateur ne permet pas la projection (BroadcastChannel absent)');
  const projection = window.open('projection.html', 'retiss-projection', 'popup=yes,width=1280,height=800');
  if (!projection) throw new Error('fenêtre de projection bloquée : autorise les fenêtres pop-up pour ce site');
  projection.focus();
  setStatus(state.plan
    ? 'Projection ouverte : glisse la fenêtre sur le projecteur, F pour le plein écran, puis cale les 4 coins sur le tissu'
    : 'Projection ouverte pour le calibrage : le plan s’affichera dès qu’il sera calculé');
}

// ---------- Export ----------

async function exportPdf() {
  if (!state.plan?.placements.length) return;
  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) { // D-14
    setStatus('PDF indisponible : la bibliothèque jsPDF n’a pas pu être chargée (connexion Internet ?)');
    return;
  }
  ui.downloadButton.disabled = true; setStatus('Génération du PDF…');
  await new Promise((resolve) => setTimeout(resolve, 30)); // laisse le navigateur afficher le statut
  try {
    const pdf = buildCutPlanPdf(JsPdf, {
      placements: state.plan.placements, overviewPng: ui.resultCanvas.toDataURL('image/png'),
      completeKits: state.plan.stats.completeKits, fabric: state.fabric, cellMm: CELL_MM, colors: COLORS
    });
    pdf.save('retiss-plan-1-1.pdf');
    setStatus(`PDF généré (${pdf.getNumberOfPages()} pages)`);
  } finally {
    ui.downloadButton.disabled = !state.plan?.placements.length;
  }
}

// ---------- Événements ----------

/** Affiche le flux d'une caméra (deviceId absent : caméra par défaut). Renvoie false en cas d'échec. */
async function connectCamera(deviceId, label = 'Caméra') {
  if (state.crop.picking) stopCropPicking();
  stopCamera(state.stream); state.stream = null;
  ui.captureButton.disabled = true;
  setStatus(`Connexion à « ${label} »…`);
  try {
    state.stream = await startCamera(ui.video, { deviceId });
  } catch (error) {
    // Caméra mémorisée débranchée : on retombe sur la caméra par défaut.
    if (deviceId && ['OverconstrainedError', 'NotFoundError'].includes(error.name)) return connectCamera(undefined);
    setStatus(`Caméra indisponible : ${error.message}`);
    return false;
  }
  ui.cameraStage.style.aspectRatio = `${ui.video.videoWidth / ui.video.videoHeight}`;
  ui.cameraStage.classList.remove('has-image'); ui.cameraPlaceholder.classList.add('hidden');
  ui.captureButton.disabled = false;
  ui.cameraStage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  setStatus(`« ${label} » connectée (${ui.video.videoWidth} × ${ui.video.videoHeight}) — clique « Figer l’image »`);
  return true;
}

// ---------- Caméra externe (D-32) ----------

async function refreshCameraList() {
  ui.cameraDialogStatus.textContent = 'Recherche des caméras…';
  let cameras;
  try {
    cameras = await listCameras();
  } catch (error) {
    ui.cameraDialogStatus.textContent = `Accès aux caméras impossible : ${error.message}`;
    return;
  }
  ui.cameraSelect.replaceChildren(...cameras.map(({ deviceId, label }) => new Option(label, deviceId, false, deviceId === state.cameraDeviceId)));
  ui.useCameraButton.disabled = cameras.length === 0;
  ui.cameraDialogStatus.textContent = cameras.length
    ? `${cameras.length} caméra${cameras.length > 1 ? 's' : ''} trouvée${cameras.length > 1 ? 's' : ''}. Ton téléphone n’y est pas ? Vérifie l’étape 1 puis actualise.`
    : 'Aucune caméra trouvée : connecte le téléphone (étape 1) puis actualise.';
}

ui.externalCameraButton.addEventListener('click', guard(async () => {
  ui.cameraDialog.showModal();
  await refreshCameraList();
}));
ui.refreshCamerasButton.addEventListener('click', guard(refreshCameraList));
ui.useCameraButton.addEventListener('click', guard(async () => {
  const option = ui.cameraSelect.selectedOptions[0];
  if (!option?.value) return;
  ui.cameraDialog.close();
  if (await connectCamera(option.value, option.textContent)) { state.cameraDeviceId = option.value; storeCamera(option.value); }
}));
// Un téléphone branché ou débranché pendant que la fenêtre est ouverte : on met la liste à jour.
navigator.mediaDevices?.addEventListener?.('devicechange', guard(async () => { if (ui.cameraDialog.open) await refreshCameraList(); }));

ui.cameraButton.addEventListener('click', guard(async () => {
  const label = state.cameraDeviceId ? 'caméra choisie' : 'Caméra';
  await connectCamera(state.cameraDeviceId ?? undefined, label);
}));

ui.captureButton.addEventListener('click', guard(() => {
  loadSource(ui.video);
  stopCamera(state.stream); state.stream = null; // D-12
  ui.captureButton.disabled = true;
}));

ui.fileLabel.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  ui.fileInput.click();
});

ui.fileInput.addEventListener('change', () => {
  const file = ui.fileInput.files[0];
  ui.fileInput.value = ''; // D-13 : permet de réimporter le même fichier
  if (!file) return;
  const image = new Image(); const url = URL.createObjectURL(file);
  image.onload = guard(() => { URL.revokeObjectURL(url); loadSource(image); });
  image.onerror = () => { URL.revokeObjectURL(url); setStatus('Impossible de lire cette image'); };
  image.src = url;
});

ui.cropButton.addEventListener('click', guard(() => {
  if (!state.source) return;
  if (state.crop.picking) { stopCropPicking(); setStatus('Recadrage annulé'); } else startCropPicking();
}));
ui.sourcePreview.addEventListener('click', guard((event) => { if (state.crop.picking) addCropPoint(event); }));

ui.fabricWidth.addEventListener('change', guard(applyFabricInputs));
ui.fabricHeight.addEventListener('change', guard(applyFabricInputs));

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
  state.inputVersion += 1;
  invalidatePlan();
  setStatus(state.orientationMode === 'droit-fil' ? 'Pièces alignées sur le droit-fil' : 'Attention : ce mode ne respecte pas le droit-fil');
});

ui.planButton.addEventListener('click', guard(runNesting));
ui.downloadButton.addEventListener('click', guard(exportPdf));
ui.projectButton.addEventListener('click', guard(openProjection));

setFabric(state.fabric); renderMask(); renderStats();

// Accès en lecture pour les tests de bout en bout (tests/e2e.js).
// D-33 : signale au contrôle de démarrage de index.html que le code est chargé, et en quelle version.
document.documentElement.dataset.appLoaded = APP_VERSION;

window.retissDebug = Object.freeze({ get state() { return state; }, getMasks, getShapes });
