/* ============================================================================
 * MAPFINDER — js/geocoding.js
 * Fournisseurs de géocodage : Photon (suggestions + recherche) et Nominatim
 * (recherche de validation uniquement — l'autocomplétion y est interdite).
 * Produit un modèle unique : SearchResult.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const API = global.MF_API;
  const U = global.MF_UTILS;

  /* Clés OSM considérées comme des points d'intérêt « posés » (position ponctuelle). */
  const POI_KEYS = new Set([
    'shop', 'amenity', 'office', 'tourism', 'leisure', 'craft', 'healthcare',
    'industrial', 'man_made', 'historic', 'club', 'emergency', 'military',
  ]);
  const PLACE_KINDS = new Set(['house', 'street', 'city', 'state', 'country', 'district', 'locality', 'county', 'region']);

  /* --------------------------------------------------------------- Modèle --- */
  function emptyAddress() {
    return {
      housenumber: '', street: '', postcode: '', city: '', district: '',
      region: '', country: '', countryCode: '',
    };
  }

  function makeId(provider, osm, lat, lon) {
    if (osm && osm.type && osm.id) return `${provider}:${osm.type}/${osm.id}`;
    return `${provider}:${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`;
  }

  /**
   * Détermine le niveau de précision réellement fourni par le géocodeur.
   * 'exact'       : nœud de point d'intérêt (commerces, sociétés…) — position ponctuelle posée à la main
   * 'approximate' : point d'adresse / interpolation / rue / ville
   * 'centroid'    : centre d'une emprise OSM (bâtiment) — affiné ensuite par Overpass
   */
  function classify(kind, addr, osm) {
    if (osm && osm.key === 'building' && (osm.type === 'way' || osm.type === 'relation')) {
      return { kind: 'building', precision: 'centroid' };
    }
    if (kind === 'poi') return { kind: 'poi', precision: 'exact' };
    if (kind === 'building') return { kind: 'building', precision: 'centroid' };
    if (kind === 'address') return { kind: 'address', precision: 'approximate' };
    return { kind: kind || 'place', precision: 'approximate' };
  }

  function precisionLabel(precision) {
    return {
      centroid: { label: 'Bâtiment', tone: 'ok', note: 'Emprise du bâtiment trouvée dans OpenStreetMap ; le marqueur est le centre du bâtiment.' },
      exact: { label: 'Point d’intérêt', tone: 'info', note: 'Position du point d’intérêt dans OpenStreetMap : elle peut désigner l’entrée plutôt que le centre du bâtiment.' },
      approximate: { label: 'Approximatif', tone: 'warn', note: 'Position approximative : OpenStreetMap ne fournit pas l’emprise de ce bâtiment. Le marqueur indique l’adresse ou le centre de la zone.' },
    }[precision] || { label: 'Non déterminée', tone: 'warn', note: 'Précision non communiquée par la source.' };
  }

  /* --------------------------------------------------------------- Photon --- */
  const photon = {
    id: 'photon',
    cfg: CFG.GEOCODERS.photon,

    /** Autocomplétion : autorisée par les conditions d'utilisation de Photon. */
    async suggest(query, opts) {
      const o = opts || {};
      const q = String(query || '').trim();
      if (q.length < 3) return [];
      const params = new URLSearchParams({
        q,
        limit: String(o.limit || 8),
        lang: 'fr',
      });
      if (o.lat && o.lon && o.bias !== false) {
        params.set('lat', String(o.lat));
        params.set('lon', String(o.lon));
      }
      const url = `${this.cfg.baseUrl}?${params.toString()}`;
      const data = await API.request(url, {
        service: 'photon', ttl: 10 * 60 * 1000, timeoutMs: 8000, retries: 1,
        cacheKey: 'photon:suggest:' + params.toString(),
        signal: o.signal,
      });
      return (data && data.features ? data.features : []).map((f) => this.normalize(f)).filter(Boolean);
    },

    async search(parts, opts) {
      const o = opts || {};
      const q = buildFreeText(parts);
      if (!q) return [];
      const params = new URLSearchParams({
        q,
        limit: String(o.limit || 15),
        lang: 'fr',
      });
      if (o.cityHint && o.cityHint.lat && o.cityHint.lon) {
        params.set('lat', String(o.cityHint.lat));
        params.set('lon', String(o.cityHint.lon));
      }
      const url = `${this.cfg.baseUrl}?${params.toString()}`;
      const data = await API.request(url, {
        service: 'photon', ttl: this.cfg.ttl, timeoutMs: 10000, retries: 1,
        cacheKey: 'photon:search:' + params.toString(),
        signal: o.signal,
        noCache: !!o.noCache,
      });
      return (data && data.features ? data.features : []).map((f) => this.normalize(f)).filter(Boolean);
    },

    async reverse(lat, lon, opts) {
      const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: 'fr' });
      const url = `${this.cfg.reverseUrl}?${params.toString()}`;
      const data = await API.request(url, {
        service: 'photon', ttl: this.cfg.ttl, timeoutMs: 8000,
        cacheKey: 'photon:reverse:' + params.toString(),
        signal: opts && opts.signal,
      });
      const f = data && data.features && data.features[0];
      return f ? this.normalize(f) : null;
    },

    normalize(f) {
      if (!f || !f.geometry || !f.geometry.coordinates) return null;
      const p = f.properties || {};
      const lon = f.geometry.coordinates[0];
      const lat = f.geometry.coordinates[1];
      if (!U.isValidLatLon(lat, lon)) return null;

      const addr = emptyAddress();
      addr.housenumber = p.housenumber || '';
      addr.street = p.street || p.road || '';
      addr.postcode = p.postcode || '';
      addr.city = p.city || p.town || p.village || p.municipality || '';
      addr.district = p.district || p.locality || '';
      addr.region = p.state || p.county || '';
      addr.country = p.country || '';
      addr.countryCode = (p.countrycode || '').toLowerCase();

      const osm = {
        type: ({ N: 'node', W: 'way', R: 'relation' })[p.osm_type] || null,
        id: p.osm_id || null,
        key: p.osm_key || null,
        value: p.osm_value || null,
      };

      let kind = 'place';
      if (osm.key && POI_KEYS.has(osm.key) && p.type !== 'house') kind = 'poi';
      else if (p.type === 'house') kind = 'address';
      else if (p.type === 'street') kind = 'road';
      else if (p.type === 'building') kind = 'building';
      else if (['city', 'town', 'village', 'locality', 'district', 'county', 'state', 'country'].includes(p.type)) kind = p.type;

      const cls = classify(kind, addr, osm);
      const name = p.name || (p.housenumber ? `${p.housenumber} ${p.street || ''}`.trim() : '') || addr.street || addr.city || '';

      return {
        id: makeId('photon', osm, lat, lon),
        provider: 'photon',
        providerLabel: 'Photon',
        licence: this.cfg.licence,
        label: buildDisplayName(p, addr),
        name,
        address: addr,
        lat: Number(lat),
        lon: Number(lon),
        bbox: p.extent && p.extent.length === 4
          ? { minLon: p.extent[0], minLat: p.extent[1], maxLon: p.extent[2], maxLat: p.extent[3] }
          : null,
        osm,
        kind: cls.kind,
        precision: cls.precision,
        sourceType: p.type || '',
        raw: null,
      };
    },
  };

  /* ------------------------------------------------------------ Nominatim --- */
  const nominatim = {
    id: 'nominatim',
    cfg: CFG.GEOCODERS.nominatim,
    minInterval: 1000,

    /**
     * Recherche de validation (jamais appelée depuis la frappe clavier).
     * Requête structurée quand c'est possible, sinon requête libre.
     */
    async search(parts, opts) {
      const o = opts || {};
      const limit = String(o.limit || 12);
      const base = {
        format: 'jsonv2',
        addressdetails: '1',
        extratags: '1',
        namedetails: '1',
        'accept-language': 'fr',
        limit,
      };
      const params = new URLSearchParams(base);

      const hasStructured = !!(parts.postcode || parts.city);
      const streetLine = [parts.housenumber, parts.street].filter(Boolean).join(' ');

      if (parts.name && !streetLine) {
        // Recherche par nom, éventuellement restreinte par la ville / le code postal
        params.set('q', [parts.name, parts.postcode, parts.city].filter(Boolean).join(', '));
      } else if (streetLine && !parts.name) {
        // Adresse structurée : street + city + postalcode (sémantique Nominatim)
        params.set('street', streetLine);
        if (parts.city) params.set('city', parts.city);
        if (parts.postcode) params.set('postalcode', parts.postcode);
        if (parts.country) params.set('country', parts.country);
      } else {
        params.set('q', buildFreeText(parts));
      }
      if (hasStructured && parts.countryCode) params.set('countrycodes', parts.countryCode);
      if (o.extratags) params.set('extratags', '1');

      const url = `${this.cfg.baseUrl}?${params.toString()}`;
      const data = await API.request(url, {
        service: 'nominatim',
        ttl: this.cfg.ttl,
        timeoutMs: 12000,
        retries: 1,
        cacheKey: 'nominatim:search:' + params.toString(),
        signal: o.signal,
        noCache: !!o.noCache,
      });
      if (!Array.isArray(data)) return [];
      return data.map((r) => this.normalize(r)).filter(Boolean);
    },

    async reverse(lat, lon, opts) {
      const params = new URLSearchParams({
        format: 'jsonv2', lat: String(lat), lon: String(lon),
        addressdetails: '1', 'accept-language': 'fr', zoom: '18',
      });
      const url = `${this.cfg.reverseUrl}?${params.toString()}`;
      const data = await API.request(url, {
        service: 'nominatim', ttl: this.cfg.ttl, timeoutMs: 10000,
        cacheKey: 'nominatim:reverse:' + params.toString(),
        signal: opts && opts.signal,
      });
      return data && data.lat ? this.normalize(data) : null;
    },

    normalize(r) {
      if (!r) return null;
      const lat = Number(r.lat), lon = Number(r.lon);
      if (!U.isValidLatLon(lat, lon)) return null;
      const a = r.address || {};
      const addr = emptyAddress();
      addr.housenumber = a.house_number || '';
      addr.street = a.road || a.pedestrian || a.footway || a.residential || '';
      addr.postcode = a.postcode || '';
      addr.city = a.city || a.town || a.village || a.municipality || a.hamlet || '';
      addr.district = a.city_district || a.suburb || a.quarter || a.neighbourhood || '';
      addr.region = a.state || a.region || a.county || '';
      addr.country = a.country || '';
      addr.countryCode = (a.country_code || '').toLowerCase();

      const osmType = ({ node: 'node', way: 'way', relation: 'relation' })[r.osm_type] || null;
      const osm = {
        type: osmType,
        id: r.osm_id || null,
        key: r.category || null,
        value: r.type || null,
      };

      let kind = 'place';
      if (r.category && POI_KEYS.has(r.category)) kind = 'poi';
      else if (r.addresstype === 'house' || (addr.housenumber && r.category === 'place' && r.type === 'house')) kind = 'address';
      else if (r.category === 'highway' || r.addresstype === 'road') kind = 'road';
      else if (r.category === 'building' || r.addresstype === 'building') kind = 'building';
      else if (['city', 'town', 'village', 'hamlet', 'suburb', 'state', 'country', 'county'].includes(r.addresstype)) kind = r.addresstype;

      const cls = classify(kind, addr, osm);
      const name = (r.namedetails && (r.namedetails.name || r.namedetails['name:fr'])) || r.name || '';

      return {
        id: makeId('nominatim', osm, lat, lon),
        provider: 'nominatim',
        providerLabel: 'Nominatim',
        licence: this.cfg.licence,
        label: r.display_name || '',
        name: name || (addr.housenumber ? `${addr.housenumber} ${addr.street}`.trim() : '') || addr.street || addr.city || '',
        address: addr,
        lat, lon,
        bbox: Array.isArray(r.boundingbox) && r.boundingbox.length === 4
          ? { minLat: Number(r.boundingbox[0]), maxLat: Number(r.boundingbox[1]), minLon: Number(r.boundingbox[2]), maxLon: Number(r.boundingbox[3]) }
          : null,
        osm,
        kind: cls.kind,
        precision: cls.precision,
        sourceType: r.type || '',
        importance: r.importance || 0,
        extra: r.extratags || null,
        raw: null,
      };
    },
  };

  /* ------------------------------------------------------------- Helpers --- */
  function buildFreeText(parts) {
    const bits = [];
    if (parts.name) bits.push(parts.name);
    if (parts.housenumber || parts.street) {
      bits.push([parts.housenumber, parts.street].filter(Boolean).join(' '));
    }
    if (parts.postcode) bits.push(parts.postcode);
    if (!parts.postcode && parts.city) bits.push(parts.city);
    if (parts.postcode && parts.city) bits.push(parts.city);
    if (parts.country) bits.push(parts.country);
    if (!bits.length && parts.freeText) bits.push(parts.freeText);
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  function buildDisplayName(p, addr) {
    const street = [addr.housenumber, addr.street].filter(Boolean).join(' ');
    const cityLine = [addr.postcode, addr.city].filter(Boolean).join(' ');
    const tail = [addr.district, addr.region].filter(Boolean).join(', ');
    return [p.name, street, cityLine, tail].filter(Boolean).join(' · ');
  }

  const providers = [photon, nominatim];

  global.MF_GEO = {
    photon, nominatim, providers,
    helpers: { buildFreeText, precisionLabel, emptyAddress, classify },
  };
})(window);
