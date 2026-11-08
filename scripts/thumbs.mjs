// รูปย่อของรูปจาก Lemon8 — ลิงก์ seo/image ส่งรูปเต็ม 1080px (200 KB – 1.3 MB/รูป) แต่ในแอพแสดงแค่ ~150–400px
// 1) รูปที่เห็นทันทีในรายการ (บอร์ดเทรนด์ · 6 โพสต์บนสุดของแต่ละสถานที่ · รูปปกสถานที่จาก Lemon8)
//    → ย่อเป็น webp กว้าง 480px (ไม่ตัดรูป ~20–40 KB) เก็บใน data/thumbs/ ขึ้นเว็บพร้อมแอพ (เร็ว · ไม่หมดอายุ) ช่อง "th"
// 2) ทุกรูป (รวมคลังโพสต์รายสถานที่) → หาลิงก์ CDN ปลายทางไว้ในช่อง "thumb" ให้แอพย่อผ่าน wsrv.nl ได้
//    (wsrv.nl ดึงลิงก์ seo/image ตรงๆ ไม่ได้ Lemon8 ตอบ 503) · ลิงก์ CDN หมดอายุ ~30 วัน → หาใหม่เมื่อเหลือไม่ถึง 5 วัน
// ต้องมี sharp (ติดตั้งใน .tools/ ตอนรันใน GitHub Actions) — ไม่มีก็ทำแค่ข้อ 2
// รันท้ายสุดก่อนตรวจข้อมูล (หลังทุกขั้นที่แก้ places.json) · node scripts/thumbs.mjs [--minutes 8]
import { readFile, writeFile, rename, readdir, mkdir, unlink, access } from "node:fs/promises";
import { createRequire } from "node:module";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const MINUTES = arg("--minutes", 8), PAR = 6, WIDTH = 480;
const UA = "Mozilla/5.0 (compatible; IYouAloneBot/1.0; +https://wattanasaw.github.io/i-you-alone/)";
const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const exists = p => access(new URL(p, root)).then(() => true, () => false);
const SEO = /^https:\/\/www\.lemon8-app\.com\/seo\/image\?/;
const CDN = /^https:\/\/[^/]*(tiktokcdn|lemon8cdn|byteimg)[^/]*\//;
const expOf = u => +(String(u || "").match(/[?&]x-expires=(\d+)/) || [])[1] || 0;
const now = Date.now() / 1000;
let sharp = null;
try { sharp = createRequire(new URL(".tools/package.json", root))("sharp"); } catch { console.warn("ไม่มี sharp — ข้ามการทำรูปย่อในเว็บ (ใช้ wsrv.nl อย่างเดียว)"); }

const places = await readJSON("data/places.json", null);
const trend = await readJSON("data/trend-places.json", []);
const shardNames = (await readdir(new URL("data/place-posts/", root)).catch(() => [])).filter(f => /^\d+\.json$/.test(f));
const shards = await Promise.all(shardNames.map(f => readJSON("data/place-posts/" + f, {})));
const cache = await readJSON("data/thumb-cache.json", {});
if (!places?.places) { console.error("อ่าน data/places.json ไม่ได้"); process.exit(1); }
const allPlaces = [...places.places, ...trend];

