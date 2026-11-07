// แปลข้อมูลงานและสถานที่เป็นอังกฤษ/จีนอัตโนมัติ ด้วย Google Gemini (โควต้าฟรี)
// แปลเฉพาะช่องที่ยังไม่มีคำแปล — คำแปลที่แก้เองแล้วจะไม่ถูกทับ
// รัน: GEMINI_API_KEY=xxx node scripts/translate.mjs   (ไม่มีคีย์ = ไม่ทำอะไร)
import { readFile, writeFile } from "node:fs/promises";
import { aiJSON, aiAvailable } from "./gemini.mjs";

const key = aiAvailable();
const MAX_PER_RUN = 20; // จำนวนรายการสูงสุดต่อรอบ (อยู่ในโควต้าฟรี)
const LANGS = { en: "English", zh: "Simplified Chinese" };
const EVENT_FIELDS = ["title", "summary", "details", "highlights", "time", "openDays", "organizer"];
const VENUE_FIELDS = ["name", "address", "parking"];

if (!key) { console.log("ไม่มี AI (GEMINI_API_KEY/GITHUB_TOKEN) — ข้ามการแปล"); process.exit(0); }

async function translate(source, lang) {
  const prompt = `Translate the JSON values from Thai to ${LANGS[lang]} for a Thai event-listing app aimed at tourists.
Keep proper nouns recognisable (e.g. BTS/MRT station names in English), keep numbers, prices and times unchanged, use a natural tone.
Return JSON with exactly the same keys and array lengths. JSON:
${JSON.stringify(source)}`;
  return (await aiJSON(prompt, { temperature: 0.2 })) || {};
}

// หาช่องที่ยังไม่แปล แล้วส่งไปแปลรวดเดียว
function missing(item, fields, lang, extra) {
  const have = item.i18n?.[lang] || {}, out = {};
  for (const f of fields) if (item[f] != null && have[f] == null) out[f] = item[f];
  if (item.price?.note && have.priceNote == null && extra.price) out.priceNote = item.price.note;
  for (const [k, list] of Object.entries(extra.lists || {}))
    if (list?.length && have[k] == null) out[k] = list.map(x => typeof x === "string" ? x : (x.text ?? x.label));
  return out;
}

let done = 0, failed = 0;
async function translateAll(items, fields, extraOf) {
  for (const item of items) {
    for (const lang of Object.keys(LANGS)) {
      if (done >= MAX_PER_RUN || failed >= 3) return;
      const src = missing(item, fields, lang, extraOf(item));
      if (!Object.keys(src).length) continue;
      try {
        const out = await translate(src, lang);
        item.i18n = item.i18n || {};
        item.i18n[lang] = { ...item.i18n[lang] };
        for (const k of Object.keys(src)) {
          const ok = Array.isArray(src[k]) ? Array.isArray(out[k]) && out[k].length === src[k].length : typeof out[k] === "string";
          if (ok) item.i18n[lang][k] = out[k];
        }
        done++; failed = 0;
        console.log(`แปล ${item.id} → ${lang}: ${Object.keys(src).join(", ")}`);
      } catch (e) {
        failed++; console.warn(`แปล ${item.id} → ${lang} ไม่สำเร็จ: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 4500)); // ไม่เกินโควต้าฟรีต่อนาที
    }
  }
}

const evFile = new URL("../data/events.json", import.meta.url);
const vFile = new URL("../data/venues.json", import.meta.url);
const events = JSON.parse(await readFile(evFile, "utf8"));
const venues = JSON.parse(await readFile(vFile, "utf8"));

await translateAll(venues.filter(v => !v.online), VENUE_FIELDS, v => ({ lists: { transit: v.transit } }));
await translateAll(events.filter(e => !e.sample), EVENT_FIELDS, e => ({ price: true, lists: { travelTips: e.travelTips, affiliateLabels: e.affiliateLinks, races: e.races } }));
// สถานที่ที่ใส่ไว้ในงานโดยตรง
await translateAll(events.filter(e => e.venue && !e.sample).map(e => Object.assign(e.venue, { id: e.id + "/venue" })), VENUE_FIELDS, v => ({ lists: { transit: v.transit } }));
events.forEach(e => { if (e.venue) delete e.venue.id; });

await writeFile(evFile, JSON.stringify(events, null, 2) + "\n");
await writeFile(vFile, JSON.stringify(venues, null, 2) + "\n");
console.log(`แปลเสร็จ ${done} รายการ${failed >= 3 ? " (หยุดเพราะ Gemini ผิดพลาดติดกัน 3 ครั้ง)" : ""}`);
