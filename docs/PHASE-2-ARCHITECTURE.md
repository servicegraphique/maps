# MAPFINDER — Architecture technique

## 1. Vue d'ensemble

Application **100 % front-end**, sans build, sans backend, sans dépendance CDN
(Leaflet et Pannellum sont embarqués dans `vendor/`). Un simple serveur de fichiers suffit
(`START.bat` sous Windows, `python3 -m http.server` ailleurs).

```
Navigateur
 ├─ index.html ───────────── structure (header / recherche / 2 colonnes / 3 onglets)
 ├─ css/ ─────────────────── style.css (base) · components.css (UI) · responsive.css
 ├─ vendor/ ──────────────── leaflet 1.9.4 (BSD-2) · pannellum 2.5.7 (MIT) — autonome
 ├─ config/services.js ───── TOUTE la configuration : endpoints, quotas, TTL, clés optionnelles
 └─ js/
     ├── utils.js            helpers purs (format, distance, azimut, debounce, DOM, échappement)
     ├── api-services.js     socle réseau : limiteur, cache TTL, timeout, retry, repli, erreurs typées
     ├── geocoding.js        fournisseurs de géocodage (Photon, Nominatim) → modèle SearchResult
     ├── search.js           moteur : analyse de la requête, orchestration, classement, suggestions
     ├── map.js              carte principale Leaflet (marqueur, emprise, résultats multiples)
     ├── satellite.js        imagerie aérienne (IGN → Esri → avertissement) + vue du toit
     ├── street-images.js    photos de rue (Panoramax → KartaView → Mapillary optionnel)
     ├── overpass.js         emprise du bâtiment + POI voisins (qualification de précision)
     ├── storage.js          cache local, historique, favoris, préférences
     ├── export.js           CSV, presse-papier, liens externes (itinéraire, OSM, Google)
     └── app.js              contrôleur : état, événements, rendu, onglets, accessibilité
```

### Règle de dépendance

```
app.js ─► search.js ─► geocoding.js ─► api-services.js ─► utils.js
   │           └────► overpass.js ────┘
   ├─► map.js ─► satellite.js, street-images.js
   └─► storage.js, export.js
config/services.js est lu par tous (feuille du graphe).
```

Aucun module ne connaît l'interface. Chaque appel réseau passe par `api-services.js` :
remplacer un fournisseur = changer un objet dans `config/services.js` ou brancher un
adapter dans le module concerné (`{ id, label, search(), reverse() }`).

## 2. Flux d'une recherche

```
[Saisie]  ─ debounce 300 ms ─► Photon (autocomplétion autorisée, 1 req/s, cache 10 min)
   │
[Entrée / bouton]
   ▼
search.parseQuery()  →  { name, street, housenumber, postcode, city, country, freeText }
   ▼
Promise.allSettled([
   Photon.search(structured),        // 1er fournisseur
   Nominatim.search(structured)      // complément, 1 req/s
])
   ▼
normalisation → SearchResult[]  (id, label, adresse décomposée, lat/lon, osm_type/osm_id,
   │                             precision=POI|ADRESSE|BATIMENT, extent, provider, licence)
   ▼
search.rank()  → score = correspondance nom (exact > préfixe > fuzzy)
                          + adresse (n° rue, code postal, ville)
                          + type de lieu (bâtiment/commerce > route > ville)
                          + proximité du centre demandé
   ▼
Liste (colonne gauche)  ─ clic ─►  sélection
                                     ├─ map.focus(result)            marqueur + adresse + GPS
                                     ├─ overpass.building(result)    emprise → précision réelle
                                     ├─ reverse complément si adresse incomplète
                                     └─ onglets : Aérien / Photos (chargement à la demande)
```

## 3. Contrats d'API internes

