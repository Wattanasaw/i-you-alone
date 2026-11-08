// รีวิวจาก Lemon8 ของแต่ละสถานที่ (ค้นด้วยชื่อสถานที่ตรงๆ) — ได้ ~60 โพสต์ต่อหน้า กรองเฉพาะโพสต์ที่พูดถึงที่นี่จริง
// เก็บสูงสุด 24 โพสต์/แห่ง ใน data/place-posts/NN.json (แบ่ง 32 ไฟล์ แอพโหลดเฉพาะไฟล์ของสถานที่ที่เปิดดู ไม่ทำให้หน้าแรกช้า)
// และใส่ 6 โพสต์ยอดนิยมใน places.json / trend-places.json (ใช้บนการ์ด, คะแนนกระแส, AI สรุปรีวิว)
// หมุนเวียน: สถานที่ที่ยังไม่มีโพสต์ก่อน · อ่านซ้ำทุก 14 วัน · หยุดเมื่อครบเวลา (ที่เหลือรอบหน้า)
// รัน หลัง scripts/trend-places.mjs · node scripts/place-lemon8.mjs [--minutes 20]
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { postFits, bestOwners, ownsPost } from "./place-quality.mjs";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const MINUTES = arg("--minutes", 25), KEEP = 24, TOP = 6, REFRESH = 14, SHARDS = 32, DAYS = 365;
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
// แบ่งไฟล์ด้วย FNV-1a (แอพคำนวณแบบเดียวกันใน js/app.js → placeShard)
const shardOf = id => { let h = 0x811c9dc5; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h % SHARDS; };
const shardFile = n => `data/place-posts/${String(n).padStart(2, "0")}.json`;

const placesData = await readJSON("data/places.json", null);
const trend = await readJSON("data/trend-places.json", []);
if (!placesData?.places) { console.error("อ่าน data/places.json ไม่ได้"); process.exit(1); }
const all = [...placesData.places, ...trend];
await mkdir(new URL("data/place-posts/", root), { recursive: true });
const shards = await Promise.all([...Array(SHARDS)].map((_, i) => readJSON(shardFile(i), {})));
const entry = id => shards[shardOf(id)][id];
const today = new Date().toISOString().slice(0, 10);
const days = d => (Date.now() - new Date(d)) / 864e5;

// ชื่อที่ใช้ค้นและใช้ตรวจว่าโพสต์พูดถึงที่นี่จริง
const GENERIC = /^(อุทยานแห่งชาติ|สวนสัตว์เปิด|สวนสัตว์|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|สวนน้ำ|สวนสนุก|หอศิลป์|คาเฟ่|ร้าน|วัด|น้ำตก|หาด|ชายหาด)\s*/;
const nameOf = p => typeof p.name === "string" ? { th: p.name } : (p.name || {});
const names = p => { const n = nameOf(p); return [...new Set([n.th, n.en, n.th?.replace(GENERIC, "")].filter(s => s && s.trim().length >= 4).map(s => s.toLowerCase().trim()))]; };
// คำค้น: ชื่อไทย → ชื่ออังกฤษ → ชื่อไทยตัดคำนำหน้า (ชื่อทางการยาวๆ อย่าง "วัดพระศรีรัตนศาสดาราม" คนไม่ค่อยใช้ค้น)
const queries = p => { const n = nameOf(p); return [...new Set([n.th, n.en, n.th?.replace(GENERIC, "")].filter(s => s && s.trim().length >= 4).map(s => s.trim()))]; };
const query = p => queries(p)[0] || "";
const NOT_TREND = /เสียชีวิต|อุบัติเหตุ|ไฟไหม้|น้ำท่วม|จับกุม|ดราม่า|ร้องเรียน|ปิดถาวร|ปิดกิจการ/;

