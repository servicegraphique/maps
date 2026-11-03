/**
 * MAPFINDER — test/dom-check.js
 * Cohérence du DOM statique : identifiants, labels, attributs ARIA, scripts,
 * feuilles de style. Détecte les erreurs de câblage entre index.html et les modules.
 *
 * Usage : node test/dom-check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); } catch (e) { failed += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log('\nMAPFINDER — cohérence du DOM\n');

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const idSet = new Set(ids);

check('aucun identifiant dupliqué', () => {
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  assert(dup.length === 0, dup.join(', '));
});

check('tous les identifiants demandés par app.js existent', () => {
  const cacheList = (app.match(/cacheDom\(\)\s*\{[\s\S]*?\]\.forEach/) || [''])[0];
  const requested = [...cacheList.matchAll(/'([a-zA-Z0-9\-]+)'/g)].map((m) => m[1]);
  const missing = requested.filter((id) => !idSet.has(id));
  assert(missing.length === 0, 'manquants : ' + missing.join(', '));
  assert(requested.length > 60, 'liste trop courte : ' + requested.length);
});

check('tous les getElementById d’app.js pointent vers un élément', () => {
  const used = [...new Set([...app.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
  const missing = used.filter((id) => !idSet.has(id));
  assert(missing.length === 0, 'manquants : ' + missing.join(', '));
});

check('attributs for= des labels valides', () => {
  const fors = [...html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]);
  const bad = fors.filter((f) => !idSet.has(f));
  assert(bad.length === 0, 'orphelins : ' + bad.join(', '));
});

check('attributs aria-controls / aria-labelledby valides', () => {
  const refs = [...html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/));
  const bad = refs.filter((r) => !idSet.has(r));
  assert(bad.length === 0, 'orphelins : ' + bad.join(', '));
});

check('tous les scripts référencés existent et sont dans l’ordre de dépendance', () => {
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  scripts.forEach((s) => assert(fs.existsSync(path.join(ROOT, s)), 'fichier absent : ' + s));
  const order = ['utils.js', 'api-services.js', 'geocoding.js', 'overpass.js', 'search.js',
    'storage.js', 'map.js', 'satellite.js', 'street-images.js', 'export.js', 'app.js'];
  const positions = order.map((n) => scripts.findIndex((s) => s.endsWith(n)));
  positions.forEach((p, i) => assert(p >= 0, 'script non chargé : ' + order[i]));
  for (let i = 1; i < positions.length; i++) {
    assert(positions[i] > positions[i - 1], 'ordre incorrect entre ' + order[i - 1] + ' et ' + order[i]);
  }
});

check('toutes les feuilles de style existent', () => {
  const links = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  links.forEach((l) => assert(fs.existsSync(path.join(ROOT, l)), 'fichier absent : ' + l));
  assert(links.length >= 5, 'feuilles manquantes');
});

check('toutes les images locales existent', () => {
  const imgs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  imgs.forEach((src) => assert(fs.existsSync(path.join(ROOT, src)), 'image absente : ' + src));
});

check('attribut lang et titre de page', () => {
  assert(/<html lang="fr"/.test(html), 'lang="fr" manquant');
  assert(/<title>[^<]*MAPFINDER/.test(html), 'titre manquant');
});

check('aucune dépendance externe (CDN) bloquante', () => {
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const blocking = external.filter((u) => /\.(js|css)(\?|$)/.test(u));
  assert(blocking.length === 0, 'ressources externes : ' + blocking.join(', '));
});

check('aucune clé d’API en dur dans le code', () => {
  const files = ['config/services.js', ...fs.readdirSync(path.join(ROOT, 'js')).map((f) => 'js/' + f)];
  files.forEach((f) => {
    const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const suspicious = code.match(/[?&](api_?key|apikey|access_token|token)=/i);
    assert(!suspicious, 'clé détectée dans ' + f);
  });
});

check('les trois onglets et leurs panneaux existent', () => {
  ['map', 'aerial', 'photos'].forEach((t) => {
    assert(idSet.has('tab-btn-' + t), 'onglet ' + t);
    assert(idSet.has('tab-' + t), 'panneau ' + t);
  });
});

check('pas de texte « vue satellite » trompeur dans l’interface', () => {
  const misleading = /(carte satellite|vue satellite garantie|photo officielle du bâtiment)/i.test(html);
  assert(!misleading, 'formulation trompeuse détectée');
});

console.log('\n' + (failed === 0 ? '✔ Cohérence du DOM vérifiée.' : '✖ ' + failed + ' contrôle(s) en échec.') + '\n');
process.exit(failed === 0 ? 0 : 1);
