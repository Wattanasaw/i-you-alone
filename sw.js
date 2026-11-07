// Service worker: ให้แอพเปิดได้เร็วและใช้งานออฟไลน์ได้บางส่วน
const CACHE = "iyoualone-v41";
const ASSETS = ["./", "index.html", "css/style.css", "js/config.js", "js/i18n.js", "js/app.js", "js/member.js", "js/google-places.js", "js/categorize.js", "icons/icon.svg", "icons/logo-full.svg", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // ข้อมูลและโค้ด: เช็คเวอร์ชันล่าสุดกับเซิร์ฟเวอร์ก่อนเสมอ (no-cache) ถ้าออฟไลน์ใช้ของในแคช
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
