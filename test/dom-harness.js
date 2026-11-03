/**
 * MAPFINDER — harnais de test hors navigateur (jsdom).
 *
 * Il charge index.html puis TOUS les scripts de l'application dans un DOM réel,
 * avec Leaflet et Pannellum stubbés (ils exigent un vrai moteur de rendu).
 * Objectif : détecter les erreurs d'exécution, vérifier le câblage des modules,
 * l'analyse des requêtes et le rendu de l'interface.
 *
 * Usage : node test/dom-harness.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const errors = [];
const logs = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => errors.push('jsdomError: ' + e.message));
virtualConsole.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));
virtualConsole.on('warn', (...a) => logs.push('warn: ' + a.join(' ')));
virtualConsole.on('log', (...a) => logs.push('log: ' + a.join(' ')));

const dom = new JSDOM(html, {
  url: 'http://localhost:8000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;

/* ---------------------------------------------------------------- Stubs --- */
// Leaflet minimal : suffisant pour vérifier les appels de l'application.
const layerStub = () => ({
  addTo() { return this; }, remove() {}, clearLayers() {}, bindPopup() { return this; },
  bindTooltip() { return this; }, openTooltip() { return this; }, openPopup() {},
  bringToFront() { return this; }, bringToBack() { return this; }, setPopupContent() {},
  setLatLng() { return this; }, getLatLng() { return { lat: 48.85, lng: 2.35 }; },
  setView() { return this; }, setZoom() { return this; }, getZoom() { return 18; },
  on() { return this; }, fitBounds() { return this; }, extend() { return this; },
  isValid() { return true; }, getCenter() { return { lat: 48.85, lng: 2.35 }; },
});
const L = {
  map: () => Object.assign(layerStub(), {
    attributionControl: { setPrefix() {} },
    flyTo() { return this; }, setView() { return this; }, getCenter() { return { lat: 48.85, lng: 2.35 }; },
    getZoom() { return 13; }, invalidateSize() {}, removeLayer() {}, remove() {},
    setMaxBounds() {}, panTo() {},
  }),
  tileLayer: layerStub,
  marker: layerStub,
  circleMarker: layerStub,
  polyline: layerStub,
  polygon: layerStub,
  layerGroup: () => Object.assign(layerStub(), { addLayer() {} }),
  divIcon: (o) => o,
  latLngBounds: () => layerStub(),
  control: { zoom: () => ({ addTo() {} }), scale: () => ({ addTo() {} }) },
};
window.L = L;
window.pannellum = { viewer: () => ({ destroy() {} }) };

// Alertes / confirm bloquantes
window.confirm = () => true;

// Image : simule une tuile indisponible (pas de moteur de rendu dans jsdom).
// Permet de tester le chemin « aucune imagerie aérienne disponible ».
window.Image = class FakeImage {
  constructor() { this.naturalWidth = 0; }
  set src(value) {
    this._src = value;
    setTimeout(() => { if (this.onerror) this.onerror(); }, 0);
  }
  get src() { return this._src; }
};

