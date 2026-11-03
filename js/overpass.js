/* ============================================================================
 * MAPFINDER — js/overpass.js
 * Overpass API — ne sert PAS à chercher, mais à QUALIFIER un résultat :
 *   • retrouver l'emprise (building=*) du bâtiment et son centroïde ;
 *   • mesurer la confiance de l'appariement (adresse, containment, proximité) ;
 *   • récupérer les POI voisins et l'orientation de la rue.
 * Une seule requête en vol, bascule de miroirs, rayon borné.
 * ==========================================================================*/
(function (global) {
  'use strict';

  const CFG = global.MF_CONFIG;
  const API = global.MF_API;
  const U = global.MF_UTILS;

  function buildQuery(lat, lon) {
    const p = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    return `[out:json][timeout:25][maxsize:2000000];
(
  way(around:30,${p})["building"];
);
out tags geom 60;
(
  nwr(around:120,${p})["name"]["amenity"];
  nwr(around:120,${p})["name"]["shop"];
  nwr(around:120,${p})["name"]["office"];
  nwr(around:120,${p})["name"]["tourism"];
);
out center tags 30;
(
  way(around:70,${p})["highway"~"^(primary|secondary|tertiary|residential|pedestrian|unclassified|living_street|service)$"];
);
out tags geom 8;`;
  }

  /**
   * Récupère le contexte OSM autour d'un point.
   * @returns {Promise<{buildings, pois, roads, provider}>}
   */
  async function context(lat, lon, opts) {
    const o = opts || {};
    const query = buildQuery(lat, lon);
    const key = 'overpass:ctx:' + lat.toFixed(5) + ',' + lon.toFixed(5);

    const res = await API.failover(
      CFG.OVERPASS.endpoints,
      async (endpoint) => {
        const url = `${endpoint}?data=${encodeURIComponent(query)}`;
        const data = await API.request(url, {
          service: 'overpass',
          ttl: CFG.OVERPASS.ttl,
          timeoutMs: CFG.OVERPASS.timeoutMs,
          // Pas de nouvelle tentative sur un même miroir : on passe au suivant.
          // Évite de doubler la charge sur des serveurs publics bénévoles.
          retries: 0,
          cacheKey: key,
          signal: o.signal,
          noCache: !!o.noCache,
        });
        if (!data || !Array.isArray(data.elements) || !data.elements.length) return null;
        return normalize(data.elements);
      },
      { isEmpty: (r) => r && !r.buildings.length && !r.pois.length && !r.roads.length }
    );

    if (!res.result) {
      return { buildings: [], pois: [], roads: [], provider: null };
    }
    res.result.provider = res.provider;
    return res.result;
  }

  function normalize(elements) {
    const buildings = [];
    const pois = [];
    const roads = [];

    elements.forEach((e) => {
      const tags = e.tags || {};
      if (e.type === 'way' && tags.building && e.geometry && e.geometry.length) {
        const ring = e.geometry.map((g) => [g.lat, g.lon]);
        const info = polygonInfo(ring);
        buildings.push({
          id: `way/${e.id}`,
          tags,
          ring,
          center: info.center,
          area: info.area,
          name: tags.name || '',
          housenumber: tags['addr:housenumber'] || '',
          street: tags['addr:street'] || '',
          postcode: tags['addr:postcode'] || '',
          levels: tags['building:levels'] || '',
          type: tags.building === 'yes' ? (tags['building:use'] || 'bâtiment') : tags.building,
        });
      } else if (e.type === 'way' && tags.highway && e.geometry && e.geometry.length) {
        roads.push({
          id: `way/${e.id}`,
          name: tags.name || '',
          highway: tags.highway,
          geometry: e.geometry.map((g) => [g.lat, g.lon]),
        });
      } else if (tags.name && (e.type === 'node' || e.center)) {
        const lat = e.lat !== undefined ? e.lat : e.center.lat;
        const lon = e.lon !== undefined ? e.lon : e.center.lon;
        const cat = tags.amenity ? 'amenity' : tags.shop ? 'shop' : tags.office ? 'office' : tags.tourism ? 'tourism' : null;
        if (cat) {
          pois.push({
            id: `${e.type}/${e.id}`,
            name: tags.name,
            category: cat,
            value: tags[cat] || '',
            lat, lon,
            street: tags['addr:street'] || '',
            housenumber: tags['addr:housenumber'] || '',
            phone: tags.phone || tags['contact:phone'] || '',
            website: tags.website || tags['contact:website'] || '',
            opening: tags.opening_hours || '',
          });
        }
      }
    });

    return { buildings, pois, roads };
  }

  /** Centroïde, surface (m²) et test d'appartenance, en projection locale. */
  function polygonInfo(ring) {
    if (!ring || ring.length < 3) return { center: null, area: 0, bbox: null };
    let latSum = 0, lonSum = 0;
    ring.forEach(([la, lo]) => { latSum += la; lonSum += lo; });
    const cLat = latSum / ring.length;
    const cLon = lonSum / ring.length;
    const mPerDegLat = 111132.92;
    const mPerDegLon = 111412.84 * Math.cos((cLat * Math.PI) / 180);
    const pts = ring.map(([la, lo]) => [(lo - cLon) * mPerDegLon, (la - cLat) * mPerDegLat]);
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      area2 += x1 * y2 - x2 * y1;
    }
    const area = Math.abs(area2) / 2;
    const lats = ring.map((p) => p[0]);
    const lons = ring.map((p) => p[1]);
    return {
      center: { lat: cLat, lon: cLon },
      area,
      bbox: { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) },
    };
  }

  function pointInPolygon(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [yi, xi] = ring[i];
      const [yj, xj] = ring[j];
      const intersect = ((xi > lon) !== (xj > lon))
        && (lat < ((yj - yi) * (lon - xi)) / (xj - xi) + yi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Apparie un résultat de géocodage à une emprise de bâtiment.
   * Ne renvoie JAMAIS 'high' sans preuve : adresse identique, containment, ou très grande proximité.
   */
  function matchBuilding(result, buildings) {
    if (!buildings || !buildings.length) return null;

    const scored = buildings.map((b) => {
      const dCenter = U.distance(result.lat, result.lon, b.center.lat, b.center.lon);
      const contains = pointInPolygon(result.lat, result.lon, b.ring);
      let addrScore = 0;
      let reasons = [];

      const wantHouse = U.normalize(result.address.housenumber);
      const wantStreet = U.normalize(result.address.street);
      if (wantHouse && b.housenumber && U.normalize(b.housenumber) === wantHouse) {
        addrScore += 0.5; reasons.push('numéro');
      }
      if (wantStreet && b.street && U.similarity(wantStreet, b.street) > 0.85) {
        addrScore += 0.35; reasons.push('rue');
      }
      const wantName = U.normalize(result.name);
      if (wantName && b.name && U.similarity(wantName, b.name) > 0.85) {
        addrScore += 0.4; reasons.push('nom');
      }
      if (contains) { addrScore += 0.3; reasons.push('point contenu'); }

      return { building: b, dCenter, contains, addrScore, reasons, score: addrScore - Math.min(dCenter, 40) / 200 };
    }).sort((x, y) => y.score - x.score);

    const best = scored[0];
    if (!best) return null;

    let confidence = 'low';
    if (best.addrScore >= 0.6) confidence = 'high';
    else if (best.contains || best.dCenter <= 12) confidence = 'medium';
    else if (best.dCenter <= 30) confidence = 'medium';

    if (confidence === 'low' && best.dCenter > 30) return null;

    return {
      building: best.building,
      confidence,
      distance: best.dCenter,
      contains: best.contains,
      reasons: best.reasons,
      candidates: scored.length,
    };
  }

  /** Orientation de la rue la plus proche (pour interpréter l'azimut des photos). */
  function nearestRoad(roads, lat, lon) {
    if (!roads || !roads.length) return null;
    let best = null;
    roads.forEach((r) => {
      for (let i = 0; i < r.geometry.length - 1; i++) {
        const [aLat, aLon] = r.geometry[i];
        const [bLat, bLon] = r.geometry[i + 1];
        const d = pointToSegmentDistance(lat, lon, aLat, aLon, bLat, bLon);
        if (!best || d < best.distance) {
          best = {
            road: r,
            distance: d,
            bearing: U.bearing(aLat, aLon, bLat, bLon) % 180, // axe de la rue
          };
        }
      }
    });
    return best;
  }

  function pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon) {
    const mPerDegLat = 111132.92;
    const mPerDegLon = 111412.84 * Math.cos((pLat * Math.PI) / 180);
    const px = 0, py = 0;
    const ax = (aLon - pLon) * mPerDegLon, ay = (aLat - pLat) * mPerDegLat;
    const bx = (bLon - pLon) * mPerDegLon, by = (bLat - pLat) * mPerDegLat;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = U.clamp(t, 0, 1);
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(cx, cy);
  }

  global.MF_OVERPASS = { context, matchBuilding, nearestRoad, pointInPolygon, polygonInfo };
})(window);
