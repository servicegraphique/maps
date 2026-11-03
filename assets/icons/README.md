# Icônes

MAPFINDER n'embarque aucune bibliothèque d'icônes externe (pas de CDN, pas de
dépendance). Toutes les icônes de l'interface sont des **SVG en ligne** définis
directement dans `index.html` et `js/app.js` (trait 1,8 px, `stroke: currentColor`),
ce qui garantit :

- un rendu net à toutes les résolutions ;
- la coloration automatique par le thème (clair / sombre) ;
- zéro requête réseau supplémentaire.

Ce dossier est conservé pour accueillir d'éventuelles icônes raster (favicons
d'application, icône de bureau Windows). Le favicon vectoriel se trouve dans
`assets/logo/favicon.svg`.