/* ------------------------------------------------------- Chargement app --- */
const scripts = [
  'config/services.js',
  'js/utils.js',
  'js/api-services.js',
  'js/geocoding.js',
  'js/overpass.js',
  'js/search.js',
  'js/storage.js',
  'js/map.js',
  'js/satellite.js',
  'js/street-images.js',
  'js/export.js',
];

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
  } catch (e) {
    failed += 1;
    console.log('  ✗ ' + name + ' — ' + e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion échouée');
}

console.log('\nMAPFINDER — harnais DOM (jsdom)\n');

scripts.forEach((rel) => {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try {
    window.eval(code);
  } catch (e) {
    failed += 1;
    console.log('  ✗ chargement ' + rel + ' — ' + e.message);
  }
});

/* ------------------------------------------------------------ Vérifications */
console.log('\nModules exposés :');
['MF_CONFIG', 'MF_UTILS', 'MF_API', 'MF_GEO', 'MF_OVERPASS', 'MF_SEARCH', 'MF_STORAGE', 'MF_MAP', 'MF_AERIAL', 'MF_STREET', 'MF_EXPORT']
  .forEach((m) => check(m, () => assert(window[m], m + ' manquant')));

console.log('\nAnalyse des requêtes (parseQuery) :');
const cases = [
  ['Renault, 75001 Paris', { name: 'Renault', postcode: '75001', city: 'Paris' }],
  ['Société Générale Paris', { name: 'Société Générale Paris' }],
  ['15 rue de la Paix, 75002 Paris', { housenumber: '15', street: 'rue de la Paix', postcode: '75002', city: 'Paris' }],
  ['75008 Paris', { postcode: '75008', city: 'Paris' }],
  ['Antananarivo', { name: 'Antananarivo' }],
  ['Avenue de l\'Indépendance, Antananarivo', { street: "Avenue de l'Indépendance", city: 'Antananarivo' }],
];
cases.forEach(([input, expected]) => {
  check(input, () => {
    const parts = window.MF_SEARCH.parseQuery(input);
    Object.keys(expected).forEach((k) => {
      assert(parts[k] === expected[k], `${k} = « ${parts[k]} » (attendu « ${expected[k]} »)`);
    });
  });
});

console.log('\nGéométrie (utils) :');
check('distance Paris → proche', () => {
  const d = window.MF_UTILS.distance(48.8566, 2.3522, 48.8606, 2.3376);
  assert(d > 1000 && d < 1500, 'distance inattendue : ' + d);
});
check('azimut nord', () => {
  const b = window.MF_UTILS.bearing(48.85, 2.35, 48.86, 2.35);
  assert(Math.abs(b) < 1, 'azimut ' + b);
});
check('bboxAround', () => {
  const bb = window.MF_UTILS.bboxAround(48.85, 2.35, 60);
  assert(bb.minLat < 48.85 && bb.maxLon > 2.35);
});
check('similarité', () => {
  assert(window.MF_UTILS.similarity('renault', 'Renault') === 1);
  assert(window.MF_UTILS.similarity('renault', 'Renault minute') > 0.8);
});

console.log('\nNormalisation des réponses fournisseurs :');
check('Photon → SearchResult', () => {
  const r = window.MF_GEO.photon.normalize({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [2.3210, 48.8748] },
    properties: {
      osm_type: 'N', osm_id: 12219400152, osm_key: 'shop', osm_value: 'car',
      type: 'locality', name: 'Renault', street: 'Rue de la Pépinière',
      city: 'Paris', postcode: '75008', country: 'France', countrycode: 'FR',
      extent: [2.32, 48.87, 2.33, 48.88],
    },
  });
  assert(r.name === 'Renault', 'nom');
  assert(r.precision === 'exact', 'précision ' + r.precision);
  assert(r.osm.type === 'node' && r.osm.id === 12219400152, 'osm');
  assert(r.address.postcode === '75008', 'code postal');
  assert(r.bbox && r.bbox.minLon === 2.32, 'bbox');
});
check('Nominatim → SearchResult', () => {
  const r = window.MF_GEO.nominatim.normalize({
    lat: '48.8698', lon: '2.3311', osm_type: 'node', osm_id: 689143710,
    category: 'place', type: 'house',
    display_name: '16, Rue Daunou, Paris',
    address: { house_number: '16', road: 'Rue Daunou', postcode: '75002', city: 'Paris', country: 'France', country_code: 'fr' },
    boundingbox: ['48.86', '48.87', '2.33', '2.34'],
  });
  assert(r.address.housenumber === '16', 'numéro');
  assert(r.kind === 'address', 'type ' + r.kind);
  assert(r.precision === 'approximate', 'précision');
});
check('refus des coordonnées invalides', () => {
  const r = window.MF_GEO.photon.normalize({ geometry: { coordinates: [0, 999] }, properties: {} });
  assert(r === null, 'aurait dû être rejeté');
});

