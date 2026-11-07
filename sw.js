// Service worker: à¹ƒà¸«à¹‰à¹à¸­à¸žà¹€à¸›à¸´à¸”à¹„à¸”à¹‰à¹€à¸£à¹‡à¸§à¹à¸¥à¸°à¹ƒà¸Šà¹‰à¸‡à¸²à¸™à¸­à¸­à¸Ÿà¹„à¸¥à¸™à¹Œà¹„à¸”à¹‰à¸šà¸²à¸‡à¸ªà¹ˆà¸§à¸™
const CACHE = "iyoualone-v26";
const ASSETS = ["./", "index.html", "css/style.css", "js/config.js", "js/i18n.js", "js/app.js", "js/member.js", "icons/icon.svg", "icons/logo-full.svg", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¹à¸¥à¸°à¹‚à¸„à¹‰à¸”: à¹€à¸Šà¹‡à¸„à¹€à¸§à¸­à¸£à¹Œà¸Šà¸±à¸™à¸¥à¹ˆà¸²à¸ªà¸¸à¸”à¸à¸±à¸šà¹€à¸‹à¸´à¸£à¹Œà¸Ÿà¹€à¸§à¸­à¸£à¹Œà¸à¹ˆà¸­à¸™à¹€à¸ªà¸¡à¸­ (no-cache) à¸–à¹‰à¸²à¸­à¸­à¸Ÿà¹„à¸¥à¸™à¹Œà¹ƒà¸Šà¹‰à¸‚à¸­à¸‡à¹ƒà¸™à¹à¸„à¸Š
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
