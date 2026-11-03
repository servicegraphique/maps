/* ============================================================================
 * MAPFINDER — js/search.js
 * Moteur de recherche : analyse de la requête, orchestration des fournisseurs,
 * fusion et classement des résultats, suggestions d'autocomplétion.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const GEO = global.MF_GEO;
  const API = global.MF_API;
  const U = global.MF_UTILS;

  /* --------------------------------------------------- Analyse requête --- */
  /**
   * Décompose "Renault, 75001 Paris" ou "15 rue de la Paix, 75002 Paris"
   * en { name, housenumber, street, postcode, city, freeText }.
   * Heuristique volontairement lisible : français + adresses internationales simples.
   */
  function parseQuery(input) {
    const raw = String(input || '').trim();
    const out = { raw, name: '', housenumber: '', street: '', postcode: '', city: '', country: '', countryCode: '', freeText: '' };
    if (!raw) return out;

    let work = raw.replace(/\s+/g, ' ');
    // Code postal français (5 chiffres) ou générique 4 à 6 chiffres
    const cpMatch = work.match(/\b(\d{5})\b/);
    if (cpMatch) {
      out.postcode = cpMatch[1];
      work = work.replace(cpMatch[0], ' ');
    }

    const segments = work.split(',').map((s) => s.trim()).filter(Boolean);

    // Numéro de rue en tête de segment
    const streetRe = /^(\d{1,4})\s*(bis|ter|quater)?\s+(.+)$/i;
    // Mots-clés de voirie : permettent de reconnaître « Rue de la Paix » sans numéro
    const STREET_WORDS = /^(rue|avenue|av\.?|boulevard|bd|place|impasse|chemin|route|allée|allee|quai|cours|square|villa|lotissement|résidence|residence|passage|rond-point|montée|montee|voie|traverse|esplanade|promenade)\b/i;
    let nameParts = [];

    segments.forEach((seg, index) => {
      const m = seg.match(streetRe);
      if (m && !out.street && !/\b(cedex)\b/i.test(seg)) {
        out.housenumber = m[1] + (m[2] ? ' ' + m[2].toLowerCase() : '');
        out.street = m[3].trim();
        return;
      }
      if ((STREET_WORDS).test(seg) && !out.street) {
        out.street = seg;
        return;
      }
      if (segments.length === 1) {
        // Un seul segment : décidé plus bas (nom, ville ou rue)
        nameParts.push(seg);
        return;
      }
      if (index === 0) {
        nameParts.push(seg);
      } else if (!out.city && /^[\p{L}\-'’\s.]+$/u.test(seg) && seg.length > 1) {
        out.city = seg;
      } else {
        nameParts.push(seg);
      }
    });

    // Si un seul segment : c'est soit un nom, soit une ville, soit une rue
    if (segments.length === 1) {
      const single = segments[0];
      if (out.street) {
        out.city = ''; // "15 rue de la Paix" sans ville
      } else if (out.postcode) {
        // "75008 Paris" -> code postal + ville, pas un nom d'entreprise
        out.city = single.replace(/\d{5}/, '').trim();
      } else {
        out.name = single;
      }
    } else {
      out.name = nameParts.join(', ').trim();
    }

    // Nettoyage : un "name" identique à la ville n'en est pas un
    if (out.name && out.city && U.normalize(out.name) === U.normalize(out.city)) out.name = '';
    if (!out.name && !out.street && !out.postcode && !out.city) out.freeText = raw;

    return out;
  }

  /** Résumé lisible de l'interprétation, affiché sous la barre de recherche. */
  function describeQuery(parts) {
    const bits = [];
    if (parts.name) bits.push(`nom « ${parts.name} »`);
    if (parts.housenumber || parts.street) bits.push(`adresse « ${[parts.housenumber, parts.street].filter(Boolean).join(' ')} »`);
    if (!parts.street && parts.postcode) bits.push(`code postal ${parts.postcode}`);
    if (parts.street && parts.postcode) bits.push(`code postal ${parts.postcode}`);
    if (parts.city) bits.push(`ville « ${parts.city} »`);
    return bits.length ? bits.join(' + ') : 'recherche libre';
  }

  /* -------------------------------------------------------- Classement --- */
  function scoreResult(result, parts, center) {
    let score = 0;
    const nameQ = U.normalize(parts.name);
    const streetQ = U.normalize(parts.street);
    const cityQ = U.normalize(parts.city);
    const cpQ = parts.postcode;

    if (nameQ) {
      const sim = U.similarity(nameQ, result.name || '');
      score += sim * 45;
      if (sim > 0.95) score += 15;
      // Un nom demandé mais absent du résultat : pénalité forte
      if (sim < 0.4) score -= 20;
    }

    if (streetQ) {
      const sim = U.similarity(streetQ, result.address.street || '');
      score += sim * 30;
      if (sim < 0.4) score -= 12;
    }
    if (parts.housenumber) {
      if (result.address.housenumber === parts.housenumber) score += 12;
      else if (result.address.housenumber) score += 3;
      else score -= 4;
    }
    if (cpQ) {
      if (result.address.postcode === cpQ) score += 22;
      else if (result.address.postcode) score -= 10;
    }
    if (cityQ) {
      const cities = [result.address.city, result.address.district].map(U.normalize);
      if (cities.some((c) => c && c === cityQ)) score += 18;
      else if (cities.some((c) => c && (c.includes(cityQ) || cityQ.includes(c)))) score += 10;
      else score -= 8;
    }

    // Nature du lieu : un bâtiment/commerce vaut mieux qu'une ville ou une route
    const kindBonus = {
      poi: 12, building: 14, address: 10, house: 9,
      road: 2, street: 2, city: -6, town: -6, village: -5, state: -12, country: -20, place: 0,
    };
    score += kindBonus[result.kind] !== undefined ? kindBonus[result.kind] : 0;

    // Priorité de fusion entre fournisseurs (Photon = 1)
    const cfg = CFG.GEOCODERS[result.provider];
    if (cfg) score *= cfg.weight || 1;

    // Proximité d'un centre de carte déjà connu (si l'utilisateur a déplacé la carte)
    if (center && center.lat && center.lon) {
      const d = U.distance(center.lat, center.lon, result.lat, result.lon);
      if (d < 50000) score += Math.max(0, 10 - d / 5000);
    }

    // Un point d'intérêt nommé prime sur une adresse générique à pertinence égale
    if (result.precision === 'exact') score += 2;
    if (result.precision === 'centroid') score += 3;

    return score;
  }

  /** Fusionne les doublons entre fournisseurs (même objet OSM ou coordonnées très proches). */
  function mergeResults(lists) {
    const out = [];
    const seenOsm = new Map();
    const seenGeo = [];

    lists.flat().filter(Boolean).forEach((r) => {
      const osmKey = r.osm && r.osm.type && r.osm.id ? `${r.osm.type}/${r.osm.id}` : null;
      if (osmKey && seenOsm.has(osmKey)) {
        const existing = seenOsm.get(osmKey);
        // On garde le premier (Photon prioritaire) mais on complète l'adresse manquante
        ['housenumber', 'street', 'postcode', 'city', 'district', 'region'].forEach((k) => {
          if (!existing.address[k] && r.address[k]) existing.address[k] = r.address[k];
        });
        if (!existing.label || existing.label.length < r.label.length) existing.label = r.label;
        existing.mergedFrom = existing.mergedFrom || [];
        existing.mergedFrom.push(r.provider);
        return;
      }
      const dup = seenGeo.find((g) => U.distance(g.lat, g.lon, r.lat, r.lon) < 6
        && U.normalize(g.name) === U.normalize(r.name) && g.name);
      if (dup) return;

      if (osmKey) seenOsm.set(osmKey, r);
      seenGeo.push(r);
      out.push(r);
    });
    return out;
  }

  /* ------------------------------------------------------ Orchestration --- */
  /**
   * Recherche complète.
   * @param {string} query
   * @param {object} opts { center, refresh, signal, onProviderState }
   * @returns {Promise<{parts, results, providers, errors, partial}>}
   */
  async function search(query, opts) {
    const o = opts || {};
    const parts = parseQuery(query);
    if (!parts.name && !parts.street && !parts.postcode && !parts.city && !parts.freeText) {
      return { parts, results: [], providers: [], errors: [], partial: false };
    }

    // Nominatim n'est appelé que si l'utilisateur l'a laissé activé (Paramètres).
    const prefs = global.MF_STORAGE ? global.MF_STORAGE.getPrefs() : { nominatimEnabled: true };
    const tasks = [
      GEO.photon.search(parts, { center: o.center, limit: 12, signal: o.signal })
        .then((r) => ({ provider: 'photon', results: r }))
        .catch((e) => ({ provider: 'photon', error: e })),
    ];
    if (prefs.nominatimEnabled !== false) {
      tasks.push(
        GEO.nominatim.search(parts, { limit: 12, signal: o.signal })
          .then((r) => ({ provider: 'nominatim', results: r }))
          .catch((e) => ({ provider: 'nominatim', error: e }))
      );
    }

    const settled = await Promise.all(tasks);
    const providers = settled.map((s) => ({ provider: s.provider, count: s.results ? s.results.length : 0, error: s.error || null }));
    const errors = settled.filter((s) => s.error).map((s) => ({ provider: s.provider, error: s.error }));

    // Si Nominatim échoue à cause du débit (429), on ne bloque pas : Photon suffit.
    let merged = mergeResults(settled.map((s) => s.results || []));

    // Déduplication des résultats quasi identiques entre fournisseurs
    merged.forEach((r) => {
      let score = scoreResult(r, parts, o.center);
      // Pénalité si la recherche porte sur un nom et que le résultat n'en a aucun
      if (parts.name && !r.name) score -= 15;
      // Un résultat hors du pays demandé (code postal présent) est suspect
      if (parts.postcode && r.address.postcode && r.address.postcode !== parts.postcode) score -= 12;
      r._score = score;
    });

    merged.sort((a, b) => b._score - a._score);
    const results = merged.filter((r) => r._score > -30).slice(0, 25);

    return {
      parts,
      results,
      providers,
      errors,
      partial: errors.length > 0,
      query,
      at: Date.now(),
    };
  }

  /* ------------------------------------------------------- Suggestions --- */
  /**
   * Autocomplétion : Photon uniquement (règle de politique Nominatim).
   * @param {string} query
   * @param {object} opts { lat, lon, signal }
   */
  async function suggest(query, opts) {
    const o = opts || {};
    const q = String(query || '').trim();
    if (q.length < 3) return [];
    try {
      const res = await GEO.photon.suggest(q, o);
      return res.slice(0, 8);
    } catch (e) {
      if (e && e.code === 'abort') return [];
      return [];
    }
  }

  global.MF_SEARCH = { search, suggest, parseQuery, describeQuery, scoreResult, mergeResults };
})(window);