async function search(q) {
  const res = await fetch(`https://www.lemon8-app.com/experience/${encodeURIComponent(q)}?region=th`, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return { status: res.status, posts: [] };
  const html = await res.text();
  const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
  const found = new Map();
  try {
    (function walk(o) {
      if (!o || typeof o !== "object") return;
      if (o.groupId && typeof o.title === "string" && !found.has(o.groupId)) found.set(o.groupId, o);
      for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
    })(JSON.parse(decodeURIComponent(big)));
  } catch {}
  const posts = [...found.values()].map(o => {
    const author = [o, ...Object.values(o)].find(v => v && typeof v === "object" && v.linkName) || {};
    return {
      // โพสต์ไม่มีหัวข้อ → ใช้บรรทัดแรกของเนื้อหาแทน
      title: (o.title.trim() || String(o.shortContent || "").split("\n")[0]).replace(/\s+/g, " ").trim().slice(0, 140), likes: +o.articleLikes || 0,
      date: new Date(Number(BigInt(o.groupId) >> 32n) * 1000).toISOString().slice(0, 10),
      link: `https://www.lemon8-app.com/${author.linkName ? "@" + author.linkName + "/" : ""}${o.groupId}?region=th`,
      source: `Lemon8${author.nickName ? " · " + author.nickName : ""}`,
      image: [o.largeImage?.url, o.imageList?.[0]?.url].find(u => /^https:\/\/www\.lemon8-app\.com\/seo\/image\?/.test(u || "")),
      body: `${o.title} ${o.shortContent || ""} ${[].concat(o.ocrTextArr || []).join(" ")}`.replace(/\s+/g, " ").toLowerCase()
    };
  });
  return { status: 200, posts };
}

// คิว: ไม่เคยค้น/ครบรอบอ่านซ้ำ · ที่ยังไม่มีโพสต์เลยก่อน แล้วที่ดัง/มีกระแส
const due = all.filter(p => query(p) && names(p).length && !(entry(p.id) && days(entry(p.id).at) < REFRESH))
  .sort((a, b) => ((a.posts?.length ? 1 : 0) - (b.posts?.length ? 1 : 0)) || ((b.hot || 0) + (b.fame || 0) + (b.views || 0) / 50) - ((a.hot || 0) + (a.fame || 0) + (a.views || 0) / 50));
console.log(`สถานที่ ${all.length} · มีรีวิว Lemon8 ในคลังแล้ว ${all.filter(p => entry(p.id)?.posts?.length).length} · รอค้น ${due.length}`);

const T0 = Date.now();
let searched = 0, gained = 0, fails = 0;
for (const p of due) {
  if (Date.now() - T0 > MINUTES * 60000) { console.log(`ครบ ${MINUTES} นาที ที่เหลือรอบหน้า`); break; }
  if (fails >= 8) { console.warn("Lemon8 ไม่ตอบติดกันหลายครั้ง หยุดรอบนี้"); break; }
  await sleep(1200);
  const ns = names(p);
  // โพสต์ที่พูดถึงที่นี่จริง: ชื่อในหัวข้อ หรือชื่อเต็ม (≥ 6 ตัวอักษร) ในเนื้อหา/ข้อความบนรูป
  // + ที่เที่ยวธรรมชาติ/สถานที่สำคัญ: ไม่รับรีวิวร้าน/ที่พัก และชื่อต้องอยู่ในหัวโพสต์ (ชื่อในเนื้อหามักเป็น "ร้าน X ใกล้หาด Y")
  const venue = ["cafe", "animalcafe", "restaurant", "nightlife"].includes(p.kind);
  const relevant = list => list.filter(x => x.title.length >= 4 && days(x.date) <= DAYS && !NOT_TREND.test(x.title) && postFits(x, p)
    && (ns.some(n => x.title.toLowerCase().includes(n)) || (venue && ns.some(n => n.length >= 6 && x.body.includes(n)))));
  // ลองทีละชื่อ จนได้โพสต์พอ (ชื่อทางการมักไม่มีคนค้น แต่ชื่ออังกฤษ/ชื่อย่อมี)
  let rel = [], ok = false;
  for (const q of queries(p)) {
    let r;
    try { r = await search(q); fails = 0; ok = true; } catch { fails++; break; }
    rel = [...new Map([...rel, ...relevant(r.posts)].map(x => [x.link, x])).values()];
    if (rel.length >= 8) break;
    await sleep(1200);
  }
  if (!ok) continue;
  searched++;
  const old = entry(p.id)?.posts || [];
  const posts = [...new Map([...rel.map(({ body, ...x }) => x), ...old].map(x => [x.link, x])).values()]
    .sort((a, b) => b.likes - a.likes).slice(0, KEEP);
  shards[shardOf(p.id)][p.id] = { at: today, posts };
  if (posts.length > old.length) gained++;
}

// โพสต์เดียวกันอยู่หลายสถานที่ → ให้ที่ชื่อตรงยาวที่สุด · ตัดโพสต์ที่ไม่ใช่เรื่องของที่นี่ (ทั้งของเก่าในคลัง)
const allPosts = [...new Map(shards.flatMap(s => Object.values(s).flatMap(e => e.posts || [])).map(x => [x.link, x])).values()];
const BEST = bestOwners(allPosts, all, names);
let removed = 0;
for (const p of all) {
  const e = entry(p.id); if (!e?.posts?.length) continue;
  const ns = names(p), before = e.posts.length;
  e.posts = e.posts.filter(x => postFits(x, p) && ownsPost(x, ns, BEST));
  removed += before - e.posts.length;
  if (p.posts?.length) { p.posts = p.posts.filter(x => postFits(x, p) && ownsPost(x, ns, BEST)); if (!p.posts.length) delete p.posts; }
}
console.log(`ตัดโพสต์ที่ไม่ใช่เรื่องของสถานที่นั้น ${removed} โพสต์`);
// 6 โพสต์ยอดนิยมเข้า places.json (รวมกับที่มีอยู่) · ลบรายการของสถานที่ที่ไม่มีแล้ว
const live = new Set(all.map(p => p.id));
let withPosts = 0;
for (const p of all) {
  const e = entry(p.id);
  if (!e?.posts?.length) continue;
  p.posts = [...new Map([...(p.posts || []), ...e.posts.map(x => ({ ...x, tag: 1 }))].map(x => [x.link, x])).values()]
    .sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, TOP);
  p.reviewCount = e.posts.length;
  withPosts++;
}
for (const s of shards) for (const id of Object.keys(s)) if (!live.has(id)) delete s[id];
await Promise.all(shards.map((s, i) => save(shardFile(i), JSON.stringify(s) + "\n")));
await save("data/places.json", JSON.stringify(placesData, null, 1) + "\n");
await save("data/trend-places.json", JSON.stringify(trend, null, 1) + "\n");
console.log(`ค้นรอบนี้ ${searched} แห่ง (ได้โพสต์เพิ่ม ${gained}) · สถานที่ที่มีรีวิว Lemon8 ${withPosts}/${all.length} · ${((Date.now() - T0) / 60000).toFixed(1)} นาที`);
