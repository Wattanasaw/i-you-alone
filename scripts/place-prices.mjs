// ค่าเข้า + ช่วงราคาเมนู ของที่เที่ยว/ร้าน (รัน หลัง scripts/place-images.mjs)
// แหล่ง: 1) แท็ก OpenStreetMap (fee, charge)  2) รีวิวใน Lemon8 ที่พูดถึงสถานที่นั้น (เนื้อโพสต์ + ตัวหนังสือบนรูป)
// AI อ่านรีวิวแล้วดึงเฉพาะราคาที่ "ระบุชัด" ว่าเป็นของที่นั้น — ไม่เดา ไม่มีข้อมูล = ไม่ใส่ (แอพแสดง "-")
// ผลจำไว้ใน data/place-prices.json (ตรวจซ้ำทุก 60 วัน) · ไม่มี AI = ใส่ผลที่จำไว้อย่างเดียว
// รัน: node scripts/place-prices.mjs [--limit 80] [--ai 20]
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const LIMIT = arg("--limit", 80), AI_MAX = arg("--ai", 20), PER_ASK = 5, REFRESH_DAYS = 60;
const MENU_KINDS = new Set(["cafe", "animalcafe", "restaurant"]);
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };

const data = await readJSON("data/places.json", null);
if (!data?.places) { console.error("ไม่มี data/places.json"); process.exit(1); }
const cache = await readJSON("data/place-prices.json", {});
const days = t => (Date.now() - new Date(t || 0)) / 864e5;

