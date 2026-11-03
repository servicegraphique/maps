# MAPFINDER — Phase 1 : analyse des sources de données gratuites

> Document de référence. Chaque affirmation ci-dessous a été vérifiée soit par une sonde
> réelle depuis le sandbox de développement (colonne « Sonde »), soit dans la documentation
> officielle du fournisseur (lien fourni). Date des vérifications : **3 novembre 2026**.

## 1. Contrainte technique majeure à comprendre avant tout

L'application est **100 % front-end** (HTML/CSS/JS, aucun backend). Or les navigateurs
imposent deux règles qui ont dicté toute l'architecture :

1. **CORS** : le navigateur n'appelle une API que si celle-ci envoie les en-têtes
   `Access-Control-Allow-Origin` adéquats. Beaucoup de sources cartographiques (WMS/WMTS,
   certaines API d'imagerie) ne les envoient pas → **inutilisables directement en JS**.
   En revanche, les *tuiles* d'une couche raster Leaflet (`<img>`) ne sont pas soumises à CORS
   *sauf* si l'on veut lire les pixels (`canvas`). On peut donc **afficher** beaucoup de choses
   qu'on ne peut pas **interroger**.
2. **`User-Agent` non modifiable** en JS : le navigateur ne permet pas de définir un
   User-Agent applicatif. Le service de géocodage public de l'OSM Foundation (Nominatim)
   exige pourtant une identification fiable. Depuis un navigateur, on ne peut fournir que le
   `Referer` de l'application — ce qui est explicitement la deuxième option acceptée par la
   politique. Cela a des conséquences (voir §3).

Une troisième limite s'ajoute : certaines API ne sont **pas** utilisables sans création de
compte ni jeton (Mapillary). L'application doit donc fonctionner proprement **sans aucun
jeton**, et proposer les sources à jeton comme *options activables*.

## 2. Tableau de décision des sources

| Besoin | Source retenue (défaut) | Coût / clé | CORS navigateur | Licence | Sonde (03/11/2026) |
|---|---|---|---|---|---|
| Fond de carte | **OpenStreetMap** raster `tile.openstreetmap.org` | Gratuit, **aucune clé** | Oui (tuiles `<img>`) | ODbL 1.0 – attribution obligatoire | OK (usage direct navigateur) |
| Fond de carte alternatif | OSM France `tile.openstreetmap.fr/hot` | Gratuit | Oui | ODbL | OK |
| Imagerie aérienne | **IGN Géoplateforme** `data.geopf.fr` WMTS `ORTHOIMAGERY.ORTHOPHOTOS` | Gratuit, **aucune clé** | Oui (tuiles) | Licence Ouverte / Etalab 2.0 | Tuiles servies ; couverture France + DOM uniquement |
| Imagerie aérienne (monde) | **Esri World Imagery** `server.arcgisonline.com/.../tile/{z}/{y}/{x}` | Gratuit sous conditions (voir §5) | Oui (tuiles) | Esri + contributeurs : **attribution obligatoire**, pas d'usage commercial à grande échelle sans compte | Service décrit comme « 1 m ou mieux » ; imagerie mondiale de secours |
| Imagerie de secours locale | IGN `ORTHOIMAGERY.ORTHOPHOTOS` (FR) puis Esri (monde) puis OSM (transparence déclarée) | Gratuit | Oui | — | Chaîne de repli implémentée |
| Géocodage / adresses | **Photon** (komoot) `photon.komoot.io` | Gratuit, **aucune clé** | **Oui** (vérifié) | ODbL (données OSM) | `200` + `FeatureCollection` GeoJSON, propriétés structurées (`housenumber`, `street`, `postcode`, `city`, `osm_type`, `osm_id`, `extent`) |
| Géocodage complémentaire | **Nominatim** `nominatim.openstreetmap.org/search` | Gratuit, **aucune clé** | Oui, **mais règle d'identification stricte** | ODbL | `200` + `jsonv2` avec `addressdetails`, `extratags`, `namedetails`, `boundingbox` |
| Commerces / bâtiments | **Overpass API** (miroirs) | Gratuit | Oui | ODbL | Instance principale **502 (saturation)** pendant les tests → repli indispensable |
| Photos de rue (défaut) | **Panoramax** `api.panoramax.xyz/api` | Gratuit, **aucune clé** | **Oui** | Etalab 2.0 (IGN) / CC-BY-SA 4.0 (OSM-FR) selon l'image | `200` + STAC/GeoJSON ; assets `thumb` / `sd` / `hd` ; `pers:yaw`, `field_of_view`, `license`, `datetime`, `quality:horizontal_accuracy`. **Couverture vérifiée à Antananarivo** |
| Photos de rue (2) | **KartaView** `api.kartaview.org/2.0/photo/` | Gratuit, **aucune clé** | **Oui** (vérifié) | CC-BY-SA 4.0 | `200` + `result.data[]` avec `lat`,`lng`,`heading`,`shotDate`,`imageProcUrl`,`distance` |
| Photos de rue (3, option) | **Mapillary** `graph.mapillary.com` | Gratuit **mais jeton client requis** | Oui | CC-BY-SA 4.0 | Non testé (pas de jeton) → désactivé par défaut, activable via Paramètres |
| Panorama 360° | **Pannellum** (MIT, embarqué localement) | Gratuit | n/a | MIT | Rendu équirectangulaire côté client |
| Itinéraire | OSM `openstreetmap.org/directions` (+ alternatives OSRM) | Gratuit | Oui | ODbL | Lien externe, pas d'intégration payante |

**Écartés explicitement** : Google Maps Platform, Mapbox, Bing, Here, TomTom (comptes/clés
+ conditions commerciales) ; Google Street View (facturation) ; toute API exigeant une carte
bancaire ; tout scraping (interdit, y compris l'aspiration de pages de résultats).

## 3. Politiques d'utilisation : ce qui est permis, ce qui est interdit

### Nominatim ([politique officielle](https://operations.osmfoundation.org/policies/nominatim/))
- **Maximum absolu : 1 requête/seconde.** ✔ respecté par un limiteur global dans `api-services.js`.
- **Identification** : `User-Agent` valide *ou* `Referer` identifiable. En navigateur, seul le
  `Referer` est disponible → l'application envoie donc un `Referer` applicatif
  (`MAPFINDER/1.0`) et l'écrit dans la documentation. C'est conforme à l'alternative prévue
  par la politique, mais **fragile** (un `Referer` peut être filtré par un proxy d'entreprise).
- **Autocomplétion formellement interdite** : « *you must not implement such a service on the
  client side using the API* ». → **L'autocomplétion n'utilise jamais Nominatim** (voir §4).
- **Cache obligatoire** : les requêtes répétées doivent être servies localement. ✔ cache 24 h.
- Attribution visible + mention ODbL. ✔ dans le pied de page et l'onglet « Sources ».

### Photon ([terms](https://photon.komoot.io/))
- « Vous pouvez utiliser l'API pour votre projet, mais soyez raisonnable — un usage intensif
  sera limité (throttlé). » Pas de quota chiffré, pas de clé.
- Conçu **pour l'autocomplétion** → c'est notre unique backend de suggestions.
- Auto-hébergeable (même code, données OSM) → chemin de sortie si le service public se ferme.
- Limiteur appliqué : **~1 requête/s**, debounce 300 ms, longueur minimale 3 caractères.

### Overpass API ([wiki OSM](https://wiki.openstreetmap.org/wiki/Overpass_API))
- **Deux créneaux de requêtes simultanées** sur l'instance principale ; file d'attente 15 s
  puis `429`. Instance principale **saturée (502)** lors des tests.
- Consigne officielle : < 10 000 requêtes/jour et < 5 Go/jour ; une seule requête en vol.
- L'instance `overpass.kumi.systems` est annoncée « utilisation libre, sans limite de capacité »
  mais demande d'être prévenu pour les gros projets.
- → Implémentation : **une seule requête Overpass en vol**, bascule ordonnée de miroirs,
  `Retry-After`/`429`/`502`/`504` compris, cache 15 min, requêtes bornées par `around:` (< 300 m).

### OSM / tuiles ([tile usage policy](https://operations.osmfoundation.org/policies/tiles/))
- Pas de téléchargement massif, pas de tuiles en `no-referrer`, User-Agent honnête.
- → Chargement uniquement des tuiles visibles, pas de préchargement, cache HTTP du navigateur.

### Esri World Imagery
- Gratuit **si** : (a) compte développeur ArcGIS gratuit, (b) application sans revenus,
  (c) < 1 000 000 tuiles/mois, (d) attribution d'Esri **et** de tous les fournisseurs.
- Utilisé ici comme **source de secours mondiale**, avec attribution complète affichée.
- L'application le déclare dans « Sources » et permet de le désactiver (préférence stockée).

### Panoramax ([panoramax.fr](https://panoramax.fr))
- Communs fédérés (IGN + OSM France + ~25 instances), **lecture sans clé, CORS ouvert**.
- Licence **par image** (Etalab 2.0 sur l'instance IGN, CC-BY-SA 4.0 sur OSM-FR) : la licence
  et l'auteur sont affichés **sur chaque photo**, et la photo renvoie à sa fiche d'origine.
- Aucune limite chiffrée documentée → limiteur 1 req/s + cache.

### KartaView
- Endpoints publics **anonymes** (≈100 req/h sans jeton). `2.0/photo/` répond sans clé ;
  ⚠️ certains endpoints `2.0` renvoient HTTP 200 avec `status.apiCode = 401` → le code vérifie
  **`apiCode === 600`**, jamais le seul code HTTP. Limiteur : 2 requêtes en vol maximum (l'API
  renvoie `429` au-delà de ~3).
- On n'affiche que les images `autoImgProcessingResult = BLURRED` (floutage visages/plaques).

### Mapillary
- API gratuite **mais** jeton client obligatoire (compte). Le jeton étant visible côté client,
  il est stocké **uniquement dans le navigateur** (`localStorage`), jamais dans un fichier du
  dépôt. Sans jeton, le fournisseur est **désactivé silencieusement**, l'interface le dit.

## 4. Décisions structurantes (et pourquoi)

1. **Deux fournisseurs de géocodage, usages séparés.**
   Photon = **frappe au clavier** (autorisé). Nominatim = **validation de la recherche**
   (Entrée / bouton), 1 req/s, cache. On respecte ainsi la politique Nominatim au lieu de la
   contourner par un debounce.
2. **Recherche structurée avant recherche libre.** Une requête comme `Renault, 75001 Paris`
   est décomposée en `nom` + `code postal` + `ville` et envoyée en paramètres structurés
   (Photon `osm_tag`/`bbox`, Nominatim `street`/`city`/`postalcode`), ce qui donne des résultats
   bien plus pertinents qu'une chaîne brute.
3. **Trois niveaux de précision affichés, jamais confondus** (cf. §7 du cahier des charges) :
   - `POI` : nœud OSM nommé (commerces, sociétés) → précision **ponctuelle**, mais le nœud peut
     être placé au centre du bâtiment ou sur la voirie ;
   - `ADRESSE` : point d'adresse/interpolation → précision **approximative** ;
   - `BÂTIMENT` : emprise (`building=*`) récupérée via Overpass → **centroïde du bâtiment**,
     meilleure précision disponible, affichée comme polygone sur la carte.
   Chaque résultat porte un badge de précision + une phrase d'explication. Aucun libellé
   « bâtiment identifié » n'est affiché si l'emprise n'a pas été trouvée.
4. **Overpass sert à *qualifier*, pas à *chercher*.** La recherche primaire reste le géocodeur ;
   Overpass ne sert qu'à retrouver l'emprise du bâtiment et les POI voisins (contexte), ce qui
   limite drastiquement le nombre de requêtes et la charge sur les miroirs publics.
5. **Chaîne d'imagerie aérienne à 3 niveaux** avec test de disponibilité réel (une tuile est
   demandée ; si elle échoue, on descend d'un niveau) et transparence totale sur la source
   affichée. **Jamais** de carte routière présentée comme vue satellite.
6. **Photos honnêtes.** Aucune image générique, aucun placeholder présenté comme photo du
   bâtiment. Chaque photo affiche : source, auteur, licence, date, distance et **azimut**
   (« vue de face / latérale » calculé uniquement si l'azimut est connu, sinon étiquette
   neutre « vue depuis la rue »).
7. **Cache local + repli dégradé.** Toute réponse est mise en cache (`localStorage`, TTL par
   service, plafonné). Si un service est indisponible, l'application continue de fonctionner
   avec les autres sources et indique clairement ce qui manque.

## 5. Ce que l'application ne promet PAS

- **Pas d'identification garantie du bâtiment exact** : si OSM ne contient pas l'emprise,
  on affiche un point d'adresse avec le badge « approximatif ».
- **Pas d'imagerie aérienne partout** : hors France, on dépend d'Esri ; en zone non couverte,
  l'onglet l'annonce (« aucune imagerie aérienne disponible à cette résolution »).
- **Pas de photos partout** : le message « Aucune photographie disponible pour cette
  localisation » est affiché tel quel quand Panoramax, KartaView et Mapillary ne renvoient rien.
  Vérifié : Antananarivo **a** de la couverture Panoramax ; ce n'est pas le cas de toutes les villes.
- **Pas de vues latérales garanties** : une photo de rue montre ce que la caméra a vu. Les
  libellés « face / latérale » ne sont proposés que si l'azimut est mesuré.
- **Pas de fonctionnement hors-ligne** sans pré-téléchargement (hors périmètre de la v1) :
  l'application *tourne* en local, mais les données viennent d'Internet.
