# MAPFINDER — Tests réalisés

> Ce document distingue **trois niveaux de preuve**, et ne mélange jamais l'un avec l'autre :
>
> | Niveau | Signification |
> |---|---|
> | **A — Vérifié par API réelle** | La requête exacte produite par le code a été envoyée au service et sa réponse a été inspectée. |
> | **B — Vérifié automatiquement (hors navigateur)** | Le code réel de l'application tourne dans un DOM (jsdom) et les assertions passent. |
> | **C — À vérifier dans votre navigateur** | Ne peut être validé que dans un vrai navigateur (rendu graphique, tuiles, CORS). Un diagnostic en un clic est fourni dans l'application. |
>
> Date des tests : **3 novembre 2026**.

## 1. Résultats par cas de recherche (niveau A)

Les URL ci-dessous ont été générées par `node test/url-probe.js` (qui exécute le vrai
code de `search.js` / `geocoding.js`) puis rejouées telles quelles.

### Cas 1 — Grande entreprise + code postal : « Renault, 75001 Paris »

- Interprétation du moteur : `nom = Renault`, `code postal = 75001`, `ville = Paris`.
- **Photon** (`/api/?q=Renault+75001+Paris&lang=fr`) → **200**, 12 résultats. Comportement
  observé et documenté : aucun concessionnaire Renault n'est situé dans le 1er arrondissement,
  Photon renvoie donc les lieux proches du centre du 75001 (Palais de Justice, Forum des images,
  BNP Paribas…). C'est un comportement de recherche « floue » attendu.
- **Nominatim** (`q=Renault, 75001, Paris&addressdetails=1&extratags=1`) → **200**, résultats
  réels : « Renault, Rue de la Pépinière, Paris 8e, **75008** », « Renault, Rue du Général
  Bertrand, Paris 7e, **75007** », « Renault minute, Paris 14e », etc.
- **Ce que l'application fait de ça** : le classement pénalise fortement un code postal
  différent de celui demandé (`−12` par résultat) et un nom absent (`−20`). Les adresses
  Renault réelles remontent donc en tête, avec leur vrai code postal affiché — l'utilisateur
  voit immédiatement que le 75008 ne correspond pas au 75001 demandé, plutôt qu'un faux
  résultat « placé » dans le 75001.
- Téléphone, marque, site web, horaires récupérés via `extratags` et affichés dans la fiche.

### Cas 2 — Adresse complète : « 15 rue de la Paix, 75002 Paris »

- Interprétation : `n° = 15`, `rue = rue de la Paix`, `CP = 75002`, `ville = Paris`.
- **Nominatim structuré** (`street=15 rue de la Paix&city=Paris&postalcode=75002`) → **200**,
  **1 résultat exact** : `15, Rue de la Paix, Gaillon, Paris 2e Arrondissement, 75002`,
  coordonnées **48.8695088 / 2.3312846**, `osm_type = node`, `type = house`, `addresstype = place`.
- Conclusion : l'adresse est correctement isolée dans OSM ; le résultat est unique, donc
  l'application le sélectionne automatiquement, centre la carte au zoom 18 et tente de récupérer
  l'emprise du bâtiment via Overpass pour afficher la précision « Bâtiment ».

### Cas 3 — Code postal + ville : « 75008 Paris »

- Interprétation : `CP = 75008`, `ville = Paris`, **aucun nom d'entreprise** (vérifié
  automatiquement : le parseur ne confond pas « 75008 Paris » avec un nom).
- Les deux fournisseurs renvoient la zone ; les résultats de type `postcode`/`city` sont
  classés bas (`−6` à `−20`), les bâtiments et POI du secteur remontent.
- L'application affiche la précision « approximatif » pour un résultat de type zone : elle
  ne prétend jamais avoir trouvé « le » bâtiment dans un arrondissement entier.

### Cas 4 — Rue + ville : « Avenue de l'Indépendance, Antananarivo »

- Interprétation : `rue = Avenue de l'Indépendance`, `ville = Antananarivo`, pas de numéro.
- Requête Nominatim structurée envoyée : `street=Avenue de l'Indépendance&city=Antananarivo`.
- Photon : `q=Avenue+de+l’Indépendance+Antananarivo`.
- Le numéro absent est explicitement pénalisé dans le classement (`−4`), ce qui fait remonter
  les points d'adresse réels de l'avenue plutôt que des lieux homonymes ailleurs.

### Cas 5 — Maison à Antananarivo

- **Panoramax — vérifié en direct** : `GET https://api.panoramax.xyz/api/search?bbox=47.50,-18.93,47.54,-18.90&limit=2`
  → **200**, photos réelles à `47.5191, -18.9157` (contributeur « Eric S », prise le 30/08/2009,
  licence CC-BY-SA 4.0, instance OSM-FR). La couverture photo existe donc bien à Antananarivo.
