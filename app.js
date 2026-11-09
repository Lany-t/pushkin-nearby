// «Пушкин рядом» — логика приложения.
//
// Что здесь есть:
//   • карта-схема с панорамой и приближением (жесты и колесо);
//   • восемь пушкинских мест, по ним — карточка с цитатой и вопросом;
//   • прогресс: пройденные места сохраняются в IndexedDB;
//   • определение «я рядом» по геолокации с открытием карточки при подходе;
//   • локальный профиль по имени — без сервера и пароля.
//
// Внешних библиотек нет: карта нарисована в map.js, хранение — в IndexedDB,
// движение — на CSS-переходах.

import { PLACES } from "./data.js";
import { POINTS, MAP, mapSvg, project, onMap } from "./map.js";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/* ------------------------------------------------------------------ *
 * Хранилище: профиль и прогресс
 * ------------------------------------------------------------------ */

const DB_NAME = "pushkin-nearby";
const DB_VERSION = 1;

// Небольшая обёртка над IndexedDB: одна база, одно хранилище «progress»,
// ключ — id места, значение — запись о прохождении. Обёртка нужна только
// ради промисов, чтобы не писать колбэки на каждый вызов.
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("progress")) db.createObjectStore("progress", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// IndexedDB может быть недоступна (приватное окно, запрет данных). Тогда
// приложение работает без сохранения — это хуже, но не ломается.
let db = null;
openDB().then((d) => { db = d; }).catch(() => { db = null; });

async function store(name, mode = "readonly") {
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    tx.onerror = () => reject(tx.error);
    resolve(tx.objectStore(name));
  });
}

