// Service worker «Пушкина рядом»: после первого открытия приложение
// работает без сети. Стратегия простая и намеренно ручная — никаких
// сборщиков и библиотек.
//
//   • оболочка приложения (html, js, css, шрифты, иконки) — cache-first;
//   • картинки мест — cache-first с догрузкой при первом обращении;
//   • всё остальное — из сети, а если сети нет, отдаём кэш.
//
// Обновили файлы — поднимите VERSION, и старый кэш уедет.

const VERSION = "v1";
const SHELL = `pushkin-shell-${VERSION}`;
const MEDIA = `pushkin-media-${VERSION}`;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./map.js",
  "./data.js",
  "./manifest.webmanifest",
  "./icons/192.png",
  "./icons/512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  // Шрифты — подмножествами: браузер возьмёт woff2, а TTF лежит рядом
  // на случай, если woff2 не поддержится. Кэшируем те и другие.
  "./assets/fonts/dela.woff2",
  "./assets/fonts/golos-400.woff2",
  "./assets/fonts/golos-700.woff2",
  "./assets/fonts/DelaGothicOne-Regular.ttf",
  "./assets/fonts/GolosText-Regular.ttf",
  "./assets/fonts/GolosText-Bold.ttf",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL)
      // Отдельная запись не должна срывать установку целиком.
      .then((c) => Promise.allSettled(SHELL_FILES.map((f) => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== MEDIA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // чужие домены не трогаем

  const isMedia = /\/assets\/photos\//.test(url.pathname);

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const bucket = isMedia ? MEDIA : SHELL;
            const copy = res.clone();
            caches.open(bucket).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === "navigate" ? caches.match("./index.html") : Response.error()));
    })
  );
});