```js
// SearchResult (modèle unique, produit par tous les géocodeurs)
{
  id, provider, licence, label, name,
  address: { housenumber, street, postcode, city, district, region, country, countryCode },
  lat, lon, bbox,
  osm: { type: 'node'|'way'|'relation', id, key, value },
  kind: 'poi'|'address'|'building'|'place'|'road',
  precision: 'exact'|'approximate'|'centroid',   // cf. §5
  precisionNote: 'Texte affiché à l'utilisateur',
  extent: [minLon, minLat, maxLon, maxLat] | null
}

// Fournisseur de géocodage
{ id, label, licence, attribution,
  suggest(query, opts) -> Promise<SearchResult[]>   // autocomplétion (Photon seul)
  search(parts, opts)  -> Promise<SearchResult[]>
  reverse(lat, lon)    -> Promise<SearchResult|null> }

// Fournisseur d'imagerie aérienne
{ id, label, attribution, licence, urlTemplate, maxZoom, bboxLimits? ,
  probe(lat, lon) -> Promise<boolean> }             // teste une tuile réelle

// Fournisseur de photos de rue
{ id, label, licence, requiresToken,
  nearby(lat, lon, radius) -> Promise<Photo[]> }
// Photo { id, url, thumb, provider, author, licence, date, lat, lon, distance, azimuth,
//         fieldOfView, is360, pageUrl }
```

## 4. Robustesse réseau (`api-services.js`)

| Mécanisme | Détail |
|---|---|
| Limiteur par hôte | file d'attente FIFO + intervalle minimal (Nominatim 1000 ms, Photon 1000 ms, Overpass 1 en vol) |
| Cache | `sessionStorage`/`localStorage` avec TTL par service (`config.services.js`), plafond d'entrées, éviction LRU |
| Timeout | `AbortController`, 8–12 s selon le service (Overpass : 25 s) |
| Retry | backoff exponentiel **uniquement** sur 429/502/503/504, max 2 essais, respect de `Retry-After` |
| Repli | liste d'endpoints ordonnée par service (Overpass : 3 miroirs, imagerie : 3 sources) |
| Erreurs typées | `NetworkError`, `TimeoutError`, `RateLimitError`, `EmptyResultError`, `AuthError`, `ServiceDownError` → messages français compréhensibles |
| Indisponibilité | bandeau non bloquant « Service X indisponible — résultats partiels », l'app reste utilisable |
| Hors-ligne | `navigator.onLine` + événements → bandeau + lecture du cache seulement |

## 5. Modèle de précision géographique (exigence centrale)

| Niveau | Source | Badge | Texte utilisateur |
|---|---|---|---|
| `centroid` | emprise `building=*` Overpass + centroïde | **Bâtiment** (vert) | « Emprise du bâtiment trouvée dans OpenStreetMap (surface ≈ N m²). Le marqueur est le centre du bâtiment. » |
| `exact` | nœud OSM nommé (`shop`, `amenity`, `office`…) | **Point d'intérêt** (bleu) | « Position du point d'intérêt dans OpenStreetMap : elle peut être placée à l'entrée ou au centre du bâtiment. » |
| `approximate` | point d'adresse / interpolation / résultat de ville | **Approximatif** (orange) | « Position approximative : OpenStreetMap ne fournit pas l'emprise de ce bâtiment. Le marqueur indique l'adresse ou le centre de la zone. » |

