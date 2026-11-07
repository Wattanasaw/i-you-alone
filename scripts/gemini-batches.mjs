// สร้างชุด prompt ให้เจ้าของแอพนำไปถาม Gemini (แอพ Gemini บนเว็บ/มือถือ) ด้วยตัวเองทีละชุด
// → ได้ข้อมูลสถานที่ (เวลาเปิด-ปิด ราคา สรุปรีวิว เคล็ดลับ วิธีเดินทาง) เป็น JSON → บันทึกคำตอบลง gemini/answers/ → node scripts/import-gemini.mjs
// เลือกสถานที่ที่ยังขาดข้อมูลก่อน (ไม่มีสรุปรีวิว/ไม่มีเวลาเปิด) · คาเฟ่/ร้าน/ผับบาร์/ที่บันเทิง + กระแสแรงก่อน · ข้ามที่ทำไปแล้ว
// node scripts/gemini-batches.mjs [--size 25] [--kind nightlife]
import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SIZE = +arg("--size", 25), ONLY = arg("--kind", "");
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
const provTh = id => win.PROVINCES.find(p => p.id === id)?.th || id;

const places = [...(await readJSON("data/places.json", { places: [] })).places, ...await readJSON("data/trend-places.json", [])];
const reviews = await readJSON("data/place-reviews.json", {});
const done = await readJSON("data/place-ai.json", {});
const KIND_TH = { cafe: "คาเฟ่", animalcafe: "คาเฟ่สัตว์", restaurant: "ร้านอาหาร", nightlife: "ผับ/บาร์", themepark: "สวนสนุก/สวนน้ำ", zoo: "สวนสัตว์", nature: "ทะเล/น้ำตก/จุดชมวิว", landmark: "วัด/แลนด์มาร์ก", museum: "พิพิธภัณฑ์", park: "อุทยาน" };
const FUN = { cafe: 3, animalcafe: 3, restaurant: 3, nightlife: 3, themepark: 2, zoo: 2, museum: 1 };
const need = p => (reviews[p.id]?.summary ? 0 : 4) + (p.hours ? 0 : 2);
const todo = places.filter(p => !done[p.id] && (!ONLY || p.kind === ONLY) && need(p) > 0)
  .sort((a, b) => need(b) + (FUN[b.kind] || 0) + Math.min(b.hot || 0, 20) / 4 - need(a) - (FUN[a.kind] || 0) - Math.min(a.hot || 0, 20) / 4);

