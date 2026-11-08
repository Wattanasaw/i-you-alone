// โพสต์เทรนด์ (Lemon8) ที่พูดถึงแต่ละสถานที่ → p.posts (แสดงในหน้ารายละเอียด "กระแสที่พูดถึงที่นี่")
// + เพิ่มคะแนนกระแส (p.hot / p.trend) ให้สถานที่ที่ถูกพูดถึงบ่อย · รัน หลัง scripts/fetch-places.mjs
// คลังโพสต์: หน้า "คาเฟ่/ที่เที่ยว + จังหวัด" ครบ 77 จังหวัด + หัวข้อยอดนิยม (ไม่ต้องค้นทีละสถานที่)
// รูปปกโพสต์เป็นลิงก์พรีวิวของ Lemon8 เอง (มีลายน้ำผู้โพสต์) กดแล้วไปโพสต์ต้นฉบับ — ไม่ดาวน์โหลดเก็บ
// รัน: node scripts/place-posts.mjs
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { postFits, bestOwners, ownsPost } from "./place-quality.mjs";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const DAYS = 180; // โพสต์ช่วง 6 เดือนล่าสุด
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const data = JSON.parse(await readFile(new URL("data/places.json", root), "utf8"));
const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
const PROV = win.PROVINCES.map(p => p.th.replace(/^กรุงเทพมหานคร$/, "กรุงเทพ"));
const TOPICS = ["คาเฟ่เปิดใหม่", "คาเฟ่ลับ", "คาเฟ่สวย", "คาเฟ่มินิมอล", "คาเฟ่ริมทะเล", "คาเฟ่ริมน้ำ", "คาเฟ่ในสวน", "คาเฟ่วิวภูเขา", "คาเฟ่แมว", "คาเฟ่หมา", "คาเฟ่สัตว์",
  "ร้านอาหาร", "สวนสนุก", "สวนน้ำ", "สวนสัตว์", "ฟาร์มสัตว์", "พิพิธภัณฑ์", "นิทรรศการ", "อุทยานแห่งชาติ", "น้ำตก", "ทะเล", "จุดชมวิว", "วัดสวย", "ตลาดน้ำ", "กางเต็นท์",
  // คาเฟ่สัตว์แบบเจาะจง (ร้านเล็กๆ มักอยู่ในเนื้อโพสต์ ไม่อยู่ในหัวเรื่อง → ใช้หมุดสถานที่ใน trend-places.mjs)
  "คาเฟ่ซามอย", "คาเฟ่หมาใหญ่", "คาเฟ่สุนัข", "คาเฟ่น้องหมา", "คาเฟ่ชิบะ", "คาเฟ่คอร์กี้", "คาเฟ่โกลเด้น", "คาเฟ่ปอมเมอเรเนียน", "คาเฟ่ไซบีเรียน",
  "คาเฟ่น้องแมว", "คาเฟ่แมวเปอร์เซีย", "คาเฟ่คาปิบาร่า", "คาเฟ่นกฮูก", "คาเฟ่กระต่าย", "คาเฟ่เม่นแคระ", "คาเฟ่แรคคูน", "คาเฟ่อัลปาก้า", "คาเฟ่แกะ",
  "คาเฟ่ม้า", "คาเฟ่นาก", "คาเฟ่สัตว์เลี้ยง", "คาเฟ่ pet friendly", "dog cafe", "cat cafe", "คาเฟ่เล่นกับหมา", "คาเฟ่หมา กรุงเทพ", "คาเฟ่แมว กรุงเทพ",
  // คาเฟ่/ร้านแนวที่วัยรุ่นตามหา
  "คาเฟ่ถ่ายรูป", "คาเฟ่นั่งทำงาน", "คาเฟ่ใกล้bts", "คาเฟ่ใกล้mrt", "คาเฟ่เปิดดึก", "คาเฟ่มัทฉะ", "คาเฟ่ญี่ปุ่น", "คาเฟ่เกาหลี", "คาเฟ่ดอกไม้",
  "คาเฟ่ทุ่งหญ้า", "คาเฟ่ในป่า", "คาเฟ่วิวนา", "คาเฟ่บ้านไม้", "คาเฟ่ลอยน้ำ", "คาเฟ่ขนมอร่อย", "คาเฟ่ครัวซองต์", "คาเฟ่ wellness", "คาเฟ่ฮีลใจ",
  "ร้านอาหารวิวสวย", "ร้านอาหารริมน้ำ", "ร้านอาหารบรรยากาศดี", "ร้านอาหารเปิดใหม่", "หมูกระทะ", "บุฟเฟ่ต์", "ร้านเด็ด", "ร้านลับ",
  // ผับ/บาร์/ที่เที่ยวกลางคืน
  "บาร์ลับ", "บาร์", "ผับ", "ร้านเหล้า", "ร้านนั่งดื่ม", "รูฟท็อปบาร์", "rooftop bar", "บาร์ค็อกเทล", "cocktail bar", "speakeasy bar", "คราฟต์เบียร์", "ร้านเหล้าดนตรีสด",
  "ร้านนั่งชิลกลางคืน", "ที่เที่ยวกลางคืน", "ผับเปิดใหม่", "บาร์เปิดใหม่", "jazz bar", "บาร์วิวสวย", "ร้านเหล้าริมน้ำ", "ไนท์คลับ",
  "ที่เที่ยวเปิดใหม่", "ที่เที่ยวใกล้กรุงเทพ", "ที่เที่ยวถ่ายรูป", "ฟาร์มแกะ", "สวนดอกไม้", "ทุ่งดอกไม้", "ล่องเรือ", "สวนสัตว์เปิด"];
