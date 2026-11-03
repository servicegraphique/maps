/* ============================================================================
 * MAPFINDER — js/street-images.js
 * Photographies de rue géolocalisées : Panoramax (prioritaire) puis KartaView.
 * Aucune source nécessitant un compte ou une clé n'est utilisée.
 * Aucune image générique n'est présentée comme photo du bâtiment.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const API = global.MF_API;
  const U = global.MF_UTILS;

  /* ================================================================ Panoramax */
  const panoramax = {
    id: 'panoramax',
    cfg: CFG.STREET.providers.find((p) => p.id === 'panoramax'),

    async nearby(lat, lon, radius, opts) {
      const bb = U.bboxAround(lat, lon, radius);
      const params = new URLSearchParams({
        bbox: U.bboxToString(bb, 'lonlat'),
        limit: String(CFG.STREET.maxPhotos),
      });
      const url = `${this.cfg.baseUrl}?${params.toString()}`;
      const data = await API.request(url, {
        service: 'panoramax',
        ttl: this.cfg.ttl,
        timeoutMs: 12000,
        retries: 1,
        cacheKey: 'panoramax:' + params.toString(),
        signal: opts && opts.signal,
      });
      const features = (data && data.features) || [];
      return features.map((f) => this.normalize(f)).filter(Boolean);
    },

    normalize(f) {
      if (!f || !f.geometry || !f.geometry.coordinates) return null;
      const lon = f.geometry.coordinates[0];
      const lat = f.geometry.coordinates[1];
      if (!U.isValidLatLon(lat, lon)) return null;
      const p = f.properties || {};
      const assets = f.assets || {};
      const thumb = assets.thumb && assets.thumb.href;
      const sd = assets.sd && assets.sd.href;
      const hd = assets.hd && assets.hd.href;
      if (!thumb && !sd) return null;

      const iio = p['pers:interior_orientation'] || {};
      const fov = typeof iio.field_of_view === 'number' ? iio.field_of_view : null;
      const yaw = typeof p['pers:yaw'] === 'number' ? p['pers:yaw']
        : (typeof p['view:azimuth'] === 'number' ? p['view:azimuth'] : null);
      const via = (f.links || []).find((l) => l.rel === 'via');
      const licenceLink = (f.links || []).find((l) => l.rel === 'license');
      const producer = (f.providers || []).map((x) => x.name).filter(Boolean).join(', ');

      return {
        id: 'pmx-' + f.id,
        uid: f.id,
        provider: 'panoramax',
        providerLabel: 'Panoramax',
        url: sd || hd || thumb,
        hdUrl: hd || null,
        thumb,
        lat: Number(lat),
        lon: Number(lon),
        date: p.datetime || p.datetimetz || null,
        azimuth: yaw,
        fieldOfView: fov,
        is360: !!(fov && fov >= 300),
        author: producer || 'Contributeur Panoramax',
        licence: p.license || 'voir licence',
        licenceUrl: licenceLink ? licenceLink.href : null,
        accuracy: typeof p['quality:horizontal_accuracy'] === 'number' ? p['quality:horizontal_accuracy'] : null,
        pageUrl: via && via.href ? via.href : `https://api.panoramax.xyz/api/collections/${f.collection}/items/${f.id}`,
        viewerUrl: 'https://api.panoramax.xyz/#focus=pic&pic=' + f.id,
        instance: via && via.instance_name ? via.instance_name : 'panoramax',
        attribution: this.cfg.attribution,
      };
    },
  };

  /* ================================================================ KartaView */
  const kartaview = {
    id: 'kartaview',
    cfg: CFG.STREET.providers.find((p) => p.id === 'kartaview'),

    async nearby(lat, lon, radius, opts) {
      const params = new URLSearchParams({
        lat: lat.toFixed(6),
        lng: lon.toFixed(6),
        radius: String(Math.min(radius, 200)),
      });
      const url = `${this.cfg.baseUrl}?${params.toString()}`;
      const data = await API.request(url, {
        service: 'kartaview',
        ttl: this.cfg.ttl,
        timeoutMs: 12000,
        retries: 1,
        cacheKey: 'kartaview:' + params.toString(),
        signal: opts && opts.signal,
      });
      // Particularité de l'API : le code HTTP est 200 même en cas d'erreur d'API.
      if (!data || !data.status || data.status.apiCode !== 600) return [];
      const rows = (data.result && data.result.data) || [];
      return rows.map((r) => this.normalize(r)).filter(Boolean);
    },

    normalize(r) {
      const lat = Number(r.lat), lon = Number(r.lng);
      if (!U.isValidLatLon(lat, lon)) return null;
      // On ne montre que les images dont le floutage (visages / plaques) est terminé.
      if (r.autoImgProcessingResult && r.autoImgProcessingResult !== 'BLURRED') return null;
      const url = r.imageProcUrl || r.fileurlProc || r.imageThUrl || r.fileurlTh;
      if (!url) return null;
      const thumb = r.imageThUrl || r.imageLthUrl || url;
      return {
        id: 'kv-' + r.id,
        uid: String(r.id),
        provider: 'kartaview',
        providerLabel: 'KartaView',
        url,
        hdUrl: r.fileurl ? r.fileurl.replace('{{sizeprefix}}', 'proc') : url,
        thumb,
        lat, lon,
        date: r.shotDate || r.dateAdded || null,
        azimuth: r.heading !== undefined && r.heading !== '0' ? Number(r.heading) : null,
        fieldOfView: null,
        is360: r.projection && r.projection !== 'PLANE',
        author: 'Contributeur KartaView',
        licence: this.cfg.licence,
        licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        accuracy: r.gpsAccuracy ? Number(r.gpsAccuracy) : null,
        pageUrl: `https://kartaview.org/sequence/${r.sequenceId || ''}`,
        viewerUrl: `https://kartaview.org/details/${r.id}`,
        distance: r.distance ? Number(r.distance) : null,
        attribution: this.cfg.attribution,
      };
    },
  };

  /* ================================================================ Service */
  const providers = [panoramax, kartaview];

  /**
   * Recherche des photos autour d'un point, toutes sources confondues.
   * @returns {Promise<{photos, byProvider, warnings, empty}>}
   */
  async function findPhotos(lat, lon, opts) {
    const o = opts || {};
    const radius = U.clamp(o.radius || CFG.STREET.radiusDefault, 20, CFG.STREET.radiusMax);
    const warnings = [];
    const byProvider = {};
    const all = [];

    for (const provider of providers) {
      try {
        const photos = await provider.nearby(lat, lon, radius, o);
        byProvider[provider.id] = { count: photos.length, error: null };
        all.push(...photos);
      } catch (e) {
        byProvider[provider.id] = { count: 0, error: e };
        if (e && e.code !== 'abort') {
          warnings.push(`${provider.cfg.label} indisponible : ${e.message}`);
        }
      }
      if (o.signal && o.signal.aborted) break;
    }

    // Enrichissement : distance au bâtiment, azimut caméra -> bâtiment, libellé de vue
    const enriched = all.map((ph) => {
      const d = U.distance(ph.lat, ph.lon, lat, lon);
      const bearingToTarget = U.bearing(ph.lat, ph.lon, lat, lon);
      const offset = ph.azimuth !== null && ph.azimuth !== undefined
        ? U.angleDiff(ph.azimuth, bearingToTarget)
        : null;
      return Object.assign(ph, {
        distance: d,
        bearingToTarget,
        angleOffset: offset,
        viewLabel: viewLabelFor(offset, ph.is360),
      });
    });

    // Déduplication (même appareil / même instant / quelques mètres)
    const deduped = [];
    enriched
      .sort((a, b) => a.distance - b.distance)
      .forEach((ph) => {
        const dup = deduped.find((x) => Math.abs(x.distance - ph.distance) < 6
          && x.date && ph.date && Math.abs(new Date(x.date) - new Date(ph.date)) < 1500);
        if (!dup) deduped.push(ph);
      });

    return {
      photos: deduped.slice(0, CFG.STREET.maxPhotos),
      byProvider,
      warnings,
      empty: deduped.length === 0,
      radius,
    };
  }

  /**
   * Étiquette honnête de l'angle de vue.
   * On ne parle de « face » ou « latérale » que si l'azimut est réellement connu.
   * Une caméra orientée vers le bâtiment est classée « vue depuis la rue ».
   */
  function viewLabelFor(offset, is360) {
    if (is360) return 'Panorama 360° — vue depuis la rue';
    if (offset === null || offset === undefined) return 'Vue depuis la rue';
    if (offset <= 40) return 'Vue depuis la rue (caméra orientée vers le bâtiment)';
    if (offset <= 75) return 'Vue oblique depuis la rue';
    if (offset <= 140) return 'Vue latérale depuis la rue';
    return 'Vue en enfilade depuis la rue';
  }

  global.MF_STREET = { findPhotos, providers, viewLabelFor };
})(window);
