/* ============================================================================
 * MAPFINDER — js/satellite.js
 * Imagerie aérienne / satellite : ordre de priorité IGN -> Esri -> repli carte.
 * Vérifie la disponibilité réelle (sonde de tuile) et ne présente JAMAIS une
 * carte routière comme une vue aérienne.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const U = global.MF_UTILS;

  /* ------------------------------------------------ Sonde de disponibilité --- */
  const probeCache = new Map();

  function probeTile(url) {
    if (probeCache.has(url)) return probeCache.get(url);
    const p = new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => { img.src = ''; resolve(false); }, 7000);
      img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      // Pas de crossOrigin : on vérifie seulement que la tuile s'affiche.
      // L'imposer transformerait le chargement en requête CORS et ferait échouer
      // des fournisseurs parfaitement fonctionnels (IGN, Esri).
      img.referrerPolicy = 'no-referrer-when-downgrade';
      img.src = url;
    });
    probeCache.set(url, p);
    return p;
  }

  function tileUrl(provider, z, x, y) {
    return provider.url
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
      .replace('{r}', '');
  }

  function lonToTileX(lon, z) { return Math.floor(((lon + 180) / 360) * 2 ** z); }
  function latToTileY(lat, z) {
    const r = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
  }

  /** Choisit le premier fournisseur dont une tuile réelle se charge. */
  async function resolveProvider(lat, lon, preferredId) {
    const list = CFG.IMAGERY.providers.filter((p) => !p.optional || (preferredId && p.id === preferredId));
    const ordered = preferredId
      ? list.slice().sort((a, b) => (a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0))
      : list;

    const tested = [];
    for (const provider of ordered) {
      const covered = !provider.covers || provider.covers(lat, lon);
      tested.push({ id: provider.id, label: provider.label, covered });
      if (!covered) continue;
      const z = Math.min(17, provider.maxNativeZoom || 18);
      const x = lonToTileX(lon, z);
      const y = latToTileY(lat, z);
      const ok = await probeTile(tileUrl(provider, z, x, y));
      if (ok) return { provider, fallback: false, tested };
    }
    return { provider: null, fallback: true, tested };
  }

  /* ------------------------------------------------------------ Classe vue --- */
  class SatelliteView {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      this.map = null;
      this.layer = null;
      this.provider = null;
      this.marker = null;
      this.footprint = null;
      this.target = null;
      this.lastProbe = null;
    }

    _ensureMap() {
      if (this.map) return this.map;
      this.map = L.map(this.container, {
        zoomControl: true,
        attributionControl: true,
        center: CFG.APP.defaultCenter,
        zoom: 18,
      });
      this.map.attributionControl.setPrefix('');
      this.map.on('click', (e) => {
        document.dispatchEvent(new CustomEvent('mf:aerialclick', { detail: { lat: e.latlng.lat, lon: e.latlng.lng } }));
      });
      return this.map;
    }

    /**
     * Affiche la vue aérienne d'un point.
     * @param {object} result SearchResult
     * @param {object} opts { building, onStatus }
     */
    async show(result, opts) {
      const o = opts || {};
      const onStatus = o.onStatus || (() => {});
      this.target = result;
      const map = this._ensureMap();
      map.invalidateSize();

      const prefs = global.MF_STORAGE ? global.MF_STORAGE.getPrefs() : {};
      const preferred = prefs.imagery || 'ign-ortho';

      onStatus({ state: 'loading', message: 'Recherche de l’imagerie aérienne la plus précise…' });

      const resolved = await resolveProvider(result.lat, result.lon, preferred);
      this.lastProbe = resolved;

      if (this.layer) { map.removeLayer(this.layer); this.layer = null; }

      if (!resolved.provider) {
        onStatus({
          state: 'unavailable',
          message: 'Aucune imagerie aérienne disponible pour cette localisation.',
          detail: 'Les fournisseurs gratuits testés (IGN, Esri) n’ont pas renvoyé d’image à cet endroit. '
            + 'La carte de l’onglet « Vue carte » reste disponible, mais il s’agit d’une carte routière, pas d’une vue aérienne.',
        });
        // Repli honnête : carte OSM, étiquetée comme telle
        this.layer = L.tileLayer(CFG.BASEMAPS.osm.url, {
          maxZoom: 19,
          attribution: CFG.BASEMAPS.osm.attribution,
        }).addTo(map);
        this._drawOverlays(result, o.building);
        map.setView([result.lat, result.lon], Math.min(18, map.getZoom()));
        return { ok: false, provider: null, tested: resolved.tested };
      }

      const p = resolved.provider;
      this.provider = p;
      this.layer = L.tileLayer(p.url, {
        maxZoom: Math.min(21, (p.maxNativeZoom || 18) + 2),
        maxNativeZoom: p.maxNativeZoom || 18,
        minZoom: p.minZoom || 1,
        attribution: p.attribution,
        detectRetina: false,
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      }).addTo(map);

      this._drawOverlays(result, o.building);

      // Cadrage serré sur le bâtiment : c'est le toit que l'on veut voir.
      if (o.building && o.building.ring) {
        const b = L.latLngBounds(o.building.ring);
        if (b.isValid()) map.fitBounds(b, { padding: [50, 50], maxZoom: 19 });
      } else {
        map.setView([result.lat, result.lon], 18, { animate: false });
      }

      onStatus({ state: 'ready', provider: p });
      return { ok: true, provider: p, tested: resolved.tested };
    }

    _drawOverlays(result, building) {
      const map = this.map;
      if (this.marker) { map.removeLayer(this.marker); this.marker = null; }
      if (this.footprint) { map.removeLayer(this.footprint); this.footprint = null; }

      if (building && building.ring) {
        this.footprint = L.polygon(building.ring, {
          color: '#ffd54f', weight: 2.5, opacity: 1,
          fillColor: '#ffd54f', fillOpacity: 0.08,
          interactive: false,
        }).addTo(map);
      }

      this.marker = L.marker([result.lat, result.lon], {
        icon: L.divIcon({
          className: 'mf-pin-wrap',
          html: '<span class="mf-pin mf-pin--aerial"><span class="mf-pin-dot"></span></span>',
          iconSize: [34, 44],
          iconAnchor: [17, 42],
        }),
        title: result.name || result.label || 'Bâtiment',
      }).addTo(map);
      this.marker.bindTooltip(U.escapeHtml(result.name || result.label || ''), { direction: 'top', offset: [0, -40] });
    }

    /** Vignette d'aperçu (page d'accueil / résultats) — renvoie null si indisponible. */
    async thumbnail(result) {
      const resolved = await resolveProvider(result.lat, result.lon,
        global.MF_STORAGE ? global.MF_STORAGE.getPrefs().imagery : 'ign-ortho');
      if (!resolved.provider) return null;
      const z = 17;
      const x = lonToTileX(result.lon, z);
      const y = latToTileY(result.lat, z);
      const ok = await probeTile(tileUrl(resolved.provider, z, x, y));
      if (!ok) return null;
      return { provider: resolved.provider, url: tileUrl(resolved.provider, z, x, y) };
    }

    invalidate() { if (this.map) setTimeout(() => this.map.invalidateSize(), 150); }

    switchProvider(providerId, onStatus) {
      if (!this.target) return;
      if (global.MF_STORAGE) global.MF_STORAGE.setPref('imagery', providerId);
      this.show(this.target, { building: this._lastBuilding, onStatus });
    }
  }

  /**
   * Diagnostic explicite des sources d'imagerie pour un point donné.
   * Utilisé par le bouton « Tester les sources » des paramètres : l'utilisateur
   * vérifie lui-même, dans son navigateur et sur son réseau, ce qui fonctionne.
   */
  async function diagnose(lat, lon) {
    const out = [];
    for (const provider of CFG.IMAGERY.providers.filter((p) => !p.optional)) {
      const covered = !provider.covers || provider.covers(lat, lon);
      let ok = false;
      let url = '';
      if (covered) {
        const z = Math.min(17, provider.maxNativeZoom || 18);
        url = tileUrl(provider, z, lonToTileX(lon, z), latToTileY(lat, z));
        ok = await probeTile(url);
      }
      out.push({ id: provider.id, label: provider.label, covered, ok, url, licence: provider.licence });
    }
    return out;
  }

  global.MF_AERIAL = { SatelliteView, resolveProvider, probeTile, tileUrl, lonToTileX, latToTileY, diagnose };
})(window);
