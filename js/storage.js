/* ============================================================================
 * MAPFINDER — js/storage.js
 * Persistance locale : préférences, historique, favoris, sélection.
 * Tout échec de stockage (mode privé, quota) est absorbé silencieusement.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const U = global.MF_UTILS;

  const KEYS = {
    prefs: 'mf.prefs',
    history: 'mf.history',
    favorites: 'mf.favorites',
    selection: 'mf.selection',
  };

  const DEFAULT_PREFS = {
    basemap: 'osm',
    imagery: 'ign-ortho',
    photoRadius: 60,
    theme: 'auto',          // auto | light | dark
    nominatimEnabled: true,
    osmContextEnabled: true, // recherche de l'emprise du bâtiment (Overpass)
    showPrecisionNotes: true,
    maxResults: 25,
  };

  let memory = {};

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return key in memory ? memory[key] : fallback;
    }
  }

  function write(key, value) {
    memory[key] = value;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ---------------------------------------------------------- Préférences --- */
  function getPrefs() {
    return Object.assign({}, DEFAULT_PREFS, read(KEYS.prefs, {}));
  }

  function setPref(key, value) {
    const prefs = getPrefs();
    prefs[key] = value;
    write(KEYS.prefs, prefs);
    return prefs;
  }

  function resetPrefs() {
    write(KEYS.prefs, {});
    return getPrefs();
  }

  /* ------------------------------------------------------------- Historique --- */
  function getHistory() {
    const h = read(KEYS.history, []);
    return Array.isArray(h) ? h : [];
  }

  function addHistory(entry) {
    const h = getHistory().filter((e) => U.normalize(e.query) !== U.normalize(entry.query));
    h.unshift({
      query: entry.query,
      at: Date.now(),
      count: entry.count || 0,
      label: entry.label || '',
      lat: entry.lat || null,
      lon: entry.lon || null,
      place: entry.place || '',
    });
    write(KEYS.history, h.slice(0, CFG.APP.maxHistory));
    return getHistory();
  }

  function removeHistory(query) {
    write(KEYS.history, getHistory().filter((e) => e.query !== query));
    return getHistory();
  }

  function clearHistory() {
    write(KEYS.history, []);
    return [];
  }

  /* ---------------------------------------------------------------- Favoris --- */
  function getFavorites() {
    const f = read(KEYS.favorites, []);
    return Array.isArray(f) ? f : [];
  }

  function isFavorite(id) {
    return getFavorites().some((f) => f.id === id);
  }

  function toggleFavorite(result) {
    const list = getFavorites();
    const idx = list.findIndex((f) => f.id === result.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      write(KEYS.favorites, list);
      return { added: false, favorites: list };
    }
    list.unshift({
      id: result.id,
      name: result.name,
      label: result.label,
      address: result.address,
      lat: result.lat,
      lon: result.lon,
      precision: result.precision,
      provider: result.provider,
      osm: result.osm,
      at: Date.now(),
    });
    write(KEYS.favorites, list);
    return { added: true, favorites: list };
  }

  function clearFavorites() {
    write(KEYS.favorites, []);
    return [];
  }

  /* -------------------------------------------------------------- Sélection --- */
  function getSelection() {
    const s = read(KEYS.selection, []);
    return Array.isArray(s) ? s : [];
  }

  function toggleSelection(result) {
    const sel = getSelection();
    const idx = sel.findIndex((s) => s.id === result.id);
    if (idx >= 0) sel.splice(idx, 1);
    else sel.push({
      id: result.id, name: result.name, label: result.label,
      lat: result.lat, lon: result.lon, address: result.address,
    });
    write(KEYS.selection, sel);
    return sel;
  }

  function clearSelection() {
    write(KEYS.selection, []);
    return [];
  }

  /* ---------------------------------------------------------------- Divers --- */
  function exportAll() {
    return {
      app: CFG.APP.name,
      version: CFG.APP.version,
      exportedAt: new Date().toISOString(),
      prefs: getPrefs(),
      history: getHistory(),
      favorites: getFavorites(),
    };
  }

  function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('Fichier de sauvegarde invalide.');
    if (data.prefs) write(KEYS.prefs, data.prefs);
    if (Array.isArray(data.history)) write(KEYS.history, data.history.slice(0, CFG.APP.maxHistory));
    if (Array.isArray(data.favorites)) write(KEYS.favorites, data.favorites);
    return { prefs: getPrefs(), history: getHistory(), favorites: getFavorites() };
  }

  function clearAll() {
    [KEYS.prefs, KEYS.history, KEYS.favorites, KEYS.selection].forEach((k) => {
      try { localStorage.removeItem(k); } catch (_) {}
    });
    memory = {};
    if (global.MF_API && global.MF_API.cache) global.MF_API.cache.clear();
  }

  global.MF_STORAGE = {
    KEYS, DEFAULT_PREFS,
    getPrefs, setPref, resetPrefs,
    getHistory, addHistory, removeHistory, clearHistory,
    getFavorites, isFavorite, toggleFavorite, clearFavorites,
    getSelection, toggleSelection, clearSelection,
    exportAll, importAll, clearAll,
  };
})(window);
