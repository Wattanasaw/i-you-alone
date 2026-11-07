// รูปปกของโพสต์เทรนด์ยอดนิยมที่สุดของแต่ละสถานที่ (Lemon8)
// โพสต์ที่ได้จากหน้าค้นหามีรูปลิงก์ถาวรอยู่แล้ว แต่โพสต์ที่ได้จากโพสต์ที่เกี่ยวข้องหรือหมุดสถานที่มักไม่มีรูป
// ลิงก์รูป CDN ของ Lemon8 หมดอายุใน ~7 วัน → เปิดหน้าโพสต์ใหม่ก่อนหมดอายุ (จำไว้ใน data/post-images.json)
// รัน หลัง scripts/trend-places.mjs · node scripts/post-images.mjs [--max 220]
import { readFile, writeFile, rename } from "node:fs/promises";

const UA = "Mozilla/5.0 (compatible; IYouAloneBot/1.0; +https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const MAX = arg("--max", 220), TOP = 2; // เปิดสูงสุดกี่หน้าต่อรอบ · กี่โพสต์บนสุดต่อสถานที่
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };

// วันหมดอายุของลิงก์ (วินาที) · ลิงก์ seo/image ของ Lemon8 ไม่หมดอายุ
const expOf = u => /\/seo\/image\?/.test(u || "") ? Infinity : +(String(u || "").match(/[?&]x-expires=(\d+)/) || [])[1] || 0;
const SOON = Date.now() / 1000 + 2 * 86400; // ต้องใช้ได้อีกอย่างน้อย 2 วัน
const usable = u => /^https:\/\//.test(u || "") && expOf(u) > SOON;

const placesData = await readJSON("data/places.json", null);
const trend = await readJSON("data/trend-places.json", []);
const cache = await readJSON("data/post-images.json", {});
const lists = [...(placesData?.places || []), ...trend].filter(p => p.posts?.length);

// โพสต์บนสุด (ไลก์มากสุด) ของแต่ละสถานที่ที่ยังไม่มีรูปใช้ได้ · สถานที่ดังก่อน
const want = new Map();
for (const p of lists.sort((a, b) => (b.hot || b.trend || 0) - (a.hot || a.trend || 0))) {
  for (const x of [...p.posts].sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, TOP)) {
    if (usable(x.image) || usable(cache[x.link]?.img) || cache[x.link]?.none === new Date().toISOString().slice(0, 10)) continue;
    want.set(x.link, x);
  }
}
const todo = [...want.keys()].slice(0, MAX);
console.log(`สถานที่ที่มีโพสต์ ${lists.length} · ต้องหารูป ${want.size} · รอบนี้ ${todo.length}`);

function find(o, key) {
  if (!o || typeof o !== "object") return null;
  if (o[key]) return o[key];
  for (const [k, v] of Object.entries(o)) { if (k === "translation" || k === "manifest") continue; const r = v && typeof v === "object" ? find(v, key) : null; if (r) return r; }
  return null;
}
let got = 0, fails = 0;
for (const link of todo) {
  if (fails >= 8) { console.warn("เปิดหน้า Lemon8 ไม่ได้ติดกันหลายครั้ง หยุดรอบนี้"); break; }
  await sleep(1100);
  try {
    const res = await fetch(link, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) { fails++; continue; }
    const html = await res.text();
    let img = "";
    try {
      const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
      const list = find(JSON.parse(decodeURIComponent(big)), "imageList");
      img = [].concat(list || []).map(x => x?.url).find(u => /^https:\/\//.test(u || "")) || "";
    } catch {}
    if (!img) img = ((html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1] || "").replace(/&amp;/g, "&");
    fails = 0;
    if (img) { cache[link] = { img, exp: expOf(img) === Infinity ? 0 : expOf(img) }; got++; }
    else cache[link] = { none: new Date().toISOString().slice(0, 10) };
  } catch { fails++; }
}

// ใส่รูปให้โพสต์ · ลบลิงก์รูปที่หมดอายุ (แอพจะแสดงไอคอนหมวดแทน)
const live = new Set();
let applied = 0;
for (const p of lists) for (const x of p.posts) {
  live.add(x.link);
  const c = cache[x.link]?.img;
  if (!usable(x.image) && usable(c)) { x.image = c; applied++; }
  else if (x.image && expOf(x.image) < Date.now() / 1000) delete x.image;
}
for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
await save("data/post-images.json", JSON.stringify(cache) + "\n");
if (placesData) await save("data/places.json", JSON.stringify(placesData, null, 1) + "\n");
await save("data/trend-places.json", JSON.stringify(trend, null, 1) + "\n");
console.log(`ได้รูปใหม่ ${got} · ใส่รูปให้โพสต์ ${applied}`);
