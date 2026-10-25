# Registre des défauts

Chaque défaut a un identifiant `D-xx` qui sert de fil conducteur :

| Pour retrouver…             | Commande                                   |
|-----------------------------|--------------------------------------------|
| le commit qui le corrige    | `git log --grep "D-17"`                    |
| le test qui le vérifie      | `npm test -- --test-name-pattern "D-17"`   |
| l'endroit du code concerné  | rechercher `D-17` dans `src/` et `app.js`  |

Gravité : 🔴 critique (découpe fausse ou appli bloquée) · 🟠 majeur · 🟡 mineur.

## Corrigés

| ID | Gravité | Défaut | Correction | Test |
|----|---------|--------|------------|------|
| D-01 | 🔴 | Contours dessinés et lignes de coupe du PDF décalés d'environ 26 × 55 cm par rapport aux cellules testées. | Cellules et contour partagent le même repère (`rasterizePiece`, `placementOutline`). | geometry, e2e |
| D-02 | 🔴 | `median()` triait en place : a\* et b\* d'un même pixel se désalignaient, seuil faux. | Médiane sur une copie. | color |
| D-03 | 🔴 | Rééchantillonnage au plus proche voisin : une petite tache visible pouvait disparaître de la grille de nesting. | `resampleMaxPool` : une cellule est défectueuse si un seul pixel l'est. | mask |
| D-04 | 🟠 | Raccourci de collision faux : positions valides rejetées. | Raccourci uniquement si la boîte est entièrement libre. | nesting |
| D-05 | 🟠 | Meilleur plan choisi au nombre de pièces, pas de T-shirts complets. | `isBetterScore` : T-shirts, puis surface, puis pièces. | nesting |
| D-06 | 🟠 | PDF : une pièce qui traverse une page sans y avoir de sommet n'y était pas dessinée. | Test d'intersection de boîtes (`polygonTouchesTile`). | stats-pdf |
| D-07 | 🟠 | Le curseur MAD effaçait les retouches au pinceau. | Masque en trois calques (auto, ajouts, effacements). | e2e |
| D-08 | 🟠 | Masque modifié pendant le calcul : plan de l'ancien masque affiché quand même. | Numéro de version du masque, calcul annulé s'il change. | nesting, e2e |
| D-09 | 🟡 | Trous dans le trait du pinceau quand la souris va vite. | `paintStroke` interpole entre deux événements. | mask, e2e |
| D-10 | 🟡 | Pinceau elliptique sur le tissu si la photo n'est pas en 2:3. | Rayons calculés séparément en x et y (`brushRadii`). | — |
| D-11 | 🟡 | Photo importée cachée derrière l'élément vidéo. | CSS `.has-image video { display: none }`. | e2e |
| D-12 | 🟡 | Caméra laissée allumée après la capture. | Arrêt du flux après capture. | e2e |
| D-13 | 🟡 | Réimporter le même fichier ne faisait rien. | Remise à zéro du champ fichier. | — |
| D-14 | 🟡 | Sans Internet, le bouton PDF ne faisait rien, sans message. | Message explicite si jsPDF est absent. | — |
| D-15 | 🟡 | Peindre au doigt faisait défiler la page. | CSS `touch-action: none`. | — |
| D-16 | 🟡 | Ancien résumé d'analyse affiché sur une nouvelle image. | Réinitialisé au chargement. | — |
| D-17 | 🔴 | Une ombre marquée (−20 % de luminosité) était prise pour une tache. | `computeColorPlanes` : a* et b* calculés après normalisation de l'intensité ; dégradés et ombres douces ignorés. | detection, e2e |
| D-18 | 🔴 | Les taches sans changement de teinte (graisse, eau, gris sur gris, javel) n'étaient pas détectées. | Second test sur l'écart à la luminosité locale (`maskedBoxMean`, fond recalculé sans les taches), puis `fillHoles` pour remplir les grandes taches. | detection, e2e |
| D-19 | 🔴 | Pas de recadrage : la photo était supposée montrer exactement le coupon, vu de face ; le fond comptait comme défaut, la perspective n'était pas corrigée. | Bouton « Recadrer (4 coins) » : `src/core/perspective.js` (`orderCorners`, `computeHomography`, `warpPerspective`) redresse la photo aux proportions du tissu. Un liseré de bord ≤ 3 cm reste marqué défaut (prudent). | perspective, e2e |
| D-20 | 🔴 | Taille du tissu figée à 3,00 × 4,50 m. | Champs « Largeur / Longueur » (20 à 1000 cm), `src/core/fabric.js` (`validateFabric`, `gridForFabric`) ; grille, pinceau, statistiques et PDF suivent la taille saisie. | fabric, e2e |
| D-21 | 🔴 | Rotation libre par pas de 15° : le droit-fil est ignoré, le vêtement se déforme. | `ORIENTATION_MODES` dans `config.js` ; droit-fil (0°/180°) par défaut, menu « Orientation des pièces ». Coût : 10 T-shirts au lieu de 11 sur 3 × 4,5 m. | nesting, e2e |
| D-23 | 🔴 | Beaucoup de petites taches → calcul de plusieurs minutes, navigateur figé (50 taches : 36 s ; 200 : > 4 min). | `collectAnchors` : au-delà de 120 positions par axe, les positions issues des défauts sont arrondies sur un pas régulier. 50 taches : 9 T-shirts en 3,8 s (avant : 8 en 36 s). | nesting |

## Ouverts

| ID | Gravité | Défaut | Piste |
|----|---------|--------|-------|
| D-22 | 🟠 | Le nesting n'équilibre pas les pièces (manches et bandes en trop). | Placer en priorité la pièce qui manque au T-shirt en cours. |
| D-24 | 🟠 | PDF de 273 pages A4, peu pratique ; pas de mode projection. | Mode projecteur plein écran avec calibration d'échelle. |
| D-25 | 🟠 | Pas de marge de couture visible ni de pièces en miroir ; DOS et DEVANT presque identiques. | À valider avec les vrais patrons. |
| D-26 | 🟡 | Le « #n » affiché sur les pièces est le numéro de passage, pas le numéro de T-shirt. | Renommer ou attribuer de vrais numéros de T-shirt. |
| D-27 | 🟡 | Pinceau sans annulation ni zoom, utilisable à la souris uniquement. | Pile d'annulation, zoom. |
| D-28 | 🟡 | Le filtre « petites taches » passe après la dilatation, il ne supprime jamais rien. | Le placer avant la dilatation. |
