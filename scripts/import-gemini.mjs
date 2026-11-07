// นำเข้าคำตอบจาก Gemini (ที่เจ้าของแอพถามเองด้วย prompt จาก scripts/gemini-batches.mjs) → data/place-ai.json
// วางคำตอบ (คัดลอกทั้งข้อความก็ได้ สคริปต์หา JSON เอง) เป็นไฟล์ใดก็ได้ใน gemini/answers/ (.json / .txt)
// ตรวจทุกช่อง: id ต้องมีในแอพ · confidence ต่ำ/ไม่มีแหล่งอ้างอิง = ไม่ใช้เนื้อหา · เวลาเปิดต้องเป็นรูปแบบ OSM · ราคาสมเหตุสมผล
// ไฟล์ที่นำเข้าแล้วย้ายไป gemini/answers/done/ (ไม่นำเข้าซ้ำ) · node scripts/import-gemini.mjs
import { readFile, writeFile, readdir, mkdir, rename } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const places = [...(await readJSON("data/places.json", { places: [] })).places, ...await readJSON("data/trend-places.json", [])];
const ids = new Set(places.map(p => p.id));
const out = await readJSON("data/place-ai.json", {});
const GOOD_FOR = ["photo", "work", "kids", "pets", "date", "group", "view", "nature", "chill", "budget", "night", "food"];

// JSON จากข้อความคำตอบ (มี ```json ... ``` หรือข้อความอื่นปน)
function parse(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : text).trim();
  const start = body.search(/[\[{]/);
  if (start < 0) return [];
  const j = JSON.parse(body.slice(start, Math.max(body.lastIndexOf("}"), body.lastIndexOf("]")) + 1));
  return Array.isArray(j) ? j : j.places || j.results || [];
}
const str = (v, max) => typeof v === "string" && v.trim() && !/^(null|n\/a|-|ไม่ทราบ|ไม่มีข้อมูล)$/i.test(v.trim()) ? v.trim().slice(0, max) : "";
const L = (v, n, max) => ({
  th: [].concat(v?.th || []).map(s => str(s, max)).filter(Boolean).slice(0, n),
  en: [].concat(v?.en || []).map(s => str(s, max)).filter(Boolean).slice(0, n)
});
// เวลาเปิดแบบ OSM: "Mo-Fr 10:00-20:00; Sa,Su 09:00-21:00" · "24/7" · "Tu-Su 18:00-02:00; Mo off"
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)";
const RULE = new RegExp(`^(?:${DAY}(?:\\s*-\\s*${DAY})?(?:\\s*,\\s*${DAY}(?:\\s*-\\s*${DAY})?)*\\s+)?(?:off|closed|\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}(?:\\s*,\\s*\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2})*)$`);
const hoursOk = h => { const s = str(h, 160); return s && (s === "24/7" || s.split(/\s*;\s*/).filter(Boolean).every(r => RULE.test(r))) ? s.replace(/\s*;\s*/g, "; ") : null; };
const priceOk = p => { const a = Math.round(+p?.min), b = Math.round(+p?.max || +p?.min); return a >= 0 && b >= a && b <= 20000 && (a > 0 || b > 0) ? { min: a, max: b } : null; };

await mkdir(new URL("gemini/answers/done/", root), { recursive: true });
const files = (await readdir(new URL("gemini/answers/", root), { withFileTypes: true }).catch(() => [])).filter(f => f.isFile() && /\.(json|txt|md)$/i.test(f.name));
const stat = { files: 0, ok: 0, notFound: 0, closed: 0, low: 0, unknownId: 0, badHours: 0 };
for (const f of files) {
  let list;
  try { list = parse(await readFile(new URL(`gemini/answers/${f.name}`, root), "utf8")); }
  catch (e) { console.warn(`อ่าน ${f.name} ไม่ได้ (JSON เสีย — ลองคัดลอกคำตอบใหม่):`, e.message.slice(0, 100)); continue; }
  stat.files++;
  const at = new Date().toISOString().slice(0, 10);
  for (const r of list) {
    const id = String(r?.id || "").trim();
    if (!ids.has(id)) { stat.unknownId++; continue; }
    if (r.found === false) { out[id] = { notFound: true, at }; stat.notFound++; continue; }
    const sources = [].concat(r.sources || []).filter(u => /^https?:\/\/[^\s]+$/.test(u)).slice(0, 3);
    const conf = ["high", "medium", "low"].includes(r.confidence) ? r.confidence : "low";
    if (r.closed === true) { out[id] = { closed: true, at, sources }; stat.closed++; continue; }
    if (conf === "low" || !sources.length) { out[id] = { low: true, at }; stat.low++; continue; }
    const hours = hoursOk(r.hours);
    if (r.hours && !hours) stat.badHours++;
    const e = {
      at, conf, sources, hours: hours || undefined, price: priceOk(r.price) || undefined,
      summary: { th: str(r.summary?.th, 140), en: str(r.summary?.en, 160) },
      highlights: L(r.highlights, 4, 60), mustTry: L(r.mustTry, 4, 50), tips: L(r.tips, 3, 90), cons: L(r.cons, 2, 90),
      goodFor: [].concat(r.goodFor || []).filter(x => GOOD_FOR.includes(x)).slice(0, 4),
      travel: { th: str(r.travel?.th, 220), en: str(r.travel?.en, 260) }
    };
    if (!e.summary.th && !e.highlights.th.length && !e.hours && !e.travel.th) { out[id] = { low: true, at }; stat.low++; continue; }
    out[id] = JSON.parse(JSON.stringify(e)); // ตัดช่อง undefined
    stat.ok++;
  }
  await rename(new URL(`gemini/answers/${f.name}`, root), new URL(`gemini/answers/done/${Date.now()}-${f.name}`, root));
}
for (const id of Object.keys(out)) if (!ids.has(id)) delete out[id];
await writeFile(new URL("data/place-ai.json", root), JSON.stringify(out) + "\n");
console.log(`นำเข้า ${stat.files} ไฟล์ → ใช้ได้ ${stat.ok} แห่ง · หาไม่เจอ ${stat.notFound} · ปิดกิจการ ${stat.closed} · ไม่มั่นใจ/ไม่มีแหล่งอ้างอิง ${stat.low} · id ผิด ${stat.unknownId} · เวลาเปิดผิดรูปแบบ (ไม่ใช้) ${stat.badHours}`);
console.log(`รวมใน data/place-ai.json: มีข้อมูล ${Object.values(out).filter(x => x.summary || x.hours).length} แห่ง จากทั้งหมด ${Object.keys(out).length}`);
