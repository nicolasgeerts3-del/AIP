# Projeter le plan de découpe sur le tissu

Ce guide explique comment installer un projecteur au-dessus de la table de coupe, le relier à l'ordinateur et projeter les patrons imbriqués par ReTiss directement sur le tissu, pour découper au cutter en suivant les contours.

## 1. Matériel

| Élément | Recommandation | Pourquoi |
|---|---|---|
| Projecteur | Résolution native **1920 × 1080** (ou 1920 × 1200), **≥ 3000 lumens**, **courte focale** (rapport de projection ≤ 0,6) | La finesse du trait dépend de la résolution ; la courte focale permet de couvrir une grande table depuis une hauteur raisonnable. |
| Support | Potence murale, pied de micro / perche, ou fixation plafond, **orientée vers le bas** | Le projecteur doit rester parfaitement immobile entre le calibrage et la fin de la découpe. |
| Câble vidéo | Voir section 2 | — |
| Rallonge électrique | Multiprise avec interrupteur | — |
| Ruban adhésif (gaffer) | Pour plaquer les câbles au sol et au support | On circule autour de la table avec un cutter. |
| Mètre ruban, règle de 30 cm | Vérification de l'échelle | — |
| Tapis de coupe, cutter rotatif ou droit | — | — |

### Choisir la hauteur et le projecteur

La largeur de l'image projetée vaut **hauteur ÷ rapport de projection**. Pour couvrir la longueur du tissu :

| Longueur à couvrir | Rapport 1,5 (standard) | Rapport 0,8 (courte focale) | Rapport 0,5 (courte focale) | Rapport 0,25 (ultra-courte) |
|---|---|---|---|---|
| 2,00 m | 3,0 m de haut | 1,6 m | 1,0 m | 0,5 m |
| 3,00 m | 4,5 m | 2,4 m | 1,5 m | 0,75 m |
| 4,50 m | 6,75 m | 3,6 m | 2,25 m | 1,15 m |

**Astuce résolution** : un projecteur est en paysage (16:9). Dispose le tissu **dans le sens de la longueur de l'image** (sa longueur selon le grand côté du projecteur). Le calibrage par 4 coins accepte n'importe quelle orientation : on gagne presque un facteur 2 sur la taille d'un pixel. Exemple pour un coupon de 4,50 m : 4500 mm ÷ 1728 px ≈ **2,6 mm par pixel** au lieu de 4,6 mm en le posant en travers. La fenêtre de projection affiche cette valeur ; au-delà de 5 mm, elle passe en orange.

## 2. Câbles entre l'ordinateur et le projecteur

Regarde d'abord les prises disponibles des deux côtés.

| Sortie de l'ordinateur | Entrée du projecteur | Câble / adaptateur à prévoir |
|---|---|---|
| HDMI | HDMI | Câble **HDMI High Speed** (HDMI 1.4 ou plus, 1080p 60 Hz). |
| USB-C avec logo **DP** ou **⚡ Thunderbolt** à côté de la prise | HDMI | Câble **USB-C → HDMI** (compatible « DisplayPort Alt Mode »), ou adaptateur USB-C → HDMI + câble HDMI. Une prise USB-C sans ce logo ne sort souvent **pas** de vidéo. |
| Mini DisplayPort | HDMI | Adaptateur **Mini DP → HDMI** + câble HDMI. |
| HDMI ou USB-C | VGA (projecteur ancien) | Convertisseur **actif** HDMI → VGA (ou USB-C → VGA) + câble VGA. L'image est un peu moins nette. |

### Longueur du câble

| Distance PC ↔ projecteur | Solution |
|---|---|
| jusqu'à 5 m | Câble HDMI passif standard |
| 5 à 15 m | Câble HDMI certifié **Premium High Speed** ou câble **actif** |
| au-delà de 15 m | Câble HDMI **fibre optique (AOC)** ou extendeur HDMI sur câble réseau (**HDBaseT**) |

Le sans-fil (Miracast : **Win + K**, ou un kit HDMI sans fil) fonctionne pour un plan fixe, mais il est moins fiable : à éviter en production.

