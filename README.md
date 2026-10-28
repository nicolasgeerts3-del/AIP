# AIP — Advanced Industrial Project

Prototype web pour analyser les taches sur un tissu, placer des patrons en évitant les défauts et préparer un plan de découpe.

## Structure

- `index.html` — interface et chargement des bibliothèques externes.
- `app.js` — contrôleur de l’interface : relie les boutons, l’état de l’application et les modules de `src/`.
- `styles.css` — mise en page et styles.
- `src/config.js` — paramètres : taille du tissu, résolution, patrons, marges, stratégies.
- `src/core/` — logique pure, sans DOM, testée sous Node :
  - `color.js` — conversion RGB → L\*a\*b\*, médiane ;
  - `mask.js` — masques binaires (morphologie, composantes, rééchantillonnage, pinceau) ;
  - `detection.js` — détection automatique des taches ;
  - `geometry.js` — patrons, rotation, rastérisation ;
  - `nesting.js` — placement des pièces et contrôle du plan ;
  - `stats.js` — bilan matière ;
  - `fabric.js` — taille du coupon et grille associée ;
  - `perspective.js` — recadrage 4 coins et correction de perspective.
- `src/export/pdf.js` — génération du PDF 1:1.
- `src/ui/` — dessin des canvas, accès caméra et fenêtre de projection (`projection-app.js`).
- `projection.html`, `projection.css` — fenêtre plein écran affichée sur le projecteur.
  - `src/core/projection.js` — calibrage 4 coins et données envoyées au projecteur.
- `tests/` — tests unitaires (`*.test.js`), test de bout en bout (`e2e.js`) et campagne d’ergonomie (`usability.js`) ; `helpers/browser.js` pilote Chrome/Edge.
- `phot tache/` — image de test.
- `outils/` — classeurs de comparaison du projet.

Flux des données : photo → recadrage (`warpPerspective`) → `computeColorPlanes` → `detectDefects` (masque image) → retouches au pinceau (`combineLayers`) → `resampleMaxPool` (grille du tissu, 1 cellule = 5 mm) → `nestPieces` → `validatePlan` → affichage / `buildCutPlanPdf`.

## Lancer le site

C’est un site statique : aucune dépendance à installer. Le code utilise des modules JavaScript, il faut donc passer par un serveur local (ouvrir `index.html` en double-cliquant ne fonctionne pas). Au choix :

```powershell
npm start               # serveur Node intégré (http://localhost:8000)
py -m http.server 8000  # ou avec Python
```

Ou, dans VS Code, ouvrir `index.html` avec l’extension **Live Server**.

Après une mise à jour du code, si un bouton ne réagit pas ou si un bandeau rouge parle d’« ancienne version », recharger la page sans cache avec **Ctrl + F5**. `npm start` désactive le cache et évite ce problème.

Le navigateur peut demander l’autorisation caméra. L’export PDF et les polices utilisent des ressources CDN, donc une connexion Internet est nécessaire pour ces éléments.

## Mise en ligne

Le site se publie tel quel sur Vercel (HTTPS, en-têtes de sécurité, pas de build) : voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Utilisation

La barre du haut montre les 3 étapes (cliquables) et dit toujours quoi faire ensuite ; le bouton orange est la prochaine action.

1. **Photo** — glisser la photo sur la page, la coller (Ctrl + V), cliquer **Importer une photo**, utiliser la caméra de l’ordinateur, ou **📱 Téléphone ou autre caméra** : un téléphone fixé sur un support au-dessus du tissu, vu comme une webcam (la fenêtre explique la connexion : Lien avec Windows, DroidCam, Iriun, Camo, Caméra de continuité ; on clique **Figer l’image** depuis l’ordinateur). Saisir la largeur réelle du tissu ; sans recadrage, la longueur suit les proportions de la photo. Si la table apparaît autour du tissu : **Recadrer sur le tissu (4 coins)**, cliquer les 4 coins dans n’importe quel ordre (Retour arrière : dernier coin, Échap : abandonner).
2. **Taches** — l’analyse est automatique. Si des plis ou des reflets sont en rouge, glisser **Sensibilité de la détection** vers « Ignore plis et reflets », ou les effacer au pinceau (Ctrl + Z pour annuler).
3. **Plan** — choisir l’orientation des pièces (droit-fil par défaut), **Calculer le plan de découpe**, puis **▶ Projeter sur le tissu** (guide du matériel et des réglages : [docs/PROJECTION.md](docs/PROJECTION.md)) ou télécharger le PDF 1:1. Si aucun T-shirt ne tient, l’appli explique pourquoi et mène au bon réglage.

Les défauts connus et corrigés sont suivis dans [docs/DEFAUTS.md](docs/DEFAUTS.md).

## Tests

Node.js 22 ou plus récent est nécessaire.

```powershell
npm test           # tests unitaires (≈ 1 s)
npm run test:e2e   # scénario complet dans Chrome/Edge headless (≈ 25 s)
npm run test:usability # campagne d’ergonomie U-01 à U-24, ordinateur et téléphone (≈ 1 min 30)
npm run bench      # banc d’essai du nesting (T-shirts, surface, temps)
```

Critères et résultats de la campagne d’ergonomie : [docs/ERGONOMIE.md](docs/ERGONOMIE.md).

Le test de bout en bout trouve Chrome ou Edge tout seul ; sinon, définir `CHROME_PATH`. Il importe une photo, analyse, retouche au pinceau, lance l’imbrication, exporte le PDF et teste la caméra (simulée).

## Travail en équipe

La branche principale est `main`. Créez une branche pour chaque changement, lancez `npm test` avant de pousser, puis ouvrez une Pull Request vers `main` afin de relire les modifications à deux.
