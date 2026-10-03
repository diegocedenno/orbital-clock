/* Escena: la Tierra vista desde encima del polo norte y las ciudades en órbita.
   Una unidad del viewBox es un píxel, así que el texto nunca encoge: al cambiar
   el tamaño se recalcula el radio del globo y se vuelve a proyectar todo.

   El marco de referencia es el del Sol: el mediodía queda fijo arriba y la
   medianoche abajo, como en un dial de 24 h. La sombra de la noche solo depende
   de la declinación, así que casi nunca se redibuja; lo que gira con la hora es
   la Tierra entera y, con ella, cada satélite. Por frame solo se escriben
   `transform`. Con prefers-reduced-motion no hay giro interpolado: el globo
   salta a su sitio con un fundido. */
(function () {
  "use strict";

  var App = (window.OrbitalClock = window.OrbitalClock || {});
  var clock = App.clock;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var RAD = Math.PI / 180;

  var RINGS_WIDE = [30, 45, 60]; // distancia de cada órbita al borde del globo
  var RINGS_COMPACT = [24, 34, 44];
  var HOURS = [
    { text: "12", x: 0, y: -1 },
    { text: "18", x: -1, y: 0 },
    { text: "00", x: 0, y: 1 },
    { text: "06", x: 1, y: 0 },
  ];
  var LABEL_HEIGHT = 30;
  var NAME_CHARS = 13; // nombre más largo que cabe en una etiqueta
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
    var rotation = 0; // giro de la Tierra en pantalla, en grados
    var lastFade = 0;

    /* ---------- capas ---------- */

    var orbitsLayer = node("g", { "aria-hidden": "true" }, svg);
    var orbitEls = RINGS_WIDE.map(function () {
      return node("circle", { class: "orbit-dashed" }, orbitsLayer);
    });

    var sea = node("circle", { class: "sea" }, svg);

    // Todo lo que está pegado a la Tierra gira dentro de este grupo.
    var earth = node("g", { class: "earth" }, svg);
    var land = node("path", { class: "land" }, earth);
    var lakes = node("path", { class: "lakes" }, earth);
    var grid = node("path", { class: "grid" }, earth);
    var equator = node("circle", { class: "grid grid--equator" }, earth);
    node("circle", { class: "pole", r: 1.6 }, earth);

    // La sombra se calcula con el Sol sobre la longitud 0 (abajo): media vuelta la deja arriba.
    var shade = node("g", { class: "shade", transform: "rotate(180)" }, svg);
    var night = node("path", { class: "night" }, shade);
    var terminator = node("path", { class: "terminator" }, shade);

    var rim = node("circle", { class: "rim" }, svg);

    // Dial fijo de 24 h: el Sol marca las 12 y la Luna las 00.
    var dial = node("g", { class: "dial" }, svg);
    var ticks = node("path", { class: "ticks" }, dial);
    var hourEls = HOURS.map(function (hour) {
      var el = node("text", { class: "dial-hour", "text-anchor": "middle", "dominant-baseline": "central" }, dial);
      el.textContent = hour.text;
      return el;
    });
    var sunMark = node("g", { class: "sun-mark" }, dial);
    node("circle", { r: 4 }, sunMark);
    node("path", { d: "M0 -6.5V-9M0 6.5V9M-6.5 0H-9M6.5 0H9M-4.6 -4.6L-6.4 -6.4M4.6 4.6L6.4 6.4M-4.6 4.6L-6.4 6.4M4.6 -4.6L6.4 -6.4" }, sunMark);
    var moonMark = node("path", { class: "moon-mark", d: "M2 -5.2A5.5 5.5 0 1 0 5.2 3.4A4.6 4.6 0 0 1 2 -5.2Z" }, dial);

    var hit = node("circle", { class: "globe-hit" }, svg);
    var satsLayer = node("g", { class: "sats" }, svg);

    /* ---------- globo y dial ---------- */

    function drawGlobe() {
      sea.setAttribute("r", size);
      rim.setAttribute("r", size);
      hit.setAttribute("r", size);
      land.setAttribute("d", polygons(App.LAND, size));
      lakes.setAttribute("d", polygons(App.LAKES, size));
      equator.setAttribute("r", fix(clock.radius(0) * size));

      // Meridianos cada 15° y paralelos cada 30°; fuera, una marca por hora.
      var d = "";
      var marks = "";
      for (var lon = 0; lon < 360; lon += 15) {
        var sin = Math.sin(lon * RAD);
        var cos = Math.cos(lon * RAD);
        var from = clock.radius(lon % 90 === 0 ? 90 : 75) * size;
        d += "M" + fix(from * sin) + " " + fix(from * cos) + "L" + fix(size * sin) + " " + fix(size * cos);
        var outer = size + (lon % 90 === 0 ? 7 : 5.5);
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

      // Arriba y abajo el número comparte sitio con el Sol y la Luna, a ambos lados de la marca.
      var at = size + (compact ? 12 : 13);
      HOURS.forEach(function (hour, i) {
        hourEls[i].setAttribute("x", fix(hour.x ? hour.x * (at + 2) : 9));
        hourEls[i].setAttribute("y", fix(hour.y * at));
      });
      sunMark.setAttribute("transform", "translate(-10 " + -at + ") scale(0.72)");
      moonMark.setAttribute("transform", "translate(-11 " + at + ") scale(0.95)");
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

      night.setAttribute("d", (decl >= 0 ? circlePath(size) : "") + poly + "Z");
      terminator.setAttribute("d", line);
      drawnDecl = decl;
    }

    function fade() {
      var now = performance.now();
      if (now - lastFade < FADE_MS || !earth.animate) return;
      lastFade = now;
      [earth, satsLayer].forEach(function (el) {
        el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: FADE_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)" });
      });
    }

    function setSun(s) {
      var first = sunState === null;
      sunState = s;
      if (drawnDecl === null || Math.abs(s.decl - drawnDecl) > 0.02) drawShade(s.decl);

      // El meridiano del Sol va arriba; el este queda en sentido antihorario.
      var next = clock.wrap180(s.lon - 180);
      // El avance natural del reloj (0,004° por segundo) nunca necesita fundido.
      if (!first && reduced() && Math.abs(clock.wrap180(next - rotation)) > 0.5) fade();
      rotation = next;
      stage.dataset.sunLon = s.lon.toFixed(3);
      stage.dataset.rotation = rotation.toFixed(3);
      spin();
    }

    /* ---------- satélites ---------- */

    function build(sat) {
      var g = node("g", { class: "sat", "data-tz": sat.tz }, satsLayer);
      sat.el = g;

      // Lo que viaja con la Tierra: la ciudad, su amarre y el satélite.
      sat.rigEl = node("g", { class: "sat-rig" }, g);
      sat.tetherEl = node("line", { class: "sat-tether" }, sat.rigEl);
      sat.dotEl = node("circle", { class: "sat-city", r: 2.6 }, sat.rigEl);
      sat.bodyEl = node("g", {}, sat.rigEl);
      node("circle", { class: "sat-hit", r: 13 }, sat.bodyEl);
      sat.probeEl = node("g", { class: "sat-probe" }, sat.bodyEl);
      node("rect", { x: -10.5, y: -1.75, width: 6, height: 3.5, rx: 0.8 }, sat.probeEl);
      node("rect", { x: 4.5, y: -1.75, width: 6, height: 3.5, rx: 0.8 }, sat.probeEl);
      node("circle", { r: 3.6 }, sat.probeEl);
      var beacon = node("circle", { class: "sat-beacon", r: 1.3 }, sat.probeEl);
      beacon.style.animationDelay = ((sats.length * 0.7) % 2.6).toFixed(1) + "s";

      // Lo que se queda derecho: la línea guía (un segmento unidad que se
      // traslada, gira y estira) y la etiqueta.
      sat.leaderEl = node("line", { class: "sat-leader", x1: 0, y1: 0, x2: 1, y2: 0 }, g);
      sat.labelEl = node("g", { class: "sat-label" }, g);
      sat.boxEl = node("rect", { class: "sat-hit", y: -15, height: 30 }, sat.labelEl);
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
      if (compact) return (sat.approx ? "≈" : "") + sat.code;
      var text = (sat.approx ? "≈ " : "") + sat.label;
      return text.length > NAME_CHARS ? text.slice(0, NAME_CHARS - 1) + "…" : text;
    }

    // Parte fija: posiciones en el marco de la Tierra. Solo cambia al redimensionar
    // o al agregar y quitar ciudades.
    function fit() {
      var nameSize = 11;
      var timeSize = compact ? 12 : 13;

      sats.forEach(function (sat) {
        var ux = Math.sin(sat.lon * RAD);
        var uy = Math.cos(sat.lon * RAD);
        var orbit = size + rings[sat.ring];
        sat.orbit = orbit;
        sat.base = Math.atan2(uy, ux);
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
        sat.boxEl.setAttribute("x", fix(-sat.width / 2));
        sat.boxEl.setAttribute("width", fix(sat.width));
      });
      spin();
    }

    // Centro de la etiqueta: sobre su dirección, a la distancia justa para que la caja
    // toque por fuera el círculo de etiquetas (con un lado o con una esquina). Así
    // nunca llega más lejos que ese radio más su propio ancho o alto.
    function labelBox(sat) {
      var ux = Math.cos(sat.angle);
      var uy = Math.sin(sat.angle);
      var ax = Math.abs(ux);
      var ay = Math.abs(uy);
      var a = sat.width / 2;
      var b = LABEL_HEIGHT / 2;
      var reach = ay > 1e-6 ? (labelRadius + b) / ay : Infinity;
      if (reach * ax > a) {
        reach = ax > 1e-6 ? (labelRadius + a) / ax : Infinity;
        if (reach * ay > b) {
          var k = a * ax + b * ay;
          reach = k + Math.sqrt(k * k - (a * a + b * b - labelRadius * labelRadius));
        }
      }
      sat.cx = reach * ux;
      sat.cy = reach * uy;
    }

    // Las etiquetas se apoyan en un círculo exterior a las órbitas. Si dos se pisan,
    // se separan girando alrededor del globo hasta que caben; el satélite no se mueve.
    function relax() {
      var pad = 3;
      for (var pass = 0; pass < 1500; pass++) {
        var moved = false;
        for (var i = 0; i < sats.length; i++) {
          for (var j = i + 1; j < sats.length; j++) {
            var a = sats[i];
            var b = sats[j];
            if (Math.abs(a.cx - b.cx) >= (a.width + b.width) / 2 + pad || Math.abs(a.cy - b.cy) >= LABEL_HEIGHT + pad) continue;
            var gap = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle));
            var push = (gap >= 0 ? 1 : -1) * 0.004;
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

    // Parte que gira: la Tierra, cada satélite y, siguiéndolos, etiquetas y guías.
    function spin() {
      var turn = "rotate(" + rotation.toFixed(3) + ")";
      earth.setAttribute("transform", turn);

      sats.forEach(function (sat) {
        sat.rigEl.setAttribute("transform", turn);
        sat.theta = sat.base + rotation * RAD;
        sat.angle = sat.theta;
        labelBox(sat);
      });

      relax();

      sats.forEach(function (sat) {
        sat.labelEl.setAttribute("transform", "translate(" + fix(sat.cx) + " " + fix(sat.cy) + ")");
        // La guía sale del satélite y muere en el punto más cercano de su etiqueta.
        var x = (sat.orbit + 8) * Math.cos(sat.theta);
        var y = (sat.orbit + 8) * Math.sin(sat.theta);
        var halfW = sat.width / 2 - 3;
        var halfH = LABEL_HEIGHT / 2 - 2;
        var dx = clamp(x, sat.cx - halfW, sat.cx + halfW) - x;
        var dy = clamp(y, sat.cy - halfH, sat.cy + halfH) - y;
        var length = Math.max(0, Math.sqrt(dx * dx + dy * dy) - 3);
        sat.leaderEl.setAttribute(
          "transform",
          "translate(" + fix(x) + " " + fix(y) + ") rotate(" + fix(Math.atan2(dy, dx) / RAD) + ") scale(" + fix(length) + " 1)"
        );
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
      fit();
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
      spin();
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
      // Las ciudades dan la vuelta entera: el hueco para la etiqueta más ancha
      // hace falta en todas direcciones.
      var labelRoom = compact ? 42 : NAME_CHARS * 11 * CHAR + 6;
      var outer = rings[rings.length - 1] + gap + 2;
      size = Math.round(clamp(Math.min(w / 2 - labelRoom - outer, h / 2 - LABEL_HEIGHT - outer), 56, 190));
      labelRadius = size + rings[rings.length - 1] + gap;

      svg.setAttribute("viewBox", fix(-w / 2) + " " + fix(-h / 2) + " " + fix(w) + " " + fix(h));
      stage.classList.toggle("is-compact", compact);
      drawGlobe();
      if (sunState) drawShade(sunState.decl);
      fit();
    }

    /* ---------- arrastrar el globo ---------- */

    // El globo sigue al puntero y una vuelta completa son 24 h; hacia la izquierda
    // (antihorario, como gira la Tierra) el tiempo avanza. Solo ratón y lápiz: con
    // el dedo, arrastrar sobre la escena tiene que seguir desplazando la página.
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
      options.onDrag((-delta / RAD) * 4); // 1° = 4 minutos
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