// ---------- 2) ลิงก์ CDN ของรูป seo/image ----------
const items = [
  ...Object.values(places.trends || {}).flat(),
  ...allPlaces.flatMap(p => [p, ...(p.posts || [])]),
  ...shards.flatMap(s => Object.values(s).flatMap(e => e.posts || []))
].filter(x => SEO.test(x?.image || ""));
const urls = [...new Set(items.map(x => x.image))];
const todo = urls.filter(u => !(cache[u] && expOf(cache[u]) - now > 5 * 86400));
console.log(`รูป Lemon8 ${urls.length} รูป · ต้องหาลิงก์ CDN ใหม่ ${todo.length}`);
const T0 = Date.now(), timeUp = () => Date.now() - T0 > MINUTES * 60000;
async function pool(list, fn) { let i = 0; await Promise.all([...Array(PAR)].map(async () => { while (i < list.length && !timeUp()) await fn(list[i++]); })); }
let got = 0, fails = 0;
await pool(todo, async u => {
  if (fails >= 30) return;
  try {
    const res = await fetch(u, { redirect: "manual", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    const loc = res.headers.get("location");
    if (loc && /^https:\/\//.test(loc) && expOf(loc) > now) { cache[u] = loc; got++; } else fails++;
  } catch { fails++; }
});
const live = new Set(urls);
for (const k of Object.keys(cache)) if (!live.has(k) || expOf(cache[k]) < now) delete cache[k];
for (const x of items) { if (cache[x.image]) x.thumb = cache[x.image]; else delete x.thumb; }

// ---------- 1) รูปย่อในเว็บ (รูปที่เห็นทันที) ----------
// ชื่อไฟล์คงที่ต่อรูป: seo/image → item_id-index · ลิงก์ CDN → แฮชของ path (ไม่รวม query ที่เปลี่ยนตามวันหมดอายุ)
const fnv = s => { let h = 0x811c9dc5; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const keyOf = u => { const m = String(u).match(/item_id=(\d+)&index=(\d+)/); return m ? `${m[1]}-${m[2]}` : "c" + fnv(String(u).split("?")[0]); };
const isL8 = u => SEO.test(u || "") || CDN.test(u || "");
// [ออบเจกต์, ช่องรูป, ช่องรูปย่อ]
const wanted = [
  ...Object.values(places.trends || {}).flat().map(x => [x, "image", "th"]),
  ...allPlaces.flatMap(p => [[p, "image", "imageTh"], ...(p.posts || []).map(x => [x, "image", "th"])])
].filter(([o, f]) => isL8(o[f]));
const DIR = "data/thumbs/";
await mkdir(new URL(DIR, root), { recursive: true });
const keep = new Set();
let made = 0, failed = 0;
if (sharp) {
  const jobs = new Map();
  for (const [o, f, tf] of wanted) {
    const file = DIR + keyOf(o[f]) + ".webp";
    keep.add(file);
    if (!jobs.has(file)) jobs.set(file, []);
    jobs.get(file).push([o, f, tf]);
  }
  const need = [];
  for (const [file, refs] of jobs) (await exists(file)) ? refs.forEach(([o, , tf]) => { o[tf] = file; }) : need.push([file, refs]);
  console.log(`รูปย่อในเว็บ ${jobs.size} รูป · ต้องทำใหม่ ${need.length}`);
  await pool(need, async ([file, refs]) => {
    const [o, f] = refs[0];
    // ลิงก์ CDN หมดอายุแล้ว → ใช้ seo/image (ลิงก์ถาวร) แทน
    const src = CDN.test(o[f]) && expOf(o[f]) < now ? null : (o.thumb && expOf(o.thumb) > now ? o.thumb : o[f]);
    if (!src) { failed++; return; }
    try {
      const res = await fetch(src, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { failed++; return; }
      const buf = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 60 }).toBuffer();
      await writeFile(new URL(file, root), buf);
      refs.forEach(([o2, , tf]) => { o2[tf] = file; });
      made++;
    } catch { failed++; }
  });
  // ลบช่อง th ของรูปที่ทำไม่สำเร็จ · ลบไฟล์ที่ไม่ใช้แล้ว
  for (const [o, f, tf] of wanted) if (o[tf] && !keep.has(o[tf])) delete o[tf];
  let pruned = 0;
  for (const f of await readdir(new URL(DIR, root))) if (!keep.has(DIR + f)) { await unlink(new URL(DIR + f, root)); pruned++; }
  console.log(`ทำรูปย่อใหม่ ${made} · ไม่สำเร็จ ${failed} · ลบรูปที่ไม่ใช้ ${pruned}`);
}
// สถานที่/โพสต์ที่รูปเปลี่ยนแล้ว → ล้างช่อง th เก่า
for (const [o, f, tf] of wanted) if (o[tf] && o[tf] !== DIR + keyOf(o[f]) + ".webp") delete o[tf];

await save("data/thumb-cache.json", JSON.stringify(cache) + "\n");
await save("data/places.json", JSON.stringify(places, null, 1) + "\n");
await save("data/trend-places.json", JSON.stringify(trend, null, 1) + "\n");
await Promise.all(shardNames.map((f, k) => save("data/place-posts/" + f, JSON.stringify(shards[k]) + "\n")));
console.log(`ลิงก์ CDN ใหม่ ${got} · ล้มเหลว ${fails} · ${((Date.now() - T0) / 60000).toFixed(1)} นาที`);
