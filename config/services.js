/* ============================================================================
 * MAPFINDER — config/services.js
 * Configuration unique de tous les fournisseurs de données.
 * Modifier ce fichier suffit pour changer d'endpoint, de quota ou de licence.
 * Aucune clé d'API n'est stockée ici : aucune source retenue n'en exige.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const APP = {
    name: 'MAPFINDER',
    version: '1.0.0',
    // Identification applicative (exigence Nominatim : Referer/User-Agent identifiable).
    // Le navigateur ne permet pas de définir User-Agent ; on envoie donc un Referer explicite
    // et on l'affiche dans la politique d'usage de l'application.
    referer: 'https://mapfinder.local/',
    contact: 'Application locale MAPFINDER — usage manuel, non commercial',
    locale: 'fr',
    defaultCenter: [48.8584, 2.2945], // Paris, Tour Eiffel
    defaultZoom: 13,
    maxHistory: 40,
  };

  /* ------------------------------------------------------------------ *
   * LIMITES PAR HÔTE (politique de chaque fournisseur)
   * minInterval : ms entre deux requêtes vers ce même hôte
   * maxConcurrent : requêtes simultanées autorisées
   * ------------------------------------------------------------------ */
  const LIMITS = {
    'photon.komoot.io': { minInterval: 1000, maxConcurrent: 1 },
    'nominatim.openstreetmap.org': { minInterval: 1000, maxConcurrent: 1 },
    'overpass-api.de': { minInterval: 1500, maxConcurrent: 1 },
    'overpass.kumi.systems': { minInterval: 1500, maxConcurrent: 1 },
    'overpass.private.coffee': { minInterval: 1500, maxConcurrent: 1 },
    'api.panoramax.xyz': { minInterval: 1000, maxConcurrent: 2 },
    'api.kartaview.org': { minInterval: 900, maxConcurrent: 2 },
    default: { minInterval: 400, maxConcurrent: 3 },
  };

  /* ------------------------------------------------------------------ *
   * GÉOCODAGE
   * ------------------------------------------------------------------ */
  const GEOCODERS = {
    photon: {
      id: 'photon',
      label: 'Photon (komoot)',
      baseUrl: 'https://photon.komoot.io/api/',
      reverseUrl: 'https://photon.komoot.io/reverse',
      licence: 'ODbL — données © OpenStreetMap contributors',
      attribution: 'Photon / OpenStreetMap',
      supportsSuggest: true, // construit pour l'autocomplétion
      ttl: 24 * 60 * 60 * 1000, // 24 h
      weight: 1, // priorité de fusion des résultats
    },
    nominatim: {
      id: 'nominatim',
      label: 'Nominatim (OpenStreetMap Foundation)',
      baseUrl: 'https://nominatim.openstreetmap.org/search',
      reverseUrl: 'https://nominatim.openstreetmap.org/reverse',
      licence: 'ODbL — données © OpenStreetMap contributors',
      attribution: 'Nominatim / OpenStreetMap',
      // Politique OSMF : autocomplétion formellement interdite -> jamais utilisé pour `suggest`.
      supportsSuggest: false,
      ttl: 24 * 60 * 60 * 1000,
      weight: 0.9,
    },
  };

  /* ------------------------------------------------------------------ *
   * OVERPASS — recherche d'emprises de bâtiments et de POI voisins
   * Plusieurs miroirs : bascule automatique (l'instance principale sature).
   * ------------------------------------------------------------------ */
  const OVERPASS = {
    endpoints: [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ],
    timeoutMs: 25000,
    ttl: 15 * 60 * 1000,
    maxRadius: 300, // requêtes bornées : jamais de requête mondiale
  };

  /* ------------------------------------------------------------------ *
   * FONDS DE CARTE (affichage uniquement)
   * ------------------------------------------------------------------ */
  const BASEMAPS = {
    osm: {
      id: 'osm',
      label: 'Carte OpenStreetMap',
      kind: 'map', // carte routière — PAS une vue aérienne
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      licence: 'ODbL 1.0',
    },
    osmfr: {
      id: 'osmfr',
      label: 'Carte OSM France (Humanitaire)',
      kind: 'map',
      url: 'https://tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors, Tiles: HOT France',
      licence: 'ODbL 1.0',
    },
    positron: {
      id: 'positron',
      label: 'Carte claire (CartoDB Positron)',
      kind: 'map',
      url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      licence: 'ODbL 1.0 / CARTO',
    },
  };

  /* ------------------------------------------------------------------ *
   * IMAGERIE AÉRIENNE / SATELLITE — ordre de priorité
   * Vérifié : aucune de ces sources n'exige de clé.
   * ------------------------------------------------------------------ */
  const IMAGERY = {
    providers: [
      {
        id: 'ign-ortho',
        label: 'IGN — Orthophoto (BD ORTHO)',
        kind: 'aerial',
        // WMTS Géoplateforme, Licence Ouverte / Etalab 2.0, sans clé
        url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
          + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM'
          + '&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
        maxZoom: 21,
        maxNativeZoom: 19,
        minZoom: 6,
        attribution: '&copy; IGN — Géoplateforme, BD ORTHO®',
        licence: 'Licence Ouverte / Etalab 2.0',
        description: 'Orthophotographie aérienne IGN, résolution 20 cm. Couverture : France métropolitaine et DOM.',
        // Couverture déclarée : France + DOM (pas de test réseau supplémentaire)
        covers: (lat, lon) => (
          (lat >= 41 && lat <= 51.5 && lon >= -5.5 && lon <= 10)
          || (lat >= -22 && lat <= -20 && lon >= 54 && lon <= 56)      // La Réunion
          || (lat >= 14 && lat <= 19 && lon >= -62 && lon <= -60)      // Antilles
          || (lat >= 3 && lat <= 6 && lon >= -55 && lon <= -51)        // Guyane
          || (lat >= -26 && lat <= -24 && lon >= 44 && lon <= 47)      // Mayotte
        ),
      },
      {
        id: 'esri-world',
        label: 'Esri World Imagery',
        kind: 'aerial',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maxZoom: 19,
        maxNativeZoom: 18,
        minZoom: 1,
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, Vantor et la communauté GIS',
        licence: 'Conditions Esri — attribution obligatoire, usage non commercial',
        description: 'Imagerie satellite et aérienne mondiale (1 m ou mieux selon les zones). Source de secours hors France.',
        covers: () => true,
      },
      {
        id: 'ign-ortho-histo',
        label: 'IGN — Orthophoto historique (1950–1965)',
        kind: 'aerial',
        url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
          + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1950-1965&STYLE=BDORTHOHISTORIQUE'
          + '&TILEMATRIXSET=PM&FORMAT=image%2Fpng&TILEMATRIX={z}&TILECOL={x}&TILEROW={y}',
        maxZoom: 19,
        maxNativeZoom: 18,
        minZoom: 6,
        attribution: '&copy; IGN — Géoplateforme, BD ORTHO® historique',
        licence: 'Licence Ouverte / Etalab 2.0',
        description: 'Photographies aériennes historiques IGN (1950-1965). Utile pour l’évolution urbaine.',
        optional: true,
        covers: (lat, lon) => (lat >= 41 && lat <= 51.5 && lon >= -5.5 && lon <= 10),
      },
    ],
  };

  /* ------------------------------------------------------------------ *
   * PHOTOGRAPHIES DE RUE — ordre de priorité (aucune clé requise)
   * ------------------------------------------------------------------ */
  const STREET = {
    radiusDefault: 60, // mètres
    radiusMax: 150,
    maxPhotos: 24,
    providers: [
      {
        id: 'panoramax',
        label: 'Panoramax',
        baseUrl: 'https://api.panoramax.xyz/api/search',
        viewerUrl: 'https://api.panoramax.xyz/#focus=pic&pic=',
        licence: 'Licence par image (Etalab 2.0 sur l’instance IGN, CC BY-SA 4.0 sur OSM-FR)',
        attribution: 'Panoramax — IGN & OpenStreetMap France',
        ttl: 30 * 60 * 1000,
      },
      {
        id: 'kartaview',
        label: 'KartaView',
        baseUrl: 'https://api.kartaview.org/2.0/photo/',
        licence: 'CC BY-SA 4.0',
        attribution: 'KartaView (ex OpenStreetCam)',
        ttl: 30 * 60 * 1000,
      },
    ],
  };

  /* ------------------------------------------------------------------ *
   * LIENS EXTERNES (aucune intégration payante)
   * ------------------------------------------------------------------ */
  const EXTERNAL = {
    osm: (lat, lon, z) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${z || 19}/${lat}/${lon}`,
    osmDirections: (lat, lon) => `https://www.openstreetmap.org/directions?to=${lat}%2C${lon}`,
    osmEdit: (type, id) => ({ node: 'https://www.openstreetmap.org/node/', way: 'https://www.openstreetmap.org/way/', relation: 'https://www.openstreetmap.org/relation/' }[type] || '') + id,
    osmCopyright: 'https://www.openstreetmap.org/copyright',
    panoramax: 'https://panoramax.fr',
    kartaview: 'https://kartaview.org',
    ign: 'https://geoservices.ign.fr',
  };

  global.MF_CONFIG = {
    APP,
    LIMITS,
    GEOCODERS,
    OVERPASS,
    BASEMAPS,
    IMAGERY,
    STREET,
    EXTERNAL,
  };
})(window);
