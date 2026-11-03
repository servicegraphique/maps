/* ============================================================================
 * MAPFINDER — js/export.js
 * Export CSV, copie vers le presse-papier, liens externes, partage.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const U = global.MF_UTILS;

  const CSV_COLUMNS = [
    { key: 'name', label: 'Nom' },
    { key: 'label', label: 'Libellé complet' },
    { key: 'housenumber', label: 'Numéro' },
    { key: 'street', label: 'Rue' },
    { key: 'postcode', label: 'Code postal' },
    { key: 'city', label: 'Ville' },
    { key: 'district', label: 'Quartier' },
    { key: 'region', label: 'Région' },
    { key: 'country', label: 'Pays' },
    { key: 'lat', label: 'Latitude' },
    { key: 'lon', label: 'Longitude' },
    { key: 'precision', label: 'Précision' },
    { key: 'kind', label: 'Type de lieu' },
    { key: 'type', label: 'Type OSM' },
    { key: 'osmId', label: 'Identifiant OSM' },
    { key: 'osmUrl', label: 'Lien OSM' },
    { key: 'provider', label: 'Source' },
    { key: 'licence', label: 'Licence' },
  ];

  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function rowFromResult(r) {
    return {
      name: r.name,
      label: r.label || U.formatAddress(r.address),
      housenumber: r.address.housenumber,
      street: r.address.street,
      postcode: r.address.postcode,
      city: r.address.city,
      district: r.address.district,
      region: r.address.region,
      country: r.address.country,
      lat: Number(r.lat).toFixed(6),
      lon: Number(r.lon).toFixed(6),
      precision: r.precision,
      kind: r.kind,
      type: r.osm && r.osm.type ? r.osm.type : '',
      osmId: r.osm && r.osm.id ? r.osm.id : '',
      osmUrl: r.osm && r.osm.id ? CFG.EXTERNAL.osmEdit(r.osm.type, r.osm.id) : '',
      provider: r.providerLabel || r.provider,
      licence: r.licence,
    };
  }

  /**
   * Export CSV (UTF-8 + BOM pour Excel français, séparateur point-virgule).
   * @param {Array} results
   * @param {object} meta { query, extraRows }
   */
  function exportCSV(results, meta) {
    const m = meta || {};
    const lines = [];
    lines.push('# MAPFINDER — export de résultats');
    if (m.query) lines.push(`# Recherche : ${m.query}`);
    lines.push(`# Date : ${new Date().toLocaleString('fr-FR')}`);
    lines.push(`# Source : OpenStreetMap (ODbL), Photon, Nominatim, Overpass`);
    lines.push('');
    lines.push(CSV_COLUMNS.map((c) => csvEscape(c.label)).join(';'));
    results.forEach((r) => {
      const row = rowFromResult(r);
      lines.push(CSV_COLUMNS.map((c) => csvEscape(row[c.key])).join(';'));
    });

    if (m.extraRows && m.extraRows.length) {
      lines.push('');
      lines.push(CSV_COLUMNS.map((c) => csvEscape(c.label)).join(';'));
      m.extraRows.forEach((r) => {
        lines.push(CSV_COLUMNS.map((c) => csvEscape(r[c.key])).join(';'));
      });
    }

    const csv = '\uFEFF' + lines.join('\r\n');
    const stamp = new Date().toISOString().slice(0, 10);
    const safe = U.normalize(m.query || 'resultats').replace(/\s+/g, '-').slice(0, 40) || 'resultats';
    U.downloadFile(`mapfinder-${safe}-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    return csv;
  }

  function exportJSON(results, meta) {
    const payload = Object.assign({
      app: CFG.APP.name,
      version: CFG.APP.version,
      exportedAt: new Date().toISOString(),
      results,
    }, meta || {});
    U.downloadFile(`mapfinder-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2), 'application/json');
  }

  /* ------------------------------------------------------------- Liens --- */
  function linksFor(result) {
    const out = [];
    out.push({ id: 'osm', label: 'Ouvrir dans OpenStreetMap', url: CFG.EXTERNAL.osm(result.lat, result.lon, 19) });
    out.push({ id: 'route', label: 'Calculer un itinéraire', url: CFG.EXTERNAL.osmDirections(result.lat, result.lon) });
    if (result.osm && result.osm.id && result.osm.type) {
      out.push({ id: 'object', label: 'Fiche OpenStreetMap de l’objet', url: CFG.EXTERNAL.osmEdit(result.osm.type, result.osm.id) });
    }
    return out;
  }

  function shareUrl(result) {
    const base = location.origin + location.pathname;
    if (!result) {
      const q = document.getElementById('search-input');
      return base + '#q=' + encodeURIComponent(q ? q.value : '');
    }
    return `${base}#lat=${Number(result.lat).toFixed(6)}&lon=${Number(result.lon).toFixed(6)}`
      + `&q=${encodeURIComponent(result.name || result.label || '')}`;
  }

  function readHash() {
    const hash = String(location.hash || '').replace(/^#/, '');
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    const q = params.get('q');
    const lat = params.get('lat');
    const lon = params.get('lon');
    if (!q && !lat) return null;
    return {
      q: q || '',
      lat: lat !== null && U.isValidLatLon(lat, lon) ? Number(lat) : null,
      lon: lon !== null && U.isValidLatLon(lat, lon) ? Number(lon) : null,
    };
  }

  global.MF_EXPORT = { exportCSV, exportJSON, csvEscape, rowFromResult, linksFor, shareUrl, readHash, CSV_COLUMNS };
})(window);
