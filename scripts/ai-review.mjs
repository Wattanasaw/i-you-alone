// ให้ AI (Google Gemini โควต้าฟรี) ตรวจงานที่ดึงอัตโนมัติอีกชั้น หลัง scripts/fetch-events.mjs
// - คัดงานที่ไม่ใช่งานจริง/ไม่เปิดให้คนทั่วไป/ไม่เหมาะสม ออก
// - แก้หมวดให้ถูก (รวมถึงไนท์ไลฟ์), หาสปอนเซอร์, ระบุงาน 20+ (มีแอลกอฮอล์)
// - เขียนสรุปสั้น + แปลชื่อ/สรุปเป็น ไทย/อังกฤษ/จีน
// ผลจะจำไว้ใน data/ai-cache.json → งานเดิมที่ข้อมูลไม่เปลี่ยนไม่ต้องถาม AI ซ้ำ (ประหยัดโควต้า)
// รัน: GEMINI_API_KEY=xxx node scripts/ai-review.mjs
// ไม่มีคีย์ = ไม่ถาม AI แต่ยังใส่ผลที่จำไว้ให้งานที่เพิ่งดึงใหม่ (ใช้ในเครื่องที่รัน local-fetch)
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";

import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const key = aiAvailable(); // Gemini หรือ GitHub Models (สำรองเมื่อ Gemini โควต้าหมด)
const BATCH = 8;        // งานต่อคำขอ
const MAX_BATCHES = 10; // คำขอสูงสุดต่อรอบ (≤ 80 งาน อยู่ในโควต้าฟรีรายวัน)
const DRY = process.argv.includes("--dry");

const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const win = {}; new Function("window", await readFile(new URL("js/config.js", root), "utf8"))(win);
const CATS = win.APP_CONFIG.categories.map(c => c.id);

const data = await readJSON("data/auto-events.json", null);
if (!data) { console.error("อ่าน data/auto-events.json ไม่ได้"); process.exit(1); }
const cache = await readJSON("data/ai-cache.json", {});
if (!key && !Object.keys(cache).length) { console.log("ไม่มี AI (GEMINI_API_KEY/GITHUB_TOKEN) และยังไม่มีผลตรวจ — ข้าม"); process.exit(0); }
if (!key) console.log("ไม่มี AI — ใช้เฉพาะผลตรวจที่จำไว้"); else console.log("ใช้ AI:", aiName());

// ลายเซ็นข้อมูลงาน: เปลี่ยนเมื่อชื่อ/วัน/คำอธิบาย/สถานที่เปลี่ยน → ตรวจใหม่
const sig = ev => createHash("sha1").update([ev.title, ev.startDate, ev.summary, ev.venue?.name || ev.venueId].join("|")).digest("hex").slice(0, 12);

async function ask(batch) {
  const items = batch.map(ev => ({
    id: ev.id, title: ev.title, guessedCategory: ev.category, summary: ev.summary || "",
    venue: ev.venue?.name || ev.venueId, province: ev.venue?.province, date: ev.startDate + (ev.endDate && ev.endDate !== ev.startDate ? ` to ${ev.endDate}` : ""),
    price: ev.price, source: ev.sourceName
  }));
  const prompt = `You review auto-scraped event listings for a Thai event-discovery app. For each item decide:
- ok: true only if it is a real event or venue people can attend/join in Thailand. false for test pages, merchandise/donation-only pages, private or internal company events, gambling, sexual/adult content, scams or anything inappropriate. Being at a bar/pub/club is fine (ok: true).
- reason: very short Thai explanation (only needed when ok is false).
- category: one of ${JSON.stringify(CATS)}. "seminar" = talks, seminars, conferences, forums (people listen); "learning" = workshops, courses, classes, hands-on training; "expo" = trade/consumer fairs, expos, conventions; "exhibition" = art/museum/photo/immersive exhibitions, pop-up exhibitions. Use "nightlife" for artists/bands/DJs playing at pubs, bars, clubs, rooftops, parties and club nights; "concert" for concerts/shows at halls/arenas/festivals.
- sponsor: the brand/company that presents or sponsors the event (e.g. "Singha Corporation presents ..."), not the ticket site or venue. null if none is stated.
- age20: true if it is alcohol-focused (bar, pub, club, beer/wine/whisky event) so Thai law limits entry to 20+.
- th / en / zh: {"title", "summary"}. title = the event name in that language (keep brand/artist names as-is). summary = 1–2 factual sentences (max 160 chars) using ONLY the given data. Never invent dates, prices or artists.
Return JSON: {"results": [{"id", "ok", "reason", "category", "sponsor", "age20", "th", "en", "zh"}]} with one result per item.
Items:
${JSON.stringify(items)}`;
  const out = await aiJSON(prompt);
  return Array.isArray(out?.results) ? out.results : [];
}