// คาเฟ่สัตว์ในเมืองท่องเที่ยวหลัก
const ANIMAL_CITIES = ["เชียงใหม่", "เชียงราย", "ชลบุรี", "พัทยา", "ระยอง", "นครราชสีมา", "เขาใหญ่", "หัวหิน", "ขอนแก่น", "ภูเก็ต", "นนทบุรี", "ปทุมธานี", "นครปฐม", "อยุธยา", "กาญจนบุรี", "สมุทรปราการ"];
// ข่าวร้าย/ดราม่าไม่ใช่ "กระแสเที่ยว"
const NOT_TREND = /เสียชีวิต|อุบัติเหตุ|ไฟไหม้|น้ำท่วม|จับกุม|ดราม่า|ร้องเรียน|ปิดถาวร|ปิดกิจการ/;

const posts = new Map();
// ค้นตาม "ย่าน": เขต/อำเภอ + ถนน/ซอยในที่อยู่ ของคาเฟ่/ร้านอาหาร
// (ร้านเล็กๆ ไม่มีหน้าค้นด้วยชื่อร้านใน Lemon8 แต่โผล่ในหน้า "คาเฟ่ + ย่าน" เช่น Jaree Cafe อยู่ใน "คาเฟ่ลาซาล")
const districtCache = JSON.parse(await readFile(new URL("data/place-districts.json", root), "utf8").catch(() => "{}"));
const districtOf = p => p.district || (Number.isFinite(+p.lat) ? districtCache[`${(+p.lat).toFixed(3)},${(+p.lng).toFixed(3)}`] : null);
const BIG_ROADS = /^(สุขุมวิท|พหลโยธิน|เพชรเกษม|มิตรภาพ|สายเอเชีย|พระราม)/;
const streetOf = p => [...String(p.address || "").matchAll(/(?:ซอย|ซ\.|ถนน|ถ\.)\s*([ก-๙a-zA-Z]{3,20})/g)].map(m => m[1]).filter(x => !BIG_ROADS.test(x));
const AREA_KINDS = { cafe: "คาเฟ่", animalcafe: "คาเฟ่", restaurant: "ร้านอาหาร", nightlife: "บาร์" };
const areaKws = [...new Set(data.places.filter(p => AREA_KINDS[p.kind]).flatMap(p => [districtOf(p) && `${AREA_KINDS[p.kind]}${districtOf(p)}`, ...streetOf(p).map(st => `${AREA_KINDS[p.kind]}${st}`)]).filter(Boolean))];
const kws = [...new Set([...TOPICS, ...ANIMAL_CITIES.flatMap(c => [`คาเฟ่หมา${c}`, `คาเฟ่แมว${c}`]), ...PROV.flatMap(p => [`คาเฟ่${p}`, `ที่เที่ยว${p}`, `ร้านอาหาร${p}`, `บาร์${p}`]), ...areaKws])];
// คำค้นที่ Lemon8 แนะนำในหน้าโพสต์ (เก็บโดย trend-places.mjs เช่น "คาเฟ่ซามอยด์ กรุงเทพ") — ขยายวงทุกวัน
// 0 = ยังไม่เปิด · -1 = ไม่มีหน้า (ไม่เปิดซ้ำ) · วันที่ = เปิดล่าสุด (เปิดซ้ำทุก 14 วัน)
const extract = JSON.parse(await readFile(new URL("data/trend-extract.json", root), "utf8").catch(() => "{}"));
extract.kws ||= {};
const today = new Date().toISOString().slice(0, 10);
const base = new Set(kws);
const kwNew = Object.keys(extract.kws).filter(k => extract.kws[k] === 0 && !base.has(k)).slice(0, 120);
const kwOld = Object.keys(extract.kws).filter(k => typeof extract.kws[k] === "string" && !base.has(k) && (Date.now() - new Date(extract.kws[k])) / 864e5 > 14).slice(0, 40);
kws.push(...kwNew, ...kwOld);
console.log(`หน้าค้นหา ${kws.length} (ย่าน/ถนน ${areaKws.length} · คำค้นแนะนำใหม่ ${kwNew.length} · เปิดซ้ำ ${kwOld.length})`);
// หน้า /experience/ มีเฉพาะคำค้นยอดนิยม: คำที่ไม่มีหน้า (404) ข้าม 30 วัน
// และหยุดเมื่อใช้เวลาเกิน 25 นาที (ที่เหลือรอบหน้า) — เดิมเปิดทุกคำทุกวัน รายการโตขึ้นจนใช้เวลาเกือบชั่วโมง
extract.seen ||= {};
const T0 = Date.now(), DAILY = new Set(TOPICS);
const ageDays = d => (Date.now() - new Date(d)) / 864e5;
// หน้าที่มีอยู่ต้องเปิดทุกรอบ (โพสต์ที่ได้ไม่ได้เก็บข้ามรอบ ถ้าข้ามสถานที่จะเสียโพสต์ที่จับคู่ไว้)
const skipKw = kw => { const s = extract.seen[kw]; if (!s || DAILY.has(kw) || s.ok) return false; return ageDays(s.at) < 30; };
const todoKws = kws.filter(kw => !skipKw(kw));
console.log(`เปิดรอบนี้ ${todoKws.length} หน้า (ข้ามหน้าที่เพิ่งเปิด/ไม่มีหน้า ${kws.length - todoKws.length})`);
let opened = 0;
for (const kw of todoKws) {
  if (Date.now() - T0 > 25 * 60000) { console.warn(`ใช้เวลาเกิน 25 นาที เปิดไป ${opened} หน้า ที่เหลือรอบหน้า`); break; }
  opened++;
  await sleep(1500);
  try {
    const res = await fetch(`https://www.lemon8-app.com/experience/${encodeURIComponent(kw)}?region=th`, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) });
    if (kw in extract.kws) extract.kws[kw] = res.status === 404 ? -1 : today;
    extract.seen[kw] = { at: today, ok: res.ok };
    const html = await res.text();
    const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if (o.groupId && typeof o.title === "string" && !posts.has(o.groupId)) posts.set(o.groupId, o);
      for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
    })(JSON.parse(decodeURIComponent(big)));
  } catch {}
}
const list = [...posts.values()].map(o => {
  const author = [o, ...Object.values(o)].find(v => v && typeof v === "object" && v.linkName) || {};
  const date = new Date(Number(BigInt(o.groupId) >> 32n) * 1000);
  return {
    title: o.title.replace(/\s+/g, " ").trim().slice(0, 140), likes: +o.articleLikes || 0, date: date.toISOString().slice(0, 10),
    link: `https://www.lemon8-app.com/${author.linkName ? "@" + author.linkName + "/" : ""}${o.groupId}?region=th`,
    source: `Lemon8${author.nickName ? " · " + author.nickName : ""}`,
    image: [o.largeImage?.url, o.imageList?.[0]?.url].find(u => /^https:\/\/www\.lemon8-app\.com\/seo\/image\?/.test(u || "")),
    // เนื้อโพสต์ย่อ (ใช้ใน trend-places.mjs ให้ AI หาชื่อร้าน/สถานที่ — ไม่บันทึกลงข้อมูลที่ขึ้นเว็บ)
    text: `${String(o.shortContent || "").slice(0, 300)} ${[].concat(o.ocrTextArr || []).join(" ").slice(0, 150)}`.replace(/\s+/g, " ").trim(),
    body: `${o.title} ${o.shortContent || ""} ${[].concat(o.ocrTextArr || []).join(" ")}`.replace(/\s+/g, " ").toLowerCase()
  };
}).filter(p => p.title.length >= 8 && !NOT_TREND.test(p.title) && (Date.now() - new Date(p.date)) / 864e5 <= DAYS);
console.log(`คลังโพสต์ ${list.length} โพสต์ (ช่วง ${DAYS} วัน) จาก ${kws.length} หน้า`);

