/* Lógica pura del reloj: posición del Sol, terminador, proyección y husos horarios.
   No toca el DOM, así que se puede comprobar con node.

   El Sol sale del algoritmo de baja precisión del Astronomical Almanac
   (error < 0,01° entre 1950 y 2050), más que suficiente para dibujar el día y la noche. */
(function () {
  "use strict";

  var App = (window.OrbitalClock = window.OrbitalClock || {});

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var DAY_MS = 86400000;
  var J2000 = Date.UTC(2000, 0, 1, 12);
  var EDGE_LAT = -60; // borde del disco: como en el emblema de la ONU, la Antártida queda fuera
  var MINUS = "−";

  function wrap180(deg) {
    var d = ((((deg + 180) % 360) + 360) % 360) - 180;
    return d === -180 ? 180 : d;
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /* ---------- Sol ---------- */

  // Punto subsolar en el instante `ms` (época Unix): declinación = latitud, lon = longitud.
  function sun(ms) {
    var n = (ms - J2000) / DAY_MS;
    var meanLon = 280.46 + 0.9856474 * n;
    var anomaly = (357.528 + 0.9856003 * n) * RAD;
    var eclLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
    var obliquity = (23.439 - 0.0000004 * n) * RAD;

    var rightAsc = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon)) * DEG;
    var decl = Math.asin(Math.sin(obliquity) * Math.sin(eclLon)) * DEG;
    var eot = wrap180(meanLon - rightAsc) * 4; // ecuación del tiempo, en minutos

    // El Sol culmina donde la hora solar verdadera marca las 12.
    var utcHours = (((ms % DAY_MS) + DAY_MS) % DAY_MS) / 3600000;
    return { decl: decl, lon: wrap180(-15 * (utcHours - 12) - eot / 4), eot: eot };
  }

  // Altura del Sol sobre el horizonte, en grados. Positiva: es de día.
  function altitude(lat, lon, s) {
    var sin =
      Math.sin(lat * RAD) * Math.sin(s.decl * RAD) +
      Math.cos(lat * RAD) * Math.cos(s.decl * RAD) * Math.cos((lon - s.lon) * RAD);
    return Math.asin(Math.max(-1, Math.min(1, sin))) * DEG;
  }

  /* Latitud del terminador en una longitud: tan φ = −cos(λ − λ_sol) / tan δ.
     Con atan2 no hay división: en el equinoccio (δ = 0) la curva degenera sola
     en ±90°, es decir, en la recta que pasa por el polo. */
  function terminatorLat(lon, s) {
    var d = s.decl * RAD;
    var c = Math.cos((lon - s.lon) * RAD);
    var lat = d >= 0 ? Math.atan2(-c * Math.cos(d), Math.sin(d)) : Math.atan2(c * Math.cos(d), -Math.sin(d));
    return lat * DEG;
  }

  // Terminador completo con el Sol sobre la longitud 0: pares [longitud relativa, latitud].
  // Solo depende de la declinación; girarlo hasta la longitud real es cosa de la vista.
  function terminator(decl, step) {
    var s = { decl: decl, lon: 0 };
    var points = [];
    for (var lon = -180; lon <= 180; lon += step) points.push([lon, terminatorLat(lon, s)]);
    return points;
  }

  /* ---------- proyección ---------- */

  // Azimutal equidistante centrada en el polo norte. Devuelve el radio como
  // fracción del disco: 0 en el polo, 1 en el paralelo 60° S.
  function radius(lat) {
    return (90 - lat) / (90 - EDGE_LAT);
  }

  // Visto desde encima del polo, el este queda en sentido antihorario:
  // Greenwich abajo, 90° E a la derecha, 180° arriba.
  function project(lat, lon, size) {
    var r = radius(lat) * size;
    return { x: r * Math.sin(lon * RAD), y: r * Math.cos(lon * RAD) };
  }

  /* ---------- husos horarios ---------- */

  var formatters = {};

  function formatter(tz) {
    if (!formatters[tz]) {
      formatters[tz] = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    }
    return formatters[tz];
  }

  function isValidZone(tz) {
    if (typeof tz !== "string" || !tz) return false;
    try {
      formatter(tz);
      return true;
    } catch (err) {
      return false;
    }
  }

  // Hora de pared en un huso y su desfase respecto a UTC (minutos) en ese instante.
  function zoneTime(tz, ms) {
    var p = {};
    formatter(tz)
      .formatToParts(ms)
      .forEach(function (part) {
        p[part.type] = Number(part.value);
      });
    var hour = p.hour % 24;
    var wall = Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second);
    return {
      hour: hour,
      minute: p.minute,
      text: pad(hour) + ":" + pad(p.minute),
      offset: Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000),
      weekday: new Date(wall).getUTCDay(),
    };
  }

  function localZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (err) {
      return "UTC";
    }
  }

  function supportedZones() {
    try {
      return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    } catch (err) {
      return [];
    }
  }

  /* ---------- textos ---------- */

  function hoursMinutes(minutes) {
    var abs = Math.abs(Math.round(minutes));
    return { sign: minutes > 0 ? "+" : minutes < 0 ? MINUS : "", h: Math.floor(abs / 60), m: abs % 60 };
  }

  // "UTC−4", "UTC+5:30", "UTC"
  function formatOffset(minutes) {
    var t = hoursMinutes(minutes);
    if (!t.h && !t.m) return "UTC";
    return "UTC" + t.sign + t.h + (t.m ? ":" + pad(t.m) : "");
  }

  // "+6 h", "−9:30 h", "0 h"
  function formatDiff(minutes) {
    var t = hoursMinutes(minutes);
    return t.sign + t.h + (t.m ? ":" + pad(t.m) : "") + " h";
  }

  // "+6 h 00 min", "−1 h 30 min", "0 h 00 min"
  function formatShift(minutes) {
    var t = hoursMinutes(minutes);
    return t.sign + t.h + " h " + pad(t.m) + " min";
  }

  // "4,1° S · 123,5° O"
  function formatPosition(lat, lon) {
    function one(value, positive, negative) {
      return Math.abs(value).toFixed(1).replace(".", ",") + "° " + (value >= 0 ? positive : negative);
    }
    return one(lat, "N", "S") + " · " + one(lon, "E", "O");
  }

  /* ---------- atlas y buscador ---------- */

  var REGIONS = {
    Africa: "África",
    America: "América",
    Antarctica: "Antártida",
    Arctic: "Ártico",
    Asia: "Asia",
    Atlantic: "Atlántico",
    Australia: "Australia",
    Europe: "Europa",
    Indian: "Índico",
    Pacific: "Pacífico",
  };

  // Sin acentos ni mayúsculas, y con "/" y "_" como espacios: "Bogotá" = "bogota".
  function normalize(text) {
    return String(text)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9+]+/g, " ")
      .trim();
  }

  function createAtlas(cities, supported) {
    var byZone = {};
    cities.forEach(function (city) {
      byZone[city.tz] = city;
      if (city.alias) byZone[city.alias] = city;
    });

    // Ficha de un huso: de la tabla si lo conocemos; si no, deducida del nombre IANA
    // y sin posición (la longitud se aproxima luego con el desfase UTC).
    function info(tz) {
      var city = byZone[tz];
      if (city) {
        return {
          tz: tz,
          name: city.name,
          short: city.short || city.name,
          code: city.code,
          place: city.country,
          lat: city.lat,
          lon: city.lon,
          approx: false,
        };
      }
      var parts = tz.split("/");
      var name = parts[parts.length - 1].replace(/_/g, " ");
      var place = parts
        .slice(0, -1)
        .map(function (part) {
          return REGIONS[part] || part.replace(/_/g, " ");
        })
        .join(" · ");
      return {
        tz: tz,
        name: name,
        short: name,
        code: normalize(name).replace(/ /g, "").slice(0, 3).toUpperCase(),
        place: place || "Huso horario",
        lat: null,
        lon: null,
        approx: true,
      };
    }

    var entries = [];
    var seen = {};
    var available = {};
    supported.forEach(function (tz) {
      available[tz] = true;
    });

    function push(tz) {
      var city = byZone[tz];
      var key = city ? city.tz : tz;
      if (seen[key]) return;
      seen[key] = true;
      var data = info(tz);
      entries.push({
        tz: tz,
        name: data.name,
        place: data.place,
        known: !data.approx,
        start: normalize(data.name),
        hay: normalize([data.name, data.place, tz, city ? city.tz + " " + (city.alt || "") : "", REGIONS[tz.split("/")[0]] || ""].join(" ")),
      });
    }

    supported.forEach(push);
    // Las ciudades de la tabla siempre se pueden buscar, exista o no Intl.supportedValuesOf.
    cities.forEach(function (city) {
      if (seen[city.tz]) return;
      if (isValidZone(city.tz)) push(city.tz);
      else if (city.alias && isValidZone(city.alias)) push(city.alias);
    });

    function search(query, limit) {
      var q = normalize(query);
      if (!q) return [];
      var hits = [];
      entries.forEach(function (entry) {
        var rank = entry.start.indexOf(q) === 0 ? 0 : (" " + entry.hay).indexOf(" " + q) !== -1 ? 1 : entry.hay.indexOf(q) !== -1 ? 2 : -1;
        if (rank !== -1) hits.push({ entry: entry, rank: rank });
      });
      hits.sort(function (a, b) {
        return a.rank - b.rank || Number(b.entry.known) - Number(a.entry.known) || a.entry.name.localeCompare(b.entry.name, "es");
      });
      return hits.slice(0, limit || 8).map(function (hit) {
        return hit.entry;
      });
    }

    return { info: info, search: search, size: entries.length };
  }

  App.clock = {
    EDGE_LAT: EDGE_LAT,
    wrap180: wrap180,
    sun: sun,
    altitude: altitude,
    terminatorLat: terminatorLat,
    terminator: terminator,
    radius: radius,
    project: project,
    isValidZone: isValidZone,
    zoneTime: zoneTime,
    localZone: localZone,
    supportedZones: supportedZones,
    formatOffset: formatOffset,
    formatDiff: formatDiff,
    formatShift: formatShift,
    formatPosition: formatPosition,
    normalize: normalize,
    createAtlas: createAtlas,
  };
})();
