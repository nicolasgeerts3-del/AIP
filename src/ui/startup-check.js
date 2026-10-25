// D-33 : contrôle de démarrage, chargé comme script classique AVANT app.js.
// Si app.js ne démarre pas, ou si le navigateur a gardé en cache une ancienne
// version, les boutons ne réagissent pas : on l'explique dans le bandeau.
// (Fichier séparé plutôt qu'en ligne dans index.html : la politique de
// sécurité du site interdit les scripts en ligne.)
(() => {
  const banner = document.getElementById('appBanner');
  const show = (text) => { banner.textContent = text; banner.hidden = false; };
  let lastError = '';
  window.addEventListener('error', (event) => { lastError = event.message || lastError; });
  if (location.protocol === 'file:') {
    show('L’application doit être ouverte via un serveur (npm start, puis http://localhost:8000, ou le site en ligne) : ouverte comme fichier, ses boutons ne fonctionnent pas.');
    return;
  }
  window.addEventListener('load', () => setTimeout(() => {
    const expected = document.documentElement.dataset.appVersion;
    const loaded = document.documentElement.dataset.appLoaded;
    if (loaded === expected) return;
    show(loaded
      ? `Le navigateur utilise une ancienne version du code (${loaded} au lieu de ${expected}) : les nouveaux boutons ne fonctionnent pas. Appuie sur Ctrl + F5 pour recharger sans cache.`
      : `L’application n’a pas démarré${lastError ? ` (${lastError})` : ''}. Appuie sur Ctrl + F5 pour recharger sans cache ; si le problème persiste, vérifie ta connexion ou lance npm start en local.`);
  }, 1500));
})();