## 3. Réglages

### Windows

1. Branche le câble, allume le projecteur et choisis sa bonne entrée (HDMI 1, HDMI 2…).
2. **Win + P → Étendre**. Ne choisis pas « Dupliquer » : l'interface de ReTiss reste sur l'ordinateur, la projection va sur le projecteur.
3. **Paramètres → Système → Écran** : sélectionne l'écran du projecteur, mets sa résolution native (mention « recommandé »), **mise à l'échelle 100 %** et orientation **Paysage**.
4. **Paramètres → Système → Alimentation** : écran et mise en veille sur **Jamais** pendant la séance.
5. Active **Ne pas déranger** pour qu'aucune notification ne s'affiche sur le tissu.

### Projecteur

- **Mise au point** nette sur le plan de la table.
- **Correction trapézoïdale (keystone) automatique et zoom numérique désactivés** : ils dégradent la résolution, et le calibrage de ReTiss corrige la déformation plus précisément.
- Mode de rapport d'aspect « natif » ou « 1:1 », **overscan désactivé**.
- Mode d'installation (« plafond », « arrière ») : sans importance, le calibrage accepte une image retournée ou en miroir.
- Lumière ambiante tamisée, pas de lampe directe sur la table.

## 4. Format de la projection

La fenêtre de projection (`projection.html`) affiche :

- un fond **noir**, pour que seul le trait éclaire le tissu ;
- les **contours des pièces** (2 px, blancs par défaut ; **K** change la couleur, **[** et **]** l'épaisseur) et leur nom (**DOS #3** = dos du T-shirt n° 3) ;
- les **défauts** barrés en rouge (**D** pour les masquer) ;
- une **mire** : bord du tissu, quadrillage tous les 50 cm, carré témoin de 10 × 10 cm (**M**).

Elle s'adapte à la résolution du projecteur. Le calibrage est enregistré par écran et par taille de tissu : tant que le projecteur et la table ne bougent pas, il n'est à faire qu'une fois.

## 5. Procédure de découpe

1. Pose le tissu à plat, bien tendu, sur la table. Il ne doit plus bouger jusqu'à la fin.
2. Dans ReTiss : photo, recadrage 4 coins, analyse, **Imbriquer les patrons**.
3. Clique **▶ Projeter sur le tissu**. Une fenêtre s'ouvre : fais-la glisser sur l'écran du projecteur, puis appuie sur **F** (plein écran). Sur Chrome ou Edge, **F** peut aussi l'envoyer directement sur le projecteur, après autorisation.
4. **Calibrage** : fais glisser les poignées **1 à 4** sur les 4 coins réels du tissu. La poignée 1 correspond au coin haut-gauche du plan (celui de la photo recadrée), les suivantes tournent dans le sens horaire. Pour l'ajustement fin : **Tab** sélectionne un coin, les **flèches** le déplacent d'un pixel (Maj + flèches : 10 px).
5. **Vérification** : au mètre ruban, le carré témoin doit mesurer 10 cm et les carreaux du quadrillage 50 cm. Les contours doivent tomber aux mêmes endroits que les taches réelles.
6. Appuie sur **C** pour masquer les poignées, **M** pour masquer la mire, puis découpe en suivant les traits.
7. Si le tissu ou le projecteur bouge : recommence l'étape 4, ou appuie sur **R** pour repartir du calibrage par défaut.

ReTiss efface aussitôt les contours projetés si le plan change dans la fenêtre principale (masque retouché, autre tissu…) : on ne découpe jamais selon un plan périmé.

## 6. Précision et sécurité

- Précision attendue : environ **1 pixel** (2 à 5 mm selon l'installation) plus l'épaisseur du trait. Les pièces gardent déjà **1 cm de marge** entre elles et autour des défauts.
- Ne regarde jamais directement l'objectif du projecteur.
- Coupe en tirant le cutter vers l'extérieur du corps, sur tapis de coupe ; range la lame entre deux coupes.
- Un coupon plus grand que la zone projetée devra être découpé **en plusieurs fois** (projection par zones : évolution prévue, voir `docs/DEFAUTS.md`, D-34).