export async function readAll() {
  const s = await store("progress");
  if (!s) return [];
  return new Promise((resolve) => {
    const r = s.getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}

async function write(rec) {
  const s = await store("progress", "readwrite");
  if (!s) return;
  s.put(rec);
}

async function meta(k, v) {
  const s = await store("meta", v === undefined ? "readonly" : "readwrite");
  if (!s) return undefined;
  if (v === undefined) {
    return new Promise((resolve) => {
      const r = s.get(k);
      r.onsuccess = () => resolve(r.result ? r.result.v : undefined);
      r.onerror = () => resolve(undefined);
    });
  }
  s.put({ k, v });
}

/* ------------------------------------------------------------------ *
 * Состояние
 * ------------------------------------------------------------------ */

const state = {
  me: null,             // имя пользователя
  done: new Set(),      // id пройденных мест
  saved: {},            // id -> запись (дата, ответ)
  answered: {},         // id -> выбранный индекс в вопросе
  nearId: null,         // место, к которому подошли
  activeId: null,       // открытая карточка
};

/* ------------------------------------------------------------------ *
 * Вопросы: к каждому месту — один вопрос с четырьмя вариантами
 * ------------------------------------------------------------------ */

const QUIZ = {
  "arbat-53": {
    q: "Что Пушкин снял на Арбате весной 1831 года?",
    a: ["Дачу за городом", "Второй этаж дома Хитрово", "Кабинет в типографии", "Комнату в трактире"],
    right: 1,
    fact: "Квартира на Арбате — единственная сохранившаяся московская квартира поэта. Музей открылся здесь в 1986 году.",
  },
  voznesenie: {
    q: "С кем венчался Пушкин в храме у Никитских ворот?",
    a: ["С Анной Керн", "С Елизаветой Хитрово", "С Натальей Гончаровой", "С Софьей Пушкиной"],
    right: 2,
    fact: "Венчание прошло 18 февраля 1831 года. Через несколько дней Пушкин писал Плетнёву, что «переродился».",
  },
  "prechistenka-12": {
    q: "Как называется основная экспозиция музея на Пречистенке?",
    a: ["«Пушкин и его эпоха»", "«Москва пушкинская»", "«Лицей и судьба»", "«Рукописи поэта»"],
    right: 0,
    fact: "Собрание музея — больше четырёх тысяч предметов: рукописи, портреты, вещи самого поэта и его круга.",
  },
  "monument-1880": {
    q: "Кто изваял бронзового Пушкина на Пушкинской площади?",
    a: ["Марк Антокольский", "Александр Опекушин", "Иван Мартос", "Пётр Клодт"],
    right: 1,
    fact: "Памятник открыли 6 июня 1880 года. В 1950 году его перенесли к бывшей колокольне Страстного монастыря.",
  },
  elokhovo: {
    q: "Чем связано Елохово с Пушкиным?",
    a: ["Здесь он венчался", "Здесь его отпевали", "Здесь его крестили", "Здесь он снимал дом"],
    right: 2,
    fact: "Крестили Александра 8 июня 1799 года. Памятная доска на соборе появилась только в 1991 году.",
  },
  "haritonevsky-21": {
    q: "Что находится по адресу Большой Харитоньевский, 21?",
    a: ["Усадьба Хрущёвых", "Палаты Юсуповых", "Дом Кетчер", "Особняк Гончаровых"],
    right: 1,
    fact: "Семья Пушкиных жила в этом переулке в 1801–1808 годах — палаты Юсуповых помнят поэта ребёнком.",
  },
  "basmannaya-36": {
    q: "Кем приходился Пушкину хозяин дома на Старой Басманной?",
    a: ["Отцом", "Дядей", "Братом", "Дедушкой"],
    right: 1,
    fact: "Василий Львович — дядя поэта, известный поэт своего времени. Его дом был средоточием литературной Москвы.",
  },
  novodevichy: {
    q: "С какого места начинается трагедия Пушкина «Борис Годунов»?",
    a: ["С Кремля", "С Новодевичьего монастыря", "С Красной площади", "С Чудова монастыря"],
    right: 1,
    fact: "У стен Новодевичьего в 1598 году просили Годунова принять царство. Именно здесь начинается пьеса.",
  },
  ostafyevo: {
    q: "Чья усадьба — Остафьево, названная «Русским Парнасом»?",
    a: ["Петра Вяземского", "Николая Карамзина", "Александра Тургенева", "Дениса Давыдова"],
    right: 0,
    fact: "Вяземский — друг и соратник Пушкина. В Остафьеве собирался литературный круг пушкинской эпохи.",
  },
};

/* ------------------------------------------------------------------ *
 * Карта: панорама, приближение, точки
 * ------------------------------------------------------------------ */

const cam = { x: 0, y: 0, s: 1, min: 1, max: 4 };
let camera, stage;

function applyCam() {
  camera.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;
  // Точки компенсируют масштаб: остаются одного размера при любом приближении.
  for (const p of camera.querySelectorAll(".pin"))
    p.style.setProperty("--k", (1 / cam.s).toFixed(3));
}

function clampCam() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const mw = MAP.w * cam.s, mh = MAP.h * cam.s;
  cam.x = Math.min(0, Math.max(w - mw, cam.x));
  cam.y = Math.min(0, Math.max(h - mh, cam.y));
  cam.s = Math.min(cam.max, Math.max(cam.min, cam.s));
}

// Приближение пальцами и колесом: масштаб меняется вокруг точки под пальцем,
// поэтому карта «не убегает» из-под руки.
function zoomAt(px, py, factor) {
  const ns = Math.min(cam.max, Math.max(cam.min, cam.s * factor));
  const k = ns / cam.s;
  cam.x = px - (px - cam.x) * k;
  cam.y = py - (py - cam.y) * k;
  cam.s = ns;
  clampCam(); applyCam();
}

function initGestures() {
  let pts = new Map(), lastD = 0, lastMid = null;

  stage.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pts.size === 1) {
      cam.x += e.clientX - prev.x;
      cam.y += e.clientY - prev.y;
      clampCam(); applyCam();
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastD) zoomAt(mid.x, mid.y, d / lastD);
      if (lastMid) { cam.x += mid.x - lastMid.x; cam.y += mid.y - lastMid.y; clampCam(); applyCam(); }
      lastD = d; lastMid = mid;
    }
  });

  const drop = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) { lastD = 0; lastMid = null; }
  };
  stage.addEventListener("pointerup", drop);
  stage.addEventListener("pointercancel", drop);

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  stage.addEventListener("dblclick", (e) => zoomAt(e.clientX, e.clientY, 1.8));
}

