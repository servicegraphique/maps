/**
 * MAPFINDER — test/url-probe.js
 * Affiche les URL exactes que l'application construit pour chaque service.
 * Ces URL sont ensuite interrogées telles quelles pour vérifier qu'elles
 * renvoient bien des données (voir docs/TESTS.md).
 *
 * Usage : node test/url-probe.js [--json]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:8000/', runScripts: 'outside-only',
});
const { window } = dom;

['config/services.js', 'js/utils.js', 'js/api-services.js', 'js/geocoding.js', 'js/overpass.js',
 'js/search.js', 'js/street-images.js', 'js/satellite.js']
  .forEach((f) => window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8')));

const U = window.MF_UTILS;
const CFG = window.MF_CONFIG;

// On intercepte fetch pour capturer les URL au lieu de les appeler.
const captured = [];
window.fetch = (url) => {
  captured.push(String(url));
  return Promise.reject(new Error('probe'));
};

const CASES = [
  { label: 'Entreprise + code postal', q: 'Renault, 75001 Paris', lat: 48.8698, lon: 2.3311 },
  { label: 'Adresse complète', q: '15 rue de la Paix, 75002 Paris', lat: 48.8698, lon: 2.3311 },
  { label: 'Code postal + ville', q: '75008 Paris', lat: 48.8698, lon: 2.3311 },
  { label: 'Rue seule', q: 'Avenue de l’Indépendance, Antananarivo', lat: -18.9137, lon: 47.5210 },
  { label: 'Maison à Antananarivo', q: 'Antananarivo', lat: -18.9137, lon: 47.5210 },
];

(async () => {
  const out = [];
  for (const c of CASES) {
    captured.length = 0;
    const parts = window.MF_SEARCH.parseQuery(c.q);
    await window.MF_SEARCH.search(c.q, { center: { lat: c.lat, lon: c.lon } }).catch(() => {});
    const result = { label: c.label, query: c.q, parts, urls: captured.slice() };

    // Contexte Overpass + photos autour du point de référence
    captured.length = 0;
    await window.MF_OVERPASS.context(c.lat, c.lon).catch(() => {});
    result.overpass = captured.slice();

    captured.length = 0;
    await window.MF_STREET.findPhotos(c.lat, c.lon, { radius: 60 }).catch(() => {});
    result.photos = captured.slice();

    out.push(result);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  out.forEach((r) => {
    console.log('\n──────────────────────────────────────────────────────────────');
    console.log('CAS : ' + r.label + '   (« ' + r.query + ' »)');
    console.log('Interprétation : nom=' + (r.parts.name || '—') + ' | rue=' + (r.parts.street || '—')
      + ' | n°=' + (r.parts.housenumber || '—') + ' | CP=' + (r.parts.postcode || '—') + ' | ville=' + (r.parts.city || '—'));
    r.urls.forEach((u) => console.log('  GÉOCODAGE : ' + u));
    r.overpass.forEach((u) => console.log('  OVERPASS  : ' + u.slice(0, 260) + (u.length > 260 ? '…' : '')));
    r.photos.forEach((u) => console.log('  PHOTOS    : ' + u));
  });

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('IMAGERIE AÉRIENNE — tuiles de test (z=17)');
  CFG.IMAGERY.providers.filter((p) => !p.optional).forEach((p) => {
    [[48.8698, 2.3311], [-18.9137, 47.5210]].forEach(([lat, lon]) => {
      const z = 17;
      const x = window.MF_AERIAL.lonToTileX(lon, z);
      const y = window.MF_AERIAL.latToTileY(lat, z);
      const url = window.MF_AERIAL.tileUrl(p, z, x, y);
      const covered = p.covers ? p.covers(lat, lon) : true;
      console.log(`  ${p.id.padEnd(18)} ${covered ? 'couvert  ' : 'hors zone'} ${lat},${lon}  ${url}`);
    });
  });
  console.log('');
})();
