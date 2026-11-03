/* ============================================================================
 * MAPFINDER — js/utils.js
 * Fonctions pures, sans état et sans réseau. Aucune dépendance.
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- DOM --- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.keys(v).forEach((d) => { node.dataset[d] = v[d]; });
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /** Échappement HTML systématique avant toute injection (les noms OSM sont saisis par des tiers). */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  /* ------------------------------------------------------------ Format --- */
  function formatCoords(lat, lon, decimals) {
    const d = decimals === undefined ? 6 : decimals;
    return `${Number(lat).toFixed(d)}, ${Number(lon).toFixed(d)}`;
  }

  function formatCoordsHuman(lat, lon) {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'O';
    return `${Math.abs(lat).toFixed(5)}° ${ns}, ${Math.abs(lon).toFixed(5)}° ${ew}`;
  }

  function formatDistance(meters) {
    if (meters === null || meters === undefined || Number.isNaN(meters)) return '—';
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function formatSurface(m2) {
    if (!m2) return '';
    if (m2 < 10000) return `${Math.round(m2)} m²`;
    return `${(m2 / 10000).toFixed(2)} ha`;
  }

  /** "16 Rue Daunou, 75002 Paris" */
  function formatAddress(a) {
    if (!a) return '';
    const street = [a.housenumber, a.street].filter(Boolean).join(' ');
    const cityLine = [a.postcode, a.city].filter(Boolean).join(' ');
    const parts = [street, cityLine].filter(Boolean);
    if (!parts.length) return [a.district, a.region, a.country].filter(Boolean).join(', ');
    if (a.country && a.countryCode && !['fr'].includes(String(a.countryCode).toLowerCase())) {
      parts.push(a.country);
    }
    return parts.join(', ');
  }

  /* -------------------------------------------------------- Géométrie --- */
  const R = 6371008.8; // rayon terrestre moyen (m)
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  /** Distance haversine en mètres. */
  function distance(aLat, aLon, bLat, bLon) {
    const dLat = rad(bLat - aLat);
    const dLon = rad(bLon - aLon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /** Azimut (0 = nord, 90 = est) du point A vers le point B. */
  function bearing(aLat, aLon, bLat, bLon) {
    const y = Math.sin(rad(bLon - aLon)) * Math.cos(rad(bLat));
    const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(rad(bLon - aLon));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  function bearingLabel(b) {
    if (b === null || b === undefined || Number.isNaN(b)) return '';
    const dirs = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
    return dirs[Math.round(((b % 360) / 45)) % 8];
  }

  /** Écart angulaire absolu entre deux caps (0-180). */
  function angleDiff(a, b) {
    if (a === null || b === null || a === undefined || b === undefined) return null;
    let d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
  }

  function bboxAround(lat, lon, radiusM) {
    const dLat = (radiusM / R) * (180 / Math.PI);
    const dLon = dLat / Math.max(0.01, Math.cos(rad(lat)));
    return {
      minLon: lon - dLon, minLat: lat - dLat,
      maxLon: lon + dLon, maxLat: lat + dLat,
    };
  }

  function bboxToString(bb, order) {
    // ordre par défaut : minLon,minLat,maxLon,maxLat (STAC/Overpass 'around' non concernés)
    const v = order === 'latlon'
      ? [bb.minLat, bb.minLon, bb.maxLat, bb.maxLon]
      : [bb.minLon, bb.minLat, bb.maxLon, bb.maxLat];
    return v.map((n) => Number(n).toFixed(6)).join(',');
  }

  function isValidLatLon(lat, lon) {
    return Number.isFinite(+lat) && Number.isFinite(+lon)
      && Math.abs(+lat) <= 90 && Math.abs(+lon) <= 180;
  }

  /* ----------------------------------------------------------- Contrôle --- */
  function debounce(fn, wait) {
    let t = null;
    const wrapped = function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  function throttle(fn, wait) {
    let last = 0, timer = null;
    return function (...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) { last = now; fn.apply(this, args); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(this, args); }, remaining);
      }
    };
  }

  /** Texte normalisé pour comparaison : minuscules, sans accents, ponctuation réduite. */
  function normalize(str) {
    return String(str || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[’'`]/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Similarité 0..1 : préfixe > inclusion > Levenshtein normalisé. */
  function similarity(a, b) {
    const A = normalize(a), B = normalize(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    if (B.startsWith(A)) return 0.92;
    if (B.includes(A)) return 0.8;
    if (A.includes(B)) return 0.7;
    const dist = levenshtein(A, B);
    return Math.max(0, 1 - dist / Math.max(A.length, B.length));
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  }

  /* -------------------------------------------------------- Divers --- */
  function uid(prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* repli ci-dessous */ }
    try {
      const ta = el('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  }

  global.MF_UTILS = {
    $, $$, el, escapeHtml, clear,
    formatCoords, formatCoordsHuman, formatDistance, formatDate, formatSurface, formatAddress,
    distance, bearing, bearingLabel, angleDiff, bboxAround, bboxToString, isValidLatLon,
    debounce, throttle, normalize, similarity, levenshtein,
    uid, sleep, clamp, copyToClipboard, downloadFile,
  };
})(window);