// จับคู่: ชื่อสถานที่ (ยาว ≥ 6 ตัวอักษร กันคำทั่วไป) อยู่ในหัวโพสต์
const GENERIC = /^(อุทยานแห่งชาติ|สวนสัตว์เปิด|สวนสัตว์|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|สวนน้ำ|สวนสนุก|หอศิลป์|คาเฟ่|ร้าน|วัด|น้ำตก)\s*/;
// ตัดคำนำหน้าแล้วเหลือแค่ชื่อจังหวัด (เช่น "สวนสัตว์เชียงใหม่" → "เชียงใหม่") ไม่ใช้ — จะจับโพสต์ทุกโพสต์ในจังหวัดผิดๆ
const PROV_NAMES = new Set(win.PROVINCES.flatMap(p => [p.th, p.en, p.th.replace(/^จังหวัด/, "")]).filter(Boolean).map(s => s.toLowerCase()).concat(["กรุงเทพ", "bangkok"]));
const names = p => [...new Set([p.name?.th, p.name?.en, p.name?.th?.replace(GENERIC, "")].filter(n => n && n.length >= 6).map(n => n.toLowerCase().trim()))].filter(n => !PROV_NAMES.has(n));
let matched = 0, newHot = 0;
const usedLinks = new Set();
const slim = ({ text, body, ...x }) => x;
// ชื่อเต็มของร้าน (≥ 5 ตัวอักษร) อยู่ในเนื้อโพสต์/ข้อความบนรูป = รีวิวร้านนี้ (tag = เชื่อได้แม้หัวโพสต์ไม่มีชื่อ)
const fullNames = p => [...new Set([p.name?.th, p.name?.en].filter(n => n && n.trim().length >= 5).map(n => n.toLowerCase().trim()))]
  .filter(n => !PROV_NAMES.has(n) && !/^(คาเฟ่|ร้านกาแฟ|ร้านอาหาร|coffee shop|cafe|café|coffee)$/.test(n));
