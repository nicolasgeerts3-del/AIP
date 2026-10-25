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
- `src/ui/` — dessin des canvas et accès caméra.
- `tests/` — tests unitaires (`*.test.js`) et test de bout en bout (`e2e.js`).
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

Le navigateur peut demander l’autorisation caméra. L’export PDF et les polices utilisent des ressources CDN, donc une connexion Internet est nécessaire pour ces éléments.

## Utilisation

1. Saisir la largeur du coupon (en cm). Sans recadrage, la longueur est calculée d’après les proportions de la photo.
2. Importer une photo, utiliser la caméra de l’ordinateur, ou **📱 Connecter une autre caméra** : un téléphone fixé sur un support au-dessus du tissu, vu comme une webcam. La fenêtre explique la connexion (Lien avec Windows, DroidCam, Iriun, Camo, Caméra de continuité). On voit l’image en direct et on clique **Figer l’image** depuis l’ordinateur.
3. **Recadrer (4 coins)** : cliquer les 4 coins du tissu sur la photo, dans n'importe quel ordre. Le fond est retiré et la perspective corrigée.
4. **Analyser l'image**, ajuster le facteur MAD, retoucher le masque au pinceau si besoin.
5. Choisir l'orientation des pièces (droit-fil par défaut), puis **Imbriquer les patrons**.
6. Télécharger le PDF 1:1.

Les défauts connus et corrigés sont suivis dans [docs/DEFAUTS.md](docs/DEFAUTS.md).

## Tests

Node.js 22 ou plus récent est nécessaire.

```powershell
npm test           # tests unitaires (≈ 1 s)
npm run test:e2e   # scénario complet dans Chrome/Edge headless (≈ 25 s)
npm run bench      # banc d’essai du nesting (T-shirts, surface, temps)
```

Le test de bout en bout trouve Chrome ou Edge tout seul ; sinon, définir `CHROME_PATH`. Il importe une photo, analyse, retouche au pinceau, lance l’imbrication, exporte le PDF et teste la caméra (simulée).

## Travail en équipe

La branche principale est `main`. Créez une branche pour chaque changement, lancez `npm test` avant de pousser, puis ouvrez une Pull Request vers `main` afin de relire les modifications à deux.