// ใส่ผลตรวจลงงาน — คืนค่า false = ตัดงานนี้ออก
function apply(ev, r) {
  if (r.ok === false) return false;
  if (CATS.includes(r.category)) ev.category = r.category;
  const sponsor = typeof r.sponsor === "string" && r.sponsor.trim().slice(0, 60);
  if (sponsor) ev.sponsor = sponsor;
  if (r.age20 === true) ev.age20 = true;
  for (const lang of ["th", "en", "zh"]) {
    const x = r[lang];
    if (!x || typeof x !== "object") continue;
    const tx = {};
    if (typeof x.title === "string" && x.title.trim()) tx.title = x.title.trim().slice(0, 160);
    if (typeof x.summary === "string" && x.summary.trim()) tx.summary = x.summary.trim().slice(0, 220);
    if (Object.keys(tx).length) { ev.i18n = ev.i18n || {}; ev.i18n[lang] = { ...tx, ...ev.i18n[lang] }; }
  }
  ev.aiChecked = true;
  return true;
}

const todo = data.events.filter(ev => cache[ev.id]?.sig !== sig(ev));
console.log(`งานทั้งหมด ${data.events.length} · ต้องตรวจใหม่ ${todo.length}`);
let asked = 0, failed = 0;
for (let i = 0; key && i < todo.length && asked < MAX_BATCHES && failed < 3; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  try {
    const results = await ask(batch);
    asked++; failed = 0;
    for (const r of results) {
      const ev = batch.find(e => e.id === r?.id);
      if (ev) cache[ev.id] = { sig: sig(ev), at: new Date().toISOString().slice(0, 10), ...r, id: undefined };
    }
  } catch (e) {
    failed++; console.warn("AI ผิดพลาด:", e.message);
    if (e.status === 429) break; // โควต้าฟรีหมด → รอบหน้าทำต่อ
  }
  await new Promise(r => setTimeout(r, 4500)); // ไม่เกินโควต้าฟรีต่อนาที
}

// ใช้ผลที่จำไว้กับทุกงาน (รวมงานที่ตรวจไปแล้วรอบก่อน)
const rejected = [];
data.events = data.events.filter(ev => {
  const r = cache[ev.id];
  if (!r || r.sig !== sig(ev)) return true;
  if (apply(ev, r)) return true;
  rejected.push({ id: ev.id, title: ev.title, reason: r.reason || "" });
  return false;
});
// งานที่ AI ตัดออก: ใส่ skip ไว้ ตัวดึงงานจะไม่เปิดหน้านี้ซ้ำ
data.skip = [...new Set([...(data.skip || []), ...rejected.map(x => x.id)])];
data.aiRejected = [...rejected, ...(data.aiRejected || []).filter(x => !rejected.some(y => y.id === x.id))].slice(0, 200);
if (asked) data.aiReviewedAt = new Date().toISOString();

// ลบผลของงานที่ไม่มีแล้ว ไม่ให้ไฟล์โตเรื่อยๆ (ทำเฉพาะฝั่งที่มีคีย์ ไฟล์ผลจะได้แก้จากที่เดียว)
const live = new Set([...data.events.map(e => e.id), ...rejected.map(x => x.id)]);
if (key) for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];

console.log(`ถาม AI ${asked} ครั้ง · ตัดออก ${rejected.length}${rejected.length ? ": " + rejected.map(x => `${x.title} (${x.reason})`).join(" | ") : ""}${failed >= 3 ? " · หยุดเพราะผิดพลาดติดกัน 3 ครั้ง" : ""}`);
if (DRY) process.exit(0);
await save("data/auto-events.json", JSON.stringify(data, null, 2) + "\n");
if (key) await save("data/ai-cache.json", JSON.stringify(cache, null, 1) + "\n");
