# Registre des défauts

Chaque défaut a un identifiant `D-xx` qui sert de fil conducteur :

| Pour retrouver…             | Commande                                   |
|-----------------------------|--------------------------------------------|
| le commit qui le corrige    | `git log --grep "D-17"`                    |
| le test qui le vérifie      | `npm test -- --test-name-pattern "D-17"`   |
| les critères d’ergonomie    | `npm run test:usability` (U-xx, voir [ERGONOMIE.md](ERGONOMIE.md)) |
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
| D-22 | 🟠 | Le nesting n'équilibrait pas les pièces (manches et bandes orphelines). | Le nesting ne pose plus que des T-shirts complets (`pieceSequence`). | nesting |
| D-23 | 🔴 | Beaucoup de petites taches → calcul de plusieurs minutes, navigateur figé (50 taches : 36 s ; 200 : > 4 min). | D'abord limitation des positions candidates, puis remplacé par la recherche exhaustive avec sauts de D-30 : 300 taches en < 1 s par essai. | nesting |
| D-26 | 🟡 | Le « #n » affiché sur les pièces était le numéro de passage, pas le numéro de T-shirt. | `pass` = numéro du T-shirt auquel la pièce appartient. | nesting |
| D-29 | 🔴 | Le plan était toujours imbriqué sur un tissu 3 × 4,5 m (portrait) : une photo en paysage était étirée, le plan n'avait pas le format de la photo. | Sans recadrage, la longueur du tissu est calculée d'après les proportions de la photo (`fabricWithRatio`) ; au recadrage, elle est estimée d'après les coins (`quadRatio`) puis modifiable. | fabric, e2e |
| D-30 | 🔴 | Imbrication peu efficace : positions candidates limitées aux bords des obstacles, grands vides, pièces orphelines. | Nouvel algorithme : recherche exhaustive du premier emplacement libre (sauts par séries de cases, `Occupancy`), recherche du nombre maximal de T-shirts complets, remplissage depuis les 4 coins, phase aléatoire de 2,5 s. Droit-fil 3 × 4,5 m : 10 → 11–12 T-shirts ; photo de test : 2 → 3. `npm run bench` pour comparer. | nesting |
| D-31 | 🔴 | Un fond détecté tout autour d'une photo non recadrée faisait remplir tout le tissu comme une tache (`fillHoles`). | Un trou n'est rempli que s'il ne ressemble pas au tissu sain. | detection |
| D-32 | 🟠 | Impossible de choisir une autre caméra (téléphone fixé sur un support) : seule la caméra par défaut était utilisable. | Bouton « Connecter une autre caméra » : liste des caméras (`listCameras`), choix mémorisé, procédure de connexion d'un téléphone ; « Capturer » devient « Figer l'image ». | e2e |
| D-33 | 🟠 | Si le navigateur gardait en cache une ancienne version du code (ou si le code ne démarrait pas), les nouveaux boutons ne réagissaient pas, sans aucun message. | Numéro de version partagé par index.html et le code (`APP_VERSION`) ; bandeau rouge si le code n’a pas démarré ou n’est pas à jour (« Ctrl + F5 ») ; erreurs aussi affichées dans ce bandeau. | e2e |
| D-24 | 🟠 | Seul un PDF de 273 pages A4 permettait de reporter le plan sur le tissu ; pas de mode projection. | Bouton « ▶ Projeter sur le tissu » : fenêtre plein écran sur le projecteur (`projection.html`), calibrage par 4 coins (homographie, `src/core/projection.js`), mire 10 cm / 50 cm, plan périmé effacé automatiquement. Guide matériel et câbles : `docs/PROJECTION.md`. Le PDF reste disponible. | projection, e2e |
| D-35 | 🟡 | Revue ergonomie : grands blocs vides avant toute image, bouton Analyser peu visible, boutons mal regroupés, en-tête du résultat écrasé sur téléphone, chiffres sans séparateurs, jargon « nesting », analyse à lancer à la main. | Analyse automatique après chaque photo ; sources et actions de capture sur deux rangées ; cadres vides compacts ; statistiques en m² au format français avec explication ; en-têtes, barre du haut et pied de page adaptés au téléphone ; focus clavier visible ; « Imbrication » partout. | e2e |
| D-36 | 🟡 | Départage des plans biaisé : la compacité était mesurée par le bas de la pièce la plus basse, si bien qu'un plan rempli depuis le bas était toujours jugé moins compact. | `footprintCells` : surface du rectangle englobant toutes les pièces, indépendante de leur position. | nesting |
| D-37 | 🟡 | Projection : la touche M (mire) était sans effet pendant le calibrage. | Le bord du tissu reste affiché pendant le calibrage ; M masque le quadrillage et le carré témoin. | e2e |
| D-38 | 🟠 | Projection : le calibrage, enregistré en pixels de fenêtre mais par taille d'écran, se décalait en passant en plein écran. | Calibrage mémorisé par taille de fenêtre ; rechargé à chaque redimensionnement. | e2e |
| D-39 | 🟡 | Serveur local : une adresse mal formée (« %E0 ») le faisait planter. | Réponse 400. | server |
| D-40 | 🟡 | « Importer une photo » (un label) ne s'activait pas au clavier. | Entrée / Espace ouvrent le choix de fichier. | e2e |
| D-41 | 🟡 | Sans plan, les statistiques annonçaient 0 % d'utilisation et une chute égale à tout le tissu. | Valeurs « — » tant qu'aucun plan n'est calculé. | e2e |
| D-42 | 🟠 | Au premier affichage, aucun bouton d’action n’était visible : le grand titre d’accueil occupait tout l’écran. | Titre réduit ; « Importer une photo » visible sans défiler sur ordinateur et téléphone. | usability U-01 |
| D-43 | 🟠 | Guidage quasi invisible : statut en 10 px qui disparaissait en défilant, fil d’étapes décoratif, aucune action suivante mise en avant. | Barre du haut fixe : étapes cliquables avec leur état, phrase de guidage ; une seule action orange à la fois (`updateGuide`). | usability U-02 à U-04 |
| D-44 | 🟡 | Recadrage : consigne seulement dans la barre de statut, impossible d’annuler un coin mal placé. | Consigne et compteur sur la photo, curseur en croix, Retour arrière / Échap. | usability U-10, U-11 |
| D-45 | 🟡 | Pinceau sans indication de sa taille réelle. | Cercle de la taille réelle sous la souris. | usability U-14 |
| D-46 | 🟠 | « Facteur MAD » : jargon sans sens indiqué ; aucune alerte quand les plis sont pris pour des taches (vraie photo : 0 T-shirt). | « Sensibilité de la détection » avec ses deux extrémités expliquées ; alerte au-delà de 10 % du tissu marqué. | usability U-05, U-12, U-13 |
| D-47 | 🟡 | Bouton de calcul dans la section des taches ; sur ordinateur, le plan s’affichait hors de l’écran. | Calcul et résultat dans l’étape 3 ; défilement vers le plan s’il n’est pas visible. | usability U-18 |
| D-48 | 🟠 | Plan à 0 T-shirt affiché « TERMINÉ » sans explication. | Cause probable expliquée et bouton vers le bon réglage (détection ou taille du tissu). | usability U-17 |
| D-49 | 🟡 | Pas de glisser-déposer ni de collage ; la zone d’image vide n’était pas cliquable. | Photo déposée n’importe où sur la page, collée (Ctrl + V) ou choisie en cliquant la zone vide. | usability U-06 à U-08 |
| D-50 | 🟡 | Aucun raccourci clavier. | Ctrl + Z (annuler une retouche), Échap et Retour arrière pendant le recadrage. | usability U-11, U-15 |
| D-51 | 🟠 | Photo en portrait plus haute que l’écran : impossible de voir les 4 coins à la fois pour recadrer. | Cadres d’image limités à la hauteur visible, proportions conservées (`setStageRatio`). | usability U-10 |
| D-52 | 🟡 | Accessibilité : 44 textes sous le contraste AA, 33 textes de moins de 12 px, 17 cibles tactiles de moins de 44 px, outils sans `aria-pressed`, « Importer » loin au clavier. | Palette contrastée (orange #b8461f, gris #5d6861), tailles minimales, `aria-pressed`, étapes inactives hors du parcours clavier. | usability U-16, U-20 à U-24 |
| D-53 | 🟡 | Boutons inutilisables affichés (Figer sans caméra, Recadrer sans photo) et « Relancer l’analyse » inutile (analyse automatique). | Boutons affichés seulement quand ils servent ; « Relancer l’analyse » supprimé. | usability U-09 |
| D-27 (partiel) | 🟡 | Pinceau sans annulation. | Bouton « Annuler » et Ctrl + Z (20 retouches) ; « Effacer mes retouches » annulable. Le zoom reste ouvert. | usability U-15 |

## Ouverts

| ID | Gravité | Défaut | Piste |
|----|---------|--------|-------|
| D-25 | 🟠 | Pas de marge de couture visible ni de pièces en miroir ; DOS et DEVANT presque identiques. | À valider avec les vrais patrons. |
| D-27 | 🟡 | Pinceau sans zoom (l’annulation est faite). | Zoom et déplacement dans l’image. |
| D-28 | 🟡 | Le filtre « petites taches » passe après la dilatation, il ne supprime jamais rien. | Le placer avant la dilatation. |
| D-34 | 🟡 | Un coupon plus grand que la zone couverte par le projecteur doit être découpé en plusieurs fois, sans aide de l'appli. | Projection par zones : calibrer sur une portion du tissu et faire défiler les zones. |
