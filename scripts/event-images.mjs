// ให้ AI ดูรูปปก/โปสเตอร์งาน แล้วให้คะแนน "ความน่ากด" 1–10 (รัน หลัง scripts/ai-review.mjs)
// โปสเตอร์ที่เป็นตาราง/ตัวหนังสือล้วน/โลโก้เปล่า/รูปว่าง → คะแนนต่ำ ไม่ขึ้น "ห้ามพลาด" · รูปสวยชัด → ดันขึ้น
// ผลจำไว้ใน data/event-images.json (ไม่ถามซ้ำถ้ารูปเดิม) · ไม่มี AI = ใส่คะแนนที่จำไว้อย่างเดียว
// รัน: node scripts/event-images.mjs [--ai 15]
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const AI_MAX = arg("--ai", 15);  // คำขอ AI ต่อรอบ
const PER_ASK = 6;               // งานต่อคำขอ (1 รูป/งาน)
const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };

const data = await readJSON("data/auto-events.json", null);
if (!data?.events) { console.error("อ่าน data/auto-events.json ไม่ได้"); process.exit(1); }
const cache = await readJSON("data/event-images.json", {});
const key = ev => `${ev.id}|${ev.image}`;

// งานใกล้วันจัดก่อน (60 วันข้างหน้า = ช่วงที่ขึ้น "ห้ามพลาด" ได้)
const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
const todo = data.events.filter(ev => ev.image && !cache[key(ev)] && ev.startDate <= soon).sort((a, b) => a.startDate.localeCompare(b.startDate));
console.log(`งานมีรูป ${data.events.filter(e => e.image).length} · ให้คะแนนแล้ว ${Object.keys(cache).length} · รอตรวจ ${todo.length} · AI: ${aiName()}`);

async function thumb(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    const type = r.headers.get("content-type")?.split(";")[0] || "";
    if (!r.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    // รูปใหญ่เกิน ~1.5MB ข้าม (ส่งให้ AI ไม่ไหว)
    return buf.length < 1.5e6 ? { mime: type, b64: buf.toString("base64") } : null;
  } catch { return null; }
}

let asked = 0, fails = 0;
for (let i = 0; i < todo.length && aiAvailable() && asked < AI_MAX && fails < 3; i += PER_ASK) {
  const group = todo.slice(i, i + PER_ASK), images = [], items = [];
  for (const ev of group) {
    const im = await thumb(ev.image);
    if (!im) { cache[key(ev)] = { score: 3, why: "โหลดรูปไม่ได้", at: new Date().toISOString() }; continue; }
    items.push({ id: ev.id, image: images.length, title: ev.title.slice(0, 80) });
    images.push(im);
  }
  if (!images.length) continue;
  const prompt = `You rate event cover images for a mobile event-discovery app (shown as a card thumbnail). Images are attached in order, numbered from 0.
For each item give "score" 1–10 = how attractive and tappable the image is as a cover:
- high (7–10): eye-catching key visual, artist/performer photo, venue/crowd/product shot, clear and bright, readable at small size.
- medium (4–6): decent poster but busy or small text.
- low (1–3): mostly text, tables/schedules, documents, plain logo, blank/placeholder, very blurry or dark.
Also "why": very short Thai reason.
Return JSON: {"results":[{"id","score","why"}]}
Items: ${JSON.stringify(items)}`;
  try {
    const out = await aiJSON(prompt, { images });
    asked++;
    for (const r of out?.results || []) {
      const ev = group.find(e => e.id === r.id);
      if (ev && +r.score) cache[key(ev)] = { score: Math.max(1, Math.min(10, Math.round(+r.score))), why: String(r.why || "").slice(0, 60), at: new Date().toISOString() };
    }
    await sleep(4500);
  } catch (e) { fails++; console.warn("AI ให้คะแนนรูปไม่ได้:", e.message.slice(0, 160)); }
}

// ใส่คะแนนลงงาน + ล้างผลของงานที่ไม่มีแล้ว
const live = new Set(data.events.map(key));
let scored = 0;
for (const ev of data.events) { const c = cache[key(ev)]; if (c) { ev.imageScore = c.score; scored++; } else delete ev.imageScore; }
for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
await save("data/event-images.json", JSON.stringify(cache, null, 1) + "\n");
await save("data/auto-events.json", JSON.stringify(data, null, 2) + "\n");
console.log(`ถาม AI ${asked} ครั้ง · งานที่มีคะแนนรูป ${scored} · คะแนนต่ำ (≤3) ${data.events.filter(e => e.imageScore <= 3).length}`);