L'emprise trouvée est dessinée en **polygone** (`L.polygon`) ; l'absence d'emprise est
signalée explicitement. Une distance de contrôle est affichée si le POI et le centroïde
diffèrent de plus de 25 m (« écart de N m entre le point d'intérêt et le centre du bâtiment »).

## 6. Imagerie aérienne (`satellite.js`)

1. `IGN ORTHOIMAGERY.ORTHOPHOTOS` (WMTS Géoplateforme, Licence Ouverte) — France/DOM,
   orthophoto 20 cm, **le meilleur résultat pour le cas d'usage « voir le toit »**.
2. `Esri World Imagery` — couverture mondiale, attribution complète.
3. Aucune des deux → message explicite + bascule automatique sur la carte OSM **étiquetée
   « carte routière, pas une vue aérienne »**.
- `probe()` teste une tuile réelle avant d'afficher, donc pas de faux onglet « satellite » vide.
- Sondage inverse : les coordonnées sous le curseur sont affichées, et un clic sur le toit
  ouvre un repère secondaire (mesure de distance/azimut vers le point d'origine).
- Zoom natif limité par fournisseur (`maxNativeZoom` + upscaling) pour éviter les tuiles 404.

## 7. Photos de rue (`street-images.js`)

- Panoramax : `GET /api/search?bbox=<50 m>&limit=…` (STAC). Champs exploités : `geometry`,
  `assets.thumb|sd|hd`, `properties.pers:yaw`, `properties.pers:interior_orientation.field_of_view`,
  `properties.license`, `properties.datetime`, `providers[].name`, `quality:horizontal_accuracy`,
  liens `rel=via` (fiche d'origine).
- KartaView : `GET /2.0/photo/?lat&lng&radius`, filtre `autoImgProcessingResult === 'BLURRED'`,
  `imageProcUrl` (image floutée), `heading`, `shotDate`, `distance`.
- Mapillary (option) : uniquement si l'utilisateur a saisi son jeton dans Paramètres
  (stocké en `localStorage`, jamais dans le dépôt).
- Déduplication par proximité (< 8 m) et par empreinte d'image ; tri par distance puis date.
- **Étiquetage des angles** : l'azimut caméra→bâtiment est comparé à l'orientation de la rue
  (Overpass `highway`) pour proposer « vue depuis la rue », et « vue de face / latérale » **si
  et seulement si** l'azimut est renseigné. Sinon l'étiquette générique est utilisée.
- Panorama 360° → visualiseur Pannellum avec `yaw` initial pointé vers le bâtiment.
- Chaque vignette porte : source, auteur, licence (lien), date, distance, direction, et un
  lien vers la fiche d'origine. Clic = agrandissement (lightbox + navigation clavier).

## 8. Stockage local (`storage.js`)

| Clé | Contenu | TTL / limite |
|---|---|---|
| `mf.cache.*` | réponses API sérialisées | 10 min … 24 h selon service, LRU 60 entrées |
| `mf.history` | 30 dernières recherches | sans TTL, purge manuelle |
| `mf.favorites` | bâtiments épinglés (avec coordonnées) | illimité, export JSON |
| `mf.prefs` | thème, fournisseur aérien, rayon photos, jeton Mapillary, sources activées | persistant |
| `mf.selection` | bâtiments sélectionnés (multi-sélection) | session |

## 9. Accessibilité et UX

- Navigation clavier complète (barre de recherche `role=combobox` + `aria-activedescendant`,
  flèches haut/bas, Échap, Entrée), focus visibles.
- Contrastes AA, `prefers-reduced-motion`, `prefers-color-scheme` (thème sombre optionnel).
- Squelettes de chargement (pas de spinner plein écran), messages d'état annoncés en `aria-live`.
- Responsive : 2 colonnes ≥ 1024 px, empilement en dessous, carte redimensionnable, onglets
  scrollables sur mobile.

## 10. Fonctionnalités complémentaires

Historique, favoris, copie GPS / adresse, itinéraire (OSM), export CSV, multi-sélection sur la
carte (marqueurs numérotés + tracé de liaison), sauvegarde des préférences, lien profond
(`#q=…&lat=…&lon=…`) pour partager une recherche.

## 11. Découpage de réalisation

| Phase | Livrable | État |
|---|---|---|
| 1 — Analyse | `docs/PHASE-1-ANALYSE-SOURCES.md`, ce document | ✔ |
| 2 — Interface | `index.html`, `css/*` (header, recherche, 2 colonnes, onglets) | à faire |
| 3 — Recherche | `utils`, `api-services`, `geocoding`, `search`, `map`, `overpass` | à faire |
| 4 — Images | `satellite`, `street-images`, galerie, Pannellum | à faire |
| 5 — Optimisation | cache, perf, erreurs, `storage`, `export` | à faire |
| 6 — Livraison | `START.bat`, `README.md`, `docs/TESTS.md` (tests réels) | à faire |

## 12. Points de vigilance identifiés dès la conception

1. **Nominatim depuis un navigateur** est le point le plus fragile (identification par
   `Referer`). Mitigation : Photon en fournisseur principal, Nominatim en complément,
   et possibilité de **désactiver Nominatim** dans les paramètres (préférence persistée).
2. **Overpass public saturé** (502 constaté) : la recherche ne doit jamais en dépendre pour
   aboutir ; l'emprise et les POI sont un bonus, jamais un prérequis.
3. **CORS** : les fournisseurs retenus ont été choisis **aussi** pour leur CORS ouvert ;
   les serveurs WMS/WMTS sans CORS sont écartés du code.
4. **Clés** : aucun jeton dans le dépôt. Mapillary est optionnel et configuré par l'utilisateur.
