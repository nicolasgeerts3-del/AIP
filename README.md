# AIP — Advanced Industrial Project

Prototype web pour analyser les taches sur un tissu, placer des patrons en évitant les défauts et préparer un plan de découpe.

## Structure

- `index.html` — interface et chargement des bibliothèques externes.
- `app.js` — analyse de l’image, édition du masque, nesting et export PDF.
- `styles.css` — mise en page et styles.
- `phot tache/` — image de test.
- `outils/` — classeurs de comparaison du projet.

## Lancer le site

C’est un site statique : aucune installation de dépendances n’est nécessaire. Dans VS Code, ouvrir `index.html` avec l’extension **Live Server**, ou démarrer un serveur local depuis le dossier du projet :

```powershell
py -m http.server 8000
```

Puis ouvrir <http://localhost:8000>. Le navigateur peut demander l’autorisation caméra. L’export PDF et les polices utilisent des ressources CDN, donc une connexion Internet est nécessaire pour ces éléments.

## Travail en équipe

La branche principale est `main`. Créez une branche pour chaque changement, puis ouvrez une Pull Request vers `main` afin de relire les modifications à deux.