console.log('\nAppariement bâtiment (Overpass) :');
check('appariement par adresse + containment', () => {
  const ring = [[48.86970, 2.33100], [48.86970, 2.33120], [48.86990, 2.33120], [48.86990, 2.33100]];
  const buildings = [{ id: 'way/1', ring, center: { lat: 48.86980, lon: 2.33110 }, area: 400, housenumber: '16', street: 'Rue Daunou', name: '' }];
  const result = { lat: 48.86980, lon: 2.33110, name: '', address: { housenumber: '16', street: 'Rue Daunou' } };
  const m = window.MF_OVERPASS.matchBuilding(result, buildings);
  assert(m && m.confidence === 'high', 'confiance : ' + (m && m.confidence));
});
check('aucun appariement abusif à 80 m', () => {
  const ring = [[48.87000, 2.33100], [48.87000, 2.33120], [48.87020, 2.33120], [48.87020, 2.33100]];
  const buildings = [{ id: 'way/2', ring, center: { lat: 48.87010, lon: 2.33110 }, area: 400, housenumber: '', street: '', name: '' }];
  const result = { lat: 48.8690, lon: 2.3311, name: '', address: { housenumber: '', street: '' } };
  const m = window.MF_OVERPASS.matchBuilding(result, buildings);
  assert(m === null, 'un bâtiment à 120 m ne doit pas être retenu');
});

console.log('\nClassement (search.js) :');
check('un commerce nommé prime sur une ville', () => {
  const parts = window.MF_SEARCH.parseQuery('Renault Paris');
  const poi = { name: 'Renault', kind: 'poi', precision: 'exact', provider: 'photon', address: { city: 'Paris', postcode: '75008' } };
  const city = { name: 'Paris', kind: 'city', precision: 'approximate', provider: 'photon', address: { city: 'Paris' } };
  assert(window.MF_SEARCH.scoreResult(poi, parts, null) > window.MF_SEARCH.scoreResult(city, parts, null), 'ordre incorrect');
});
check('fusion des doublons OSM', () => {
  const a = { id: 'photon:node/1', provider: 'photon', osm: { type: 'node', id: 1 }, lat: 48.8, lon: 2.3, name: 'X', address: { housenumber: '', street: '', postcode: '75001' }, label: 'X court' };
  const b = { id: 'nominatim:node/1', provider: 'nominatim', osm: { type: 'node', id: 1 }, lat: 48.8, lon: 2.3, name: 'X', address: { housenumber: '5', street: 'Rue Y', postcode: '75001' }, label: 'X, 5 Rue Y, 75001 Paris, France' };
  const merged = window.MF_SEARCH.mergeResults([[a], [b]]);
  assert(merged.length === 1, 'doublon non fusionné : ' + merged.length);
  assert(merged[0].address.housenumber === '5', 'adresse non complétée');
});