// ---------- รีวิวจาก Lemon8 ----------
const core = s => String(s || "").replace(/^(ร้าน|คาเฟ่|cafe|café|the|อุทยานแห่งชาติ|สวนสัตว์|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์)\s*/i, "").trim();
async function reviews(p) {
  const names = [p.name.th, p.name.en].map(core).filter(n => n && n.length >= 4).map(n => n.toLowerCase());
  if (!names.length) return [];
  const posts = new Map();
  for (const q of [...new Set([p.name.th, p.name.en].filter(Boolean))].slice(0, 2)) {
    await sleep(2500);
    try {
      const html = await (await fetch(`https://www.lemon8-app.com/experience/${encodeURIComponent(q)}?region=th`, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text();
      const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
      (function walk(o) {
        if (!o || typeof o !== "object") return;
        if (o.groupId && typeof o.title === "string" && !posts.has(o.groupId)) posts.set(o.groupId, o);
        for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
      })(JSON.parse(decodeURIComponent(big)));
    } catch {}
    if ([...posts.values()].some(o => names.some(n => o.title.toLowerCase().includes(n)))) break;
  }
  // เฉพาะโพสต์ที่ชื่อโพสต์มีชื่อสถานที่ + มีตัวเลขราคา
  return [...posts.values()]
    .filter(o => names.some(n => o.title.toLowerCase().includes(n)))
    .map(o => ({ likes: +o.articleLikes || 0, text: `${o.title} | ${String(o.shortContent || "").slice(0, 400)} | ${[].concat(o.ocrTextArr || []).join(" ").slice(0, 300)}`.replace(/\s+/g, " ") }))
    .filter(r => /\d{2,5}\s*(บาท|฿|thb|\.-)|฿\s*\d{2,5}/i.test(r.text))
    .sort((a, b) => b.likes - a.likes).slice(0, 5).map(r => r.text);
}

// ---------- ค่าเข้าจาก OpenStreetMap ("100 THB", "40 บาท") ----------
function osmFee(p) {
  if (p.fee === "no") return { free: true };
  const m = String(p.charge || "").match(/(\d{2,5})/);
  return m ? { thai: +m[1] } : null;
}

// ---------- ทำงาน ----------
const todo = data.places
  .filter(p => !cache[p.id] || days(cache[p.id].at) > REFRESH_DAYS)
  .sort((a, b) => (b.hot || 0) - (a.hot || 0) || (MENU_KINDS.has(b.kind) ? 1 : 0) - (MENU_KINDS.has(a.kind) ? 1 : 0) || (b.fame || 0) - (a.fame || 0))
  .slice(0, aiAvailable() ? LIMIT : 0);
console.log(`ที่เที่ยว ${data.places.length} · มีราคาแล้ว ${Object.values(cache).filter(c => c.entry || c.menu).length} · รอบนี้ตรวจ ${todo.length} · AI: ${aiName()}`);

const withText = [];
for (const p of todo) {
  const rv = await reviews(p);
  if (rv.length) withText.push({ p, rv });
  else cache[p.id] = { at: new Date().toISOString() }; // ไม่มีรีวิวที่บอกราคา
}
let asked = 0, fails = 0;
for (let i = 0; i < withText.length && asked < AI_MAX && fails < 3; i += PER_ASK) {
  const group = withText.slice(i, i + PER_ASK);
  const items = group.map(({ p, rv }) => ({ id: p.id, place: p.name.th || p.name.en, type: p.kind, province: p.province, reviews: rv }));
  const prompt = `You extract PRICES for places in Thailand from user review snippets (Thai or English). For each place:
- entry: the admission/entry fee for THIS place if a snippet states it explicitly. {"free": true} if it says entry is free. Otherwise {"thai": adult price for Thais in THB, "foreign": adult price for foreigners in THB or null}. null if not stated.
- menu: for cafés/restaurants, the typical price range of food/drinks at THIS place: {"min": THB, "max": THB}. Use only prices clearly for this place's menu items (ignore parking, transport, hotels, other shops). null if not stated.
Rules: never guess or use general knowledge; ignore prices about other places mentioned in the same snippet; numbers must appear in the text.
Return JSON: {"results":[{"id","entry","menu"}]}
Places: ${JSON.stringify(items)}`;
  try {
    const out = await aiJSON(prompt);
    asked++;
    for (const r of out?.results || []) {
      if (!group.some(g => g.p.id === r.id)) continue;
      const ok = n => Number.isFinite(+n) && +n >= 10 && +n <= 20000 ? Math.round(+n) : undefined;
      const entry = r.entry?.free === true ? { free: true } : (ok(r.entry?.thai) || ok(r.entry?.foreign)) ? { thai: ok(r.entry?.thai), foreign: ok(r.entry?.foreign) } : undefined;
      let menu = ok(r.menu?.min) || ok(r.menu?.max) ? { min: ok(r.menu?.min) ?? ok(r.menu?.max), max: ok(r.menu?.max) ?? ok(r.menu?.min) } : undefined;
      if (menu && menu.min > menu.max) menu = { min: menu.max, max: menu.min };
      cache[r.id] = { entry, menu, src: "Lemon8", at: new Date().toISOString() };
    }
    await sleep(4500);
  } catch (e) { fails++; console.warn("AI อ่านราคาไม่ได้:", e.message.slice(0, 160)); }
}

// ใส่ผลลงข้อมูลที่เที่ยว (OSM ก่อน, รีวิวเสริม)
let nEntry = 0, nMenu = 0;
for (const p of data.places) {
  const c = cache[p.id] || {};
  const entry = osmFee(p) || c.entry;
  if (entry) { p.entry = { ...entry, src: osmFee(p) ? "OSM" : c.src }; nEntry++; } else delete p.entry;
  if (c.menu && MENU_KINDS.has(p.kind)) { p.menuPrice = { ...c.menu, src: c.src }; nMenu++; } else delete p.menuPrice;
}
const live = new Set(data.places.map(p => p.id));
for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
await save("data/place-prices.json", JSON.stringify(cache, null, 1) + "\n");
await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
console.log(`ถาม AI ${asked} ครั้ง · มีค่าเข้า ${nEntry} แห่ง · มีราคาเมนู ${nMenu} ร้าน`);
