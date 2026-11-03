/* ============================================================================
 * MAPFINDER — js/api-services.js
 * Socle réseau unique : limitation de débit, cache local, délais d'attente,
 * nouvelles tentatives, bascule de fournisseurs, erreurs typées, état des services.
 * Tout appel réseau de l'application passe par ici.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const U = global.MF_UTILS;

  /* ----------------------------------------------------------- Erreurs --- */
  class MFError extends Error {
    constructor(message, opts) {
      super(message);
      this.name = (opts && opts.name) || 'MFError';
      this.code = (opts && opts.code) || 'error';
      this.service = (opts && opts.service) || null;
      this.status = (opts && opts.status) || null;
      this.retryable = !!(opts && opts.retryable);
    }
  }
  const errors = {
    NetworkError: (m, o) => new MFError(m || 'Connexion au service impossible.', Object.assign({ name: 'NetworkError', code: 'network' }, o)),
    TimeoutError: (m, o) => new MFError(m || 'Le service n’a pas répondu à temps.', Object.assign({ name: 'TimeoutError', code: 'timeout' }, o)),
    RateLimitError: (m, o) => new MFError(m || 'Trop de requêtes vers ce service.', Object.assign({ name: 'RateLimitError', code: 'ratelimit' }, o)),
    ServiceDownError: (m, o) => new MFError(m || 'Service momentanément indisponible.', Object.assign({ name: 'ServiceDownError', code: 'down' }, o)),
    NotFoundError: (m, o) => new MFError(m || 'Aucun résultat.', Object.assign({ name: 'NotFoundError', code: 'empty' }, o)),
    HttpError: (m, o) => new MFError(m || 'Erreur HTTP.', Object.assign({ name: 'HttpError', code: 'http' }, o)),
    AbortError: (m, o) => new MFError(m || 'Requête annulée.', Object.assign({ name: 'AbortError', code: 'abort' }, o)),
  };

  /* ------------------------------------------------------------- Cache --- */
  const CACHE_PREFIX = 'mf.cache.';
  const CACHE_INDEX = 'mf.cache.__index';
  const CACHE_MAX_ENTRIES = 80;
  let memoryCache = new Map(); // repli si localStorage indisponible
  let cacheWritable = true;

  function cacheGet(key) {
    const full = CACHE_PREFIX + key;
    try {
      const raw = localStorage.getItem(full);
      if (raw) {
        const entry = JSON.parse(raw);
        if (entry && entry.exp > Date.now()) {
          touchIndex(full);
          return entry.v;
        }
        localStorage.removeItem(full);
        return null;
      }
    } catch (_) { /* ignore */ }
    const m = memoryCache.get(full);
    if (m && m.exp > Date.now()) return m.v;
    memoryCache.delete(full);
    return null;
  }

  function cacheSet(key, value, ttl) {
    if (!ttl) return;
    const full = CACHE_PREFIX + key;
    const entry = { exp: Date.now() + ttl, v: value };
    try {
      localStorage.setItem(full, JSON.stringify(entry));
      touchIndex(full);
      evict();
      return;
    } catch (_) {
      cacheWritable = false;
      memoryCache.set(full, entry);
    }
  }

  function touchIndex(fullKey) {
    try {
      const raw = localStorage.getItem(CACHE_INDEX);
      const idx = raw ? JSON.parse(raw) : {};
      idx[fullKey] = Date.now();
      localStorage.setItem(CACHE_INDEX, JSON.stringify(idx));
    } catch (_) { /* quota : on ignore, l'éviction se fera au prochain passage */ }
  }

  function evict() {
    try {
      const raw = localStorage.getItem(CACHE_INDEX);
      if (!raw) return;
      const idx = JSON.parse(raw);
      const keys = Object.keys(idx).filter((k) => {
        if (!localStorage.getItem(k)) { delete idx[k]; return false; }
        return true;
      });
      if (keys.length <= CACHE_MAX_ENTRIES) {
        localStorage.setItem(CACHE_INDEX, JSON.stringify(idx));
        return;
      }
      keys.sort((a, b) => idx[a] - idx[b]); // plus ancien accès d'abord
      const excess = keys.length - CACHE_MAX_ENTRIES;
      for (let i = 0; i < excess; i++) {
        localStorage.removeItem(keys[i]);
        delete idx[keys[i]];
      }
      localStorage.setItem(CACHE_INDEX, JSON.stringify(idx));
    } catch (_) { /* ignore */ }
  }

  function cacheClear(prefix) {
    try {
      const idx = JSON.parse(localStorage.getItem(CACHE_INDEX) || '{}');
      Object.keys(idx).forEach((k) => {
        if (!prefix || k.startsWith(CACHE_PREFIX + prefix)) {
          localStorage.removeItem(k);
          delete idx[k];
        }
      });
      localStorage.setItem(CACHE_INDEX, JSON.stringify(idx));
    } catch (_) { /* ignore */ }
    memoryCache = new Map();
  }

  function cacheStats() {
    try {
      const idx = JSON.parse(localStorage.getItem(CACHE_INDEX) || '{}');
      let bytes = 0;
      Object.keys(idx).forEach((k) => { bytes += (localStorage.getItem(k) || '').length; });
      return { entries: Object.keys(idx).length, bytes };
    } catch (_) { return { entries: memoryCache.size, bytes: 0 }; }
  }

  /* -------------------------------------------------- Limiteur par hôte --- */
  const limiters = new Map(); // host -> { queue, running, lastAt }

  function getLimiter(host) {
    if (!limiters.has(host)) {
      const cfg = CFG.LIMITS[host] || CFG.LIMITS.default;
      limiters.set(host, { queue: [], running: 0, lastAt: 0, cfg });
    }
    return limiters.get(host);
  }

  function hostOf(url) {
    try { return new URL(url, location.href).host; } catch (_) { return 'unknown'; }
  }

  /**
   * File d'attente FIFO par hôte : respecte l'intervalle minimal et la concurrence
   * autorisée par le fournisseur (exigence des politiques Nominatim / Overpass).
   */
  function schedule(url, task) {
    const host = hostOf(url);
    const lim = getLimiter(host);
    return new Promise((resolve, reject) => {
      lim.queue.push({ task, resolve, reject });
      pump(lim);
    });
  }

  function pump(lim) {
    if (!lim.queue.length) return;
    if (lim.running >= lim.cfg.maxConcurrent) return;
    const now = Date.now();
    const wait = Math.max(0, lim.lastAt + lim.cfg.minInterval - now);
    if (wait > 0) {
      if (!lim.timer) {
        lim.timer = setTimeout(() => { lim.timer = null; pump(lim); }, wait);
      }
      return;
    }
    const item = lim.queue.shift();
    lim.running += 1;
    lim.lastAt = Date.now();
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        lim.running -= 1;
        pump(lim);
      });
    // Enchaîner immédiatement si la concurrence le permet et l'intervalle est écoulé.
    if (lim.queue.length) pump(lim);
  }

  /* ---------------------------------------------------- État des services --- */
  const serviceState = new Map(); // service -> { status, at, message }
  const listeners = new Set();

  function setServiceState(service, status, message) {
    const prev = serviceState.get(service);
    if (prev && prev.status === status && prev.message === message) return;
    serviceState.set(service, { status, at: Date.now(), message: message || '' });
    listeners.forEach((cb) => { try { cb(service, status, message); } catch (_) {} });
  }

  function getServiceState(service) {
    return serviceState.get(service) || { status: 'idle', at: null, message: '' };
  }

  function onServiceState(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  /* ----------------------------------------------------------- Requêtes --- */
  const RETRYABLE_STATUS = [408, 425, 429, 500, 502, 503, 504];

  /**
   * Requête HTTP GET avec cache, limitation de débit, délai d'attente et reprise.
   * @param {string} url
   * @param {object} opts { service, ttl, cacheKey, timeoutMs, retries, headers, responseType, noCache, signal }
   */
  async function request(url, opts) {
    const o = Object.assign({ service: hostOf(url), ttl: 0, timeoutMs: 12000, retries: 1 }, opts || {});
    const key = o.cacheKey || (o.service + '|' + url);

    if (!o.noCache && o.ttl) {
      const hit = cacheGet(key);
      if (hit !== null && hit !== undefined) {
        setServiceState(o.service, 'cache', 'Réponse servie depuis le cache local');
        return hit;
      }
    }

    if (global.navigator && global.navigator.onLine === false) {
      setServiceState(o.service, 'offline', 'Hors connexion');
      throw errors.NetworkError('Vous êtes hors connexion. Seules les données déjà consultées sont disponibles.', { service: o.service });
    }

    let attempt = 0;
    let lastErr = null;

    while (attempt <= o.retries) {
      attempt += 1;
      try {
        const result = await schedule(url, () => doFetch(url, o));
        setServiceState(o.service, 'ok', '');
        if (o.ttl) cacheSet(key, result, o.ttl);
        return result;
      } catch (err) {
        lastErr = err;
        const retryable = err && err.retryable;
        if (!retryable || attempt > o.retries) break;
        const backoff = err.retryAfter ? err.retryAfter * 1000 : Math.min(8000, 600 * 2 ** (attempt - 1));
        await U.sleep(backoff);
      }
    }

    if (lastErr && lastErr.code === 'abort') throw lastErr;
    setServiceState(o.service, 'error', lastErr ? lastErr.message : 'Erreur inconnue');
    throw lastErr || errors.NetworkError('Erreur inconnue', { service: o.service });
  }

  async function doFetch(url, o) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs);
    const onOuterAbort = () => controller.abort();
    if (o.signal) {
      if (o.signal.aborted) { clearTimeout(timer); throw errors.AbortError(null, { service: o.service }); }
      o.signal.addEventListener('abort', onOuterAbort, { once: true });
    }

    let res;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: Object.assign({
          'Accept': 'application/json, text/plain, */*',
        }, o.headers || {}),
        // Identification applicative : le navigateur interdit de fixer un User-Agent.
        // On laisse donc le navigateur envoyer le Referer de l'application locale
        // (politique Nominatim : « HTTP Referer ou User-Agent identifiant l'application »).
        // Forcer une autre origine ferait supprimer le Referer : ce serait pire.
        referrerPolicy: 'strict-origin-when-cross-origin',
        credentials: 'omit',
        mode: 'cors',
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener('abort', onOuterAbort);
      if (e && e.name === 'AbortError') {
        if (o.signal && o.signal.aborted) throw errors.AbortError(null, { service: o.service });
        throw errors.TimeoutError(`Délai dépassé (${Math.round(o.timeoutMs / 1000)} s) pour ${o.service}.`, { service: o.service, retryable: true });
      }
      // TypeError: Failed to fetch -> CORS, DNS, réseau coupé
      throw errors.NetworkError(`Service ${o.service} injoignable (réseau ou CORS).`, { service: o.service, retryable: true });
    } finally {
      clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener('abort', onOuterAbort);
    }

    if (!res.ok) {
      const retryAfter = Number(res.headers.get('Retry-After')) || null;
      if (res.status === 429) {
        throw errors.RateLimitError(`Quota atteint pour ${o.service}. Réessayez dans quelques instants.`, { service: o.service, status: 429, retryable: true, retryAfter });
      }
      if ([500, 502, 503, 504].includes(res.status)) {
        throw errors.ServiceDownError(`${o.service} est momentanément indisponible (HTTP ${res.status}).`, { service: o.service, status: res.status, retryable: true, retryAfter });
      }
      if (res.status === 404) {
        throw errors.NotFoundError(`Aucun résultat (HTTP 404) sur ${o.service}.`, { service: o.service, status: 404 });
      }
      throw errors.HttpError(`Erreur HTTP ${res.status} sur ${o.service}.`, { service: o.service, status: res.status, retryable: RETRYABLE_STATUS.includes(res.status) });
    }

    const type = o.responseType || 'json';
    try {
      if (type === 'json') return await res.json();
      if (type === 'text') return await res.text();
      return await res.blob();
    } catch (e) {
      throw errors.HttpError(`Réponse illisible de ${o.service} (format inattendu).`, { service: o.service });
    }
  }

  /** Requête POST (formulaire) : utilisée si un fournisseur l'exige. Jamais de scraping. */
  async function postForm(url, params, opts) {
    const o = Object.assign({ service: hostOf(url), timeoutMs: 15000 }, opts || {});
    const body = new URLSearchParams(params).toString();
    return schedule(url, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'Accept': 'application/json' },
          body,
          referrerPolicy: 'strict-origin-when-cross-origin',
          credentials: 'omit',
          signal: controller.signal,
        });
        if (!res.ok) throw errors.HttpError(`Erreur HTTP ${res.status} sur ${o.service}.`, { service: o.service, status: res.status });
        return await res.json();
      } catch (e) {
        if (e instanceof MFError) throw e;
        if (e && e.name === 'AbortError') throw errors.TimeoutError(null, { service: o.service });
        throw errors.NetworkError(`Service ${o.service} injoignable.`, { service: o.service });
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /**
   * Bascule ordonnée entre fournisseurs équivalents (ex. miroirs Overpass).
   * Renvoie le premier succès non vide ; agrège les erreurs sinon.
   */
  async function failover(providers, attemptFn, opts) {
    const o = opts || {};
    const failures = [];
    for (const provider of providers) {
      if (o.signal && o.signal.aborted) throw errors.AbortError(null);
      try {
        const res = await attemptFn(provider);
        if (res !== null && res !== undefined && res !== false && (!o.isEmpty || !o.isEmpty(res))) {
          return { result: res, provider };
        }
        failures.push({ provider, error: errors.NotFoundError('Réponse vide', { service: provider }) });
      } catch (err) {
        failures.push({ provider, error: err });
        if (o.stopOn && o.stopOn(err)) break;
      }
    }
    const meaningful = failures.find((f) => f.error && f.error.code !== 'empty');
    if (meaningful) {
      meaningful.error.failures = failures;
      throw meaningful.error;
    }
    return { result: null, provider: null, failures };
  }

  global.MF_API = {
    request, postForm, failover,
    cache: { get: cacheGet, set: cacheSet, clear: cacheClear, stats: cacheStats },
    errors, MFError,
    onServiceState, getServiceState,
    limits: CFG.LIMITS,
  };
})(window);
