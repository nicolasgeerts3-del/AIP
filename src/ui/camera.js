// Accès caméra.

/** Démarre la caméra arrière si possible et attend la première image. Renvoie le MediaStream. */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext ? 'Caméra non prise en charge par ce navigateur' : 'Caméra bloquée : ouvrir la page en https ou via localhost');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadeddata', resolve, { once: true }));
  return stream;
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}
