# MAPFINDER

**Recherche et géolocalisation de bâtiments** — trouvez une entreprise, une adresse, une rue,
un code postal ou une ville, localisez le bâtiment sur une carte, regardez son toit en vue
aérienne et consultez les photographies de rue disponibles.

Application web classique : **HTML5 + CSS3 + JavaScript natif + Leaflet**, sans framework,
sans compilation, **sans clé d'API et sans service payant**.
Tout fonctionne en local sur votre ordinateur ; seules les données viennent d'Internet.

---

## 1. Démarrage rapide (Windows)

1. Décompressez le dossier `MAPFINDER` où vous voulez (Bureau, `Documents`, etc.).
2. **Double-cliquez sur `START.bat`.**
3. Le navigateur s'ouvre sur `http://localhost:8000/` — l'application est prête.

`START.bat` détecte automatiquement ce qui est installé :

| Priorité | Outil détecté | Ce qui est lancé |
|---|---|---|
| 1 | Python (`python` ou `py -3`) | `serve.py` — recommandé |
| 2 | Node.js | `server.js` |
| 3 | Rien des deux | PowerShell → `start-server.ps1` |

> **Pourquoi un serveur local plutôt qu'un double-clic sur `index.html` ?**
> Ouvert en `file://`, le navigateur bloque les appels réseau vers les API externes
> (règles de sécurité d'origine). Un serveur local sur `http://localhost` lève ce blocage.
> Aucune installation : Python et Node sont déjà présents sur la plupart des machines ;
> sinon, le script PowerShell prend le relais.

Pour arrêter l'application : fermez la fenêtre noire (ou `Ctrl+C`).

### Sur macOS / Linux

```bash
python3 serve.py          # puis ouvrir http://localhost:8000/
# ou
python3 -m http.server 8000
```

---

## 2. Utilisation en 6 étapes

1. Saisissez votre recherche dans la barre centrale
   (`Renault, 75001 Paris`, `15 rue de la Paix, 75002 Paris`, `75008 Paris`, `Antananarivo`…).
   Des **suggestions** apparaissent pendant la frappe.
2. Appuyez sur **Entrée** (ou cliquez sur **Rechercher**).
3. La liste de gauche classe les résultats par pertinence : nom, adresse, code postal, ville,
   coordonnées, **badge de précision**.
4. Cliquez sur le bâtiment souhaité : la carte se centre, le marqueur se pose, l'adresse et les
   coordonnées GPS s'affichent.
5. Ouvrez l'onglet **Vue aérienne** pour voir le toit, les bâtiments voisins et les parcelles.
6. Ouvrez l'onglet **Photos du bâtiment** pour les photographies de rue géolocalisées.

### Raccourcis

| Touche | Action |
|---|---|
| `/` ou `Ctrl+K` | Aller à la barre de recherche |
| `↑` / `↓` | Parcourir les suggestions |
| `Échap` | Fermer suggestions / fenêtre |
| `←` / `→` | Photo précédente / suivante (dans la galerie) |

---

## 3. Ce que l'application fait réellement (et ce qu'elle ne fait pas)

MAPFINDER est conçue autour d'une règle : **ne jamais prétendre en savoir plus que la source**.

### Trois niveaux de précision, toujours affichés

| Badge | Signification |
|---|---|
| 🟢 **Bâtiment** | Le contour du bâtiment a été trouvé dans OpenStreetMap ; le marqueur est son centre et le contour s'affiche en polygone (surface indiquée). |
| 🔵 **Point d'intérêt** | OpenStreetMap connaît le commerce/société comme un point : il peut désigner l'entrée plutôt que le centre du bâtiment. |
| 🟠 **Approximatif** | Aucune emprise trouvée : OpenStreetMap ne fournit que l'adresse ou le centre d'une zone. Le marqueur est celui du géocodeur. |

### Ce que l'application ne fait pas

- Elle ne garantit pas d'identifier « le » bâtiment si OpenStreetMap ne contient pas son emprise.
- Elle n'affiche **jamais** une carte routière comme une vue satellite : l'onglet aérien
  indique sa source, et si aucune imagerie n'est disponible, il le dit.
- Elle n'affiche **jamais** d'image générique comme photo du bâtiment : sans photographie
  géolocalisée, le message est « Aucune photographie disponible pour cette localisation. »
- Elle ne promet pas de « vue de face / latérale » : une photo de rue montre ce que la caméra
  a vu. L'étiquette est calculée à partir de l'azimut réel, sinon elle reste neutre.
- Elle ne fonctionne pas hors ligne sans pré-téléchargement : l'application est locale,
  mais les cartes, l'imagerie et les photos viennent d'Internet.

---

## 4. Sources de données (toutes gratuites, aucune clé)

| Usage | Source | Licence / conditions |
|---|---|---|
| Fond de carte | OpenStreetMap (+ OSM France, CARTO Positron) | ODbL 1.0, attribution obligatoire |
| Recherche + suggestions | **Photon** (komoot) | ODbL (données OSM), usage raisonnable |
| Recherche complémentaire | **Nominatim** (OSM Foundation) | ODbL ; **1 req/s**, autocomplétion interdite → jamais utilisée pour la frappe |
| Bâtiments, voisinage | **Overpass API** (3 miroirs) | ODbL ; une requête en vol, rayon ≤ 300 m |
| Vue aérienne | **IGN — BD ORTHO** (Géoplateforme) | Licence Ouverte / Etalab 2.0 — France et DOM |
| Vue aérienne (secours) | **Esri World Imagery** | Attribution obligatoire, usage non commercial |
| Photos de rue | **Panoramax** (IGN + OSM France) | Licence par image : Etalab 2.0 ou CC BY-SA 4.0 |
| Photos de rue (secours) | **KartaView** | CC BY-SA 4.0, images floutées uniquement |

**Aucune source nécessitant un compte ou une carte bancaire n'est utilisée.** Google Maps,
Mapbox, Bing, Here, Street View facturé et Mapillary (jeton de compte requis) sont
volontairement écartés. Aucun scraping.

Le détail complet des politiques, quotas et limites vérifiés :
[`docs/PHASE-1-ANALYSE-SOURCES.md`](docs/PHASE-1-ANALYSE-SOURCES.md).
Dans l'application : bouton **Sources** en haut à droite.

---

## 5. Architecture des fichiers

```
MAPFINDER/
├── index.html                  structure complète de l'interface
├── START.bat                   démarrage Windows (Python → Node → PowerShell)
├── serve.py                    serveur local Python (recommandé)
├── server.js                   serveur local Node.js (secours)
├── start-server.ps1            serveur local PowerShell (dernier recours)
│
├── css/
│   ├── style.css               jetons de design, mise en page, typographie, thèmes
│   ├── components.css          boutons, champs, résultats, onglets, galerie, modales
│   └── responsive.css          tablette, mobile, orientation, impression
│
├── js/
│   ├── utils.js                helpers purs : format, distances, azimut, debounce, DOM
│   ├── api-services.js         socle réseau : limiteur par hôte, cache TTL, timeout,
│   │                           reprise, bascule de fournisseurs, erreurs typées
│   ├── geocoding.js            Photon + Nominatim → modèle SearchResult unique
│   ├── overpass.js             emprise du bâtiment, POI voisins, orientation de la rue
│   ├── search.js               analyse de la requête, orchestration, classement, suggestions
│   ├── map.js                  carte Leaflet : marqueur, emprise, résultats, sélection
│   ├── satellite.js            imagerie aérienne : IGN → Esri → repli, sonde de tuile
│   ├── street-images.js        Panoramax + KartaView, déduplication, étiquetage des angles
│   ├── storage.js              cache local, historique, favoris, préférences
│   ├── export.js               CSV/JSON, presse-papier, liens externes, lien partageable
│   └── app.js                  contrôleur : état, rendu, onglets, événements, accessibilité
│
├── config/
│   └── services.js             TOUTE la configuration : endpoints, quotas, TTL, licences
│
├── vendor/                     bibliothèques embarquées (aucun CDN, fonctionne hors ligne
│   ├── leaflet/                côté chargement des fichiers)
│   └── pannellum/              visualiseur de panorama 360° (MIT)
│
├── assets/
│   ├── logo/                   logo + favicon (SVG)
│   ├── icons/                  note d'architecture des icônes
│   └── images/                 illustrations d'interface
│
├── docs/
│   ├── PHASE-1-ANALYSE-SOURCES.md   analyse des sources, quotas, licences
│   ├── PHASE-2-ARCHITECTURE.md      architecture technique et flux
│   └── TESTS.md                     tests réalisés et limites
│
└── test/
    ├── dom-harness.js          tests automatiques du code réel (jsdom)
    └── url-probe.js            génère les URL réellement envoyées aux API
```

**Règle de dépendance** : `app.js` → `search.js` → `geocoding.js` → `api-services.js` → `utils.js`.
Aucun module ne connaît l'interface. Tous les appels réseau passent par `api-services.js` :
changer de fournisseur = modifier un objet dans `config/services.js`.

---

## 6. Fonctionnalités

**Recherche** — barre centrale, suggestions, nom / adresse / rue / code postal / ville,
combinaisons, bouton Rechercher, bouton Effacer, tri (pertinence, nom, distance), filtre
« masquer les approximatifs », indicateurs de chargement.

**Carte** — Leaflet + OpenStreetMap, marqueur coloré selon la précision, emprise du bâtiment,
résultats numérotés, 3 fonds de carte, zoom, plein écran, recentrage, coordonnées GPS sous le
curseur, clic pour mesurer distance et azimut.

**Vue aérienne** — orthophotographie réelle (IGN en priorité, Esri en secours), choix de la
source, contour du bâtiment, mesure au clic, message explicite si aucune imagerie.

**Photos** — Panoramax + KartaView, rayon réglable (30–150 m), vignettes avec distance,
auteur, date et licence, agrandissement, navigation clavier, panorama 360° (Pannellum).

**Compléments** — historique, favoris, sélection multi-bâtiments (marqueurs + tracé), copie
GPS / adresse, itinéraire OpenStreetMap, export CSV/JSON, lien partageable (`#q=…`),
sauvegarde et restauration des données locales, thème clair/sombre/auto, diagnostic des sources.

---

## 7. Paramètres et données locales

Menu **Paramètres** : thème, fond de carte, source d'imagerie préférée, activation de
Nominatim, recherche d'emprise (Overpass), explications de précision, **diagnostic des
sources**, vidage du cache, export/import des données, réinitialisation.

Tout est stocké dans le navigateur (localStorage) : historique (40 entrées max), favoris,
sélection, préférences, cache des requêtes (TTL par service, 80 entrées max).
Aucune donnée n'est envoyée ailleurs qu'aux services cartographiques cités.

---

## 8. Tests

```bash
npm install        # une seule fois : installe jsdom (outil de test uniquement)
npm test           # testes le code réel de l'application dans un DOM
npm run probe      # affiche les URL exactes envoyées aux API
```

Résultats, preuves et limites : [`docs/TESTS.md`](docs/TESTS.md).

**À faire de votre côté (1 minute)** : ouvrez **Paramètres → Diagnostic → « Tester les
sources d'imagerie »**. Le rendu des tuiles aériennes et les autorisations CORS ne peuvent
être validés que dans un vrai navigateur : ce bouton le vérifie pour votre réseau et affiche
l'URL testée pour chaque fournisseur.

---

## 9. Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| Page blanche | Ouverture directe du fichier `index.html` | Lancez `START.bat` (serveur local obligatoire) |
| « Service injoignable » | Pas de connexion, ou proxy d'entreprise | Vérifiez Internet ; le bandeau indique le service concerné |
| Aucune emprise de bâtiment | Overpass saturé ou bâtiment absent d'OSM | Réessayez plus tard, ou désactivez « Recherche d'emprise » |
| Onglet aérien vide | Zone non couverte par IGN et Esri indisponible | Changez la source dans l'onglet ; le message indique la limite |
| Aucune photo | Pas d'imagerie de rue dans le rayon | Augmentez le rayon à 150 m |
| Nominatim en échec (429) | Quota de 1 requête/seconde dépassé | L'application attend automatiquement ; Photon suffit seul |
| Le port 8000 est occupé | Autre application | `serve.py` choisit automatiquement le port suivant |

---

## 10. Licence et crédits

Code de l'application : fourni pour ce projet. Bibliothèques embarquées : **Leaflet** (BSD-2,
voir `vendor/leaflet/LICENSE`), **Pannellum** (MIT, voir `vendor/pannellum/LICENSE`).

Données et images : **© OpenStreetMap contributors** (ODbL), **Photon** (komoot),
**Nominatim** (OSM Foundation), **Overpass API**, **IGN Géoplateforme** (Licence Ouverte),
**Esri World Imagery**, **Panoramax** (IGN / OpenStreetMap France), **KartaView**.
Chaque photographie affiche son auteur et sa licence, et renvoie à sa fiche d'origine.

MAPFINDER est une application indépendante, non affiliée à ces fournisseurs.
