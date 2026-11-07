// รวบรวม "สถานที่จากเทรนด์": โพสต์ Lemon8 ยอดนิยมที่ยังไม่ตรงกับสถานที่ไหนในแอพ
// 1) เปิดหน้าโพสต์ → "ปักหมุดสถานที่" ที่ผู้โพสต์แท็กไว้ (locationInfo: poiId + ชื่อสถานที่) — ไม่ต้องเดาชื่อ
// 2) เปิดหน้าสถานที่ (poi) ของ Lemon8 → ชื่อจริง + ที่อยู่เต็ม + โพสต์อื่นที่แท็กที่เดียวกัน (= เทรนด์ของที่นั้น)
// 3) หาพิกัดบนแผนที่ OpenStreetMap (Nominatim ฟรี ≤ 1 ครั้ง/วินาที): ชื่อตรงในจังหวัดเดียวกัน = พิกัดจริง
//    ไม่เจอชื่อ → ใช้ที่อยู่ (ตำบล/อำเภอ) เป็นพิกัดโดยประมาณ (approx) แอพนำทางด้วย "ชื่อ + ที่อยู่" ให้ Google Maps หาเอง
// 4) ตรงกับสถานที่เดิมในแอพ (OSM id เดียวกัน / ชื่อเดียวกันในจังหวัดเดียวกัน / ห่าง ≤ 150 ม.) → ใส่โพสต์ให้ที่เดิม
//    ไม่มีในแอพ → เพิ่มเป็นสถานที่ใหม่ใน data/trend-places.json
// หมวด (คาเฟ่/ร้านอาหาร/...) ให้ AI จัด (ถ้ามี) ไม่งั้นเดาจากชื่อ+โพสต์ · โรงแรม/ห้าง/ร้านขายของ ข้าม
// ผลทุกอย่างจำไว้ใน data/trend-extract.json (ไม่เปิดหน้าซ้ำ) · รัน หลัง scripts/place-posts.mjs (ใช้ .cache/l8-pool.json)
// node scripts/trend-places.mjs [--posts 160] [--ai 8]
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const POSTS_MAX = arg("--posts", 160), AI_MAX = arg("--ai", 8), KEEP_DAYS = 200;
const KINDS = ["cafe", "animalcafe", "restaurant", "themepark", "zoo", "nature", "landmark", "museum", "park"];
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const days = t => (Date.now() - new Date(t || 0)) / 864e5;
const today = new Date().toISOString().slice(0, 10);

const data = await readJSON("data/places.json", null);
if (!data?.places) { console.error("ไม่มี data/places.json"); process.exit(1); }
const pool = await readJSON(".cache/l8-pool.json", []);
const cache = await readJSON("data/trend-extract.json", {});
cache.posts ||= {}; cache.pois ||= {}; cache.geo ||= {};
const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
const PROVINCES = win.PROVINCES;

// ---------- ชื่อ/จังหวัด ----------
const norm = s => String(s || "").toLowerCase().normalize("NFC").replace(/[\s'’"“”.,!&()\-–_/|·:]+/g, "");
const GENERIC_W = /คาเฟ่|ร้านกาแฟ|ร้านอาหาร|ร้าน|กาแฟ|\b(cafe|café|coffee|shop|bistro|restaurant|eatery|bakery|the|and|co)\b/gi;
const core = s => norm(String(s || "").replace(GENERIC_W, " "));
const sameName = (a, b) => { const x = core(a), y = core(b); return x.length >= 3 && y.length >= 3 && (x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)))); };
// จังหวัดจากที่อยู่ ("... อำเภอบ่อทอง ชลบุรี 20270 ประเทศไทย") — ชื่อจังหวัดที่อยู่ท้ายสุด
function provinceOf(addr) {
  const s = String(addr || "");
  if (/กรุงเทพ|bangkok/i.test(s)) return "bangkok";
  let best = null, at = -1;
  for (const p of PROVINCES) for (const n of [p.th, p.en]) { const i = s.toLowerCase().lastIndexOf(n.toLowerCase()); if (i > at) { at = i; best = p.id; } }
  return best;
}
const PROV_CORE = new Set(PROVINCES.flatMap(p => [p.th, p.en]).map(core).concat(["กรุงเทพ"]));
const km = (a, b) => { const R = 6371, r = d => d * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng); return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2)); };

