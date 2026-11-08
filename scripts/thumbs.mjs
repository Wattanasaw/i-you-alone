// รูปย่อของโพสต์ Lemon8 — ลิงก์ seo/image ส่งรูปเต็ม 1080px (200 KB – 1.3 MB/รูป) แต่ในแอพแสดงแค่ ~150–400px
// และบริการย่อรูปฟรี (wsrv.nl) ดึงลิงก์ seo/image ไม่ได้ (Lemon8 ตอบ 503) แต่ดึงลิงก์ CDN ปลายทางได้
// → หาลิงก์ CDN ปลายทางของทุกรูปไว้ในช่อง "thumb" (แอพย่อผ่าน wsrv.nl เหลือ ~20–40 KB/รูป ถ้าล้มเหลวใช้รูปเดิม)
// ลิงก์ CDN หมดอายุ (~30 วัน) → หาใหม่เมื่อเหลือไม่ถึง 5 วัน · จำไว้ใน data/thumb-cache.json
// รันท้ายสุดก่อนตรวจข้อมูล (หลังทุกขั้นที่แก้ places.json) · node scripts/thumbs.mjs [--minutes 8]
import { readFile, writeFile, rename, readdir } from "node:fs/promises";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const MINUTES = arg("--minutes", 8), PAR = 6;
const UA = "Mozilla/5.0 (compatible; IYouAloneBot/1.0; +https://wattanasaw.github.io/i-you-alone/)";
const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const SEO = /^https:\/\/www\.lemon8-app\.com\/seo\/image\?/;
const expOf = u => +(String(u || "").match(/[?&]x-expires=(\d+)/) || [])[1] || 0;
const now = Date.now() / 1000;

const places = await readJSON("data/places.json", null);
const trend = await readJSON("data/trend-places.json", []);
const shardNames = (await readdir(new URL("data/place-posts/", root)).catch(() => [])).filter(f => /^\d+\.json$/.test(f));
const shards = await Promise.all(shardNames.map(f => readJSON("data/place-posts/" + f, {})));
const cache = await readJSON("data/thumb-cache.json", {});
if (!places?.places) { console.error("อ่าน data/places.json ไม่ได้"); process.exit(1); }

// ทุกที่ที่มีรูปจาก Lemon8: โพสต์บอร์ดเทรนด์ · โพสต์ของแต่ละสถานที่ · รูปปกสถานที่ · คลังโพสต์รายสถานที่
const items = [
  ...Object.values(places.trends || {}).flat(),
  ...[...places.places, ...trend].flatMap(p => [p, ...(p.posts || [])]),
  ...shards.flatMap(s => Object.values(s).flatMap(e => e.posts || []))
].filter(x => SEO.test(x?.image || ""));
const urls = [...new Set(items.map(x => x.image))];
const fresh = u => cache[u] && expOf(cache[u]) - now > 5 * 86400;
// ที่ยังไม่มี/ใกล้หมดอายุ · รูปบนบอร์ดเทรนด์และโพสต์บนสุดมาก่อน (อยู่ต้นรายการอยู่แล้ว)
const todo = urls.filter(u => !fresh(u));
console.log(`รูป Lemon8 ${urls.length} รูป · ต้องหาลิงก์ใหม่ ${todo.length}`);

const T0 = Date.now();
let got = 0, fails = 0, i = 0;
async function worker() {
  while (i < todo.length && Date.now() - T0 < MINUTES * 60000 && fails < 30) {
    const u = todo[i++];
    try {
      const res = await fetch(u, { redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      const loc = res.headers.get("location");
      if (loc && /^https:\/\//.test(loc) && expOf(loc) > now) { cache[u] = loc; got++; } else fails++;
    } catch { fails++; }
  }
}
await Promise.all([...Array(PAR)].map(worker));

// ใส่ช่อง thumb (เฉพาะลิงก์ที่ยังไม่หมดอายุ) · ลบแคชของรูปที่ไม่ใช้แล้ว
const live = new Set(urls);
for (const k of Object.keys(cache)) if (!live.has(k) || expOf(cache[k]) < now) delete cache[k];
let set = 0;
for (const x of items) { if (cache[x.image]) { x.thumb = cache[x.image]; set++; } else delete x.thumb; }
await save("data/thumb-cache.json", JSON.stringify(cache) + "\n");
await save("data/places.json", JSON.stringify(places, null, 1) + "\n");
await save("data/trend-places.json", JSON.stringify(trend, null, 1) + "\n");
await Promise.all(shardNames.map((f, k) => save("data/place-posts/" + f, JSON.stringify(shards[k]) + "\n")));
console.log(`หาลิงก์ได้ ${got} · ล้มเหลว ${fails} · มีรูปย่อ ${set}/${items.length} · ${((Date.now() - T0) / 60000).toFixed(1)} นาที`);