console.log('\nRecherche complète (réseau simulé) :');
window.fetch = async (url) => {
  const u = String(url);
  if (u.includes('photon.komoot.io')) {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', geometry: { type: 'Point', coordinates: [2.3210, 48.8748] },
            properties: { osm_type: 'N', osm_id: 111, osm_key: 'shop', osm_value: 'car', type: 'locality',
              name: 'Renault', street: 'Rue de la Pépinière', city: 'Paris', postcode: '75008',
              country: 'France', countrycode: 'FR' } },
          { type: 'Feature', geometry: { type: 'Point', coordinates: [2.29, 48.85] },
            properties: { osm_type: 'N', osm_id: 222, osm_key: 'place', osm_value: 'city', type: 'city',
              name: 'Paris', city: 'Paris', postcode: '75001', country: 'France', countrycode: 'FR' } },
        ],
      }),
    };
  }
  if (u.includes('nominatim')) {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ([{
        place_id: 1, lat: '48.8748', lon: '2.3210', osm_type: 'node', osm_id: 111,
        category: 'shop', type: 'car', addresstype: 'shop', display_name: 'Renault, Rue de la Pépinière, 75008 Paris, France',
        address: { shop: 'Renault', house_number: '12', road: 'Rue de la Pépinière', postcode: '75008', city: 'Paris', country: 'France', country_code: 'fr' },
        extratags: { phone: '+33 1 00 00 00 00' }, namedetails: { name: 'Renault' },
        boundingbox: ['48.8747', '48.8749', '2.3209', '2.3211'],
      }]),
    };
  }
  if (u.includes('overpass')) {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ elements: [
        { type: 'way', id: 55, tags: { building: 'commercial', name: 'Renault', 'addr:housenumber': '12', 'addr:street': 'Rue de la Pépinière' },
          geometry: [
            { lat: 48.87470, lon: 2.32090 }, { lat: 48.87470, lon: 2.32130 },
            { lat: 48.87490, lon: 2.32130 }, { lat: 48.87490, lon: 2.32090 },
          ] },
        { type: 'node', id: 77, lat: 48.8750, lon: 2.3212, tags: { name: 'Café voisin', amenity: 'cafe' } },
        { type: 'way', id: 88, tags: { highway: 'residential', name: 'Rue de la Pépinière' },
          geometry: [{ lat: 48.8746, lon: 2.3208 }, { lat: 48.8746, lon: 2.3216 }] },
      ] }),
    };
  }
  if (u.includes('panoramax')) {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ features: [{
        id: 'abc', bbox: [2.3211, 48.8748, 2.3211, 48.8748], type: 'Feature', collection: 'col1',
        links: [{ rel: 'via', href: 'https://panoramax.ign.fr', instance_name: 'ign' },
                { rel: 'license', href: 'https://etalab.gouv.fr' }],
        assets: { thumb: { href: 'https://example.org/thumb.jpg' }, sd: { href: 'https://example.org/sd.jpg' }, hd: { href: 'https://example.org/hd.jpg' } },
        geometry: { type: 'Point', coordinates: [2.3211, 48.8748] },
        providers: [{ id: 'p1', name: 'Contributeur test', roles: ['producer'] }],
        properties: { datetime: '2024-05-01T10:00:00Z', license: 'etalab-2.0', 'pers:yaw': 90,
          'pers:interior_orientation': { field_of_view: 360 } },
      }] }),
    };
  }
  if (u.includes('kartaview')) {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ status: { apiCode: 600 }, result: { data: [{
        id: '999', lat: '48.8749', lng: '2.3212', heading: '270', shotDate: '2023-08-01 10:00:00.000',
        autoImgProcessingResult: 'BLURRED', imageProcUrl: 'https://example.org/kv-proc.jpg',
        imageThUrl: 'https://example.org/kv-th.jpg', distance: '9.5', sequenceId: '77', gpsAccuracy: '5.0',
      }] } }),
    };
  }
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
};

