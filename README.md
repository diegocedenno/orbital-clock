# orbital-clock

> A world clock that is also a 24-hour dial: the Earth, seen from above the North Pole, turns under a fixed Sun, and every city orbits it as a satellite carrying its local time across the real day/night terminator.
>
> Un reloj mundial que es a la vez un dial de 24 horas: la Tierra, vista desde encima del polo norte, gira bajo un Sol fijo, y cada ciudad la orbita como un satélite con su hora local, cruzando el terminador día/noche real.

![orbital-clock preview](docs/preview.png)

**[English](#english)** · **[Español](#español)**

---

## English

### What it does

- Draws the Earth in a polar azimuthal projection inside a fixed 24-hour dial. The frame of reference is the Sun's: solar noon stays at the top (12), midnight at the bottom (00), and the night side is shaded with the real terminator for the current instant.
- The whole globe turns once every 24 hours, counter-clockwise as seen from above the North Pole, and each city rides along as a satellite on a dashed orbit above its own meridian. Where a satellite sits on the dial is that city's **solar time**; its label shows the **civil time** of its time zone, so the two can differ a little (Madrid's clock, for instance, runs well ahead of its Sun).
- A table lists the same cities with their UTC offset, the difference from your own time zone and whether it is day or night there.
- Search any IANA time zone by city, country or region — accents are ignored, so `bogota` finds Bogotá. Caracas is there by default; add up to ten cities, remove them, and the list survives a reload (`localStorage`).
- Drag time ±24 h with the slider, or grab the globe with a mouse and turn it: the Earth spins, the cities orbit from day into night and every clock rolls with them. **ahora** snaps back to real time.

### What makes it technically interesting

- **The terminator is real astronomy, not half a disc.** The subsolar point comes from the Astronomical Almanac's low-precision solar position (declination plus the equation of time), and the curve is the solution of `tan φ = −cos(λ − λ☉) / tan δ` for each longitude.
- **No division by zero at the equinox.** The curve is evaluated with `atan2`, so when the declination reaches 0 it degenerates on its own into the straight line through the pole. The pole ends up lit or dark depending on the season, and the fill rule flips accordingly.
- **Time is a rotation, so a frame only writes `transform`.** With the Sun fixed, the night shape depends on the declination alone and is rebuilt only when that drifts. Everything else — continents, graticule, city marks, satellites — turns rigidly by the subsolar longitude: one `rotate()` on the globe and one per satellite, at 60 fps while scrubbing ±24 h and once a second (15° per hour) in real time.
- **Labels stay upright while their satellites orbit.** On every step each label is placed tangent to an outer circle in its satellite's direction, overlapping boxes push each other apart around the globe, and a leader line (a unit segment that is only translated, rotated and stretched) ties it back to its satellite. A sweep of the whole ±24 h range with ten cities shows no overlaps and nothing leaving the scene, from 360 px to desktop.
- **Time zones without a time-zone library.** Local times and UTC offsets are read back from `Intl.DateTimeFormat` with `formatToParts`, with one cached formatter per zone. The search index is built from `Intl.supportedValuesOf("timeZone")` and falls back to the bundled city table.
- **Hand-drawn low-poly continents.** No map data is downloaded: about thirty simplified outlines live in `js/data.js` as longitude/latitude pairs and are projected at runtime. Zones outside the 86-entry city table get an approximate longitude from their UTC offset (15° per hour) and are marked with `≈`.
- **Reduced motion is a first-class path.** With `prefers-reduced-motion` there is no interpolated spin: the globe and its satellites jump to the new position with a fade, and the clocks change at once.
- **Accessible.** The search is an ARIA combobox with a listbox, the slider is a native range input with a spoken value, and the scene is mirrored by a real table.
- **Zero dependencies, zero build.** Plain HTML, CSS and JavaScript. Fonts are bundled; nothing is requested from the network.

### Keyboard

| Key | Action |
| --- | --- |
| Type in the search field | Filter cities and time zones |
| `↑` `↓` | Move through the results |
| `Enter` | Put the highlighted city in orbit |
| `Esc` | Close the results |
| `←` `→` on the slider | Shift time by 15 minutes (the globe turns 3.75°) |
| `Home` `End` on the slider | Jump to −24 h / +24 h |

### Run it

Double-click `index.html`. That is all — there is no build step and no server.
It also works as-is on GitHub Pages.

### License

[MIT](LICENSE) © Diego Cedeño. Inter and JetBrains Mono are bundled under the [SIL Open Font License](assets/fonts/).

---

## Español

### Qué hace

