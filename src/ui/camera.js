// Accès caméra : caméra intégrée, webcam USB ou téléphone vu comme une webcam (D-32).

function assertCameraApi() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext ? 'Caméra non prise en charge par ce navigateur' : 'Caméra bloquée : ouvrir la page en https ou via localhost');
  }
}

/**
 * Démarre une caméra et attend la première image. Renvoie le MediaStream.
 * Sans deviceId : caméra arrière si possible. Avec deviceId : exactement cet
 * appareil (téléphone connecté, webcam USB…). On demande la meilleure
 * résolution disponible pour une analyse nette.
 */
export async function startCamera(video, { deviceId } = {}) {
  assertCameraApi();
  const quality = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const constraints = deviceId ? { deviceId: { exact: deviceId }, ...quality } : { facingMode: 'environment', ...quality };
  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

/**
 * Liste les caméras vues par le navigateur : [{ deviceId, label }].
 * Les noms ne sont fournis qu'après une autorisation d'accès : si nécessaire,
 * on ouvre brièvement une caméra pour obtenir cette autorisation.
 */
export async function listCameras({ askPermission = true } = {}) {
  assertCameraApi();
  const read = async () => (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
  let cameras = await read();
  if (askPermission && cameras.some((camera) => !camera.label)) {
    stopCamera(await navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
    cameras = await read();
  }
  return cameras.map((camera, index) => ({ deviceId: camera.deviceId, label: camera.label || `Caméra ${index + 1}` }));
}