const GOOD_FOR = ["photo", "work", "kids", "pets", "date", "group", "view", "nature", "chill", "budget", "night", "food"];
const prompt = list => `ช่วยค้นข้อมูลสถานที่ในประเทศไทยต่อไปนี้ จาก Google Maps, Google Search และเว็บรีวิว (Wongnai, Lemon8, Pantip, บล็อก, เพจร้าน) แล้วสรุปเป็นข้อมูลสำหรับแอพแนะนำที่เที่ยว

กฎสำคัญ:
1. ตรวจให้แน่ใจว่าเป็นสถานที่เดียวกันจริง (ชื่อ + เขต/อำเภอ + จังหวัด + พิกัดใกล้เคียง) ถ้าหาไม่เจอหรือไม่แน่ใจ ให้ "found": false แล้วไม่ต้องใส่ข้อมูลอื่น
2. ห้ามเดา ห้ามแต่งข้อมูล ข้อมูลไหนไม่รู้ให้เป็น null หรือ [] · ถ้าร้านปิดกิจการถาวรแล้ว ให้ "closed": true
3. เขียนสรุปด้วยคำของตัวเอง ห้ามคัดลอกข้อความรีวิวของคนอื่นมาตรงๆ ห้ามใส่ชื่อผู้รีวิว
4. "hours" ต้องเป็นรูปแบบ OpenStreetMap เช่น "Mo-Fr 10:00-20:00; Sa,Su 09:00-21:00" หรือ "Tu-Su 18:00-02:00; Mo off" (ปิดหลังเที่ยงคืนเขียนแบบ 18:00-02:00)
5. "sources" ใส่ลิงก์หน้าเว็บที่ใช้อ้างอิงจริง 1-3 ลิงก์ (ไม่มีลิงก์ = confidence ต้องเป็น "low")
6. ตอบเป็น JSON อย่างเดียว ในบล็อก \`\`\`json ไม่ต้องอธิบายอะไรเพิ่ม · ครบทุกสถานที่ในรายการ ใช้ "id" ตามที่ให้

รูปแบบต่อสถานที่:
{"id": "...", "found": true, "closed": false, "confidence": "high|medium|low",
 "hours": "Mo-Su 10:00-20:00" หรือ null,
 "price": {"min": บาท, "max": บาท} (ราคาอาหาร/เครื่องดื่ม/ค่าเข้าต่อคนโดยประมาณ) หรือ null,
 "summary": {"th": "1 ประโยค ≤ 90 ตัวอักษร ที่นี่เป็นยังไง", "en": "same in English"},
 "highlights": {"th": ["จุดเด่น ≤ 4 ข้อ ข้อละสั้นๆ"], "en": [...]},
 "mustTry": {"th": ["เมนู/กิจกรรมที่คนแนะนำ ≤ 4"], "en": [...]},
 "tips": {"th": ["เคล็ดลับ ≤ 3 เช่น ที่จอดรถ ช่วงเวลาที่ควรไป ต้องจองไหม"], "en": [...]},
 "cons": {"th": ["ข้อควรรู้/ข้อเสียที่รีวิวพูดถึง ≤ 2"], "en": [...]},
 "goodFor": แท็กจาก ${JSON.stringify(GOOD_FOR)} ≤ 4,
 "travel": {"th": "วิธีเดินทาง 1-2 ประโยค เช่น สถานี BTS/MRT ที่ใกล้สุด + เดินกี่นาที, รถเมล์/สองแถว, มีที่จอดรถไหม", "en": "..."},
 "sources": ["https://..."]}

ส่งกลับ: \`\`\`json
{"places": [ ... ]}
\`\`\`

สถานที่ (${list.length} แห่ง):
${list.map(p => `- id: ${p.id} | ${p.name?.th || p.name?.en}${p.name?.en && p.name.en !== p.name.th ? ` (${p.name.en})` : ""} | ${KIND_TH[p.kind] || p.kind} | ${[p.district, provTh(p.province)].filter(Boolean).join(", ")}${p.address ? ` | ที่อยู่: ${p.address}` : ""}${p.lat ? ` | พิกัด ${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}` : ""}`).join("\n")}
`;

const dir = new URL("gemini/prompts/", root);
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
await mkdir(new URL("gemini/answers/", root), { recursive: true });
const answered = new Set((await readdir(new URL("gemini/answers/", root)).catch(() => [])).map(f => f.replace(/\.\w+$/, "")));
let n = 0;
for (let i = 0; i < todo.length; i += SIZE) {
  const name = `batch-${String(++n).padStart(3, "0")}`;
  await writeFile(new URL(name + ".txt", dir), prompt(todo.slice(i, i + SIZE)));
}
console.log(`สถานที่ที่ยังขาดข้อมูล ${todo.length} แห่ง → ${n} ชุด (ชุดละ ${SIZE}) ใน gemini/prompts/`);
console.log(`วิธีใช้: เปิดไฟล์ batch-001.txt คัดลอกทั้งหมดไปถาม Gemini → คัดลอกคำตอบ (JSON) บันทึกเป็น gemini/answers/batch-001.json → ทำชุดต่อไป → node scripts/import-gemini.mjs`);
if (answered.size) console.log(`(มีคำตอบเดิมใน gemini/answers/ ${answered.size} ไฟล์ — รัน import ก่อน แล้วค่อยสร้างชุดใหม่ เลขชุดจะเริ่มใหม่)`);