// โพสต์ที่ตรงกับหลายสถานที่ → ให้สถานที่ที่ชื่อตรงยาวที่สุด (เจาะจงที่สุด) เท่านั้น
const BEST = bestOwners(list, data.places, names);
for (const p of data.places) {
  const ns = names(p), fns = fullNames(p);
  // โพสต์เก่าที่ไม่ใช่เรื่องของที่นี่ (เช่น รีวิวบาร์ในย่าน) → ตัดออก
  if (p.posts?.length) { p.posts = p.posts.filter(x => postFits(x, p) && ownsPost(x, ns, BEST)); if (!p.posts.length) delete p.posts; }
  if (!ns.length && !fns.length) continue;
  const inTitle = list.filter(x => ns.some(n => x.title.toLowerCase().includes(n)) && postFits(x, p) && ownsPost(x, ns, BEST));
  // ชื่อในเนื้อหาเท่านั้น: เฉพาะร้าน (ชื่อเฉพาะ) — ที่เที่ยวธรรมชาติ/ย่านถูกพูดถึงในเนื้อหาโพสต์อื่นเยอะ ("…ใกล้หาดบางแสน")
  const inBody = ["cafe", "animalcafe", "restaurant", "nightlife"].includes(p.kind) ? list.filter(x => !inTitle.includes(x) && fns.some(n => x.body.includes(n)) && postFits(x, p) && ownsPost(x, ns, BEST)).map(x => ({ ...x, tag: 1 })) : [];
  const m = [...inTitle, ...inBody];
  if (!m.length) continue;
  matched++;
  m.forEach(x => usedLinks.add(x.link));
  p.posts = [...new Map([...m.map(slim), ...(p.posts || [])].map(x => [x.link, x])).values()].sort((a, b) => b.likes - a.likes).slice(0, 6);
  // ถูกพูดถึงบ่อย/ไลก์เยอะ = กระแส (เพิ่มจากคะแนนเดิม ไม่ลด)
  const score = +m.reduce((s, x) => s + 1 + Math.log10(1 + x.likes), 0).toFixed(1);
  if (score >= 3 && score > (p.hot || 0)) { if (!p.hot) newHot++; p.hot = score; p.trend = Math.max(p.trend || 0, m.length); }
}
await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
await save("data/trend-extract.json", JSON.stringify(extract) + "\n");
// โพสต์ยอดนิยมที่ยังจับคู่กับสถานที่ไม่ได้ → ส่งต่อให้ trend-places.mjs (AI หาชื่อสถานที่ + หาพิกัดบนแผนที่) · ไฟล์ชั่วคราว ไม่ขึ้นเว็บ
await mkdir(new URL(".cache/", root), { recursive: true });
await writeFile(new URL(".cache/l8-pool.json", root), JSON.stringify(list.filter(x => !usedLinks.has(x.link) && x.likes >= 5).sort((a, b) => b.likes - a.likes).map(({ body, ...x }) => x)));
console.log(`สถานที่ที่มีโพสต์พูดถึง ${matched} แห่ง · กระแสใหม่ ${newHot} แห่ง · กระแสรวม ${data.places.filter(p => p.hot).length} แห่ง`);
