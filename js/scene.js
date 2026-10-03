/* Escena: la Tierra vista desde encima del polo norte y las ciudades en órbita.
   Una unidad del viewBox es un píxel, así que el texto nunca encoge: al cambiar
   el tamaño se recalcula el radio del globo y se vuelve a proyectar todo.

   La sombra de la noche se dibuja una vez por declinación con el Sol sobre la
   longitud 0; lo que cambia con la hora es solo su `transform` (un giro).
   Con prefers-reduced-motion no hay giro: dos capas se funden entre sí. */
(function () {
  "use strict";

  var App = (window.OrbitalClock = window.OrbitalClock || {});
  var clock = App.clock;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var RAD = Math.PI / 180;

  var RINGS_WIDE = [30, 45, 60]; // distancia de cada órbita al borde del globo
  var RINGS_COMPACT = [21, 32, 43];
  var LABEL_HEIGHT = 30;
  var CHAR = 0.6; // avance de JetBrains Mono, en em
  var RING_CLEARANCE = 16; // grados mínimos entre dos satélites de la misma órbita
  var FADE_MS = 220;

  function node(name, attrs, parent) {
    var el = document.createElementNS(SVG_NS, name);
    for (var key in attrs) el.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function fix(n) {
    return n.toFixed(1);
  }

  function reduced() {
    return window.Pluton && window.Pluton.reducedMotion();
  }

  function circlePath(r) {
    return "M" + r + " 0A" + r + " " + r + " 0 1 0 " + -r + " 0A" + r + " " + r + " 0 1 0 " + r + " 0Z";
  }

  function polygons(list, size) {
    var d = "";
    list.forEach(function (poly) {
      for (var i = 0; i < poly.length; i += 2) {
        var p = clock.project(poly[i + 1], poly[i], size);
        d += (i ? "L" : "M") + fix(p.x) + " " + fix(p.y);
      }
      d += "Z";
    });
    return d;
  }

  App.createScene = function (options) {
    var stage = options.stage;
    var svg = options.svg;

    var size = 150; // radio del globo en px
    var compact = false;
    var rings = RINGS_WIDE;
    var labelRadius = 0;
    var sats = [];
    var launches = 0;
    var sunState = null;
    var drawnDecl = null;
    var live = 0; // capa de sombra visible
    var lastSwap = 0;
    var swapTimer = 0;

    /* ---------- capas ---------- */

    var orbitsLayer = node("g", { "aria-hidden": "true" }, svg);
    var orbitEls = RINGS_WIDE.map(function () {
      return node("circle", { class: "orbit-dashed" }, orbitsLayer);
    });

    var globe = node("g", { class: "globe" }, svg);
    var sea = node("circle", { class: "sea" }, globe);
    var land = node("path", { class: "land" }, globe);
    var lakes = node("path", { class: "lakes" }, globe);
    var grid = node("path", { class: "grid" }, globe);
    var equator = node("circle", { class: "grid grid--equator" }, globe);

    var shades = [0, 1].map(function (i) {
      var g = node("g", { class: "shade" + (i === 0 ? " is-on" : "") }, svg);
      var layer = { el: g, angle: 0 };
      layer.night = node("path", { class: "night" }, g);
      layer.line = node("path", { class: "terminator" }, g);
      layer.sun = node("g", { class: "sun-mark" }, g);
      node("circle", { r: 4 }, layer.sun);
      node("path", { d: "M0 -6.5V-9M0 6.5V9M-6.5 0H-9M6.5 0H9M-4.6 -4.6L-6.4 -6.4M4.6 4.6L6.4 6.4M-4.6 4.6L-6.4 6.4M4.6 -4.6L6.4 -6.4" }, layer.sun);
      layer.moon = node("path", { class: "moon-mark", d: "M2 -5.2A5.5 5.5 0 1 0 5.2 3.4A4.6 4.6 0 0 1 2 -5.2Z" }, g);
      return layer;
    });

    var rim = node("circle", { class: "rim" }, svg);
    var ticks = node("path", { class: "ticks" }, svg);
    var pole = node("circle", { class: "pole", r: 1.6 }, svg);
    var hit = node("circle", { class: "globe-hit" }, svg);
    var satsLayer = node("g", {}, svg);

    /* ---------- globo ---------- */

    function drawGlobe() {
      sea.setAttribute("r", size);
      rim.setAttribute("r", size);
      hit.setAttribute("r", size);
      land.setAttribute("d", polygons(App.LAND, size));
      lakes.setAttribute("d", polygons(App.LAKES, size));
      equator.setAttribute("r", fix(clock.radius(0) * size));

      // Meridianos cada 15° (una hora) y paralelos cada 30°.
      var d = "";
      var marks = "";
      for (var lon = 0; lon < 360; lon += 15) {
        var sin = Math.sin(lon * RAD);
        var cos = Math.cos(lon * RAD);
        var from = clock.radius(lon % 90 === 0 ? 90 : 75) * size;
        d += "M" + fix(from * sin) + " " + fix(from * cos) + "L" + fix(size * sin) + " " + fix(size * cos);
        var outer = size + (lon % 90 === 0 ? 9 : 6);
        marks += "M" + fix((size + 3) * sin) + " " + fix((size + 3) * cos) + "L" + fix(outer * sin) + " " + fix(outer * cos);
      }
      [60, 30, -30].forEach(function (lat) {
        d += circlePath(fix(clock.radius(lat) * size));
      });
      grid.setAttribute("d", d);
      ticks.setAttribute("d", marks);

      orbitEls.forEach(function (el, i) {
        el.setAttribute("r", size + rings[i]);
      });
      var markAt = size + (compact ? 11 : 16);
      var markScale = compact ? " scale(0.7)" : "";
      shades.forEach(function (layer) {
        layer.sun.setAttribute("transform", "translate(0 " + markAt + ")" + markScale);
        layer.moon.setAttribute("transform", "translate(0 " + -markAt + ")" + markScale);
      });
    }

    /* ---------- día y noche ---------- */

    // El terminador es una curva con forma de estrella respecto al polo: un radio por
    // longitud. Si el polo está iluminado, esa curva encierra el día y la noche es el
    // resto del disco (regla par-impar); si no, encierra directamente la noche.
    function drawShade(decl) {
      var points = clock.terminator(decl, 1);
      var poly = "";
      var line = "";
      var drawing = false;
      var prev = null;

      points.forEach(function (pt, i) {
        var r = Math.min(1, clock.radius(pt[1])) * size;
        var cur = { x: fix(r * Math.sin(pt[0] * RAD)), y: fix(r * Math.cos(pt[0] * RAD)), inside: r < size - 0.01 };
        poly += (i ? "L" : "M") + cur.x + " " + cur.y;
        // La línea solo se traza donde el terminador cruza el disco, no sobre el borde.
        if (prev && (cur.inside || prev.inside)) {
          line += (drawing ? "L" : "M" + prev.x + " " + prev.y + "L") + cur.x + " " + cur.y;
          drawing = true;
        } else {
          drawing = false;
        }
        prev = cur;
      });

      var night = (decl >= 0 ? circlePath(size) : "") + poly + "Z";
      shades.forEach(function (layer) {
        layer.night.setAttribute("d", night);
        layer.line.setAttribute("d", line);
      });
      drawnDecl = decl;
    }

    function turn(layer, angle) {
      layer.angle = angle;
      layer.el.setAttribute("transform", "rotate(" + angle.toFixed(3) + ")");
    }

    function swap() {
      swapTimer = 0;
      lastSwap = performance.now();
      var next = shades[1 - live];
      turn(next, -sunState.lon);
      shades[live].el.classList.remove("is-on");
      next.el.classList.add("is-on");
      live = 1 - live;
    }

    function setSun(s) {
      var first = sunState === null;
      sunState = s;
      stage.dataset.sunLon = s.lon.toFixed(3);
      if (drawnDecl === null || Math.abs(s.decl - drawnDecl) > 0.02) drawShade(s.decl);

      var angle = -s.lon;
      var jump = Math.abs(clock.wrap180(angle - shades[live].angle));
      // El avance natural del reloj (0,004° por segundo) nunca necesita fundido.
      if (first || !reduced() || jump < 0.5) {
        if (!swapTimer) turn(shades[live], angle);
        return;
      }
      if (swapTimer) return;
      var wait = FADE_MS - (performance.now() - lastSwap);
      if (wait <= 0) swap();
      else swapTimer = window.setTimeout(swap, wait);
    }

    /* ---------- satélites ---------- */

    function build(sat) {
      var g = node("g", { class: "sat", "data-tz": sat.tz }, satsLayer);
      sat.el = g;
      sat.tetherEl = node("line", { class: "sat-tether" }, g);
      sat.leaderEl = node("line", { class: "sat-leader" }, g);
      sat.dotEl = node("circle", { class: "sat-city", r: 2.6 }, g);

      sat.bodyEl = node("g", {}, g);
      node("circle", { class: "sat-hit", r: 13 }, sat.bodyEl);
      sat.probeEl = node("g", { class: "sat-probe" }, sat.bodyEl);
      node("rect", { x: -10.5, y: -1.75, width: 6, height: 3.5, rx: 0.8 }, sat.probeEl);
      node("rect", { x: 4.5, y: -1.75, width: 6, height: 3.5, rx: 0.8 }, sat.probeEl);
      node("circle", { r: 3.6 }, sat.probeEl);
      var beacon = node("circle", { class: "sat-beacon", r: 1.3 }, sat.probeEl);
      beacon.style.animationDelay = ((sats.length * 0.7) % 2.6).toFixed(1) + "s";

      sat.labelEl = node("g", { class: "sat-label" }, g);
      node("rect", { class: "sat-hit", x: -24, y: -15, width: 48, height: 30 }, sat.labelEl);
      sat.nameEl = node("text", { class: "sat-name", "text-anchor": "middle", y: -3 }, sat.labelEl);
      sat.timeEl = node("text", { class: "sat-time", "text-anchor": "middle", y: 11 }, sat.labelEl);
      sat.timeEl.textContent = sat.time || "--:--";

      g.addEventListener("pointerenter", function () {
        options.onHover(sat.tz);
      });
      g.addEventListener("pointerleave", function () {
        options.onHover(null);
      });
    }

    // Reparte los satélites entre las órbitas y evita vecinos pegados en la misma.
    function pickRing(lon) {
      var best = 0;
      var bestClear = -1;
      for (var k = 0; k < rings.length; k++) {
        var ring = (launches + k) % rings.length;
        var clear = 360;
        for (var i = 0; i < sats.length; i++) {
          if (sats[i].ring === ring) clear = Math.min(clear, Math.abs(clock.wrap180(sats[i].lon - lon)));
        }
        if (clear >= RING_CLEARANCE) return ring;
        if (clear > bestClear) {
          best = ring;
          bestClear = clear;
        }
      }
      return best;
    }

    function labelText(sat) {
      var text = compact ? sat.code : sat.label.length > 13 ? sat.label.slice(0, 12) + "…" : sat.label;
      return (sat.approx ? "≈" + (compact ? "" : " ") : "") + text;
    }

    function labelBox(sat) {
      var ux = Math.cos(sat.angle);
      var uy = Math.sin(sat.angle);
      var reach = labelRadius + (sat.width / 2) * Math.abs(ux) + (LABEL_HEIGHT / 2) * Math.abs(uy);
      sat.cx = reach * ux;
      sat.cy = reach * uy;
    }

    // Las etiquetas se apoyan en un círculo exterior a las órbitas. Si dos se pisan,
    // se separan girando alrededor del globo hasta que caben; el satélite no se mueve.
    function relax() {
      var pad = 3;
      for (var pass = 0; pass < 400; pass++) {
        var moved = false;
        for (var i = 0; i < sats.length; i++) {
          for (var j = i + 1; j < sats.length; j++) {
            var a = sats[i];
            var b = sats[j];
            if (Math.abs(a.cx - b.cx) >= (a.width + b.width) / 2 + pad || Math.abs(a.cy - b.cy) >= LABEL_HEIGHT + pad) continue;
            var gap = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle));
            var push = (gap > 0 || (gap === 0 && i < j) ? 1 : -1) * 0.012;
            a.angle -= push;
            b.angle += push;
            labelBox(a);
            labelBox(b);
            moved = true;
          }
        }
        if (!moved) break;
      }
    }

    function place() {
      var nameSize = 11;
      var timeSize = compact ? 12 : 13;

      sats.forEach(function (sat) {
        var ux = Math.sin(sat.lon * RAD);
        var uy = Math.cos(sat.lon * RAD);
        var orbit = size + rings[sat.ring];
        sat.orbit = orbit;
        sat.ux = ux;
        sat.uy = uy;
        sat.bodyEl.setAttribute("transform", "translate(" + fix(orbit * ux) + " " + fix(orbit * uy) + ") rotate(" + fix(180 - sat.lon) + ")");

        // La ciudad se marca sobre el mapa; si solo conocemos el huso, en el borde.
        var from = sat.lat === null ? { x: size * ux, y: size * uy } : clock.project(sat.lat, sat.lon, size);
        sat.start = Math.sqrt(from.x * from.x + from.y * from.y);
        sat.dotEl.setAttribute("cx", fix(from.x));
        sat.dotEl.setAttribute("cy", fix(from.y));
        sat.dotEl.style.display = sat.lat === null ? "none" : "";
        sat.tetherEl.setAttribute("x1", fix(from.x));
        sat.tetherEl.setAttribute("y1", fix(from.y));
        sat.tetherEl.setAttribute("x2", fix((orbit - 8) * ux));
        sat.tetherEl.setAttribute("y2", fix((orbit - 8) * uy));

        var text = labelText(sat);
        sat.nameEl.textContent = text;
        sat.width = Math.max(text.length * nameSize * CHAR, 5 * timeSize * CHAR) + 6;
        sat.angle = Math.atan2(uy, ux);
        labelBox(sat);
      });

      relax();

      sats.forEach(function (sat) {
        sat.labelEl.setAttribute("transform", "translate(" + fix(sat.cx) + " " + fix(sat.cy) + ")");
        var hitBox = sat.labelEl.firstChild;
        hitBox.setAttribute("x", fix(-sat.width / 2));
        hitBox.setAttribute("width", fix(sat.width));
        sat.leaderEl.setAttribute("x1", fix((sat.orbit + 8) * sat.ux));
        sat.leaderEl.setAttribute("y1", fix((sat.orbit + 8) * sat.uy));
        sat.leaderEl.setAttribute("x2", fix((labelRadius - 2) * Math.cos(sat.angle)));
        sat.leaderEl.setAttribute("y2", fix((labelRadius - 2) * Math.sin(sat.angle)));
      });
    }

    // El satélite sube desde su ciudad hasta la órbita; la etiqueta llega después.
    function launch(sat) {
      if (reduced() || !sat.probeEl.animate) {
        sat.el.classList.add("is-hidden");
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            sat.el.classList.remove("is-hidden");
          });
        });
        return;
      }
      var climb = sat.orbit - sat.start;
      sat.probeEl.animate(
        [
          { transform: "translateY(" + fix(climb) + "px) scale(0.3)", opacity: 0 },
          { opacity: 1, offset: 0.2 },
          { transform: "translateY(0px) scale(1)", opacity: 1 },
        ],
        { duration: 900, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
      [sat.labelEl, sat.leaderEl].forEach(function (el) {
        el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1 }], {
          duration: 900,
          easing: "cubic-bezier(0.65, 0, 0.35, 1)",
        });
      });
    }

    function add(city, animate) {
      var sat = {
        tz: city.tz,
        label: city.short,
        code: city.code,
        lat: city.lat,
        lon: city.lon,
        approx: city.approx,
        time: city.time,
        ring: pickRing(city.lon),
      };
      launches++;
      build(sat);
      sats.push(sat);
      place();
      if (animate) launch(sat);
    }

    function remove(tz) {
      sats = sats.filter(function (sat) {
        if (sat.tz !== tz) return true;
        var el = sat.el;
        el.classList.add("is-hidden");
        window.setTimeout(function () {
          el.remove();
        }, FADE_MS + 40);
        return false;
      });
      place();
    }

    function setTime(tz, text) {
      for (var i = 0; i < sats.length; i++) {
        if (sats[i].tz === tz && sats[i].time !== text) {
          sats[i].time = text;
          sats[i].timeEl.textContent = text;
        }
      }
    }

    function highlight(tz) {
      sats.forEach(function (sat) {
        sat.el.classList.toggle("is-active", sat.tz === tz);
      });
    }

    /* ---------- tamaño ---------- */

    function layout() {
      var rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var w = rect.width;
      var h = rect.height;
      compact = w < 600;
      rings = compact ? RINGS_COMPACT : RINGS_WIDE;
      var gap = compact ? 9 : 11;
      var labelRoom = compact ? 38 : 13 * 11 * CHAR + 8;
      var outer = rings[rings.length - 1] + gap + 2;
      size = Math.round(clamp(Math.min(w / 2 - labelRoom - outer, h / 2 - LABEL_HEIGHT - outer), 56, 190));
      labelRadius = size + rings[rings.length - 1] + gap;

      svg.setAttribute("viewBox", fix(-w / 2) + " " + fix(-h / 2) + " " + fix(w) + " " + fix(h));
      stage.classList.toggle("is-compact", compact);
      drawGlobe();
      if (sunState) drawShade(sunState.decl);
      place();
    }

    /* ---------- arrastrar el globo ---------- */

    // Una vuelta completa son 24 h. Solo ratón y lápiz: con el dedo, arrastrar
    // sobre la escena tiene que seguir desplazando la página.
    var dragAngle = null;

    function pointerAngle(event) {
      var rect = svg.getBoundingClientRect();
      return Math.atan2(event.clientY - (rect.top + rect.height / 2), event.clientX - (rect.left + rect.width / 2));
    }

    hit.addEventListener("pointerdown", function (event) {
      if (event.pointerType === "touch" || event.button !== 0) return;
      event.preventDefault();
      dragAngle = pointerAngle(event);
      hit.setPointerCapture(event.pointerId);
      stage.classList.add("is-dragging");
      options.onDragStart();
    });

    hit.addEventListener("pointermove", function (event) {
      if (dragAngle === null) return;
      var angle = pointerAngle(event);
      var delta = Math.atan2(Math.sin(angle - dragAngle), Math.cos(angle - dragAngle));
      dragAngle = angle;
      options.onDrag((delta / RAD) * 4); // 1° = 4 minutos
    });

    function endDrag() {
      dragAngle = null;
      stage.classList.remove("is-dragging");
    }

    hit.addEventListener("pointerup", endDrag);
    hit.addEventListener("pointercancel", endDrag);

    if (window.ResizeObserver) new ResizeObserver(layout).observe(svg);
    else window.addEventListener("resize", layout);
    layout();

    return {
      setSun: setSun,
      add: add,
      remove: remove,
      setTime: setTime,
      highlight: highlight,
    };
  };
})();