- **Imagerie aérienne** : l'IGN ne couvre pas Madagascar (règle de couverture codée et testée),
  l'application bascule donc automatiquement sur **Esri World Imagery**, qui couvre le point
  (`tile/17/72550/82837`). Si Esri ne répond pas, l'onglet affiche le message honnête
  « aucune imagerie aérienne disponible » et propose la carte routière **étiquetée comme telle**.

## 2. Vérifications d'API réellement effectuées (niveau A)

| Service | Requête testée | Résultat observé |
|---|---|---|
| Photon (recherche) | `photon.komoot.io/api/?q=renault 75001 paris` | 200, `FeatureCollection`, propriétés `osm_type/osm_id/street/postcode/city/extent` |
| Photon (suggestions) | idem, appelé uniquement à la frappe (≥ 3 caractères, debounce 300 ms) | 200 |
| Photon (inverse) | `reverse?lon=2.3311&lat=48.8698` | 200, « 16 Rue Daunou, 75002 Paris » |
| Nominatim (nom) | `search?q=Renault, 75001, Paris` | 200, 5+ concessions Renault réelles, `extratags` (téléphone, site, horaires) |
| Nominatim (adresse) | `search?street=15 rue de la Paix&city=Paris&postalcode=75002` | 200, 1 résultat exact |
| Overpass (principal) | `overpass-api.de/api/interpreter` et `/api/status` | **502 « at capacity »** pendant toute la session → bascule de miroir indispensable |
| Overpass (miroirs) | `overpass.kumi.systems`, `overpass.private.coffee`, `maps.mail.ru` | également indisponibles (502/504) au moment du test |
| Panoramax | `api.panoramax.xyz/api/search?bbox=…` (Paris **et** Antananarivo) | 200, assets `thumb/sd/hd`, `pers:yaw`, `field_of_view`, `license`, `datetime`, `providers` |
| KartaView | `api.kartaview.org/2.0/photo/?lat=48.8698&lng=2.3311&radius=150` | 200, `status.apiCode = 600`, `result.data[]` avec `heading`, `shotDate`, `distance`, `autoImgProcessingResult = BLURRED` |
| IGN Géoplateforme | `GetCapabilities` (WMTS) + `GetTile` (937 couches, dont `ORTHOIMAGERY.ORTHOPHOTOS`) | Capabilities 200 ; la couche existe et est servie. **Le rendu binaire des tuiles n'a pas pu être validé dans le sandbox de développement** (voir §5) |
| Esri World Imagery | `World_Imagery/MapServer?f=json` | 200, pyramide 0–19, attribution « Esri, Vantor, Earthstar Geographics, and the GIS User Community » |

**Conséquence de la saturation Overpass** : c'est le scénario réel qui a dicté deux décisions —
aucune nouvelle tentative sur un même miroir (`retries: 0`, on passe au suivant), et **la
recherche aboutit sans Overpass** : seule la précision « Bâtiment » devient indisponible, la
fiche affiche alors « position approximative » et l'explique.

## 3. Tests automatisés du code réel (niveau B)

`node test/dom-harness.js` — **tous les contrôles passent** (aucune erreur d'exécution capturée).
Le harnais charge `index.html` réel puis exécute les 11 modules de l'application dans un DOM,
avec des réponses réseau simulées.

- **Modules exposés** : `MF_CONFIG`, `MF_UTILS`, `MF_API`, `MF_GEO`, `MF_OVERPASS`, `MF_SEARCH`,
  `MF_STORAGE`, `MF_MAP`, `MF_AERIAL`, `MF_STREET`, `MF_EXPORT`.
- **Analyse des requêtes** : 6 formulations testées (nom + CP, nom + ville, adresse complète,
  CP seul, ville seule, rue + ville sans numéro).
- **Géométrie** : distance haversine, azimut, bbox autour d'un point, similarité de chaînes.
- **Normalisation** : Photon → modèle interne (nom, précision, objet OSM, adresse, bbox) ;
  Nominatim → modèle interne (numéro, type `address`, précision `approximate`) ; rejet des
  coordonnées invalides.
- **Appariement bâtiment** : accepté quand adresse + containment concordent (confiance `high`) ;
  **refusé** pour un bâtiment situé à 120 m (aucun appariement abusif).
- **Classement** : un commerce nommé passe devant une ville ; fusion des doublons entre
  fournisseurs (même objet OSM) avec complétion de l'adresse manquante.
- **Réseau** : cache avec TTL (lecture, expiration, statistiques).
- **Export** : échappement CSV (`;` et guillemets), ligne complète avec lien OSM.
- **Stockage** : préférences, historique dédupliqué (entrée la plus récente conservée),
  favoris (ajout/retrait).
- **Honnêteté des sources** : l'IGN ne se déclare pas couvert à Antananarivo ; Esri couvre le
  monde ; aucune URL d'imagerie ne contient de clé ; aucune source photo n'exige de compte.
- **Libellés de vue des photos** : azimut inconnu → « Vue depuis la rue » (jamais « face » ou
  « latérale ») ; caméra orientée vers le bâtiment ; caméra opposée → « enfilade ».
- **Parcours utilisateur complet** : recherche → 2 cartes de résultat → interprétation affichée →
  sélection → fiche détaillée (nom, coordonnées, 5+ lignes) → GPS sur la carte → actions activées →
  note de précision → favoris → onglet photos (2 vignettes, badge 360°, crédits et licence) →
  onglet aérien (message honnête quand aucune tuile ne répond, avertissement signalé) →
  bascule d'onglets (ARIA) → effacement (retour à l'état initial).

