// รูปปกที่เที่ยว: หารูปจริงที่ "น่ากดเข้าไปดู" ให้ทุกสถานที่ (รัน หลัง scripts/fetch-places.mjs)
// 1) หาผู้สมัคร: รูปเดิม (Wikidata/OSM) + รูปใน Wikimedia Commons ที่ถ่ายใกล้พิกัด + ค้นด้วยชื่อสถานที่
// 2) คัดด้วยกฎ: ตัดแผนที่/โลโก้/ป้าย/สแกนเอกสาร/รูปเล็ก/สัดส่วนแปลก, ให้คะแนนชื่อตรง ระยะใกล้ รูปคุณภาพของ Commons
// 3) ให้ AI ดูรูปจริง (Gemini หรือ GitHub Models): รูปนี้คือสถานที่นี้/ประเภทนี้จริงไหม + ความน่าดู 1–10 → เลือกรูปที่ดีที่สุด
//    ไม่มี AI = ใช้เฉพาะรูปที่กฎมั่นใจมาก (ชื่อตรง/รูปทางการของ Wikidata) ที่เหลือแอพแสดงปกสีประจำหมวด
// ผลจำไว้ใน data/place-images.json (ไม่ถามซ้ำ ประหยัดโควต้า) · รูปทั้งหมดมีสัญญาอนุญาตเสรี พร้อมเครดิตผู้ถ่าย
// รัน: node scripts/place-images.mjs [--limit 300] [--recheck]
import { readFile, writeFile, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const LIMIT = arg("--limit", 260);       // สถานที่ที่หารูปต่อรอบ (เรียก Commons ~2 ครั้ง/แห่ง)
const AI_MAX = arg("--ai", 45);          // คำขอ AI สูงสุดต่อรอบ (อยู่ในโควต้าฟรีรายวัน)
const PER_ASK = 4;                       // สถานที่ต่อคำขอ AI
const RECHECK = process.argv.includes("--recheck");
const RETRY_DAYS = 30;
const SOURCES_VERSION = 3;               // 2 = โพสต์ Lemon8 + เว็บไซต์ร้าน · 3 = คลัง Lemon8 รายจังหวัด + Openverse                   // ที่ที่ยังไม่มีรูปดี ลองหาใหม่ทุก 30 วัน (มีคนอัปรูปใหม่)
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const stripHtml = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const data = await readJSON("data/places.json", null);
if (!data?.places?.length) { console.error("ไม่มี data/places.json"); process.exit(1); }
const cache = await readJSON("data/place-images.json", {});
const win = {}; new Function("window", await readFile(new URL("js/config.js", root), "utf8"))(win);
const KIND = Object.fromEntries(win.APP_CONFIG.placeCategories.map(c => [c.id, c.name.en]));

async function commons(params) {
  const url = "https://commons.wikimedia.org/w/api.php?format=json&formatversion=2&origin=*&" + new URLSearchParams(params);
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) return null;
    } catch {}
    await sleep(3000 * i);
  }
  return null;
}

// ---------- 1) ผู้สมัคร ----------
const INFO = { prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "960", iiextmetadatafilter: "Artist|LicenseShortName|Categories|ImageDescription" };
// รัศมีค้นรอบพิกัดตามขนาดสถานที่ (อุทยาน/ชายหาดกว้าง, ร้านกาแฟเล็ก)
const RADIUS = { park: 3000, nature: 800, zoo: 600, themepark: 500, museum: 250, landmark: 250, cafe: 60, animalcafe: 60 };
const BAD = /\b(map|karte|locator|location|logo|emblem|seal|coat of arms|flag|diagram|plan|chart|graph|sign(board)?|signage|plaque|warning|notice|rules|relief|writing|inscription|ticket|menu|receipt|document|scan|page|text|letter|stamp|coin|banknote|portrait|selfie|bus|train|truck|vehicle|interior of (a )?toilet|toilet|parking|construction|svg|icon|screenshot|drawing|painting|sketch|old photo|historical photo|\d{4}s photo)\b|แผนที่|ป้าย|โลโก้|ตรา/i;
const tokens = s => String(s || "").toLowerCase().replace(/[^a-z0-9฀-๿ ]+/g, " ").split(/\s+/).filter(w => w.length >= 3 && !/^(the|and|of|cafe|park|national|museum|zoo|temple|wat|beach|waterfall|thailand|bangkok)$/.test(w));
const km = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };

