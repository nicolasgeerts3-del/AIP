# Mettre ReTiss en ligne sur Vercel

ReTiss est un site statique : il n'y a rien à compiler. Vercel sert directement les fichiers du dépôt, en HTTPS. C'est d'ailleurs indispensable pour la caméra : un navigateur ne donne accès à la caméra qu'en HTTPS ou sur `localhost`.

## Ce qui est déjà prêt dans le dépôt

| Fichier | Rôle |
|---|---|
| `vercel.json` | En-têtes de sécurité (CSP, Permissions-Policy, nosniff), autorisation de la caméra et du plein écran sur un écran secondaire, `Cache-Control: no-cache` sur HTML/JS/CSS pour que chaque mise à jour soit vue immédiatement (voir D-33). |
| `.vercelignore` | Ne publie que le site : les tests, la documentation, les classeurs `outils/` et les photos de test restent privés. |
| `src/ui/startup-check.js` | Bandeau rouge si le site ne démarre pas ou si une ancienne version est en cache. |

Les tests de bout en bout (`npm run test:e2e`) appliquent les en-têtes de `vercel.json` au serveur local et échouent si la politique de sécurité bloque quoi que ce soit : ce qui passe en local passera en ligne.

## Première mise en ligne (une seule fois)

1. Va sur [vercel.com](https://vercel.com) et connecte-toi avec ton compte **GitHub** (`nicolasgeerts3-del`).
2. **Add New… → Project**, puis **Import** le dépôt `AIP`. Autorise Vercel à lire ce dépôt si c'est demandé.
3. Écran de configuration :
   - **Framework Preset** : `Other` ;
   - **Root Directory** : `./` ;
   - **Build Command** : laisser vide (bouton *Override* puis champ vide si Vercel en propose une) ;
   - **Output Directory** : `.` (un point) ;
   - **Install Command** : laisser vide.
4. **Deploy**. Après une trentaine de secondes, Vercel donne une adresse du type `https://aip-xxxx.vercel.app`.
5. Ouvre l'adresse et vérifie : pas de bandeau rouge, bouton *Activer la caméra* fonctionnel, puis *Imbriquer* et *Projeter*.

Pour inviter ton collègue sur le projet Vercel : **Settings → Members** (offre Hobby : un seul propriétaire ; sinon il peut simplement utiliser l'adresse publique).

## Mises à jour

- Chaque `git push` sur **`main`** met à jour le site de production.
- Chaque push sur une **autre branche** (ou chaque Pull Request) crée une **adresse de prévisualisation** : on teste avant de fusionner. Vercel l'indique en commentaire dans la Pull Request GitHub.
- Avant chaque livraison : changer `APP_VERSION` dans `src/config.js` **et** `data-app-version` dans `index.html` (même valeur), puis lancer `npm test` et `npm run test:e2e`.

La branche `main` ne contient pas encore ces fichiers tant que la Pull Request `fix/defauts-critiques` n'est pas fusionnée. En attendant, Vercel peut déployer cette branche en prévisualisation.

## Variante en ligne de commande

```powershell
npx vercel          # première fois : connexion, puis questions (répondre « Other », pas de build)
npx vercel --prod   # mise en production
```

## Utilisation en ligne

- **Caméra du téléphone** : en ligne, le téléphone peut aussi ouvrir directement l'adresse Vercel et utiliser sa propre caméra arrière (HTTPS). Pour piloter la prise de vue depuis l'ordinateur, garde la méthode « Connecter une autre caméra » (téléphone vu comme webcam du PC).
- **Projection** : la fenêtre `projection.html` fonctionne de la même façon en ligne ; le calibrage est mémorisé par navigateur.
- **PDF** : jsPDF est chargé depuis cdnjs avec une empreinte d'intégrité (SRI) : une version modifiée du fichier serait refusée.
- Aucune donnée ne quitte le navigateur : la photo, le masque et le plan sont calculés localement, rien n'est envoyé à Vercel.