// ---------- Lemon8 ----------
async function l8Data(url) {
  const html = await (await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text();
  const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
  return JSON.parse(decodeURIComponent(big));
}
function find(o, key) {
  if (!o || typeof o !== "object") return null;
  if (o[key]) return o[key];
  for (const [k, v] of Object.entries(o)) { if (k === "translation" || k === "manifest") continue; const r = v && typeof v === "object" ? find(v, key) : null; if (r) return r; }
  return null;
}
const postFrom = o => {
  const author = [o, ...Object.values(o)].find(v => v && typeof v === "object" && v.linkName) || {};
  return {
    title: String(o.title || "").replace(/\s+/g, " ").trim().slice(0, 140), likes: +o.articleLikes || 0,
    date: new Date(Number(BigInt(o.groupId) >> 32n) * 1000).toISOString().slice(0, 10),
    link: `https://www.lemon8-app.com/${author.linkName ? "@" + author.linkName + "/" : ""}${o.groupId}?region=th`,
    source: `Lemon8${author.nickName ? " · " + author.nickName : ""}`,
    // รูปพรีวิวของ Lemon8 (ลิงก์ seo หรือ CDN ที่เซ็นไว้ ~1 ปี — หน้าสถานที่ถูกอ่านใหม่ทุก 14 วัน ลิงก์จึงสดเสมอ)
    image: [o.largeImage?.url, o.imageList?.[0]?.url].find(u => /^https:\/\/(www\.lemon8-app\.com\/seo\/image\?|p\d+-lemon8-[\w-]+\.tiktokcdn\.com\/)/.test(u || "")),
    text: String(o.shortContent || "").replace(/\s+/g, " ").slice(0, 200)
  };
};

// 1) หมุดสถานที่ของแต่ละโพสต์
const todo = pool.filter(x => !(x.link in cache.posts)).slice(0, POSTS_MAX);
console.log(`โพสต์ยอดนิยมที่ยังไม่ตรงสถานที่ ${pool.length} · เปิดดูหมุดรอบนี้ ${todo.length}`);
let pinned = 0;
for (const x of todo) {
  await sleep(1500);
  try {
    const loc = find(await l8Data(x.link), "locationInfo");
    cache.posts[x.link] = loc?.poiId ? { at: today, poi: String(loc.poiId), name: loc.poiName } : { at: today };
    if (loc?.poiId) pinned++;
  } catch (e) { console.warn("เปิดโพสต์ไม่ได้:", e.message.slice(0, 80)); }
}
console.log(`มีหมุดสถานที่ ${pinned}/${todo.length} โพสต์`);

// 2) ข้อมูลสถานที่ (ชื่อ ที่อยู่ โพสต์ที่แท็กที่นี่)
const poiIds = [...new Set(Object.values(cache.posts).map(e => e.poi).filter(Boolean))];
for (const id of poiIds) {
  if (cache.pois[id] && days(cache.pois[id].at) < 14) continue;
  await sleep(1500);
  try {
    const j = await l8Data(`https://www.lemon8-app.com/poi/${id}?region=th`);
    const ld = j?.state?.loaderData?.["routes/poi.$poi_id"] || {};
    const info = Object.entries(ld).find(([k]) => k.startsWith("$PoiInfo"))?.[1];
    const items = Object.entries(ld).find(([k]) => k.startsWith("$PoiPost"))?.[1]?.items || [];
    if (!info?.name) continue;
    cache.pois[id] = { ...(cache.pois[id] || {}), at: today, name: info.name, address: info.formatted_address || "", posts: items.filter(o => o.groupId && o.title).map(postFrom).filter(p => p.title.length >= 4) };
  } catch (e) { console.warn("เปิดหน้าสถานที่ไม่ได้:", id, e.message.slice(0, 80)); }
}

// 3) หมวด: AI (ถ้ามี) หรือเดาจากคำ · skip = ที่พัก ห้าง ร้านขายของ ฯลฯ
const guessKind = s => /แมว|หมา|สุนัข|cat|dog|นก|กระต่าย|อัลปาก้า|capybara|คาปิบาร่า|animal|สัตว์/i.test(s) && /คาเฟ่|cafe|café/i.test(s) ? "animalcafe"
  : /คาเฟ่|cafe|café|coffee|กาแฟ|bakery|เบเกอรี่|มัทฉะ|matcha|ขนม|dessert/i.test(s) ? "cafe"
  : /ร้านอาหาร|restaurant|หมูกระทะ|ชาบู|ก๋วยเตี๋ยว|ปิ้งย่าง|ซีฟู้ด|bistro|bar\b|ครัว|kitchen/i.test(s) ? "restaurant"
  : /สวนสัตว์|zoo|ฟาร์ม|farm|aquarium|อควาเรียม/i.test(s) ? "zoo"
  : /สวนน้ำ|สวนสนุก|water ?park|theme ?park|amusement/i.test(s) ? "themepark"
  : /พิพิธภัณฑ์|museum|gallery|แกลเลอรี|นิทรรศการ|art/i.test(s) ? "museum"
  : /น้ำตก|ทะเล|หาด|beach|ภูเขา|ดอย|เขา|ทะเลสาบ|lake|จุดชมวิว|view ?point|อุทยาน|เกาะ|island|ถ้ำ|cave|camp|แคมป์/i.test(s) ? "nature"
  : /สวนสาธารณะ|park|สวน/i.test(s) ? "park" : "landmark";
const SKIP = /โรงแรม|รีสอร์ท|hotel|resort|hostel|villa|วิลล่า|condo|คอนโด|โรงพยาบาล|clinic|คลินิก|สนามบิน|airport|สถานี|station|mall|ห้าง|central|เซ็นทรัล|เดอะมอลล์|robinson|lotus|โลตัส|big ?c|7-eleven|เซเว่น/i;
const needKind = Object.entries(cache.pois).filter(([, p]) => p.name && !p.kind);
let asked = 0;
for (let i = 0; i < needKind.length && aiAvailable() && asked < AI_MAX; i += 30) {
  const group = needKind.slice(i, i + 30);
  try {
    const out = await aiJSON(`Classify each place in Thailand (from Lemon8 location tags) into one kind: ${KINDS.join("|")}, or "skip" if it is a hotel/resort/accommodation, shopping mall, shop/store, hospital, office, transport station, or not a place people visit for leisure.
animal cafés (cat/dog/capybara...) = animalcafe; beaches, waterfalls, mountains, viewpoints, islands, camping = nature; temples, markets, old towns, landmarks = landmark.
Return JSON {"results":[{"id","kind"}]}
Places: ${JSON.stringify(group.map(([id, p]) => ({ id, name: p.name, address: p.address.slice(0, 80), posts: (p.posts || []).slice(0, 2).map(x => x.title) })))}`);
    asked++;
    for (const r of out?.results || []) if (cache.pois[r.id] && (KINDS.includes(r.kind) || r.kind === "skip")) cache.pois[r.id].kind = r.kind;
    await sleep(4000);
  } catch (e) { console.warn("AI จัดหมวดไม่ได้:", e.message.slice(0, 120)); break; }
}

// 4) พิกัด
const OK_CLASS = /^(amenity|tourism|leisure|natural|historic|shop|building|place|waterway|landuse|man_made)$/;
async function nominatim(q) {
  await sleep(1200);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&namedetails=1&limit=6&countrycodes=th&accept-language=th&q=${encodeURIComponent(q)}`;
  return await (await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) })).json();
}
const provOfNom = r => { const a = r.address || {}; return provinceOf([a.province, a.state, a.city].filter(Boolean).join(" ")); };
async function locate(id, p, prov) {
  const g = cache.geo[id];
  if (g && days(g.at) < 120) return g.hit;
  let hit = null;
  try {
    // ชื่อสถานที่ในจังหวัดเดียวกัน = พิกัดจริง
    for (const q of [...new Set([p.name, p.name.replace(GENERIC_W, " ").replace(/\s+/g, " ").trim()])].filter(q => q.length >= 3)) {
      const r = (await nominatim(q)).find(r => OK_CLASS.test(r.category || r.class || "") && provOfNom(r) === prov && [r.name, r.namedetails?.name, r.namedetails?.["name:th"], r.namedetails?.["name:en"]].some(n => n && sameName(n, p.name)));
      if (r) { hit = { osm: `${r.osm_type[0]}${r.osm_id}`, lat: +(+r.lat).toFixed(6), lng: +(+r.lon).toFixed(6) }; break; }
    }
    // ไม่เจอ → ที่อยู่ระดับตำบล/อำเภอ (ประมาณ)
    if (!hit && p.address) {
      // ตำบล/แขวง + อำเภอ/เขต + จังหวัด จากที่อยู่ ("..., คลองยาง, อำเภอบ่อทอง ชลบุรี", "ต.ประตูชัย ...")
      const a = p.address.replace(/ประเทศไทย|thailand|ไทย$|\d{5}/gi, " ");
      const amphoe = a.match(/(?:อำเภอ|อ\.|เขต)\s*([^\s,]+)/)?.[1];
      const parts = a.split(",").map(s => s.trim()).filter(Boolean);
      const tambon = a.match(/(?:ตำบล|ต\.|แขวง)\s*([^\s,]+)/)?.[1]
        || (amphoe && parts[parts.findIndex(s => s.includes(amphoe)) - 1]?.replace(/^.*\d\S*\s*/, ""));
      const provTh = PROVINCES.find(x => x.id === prov)?.th;
      const qs = [tambon && amphoe && `${tambon} ${amphoe} ${provTh}`, tambon && `${tambon} ${provTh}`, amphoe && `${amphoe} ${provTh}`];
      for (const q of [...new Set(qs.filter(Boolean))]) {
        const r = (await nominatim(q)).find(r => provOfNom(r) === prov);
        if (r) { hit = { lat: +(+r.lat).toFixed(5), lng: +(+r.lon).toFixed(5), approx: true }; break; }
      }
    }
  } catch (e) { console.warn("หาพิกัดไม่ได้:", p.name, e.message.slice(0, 80)); return null; }
  cache.geo[id] = { at: today, hit };
  return hit;
}

// 5) รวม → สถานที่เดิม / ใหม่
const byOsm = new Map(data.places.map(p => [p.id.replace(/^osm-/, ""), p]));
const slim = ({ text, ...x }) => ({ ...x, tag: 1 }); // tag = ผู้โพสต์ปักหมุดสถานที่นี้เอง
const postOf = new Map(pool.map(x => [x.link, slim(x)]));
const out = new Map();
let toOld = 0, skipped = 0, noGeo = 0;
for (const id of poiIds) {
  const p = cache.pois[id];
  if (!p?.name) continue;
  const prov = provinceOf(p.address);
  const byName = guessKind(p.name);
  const kind = p.kind || (byName !== "landmark" ? byName : guessKind(`${p.name} ${(p.posts || []).map(x => x.title + " " + x.text).join(" ").slice(0, 600)}`));
  // หมุดระดับจังหวัด/อำเภอ ("ฉะเชิงเทรา", "จังหวัดพระนครศรีอยุธยา", "ตำบล นครนายก") ไม่ใช่สถานที่
  const admin = /^(จังหวัด|อำเภอ|ตำบล|แขวง|เขต|amphoe|tambon|changwat)/i.test(p.name.trim()) || PROV_CORE.has(core(p.name)) || !/\d/.test(p.address);
  if (!prov || admin || kind === "skip" || SKIP.test(p.name)) { skipped++; continue; }
  // โพสต์: ที่แท็กที่นี่ (หน้า poi) + โพสต์ในคลังที่แท็กที่นี่ · ช่วง KEEP_DAYS วัน
  const tagged = Object.entries(cache.posts).filter(([, e]) => e.poi === id).map(([l]) => postOf.get(l)).filter(Boolean);
  const posts = [...new Map([...tagged, ...(p.posts || []).map(slim)].map(x => [x.link, x])).values()]
    .filter(x => days(x.date) <= KEEP_DAYS).sort((a, b) => b.likes - a.likes);
  if (!posts.length) continue;
  const hot = +posts.reduce((s, x) => s + 1 + Math.log10(1 + x.likes), 0).toFixed(1);
  const hit = await locate(id, p, prov);
  const old = (hit?.osm && byOsm.get(hit.osm))
    || data.places.find(q => q.province === prov && [q.name?.th, q.name?.en].some(n => n && sameName(n, p.name)))
    || (hit && !hit.approx && data.places.find(q => q.lat && km(q, hit) <= 0.15));
  if (old) {
    old.posts = [...new Map([...posts.slice(0, 4), ...(old.posts || [])].map(x => [x.link, x])).values()].sort((a, b) => b.likes - a.likes).slice(0, 4);
    if (hot > (old.hot || 0)) old.hot = hot;
    old.trend = Math.max(old.trend || 0, posts.length);
    toOld++;
    continue;
  }
  if (!hit) { noGeo++; continue; }
  const th = /[฀-๿]/.test(p.name);
  out.set(`l8-${id}`, {
    id: `l8-${id}`, kind, fromTrend: true, l8poi: id,
    name: th ? { th: p.name } : { th: p.name, en: p.name },
    lat: hit.lat, lng: hit.lng, ...(hit.approx ? { approx: true } : { osm: hit.osm }),
    province: prov, address: p.address.replace(/,?\s*(ประเทศไทย|ไทย|Thailand)\s*$/i, "").replace(/,?\s*\d{5}\s*$/, "") || undefined,
    hot, trend: posts.length, posts: posts.slice(0, 6), fetchedAt: new Date().toISOString()
  });
}
const list = [...out.values()].sort((a, b) => b.hot - a.hot);

for (const [k, v] of Object.entries(cache.posts)) if (days(v.at) > KEEP_DAYS) delete cache.posts[k];
for (const [k, v] of Object.entries(cache.geo)) if (days(v.at) > 120) delete cache.geo[k];
const live = new Set(Object.values(cache.posts).map(e => e.poi).filter(Boolean));
for (const k of Object.keys(cache.pois)) if (!live.has(k)) delete cache.pois[k];
await save("data/trend-extract.json", JSON.stringify(cache) + "\n");
await save("data/trend-places.json", JSON.stringify(list, null, 1) + "\n");
await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
console.log(`สถานที่ที่ถูกแท็ก ${poiIds.length} → ตรงกับสถานที่เดิม ${toOld} · เพิ่มใหม่ ${list.length} (พิกัดจริง ${list.filter(p => !p.approx).length} / ประมาณจากที่อยู่ ${list.filter(p => p.approx).length}) · ข้าม (ที่พัก/ห้าง/ไม่รู้จังหวัด) ${skipped} · หาพิกัดไม่ได้ ${noGeo} · AI จัดหมวด ${asked} ครั้ง (${aiName()})`);