// Центрировать карту на точке: место оказывается в середине свободной части
// экрана — выше листа и ниже шапки.
function focusOn(p, open) {
  const w = stage.clientWidth, h = stage.clientHeight;
  const targetS = Math.max(cam.s, 2.1);
  cam.s = targetS;
  const sx = (p.x / MAP.w) * w * targetS;
  const sy = (p.y / MAP.h) * h * targetS;
  cam.x = w / 2 - sx;
  cam.y = (h * 0.42) - sy;
  clampCam();
  camera.style.transition = "transform .5s cubic-bezier(.22,1,.36,1)";
  applyCam();
  setTimeout(() => { camera.style.transition = ""; }, 520);
  if (open) select(p.id);
}

function drawPins() {
  for (const p of POINTS) {
    const pin = el("div", "pin");
    pin.dataset.id = p.id;
    // Левый верх карты — точка отсчёта; position в процентах от размера карты.
    pin.style.left = (p.x / MAP.w * 100) + "%";
    pin.style.top = (p.y / MAP.h * 100) + "%";
    pin.innerHTML = `<span class="pin__pulse"></span><span class="pin__hit"></span><span class="pin__dot"><span class="pin__num"></span></span>`;
    pin.querySelector(".pin__hit").addEventListener("click", () => focusOn(p, true));
    camera.appendChild(pin);
  }
  refreshPins();
}

function refreshPins() {
  for (const p of POINTS) {
    const pin = camera.querySelector(`.pin[data-id="${CSS.escape(p.id)}"]`);
    if (!pin) continue;
    const n = orderOf(p.id);
    const done = state.done.has(p.id);
    pin.classList.toggle("pin--done", done);
    pin.classList.toggle("pin--active", state.activeId === p.id);
    pin.classList.toggle("pin--near", state.nearId === p.id && !done);
    pin.querySelector(".pin__num").innerHTML = done
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>`
      : String(n);
    pin.querySelector(".pin__hit").setAttribute(
      "aria-label", `${n}. ${p.name}, ${p.address}${done ? " — пройдено" : ""}`
    );
    pin.querySelector(".pin__pulse").hidden = done || state.activeId === p.id;
  }
}

/* ------------------------------------------------------------------ *
 * Лист: карточка места, список, вопрос
 * ------------------------------------------------------------------ */

let sheet, sheetScroll, sheetHeaderSub, quiz;

function orderOf(id) {
  return PLACES.findIndex((p) => p.id === id) + 1;
}

function showList() {
  state.activeId = null;
  refreshPins();
  sheetScroll.innerHTML = "";
  const head = el("div");
  head.append(el("span", "chip", "Все места"));
  head.append(el("h2", "place", `${PLACES.length} пушкинских мест`));
  sheetScroll.append(head);

  const ul = el("ul", "place-list");
  PLACES.forEach((p) => {
    const li = el("li");
    const b = el("button");
    b.type = "button";
    const done = state.done.has(p.id);
    const num = el("span", "n" + (done ? " n--done" : ""));
    // Галочка нарисована линией, а не взята из шрифта: в Golos Text её нет,
    // и раньше она приезжала из системного шрифта телефона — то есть выглядела
    // по-разному на разных устройствах. SVG одинаков везде.
    if (done) num.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 6.5"/></svg>`;
    else num.textContent = String(orderOf(p.id));
    b.append(num);
    const txt = el("span");
    txt.append(el("div", "nm", p.name));
    txt.append(el("div", "ad", onMap(p.id) ? `${p.address} · ${p.years}` : `${p.address} · за городом`));
    b.append(txt);
    // Место за рамкой карты не к чему приближать — открываем только карточку.
    if (onMap(p.id)) b.addEventListener("click", () => focusOn(p, true));
    else b.addEventListener("click", () => showPlace(p.id));
    li.append(b); ul.append(li);
  });
  sheetScroll.append(ul);
}

