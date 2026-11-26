// Service Worker for 沪教英语闪卡
// 策略：核心资源预缓存；图片等运行时用 stale-while-revalidate
const CACHE = "shanghai-flashcards-v9";
const CORE = [
  "./",
  "./index.html",
  "./style.css?v=20",
  "./words.js?v=10",
  "./critical.js?v=5",
  "./app.js?v=48",
  "./credits.html"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  // 只缓存同源 GET 请求
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML：网络优先，失败回退缓存（保证更新及时）
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put("./", copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./").then(r => r || caches.match(req)))
    );
    return;
  }

  // 其他资源：stale-while-revalidate（缓存优先，后台更新）
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        // 只缓存成功的响应
        if (res && res.status === 200 && res.type !== "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
