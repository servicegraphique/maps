/* ============================================================================
 * MAPFINDER — js/map.js
 * Carte principale Leaflet : fond de carte, marqueur du bâtiment, emprise,
 * résultats multiples, sélection multiple, plein écran, coordonnées.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const U = global.MF_UTILS;

  const PRECISION_COLORS = {
    centroid: '#0f9d58',   // bâtiment (emprise)
    exact: '#1a73e8',      // point d'intérêt
    approximate: '#f29900',// approximatif
    unknown: '#5f6368',
  };

  class MainMap {
    constructor(containerId) {
      this.container = document.getElementById(containerId);
      this.map = L.map(this.container, {
        center: CFG.APP.defaultCenter,
        zoom: CFG.APP.defaultZoom,
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true,
        worldCopyJump: true,
      });

      this.prefs = global.MF_STORAGE ? global.MF_STORAGE.getPrefs() : { basemap: 'osm' };
      this.basemaps = {};
      this.currentBasemap = null;
      this.marker = null;
      this.halo = null;
      this.footprint = null;
      this.resultLayer = L.layerGroup().addTo(this.map);
      this.selectionLayer = L.layerGroup().addTo(this.map);
      this.measureLine = null;
      this.secondary = null;

      this._initBasemaps();
      this._initControls();
      this._initEvents();
    }

    _initBasemaps() {
      Object.values(CFG.BASEMAPS).forEach((b) => {
        this.basemaps[b.id] = L.tileLayer(b.url, {
          maxZoom: b.maxZoom,
          attribution: b.attribution,
          subdomains: b.id === 'positron' ? 'abcd' : 'abc',
        });
      });
      const id = this.prefs.basemap && this.basemaps[this.prefs.basemap] ? this.prefs.basemap : 'osm';
      this.setBasemap(id);
    }

    setBasemap(id) {
      if (!this.basemaps[id]) return;
      if (this.currentBasemap) this.map.removeLayer(this.basemaps[this.currentBasemap]);
      this.basemaps[id].addTo(this.map);
      if (this.basemaps[id].bringToBack) this.basemaps[id].bringToBack();
      this.currentBasemap = id;
      if (global.MF_STORAGE) global.MF_STORAGE.setPref('basemap', id);
      document.dispatchEvent(new CustomEvent('mf:basemap', { detail: { id } }));
    }

    _initControls() {
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
      L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 140 }).addTo(this.map);
      this.map.attributionControl.setPrefix(
        '<a href="' + CFG.EXTERNAL.osmCopyright + '" target="_blank" rel="noopener">OpenStreetMap</a>'
      );
    }

    _initEvents() {
      this.map.on('moveend', () => {
        document.dispatchEvent(new CustomEvent('mf:mapmove', {
          detail: { center: this.map.getCenter(), zoom: this.map.getZoom() },
        }));
      });
      this.map.on('click', (e) => {
        document.dispatchEvent(new CustomEvent('mf:mapclick', {
          detail: { lat: e.latlng.lat, lon: e.latlng.lng },
        }));
      });
      this.map.on('mousemove', (e) => {
        document.dispatchEvent(new CustomEvent('mf:mapcoords', {
          detail: { lat: e.latlng.lat, lon: e.latlng.lng },
        }));
      });
    }

    getCenter() {
      const c = this.map.getCenter();
      return { lat: c.lat, lon: c.lng };
    }

    /* ----------------------------------------------------------- Marqueur --- */
    focus(result, opts) {
      const o = opts || {};
      const lat = Number(result.lat), lon = Number(result.lon);
      if (!U.isValidLatLon(lat, lon)) return;

      this.clearFocus();
      const color = PRECISION_COLORS[result.precision] || PRECISION_COLORS.unknown;

      this.marker = L.marker([lat, lon], {
        icon: L.divIcon({
          className: 'mf-pin-wrap',
          html: `<span class="mf-pin" style="--pin:${color}"><span class="mf-pin-dot"></span></span>`,
          iconSize: [34, 44],
          iconAnchor: [17, 42],
        }),
        zIndexOffset: 1000,
        keyboard: true,
        title: result.name || result.label || 'Position recherchée',
      }).addTo(this.map);

      this.marker.bindPopup(this._popupHtml(result), {
        maxWidth: 320,
        className: 'mf-popup',
        autoPanPadding: [32, 32],
      });

      const zoom = o.zoom || 18;
      if (o.animate === false) this.map.setView([lat, lon], zoom);
      else this.map.flyTo([lat, lon], zoom, { duration: 0.7 });
      setTimeout(() => { if (this.marker) this.marker.openPopup(); }, o.animate === false ? 60 : 750);
    }

    _popupHtml(result) {
      const p = MF_GEO.helpers.precisionLabel(result.precision);
      return `<div class="mf-popup-body">
        <div class="mf-popup-title">${U.escapeHtml(result.name || result.label || 'Position')}</div>
        <div class="mf-popup-addr">${U.escapeHtml(U.formatAddress(result.address) || result.label || '')}</div>
        <div class="mf-popup-meta">
          <span class="mf-badge mf-badge--${p.tone}">${p.label}</span>
          <span class="mf-popup-coords">${U.formatCoords(result.lat, result.lon)}</span>
        </div>
      </div>`;
    }

    setFootprint(building) {
      if (this.footprint) { this.map.removeLayer(this.footprint); this.footprint = null; }
      if (!building || !building.ring) return;
      this.footprint = L.polygon(building.ring, {
        color: '#0f9d58',
        weight: 2,
        opacity: 0.95,
        fillColor: '#0f9d58',
        fillOpacity: 0.14,
        dashArray: null,
        interactive: false,
      }).addTo(this.map);
      this.footprint.bringToFront();
    }

    clearFocus() {
      if (this.marker) { this.map.removeLayer(this.marker); this.marker = null; }
      if (this.footprint) { this.map.removeLayer(this.footprint); this.footprint = null; }
      if (this.secondary) { this.map.removeLayer(this.secondary); this.secondary = null; }
      if (this.measureLine) { this.map.removeLayer(this.measureLine); this.measureLine = null; }
    }

    /** Recentre sur le dernier point sélectionné. */
    recenter() {
      if (this.marker) {
        this.map.flyTo(this.marker.getLatLng(), Math.max(this.map.getZoom(), 18), { duration: 0.6 });
      }
    }

    setSecondaryPoint(lat, lon) {
      if (this.secondary) { this.map.removeLayer(this.secondary); this.secondary = null; }
      if (this.measureLine) { this.map.removeLayer(this.measureLine); this.measureLine = null; }
      this.secondary = L.circleMarker([lat, lon], {
        radius: 6, color: '#d93025', weight: 2, fillColor: '#fff', fillOpacity: 1,
      }).addTo(this.map);
      if (this.marker) {
        const from = this.marker.getLatLng();
        this.measureLine = L.polyline([from, [lat, lon]], {
          color: '#d93025', weight: 2, dashArray: '5,6', opacity: 0.9,
        }).addTo(this.map);
        const d = U.distance(from.lat, from.lng, lat, lon);
        const b = U.bearing(from.lat, from.lng, lat, lon);
        this.measureLine.bindTooltip(`${U.formatDistance(d)} — ${U.bearingLabel(b)}`, { sticky: true }).openTooltip();
      }
    }

    /* ------------------------------------------------- Résultats multiples --- */
    showResults(results, selectedId, onPick) {
      this.resultLayer.clearLayers();
      if (!results || !results.length) return;
      const bounds = L.latLngBounds([]);

      results.forEach((r, index) => {
        const isSelected = r.id === selectedId;
        const color = PRECISION_COLORS[r.precision] || PRECISION_COLORS.unknown;
        const marker = L.marker([r.lat, r.lon], {
          icon: L.divIcon({
            className: 'mf-dot-wrap',
            html: `<span class="mf-dot ${isSelected ? 'is-selected' : ''}" style="--pin:${color}">${index + 1}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          title: r.name || r.label || '',
          zIndexOffset: isSelected ? 900 : 200,
        });
        marker.on('click', () => { if (onPick) onPick(r); });
        marker.bindTooltip(U.escapeHtml(r.name || r.label || `Résultat ${index + 1}`), { direction: 'top', offset: [0, -12] });
        marker.addTo(this.resultLayer);
        bounds.extend([r.lat, r.lon]);
      });

      if (results.length > 1) {
        this.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17, animate: true });
      }
    }

    showSelection(items) {
      this.selectionLayer.clearLayers();
      if (!items || !items.length) return;
      items.forEach((s, i) => {
        L.marker([s.lat, s.lon], {
          icon: L.divIcon({
            className: 'mf-sel-wrap',
            html: `<span class="mf-sel">${i + 1}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          title: s.name || s.label || '',
        }).addTo(this.selectionLayer);
      });
      if (items.length > 1) {
        L.polyline(items.map((s) => [s.lat, s.lon]), {
          color: '#7b1fa2', weight: 2, dashArray: '4,6', opacity: 0.7,
        }).addTo(this.selectionLayer);
      }
    }

    fitExtent(bbox) {
      if (!bbox) return;
      const b = L.latLngBounds([bbox.minLat, bbox.minLon], [bbox.maxLat, bbox.maxLon]);
      if (b.isValid()) this.map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
    }

    invalidate() {
      if (this.map) setTimeout(() => this.map.invalidateSize(), 120);
    }

    /* --------------------------------------------------------- Plein écran --- */
    toggleFullscreen() {
      const target = document.getElementById('map-panel') || this.container;
      if (!document.fullscreenElement) {
        const req = target.requestFullscreen || target.webkitRequestFullscreen;
        if (req) req.call(target).catch(() => {});
      } else if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }

  global.MF_MAP = { MainMap, PRECISION_COLORS };
})(window);