- Dibuja la Tierra en proyección azimutal polar dentro de un dial fijo de 24 horas. El marco de referencia es el del Sol: el mediodía solar queda arriba (12), la medianoche abajo (00), y el lado de la noche se sombrea con el terminador real del instante actual.
- El globo entero da una vuelta cada 24 horas, en sentido antihorario visto desde encima del polo norte, y cada ciudad viaja con él como un satélite en una órbita punteada sobre su propio meridiano. La posición de un satélite en el dial es la **hora solar** de esa ciudad; su etiqueta muestra la **hora civil** de su huso, así que pueden diferir un poco (el reloj de Madrid, por ejemplo, va bastante adelantado respecto a su Sol).
- Una tabla repite las mismas ciudades con su desfase UTC, la diferencia respecto a tu zona horaria y si allí es de día o de noche.
- Busca cualquier huso IANA por ciudad, país o región, sin distinguir acentos: `bogota` encuentra Bogotá. Caracas viene por defecto; puedes agregar hasta diez ciudades, quitarlas, y la lista sobrevive a una recarga (`localStorage`).
- Arrastra el tiempo ±24 h con el control, o agarra el globo con el ratón y gíralo: la Tierra rota, las ciudades orbitan del día a la noche y todos los relojes avanzan con ellas. **ahora** vuelve al tiempo real.

### Qué lo hace interesante técnicamente

- **El terminador es astronomía de verdad, no medio disco.** El punto subsolar sale de la posición solar de baja precisión del Astronomical Almanac (declinación más ecuación del tiempo), y la curva es la solución de `tan φ = −cos(λ − λ☉) / tan δ` para cada longitud.
- **Sin división entre cero en el equinoccio.** La curva se evalúa con `atan2`, así que cuando la declinación llega a 0 degenera sola en la recta que pasa por el polo. El polo queda iluminado o a oscuras según la estación, y la regla de relleno se invierte con él.
- **El tiempo es un giro, así que un frame solo escribe `transform`.** Con el Sol fijo, la forma de la noche depende únicamente de la declinación y solo se rehace cuando esta cambia. Todo lo demás —continentes, retícula, marcas de ciudad, satélites— gira rígidamente según la longitud subsolar: un `rotate()` en el globo y uno por satélite, a 60 fps al recorrer ±24 h y una vez por segundo (15° por hora) en tiempo real.
- **Las etiquetas siguen derechas mientras sus satélites orbitan.** En cada paso, cada etiqueta se coloca tangente a un círculo exterior en la dirección de su satélite, las cajas que se solapan se empujan alrededor del globo, y una línea guía (un segmento unidad que solo se traslada, gira y estira) la une a su satélite. Un barrido de todo el rango de ±24 h con diez ciudades no da solapes ni etiquetas fuera de la escena, de 360 px a escritorio.
- **Husos horarios sin librería de husos.** Las horas locales y los desfases UTC se leen de `Intl.DateTimeFormat` con `formatToParts`, con un formateador en caché por zona. El índice del buscador sale de `Intl.supportedValuesOf("timeZone")` y, si no existe, de la tabla de ciudades incluida.
- **Continentes low-poly dibujados a mano.** No se descarga cartografía: una treintena de contornos simplificados viven en `js/data.js` como pares longitud/latitud y se proyectan en tiempo de ejecución. Los husos fuera de la tabla de 86 lugares reciben una longitud aproximada a partir de su desfase UTC (15° por hora) y se marcan con `≈`.
- **El movimiento reducido es un camino de primera clase.** Con `prefers-reduced-motion` no hay giro interpolado: el globo y sus satélites saltan a la nueva posición con un fundido, y los relojes cambian de golpe.
- **Accesible.** El buscador es un combobox ARIA con lista, el control es un `input` de rango nativo con valor hablado, y la escena tiene su reflejo en una tabla real.
- **Cero dependencias, cero build.** HTML, CSS y JavaScript sin más. Las fuentes van incluidas; no se pide nada a la red.

### Teclado

| Tecla | Acción |
| --- | --- |
| Escribir en el buscador | Filtrar ciudades y husos horarios |
| `↑` `↓` | Recorrer los resultados |
| `Enter` | Poner en órbita la ciudad resaltada |
| `Esc` | Cerrar los resultados |
| `←` `→` en el control | Mover el tiempo 15 minutos (el globo gira 3,75°) |
| `Inicio` `Fin` en el control | Saltar a −24 h / +24 h |

### Cómo correrlo

Doble clic en `index.html`. Nada más: no hay build ni servidor.
También funciona tal cual en GitHub Pages.

### Licencia

[MIT](LICENSE) © Diego Cedeño. Inter y JetBrains Mono se incluyen bajo la [SIL Open Font License](assets/fonts/).