`node test/dom-check.js` — **cohérence du DOM, tous les contrôles passent** :
identifiants uniques, 80+ identifiants demandés par `app.js` tous présents, `getElementById`
valides, labels `for=` et attributs ARIA non orphelins, scripts chargés dans l'ordre de
dépendance, feuilles de style et images locales présentes, **aucune ressource CDN bloquante**,
**aucune clé d'API en dur** dans le code, trois onglets et panneaux cohérents, absence de
formulation trompeuse du type « carte satellite ». Ce contrôle a d'ailleurs trouvé un vrai
défaut (un identifiant orphelin `btn-detail-close`), corrigé.

Rejouer : `npm install` puis `npm test`.

## 4. Compatibilité Windows (niveau B)

- `START.bat` : détection **Python** (`python`/`py -3`), sinon **Node.js** (`server.js`),
  sinon **PowerShell** (`start-server.ps1`). Ouverture automatique du navigateur.
- Vérifié : `serve.py` sert correctement les 13 types de ressources (HTML, CSS, JS, PNG, SVG)
  avec les bons types MIME — sans cet en-tête correct, le navigateur refuserait d'exécuter les
  modules JS.
- Vérifié : `server.js` (Node) parse correctement (`node --check`) — chemin de secours.
- ⚠️ **Non vérifié** : l'exécution réelle de `START.bat` et de `start-server.ps1` sur une
  machine Windows (le développement a eu lieu sous Linux). Les trois scripts sont fournis pour
  que **au moins un** fonctionne ; `serve.py` est le plus sûr (Python est le plus souvent présent).

## 5. Ce qui doit encore être vérifié dans votre navigateur (niveau C)

Ces points ne peuvent **pas** être prouvés en dehors d'un navigateur. Ils sont tous vérifiables
en moins d'une minute grâce au bouton **Paramètres → Diagnostic → « Tester les sources »**,
qui affiche le résultat réel, tuile par tuile, avec l'URL utilisée.

1. **Rendu des tuiles d'imagerie aérienne** (IGN, puis Esri) et du fond de carte OSM.
   *Ce qui a été vérifié ici : l'URL est correcte (bon `TILEMATRIX/TILEROW/TILECOL`) et la
   couche existe au GetCapabilities. Ce qui reste à voir : l'affichage effectif de l'image.*
   Si les tuiles IGN ne s'affichent pas chez vous, l'application le détecte (sonde de tuile),
   avertit dans l'onglet et propose Esri — aucun écran vide silencieux.
2. **CORS autorisé par `data.geopf.fr` et `server.arcgisonline.com`** pour les tuiles.
   Rappel technique : afficher une tuile ne nécessite pas CORS ; seules la lecture des pixels
   (`canvas`) ou les appels `fetch` l'exigent. La sonde a été écrite pour ne pas dépendre de
   CORS et ne pas produire de faux négatifs.
3. **Rendu de la carte Leaflet** (marqueurs, polygones d'emprise, popups, plein écran).
4. **Parcours de la galerie photo** : agrandissement, flèches clavier, panorama 360°
   (visualiseur Pannellum embarqué) initialisé avec l'azimut pointé vers le bâtiment.
5. **Rendus responsive** (ordinateur, tablette, mobile) et thème sombre.

## 6. Limites assumées, dites à l'utilisateur dans l'interface

1. Aucune emprise de bâtiment trouvée → badge **« Approximatif »** + explication, jamais un
   marqueur présenté comme « le bâtiment ».
2. Aucune photographie dans le rayon → message **« Aucune photographie disponible pour cette
   localisation. »** (rien d'autre n'est affiché ; aucune image générique).
3. Vue latérale / de face impossible à garantir → les libellés sont calculés à partir de
   l'azimut réel de la caméra ; sans azimut, l'étiquette reste « Vue depuis la rue ».
4. Overpass saturé → la recherche fonctionne, mais la précision reste celle du géocodeur.
5. Hors connexion → seules les données déjà consultées (cache local) sont disponibles ;
   l'application le dit au lieu d'échouer silencieusement.
6. Nominatim depuis un navigateur : l'identification repose sur le `Referer` (le navigateur
   interdit de fixer un `User-Agent`). C'est l'alternative prévue par la politique OSMF, mais
   elle peut être filtrée par certains proxys d'entreprise — d'où la possibilité de le
   désactiver dans les paramètres (Photon reste seul et suffit).
