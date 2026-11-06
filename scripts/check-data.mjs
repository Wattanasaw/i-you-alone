// ตรวจความถูกต้องของไฟล์ข้อมูลก่อนเผยแพร่  รัน: node scripts/check-data.mjs
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const errors = [], warns = [];
const load = async p => {
  try { return JSON.parse(await readFile(new URL(p, root), "utf8")); }
  catch (e) { errors.push(`${p}: อ่าน JSON ไม่ได้ — ${e.message}`); return null; }
};

const configSrc = await readFile(new URL("js/config.js", root), "utf8");
const window = {};
new Function("window", configSrc)(window);
const C = window.APP_CONFIG;
const catIds = new Set(C.categories.map(c => c.id));
new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(window);
const provIds = new Set(window.PROVINCES.map(p => p.id));
if (provIds.size !== 77) errors.push(`js/i18n.js: รายชื่อจังหวัดควรมี 77 จังหวัด แต่มี ${provIds.size}`);
for (const l of C.languages) if (!window.I18N[l]) errors.push(`js/i18n.js: ไม่มีพจนานุกรมภาษา "${l}"`);
const thKeys = Object.keys(window.I18N.th);
for (const l of C.languages) for (const k of thKeys) if (window.I18N[l]?.[k] == null) errors.push(`js/i18n.js: ภาษา ${l} ขาดคำว่า "${k}"`);
const checkProvince = (where, v) => {
  if (v.online) return;
  if (!v.province) errors.push(`${where}: ไม่มีจังหวัด (province) — งานจะไม่ขึ้นเมื่อเลือกจังหวัด`);
  else if (!provIds.has(v.province)) errors.push(`${where}: ไม่รู้จักจังหวัด "${v.province}" (ดูรหัสใน js/i18n.js)`);
};
const checkTransitI18n = (where, v) => {
  for (const [l, x] of Object.entries(v.i18n || {}))
    if (x.transit && x.transit.length !== (v.transit || []).length) errors.push(`${where}: คำแปล transit (${l}) มี ${x.transit.length} ข้อ แต่ต้นฉบับมี ${(v.transit || []).length} ข้อ`);
};
const untranslated = { en: 0, zh: 0 };

const [events, venues, ads, news] = await Promise.all(
  ["data/events.json", "data/venues.json", "data/ads.json", "data/news.json"].map(load)
);

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00"));
const isUrl = s => /^https?:\/\/\S+$/.test(s);

const venueIds = new Set();
for (const v of venues || []) {
  const where = `venue "${v.id}"`;
  if (!v.id || !v.name) errors.push(`${where}: ต้องมี id และ name`);
  if (venueIds.has(v.id)) errors.push(`${where}: id ซ้ำ`);
  venueIds.add(v.id);
  checkProvince(where, v);
  checkTransitI18n(where, v);
  if (v.online) continue;
  if (typeof v.lat !== "number" || typeof v.lng !== "number") warns.push(`${where}: ไม่มีพิกัด lat/lng — ปุ่มนำทางจะค้นจากชื่อแทน`);
  else if (v.lat < 5 || v.lat > 21 || v.lng < 97 || v.lng > 106) errors.push(`${where}: พิกัดอยู่นอกประเทศไทย (${v.lat}, ${v.lng})`);
  for (const t of v.transit || []) if (!t.type || !t.text) errors.push(`${where}: ข้อมูล transit ต้องมี type และ text`);
}

