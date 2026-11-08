// ชื่อสถานที่ที่ "ชื่อจริงเป็นภาษาอังกฤษ" (แบรนด์/ชื่อร้านภาษาอังกฤษ เช่น Sea Life Bangkok Ocean World, The Story Bar)
// → แอพแสดงชื่ออังกฤษเป็นชื่อหลัก (ชื่อไทยที่เป็นคำทับศัพท์แสดงเป็นบรรทัดรอง)
// ชื่อไทยที่ถอดเป็นอักษรโรมัน (Wat Arun, Mon Ing Dao Cafe) หรือแปลเป็นอังกฤษ (บรมบรรพต → Golden Mount) = ใช้ชื่อไทยเหมือนเดิม
// แยกด้วยกฎตัวอักษรไม่ได้ (อักษรโรมันเหมือนกัน) → ให้ AI ตัดสินทีละ 150 ชื่อ/ครั้ง (ใช้โควต้าน้อยมาก) · ผลจำไว้ใน data/name-origin.json
// ใส่ p.nameEn = true ลง data/places.json + data/trend-places.json · node scripts/name-origin.mjs [--ai 10]
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const AI_MAX = arg("--ai", 10), PER = 150;
const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };

const data = await readJSON("data/places.json", null);
if (!data?.places) { console.error("อ่าน data/places.json ไม่ได้"); process.exit(1); }
const trend = await readJSON("data/trend-places.json", []);
const cache = await readJSON("data/name-origin.json", {});
const all = [...data.places, ...trend];
const TH = /[฀-๿]/, isLatin = s => /[a-z]/i.test(s || "") && !TH.test(s || "");
const key = p => `${p.name?.th}|${p.name?.en}`;
// ต้องตัดสินเฉพาะที่มีทั้งชื่อไทย (อักษรไทย) และชื่ออังกฤษ
const cand = all.filter(p => TH.test(p.name?.th || "") && isLatin(p.name?.en));
const todo = cand.filter(p => !cache[key(p)]);
console.log(`สถานที่ที่มีทั้งชื่อไทยและอังกฤษ ${cand.length} · รอตัดสิน ${todo.length} · AI: ${aiName()}`);

let asked = 0;
for (let i = 0; i < todo.length && aiAvailable() && asked < AI_MAX; i += PER) {
  const group = todo.slice(i, i + PER);
  try {
    const out = await aiJSON(`For each Thai place below you get its Thai name and English name. Decide which is the ORIGINAL official name:
- "en" = the place's own name is English/foreign (a brand or business named in English, e.g. "Sea Life Bangkok Ocean World" ↔ "บางกอก ซี ไลฟ์ โอเชียนเวิลด์", "The Story Bar" ↔ "เดอะสตอรี่บาร์", "Silver Oaks Coffee", "Underwater World Pattaya", "Catmosphere Cat Café", "Kramfeine"). The Thai name is just the English written in Thai letters.
- "th" = the original name is Thai and the English is a romanization or translation (e.g. "Wat Arun", "Mon Ing Dao Cafe" ↔ "ม่อนอิงดาวคาเฟ่", "Plern Plern Cafe" ↔ "เพลิน เพลิน คาเฟ่", "Golden Mount" ↔ "บรมบรรพต", "Ruen A Rom" ↔ "รื่นอารมย์", "Khok Phanom Di").
If unsure, answer "th".
Return JSON {"r":[{"i": index, "o": "en"|"th"}]}
Places: ${JSON.stringify(group.map((p, j) => ({ i: j, th: p.name.th, en: p.name.en, type: p.kind })))}`, { temperature: 0 });
    asked++;
    for (const x of out?.r || []) { const p = group[x.i]; if (p && (x.o === "en" || x.o === "th")) cache[key(p)] = x.o; }
  } catch (e) { console.warn("AI:", e.message.slice(0, 140)); break; }
}

let n = 0;
for (const p of all) { if (cache[key(p)] === "en") { p.nameEn = true; n++; } else delete p.nameEn; }
const live = new Set(cand.map(key));
for (const k of Object.keys(cache)) if (!live.has(k)) delete cache[k];
await save("data/name-origin.json", JSON.stringify(cache) + "\n");
await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
await save("data/trend-places.json", JSON.stringify(trend, null, 1) + "\n");
console.log(`ถาม AI ${asked} ครั้ง · ชื่อจริงเป็นภาษาอังกฤษ ${n} แห่ง · ตัดสินแล้ว ${Object.keys(cache).length}/${cand.length}`);