function toCand(page, p, via) {
  const ii = page.imageinfo?.[0];
  if (!ii?.thumburl || !/jpe?g|png|webp/i.test(ii.mime || "")) return null;
  const title = page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "");
  const md = ii.extmetadata || {};
  const cats = md.Categories?.value || "", desc = stripHtml(md.ImageDescription?.value).slice(0, 200);
  if (ii.width < 640 || ii.height < 400) return null;
  const ratio = ii.width / ii.height;
  if (ratio < .65 || ratio > 2.6) return null;                 // พาโนรามายาว/แนวตั้งจัด ไม่เหมาะเป็นปก
  if (BAD.test(`${title} ${desc}`)) return null;
  const nameT = new Set([...tokens(p.name.en), ...tokens(p.name.th)]);
  const hit = tokens(`${title} ${desc}`).filter(w => nameT.has(w)).length;
  const c = page.coordinates?.[0];
  const dist = c ? km(p, { lat: c.lat, lng: c.lon }) : null;
  let score = (via === "official" ? 6 : 0) + Math.min(hit, 3) * 2
    + (/Quality images|Featured pictures|Valued images/i.test(cats) ? 3 : 0)
    + (ii.width >= 1600 ? 1 : 0) + (ratio >= 1.2 && ratio <= 1.9 ? 1 : 0)
    - (dist != null ? Math.min(3, dist / ((RADIUS[p.kind] || 300) / 1000)) : 0);
  return {
    file: page.title, image: ii.thumburl.split("?")[0], small: ii.thumburl.split("?")[0].replace(/\/\d+px-/, "/330px-"), page: ii.descriptionurl,
    credit: [stripHtml(md.Artist?.value).slice(0, 60), md.LicenseShortName?.value].filter(Boolean).join(" · ") || "Wikimedia Commons",
    title, hit, via, score: +score.toFixed(2)
  };
}

async function candidates(p) {
  const out = [];
  // รูปเดิมจาก Wikidata/OSM (รูปทางการของสถานที่)
  if (p.imagePage) {
    const f = decodeURIComponent(p.imagePage.split("/wiki/").pop());
    const j = await commons({ action: "query", titles: f, ...INFO });
    for (const pg of j?.query?.pages || []) { const c = toCand(pg, p, "official"); if (c) out.push(c); }
  }
  // รูปที่ถ่ายใกล้พิกัด
  const g = await commons({ action: "query", generator: "geosearch", ggscoord: `${p.lat}|${p.lng}`, ggsradius: String(RADIUS[p.kind] || 300), ggsnamespace: "6", ggslimit: "25", ...INFO, prop: "imageinfo|coordinates" });
  for (const pg of g?.query?.pages || []) { const c = toCand(pg, p, "near"); if (c) out.push(c); }
  // ค้นด้วยชื่อ (ชื่อภาษาอังกฤษเฉพาะตัวพอ เช่น "Erawan Falls")
  const q = p.name.en && tokens(p.name.en).length ? p.name.en : p.name.th;
  if (q && q.length >= 5) {
    const s = await commons({ action: "query", generator: "search", gsrsearch: `"${q}" filetype:bitmap`, gsrnamespace: "6", gsrlimit: "12", ...INFO, prop: "imageinfo|coordinates" });
    // ผลค้นด้วยชื่อต้องอยู่ใกล้ (ถ้ามีพิกัด) กันชื่อซ้ำที่อื่น
    for (const pg of s?.query?.pages || []) {
      const c = toCand(pg, p, "name");
      const pc = pg.coordinates?.[0];
      if (c && c.hit && (!pc || km(p, { lat: pc.lat, lng: pc.lon }) < 15)) out.push(c);
    }
  }
  // ร้านเล็ก/คาเฟ่มักไม่มีรูปใน Commons → เสริมจากโพสต์ Lemon8 ที่พูดถึงร้านนี้ และรูปหน้าเว็บของร้านเอง
  if (out.length < 3) out.push(...await lemon8Cands(p));
  if (out.length < 3) { const w = await websiteCand(p); if (w) out.push(w); }
  if (out.length < 2) out.push(...await openverseCands(p));
  const seen = new Set();
  return out.filter(c => !seen.has(c.file) && seen.add(c.file)).sort((a, b) => b.score - a.score).slice(0, 4);
}

