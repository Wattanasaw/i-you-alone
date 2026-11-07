// เขต/อำเภอ ของทุกสถานที่ (ใช้แสดงในรายการ + ตัวกรองเขต/อำเภอ) จากพิกัด → OpenStreetMap Nominatim (reverse, ฟรี ≤ 1 ครั้ง/วินาที)
// จำผลไว้ใน data/place-districts.json ตามช่องพิกัด ~100 ม. (ไม่ถามซ้ำ) แล้วใส่ p.district ลง data/places.json + data/trend-places.json
// รัน หลัง scripts/trend-places.mjs · node scripts/place-districts.mjs [--max 1500]
import { readFile, writeFile, rename } from "node:fs/promises";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const MAX = arg("--max", 1500);
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };

const data = await readJSON("data/places.json", null);
if (!data?.places) { console.error("ไม่มี data/places.json"); process.exit(1); }
const trend = await readJSON("data/trend-places.json", []);
const cache = await readJSON("data/place-districts.json", {});
const key = p => `${(+p.lat).toFixed(3)},${(+p.lng).toFixed(3)}`;
const clean = s => String(s || "").replace(/^(อำเภอ|เขต|กิ่งอำเภอ)\s*/, "").trim();
// ที่อยู่ที่มี "อำเภอ X" / "อ.X" / "เขต X" อยู่แล้ว ใช้ได้เลยไม่ต้องถาม
const fromAddr = p => clean(String(p.address || "").match(/(?:อำเภอ|อ\.|เขต)\s*([^\s,]+)/)?.[0]);

const all = [...data.places, ...trend].filter(p => Number.isFinite(+p.lat) && Number.isFinite(+p.lng));
const todo = [...new Set(all.filter(p => !fromAddr(p) && !(key(p) in cache)).map(key))].slice(0, MAX);
console.log(`สถานที่ ${all.length} · จำแล้ว ${Object.keys(cache).length} ช่อง · รอบนี้ถาม ${todo.length}`);
let fails = 0;
for (const k of todo) {
  const [lat, lng] = k.split(",");
  await sleep(1100);
  try {
    const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&accept-language=th&lat=${lat}&lon=${lng}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) })).json();
    const a = j.address || {};
    const d = Object.values(a).find(v => /^(อำเภอ|เขต|กิ่งอำเภอ)/.test(v)) || (a.city === "กรุงเทพมหานคร" ? a.suburb : null) || a.county || a.town || null;
    cache[k] = d ? clean(d) : null;
    fails = 0;
  } catch (e) { if (++fails >= 5) { console.warn("Nominatim ไม่ตอบ หยุดรอบนี้:", e.message); break; } }
}
let n = 0;
for (const p of all) { const d = fromAddr(p) || cache[key(p)]; if (d) { p.district = d; n++; } else delete p.district; }
await save("data/place-districts.json", JSON.stringify(cache) + "\n");
await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
await save("data/trend-places.json", JSON.stringify(trend, null, 1) + "\n");
console.log(`มีเขต/อำเภอ ${n}/${all.length} แห่ง`);
