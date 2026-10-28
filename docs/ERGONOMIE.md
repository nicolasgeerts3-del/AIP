# Campagne de tests d'ergonomie

Objectif : qu'une personne qui ouvre ReTiss pour la première fois sache **quoi faire, où, et pourquoi**, sans explication, sur ordinateur comme sur téléphone.

La campagne est automatisée : `npm run test:usability` rejoue la prise en main dans Chrome/Edge headless, sur un ordinateur portable (1366 × 768) et sur un téléphone (390 × 844), avec une photo de synthèse et la vraie photo du dépôt (`phot tache/`). Chaque critère est mesurable : position à l'écran, éléments recouverts, tailles, contrastes, nombre d'actions. Ajouter `USABILITY_SHOTS=dossier` pour garder des captures d'écran de chaque moment clé.

## Résultat

| | Critères réussis |
|---|---|
| Avant (version 2026-10-26.1) | **4 / 28** |
| Après (version 2026-10-28.1) | **28 / 28** |

Les tests existants restent verts : `npm test` 159/159, `npm run test:e2e` 20/20.

## Critères

| ID | Moment | Critère | Avant | Défaut corrigé |
|----|--------|---------|-------|----------------|
| U-01 | Première visite | « Importer une photo » visible sans défiler (ordinateur et téléphone) | ✖ caché sous le grand titre | D-42 |
| U-02 | Tout le parcours | Une seule action mise en avant, et c'est la bonne : Importer → Figer l'image (caméra) → Calculer le plan → Projeter | ✖ aucune | D-43 |
| U-03 | Tout le parcours | Le message de guidage reste visible en bas de page, en ≥ 13 px | ✖ 10 px, disparaît en défilant | D-43 |
| U-04 | Tout le parcours | Le fil d'étapes indique l'étape en cours et y mène d'un clic | ✖ décoratif | D-43 |
| U-05 | Tout le parcours | Aucun jargon visible (MAD, nesting…) | ✖ « Facteur MAD » | D-46 |
| U-06 | Photo | Glisser-déposer une photo l'importe | ✖ | D-49 |
| U-07 | Photo | Coller une image (Ctrl + V) l'importe | ✖ | D-49 |
| U-08 | Photo | Cliquer sur la zone d'image vide ouvre le choix de fichier | ✖ | D-49 |
| U-09 | Photo | Aucun bouton inutilisable affiché | ✖ Figer, Recadrer, Relancer | D-53 |
| U-10 | Recadrage | Consigne et compteur sur la photo, curseur en croix, **photo entière visible** | ✖ consigne en haut à droite ; photo portrait plus haute que l'écran | D-44, D-51 |
| U-11 | Recadrage | Retour arrière annule le dernier coin, Échap abandonne | ✖ | D-44, D-50 |
| U-12 | Taches | Le curseur de détection dit dans quel sens aller | ✖ | D-46 |
| U-13 | Taches | Alerte quand beaucoup de zones sont marquées (plis, reflets) | ✖ | D-46 |
| U-14 | Taches | Aperçu de la taille réelle du pinceau sous la souris | ✖ | D-45 |
| U-15 | Taches | Annuler un trait (bouton et Ctrl + Z) | ✖ | D-27, D-50 |
| U-16 | Taches | Outils à bascule annoncés aux lecteurs d'écran (`aria-pressed`) | ✖ | D-52 |
| U-17 | Plan | Plan sans T-shirt : explication + bouton qui mène à la correction | ✖ « 0 » sans un mot | D-48 |
| U-18 | Plan | Le plan apparaît à l'écran après le calcul, sans le chercher | ✖ sur ordinateur | D-47 |
| U-19 | Plan | Parcours le plus court : photo → plan en 2 actions | ✔ | — |
| U-20 | Confort | Téléphone : cibles tactiles ≥ 44 px | ✖ 17 trop petites | D-52 |
| U-21 | Confort | Texte ≥ 12 px | ✖ 33 textes | D-52 |
| U-22 | Confort | Contraste WCAG AA (4,5:1) | ✖ 44 textes (orange à 2,7:1) | D-52 |
| U-23 | Confort | Téléphone : pas de défilement horizontal | ✔ | — |
| U-24 | Confort | « Importer » atteint en ≤ 5 tabulations, focus visible | ✖ | D-52 |

## Ce qui a changé pour l'utilisateur

- **Barre du haut fixe** : les 3 étapes (Photo · Taches · Plan), cliquables, avec l'étape en cours en orange et les étapes faites en vert ; dessous, une phrase qui dit toujours quoi faire ensuite.
- **Une seule action orange à la fois** : l'œil va directement au prochain bouton.
- **Page réorganisée en 3 sections** qui suivent le parcours ; « Calculer le plan » est à côté du résultat. Le grand titre d'accueil a été réduit.
- **Import plus facile** : glisser la photo n'importe où sur la page, la coller, ou cliquer sur la zone vide.
- **Recadrage guidé** : consigne et compteur de coins sur la photo, photo entière à l'écran, Retour arrière / Échap.
- **Détection compréhensible** : « Sensibilité de la détection » avec « ← Repère plus de taches / Ignore plis et reflets → », et une alerte au-delà de 10 % du tissu marqué.
- **Pinceau** : cercle de la taille réelle sous la souris, bouton « Annuler » et Ctrl + Z (20 retouches), « Effacer mes retouches » annulable.
- **Plan vide expliqué** : la cause probable (plis pris pour des taches, ou tissu trop petit) et un bouton qui mène au bon réglage.
- **Lisibilité** : contrastes AA, textes ≥ 12 px, cibles tactiles ≥ 44 px, conseils photo repliables.

## Constat qui reste ouvert

Sur la vraie photo du dépôt (drap froissé), la sensibilité par défaut (3,5) marque 14 % du tissu à cause des plis et donne **0 T-shirt**. En poussant le curseur vers « Ignore plis et reflets » : 2 T-shirts à 5, 3 à 6,5, 4 à 8. L'appli l'explique maintenant, mais un réglage par défaut plus tolérant, ou un filtre des formes allongées typiques des plis, éviterait ce détour. Ce changement touche la détection (et ses tests D-17/D-18) : il est à valider sur plusieurs vraies photos avant d'être fait.

Également ouverts : zoom du pinceau (D-27), D-25, D-28, D-34 (voir [DEFAUTS.md](DEFAUTS.md)).