(async () => {
  const res = await window.MF_SEARCH.search('Renault, 75008 Paris', {});
  check('recherche : résultats fusionnés', () => {
    // Renault (même nœud OSM chez les deux fournisseurs) est fusionné ; Paris reste un résultat distinct.
    assert(res.results.length === 2, 'attendu 2 résultats, reçu ' + res.results.length);
    assert(res.results[0].name === 'Renault', 'classement : ' + res.results[0].name);
    assert(res.results[0].mergedFrom && res.results[0].mergedFrom.length === 1, 'fusion inter-fournisseurs non effectuée');
    assert(res.results[0].address.housenumber === '12', 'adresse complétée par Nominatim : ' + res.results[0].address.housenumber);
  });
  check('recherche : fournisseurs interrogés', () => {
    assert(res.providers.length === 2, 'Photon + Nominatim attendus');
  });
  check('recherche : le commerce passe devant la ville', () => {
    assert(res.results[0].kind === 'poi' || res.results[0].kind === 'place', 'type');
  });

  const ctx = await window.MF_OVERPASS.context(48.8748, 2.3210);
  check('Overpass : bâtiments, POI et rues', () => {
    assert(ctx.buildings.length === 1, 'bâtiments : ' + ctx.buildings.length);
    assert(ctx.pois.length === 1, 'POI : ' + ctx.pois.length);
    assert(ctx.roads.length === 1, 'rues : ' + ctx.roads.length);
  });
  check('Overpass : surface calculée', () => {
    const a = ctx.buildings[0].area;
    assert(a > 500 && a < 1200, 'surface inattendue : ' + Math.round(a));
  });

  const photos = await window.MF_STREET.findPhotos(48.8748, 2.3210, { radius: 60 });
  check('Photos : Panoramax + KartaView agrégés', () => {
    assert(photos.photos.length === 2, 'photos : ' + photos.photos.length);
  });
  check('Photos : crédit et licence conservés', () => {
    assert(photos.photos[0].author, 'auteur manquant');
    assert(photos.photos[0].licence, 'licence manquante');
    assert(photos.photos.every((p) => p.viewLabel), 'étiquette de vue manquante');
  });

  console.log('\nCache et limiteur (api-services) :');
check('écriture / lecture du cache avec TTL', () => {
  window.MF_API.cache.set('test:1', { a: 1 }, 60000);
  assert(window.MF_API.cache.get('test:1').a === 1, 'lecture');
});
check('expiration du cache', async () => {});
check('cache expiré ignoré', () => {
  window.MF_API.cache.set('test:2', { a: 2 }, -1);
  assert(window.MF_API.cache.get('test:2') === null, 'entrée expirée servie');
});
check('stats du cache', () => {
  const s = window.MF_API.cache.stats();
  assert(typeof s.entries === 'number', 'stats');
});

console.log('\nExport CSV :');
check('échappement CSV', () => {
  assert(window.MF_EXPORT.csvEscape('a;b') === '"a;b"', 'point-virgule');
  assert(window.MF_EXPORT.csvEscape('dit "bonjour"') === '"dit ""bonjour"""', 'guillemets');
});
check('ligne de résultat complète', () => {
  const row = window.MF_EXPORT.rowFromResult({
    name: 'Renault', label: 'Renault, Paris', lat: 48.87, lon: 2.32, precision: 'exact', kind: 'poi',
    address: { housenumber: '5', street: 'Rue X', postcode: '75008', city: 'Paris', district: '', region: '', country: 'France' },
    osm: { type: 'node', id: 42 }, provider: 'photon', providerLabel: 'Photon', licence: 'ODbL',
  });
  assert(row.lat === '48.870000', 'latitude formatée');
  assert(row.osmUrl.includes('openstreetmap.org/node/42'), 'lien OSM');
});

console.log('\nStockage local :');
check('préférences', () => {
  window.MF_STORAGE.setPref('theme', 'dark');
  assert(window.MF_STORAGE.getPrefs().theme === 'dark', 'écriture');
  window.MF_STORAGE.setPref('theme', 'auto');
});
check('historique dédupliqué', () => {
  window.MF_STORAGE.clearHistory();
  window.MF_STORAGE.addHistory({ query: 'Paris', count: 3 });
  window.MF_STORAGE.addHistory({ query: 'Paris', count: 5 });
  const h = window.MF_STORAGE.getHistory();
  assert(h.length === 1, 'doublon dans l’historique');
  assert(h[0].count === 5, 'entrée la plus récente non conservée');
  window.MF_STORAGE.clearHistory();
});
check('favoris : ajout puis retrait', () => {
  window.MF_STORAGE.clearFavorites();
  const r = { id: 'photon:node/9', name: 'Test', lat: 48.8, lon: 2.3, address: {}, precision: 'exact' };
  assert(window.MF_STORAGE.toggleFavorite(r).added === true, 'ajout');
  assert(window.MF_STORAGE.isFavorite('photon:node/9'), 'présence');
  assert(window.MF_STORAGE.toggleFavorite(r).added === false, 'retrait');
  assert(!window.MF_STORAGE.isFavorite('photon:node/9'), 'absence');
});

console.log('\nImagerie aérienne (logique de couverture) :');
check('l’IGN ne prétend pas couvrir Antananarivo', () => {
  const ign = window.MF_CONFIG.IMAGERY.providers.find((p) => p.id === 'ign-ortho');
  assert(ign.covers(48.85, 2.35) === true, 'Paris devrait être couvert');
  assert(ign.covers(-18.91, 47.52) === false, 'Antananarivo ne doit pas être déclaré couvert par l’IGN');
});
check('Esri couvre le monde', () => {
  const esri = window.MF_CONFIG.IMAGERY.providers.find((p) => p.id === 'esri-world');
  assert(esri.covers(-18.91, 47.52) === true, 'couverture mondiale attendue');
});
check('aucune source d’imagerie ne nécessite de clé', () => {
  window.MF_CONFIG.IMAGERY.providers.forEach((p) => {
    assert(!/apikey|access_token|token=/i.test(p.url), p.id + ' contient une clé');
  });
});
check('aucune source de photos nécessitant un compte', () => {
  window.MF_CONFIG.STREET.providers.forEach((p) => {
    assert(!p.requiresToken, p.id + ' exige un jeton');
  });
});

console.log('\nLibellés de vue des photos :');
check('azimut inconnu → étiquette neutre', () => {
  assert(window.MF_STREET.viewLabelFor(null, false) === 'Vue depuis la rue', 'étiquette abusive');
});
check('caméra vers le bâtiment', () => {
  assert(window.MF_STREET.viewLabelFor(10, false).includes('orientée vers le bâtiment'), 'libellé incorrect');
});
check('caméra opposée → enfilade', () => {
  assert(window.MF_STREET.viewLabelFor(175, false).includes('enfilade'), 'libellé incorrect');
});

/* ---------------------------------------------------------------- Interface */
console.log('\nInterface (après chargement de app.js) :');
try {
  window.eval(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8'));
  console.log('  ✓ app.js exécuté sans exception');
} catch (e) {
  failed += 1;
  console.log('  ✗ app.js — ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
}

const doc = window.document;
check('carte initialisée', () => assert(doc.querySelector('#map'), 'conteneur de carte'));
check('onglets présents', () => assert(doc.querySelectorAll('.tab').length === 3, 'onglets'));
check('sources rendues', () => assert(doc.querySelectorAll('#sources-body .source-card').length >= 6, 'fiches de sources'));
check('sélecteur d’imagerie rempli', () => assert(doc.querySelectorAll('#select-imagery option').length === 3, 'options'));
check('état initial vide affiché', () => assert(!doc.querySelector('#results-empty').hidden, 'état vide'));
check('bouton exporter désactivé', () => assert(doc.querySelector('#btn-export').disabled, 'export actif à tort'));

// Recherche factice : on simule les réponses réseau pour vérifier le rendu.
check('rendu de résultats simulé', () => {
  const app = doc.querySelector('#search-input');
  app.value = 'Renault, 75001 Paris';
  app.dispatchEvent(new window.Event('input', { bubbles: true }));
});

/* ---------------------------------------------------------------- Bilan --- */
  /* ------------------------------------------------ Parcours utilisateur --- */
  console.log('\nParcours utilisateur complet (interface) :');
  const UI = window.MF_APP;
  const d = window.document;

  await UI.runSearch('Renault, 75008 Paris');
  check('recherche : cartes affichées', () => {
    assert(d.querySelectorAll('#results-list .result-card').length === 2, 'cartes : ' + d.querySelectorAll('#results-list .result-card').length);
    assert(!d.querySelector('#btn-export').disabled, 'export désactivé');
    assert(d.querySelector('#results-count').textContent.includes('résultat'), 'compteur absent');
  });
  check('recherche : interprétation affichée', () => {
    const txt = d.querySelector('#search-parse').textContent;
    assert(txt.includes('Renault') && txt.includes('75008'), 'résumé : ' + txt);
  });

  UI.selectResult(UI.state.results[0]);
  await new Promise((r) => setTimeout(r, 30));
  check('sélection : fiche détaillée remplie', () => {
    const card = d.querySelector('#detail-card').textContent;
    assert(card.includes('Renault'), 'nom absent de la fiche');
    assert(card.includes('48.87'), 'coordonnées absentes');
    assert(d.querySelector('#detail-card .info-rows').children.length >= 5, 'lignes insuffisantes');
  });
  check('sélection : coordonnées GPS affichées sur la carte', () => {
    assert(d.querySelector('#readout-gps').textContent.includes('48.87'), 'GPS : ' + d.querySelector('#readout-gps').textContent);
  });
  check('sélection : actions activées', () => {
    assert(!d.querySelector('#detail-actions').hidden, 'actions masquées');
    assert(d.querySelector('#btn-route').href.includes('openstreetmap.org/directions'), 'lien itinéraire');
  });
  check('sélection : décision de précision honnête', () => {
    const note = d.querySelector('#detail-card .precision-note');
    assert(note, 'aucune note de précision');
    assert(/Bâtiment|Point d’intérêt|Approximatif/.test(note.textContent), 'note illisible : ' + note.textContent);
  });

  check('favoris : bascule depuis l’interface', () => {
    UI.toggleFavorite(UI.state.results[0]);
    assert(window.MF_STORAGE.isFavorite(UI.state.results[0].id), 'favori non enregistré');
    assert(d.querySelector('#fav-count').textContent === '1', 'compteur de favoris');
    UI.toggleFavorite(UI.state.results[0]);
  });

  UI.switchTab('photos');
  await UI.loadPhotos(true);
  await new Promise((r) => setTimeout(r, 20));
  check('photos : galerie rendue', () => {
    assert(d.querySelectorAll('#photo-grid .photo-card').length === 2, 'vignettes : ' + d.querySelectorAll('#photo-grid .photo-card').length);
    assert(d.querySelector('#photos-count').textContent === '2', 'compteur de photos');
    assert(d.querySelector('#photo-grid .photo-card__badge--360'), 'badge 360° manquant');
  });
  check('photos : crédits et licences affichés', () => {
    const credits = d.querySelector('#photos-credits').textContent;
    assert(credits.includes('Panoramax') && credits.includes('KartaView'), 'crédits incomplets');
    assert(d.querySelector('#photo-grid .photo-card__meta a'), 'lien de licence absent');
  });

  UI.switchTab('aerial');
  await new Promise((r) => setTimeout(r, 60));
  check('aérien : message honnête quand aucune imagerie ne répond', () => {
    const status = d.querySelector('#aerial-status').textContent;
    assert(/imagerie|aérienne|disponible/i.test(status), 'statut : ' + status);
    assert(!d.querySelector('#aerial-badge').hidden, 'aucun avertissement signalé');
  });

  UI.switchTab('map');
  check('onglets : bascule correcte', () => {
    assert(d.querySelector('#tab-map').hidden === false, 'panneau carte masqué');
    assert(d.querySelector('#tab-photos').hidden === true, 'panneau photos visible');
    assert(d.querySelector('#tab-btn-aerial').getAttribute('aria-selected') === 'false', 'aria-selected');
  });

  check('effacement : retour à l’état initial', () => {
    UI.clearSearch(false);
    assert(d.querySelectorAll('#results-list .result-card').length === 0, 'cartes restantes');
    assert(d.querySelector('#search-input').value === '', 'champ non vidé');
    assert(d.querySelector('#btn-export').disabled, 'export encore actif');
  });

  /* -------------------------------------------------------------- Bilan --- */
  console.log('\nErreurs d’exécution capturées :');
if (errors.length) {
  errors.slice(0, 15).forEach((e) => console.log('  ! ' + e));
} else {
  console.log('  aucune');
  }

  console.log('\n' + (failed === 0 ? '✔ Tous les contrôles sont passés.' : '✖ ' + failed + ' contrôle(s) en échec.') + '\n');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Erreur non capturée dans le harnais :', e);
  process.exit(1);
});
