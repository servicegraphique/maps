/* ============================================================================
 * MAPFINDER — js/app.js
 * Contrôleur d'interface : état applicatif, événements, rendu, onglets,
 * fiche détaillée, vue aérienne, galerie photo, historique, favoris, export.
 * ==========================================================================*/
(function () {
  'use strict';

  const CFG = window.MF_CONFIG;
  const U = window.MF_UTILS;
  const API = window.MF_API;
  const GEO = window.MF_GEO;
  const SEARCH = window.MF_SEARCH;
  const OV = window.MF_OVERPASS;
  const STORE = window.MF_STORAGE;
  const EXP = window.MF_EXPORT;
  const MAP = window.MF_MAP;
  const AERIAL = window.MF_AERIAL;
  const STREET = window.MF_STREET;

  /* ==================================================================== État */
  const state = {
    query: '',
    parts: null,
    results: [],
    selected: null,
    matchedBuilding: null,
    matchConfidence: null,
    context: null,
    loading: false,
    sortMode: 'relevance',
    hideApproximate: false,
    activeTab: 'map',
    aerialProvider: null,
    photos: [],
    photoIndex: 0,
    photoLoading: false,
    photoLoadedFor: null,
    controllers: {},
    favoritesCache: [],
  };

  let mainMap = null;
  let detailMap = null;
  let detailMarker = null;
  let aerialView = null;
  let activeSuggestion = -1;
  let suggestions = [];

  const el = {};
  function cacheDom() {
    [
      'search-form', 'search-field', 'search-input', 'btn-search', 'btn-clear', 'suggestions-list',
      'search-parse', 'results-list', 'results-count', 'results-empty', 'results-skeleton',
      'results-message', 'results-scroll', 'results-toolbar', 'toggle-precision-filter',
      'btn-export', 'btn-sort', 'btn-clear-search', 'btn-recenter', 'btn-fullscreen',
      'select-basemap', 'readout-gps', 'readout-cursor', 'map-loading', 'service-banner',
      'detail-card', 'detail-map', 'detail-actions', 'tab-btn-map', 'tab-btn-aerial',
      'tab-btn-photos', 'tab-map', 'tab-aerial', 'tab-photos', 'aerial-map', 'aerial-status',
      'aerial-badge', 'photos-count', 'select-imagery', 'imagery-desc', 'imagery-licence',
      'select-radius', 'btn-reload-photos', 'photos-empty', 'photos-loading', 'photo-grid',
      'photos-sub', 'photos-credits', 'btn-copy-coords', 'btn-copy-address', 'btn-favorite',
      'btn-select', 'btn-route', 'sources-body', 'history-list', 'history-empty',
      'btn-clear-history', 'fav-list', 'fav-empty', 'sel-list', 'sel-empty', 'fav-count',
      'sel-count', 'btn-export-selection', 'btn-show-selection', 'btn-clear-favorites',
      'lightbox', 'lightbox-stage', 'lightbox-title', 'lightbox-meta', 'lightbox-credit',
      'lightbox-position', 'lightbox-prev', 'lightbox-next', 'lightbox-pano', 'lightbox-source',
      'toast-stack', 'cache-stats', 'pref-theme', 'pref-basemap', 'pref-imagery',
      'pref-nominatim', 'pref-osm-context', 'pref-precision-notes', 'import-file',
      'footer-status', 'aerial-list', 'aerial-info',
      'btn-clear-cache', 'btn-export-data', 'btn-import-data', 'btn-reset-all',
      'btn-show-selection', 'btn-export-selection', 'btn-clear-history',
      'btn-clear-favorites', 'btn-favorites', 'btn-settings', 'btn-sources',
      'btn-history', 'btn-footer-sources', 'btn-sort',
      'btn-diagnose-imagery', 'btn-diagnose-services', 'diagnostic-output',
    ].forEach((id) => { el[id] = document.getElementById(id); });
  }

  /* ================================================================= Toasts */
  function toast(message, tone, timeout) {
    const icon = {
      ok: '<path d="M4 12l5 5L20 6"/>',
      warn: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
      error: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h.01"/>',
    }[tone || 'info'];
    const node = U.el('div', { class: `toast toast--${tone || 'info'}` });
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico">${icon}</svg><span>${U.escapeHtml(message)}</span>`;
    el['toast-stack'].appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 220);
    }, timeout || 3800);
  }

  function setFooterStatus(text) {
    if (el['footer-status']) el['footer-status'].textContent = text;
  }

  /* ================================================================= Thème */
  function prefersDark() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_) { return false; }
  }

  function applyTheme() {
    const prefs = STORE.getPrefs();
    const mode = prefs.theme || 'auto';
    const dark = mode === 'dark' || (mode === 'auto' && prefersDark());
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  /* ============================================================ Modales */
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    const focusable = modal.querySelector('button, [href], input, select, textarea');
    if (focusable) setTimeout(() => focusable.focus(), 40);
    lastFocused = document.activeElement;
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = true;
    if (!document.querySelector('.modal:not([hidden]), .lightbox:not([hidden])')) {
      document.body.style.overflow = '';
    }
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }
  let lastFocused = null;

  function closeTopOverlay() {
    const light = document.getElementById('lightbox');
    if (light && !light.hidden) { closeLightbox(); return true; }
    const open = Array.from(document.querySelectorAll('.modal:not([hidden])')).pop();
    if (open) { closeModal(open.id); return true; }
    return false;
  }

  /* ============================================================== Recherche */
  function setLoading(on) {
    state.loading = on;
    el['map-loading'].hidden = !on;
    el['results-skeleton'].hidden = !on;
    if (on) {
      el['results-empty'].hidden = true;
      el['results-message'].hidden = true;
      el['results-list'].innerHTML = '';
      el['btn-search'].disabled = true;
      setFooterStatus('Recherche en cours…');
    } else {
      el['btn-search'].disabled = false;
    }
  }

  function clearSearch(keepInput) {
    if (state.controllers.search) state.controllers.search.abort();
    state.results = [];
    state.parts = null;
    state.selected = null;
    state.context = null;
    state.matchedBuilding = null;
    state.photos = [];
    state.photoLoadedFor = null;
    if (mainMap) { mainMap.clearFocus(); mainMap.showResults([], null, null); }
    el['results-list'].innerHTML = '';
    el['results-empty'].hidden = false;
    el['results-message'].hidden = true;
    el['results-toolbar'].hidden = true;
    el['results-count'].textContent = 'Aucune recherche pour l’instant';
    el['search-parse'].textContent = '';
    el['btn-clear-search'].disabled = true;
    el['btn-export'].disabled = true;
    el['detail-actions'].hidden = true;
    el['detail-card'].innerHTML = '<p class="placeholder">Sélectionnez un résultat pour afficher la fiche détaillée du bâtiment : adresse complète, coordonnées GPS, précision et informations OpenStreetMap.</p>';
    el['readout-gps'].textContent = '—';
    el['photos-count'].hidden = true;
    el['photos-sub'].textContent = 'Aucune recherche — les photos seront recherchées autour du bâtiment sélectionné.';
    el['photo-grid'].innerHTML = '';
    el['photos-empty'].hidden = true;
    el['aerial-badge'].hidden = true;
    el['select-radius'].value = String(STORE.getPrefs().photoRadius || 60);
    el['btn-reload-photos'].disabled = true;
    if (aerialView && aerialView.map) { aerialView.map.remove(); aerialView.map = null; aerialView.layer = null; aerialView.target = null; }
    if (detailMarker && detailMap) { detailMap.removeLayer(detailMarker); detailMarker = null; }
    if (!keepInput) {
      el['search-input'].value = '';
      el['btn-clear'].hidden = true;
    }
    setFooterStatus('Prêt');
  }

  async function runSearch(query) {
    const q = String(query || '').trim();
    if (!q) {
      el['search-input'].focus();
      toast('Saisissez une entreprise, une adresse, une rue, un code postal ou une ville.', 'warn');
      return;
    }
    hideSuggestions();
    if (state.controllers.search) state.controllers.search.abort();
    state.controllers.search = new AbortController();

    el['search-input'].value = q;
    el['btn-clear'].hidden = false;
    state.query = q;

    const parts = SEARCH.parseQuery(q);
    state.parts = parts;
    el['search-parse'].textContent = 'Interprétation : ' + SEARCH.describeQuery(parts);

    setLoading(true);
    const started = performance.now();

    try {
      const res = await SEARCH.search(q, { center: mainMap ? mainMap.getCenter() : null, signal: state.controllers.search.signal });
      state.results = res.results;
      renderResults();
      STORE.addHistory({ query: q, count: res.results.length, label: res.results[0] ? (res.results[0].name || '') : '' });

      const ms = Math.round(performance.now() - started);
      setFooterStatus(`${res.results.length} résultat${res.results.length > 1 ? 's' : ''} · ${ms} ms`);

      if (res.results.length === 1) selectResult(res.results[0], { zoom: 18 });
      else if (res.results.length > 1) mainMap.showResults(res.results, null, (r) => selectResult(r));

      if (!res.results.length) {
        showResultsMessage(`<strong>Aucun résultat pour « ${U.escapeHtml(q)} ».</strong><br>Vérifiez l’orthographe, essayez sans le numéro de rue, ou ajoutez la ville (« Renault Paris »).`);
      } else if (res.partial) {
        const failed = res.errors.map((e) => e.provider === 'nominatim' ? 'Nominatim' : e.provider).join(', ');
        toast(`Résultats partiels : ${failed} n’a pas répondu. Photon a fourni les résultats affichés.`, 'warn', 6000);
      }
    } catch (e) {
      if (e && e.code === 'abort') return;
      renderResults();
      showResultsMessage(`<strong>La recherche a échoué.</strong><br>${U.escapeHtml(e.message || 'Erreur inconnue')}<br>Vérifiez votre connexion Internet : les recherches utilisent des services externes.`, true);
      setFooterStatus('Erreur de recherche');
    } finally {
      setLoading(false);
    }
  }

  function showResultsMessage(html, isError) {
    el['results-message'].innerHTML = html;
    el['results-message'].className = 'results-message' + (isError ? ' results-message--error' : '');
    el['results-message'].hidden = false;
  }

  /* ============================================================ Suggestions */
  const requestSuggestions = U.debounce(async (q) => {
    if (!q || q.length < 3) { hideSuggestions(); return; }
    try {
      const center = mainMap ? mainMap.getCenter() : null;
      suggestions = await SEARCH.suggest(q, center ? { lat: center.lat, lon: center.lon } : {});
      renderSuggestions();
    } catch (_) { hideSuggestions(); }
  }, 300);

  function renderSuggestions() {
    const list = el['suggestions-list'];
    list.innerHTML = '';
    activeSuggestion = -1;
    if (!suggestions.length) { hideSuggestions(); return; }

    suggestions.forEach((s, i) => {
      const li = U.el('li', {
        class: 'suggestion',
        role: 'option',
        id: 'sugg-' + i,
        dataset: { index: String(i) },
      });
      const kind = s.kind === 'poi' ? 'shop' : s.kind === 'address' ? 'home' : s.kind === 'road' ? 'road' : 'place';
      const iconPath = {
        shop: '<path d="M4 9h16l-1 11H5L4 9z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
        home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
        road: '<path d="M6 20L9 4M18 20L15 4M12 5v3M12 12v3M12 19v2"/>',
        place: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
      }[kind];
      const sub = U.formatAddress(s.address) || (s.address.city || s.address.region || '');
      li.innerHTML = `
        <span class="suggestion__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg></span>
        <span class="suggestion__body">
          <span class="suggestion__title">${U.escapeHtml(s.name || s.label || 'Lieu')}</span>
          <span class="suggestion__sub">${U.escapeHtml(sub || s.label || '')}</span>
        </span>`;
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); chooseSuggestion(i); });
      list.appendChild(li);
    });

    const footer = U.el('li', { class: 'suggestions__footer' });
    footer.innerHTML = 'Suggestions issues de <strong>Photon</strong> (OpenStreetMap) — appuyez sur Entrée pour lancer la recherche complète';
    list.appendChild(footer);

    list.hidden = false;
    el['search-input'].setAttribute('aria-expanded', 'true');
  }

  function hideSuggestions() {
    el['suggestions-list'].hidden = true;
    el['suggestions-list'].innerHTML = '';
    el['search-input'].setAttribute('aria-expanded', 'false');
    el['search-input'].removeAttribute('aria-activedescendant');
    activeSuggestion = -1;
  }

  function chooseSuggestion(index) {
    const s = suggestions[index];
    if (!s) return;
    hideSuggestions();
    el['search-input'].value = s.name || s.label || '';
    state.results = [s];
    renderResults();
    selectResult(s, { zoom: 18 });
    setFooterStatus('Suggestion sélectionnée');
  }

  function moveSuggestion(delta) {
    const items = Array.from(el['suggestions-list'].querySelectorAll('.suggestion'));
    if (!items.length) return;
    activeSuggestion = (activeSuggestion + delta + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('is-active', i === activeSuggestion));
    const active = items[activeSuggestion];
    el['search-input'].setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }

  /* ======================================================== Rendu résultats */
  function visibleResults() {
    let list = state.results.slice();
    if (state.hideApproximate) list = list.filter((r) => r.precision !== 'approximate');
    if (state.sortMode === 'name') {
      list.sort((a, b) => U.normalize(a.name || a.label).localeCompare(U.normalize(b.name || b.label), 'fr'));
    } else if (state.sortMode === 'distance' && mainMap) {
      const c = mainMap.getCenter();
      list.sort((a, b) => U.distance(c.lat, c.lon, a.lat, a.lon) - U.distance(c.lat, c.lon, b.lat, b.lon));
    }
    return list;
  }

  function renderResults() {
    const list = el['results-list'];
    const results = visibleResults();
    list.innerHTML = '';
    el['results-empty'].hidden = true;
    el['results-message'].hidden = true;

    if (!state.results.length) {
      el['results-empty'].hidden = false;
      el['results-count'].textContent = 'Aucun résultat';
      el['results-toolbar'].hidden = true;
      el['btn-export'].disabled = true;
      return;
    }

    el['results-toolbar'].hidden = false;
    el['btn-export'].disabled = false;
    el['btn-clear-search'].disabled = false;
    const approximate = state.results.filter((r) => r.precision === 'approximate').length;
    el['results-count'].textContent = `${state.results.length} résultat${state.results.length > 1 ? 's' : ''}`
      + (approximate ? ` · dont ${approximate} approximatif${approximate > 1 ? 's' : ''}` : '');

    if (!results.length) {
      showResultsMessage('Tous les résultats sont masqués par le filtre « approximatif ». Désactivez le filtre pour les revoir.');
      return;
    }

    results.forEach((r) => {
      const p = GEO.helpers.precisionLabel(r.precision);
      // Numéro identique à celui du marqueur sur la carte (même liste filtrée/triée)
      const idx = results.indexOf(r) + 1;
      const isFav = STORE.isFavorite(r.id);
      const card = U.el('li', {
        class: 'result-card' + (state.selected && state.selected.id === r.id ? ' is-selected' : ''),
        dataset: { id: r.id },
        tabindex: '0',
        role: 'button',
        'aria-label': `${r.name || r.label || 'Résultat'} — ${U.formatAddress(r.address)}`,
      });

      const address = U.formatAddress(r.address) || r.label || '';
      const note = STORE.getPrefs().showPrecisionNotes ? p.note : '';
      const flags = [];
      if (r.osm && r.osm.id) flags.push(`OSM ${r.osm.type}/${r.osm.id}`);
      if (r.mergedFrom && r.mergedFrom.length) flags.push('recoupé par 2 sources');

      card.innerHTML = `
        <div class="result-card__index" data-tone="${p.tone}" aria-hidden="true">${idx}</div>
        <div class="result-card__body">
          <div class="result-card__title">${U.escapeHtml(r.name || address || 'Lieu sans nom')}</div>
          <div class="result-card__addr">${U.escapeHtml(address)}</div>
          <div class="result-card__meta">
            <span class="mf-badge mf-badge--${p.tone}">${p.label}</span>
            <span class="result-card__coords">${U.formatCoords(r.lat, r.lon, 5)}</span>
            ${flags.length ? `<span>· ${U.escapeHtml(flags.join(' · '))}</span>` : ''}
          </div>
        </div>
        <div class="result-card__actions">
          <button type="button" class="icon-btn ${isFav ? 'is-fav' : ''}" data-action="fav" title="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-label="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}" aria-pressed="${isFav}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.6 6.1.8-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.9l6.1-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
          </button>
        </div>
        ${note ? `<div class="result-card__note">${U.escapeHtml(note)}</div>` : ''}`;

      card.addEventListener('click', (ev) => {
        const btn = ev.target.closest('[data-action="fav"]');
        if (btn) { ev.stopPropagation(); toggleFavorite(r); return; }
        selectResult(r);
      });
      card.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectResult(r); }
      });
      list.appendChild(card);
    });

    // Aucun résultat en cache ne doit rester sélectionné sans carte
    if (state.selected) refreshCardSelection();
  }

  function refreshCardSelection() {
    U.$$('.result-card', el['results-list']).forEach((c) => {
      c.classList.toggle('is-selected', !!state.selected && c.dataset.id === state.selected.id);
    });
  }

  /* ============================================================== Sélection */
  async function selectResult(result, opts) {
    const o = opts || {};
    state.selected = result;
    state.matchedBuilding = null;
    state.matchConfidence = null;
    state.context = null;
    state.photoLoadedFor = null;
    state.photos = [];
    refreshCardSelection();

    el['detail-actions'].hidden = false;
    el['readout-gps'].textContent = U.formatCoords(result.lat, result.lon);
    el['btn-reload-photos'].disabled = false;
    const fav = STORE.isFavorite(result.id);
    el['btn-favorite'].setAttribute('aria-pressed', String(fav));
    el['btn-favorite'].classList.toggle('is-active', fav);
    el['btn-route'].href = CFG.EXTERNAL.osmDirections(result.lat, result.lon);
    el['btn-route'].title = 'Calculer un itinéraire vers ce bâtiment (OpenStreetMap)';

    mainMap.showResults(visibleResults(), result.id, (r) => selectResult(r));
    mainMap.focus(result, { zoom: o.zoom || 18 });

    renderDetail();

    // Aerial : rechargement si l'onglet est visible
    if (state.activeTab === 'aerial') renderAerial();
    else el['aerial-badge'].hidden = true;

    if (state.activeTab === 'photos') loadPhotos();

    // Qualification par Overpass (emprise + POI) — non bloquante
    if (STORE.getPrefs().osmContextEnabled) {
      loadContext(result);
    }
  }

  async function loadContext(result) {
    const token = U.uid('ctx');
    state.ctxToken = token;
    try {
      const ctx = await OV.context(result.lat, result.lon);
      if (state.ctxToken !== token || !state.selected || state.selected.id !== result.id) return;
      state.context = ctx;
      const match = OV.matchBuilding(result, ctx.buildings);
      if (match && (match.confidence === 'high' || match.confidence === 'medium')) {
        state.matchedBuilding = match.building;
        state.matchConfidence = match.confidence;
        // Mise à jour honnête de la précision affichée
        result.precision = 'centroid';
        result.precisionNote = `Emprise du bâtiment trouvée (${Math.round(match.building.area)} m²).`
          + (match.confidence === 'high' ? ' Adresse et géométrie concordantes.' : ' Appariement probable, à vérifier visuellement.');
        result.matched = { confidence: match.confidence, distance: match.distance, reasons: match.reasons };
        mainMap.setFootprint(match.building);
        if (mainMap.marker) mainMap.marker.setPopupContent(mainMap._popupHtml(result));
        renderResults();
        refreshCardSelection();
        renderDetail();
        if (state.activeTab === 'aerial') renderAerial();
        updateAerialInfo();
      } else if (ctx.buildings.length) {
        // Emprise trouvée mais non concluante : on le dit
        result.matched = null;
        state.matchNote = `${ctx.buildings.length} bâtiment(s) détecté(s) à moins de 30 m, sans correspondance d’adresse fiable. La position reste celle du géocodeur.`;
        renderDetail();
      }
    } catch (e) {
      if (state.ctxToken !== token) return;
      state.context = null;
      state.matchNote = e && e.code === 'abort' ? null
        : `Emprise du bâtiment non récupérée (${e.message}) — la position affichée est celle du géocodeur.`;
      renderDetail();
    }
  }

  /* ========================================================== Fiche détail */
  function renderDetail() {
    const r = state.selected;
    if (!r) return;
    const p = GEO.helpers.precisionLabel(r.precision);
    const addr = r.address || {};
    const building = state.matchedBuilding;

    const rows = [];
    const push = (label, value, cls) => { if (value) rows.push({ label, value, cls }); };
    push('Adresse', U.formatAddress(addr) || r.label);
    push('Numéro', addr.housenumber);
    push('Rue', addr.street);
    push('Code postal', addr.postcode);
    push('Ville', addr.city);
    push('Quartier', addr.district);
    push('Région', addr.region);
    push('Pays', addr.country);
    push('Coordonnées', U.formatCoords(r.lat, r.lon), 'mono');
    if (building) {
      push('Emprise', `${U.formatSurface(building.area)}${building.type ? ' · ' + building.type : ''}`);
      if (building.levels) push('Niveaux', String(building.levels));
    }
    if (r.osm && r.osm.id) {
      push('Objet OSM', `${r.osm.type}/${r.osm.id}`, 'mono');
    }
    push('Source', r.providerLabel + (r.licence ? ' · ODbL' : ''));

    const extras = [];
    if (r.extra) {
      if (r.extra.phone) extras.push({ k: 'Téléphone', v: r.extra.phone, href: 'tel:' + r.extra.phone.replace(/\s/g, '') });
      if (r.extra.website) extras.push({ k: 'Site web', v: r.extra.website, href: normalizeUrl(r.extra.website) });
      if (r.extra.opening_hours) extras.push({ k: 'Horaires', v: r.extra.opening_hours });
      if (r.extra.brand) extras.push({ k: 'Marque', v: r.extra.brand });
    }
    const nearbyPois = (state.context && state.context.pois || [])
      .map((poi) => ({ poi, d: U.distance(r.lat, r.lon, poi.lat, poi.lon) }))
      .filter((x) => x.d < 120 && U.normalize(x.poi.name) !== U.normalize(r.name))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);

    const links = EXP.linksFor(r);

    el['detail-card'].innerHTML = `
      <div class="info-head">
        <div class="info-head__body">
          <h3>${U.escapeHtml(r.name || addr.street || 'Bâtiment')}</h3>
          <p class="info-head__addr">${U.escapeHtml(U.formatAddress(addr) || r.label || '')}</p>
        </div>
        <span class="mf-badge mf-badge--${p.tone}">${p.label}</span>
      </div>
      <dl class="info-rows">
        ${rows.map((row) => `<div class="info-row"><dt>${U.escapeHtml(row.label)}</dt><dd${row.cls ? ` class="${row.cls}"` : ''}>${U.escapeHtml(row.value)}</dd></div>`).join('')}
        ${extras.map((x) => `<div class="info-row"><dt>${U.escapeHtml(x.k)}</dt><dd>${x.href ? `<a href="${U.escapeHtml(x.href)}" target="_blank" rel="noopener">${U.escapeHtml(x.v)}</a>` : U.escapeHtml(x.v)}</dd></div>`).join('')}
        ${nearbyPois.length ? `<div class="info-row"><dt>À proximité</dt><dd>${nearbyPois.map((x) => `${U.escapeHtml(x.poi.name)} <span style="color:var(--c-ink-4);font-weight:400">(${U.formatDistance(x.d)})</span>`).join(' · ')}</dd></div>` : ''}
        <div class="info-row"><dt>Liens</dt><dd>${links.map((l) => `<a href="${U.escapeHtml(l.url)}" target="_blank" rel="noopener">${U.escapeHtml(l.label)}</a>`).join(' · ')}</dd></div>
      </dl>
      ${STORE.getPrefs().showPrecisionNotes ? `<div class="precision-note precision-note--${p.tone}"><strong>Précision — ${p.label}.</strong> ${U.escapeHtml(r.precisionNote || p.note)}${r.matched && r.matched.distance > 25 ? ` Écart de ${Math.round(r.matched.distance)} m entre le point du géocodeur et le centre du bâtiment.` : ''}${state.matchNote ? ' ' + U.escapeHtml(state.matchNote) : ''}</div>` : ''}
    `;

    renderDetailMap(r);
  }

  function normalizeUrl(url) {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : 'https://' + url;
  }

  function renderDetailMap(r) {
    if (!detailMap) {
      detailMap = L.map(el['detail-map'], { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
      detailMap.attributionControl.setPrefix('');
      L.tileLayer(CFG.BASEMAPS[STORE.getPrefs().basemap] ? CFG.BASEMAPS[STORE.getPrefs().basemap].url : CFG.BASEMAPS.osm.url, {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(detailMap);
    }
    detailMap.invalidateSize();
    if (detailMarker) detailMap.removeLayer(detailMarker);
    detailMarker = L.marker([r.lat, r.lon]).addTo(detailMap);
    if (state.matchedBuilding) {
      L.polygon(state.matchedBuilding.ring, { color: '#0f9d58', weight: 2, fillOpacity: 0.15 }).addTo(detailMap);
      detailMap.fitBounds(L.latLngBounds(state.matchedBuilding.ring), { padding: [24, 24], maxZoom: 19 });
    } else {
      detailMap.setView([r.lat, r.lon], 18);
    }
  }

  /* ================================================================ Onglets */
  function switchTab(tab) {
    state.activeTab = tab;
    ['map', 'aerial', 'photos'].forEach((t) => {
      const btn = document.getElementById('tab-btn-' + t);
      const panel = document.getElementById('tab-' + t);
      const active = t === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });

    if (tab === 'aerial') {
      if (detailMap) detailMap.invalidateSize();
      renderAerial();
    } else if (tab === 'photos') {
      if (!state.photoLoadedFor && state.selected) loadPhotos();
    } else if (tab === 'map') {
      if (detailMap) setTimeout(() => detailMap.invalidateSize(), 80);
    }
    document.dispatchEvent(new CustomEvent('mf:tab', { detail: { tab } }));
  }

  /* ============================================================ Vue aérienne */
  function fillImagerySelect() {
    const options = CFG.IMAGERY.providers.map((p) => `<option value="${p.id}">${U.escapeHtml(p.label)}</option>`).join('');
    el['select-imagery'].innerHTML = options;
    const pref = STORE.getPrefs();
    el['select-imagery'].value = pref.imagery || 'ign-ortho';
    el['pref-imagery'].innerHTML = options;
    el['pref-imagery'].value = pref.imagery || 'ign-ortho';
    updateImageryDescription();
  }

  function updateImageryDescription() {
    const id = el['select-imagery'].value;
    const p = CFG.IMAGERY.providers.find((x) => x.id === id);
    if (!p) return;
    el['imagery-desc'].textContent = p.description || '';
    el['imagery-licence'].textContent = `Licence : ${p.licence}. Attribution : ${p.attribution.replace(/&copy;/g, '©')}`;
  }

  function renderAerial() {
    const r = state.selected;
    if (!r) {
      el['aerial-status'].textContent = 'Sélectionnez un bâtiment pour afficher sa vue aérienne.';
      el['aerial-status'].className = 'aerial-status';
      return;
    }
    if (!aerialView) aerialView = new AERIAL.SatelliteView('aerial-map');
    aerialView.invalidate();

    const providerId = el['select-imagery'].value || STORE.getPrefs().imagery;
    aerialView._lastBuilding = state.matchedBuilding;

    aerialView.show(r, {
      building: state.matchedBuilding,
      onStatus: (s) => {
        const box = el['aerial-status'];
        if (s.state === 'loading') {
          box.className = 'aerial-status';
          box.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Recherche de l’imagerie aérienne la plus précise…</span>';
        } else if (s.state === 'ready') {
          box.className = 'aerial-status is-ok';
          box.innerHTML = `<span><strong>${U.escapeHtml(s.provider.label)}</strong><small>${U.escapeHtml(s.provider.attribution.replace(/&copy;/g, '©'))}</small></span>`;
          el['aerial-badge'].hidden = true;
          updateAerialInfo(s.provider);
        } else if (s.state === 'unavailable') {
          box.className = 'aerial-status is-warn';
          box.innerHTML = `<span><strong>${U.escapeHtml(s.message)}</strong><small>${U.escapeHtml(s.detail || '')}</small></span>`;
          el['aerial-badge'].hidden = false;
          el['aerial-badge'].title = s.message;
          updateAerialInfo(null);
        }
      },
    }).catch((e) => {
      el['aerial-status'].className = 'aerial-status is-error';
      el['aerial-status'].textContent = 'Impossible de charger l’imagerie aérienne : ' + (e.message || 'erreur inconnue');
    });
  }

  function updateAerialInfo(provider) {
    const r = state.selected;
    if (!r) return;
    const b = state.matchedBuilding;
    const items = [];
    if (b) {
      items.push(`<strong>Emprise du bâtiment</strong> connue dans OpenStreetMap : ${U.formatSurface(b.area)}${b.type ? ' (' + U.escapeHtml(b.type) + ')' : ''}. Contour jaune sur l’image.`);
    } else {
      items.push('Aucune emprise de bâtiment dans OpenStreetMap : le repère indique la position du géocodeur, pas le contour exact du toit.');
    }
    items.push('Le toit, les bâtiments voisins, les routes et les parcelles sont visibles sur l’orthophotographie.');
    items.push('Un clic sur l’image place un second repère et mesure la distance et l’azimut depuis le marqueur.');
    if (provider) items.push(`Imagerie : <strong>${U.escapeHtml(provider.label)}</strong> — ${U.escapeHtml(provider.licence)}.`);
    el['aerial-list'].innerHTML = items.map((i) => `<li>${i}</li>`).join('');
  }

  /* ================================================================ Photos */
  async function loadPhotos(force) {
    const r = state.selected;
    if (!r) return;
    if (state.photoLoading) return;
    if (!force && state.photoLoadedFor === r.id) return;

    const radius = Number(el['select-radius'].value) || 60;
    STORE.setPref('photoRadius', radius);

    state.photoLoading = true;
    el['photos-loading'].hidden = false;
    el['photos-empty'].hidden = true;
    el['photo-grid'].innerHTML = '';
    el['photos-sub'].textContent = `Recherche dans un rayon de ${radius} m autour de ${r.name || U.formatAddress(r.address) || 'du bâtiment'}…`;
    if (state.controllers.photos) state.controllers.photos.abort();
    state.controllers.photos = new AbortController();

    try {
      const res = await STREET.findPhotos(r.lat, r.lon, { radius, signal: state.controllers.photos.signal });
      state.photos = res.photos;
      state.photoIndex = 0;
      state.photoLoadedFor = r.id;
      el['photo-grid'].innerHTML = '';

      if (!state.photos.length) {
        el['photos-empty'].hidden = false;
        el['photos-sub'].textContent = `Rayon ${radius} m — aucune photographie géolocalisée trouvée.`;
        el['photos-count'].hidden = true;
        el['photos-credits'].innerHTML = creditLine();
        return;
      }

      el['photos-count'].hidden = false;
      el['photos-count'].textContent = String(state.photos.length);
      el['photos-sub'].textContent = `${state.photos.length} photographie${state.photos.length > 1 ? 's' : ''} géolocalisée${state.photos.length > 1 ? 's' : ''} dans un rayon de ${radius} m. `
        + `Elles montrent la rue : la façade peut être partiellement masquée ou absente du champ.`;

      state.photos.forEach((ph, i) => {
        const card = U.el('li', { class: 'photo-card', tabindex: '0', role: 'button', 'aria-label': `Agrandir la photo ${i + 1} — ${ph.providerLabel}` });
        card.innerHTML = `
          <div class="photo-card__media">
            <img src="${U.escapeHtml(ph.thumb || ph.url)}" alt="Photographie de rue ${U.escapeHtml(ph.viewLabel)} — ${U.escapeHtml(ph.providerLabel)}" loading="lazy" referrerpolicy="no-referrer">
            <span class="photo-card__badge ${ph.is360 ? 'photo-card__badge--360' : ''}">${ph.is360 ? '360°' : U.escapeHtml(ph.providerLabel)}</span>
            <span class="photo-card__dist">${U.formatDistance(ph.distance)}</span>
          </div>
          <div class="photo-card__body">
            <span class="photo-card__view">${U.escapeHtml(ph.viewLabel)}</span>
            <span class="photo-card__meta">${U.escapeHtml(ph.author)} · ${U.escapeHtml(formatDateShort(ph.date))}</span>
            <span class="photo-card__meta">Licence <a href="${U.escapeHtml(ph.licenceUrl || '#')}" target="_blank" rel="noopener">${U.escapeHtml(ph.licence)}</a></span>
          </div>`;
        const open = () => openLightbox(i);
        card.addEventListener('click', open);
        card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); } });
        el['photo-grid'].appendChild(card);
      });

      el['photos-credits'].innerHTML = creditLine();
      if (res.warnings.length) toast(res.warnings[0], 'warn', 6000);
    } catch (e) {
      if (e && e.code === 'abort') return;
      el['photos-empty'].hidden = false;
      el['photos-sub'].textContent = 'La recherche de photographies a échoué.';
      el['photos-credits'].innerHTML = `Erreur : ${U.escapeHtml(e.message)}`;
    } finally {
      state.photoLoading = false;
      el['photos-loading'].hidden = true;
    }
  }

  function creditLine() {
    return 'Photographies fournies par <a href="https://panoramax.fr" target="_blank" rel="noopener">Panoramax</a> '
      + '(Licence Ouverte / CC BY-SA selon l’instance) et <a href="https://kartaview.org" target="_blank" rel="noopener">KartaView</a> (CC BY-SA 4.0). '
      + 'Chaque image est créditée à son auteur et renvoie à sa fiche d’origine. Aucune image générique n’est présentée comme une photo du bâtiment.';
  }

  function formatDateShort(iso) {
    if (!iso) return 'date inconnue';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'date inconnue';
    return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  }

  /* =============================================================== Lightbox */
  let panoViewer = null;

  function openLightbox(index) {
    state.photoIndex = index;
    renderLightbox();
    el['lightbox'].hidden = false;
    document.body.style.overflow = 'hidden';
    el['lightbox-next'].focus();
  }

  function renderLightbox() {
    const ph = state.photos[state.photoIndex];
    if (!ph) return;
    if (panoViewer) { try { panoViewer.destroy(); } catch (_) {} panoViewer = null; }
    el['lightbox-stage'].innerHTML = '';

    if (ph.is360) {
      el['lightbox-pano'].hidden = false;
      const delta = signedDelta(ph.bearingToTarget, ph.azimuth || 0);
      const stage = U.el('div', { id: 'pano-stage' });
      el['lightbox-stage'].appendChild(stage);
      try {
        panoViewer = pannellum.viewer(stage, {
          type: 'equirectangular',
          panorama: ph.url,
          autoLoad: true,
          showControls: true,
          compass: true,
          yaw: delta,
          pitch: -4,
          hfov: 95,
          backgroundColor: [10, 14, 19],
        });
      } catch (_) {
        el['lightbox-stage'].innerHTML = `<img src="${U.escapeHtml(ph.url)}" alt="Panorama 360°">`;
      }
    } else {
      el['lightbox-pano'].hidden = true;
      const img = U.el('img', {
        src: ph.url,
        alt: `Photographie de rue — ${ph.providerLabel}`,
        referrerpolicy: 'no-referrer',
      });
      el['lightbox-stage'].appendChild(img);
    }

    el['lightbox-title'].textContent = ph.viewLabel;
    el['lightbox-meta'].textContent = `${ph.providerLabel} · ${formatDateShort(ph.date)} · ${U.formatDistance(ph.distance)} du bâtiment`
      + (ph.azimuth !== null && ph.azimuth !== undefined ? ` · cap caméra ${Math.round(ph.azimuth)}°` : ' · cap caméra inconnu');
    el['lightbox-credit'].innerHTML = `Auteur : ${U.escapeHtml(ph.author)} · Licence <a href="${U.escapeHtml(ph.licenceUrl || '#')}" target="_blank" rel="noopener">${U.escapeHtml(ph.licence)}</a> · ${U.escapeHtml(ph.attribution || '')}`;
    el['lightbox-position'].innerHTML = `Position de la photo : ${U.formatCoords(ph.lat, ph.lon, 5)} · `
      + `<a href="https://api.panoramax.xyz/#focus=pic&pic=${U.escapeHtml(ph.uid || '')}" target="_blank" rel="noopener">fiche d’origine</a>`;
    el['lightbox-source'].href = ph.viewerUrl || ph.pageUrl || '#';
    el['lightbox-prev'].hidden = state.photos.length < 2;
    el['lightbox-next'].hidden = state.photos.length < 2;
  }

  function signedDelta(a, b) {
    let d = ((a - b + 540) % 360) - 180;
    return d;
  }

  function stepLightbox(delta) {
    if (!state.photos.length) return;
    state.photoIndex = (state.photoIndex + delta + state.photos.length) % state.photos.length;
    renderLightbox();
  }

  function closeLightbox() {
    el['lightbox'].hidden = true;
    if (panoViewer) { try { panoViewer.destroy(); } catch (_) {} panoViewer = null; }
    el['lightbox-stage'].innerHTML = '';
    if (!document.querySelector('.modal:not([hidden])')) document.body.style.overflow = '';
  }

  /* ============================================================== Favoris */
  function toggleFavorite(result) {
    const res = STORE.toggleFavorite(result);
    toast(res.added ? 'Ajouté aux favoris.' : 'Retiré des favoris.', res.added ? 'ok' : 'info');
    renderResults();
    if (state.selected && state.selected.id === result.id) {
      el['btn-favorite'].setAttribute('aria-pressed', String(res.added));
      el['btn-favorite'].classList.toggle('is-active', res.added);
    }
    renderFavorites();
  }

  function renderFavorites() {
    const favs = STORE.getFavorites();
    const sel = STORE.getSelection();
    el['fav-count'].textContent = String(favs.length);
    el['sel-count'].textContent = String(sel.length);
    el['fav-empty'].hidden = favs.length > 0;
    el['sel-empty'].hidden = sel.length > 0;

    el['fav-list'].innerHTML = favs.map((f) => `
      <li class="fav-item">
        <span class="fav-item__q">${U.escapeHtml(f.name || U.formatAddress(f.address) || f.label || 'Lieu')}</span>
        <span class="fav-item__meta">${U.escapeHtml(U.formatAddress(f.address) || '')}</span>
        <button type="button" class="btn btn--soft btn--sm fav-item__go" data-fav="${U.escapeHtml(f.id)}">Afficher</button>
      </li>`).join('');

    el['sel-list'].innerHTML = sel.map((s, i) => `
      <li class="fav-item">
        <span class="count-pill">${i + 1}</span>
        <span class="fav-item__q">${U.escapeHtml(s.name || U.formatAddress(s.address) || s.label || 'Lieu')}</span>
        <span class="fav-item__meta">${U.formatCoords(s.lat, s.lon, 4)}</span>
      </li>`).join('');

    U.$$('[data-fav]', el['fav-list']).forEach((btn) => {
      btn.addEventListener('click', () => {
        const fav = STORE.getFavorites().find((f) => f.id === btn.dataset.fav);
        if (!fav) return;
        closeModal('modal-favorites');
        const asResult = Object.assign({}, fav, {
          address: fav.address || GEO.helpers.emptyAddress(),
          provider: fav.provider || 'favori',
          providerLabel: 'Favori local',
          licence: 'sauvegarde locale',
        });
        selectResult(asResult);
      });
    });

    el['btn-export-selection'].disabled = !sel.length;
    el['btn-show-selection'].disabled = !sel.length;
  }

  /* ============================================================ Historique */
  function renderHistory() {
    const h = STORE.getHistory();
    el['history-empty'].hidden = h.length > 0;
    el['history-list'].innerHTML = h.map((e) => `
      <li class="history-item">
        <span class="history-item__q">${U.escapeHtml(e.query)}</span>
        <span class="history-item__meta">${e.count} rés. · ${new Date(e.at).toLocaleDateString('fr-FR')}</span>
        <button type="button" class="btn btn--soft btn--sm history-item__go" data-q="${U.escapeHtml(e.query)}">Relancer</button>
      </li>`).join('');
    U.$$('[data-q]', el['history-list']).forEach((btn) => {
      btn.addEventListener('click', () => {
        closeModal('modal-history');
        el['search-input'].value = btn.dataset.q;
        runSearch(btn.dataset.q);
      });
    });
  }

  /* =============================================================== Sources */
  function renderSources() {
    const rows = [];

    rows.push(`<div class="source-note">
      <strong>Ce que MAPFINDER ne promet pas.</strong> La position d’un bâtiment dépend d’OpenStreetMap.
      Quand l’emprise du bâtiment existe, l’application l’affiche et le dit ; sinon elle affiche la position
      du géocodeur avec la mention « approximatif ». Aucune vue aérienne n’est simulée, aucune photographie
      générique n’est présentée comme celle du bâtiment.
    </div>`);

    const add = (title, badge, body, dl) => {
      rows.push(`<div class="source-card">
        <div class="source-card__head"><h3>${U.escapeHtml(title)}</h3>${badge ? `<span class="mf-badge mf-badge--${badge.tone}">${badge.text}</span>` : ''}</div>
        <div class="source-card__body">${body}${dl ? `<dl>${dl.map(([k, v]) => `<dt>${U.escapeHtml(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : ''}</div>
      </div>`);
    };

    add('OpenStreetMap — fond de carte et données', { tone: 'ok', text: 'gratuit, sans clé' },
      'Source des données géographiques. Attribution obligatoire, licence ODbL (partage à l’identique).',
      [['Site', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">openstreetmap.org/copyright</a>'],
       ['Licence', 'ODbL 1.0'],
       ['Limites', 'Tuiles réservées à un usage raisonnable : pas de préchargement massif.']]);

    add('Photon (komoot) — géocodage et suggestions', { tone: 'ok', text: 'gratuit, sans clé' },
      'Fournisseur principal : autocomplétion <em>et</em> recherche. Construit sur les données OpenStreetMap.',
      [['Site', '<a href="https://photon.komoot.io/" target="_blank" rel="noopener">photon.komoot.io</a>'],
       ['Licence', 'ODbL (données OSM)'],
       ['Limites', 'Usage raisonnable : l’application limite à une requête par seconde et met en cache 24 h.'],
       ['Pourquoi lui', 'Seul fournisseur retenu dont les conditions autorisent explicitement l’autocomplétion.']]);

    add('Nominatim (OSM Foundation) — recherche validée', { tone: 'warn', text: 'usage encadré' },
      'Utilisé <strong>uniquement</strong> au moment où vous lancez la recherche, jamais pendant la frappe.',
      [['Politique', '<a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noopener">operations.osmfoundation.org/policies/nominatim</a>'],
       ['Limites', '1 requête/seconde maximum, cache local obligatoire, autocomplétion formellement interdite.'],
       ['Identification', 'Le navigateur ne permet pas de définir un User-Agent : l’application envoie un Referer explicite, l’autre option prévue par la politique.'],
       ['Désactivation', 'Possible dans Paramètres → Sources &amp; requêtes.']]);

    add('Overpass API — emprise du bâtiment et voisinage', { tone: 'warn', text: 'peut saturer' },
      'Sert à retrouver le contour du bâtiment (<code>building=*</code>) et les commerces voisins. Une seule requête à la fois, rayon limité à 300 m.',
      [['Instances', U.escapeHtml(CFG.OVERPASS.endpoints.join(' → '))],
       ['Licence', 'ODbL'],
       ['Limites', '<a href="https://wiki.openstreetmap.org/wiki/Overpass_API" target="_blank" rel="noopener">Consigne OSM</a> : une requête en vol, bascule automatique de miroir en cas de saturation (HTTP 502/429 constaté).'],
       ['Robustesse', 'Si toutes les instances échouent, la recherche aboutit quand même : seule la précision « Bâtiment » est indisponible.']]);

    CFG.IMAGERY.providers.forEach((p) => {
      add(p.label, { tone: p.id === 'esri-world' ? 'warn' : 'ok', text: p.id === 'esri-world' ? 'conditions Esri' : 'sans clé' },
        U.escapeHtml(p.description || ''),
        [['Licence', U.escapeHtml(p.licence)],
         ['Attribution', U.escapeHtml(p.attribution.replace(/&copy;/g, '©'))],
         ['Zoom natif', String(p.maxNativeZoom || p.maxZoom)],
         ['Origine', p.id === 'esri-world'
           ? 'Gratuit pour une application non commerciale avec attribution ; au-delà, une licence Esri est requise. Désactivable en choisissant l’IGN.'
           : '<a href="https://geoservices.ign.fr" target="_blank" rel="noopener">Géoservices IGN</a> — diffusion ouverte.']]);
    });

    add('Panoramax — photographies de rue', { tone: 'ok', text: 'sans clé' },
      'Communs d’imagerie de rue fédérés (IGN, OpenStreetMap France et une vingtaine d’instances). Recherche par emprise géographique au format STAC.',
      [['Site', '<a href="https://panoramax.fr" target="_blank" rel="noopener">panoramax.fr</a>'],
       ['Licence', 'Par image : Licence Ouverte / Etalab 2.0 (instance IGN) ou CC BY-SA 4.0 (OSM-FR), affichée sur chaque photo.'],
       ['Données', 'Position, cap caméra, date, auteur, licence, champ de vision.'],
       ['Limites', 'Couverture variable : abondante en France, présente mais partielle ailleurs (Antananarivo est couvert).']]);

    add('KartaView — photographies de rue (secours)', { tone: 'ok', text: 'sans clé' },
      'Deuxième source de photos. Seules les images dont le floutage des visages et des plaques est terminé sont affichées.',
      [['Site', '<a href="https://kartaview.org" target="_blank" rel="noopener">kartaview.org</a>'],
       ['Licence', 'CC BY-SA 4.0'],
       ['Limites', '≈ 100 requêtes/heure sans jeton ; l’application limite à deux requêtes simultanées.']]);

    rows.push(`<div class="source-card">
      <div class="source-card__head"><h3>Sources volontairement écartées</h3><span class="mf-badge mf-badge--neutral">hors périmètre</span></div>
      <div class="source-card__body">
        Google Maps Platform, Mapbox, Bing Maps, Here, TomTom : comptes, clés ou facturation.
        Google Street View : facturation. Mapillary : gratuit mais exige un jeton de compte, donc non intégré (aucune source
        nécessitant un compte n’est utilisée). Aucun scraping de page n’est effectué : uniquement des API publiques documentées.
      </div>
    </div>`);

    rows.push(`<div class="source-card">
      <div class="source-card__head"><h3>Usage local et données personnelles</h3></div>
      <div class="source-card__body">
        L’application fonctionne depuis votre machine et n’envoie vos requêtes qu’aux services cités ci-dessus.
        Historique, favoris, préférences et cache restent dans le stockage local de votre navigateur et peuvent être
        effacés à tout moment (Paramètres → Données locales).
      </div>
    </div>`);

    el['sources-body'].innerHTML = rows.join('');
  }

  /* ============================================================== Bandeau */
  const failing = new Map();
  function updateServiceBanner() {
    const names = { photon: 'Photon', nominatim: 'Nominatim', overpass: 'Overpass', panoramax: 'Panoramax', kartaview: 'KartaView' };
    const list = Array.from(failing.entries()).filter(([, v]) => v === 'error' || v === 'offline');
    if (!list.length) { el['service-banner'].hidden = true; el['service-banner'].innerHTML = ''; return; }
    el['service-banner'].hidden = false;
    el['service-banner'].innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" class="ico"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      <span>Service${list.length > 1 ? 's' : ''} indisponible${list.length > 1 ? 's' : ''} : <strong>${list.map(([k]) => names[k] || k).join(', ')}</strong>.
      Les autres sources restent utilisées ; certaines informations peuvent manquer.</span>`;
  }

  /* ============================================================== Export */
  function exportResults() {
    if (!state.results.length) return;
    EXP.exportCSV(state.results, { query: state.query });
    toast('Export CSV généré.', 'ok');
  }

  /* ========================================================= Evénements */
  function bindEvents() {
    /* --- Recherche --- */
    el['search-form'].addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (activeSuggestion >= 0) { chooseSuggestion(activeSuggestion); return; }
      runSearch(el['search-input'].value);
    });

    el['search-input'].addEventListener('input', () => {
      const v = el['search-input'].value.trim();
      el['btn-clear'].hidden = !el['search-input'].value;
      if (v.length < 3) hideSuggestions();
      requestSuggestions(v);
    });

    el['search-input'].addEventListener('keydown', (ev) => {
      const open = !el['suggestions-list'].hidden;
      if (ev.key === 'ArrowDown' && open) { ev.preventDefault(); moveSuggestion(1); }
      else if (ev.key === 'ArrowUp' && open) { ev.preventDefault(); moveSuggestion(-1); }
      else if (ev.key === 'Escape') { hideSuggestions(); }
      else if (ev.key === 'Enter' && activeSuggestion >= 0) { ev.preventDefault(); chooseSuggestion(activeSuggestion); }
    });

    el['search-input'].addEventListener('blur', () => setTimeout(hideSuggestions, 140));

    el['btn-clear'].addEventListener('click', () => {
      el['search-input'].value = '';
      el['btn-clear'].hidden = true;
      hideSuggestions();
      clearSearch(true);
      el['search-input'].focus();
    });

    el['btn-clear-search'].addEventListener('click', () => {
      clearSearch(false);
      hideSuggestions();
      toast('Critères effacés.', 'info');
    });

    U.$$('[data-example]').forEach((chip) => {
      chip.addEventListener('click', () => {
        el['search-input'].value = chip.dataset.example;
        el['btn-clear'].hidden = false;
        runSearch(chip.dataset.example);
      });
    });

    /* --- Résultats --- */
    el['btn-export'].addEventListener('click', exportResults);

    el['btn-sort'].addEventListener('click', () => {
      const order = ['relevance', 'name', 'distance'];
      const labels = { relevance: 'pertinence', name: 'nom', distance: 'distance à la carte' };
      state.sortMode = order[(order.indexOf(state.sortMode) + 1) % order.length];
      el['btn-sort'].title = 'Tri : ' + labels[state.sortMode];
      renderResults();
      toast('Tri par ' + labels[state.sortMode] + '.', 'info', 2200);
    });

    el['toggle-precision-filter'].addEventListener('change', (ev) => {
      state.hideApproximate = ev.target.checked;
      renderResults();
    });

    /* --- Carte --- */
    el['select-basemap'].addEventListener('change', (ev) => mainMap.setBasemap(ev.target.value));
    el['btn-recenter'].addEventListener('click', () => {
      if (!state.selected) { toast('Aucun bâtiment sélectionné.', 'warn'); return; }
      mainMap.recenter();
    });
    el['btn-fullscreen'].addEventListener('click', () => {
      mainMap.toggleFullscreen();
      setTimeout(() => mainMap.invalidate(), 400);
    });
    document.addEventListener('fullscreenchange', () => {
      el['btn-fullscreen'].setAttribute('aria-pressed', String(!!document.fullscreenElement));
      mainMap.invalidate();
    });
    document.addEventListener('mf:mapmove', U.throttle(() => {
      if (state.results.length > 1 && !state.selected) return;
    }, 400));
    document.addEventListener('mf:mapcoords', U.throttle((ev) => {
      el['readout-cursor'].textContent = 'curseur : ' + U.formatCoords(ev.detail.lat, ev.detail.lon, 5);
    }, 90));
    document.addEventListener('mf:mapclick', (ev) => {
      if (!state.selected) { toast('Sélectionnez d’abord un bâtiment pour mesurer une distance.', 'info', 2600); return; }
      mainMap.setSecondaryPoint(ev.detail.lat, ev.detail.lon);
      const d = U.distance(state.selected.lat, state.selected.lon, ev.detail.lat, ev.detail.lon);
      toast(`Mesure : ${U.formatDistance(d)} depuis le repère.`, 'info', 3200);
    });
    document.addEventListener('mf:aerialclick', (ev) => {
      if (!aerialView || !aerialView.map) return;
      const r = state.selected;
      if (!r) return;
      const d = U.distance(r.lat, r.lon, ev.detail.lat, ev.detail.lon);
      const b = U.bearing(r.lat, r.lon, ev.detail.lat, ev.detail.lon);
      L.circleMarker([ev.detail.lat, ev.detail.lon], { radius: 5, color: '#ffd54f', weight: 2, fillColor: '#111', fillOpacity: .9 }).addTo(aerialView.map);
      toast(`Depuis le repère : ${U.formatDistance(d)} vers le ${U.bearingLabel(b)}.`, 'info', 3200);
    });

    /* --- Onglets --- */
    U.$$('.tab', document.querySelector('.tabs')).forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
      btn.addEventListener('keydown', (ev) => {
        const tabs = ['map', 'aerial', 'photos'];
        const cur = tabs.indexOf(btn.dataset.tab);
        if (ev.key === 'ArrowRight') { ev.preventDefault(); const next = tabs[(cur + 1) % 3]; switchTab(next); document.getElementById('tab-btn-' + next).focus(); }
        if (ev.key === 'ArrowLeft') { ev.preventDefault(); const prev = tabs[(cur + 2) % 3]; switchTab(prev); document.getElementById('tab-btn-' + prev).focus(); }
      });
    });

    /* --- Actions fiche --- */
    el['btn-copy-coords'].addEventListener('click', async () => {
      if (!state.selected) return;
      const txt = U.formatCoords(state.selected.lat, state.selected.lon);
      const ok = await U.copyToClipboard(txt);
      toast(ok ? `Coordonnées copiées : ${txt}` : 'Copie impossible dans ce navigateur.', ok ? 'ok' : 'error');
    });
    el['btn-copy-address'].addEventListener('click', async () => {
      if (!state.selected) return;
      const txt = U.formatAddress(state.selected.address) || state.selected.label;
      const ok = await U.copyToClipboard(txt);
      toast(ok ? 'Adresse copiée.' : 'Copie impossible dans ce navigateur.', ok ? 'ok' : 'error');
    });
    el['btn-favorite'].addEventListener('click', () => { if (state.selected) toggleFavorite(state.selected); });
    el['btn-select'].addEventListener('click', () => {
      if (!state.selected) return;
      const sel = STORE.toggleSelection(state.selected);
      const active = sel.some((s) => s.id === state.selected.id);
      el['btn-select'].setAttribute('aria-pressed', String(active));
      el['btn-select'].classList.toggle('is-active', active);
      mainMap.showSelection(sel);
      renderFavorites();
      toast(active ? 'Bâtiment ajouté à la sélection.' : 'Bâtiment retiré de la sélection.', 'ok');
    });

    /* --- Aérien --- */
    el['select-imagery'].addEventListener('change', () => {
      updateImageryDescription();
      STORE.setPref('imagery', el['select-imagery'].value);
      el['pref-imagery'].value = el['select-imagery'].value;
      if (state.activeTab === 'aerial') renderAerial();
    });
    document.addEventListener('mf:basemap', (ev) => {
      el['select-basemap'].value = ev.detail.id;
      el['pref-basemap'].value = ev.detail.id;
    });

    /* --- Photos --- */
    el['select-radius'].addEventListener('change', () => loadPhotos(true));
    el['btn-reload-photos'].addEventListener('click', () => loadPhotos(true));
    el['lightbox-prev'].addEventListener('click', () => stepLightbox(-1));
    el['lightbox-next'].addEventListener('click', () => stepLightbox(1));
    el['lightbox-pano'].addEventListener('click', () => {
      const ph = state.photos[state.photoIndex];
      if (ph && ph.viewerUrl) window.open(ph.viewerUrl, '_blank', 'noopener');
    });

    /* --- Modales --- */
    const on = (node, ev, fn) => { if (node) node.addEventListener(ev, fn); };
    on(el['btn-settings'], 'click', openSettings);
    on(el['btn-sources'], 'click', () => openModal('modal-sources'));
    on(el['btn-footer-sources'], 'click', () => openModal('modal-sources'));
    on(el['btn-history'], 'click', () => { renderHistory(); openModal('modal-history'); });
    on(el['btn-favorites'], 'click', () => { renderFavorites(); openModal('modal-favorites'); });

    document.querySelectorAll('[data-close]').forEach((node) => {
      node.addEventListener('click', () => {
        const id = node.dataset.close;
        if (id === 'lightbox') closeLightbox();
        else closeModal(id);
      });
    });

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (!el['lightbox'].hidden) { closeLightbox(); return; }
        if (closeTopOverlay()) return;
        hideSuggestions();
      }
      if (!el['lightbox'].hidden) {
        if (ev.key === 'ArrowRight') stepLightbox(1);
        if (ev.key === 'ArrowLeft') stepLightbox(-1);
      }
      // Raccourci de recherche : "/" ou Ctrl+K
      if ((ev.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName))
        || ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k')) {
        ev.preventDefault();
        el['search-input'].focus();
        el['search-input'].select();
      }
    });

    /* --- Paramètres --- */
    el['pref-theme'].addEventListener('change', () => {
      STORE.setPref('theme', el['pref-theme'].value);
      applyTheme();
    });
    el['pref-basemap'].addEventListener('change', () => mainMap.setBasemap(el['pref-basemap'].value));
    el['pref-imagery'].addEventListener('change', () => {
      STORE.setPref('imagery', el['pref-imagery'].value);
      el['select-imagery'].value = el['pref-imagery'].value;
      updateImageryDescription();
    });
    el['pref-nominatim'].addEventListener('change', () => {
      STORE.setPref('nominatimEnabled', el['pref-nominatim'].checked);
      toast(el['pref-nominatim'].checked ? 'Nominatim activé.' : 'Nominatim désactivé : Photon seul sera utilisé.', 'info');
    });
    el['pref-osm-context'].addEventListener('change', () => {
      STORE.setPref('osmContextEnabled', el['pref-osm-context'].checked);
      toast(el['pref-osm-context'].checked ? 'Recherche d’emprise activée.' : 'Recherche d’emprise désactivée.', 'info');
      if (state.selected && el['pref-osm-context'].checked) loadContext(state.selected);
    });
    el['pref-precision-notes'].addEventListener('change', () => {
      STORE.setPref('showPrecisionNotes', el['pref-precision-notes'].checked);
      renderResults();
      renderDetail();
    });
    el['btn-clear-cache'].addEventListener('click', () => {
      API.cache.clear();
      el['cache-stats'].textContent = 'Cache vidé. ' + cacheStatsLabel();
      toast('Cache des requêtes vidé.', 'ok');
    });
    el['btn-export-data'].addEventListener('click', () => {
      U.downloadFile(`mapfinder-donnees-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(STORE.exportAll(), null, 2), 'application/json');
      toast('Sauvegarde exportée.', 'ok');
    });
    el['btn-import-data'].addEventListener('click', () => el['import-file'].click());
    el['import-file'].addEventListener('change', async (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        STORE.importAll(data);
        applyTheme();
        syncPrefsUI();
        toast('Données importées.', 'ok');
      } catch (e) {
        toast('Import impossible : ' + e.message, 'error');
      }
      ev.target.value = '';
    });
    el['btn-reset-all'].addEventListener('click', () => {
      if (!confirm('Effacer toutes les données locales (historique, favoris, préférences, cache) ?')) return;
      STORE.clearAll();
      applyTheme();
      syncPrefsUI();
      renderFavorites();
      renderHistory();
      toast('Données locales effacées.', 'ok');
    });

    /* --- Diagnostic --- */
    on(el['btn-diagnose-imagery'], 'click', async () => {
      const out = el['diagnostic-output'];
      const point = state.selected
        ? { lat: state.selected.lat, lon: state.selected.lon }
        : (mainMap ? mainMap.getCenter() : { lat: CFG.APP.defaultCenter[0], lon: CFG.APP.defaultCenter[1] });
      out.innerHTML = '<p class="diag-line"><span class="spinner" aria-hidden="true"></span> Test des tuiles d’imagerie…</p>';
      const rows = await AERIAL.diagnose(point.lat, point.lon);
      out.innerHTML = `<p class="diag-head">Point testé : ${U.formatCoords(point.lat, point.lon, 5)}</p>`
        + rows.map((r) => `<p class="diag-line">`
          + `<span class="diag-dot ${r.ok ? 'is-ok' : r.covered ? 'is-ko' : 'is-na'}"></span>`
          + `<strong>${U.escapeHtml(r.label)}</strong> — `
          + (r.ok ? 'tuile reçue ✓' : r.covered ? 'aucune tuile reçue ✗' : 'hors zone de couverture')
          + `<br><span class="diag-url">${U.escapeHtml(r.url || '—')}</span></p>`).join('');
    });

    on(el['btn-diagnose-services'], 'click', async () => {
      const out = el['diagnostic-output'];
      out.innerHTML = '<p class="diag-line"><span class="spinner" aria-hidden="true"></span> Test des services…</p>';
      const q = 'Renault, 75001 Paris';
      const rows = [];
      const test = async (label, fn) => {
        const t0 = performance.now();
        try {
          const res = await fn();
          rows.push({ label, ok: true, detail: res, ms: Math.round(performance.now() - t0) });
        } catch (e) {
          rows.push({ label, ok: false, detail: e.message, ms: Math.round(performance.now() - t0) });
        }
      };
      await test('Photon (recherche)', async () => {
        const r = await GEO.photon.search({ name: 'Renault', postcode: '75001', city: 'Paris' }, { noCache: true });
        return `${r.length} résultat(s)`;
      });
      await test('Nominatim (recherche)', async () => {
        const r = await GEO.nominatim.search({ name: 'Renault', postcode: '75001', city: 'Paris' }, {});
        return `${r.length} résultat(s)`;
      });
      await test('Overpass (emprise)', async () => {
        const ctx = await OV.context(48.8749, 2.3210, { noCache: true });
        return `${ctx.buildings.length} bâtiment(s), ${ctx.pois.length} POI`;
      });
      await test('Panoramax (photos)', async () => {
        const r = await STREET.findPhotos(48.8698, 2.3311, { radius: 60 });
        return `${r.photos.length} photo(s)`;
      });
      out.innerHTML = `<p class="diag-head">Services interrogés en direct</p>`
        + rows.map((r) => `<p class="diag-line"><span class="diag-dot ${r.ok ? 'is-ok' : 'is-ko'}"></span>`
          + `<strong>${U.escapeHtml(r.label)}</strong> — ${U.escapeHtml(r.detail)} <span class="diag-url">(${r.ms} ms)</span></p>`).join('');
    });

    /* --- Historique / favoris --- */
    el['btn-clear-history'].addEventListener('click', () => {
      STORE.clearHistory();
      renderHistory();
      toast('Historique effacé.', 'ok');
    });
    el['btn-export-selection'].addEventListener('click', () => {
      const sel = STORE.getSelection();
      if (!sel.length) return;
      const rows = sel.map((s) => EXP.rowFromResult(Object.assign({ address: {} }, s)));
      EXP.exportCSV([], { query: 'selection', extraRows: rows });
      toast('Sélection exportée.', 'ok');
    });
    el['btn-show-selection'].addEventListener('click', () => {
      const sel = STORE.getSelection();
      if (!sel.length) return;
      mainMap.showSelection(sel);
      if (sel.length === 1) mainMap.focus(sel[0]);
      else mainMap.fitExtent({
        minLat: Math.min(...sel.map((s) => s.lat)), maxLat: Math.max(...sel.map((s) => s.lat)),
        minLon: Math.min(...sel.map((s) => s.lon)), maxLon: Math.max(...sel.map((s) => s.lon)),
      });
      closeModal('modal-favorites');
    });
    el['btn-clear-favorites'].addEventListener('click', () => {
      STORE.clearFavorites();
      STORE.clearSelection();
      mainMap.showSelection([]);
      renderFavorites();
      renderResults();
      toast('Favoris et sélection effacés.', 'ok');
    });

    /* --- Réseau --- */
    API.onServiceState((service, status) => {
      failing.set(service, status);
      updateServiceBanner();
    });
    window.addEventListener('online', () => { toast('Connexion rétablie.', 'ok'); failing.clear(); updateServiceBanner(); });
    window.addEventListener('offline', () => { toast('Vous êtes hors connexion : seules les données déjà consultées restent disponibles.', 'warn', 7000); });

    window.addEventListener('resize', U.debounce(() => {
      if (mainMap) mainMap.invalidate();
      if (detailMap && state.activeTab === 'map') detailMap.invalidateSize();
      if (aerialView && state.activeTab === 'aerial') aerialView.invalidate();
    }, 200));

    try {
      if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => { if (STORE.getPrefs().theme === 'auto') applyTheme(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
      }
    } catch (_) { /* navigateur sans matchMedia : thème clair par défaut */ }
  }

  function cacheStatsLabel() {
    const s = API.cache.stats();
    return `${s.entries} entrée${s.entries > 1 ? 's' : ''} en cache (${Math.round(s.bytes / 1024)} Ko).`;
  }

  function syncPrefsUI() {
    const p = STORE.getPrefs();
    el['pref-theme'].value = p.theme;
    el['pref-basemap'].value = p.basemap;
    el['pref-imagery'].value = p.imagery;
    el['pref-nominatim'].checked = !!p.nominatimEnabled;
    el['pref-osm-context'].checked = !!p.osmContextEnabled;
    el['pref-precision-notes'].checked = !!p.showPrecisionNotes;
    el['select-basemap'].value = p.basemap;
    el['select-imagery'].value = p.imagery;
    el['select-radius'].value = String(p.photoRadius || 60);
    el['cache-stats'].textContent = cacheStatsLabel();
    updateImageryDescription();
  }

  function openSettings() {
    syncPrefsUI();
    openModal('modal-settings');
  }

  /* ================================================================== Init */
  function init() {
    cacheDom();
    applyTheme();
    STORE.setPref('photoRadius', STORE.getPrefs().photoRadius || 60);

    mainMap = new MAP.MainMap('map');
    el['select-basemap'].value = STORE.getPrefs().basemap;

    fillImagerySelect();
    syncPrefsUI();
    renderSources();
    renderFavorites();
    renderHistory();
    bindEvents();

    el['btn-sort'].title = 'Tri : pertinence';
    el['select-radius'].value = String(STORE.getPrefs().photoRadius || 60);

    // Lien profond : #q=… ou #lat=…&lon=…
    const deep = EXP.readHash();
    if (deep) {
      if (deep.q) {
        el['search-input'].value = deep.q;
        el['btn-clear'].hidden = false;
        runSearch(deep.q);
      } else if (deep.lat !== null) {
        mainMap.focus({ lat: deep.lat, lon: deep.lon, precision: 'approximate', address: {}, name: '', label: '' }, { zoom: 18 });
        toast('Position issue du lien partagé.', 'info');
      }
    }

    setFooterStatus('Prêt');
    document.documentElement.classList.add('mf-ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Point d'entrée exposé pour les tests automatisés (test/dom-harness.js).
  // L'interface ne s'en sert jamais.
  window.MF_APP = {
    state, init,
    runSearch, selectResult, renderResults, renderDetail, switchTab, loadPhotos,
    clearSearch, toggleFavorite, renderFavorites, renderHistory, renderSources,
    chooseSuggestion, getMainMap: () => mainMap,
  };
})();