function showPlace(id) {
  const p = POINTS.find((x) => x.id === id);
  if (!p) return;
  state.activeId = id;
  refreshPins();
  sheet.classList.add("open");
  sheetScroll.scrollTop = 0;
  sheetScroll.innerHTML = "";

  const done = state.done.has(p.id);
  const head = el("div");
  head.append(el("span", "chip" + (done ? " chip--done" : ""),
    done ? "Пройдено" : `Место ${orderOf(id)} из ${POINTS.length}`));
  head.append(el("h2", "place", p.name));
  head.append(el("div", "meta", `${p.address} · ${p.years}`));
  sheetScroll.append(head);

  // Фотографии: главная и, если есть, вторая — «что здесь было раньше».
  for (const [file, note] of [[p.photo, p.photoNote], [p.photo2, p.photoNote2]]) {
    if (!file) continue;
    const fig = el("figure");
    const img = el("img");
    img.src = "assets/photos/" + file;
    img.alt = note || p.name;
    img.loading = "lazy";
    fig.append(img);
    if (note) fig.append(el("figcaption", null, note));
    sheetScroll.append(fig);
  }

  const q = el("blockquote", "quotebox");
  q.append(el("p", null, "«" + p.quote + "»"));
  q.append(el("cite", null, p.from));
  sheetScroll.append(q);

  const body = el("div", "body");
  body.append(el("p", null, p.what));
  sheetScroll.append(body);

  const nth = QUIZ[p.id];
  if (nth) {
    const b = el("button", "cta", done ? "Пройти снова" : "Выполнить задание");
    b.type = "button";
    b.addEventListener("click", () => openQuiz(p));
    sheetScroll.append(b);
  }
}

/* ------------------------------------------------------------------ *
 * Вопрос
 * ------------------------------------------------------------------ */

let current = null;

function openQuiz(p) {
  current = p;
  const item = QUIZ[p.id];
  if (!item) return;
  quiz.querySelector(".crumb").textContent = p.name;
  quiz.querySelector(".q").textContent = item.q;
  const box = quiz.querySelector(".opts");
  box.innerHTML = "";
  quiz.querySelector(".fact").classList.remove("on");
  quiz.querySelector(".fact").innerHTML = "";
  quiz.querySelector(".next").hidden = true;

  item.a.forEach((text, i) => {
    const b = el("button", "opt");
    b.type = "button";
    b.append(el("span", "l", "абвг"[i].toUpperCase()));
    b.append(el("span", null, text));
    b.addEventListener("click", () => answer(b, i, item));
    box.append(b);
  });
  quiz.classList.add("on");
  document.body.style.overflow = "hidden";
}

function answer(btn, i, item) {
  if (btn.disabled) return;
  const opts = [...quiz.querySelectorAll(".opt")];
  opts.forEach((o) => (o.disabled = true));
  const good = i === item.right;
  state.answered[current.id] = i;

  if (good) {
    btn.classList.add("ok");
    state.done.add(current.id);
    state.saved[current.id] = { id: current.id, at: new Date().toISOString(), answer: i };
    write(state.saved[current.id]);
  } else {
    btn.classList.add("no", "shake");
    opts[item.right].classList.add("ok");
  }

  const f = quiz.querySelector(".fact");
  f.innerHTML = "";
  f.append(el("b", null, good ? "Верно. " : "Правильный ответ — " + item.a[item.right] + ". "));
  f.append(document.createTextNode(item.fact));
  f.classList.add("on");
  quiz.querySelector(".next").hidden = false;
  refreshPins();
  renderHeader();
  if (navigator.vibrate) navigator.vibrate(good ? [10, 40, 10] : 25);
}

function closeQuiz() {
  quiz.classList.remove("on");
  document.body.style.overflow = "";
  if (current) { showPlace(current.id); }
  current = null;
}