// คลังโพสต์ Lemon8: หน้า "คาเฟ่/ที่เที่ยว + จังหวัด" ทั้ง 77 จังหวัด + หัวข้อยอดนิยม (สร้างครั้งเดียวต่อรอบ)
const PROVINCES_TH = (() => { const w = {}; new Function("window", readFileSync(new URL("js/i18n.js", root), "utf8"))(w); return w.PROVINCES.map(p => p.th.replace(/^กรุงเทพมหานคร$/, "กรุงเทพ")); })();
const POOL_TOPICS = ["คาเฟ่เปิดใหม่", "คาเฟ่ลับ", "คาเฟ่สวย", "คาเฟ่มินิมอล", "คาเฟ่ริมทะเล", "คาเฟ่ริมน้ำ", "คาเฟ่ในสวน", "คาเฟ่วิวภูเขา", "คาเฟ่แมว", "คาเฟ่หมา", "คาเฟ่สัตว์", "ร้านกาแฟ", "ร้านเบเกอรี่", "ร้านอาหาร", "สวนสนุก", "สวนน้ำ", "สวนสัตว์", "ฟาร์มสัตว์"];
let poolPromise = null;
const pool = () => poolPromise ||= (async () => {
  const posts = new Map();
  const kws = [...POOL_TOPICS, ...PROVINCES_TH.flatMap(p => [`คาเฟ่${p}`, `ที่เที่ยว${p}`])];
  for (const kw of kws) {
    await sleep(2200);
    try {
      const html = await (await fetch(`https://www.lemon8-app.com/experience/${encodeURIComponent(kw)}?region=th`, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text();
      const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
      (function walk(o) {
        if (!o || typeof o !== "object") return;
        if (o.groupId && typeof o.title === "string" && !posts.has(o.groupId)) posts.set(o.groupId, o);
        for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
      })(JSON.parse(decodeURIComponent(big)));
    } catch {}
  }
  console.log(`คลังโพสต์ Lemon8: ${posts.size} โพสต์ จาก ${kws.length} หน้า`);
  return [...posts.values()];
})();
function postCand(o) {
  const image = [o.largeImage?.url, o.imageList?.[0]?.url].find(u => /^https:\/\/www\.lemon8-app\.com\/seo\/image\?/.test(u || ""));
  const author = [o, ...Object.values(o)].find(v => v && typeof v === "object" && v.linkName) || {};
  return image && {
    file: "lemon8:" + o.groupId, image, small: image, via: "lemon8", hit: 1, title: o.title,
    page: `https://www.lemon8-app.com/${author.linkName ? "@" + author.linkName + "/" : ""}${o.groupId}?region=th`,
    credit: `Lemon8${author.nickName ? " · " + author.nickName : ""}`, score: +(2 + Math.log10(1 + (+o.articleLikes || 0))).toFixed(2)
  };
}
const POOL_KINDS = new Set(["cafe", "animalcafe", "restaurant", "themepark", "zoo"]);

// โพสต์ Lemon8 ที่ชื่อโพสต์มีชื่อร้าน → รูปปกพรีวิวของโพสต์ (ลิงก์ของ Lemon8 เอง มีลายน้ำผู้โพสต์ กดแล้วไปโพสต์ต้นฉบับ)
const coreName = s => String(s || "").replace(/^(ร้าน|คาเฟ่|cafe|café|the)\s*/i, "").trim();
async function lemon8Cands(p) {
  const names = [p.name.th, p.name.en].map(coreName).filter(n => n && n.length >= 4);
  if (!names.length) return [];
  const low = names.map(n => n.toLowerCase());
  // เจอในคลังรายจังหวัดแล้ว ไม่ต้องค้นทีละร้าน
  if (POOL_KINDS.has(p.kind)) {
    const hit = (await pool()).filter(o => low.some(n => o.title.toLowerCase().includes(n))).map(postCand).filter(Boolean);
    if (hit.length) return hit.sort((a, b) => b.score - a.score).slice(0, 2);
  }
  const posts = new Map();
  // ค้นทั้งชื่อไทยและชื่ออังกฤษ (หยุดเมื่อเจอโพสต์ที่พูดถึงร้าน)
  for (const q of [...new Set([p.name.th, p.name.en].filter(Boolean))].slice(0, 2)) {
    await sleep(2500);
    let html = "";
    try { html = await (await fetch(`https://www.lemon8-app.com/experience/${encodeURIComponent(q)}?region=th`, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text(); } catch { continue; }
    const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
    try {
      (function walk(o) {
        if (!o || typeof o !== "object") return;
        if (o.groupId && typeof o.title === "string" && !posts.has(o.groupId)) posts.set(o.groupId, o);
        for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
      })(JSON.parse(decodeURIComponent(big)));
    } catch {}
    if ([...posts.values()].some(o => low.some(n => o.title.toLowerCase().includes(n)))) break;
  }
  return [...posts.values()]
    .filter(o => low.some(n => o.title.toLowerCase().includes(n)))
    .map(postCand).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 2);
}
let ovLeft = 70; // ต่อรอบ (โควต้าฟรีไม่ใช้คีย์ 200/วัน, 20/นาที)
async function openverseCands(p) {
  const q = (p.name.en || "").length >= 6 ? p.name.en : p.name.th;
  const need = tokens(q);
  if (!q || !need.length || ovLeft <= 0) return [];
  ovLeft--;
  await sleep(3200);
  try {
    const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=8&mature=false`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (r.status === 429) { ovLeft = 0; return []; }
    if (!r.ok) return [];
    return ((await r.json()).results || [])
      .filter(x => x.url && /^https:\/\//.test(x.url) && (x.width || 1000) >= 640 && !BAD.test(x.title || ""))
      .filter(x => need.filter(w => (x.title || "").toLowerCase().includes(w)).length >= Math.min(2, need.length))
      .slice(0, 2).map(x => ({
        file: "ov:" + x.id, image: x.url, small: x.thumbnail || x.url, via: "openverse", hit: 1, title: x.title, page: x.foreign_landing_url,
        credit: [String(x.creator || "").slice(0, 40), `${String(x.license || "").toUpperCase()} ${x.license_version || ""}`.trim()].filter(Boolean).join(" · "), score: 2.2
      }));
  } catch { return []; }
}
// รูปหน้าเว็บไซต์ของร้าน (og:image ที่ร้านตั้งไว้สำหรับแชร์) — ข้ามเฟซบุ๊ก/ไอจี/ติ๊กต็อก (ไม่อนุญาตให้บอทอ่าน)
async function websiteCand(p) {
  const site = p.website;
  if (!/^https?:\/\//.test(site || "") || /facebook|instagram|tiktok|line\.me|lin\.ee|wongnai|google\./i.test(site)) return null;
  try {
    const r = await fetch(site, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(12000) });
    if (!r.ok || !/html/.test(r.headers.get("content-type") || "")) return null;
    const html = (await r.text()).slice(0, 300000);
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
    if (!m) return null;
    const image = new URL(m[1].replace(/&amp;/g, "&"), r.url).href;
    if (!/^https:\/\//.test(image) || /logo|icon|favicon|placeholder|default/i.test(image)) return null;
    return { file: "web:" + image, image, small: image, via: "web", hit: 1, title: "website", page: site, credit: "รูปจากเว็บไซต์ร้าน", score: 2.5 };
  } catch { return null; }
}

// ---------- 3) ให้ AI ดูรูป ----------
// sharp: ติดตั้งแยกไว้ใน .tools/ ตอนรันใน GitHub Actions (ไม่มีก็ส่งรูปเดิม)
let sharp = null;
try { sharp = (await import("sharp")).default; } catch {
  try { const { createRequire } = await import("node:module"); sharp = createRequire(new URL(".tools/package.json", root))("sharp"); } catch {}
}
async function thumb(url) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    const type = r.headers.get("content-type")?.split(";")[0] || "";
    if (!r.ok || !/^image\//.test(type)) return null;
    let buf = Buffer.from(await r.arrayBuffer());
    if (sharp) { try { buf = await sharp(buf).resize(384, 384, { fit: "inside" }).jpeg({ quality: 78 }).toBuffer(); return { mime: "image/jpeg", b64: buf.toString("base64") }; } catch {} }
    if (buf.length > 700000) return null; // ใหญ่เกินส่งให้ AI
    return { mime: type, b64: buf.toString("base64") };
  } catch { return null; }
}
async function aiPick(group) {
  const images = [], lines = [], map = {};
  for (const { p, cands } of group) {
    const nums = [];
    for (const cand of cands) {
      const im = await thumb(cand.small);
      if (!im) continue;
      map[images.length] = cand; nums.push(images.length); images.push(im);
    }
    lines.push({ id: p.id, place: p.name.en || p.name.th, type: KIND[p.kind], province: p.province, images: nums });
  }
  if (!images.length) return {};
  const prompt = `You choose COVER PHOTOS for a Thai travel app. Images are attached in order and numbered from 0.
For each place, look only at its own image numbers and judge each image:
- relevant: true only if the photo clearly shows THIS place or exactly this kind of place (its "type"). Some images are social-media post covers or the shop's own website banner: they are fine if the photo itself shows the place, food/drinks or atmosphere; text-only graphics, logos or collages of unrelated places → false. Unrelated streets, random people, maps, signs, documents, close-ups of plaques, blurry or dark shots → false.
- appeal: 1–10, how much a traveller would want to tap and visit (bright, sharp, scenic, shows the main attraction, well composed). Dull, cluttered, low-light, construction, crowds blocking the view → low.
Then pick "best" = the image number that is relevant with the highest appeal, or null if no image is relevant with appeal >= 5.
Return JSON: {"results":[{"id","best","appeal","why"}]} — one per place; "why" is a very short Thai reason.
Places: ${JSON.stringify(lines)}`;
  const out = await aiJSON(prompt, { images });
  const res = {};
  for (const r of out?.results || []) {
    const line = lines.find(l => l.id === r.id);
    if (!line) continue;
    const ok = r.best != null && line.images.includes(+r.best) && (+r.appeal || 0) >= 5;
    res[r.id] = { chosen: ok ? map[+r.best] : null, appeal: +r.appeal || 0, why: String(r.why || "").slice(0, 80) };
  }
  return res;
}

// ---------- ทำงาน ----------
const now = Date.now(), days = t => (now - new Date(t || 0)) / 864e5;
const byFame = [...data.places].sort((a, b) => (a.image ? 1 : 0) - (b.image ? 1 : 0) || (POOL_KINDS.has(b.kind) ? 1 : 0) - (POOL_KINDS.has(a.kind) ? 1 : 0) || (b.trend ? 50 : 0) + (b.fame || 0) - (a.trend ? 50 : 0) - (a.fame || 0));
const KIND_ONLY = process.argv.includes("--kind") ? process.argv[process.argv.indexOf("--kind") + 1].split(",") : null;
const todo = byFame.filter(p => !KIND_ONLY || KIND_ONLY.includes(p.kind)).filter(p => {
  const c = cache[p.id];
  if (!c) return true;
  if ((RECHECK || c.pending) && c.by !== "ai" && aiAvailable()) return true; // ยังไม่เคยให้ AI ดู
  if (!c.image && (c.v || 1) < SOURCES_VERSION) return true; // เพิ่มแหล่งรูปใหม่ → ลองใหม่
  return !c.image && days(c.at) > RETRY_DAYS;
}).slice(0, LIMIT);
console.log(`ที่เที่ยว ${data.places.length} · จำแล้ว ${Object.keys(cache).length} · รอบนี้หารูป ${todo.length} แห่ง · AI: ${aiName()}`);

const found = [];
for (const p of todo) {
  const cands = await candidates(p);
  found.push({ p, cands });
  await sleep(300);
}

// --show: แสดงรูปที่หาได้ ไม่บันทึก (ไว้ตรวจแหล่งรูป)
if (process.argv.includes("--show")) { for (const { p, cands } of found) console.log(`${p.kind} ${p.name.th || p.name.en}:`, cands.map(x => `${x.via}(${x.score})`).join(" ") || "-"); process.exit(0); }
let asked = 0, aiFail = 0;
const withCands = found.filter(f => f.cands.length);
for (let i = 0; i < withCands.length; i += PER_ASK) {
  const group = withCands.slice(i, i + PER_ASK);
  let res = {};
  if (aiAvailable() && asked < AI_MAX && aiFail < 3) {
    try {
      res = await aiPick(group); asked++;
      await sleep(4500); // GitHub Models ฟรี ~15 คำขอ/นาที
    } catch (e) { aiFail++; console.warn("AI เลือกรูปไม่ได้:", e.message.slice(0, 160)); }
  }
  for (const { p, cands } of group) {
    const r = res[p.id];
    let pick = null, by = "rule";
    if (r) { by = "ai"; pick = r.chosen; }
    // ไม่มี AI: ใช้เฉพาะรูปที่มั่นใจ (รูปทางการ หรือชื่อตรง+อยู่ใกล้)
    else { const top = cands.find(x => !["lemon8", "web", "openverse"].includes(x.via)); if (top && (top.via === "official" || (top.hit >= 1 && top.score >= 3))) pick = top; }
    cache[p.id] = pick
      ? { image: pick.image, page: pick.page, credit: pick.credit, by, appeal: r?.appeal, why: r?.why, at: new Date().toISOString(), v: SOURCES_VERSION }
      : { image: null, by, why: r?.why, at: new Date().toISOString(), v: SOURCES_VERSION };
    // ไม่มี AI ตัดสิน = ยังไม่ถือว่าตรวจครบ → รอบหน้าที่มี AI จะตรวจซ้ำ
    if (!r) cache[p.id].pending = true;
  }
}
for (const { p, cands } of found) if (!cands.length) cache[p.id] = { image: null, by: "rule", at: new Date().toISOString(), v: SOURCES_VERSION };

// ใส่ผลลงข้อมูลที่เที่ยว
let withImg = 0;
for (const p of data.places) {
  const c = cache[p.id];
  if (c?.image) { p.image = c.image; p.imagePage = c.page; p.imageCredit = c.credit; if (c.by === "ai") { p.imageAi = true; p.imageScore = c.appeal; } else { delete p.imageAi; delete p.imageScore; } }
  else if (c && c.by === "ai") { delete p.image; delete p.imagePage; delete p.imageCredit; delete p.imageAi; delete p.imageScore; } // AI บอกว่ารูปเดิมไม่ตรง/ไม่น่าดู
  if (p.image) withImg++;
}
const live = new Set(data.places.map(p => p.id));
for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
await save("data/place-images.json", JSON.stringify(cache, null, 1) + "\n");
await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
const byAi = Object.values(cache).filter(c => c.by === "ai" && c.image).length;
console.log(`ถาม AI ${asked} ครั้ง · มีรูปปก ${withImg}/${data.places.length} แห่ง (AI เลือก ${byAi}) · ยังไม่มีรูปที่ดีพอ ${data.places.length - withImg}`);