const ids = new Set();
for (const ev of events || []) {
  const where = `event "${ev.id || ev.title}"`;
  if (!ev.id || !/^[a-z0-9-]+$/i.test(ev.id)) errors.push(`${where}: id ต้องเป็นภาษาอังกฤษ ตัวเลข หรือ - เท่านั้น`);
  if (ids.has(ev.id)) errors.push(`${where}: id ซ้ำ`);
  ids.add(ev.id);
  if (!ev.title) errors.push(`${where}: ไม่มีชื่องาน`);
  if (!catIds.has(ev.category)) errors.push(`${where}: หมวด "${ev.category}" ไม่มีใน config.js`);
  if (!isDate(ev.startDate)) errors.push(`${where}: startDate ต้องเป็นรูปแบบ YYYY-MM-DD`);
  if (ev.endDate && !isDate(ev.endDate)) errors.push(`${where}: endDate ต้องเป็นรูปแบบ YYYY-MM-DD`);
  if (ev.endDate && ev.endDate < ev.startDate) errors.push(`${where}: วันสิ้นสุดอยู่ก่อนวันเริ่ม`);
  if (!ev.venueId && !ev.venue) errors.push(`${where}: ต้องมี venueId หรือ venue`);
  if (ev.venueId && !venueIds.has(ev.venueId)) errors.push(`${where}: ไม่พบสถานที่ "${ev.venueId}" ใน venues.json`);
  for (const l of ["en", "zh"]) if (!ev.i18n?.[l]?.title) untranslated[l]++;
  if (!ev.venueId && ev.venue) {
    if (!ev.venue.name) errors.push(`${where}: venue ในงานต้องมี name`);
    checkProvince(where, ev.venue);
    checkTransitI18n(where, ev.venue);
    if (typeof ev.venue.lat === "number" && (ev.venue.lat < 5 || ev.venue.lat > 21 || ev.venue.lng < 97 || ev.venue.lng > 106)) errors.push(`${where}: พิกัดอยู่นอกประเทศไทย`);
  }
  if (ev.registerBy && !isDate(ev.registerBy)) errors.push(`${where}: registerBy ต้องเป็นรูปแบบ YYYY-MM-DD`);
  else if (ev.registerBy && !ev.ongoing && ev.registerBy > (ev.endDate || ev.startDate)) errors.push(`${where}: วันปิดรับสมัครอยู่หลังวันจัดงาน`);
  if (ev.weekdays && !(Array.isArray(ev.weekdays) && ev.weekdays.every(d => Number.isInteger(d) && d >= 0 && d <= 6))) errors.push(`${where}: weekdays ต้องเป็นตัวเลข 0–6 (0 = อาทิตย์)`);
  if (ev.races && !(Array.isArray(ev.races) && ev.races.every(r => typeof r === "string"))) errors.push(`${where}: races ต้องเป็นรายการข้อความ เช่น ["5K", "10K"]`);
  for (const [l, x] of Object.entries(ev.i18n || {})) if (x.races && x.races.length !== (ev.races || []).length) errors.push(`${where}: คำแปล races (${l}) จำนวนไม่ตรงกับต้นฉบับ`);
  if (ev.ongoing && ev.endDate) warns.push(`${where}: เป็นร้านเปิดประจำ (ongoing) แต่มี endDate — endDate จะถูกละไว้`);
  if (!["free", "paid", "mixed"].includes(ev.price?.type)) errors.push(`${where}: price.type ต้องเป็น free / paid / mixed`);
  if (ev.price?.min && ev.price?.max && ev.price.min > ev.price.max) errors.push(`${where}: ราคาต่ำสุดมากกว่าราคาสูงสุด`);
  for (const k of ["ticketUrl", "image", "sourceUrl"]) if (ev[k] && !isUrl(ev[k])) errors.push(`${where}: ${k} ไม่ใช่ลิงก์ http(s)`);
  for (const a of ev.affiliateLinks || []) {
    if (!a.label || !isUrl(a.url)) errors.push(`${where}: ลิงก์ Affiliate ต้องมี label และ url แบบ http(s)`);
    if (/example\.com/.test(a.url)) warns.push(`${where}: ลิงก์ Affiliate ยังเป็นลิงก์ตัวอย่าง (example.com)`);
  }
  if (/example\.com/.test(ev.ticketUrl || "")) warns.push(`${where}: ticketUrl ยังเป็นลิงก์ตัวอย่าง`);
  if (!ev.summary) warns.push(`${where}: ไม่มีสรุปสั้น (summary)`);
}
const samples = (events || []).filter(e => e.sample).length;
if (samples) warns.push(`ยังมีข้อมูลตัวอย่าง ${samples} งาน (sample: true) — ลบออกก่อนเปิดใช้จริง`);

for (const a of ads || []) {
  if (!a.title) errors.push(`ad "${a.id}": ต้องมี title`);
  if (a.url && !isUrl(a.url) && !a.url.startsWith("#/")) errors.push(`ad "${a.id}": url ไม่ถูกต้อง`);
}
if (news && !Array.isArray(news.items)) errors.push("news.json: ต้องมี items เป็น array");

console.log(`ตรวจแล้ว: งาน ${events?.length ?? 0} · สถานที่ ${venues?.length ?? 0} · โฆษณา ${ads?.length ?? 0} · ข่าว ${news?.items?.length ?? 0}`);
console.log(`คำแปล: งานที่ยังไม่มีชื่อภาษาอังกฤษ ${untranslated.en} · ภาษาจีน ${untranslated.zh} (จะแสดงภาษาไทยแทน)`);
warns.forEach(w => console.log("⚠️ ", w));
errors.forEach(e => console.log("❌", e));
console.log(errors.length ? `\nพบข้อผิดพลาด ${errors.length} จุด` : "\n✅ ไม่พบข้อผิดพลาด");
process.exit(errors.length ? 1 : 0);