/* ------------------------------------------------------------------ *
 * Геолокация: «я рядом» — открыть место, к которому подошли
 * ------------------------------------------------------------------ */

function haversine(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dla = (b.lat - a.lat) * r, dlo = (b.lon - a.lon) * r;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function watchMe() {
  if (!navigator.geolocation) return;
  const me = $("#me");
  navigator.geolocation.watchPosition(
    (pos) => {
      const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      // Своя метка на карте: те же проценты, что у точек.
      const pt = project(here.lat, here.lon);
      me.style.left = (pt.x / MAP.w * 100) + "%";
      me.style.top = (pt.y / MAP.h * 100) + "%";
      // Показываем метку только если человек попал в охват карты.
      me.hidden = pt.x < -50 || pt.x > MAP.w + 50 || pt.y < -50 || pt.y > MAP.h + 50;
      let best = null, bestD = Infinity;
      for (const p of POINTS) {
        const d = haversine(here, p);
        if (d < bestD) { bestD = d; best = p; }
      }
      const wasNear = state.nearId;
      state.nearId = bestD < 300 ? best.id : null;
      if (state.nearId !== wasNear) {
        refreshPins();
        if (state.nearId && !state.done.has(state.nearId)) {
          const p = POINTS.find((x) => x.id === state.nearId);
          focusOn(p, false);
          showPlace(p.id);
          if (navigator.vibrate) navigator.vibrate(25);
        }
      }
    },
    () => { me.hidden = true; },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
  );
}

/* ------------------------------------------------------------------ *
 * Шапка, профиль, запуск
 * ------------------------------------------------------------------ */

function renderHeader() {
  const total = POINTS.length, done = state.done.size;
  sheetHeaderSub.textContent = `${total} ${total === 1 ? "место" : "мест"} · ${done ? done + " пройдено" : "ничего не пройдено"}`;
  $("#openList").hidden = false;
}

async function boot() {
  stage = $("#stage");
  camera = $("#camera");
  sheet = $("#sheet");
  sheetScroll = $("#sheetScroll");
  sheetHeaderSub = $("#sub");
  quiz = $("#quiz");

  camera.innerHTML = mapSvg();
  drawPins();
  initGestures();

  const saved = await readAll();
  for (const r of saved) { state.done.add(r.id); state.saved[r.id] = r; }
  state.me = await meta("me");

  const hello = $("#hello");
  if (state.me) {
    hello.classList.add("off");
    $("#who").textContent = state.me;
  }

  $("#helloForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#nameInput").value.trim() || "Гуляющий";
    state.me = name;
    await meta("me", name);
    $("#who").textContent = name;
    hello.classList.add("off");
  });

  $("#openList").addEventListener("click", () => {
    // Кнопка списка: если открыта карточка места — вернуть список,
    // иначе просто раскрыть или свернуть панель.
    if (state.activeId) {
      showList();
      sheet.classList.add("open");
    } else {
      sheet.classList.toggle("open");
    }
  });

  $("#recenter").addEventListener("click", () => {
    cam.s = 1; cam.x = 0; cam.y = 0;
    camera.style.transition = "transform .5s cubic-bezier(.22,1,.36,1)";
    applyCam();
    setTimeout(() => { camera.style.transition = ""; }, 520);
    showList();
  });

  $("#grip").addEventListener("click", () => sheet.classList.toggle("open"));
  quiz.querySelector(".close").addEventListener("click", closeQuiz);
  quiz.querySelector(".next").addEventListener("click", closeQuiz);

  // Первый кадр: карта целиком, лист открыт со списком мест.
  const fit = () => {
    const k = Math.max(stage.clientWidth / MAP.w, stage.clientHeight / MAP.h);
    cam.s = k; cam.min = k; cam.max = k * 4;
    cam.x = (stage.clientWidth - MAP.w * k) / 2;
    cam.y = (stage.clientHeight - MAP.h * k) / 2;
    clampCam(); applyCam();
  };
  fit();
  addEventListener("resize", fit);

  showList();
  renderHeader();
  watchMe();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
