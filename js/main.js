/* Controlador: lista de ciudades, buscador, control de tiempo y persistencia.
   El tiempo mostrado es siempre "ahora + desfase"; al mover el control, el desfase
   visible persigue al elegido con una curva, y con él giran sombra y horas a la vez. */
(function () {
  "use strict";

  var App = window.OrbitalClock;
  var clock = App.clock;
  var STORE_KEY = "orbital-clock:v1";
  var MAX_CITIES = 10;
  var DEFAULTS = ["America/Caracas", "America/New_York", "Europe/Madrid", "Asia/Dubai", "Australia/Sydney"];
  var RANGE = 1440; // ±24 h, en minutos
  var STEP = 15;
  var WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  var MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  var els = {
    status: document.getElementById("status"),
    stage: document.getElementById("stage"),
    sky: document.getElementById("sky"),
    count: document.getElementById("count"),
    zenith: document.getElementById("zenith"),
    utc: document.getElementById("utc"),
    date: document.getElementById("date"),
    now: document.getElementById("now"),
    offset: document.getElementById("offset"),
    offsetOut: document.getElementById("offset-out"),
    search: document.getElementById("search"),
    pop: document.getElementById("pop"),
    results: document.getElementById("results"),
    none: document.getElementById("none"),
    announce: document.getElementById("announce"),
    table: document.getElementById("table"),
    rows: document.getElementById("rows"),
    empty: document.getElementById("empty"),
    note: document.getElementById("note"),
  };

  var atlas = clock.createAtlas(App.CITIES, clock.supportedZones());
  var localTz = clock.localZone();
  var cities = [];
  var offset = 0; // desfase elegido, en minutos
  var shown = 0; // desfase que se está pintando
  var frame = 0;
  var lastFrame = 0;
  var timer = 0;
  var dragRaw = 0;
  var statusTimer = 0;

  function reduced() {
    return window.Pluton && window.Pluton.reducedMotion();
  }

  function write(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /* ---------- persistencia ---------- */

  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (!data || !Array.isArray(data.zones)) return null;
      var seen = {};
      return data.zones
        .filter(function (tz) {
          if (!clock.isValidZone(tz) || seen[tz]) return false;
          seen[tz] = true;
          return true;
        })
        .slice(0, MAX_CITIES);
    } catch (err) {
      return null;
    }
  }

  function save() {
    try {
      var zones = cities.map(function (city) {
        return city.tz;
      });
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ zones: zones }));
    } catch (err) {
      /* almacenamiento no disponible: el reloj sigue funcionando */
    }
  }

  /* ---------- estado y textos ---------- */

  function setStatus(text) {
    window.clearTimeout(statusTimer);
    els.status.innerHTML = "";
    els.status.append("status: ");
    var strong = document.createElement("b");
    strong.textContent = text;
    els.status.appendChild(strong);
  }

  function modeStatus() {
    setStatus(offset ? "simulación " + clock.formatShift(offset) : "tiempo real");
  }

  // Aviso pasajero (ciudad agregada o quitada); luego vuelve el modo del reloj.
  function flashStatus(text) {
    setStatus(text);
    statusTimer = window.setTimeout(modeStatus, 2200);
  }

  function refreshList() {
    var approx = cities.some(function (city) {
      return city.approx;
    });
    var full = cities.length >= MAX_CITIES;
    write(els.count, cities.length + "/" + MAX_CITIES);
    els.table.hidden = cities.length === 0;
    els.empty.hidden = cities.length !== 0;
    els.note.hidden = !approx;
    els.search.disabled = full;
    els.search.placeholder = full ? "máximo " + MAX_CITIES + " · quita una ciudad" : "agregar ciudad: Tokio, Japón, Asia…";
    els.sky.setAttribute(
      "aria-label",
      "La Tierra vista desde encima del polo norte, con la mitad en sombra donde es de noche. " +
        (cities.length
          ? "En órbita: " +
            cities
              .map(function (city) {
                return city.name;
              })
              .join(", ") +
            ". Las horas están en la tabla de ciudades."
          : "Sin ciudades en órbita.")
    );
  }

  /* ---------- pintar un instante ---------- */

  function render() {
    var ms = Date.now() + shown * 60000;
    var sun = clock.sun(ms);
    var date = new Date(ms);
    var local = clock.zoneTime(localTz, ms);

    scene.setSun(sun);
    write(els.zenith, clock.formatPosition(sun.decl, sun.lon));
    write(els.utc, pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes()) + ":" + pad(date.getUTCSeconds()));
    write(els.date, WEEKDAYS[date.getUTCDay()] + " " + date.getUTCDate() + " " + MONTHS[date.getUTCMonth()] + " " + date.getUTCFullYear());

    cities.forEach(function (city) {
      var t = clock.zoneTime(city.tz, ms);
      // Sin latitud conocida no hay altura del Sol: se decide por la hora de pared.
      var day = city.lat === null ? t.hour >= 6 && t.hour < 18 : clock.altitude(city.lat, city.lon, sun) > 0;
      var diff = t.offset - local.offset;

      write(city.timeEl, t.text);
      write(city.dayEl, WEEKDAYS[t.weekday]);
      write(city.phaseEl, " · " + (day ? "día" : "noche"));
      write(city.subEl, city.code + " · " + clock.formatOffset(t.offset));
      write(city.diffEl, city.tz === localTz ? "local" : clock.formatDiff(diff));
      if (city.day !== day) {
        city.day = day;
        city.iconEl.setAttribute("href", day ? "#i-sun" : "#i-moon");
        city.row.classList.toggle("is-night", !day);
      }
      scene.setTime(city.tz, t.text);
    });
  }

  // El reloj avanza solo: un repintado por segundo, alineado con el cambio de segundo.
  function schedule() {
    window.clearTimeout(timer);
    if (document.hidden) return;
    timer = window.setTimeout(function () {
      if (!frame) render();
      schedule();
    }, 1000 - (Date.now() % 1000) + 4);
  }

  /* ---------- control de tiempo ---------- */

  function step(now) {
    var dt = Math.min(now - lastFrame, 64);
    lastFrame = now;
    var gap = offset - shown;
    if (Math.abs(gap) < 0.2) {
      settle();
      return;
    }
    shown += gap * (1 - Math.exp(-dt / 110)); // aproximación exponencial: rápida al salir, suave al llegar
    render();
    frame = requestAnimationFrame(step);
  }

  function settle() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    shown = offset;
    els.stage.removeAttribute("data-busy");
    render();
  }

  function setOffset(minutes) {
    var next = Math.max(-RANGE, Math.min(RANGE, Math.round(minutes / STEP) * STEP));
    if (next === offset) return;
    offset = next;

    els.offset.value = String(offset);
    els.offset.style.setProperty("--p", String((offset + RANGE) / (2 * RANGE)));
    els.offset.setAttribute("aria-valuetext", offset ? clock.formatShift(offset) : "tiempo real, sin desfase");
    write(els.offsetOut, clock.formatShift(offset));
    els.offsetOut.classList.toggle("is-shifted", offset !== 0);
    modeStatus();

    // Movimiento reducido: sin interpolar; la escena cambia con un fundido.
    if (reduced() || document.hidden) {
      settle();
    } else if (!frame) {
      els.stage.setAttribute("data-busy", "true");
      lastFrame = performance.now();
      frame = requestAnimationFrame(step);
    }
  }

  els.offset.addEventListener("input", function () {
    setOffset(Number(els.offset.value));
  });

  els.now.addEventListener("click", function () {
    setOffset(0);
    els.announce.textContent = "De vuelta al tiempo real";
  });

  /* ---------- ciudades ---------- */

  function removeIcon() {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  }

  function buildRow(city) {
    var row = document.createElement("tr");
    row.dataset.tz = city.tz;

    var head = document.createElement("th");
    head.scope = "row";
    var name = document.createElement("span");
    name.className = "c-name";
    name.textContent = city.name + (city.approx ? " ≈" : "");
    name.title = city.name + " · " + city.place;
    city.subEl = document.createElement("span");
    city.subEl.className = "c-sub mono";
    head.append(name, city.subEl);

    var time = document.createElement("td");
    time.className = "t-time";
    city.timeEl = document.createElement("span");
    city.timeEl.className = "c-time mono";
    var phase = document.createElement("span");
    phase.className = "c-sub mono";
    phase.innerHTML = '<svg class="c-icon" viewBox="0 0 16 16" aria-hidden="true"><use href="#i-sun"/></svg>';
    city.iconEl = phase.querySelector("use");
    city.dayEl = document.createElement("span");
    city.phaseEl = document.createElement("span");
    city.phaseEl.className = "c-phase";
    phase.append(city.dayEl, city.phaseEl);
    time.append(city.timeEl, phase);

    city.diffEl = document.createElement("td");
    city.diffEl.className = "t-diff mono";

    var action = document.createElement("td");
    action.className = "t-x";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "c-remove";
    button.setAttribute("aria-label", "Quitar " + city.name);
    button.innerHTML = removeIcon();
    button.addEventListener("click", function (event) {
      // Con teclado, el foco pasa a la fila vecina en vez de perderse.
      var keyboard = event.detail === 0;
      var sibling = row.nextElementSibling || row.previousElementSibling;
      removeCity(city.tz);
      if (keyboard) (sibling ? sibling.querySelector(".c-remove") : els.search).focus();
    });
    action.appendChild(button);

    row.append(head, time, city.diffEl, action);
    row.addEventListener("pointerenter", function () {
      highlight(city.tz);
    });
    row.addEventListener("pointerleave", function () {
      highlight(null);
    });
    row.addEventListener("focusin", function () {
      highlight(city.tz);
    });
    row.addEventListener("focusout", function () {
      highlight(null);
    });

    city.row = row;
    els.rows.appendChild(row);
  }

  function highlight(tz) {
    scene.highlight(tz);
    cities.forEach(function (city) {
      city.row.classList.toggle("is-active", city.tz === tz);
    });
  }

  function hasCity(tz) {
    var key = atlas.info(tz);
    return cities.some(function (city) {
      return city.tz === tz || (!key.approx && city.name === key.name);
    });
  }

  function addCity(tz, animate) {
    if (cities.length >= MAX_CITIES || hasCity(tz)) return null;
    var city = atlas.info(tz);
    var now = clock.zoneTime(tz, Date.now());
    // Huso sin ciudad en la tabla: 15° de longitud por cada hora de desfase.
    if (city.lon === null) city.lon = clock.wrap180(now.offset / 4);
    city.time = now.text;
    city.day = null;

    buildRow(city);
    cities.push(city);
    scene.add(city, animate);
    if (animate) city.row.classList.add("is-new");
    refreshList();
    render();
    return city;
  }

  function removeCity(tz) {
    cities = cities.filter(function (city) {
      if (city.tz !== tz) return true;
      city.row.remove();
      els.announce.textContent = city.name + " sale de la órbita";
      flashStatus(city.name + " fuera de órbita");
      return false;
    });
    scene.remove(tz);
    refreshList();
    save();
  }

  /* ---------- buscador (combobox con lista) ---------- */

  var hits = [];
  var active = -1;

  function closeList() {
    els.pop.hidden = true;
    els.search.setAttribute("aria-expanded", "false");
    els.search.removeAttribute("aria-activedescendant");
    hits = [];
    active = -1;
  }

  function setActive(index) {
    active = index;
    Array.prototype.forEach.call(els.results.children, function (option, i) {
      option.setAttribute("aria-selected", String(i === index));
    });
    if (index >= 0) els.search.setAttribute("aria-activedescendant", "opt-" + index);
    else els.search.removeAttribute("aria-activedescendant");
  }

  function openList() {
    var query = els.search.value;
    if (!clock.normalize(query)) {
      closeList();
      return;
    }
    hits = atlas.search(query, 6);
    els.results.innerHTML = "";
    var now = Date.now();

    hits.forEach(function (hit, i) {
      var taken = hasCity(hit.tz);
      var option = document.createElement("li");
      option.id = "opt-" + i;
      option.setAttribute("role", "option");
      option.dataset.index = String(i);
      if (taken) option.setAttribute("aria-disabled", "true");

      var name = document.createElement("span");
      name.className = "o-name";
      name.textContent = hit.name;
      var place = document.createElement("span");
      place.className = "o-place";
      place.textContent = hit.place;
      var meta = document.createElement("span");
      meta.className = "o-meta mono";
      meta.textContent = taken ? "en órbita" : clock.formatOffset(clock.zoneTime(hit.tz, now).offset);
      option.append(name, place, meta);
      els.results.appendChild(option);
    });

    els.results.hidden = hits.length === 0;
    els.none.hidden = hits.length !== 0;
    els.pop.hidden = false;
    els.search.setAttribute("aria-expanded", "true");
    setActive(hits.length ? 0 : -1);

    // En móvil la lista puede abrirse bajo el borde de la pantalla: se sube el campo.
    if (els.pop.getBoundingClientRect().bottom > window.innerHeight) {
      els.search.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
    }
  }

  function choose(index) {
    var hit = hits[index];
    if (!hit) return;
    var city = addCity(hit.tz, true);
    if (!city) {
      els.announce.textContent = hit.name + " ya está en órbita";
      return;
    }
    save();
    els.search.value = "";
    closeList();
    els.announce.textContent = city.name + " en órbita. Hora local " + city.time;
    flashStatus(city.name + " en órbita");
  }

  els.search.addEventListener("input", openList);
  els.search.addEventListener("focus", openList);
  // El cierre espera un instante: en pantallas táctiles el blur puede llegar antes que el toque.
  els.search.addEventListener("blur", function () {
    window.setTimeout(function () {
      if (document.activeElement !== els.search) closeList();
    }, 150);
  });

  els.search.addEventListener("keydown", function (event) {
    var open = !els.pop.hidden;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
      } else if (hits.length) {
        var dir = event.key === "ArrowDown" ? 1 : -1;
        setActive((active + dir + hits.length) % hits.length);
      }
    } else if (event.key === "Enter") {
      if (open && active >= 0) {
        event.preventDefault();
        choose(active);
      }
    } else if (event.key === "Escape") {
      if (open) closeList();
      else els.search.value = "";
    }
  });

  // pointerdown no debe robar el foco del campo: así el clic llega antes del blur.
  els.pop.addEventListener("pointerdown", function (event) {
    event.preventDefault();
  });

  els.results.addEventListener("click", function (event) {
    var option = event.target.closest("[role='option']");
    if (option) choose(Number(option.dataset.index));
  });

  els.results.addEventListener("pointermove", function (event) {
    var option = event.target.closest("[role='option']");
    if (option && Number(option.dataset.index) !== active) setActive(Number(option.dataset.index));
  });

  /* ---------- escena ---------- */

  var scene = App.createScene({
    stage: els.stage,
    svg: els.sky,
    onHover: highlight,
    onDragStart: function () {
      dragRaw = offset;
    },
    onDrag: function (minutes) {
      dragRaw = Math.max(-RANGE, Math.min(RANGE, dragRaw + minutes));
      setOffset(dragRaw);
    },
  });

  document.addEventListener("visibilitychange", function () {
    els.stage.classList.toggle("is-paused", document.hidden);
    if (document.hidden) {
      window.clearTimeout(timer);
      if (frame) settle();
    } else {
      render();
      schedule();
    }
  });

  (load() || DEFAULTS).forEach(function (tz) {
    addCity(tz, false);
  });
  refreshList();
  render();
  schedule();
})();
