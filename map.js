// Карта «Пушкина рядом»: стилизованная схема центра Москвы, нарисованная
// целиком из кода — без чужих карт-сервисов, тайлов и ключей. Всё, что видно
// на карте, — SVG: река, бульварное кольцо, сетка улиц, парки и точки.
//
// Координаты точек (широта/долгота) переводятся в пиксели SVG один раз, при
// построении. Дальше карта работает только с пикселями, поэтому зум и
// панорама — это один transform на группе, а не пересчёт координат.

import { PLACES, VIEW } from "./data.js";

// Система координат рисунка. Карта шире экрана: её двигают и приближают.
export const MAP = { w: 1000, h: 1240, lon0: 55.7558 };
// lon0 — широта, на которой масштаб по обеим осям совпадает (Москва).

// Проекция: равнопромежуточная, локальная. Для города в 30 км неотличима
// от правильной и не тянет за собой никакой библиотеки проекций.
export function project(lat, lon) {
  const kx = Math.cos((VIEW.minLat + (VIEW.maxLat - VIEW.minLat) / 2) * Math.PI / 180) * 111320;
  const ky = 111320;
  const x = (lon - VIEW.minLon) * kx;
  const y = (VIEW.maxLat - lat) * ky;
  const spanX = (VIEW.maxLon - VIEW.minLon) * kx;
  const spanY = (VIEW.maxLat - VIEW.minLat) * ky;
  return { x: (x / spanX) * MAP.w, y: (y / spanY) * MAP.h };
}

// Точки, разложенные по карте. На карту попадают только места внутри её
// рамки: Остафьево в 30 км южнее, оно живёт в списке, но не в кадре.
export const POINTS = PLACES
  .filter((p) => p.lat >= VIEW.minLat && p.lat <= VIEW.maxLat && p.lon >= VIEW.minLon && p.lon <= VIEW.maxLon)
  .map((p) => ({ ...p, ...project(p.lat, p.lon) }));

// Место есть на карте? Нужно и списку, и кнопке «показать на карте».
export const onMap = (id) => POINTS.some((p) => p.id === id);

// Детерминированный шум: карта должна выглядеть одинаково при каждой отрисовке.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

// Сетка улиц: повёрнутая решётка с неровным шагом и редкими «проспектами».
// Тот же приём, что в презентации (graphics.js), — чтобы карта и слайды
// читались как один проект.
function streets(w, h, { step, angle, seed }) {
  const r = rng(seed);
  let out = "";
  for (let x = -h; x < 2 * w; x += step * (0.6 + r() * 0.8))
    out += `<line x1="${x.toFixed(1)}" y1="${-h}" x2="${x.toFixed(1)}" y2="${2 * h}" stroke-width="${r() < 0.14 ? 3.2 : 1.4}"/>`;
  for (let y = -h; y < 2 * h; y += step * (0.6 + r() * 0.8))
    out += `<line x1="${-w}" y1="${y.toFixed(1)}" x2="${2 * w}" y2="${y.toFixed(1)}" stroke-width="${r() < 0.14 ? 3.2 : 1.4}"/>`;
  return `<g transform="rotate(${angle} ${w / 2} ${h / 2})" stroke-linecap="round">${out}</g>`;
}

// Бульварное кольцо — узнаваемый силуэт центра. Замкнутая кривая вокруг
// пушкинского ядра: Пречистенка, Арбат, Никитская, Чистые пруды — все
// места, которые в кадре.
function ring() {
  const k = [
    [55.7365, 37.5965], [55.7455, 37.6005], [55.7575, 37.6065],
    [55.7665, 37.6205], [55.7660, 37.6435], [55.7585, 37.6480],
    [55.7530, 37.6420], [55.7560, 37.6210], [55.7470, 37.6080],
    [55.7395, 37.6010],
  ].map(([la, lo]) => project(la, lo));
  const d = k.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ") + " Z";
  return `<path class="map-ring" d="${d}"/>`;
}

// Река Москва: широкая лента, проходящая южнее ядра точек. Ведёт из левого
// нижнего угла к правому через центр, как в городе.
function river() {
  const k = [
    [55.7060, 37.4820], [55.7140, 37.5360], [55.7200, 37.5670],
    [55.7285, 37.5900], [55.7360, 37.6150], [55.7410, 37.6560],
    [55.7470, 37.7000],
  ].map(([la, lo]) => project(la, lo));
  const d = k.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return `<path class="map-river" d="${d}"/>`;
}

// Полотно карты: один SVG. Слои снизу вверх — вода, парки, улицы, кольцо.
// Точки добавляются поверх уже в разметке (иначе они бы съезжали при
// увеличении вместе с картой). Цвета слоёв заданы в style.css по классу —
// так надёжнее, чем переменные прямо в атрибутах SVG.
export function mapSvg() {
  const bg = `<rect class="map-bg" width="${MAP.w}" height="${MAP.h}"/>`;
  const p1 = project(55.7840, 37.6300), p2 = project(55.7150, 37.5500), p3 = project(55.7620, 37.6130);
  const parks = `
    <ellipse class="map-park" cx="${p1.x.toFixed(1)}" cy="${p1.y.toFixed(1)}" rx="46" ry="34"/>
    <ellipse class="map-park" cx="${p2.x.toFixed(1)}" cy="${p2.y.toFixed(1)}" rx="54" ry="30"/>
    <ellipse class="map-park" cx="${p3.x.toFixed(1)}" cy="${p3.y.toFixed(1)}" rx="30" ry="22"/>`;
  const grid = `<g class="map-grid">${streets(MAP.w, MAP.h, { step: 62, angle: 14, seed: 7 })}</g>`;
  return `<svg id="map" viewBox="0 0 ${MAP.w} ${MAP.h}" preserveAspectRatio="xMidYMid slice"
    xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Схематичная карта Москвы с пушкинскими местами">
    ${bg}${parks}${grid}${river()}${ring()}
  </svg>`;
}
