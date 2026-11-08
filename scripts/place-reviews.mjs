// สรุปรีวิว + ข้อมูลจริง (เวลาเปิด-ปิด · ค่าเข้าทุกราคา · ช่วงราคาเมนู) ของแต่ละสถานที่ จาก "หลายแหล่ง" → data/place-reviews.json
// แหล่งที่อ่าน (ต่อสถานที่):
//   W  = เว็บไซต์ทางการ (หน้าแรก + หน้าราคา/บัตร/เวลาเปิด ที่ลิงก์จากหน้าแรก)
//   WP = Wikipedia (ไทย/อังกฤษ) · WV = Wikivoyage (รายการสถานที่ในคู่มือท่องเที่ยว มีราคา/เวลาเปิด)
//   L1…Ln = โพสต์รีวิวจริงใน Lemon8 (เนื้อโพสต์เต็ม + ข้อความบนรูป + คอมเมนต์) หลายคน + รีวิวที่ปักหมุดที่เดียวกัน
// AI อ่านทุกแหล่งพร้อมกันแล้วสรุปด้วยคำของตัวเอง + ดึงข้อมูลจริงพร้อมบอกว่ามาจากแหล่งไหน
// ข้อมูลจริงทุกค่าถูกตรวจซ้ำด้วยโค้ดก่อนใช้ (ไม่เชื่อ AI อย่างเดียว):
//   1) ตัวเลขราคา/เวลาต้องมีอยู่จริงในข้อความของแหล่งนั้น (กัน AI แต่งตัวเลข)
//   2) ต้องมาจากเว็บไซต์ทางการ หรือพบตรงกันอย่างน้อย 2 แหล่งที่เป็นอิสระต่อกัน (คนละคน/คนละเว็บ) — ไม่ผ่าน = ไม่ใช้
//   3) มีราคาจากเว็บไซต์ทางการ → ใช้ชุดราคาทางการ (ราคาในรีวิวอาจเป็นโปรฯ หรือราคาเก่า)
// ค่าเข้าเก็บทุกประเภทบัตร (ผู้ใหญ่/เด็ก/คนไทย/ต่างชาติ/ซื้อออนไลน์/หน้างาน) · place-info.mjs ใส่ลงข้อมูลสถานที่
// สรุปใหม่เมื่อมีโพสต์ใหม่หรือครบ 60 วัน · สถานที่ดัง/มีค่าเข้าก่อน · ไม่มี AI = ใช้ผลเดิม
// node scripts/place-reviews.mjs [--ai 40] [--only <id>] [--sources]  (--sources = แสดงแหล่งที่รวบรวมได้ ไม่ถาม AI)
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const BOT = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const argv = process.argv;
const arg = (n, d) => { const i = argv.indexOf(n); return i > 0 ? argv[i + 1] : d; };
const AI_MAX = +arg("--ai", 40), MINUTES = +arg("--minutes", 35), T0 = Date.now(), ONLY = arg("--only", ""), SHOW = argv.includes("--sources");
const POSTS_PER = 6, REFRESH_DAYS = 60, VERSION = 3;
export const GOOD_FOR = ["photo", "work", "kids", "pets", "date", "group", "view", "nature", "chill", "budget", "night", "food"];
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const days = t => (Date.now() - new Date(t || 0)) / 864e5;
const clean = s => String(s || "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

const data = await readJSON("data/places.json", { places: [] });
const trendPl = await readJSON("data/trend-places.json", []);
const cache = await readJSON("data/place-reviews.json", {});
const all = [...data.places, ...trendPl];
const SHARDS = 32;
const shardOf = id => { let h = 0x811c9dc5; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h % SHARDS; };
const shards = await Promise.all([...Array(SHARDS)].map((_, i) => readJSON(`data/place-posts/${String(i).padStart(2, "0")}.json`, {})));
const postsOf = p => { const m = new Map(); for (const x of [...(shards[shardOf(p.id)][p.id]?.posts || []), ...(p.posts || [])]) m.set(x.link, x); return [...m.values()]; };
const sig = p => postsOf(p).map(x => x.link).sort().join("|") + "|" + (p.website || "");
const nameOf = p => typeof p.name === "string" ? { th: p.name } : (p.name || {});

// ---------- คิว ----------
const MENU_KINDS = new Set(["cafe", "animalcafe", "restaurant", "nightlife"]);
const FEE_KINDS = new Set(["zoo", "themepark", "museum", "park", "animalcafe"]);
const SOCIAL = /facebook|fb\.com|fb\.me|instagram|line\.me|lin\.ee|tiktok|twitter|x\.com|youtube|google\.|goo\.gl|wongnai|tripadvisor|agoda|booking\.com|klook|linktr/i;
const site = p => [p.website].flat().find(u => /^https?:\/\//.test(u || "") && !SOCIAL.test(u));
const hasSource = p => postsOf(p).length || site(p) || p.wiki;
// MENU_V: เกณฑ์ราคาเมนูเปลี่ยน (รับเมนูจากรีวิวเดียวได้ ถ้าราคาอยู่ในโพสต์จริง ≥ 2 เมนู) → ร้านที่ยังไม่มีราคาเมนูตรวจใหม่
const MENU_V = 1;
const due = p => { const c = cache[p.id]; return !c || (c.v || 0) < VERSION || (MENU_KINDS.has(p.kind) && !c.facts?.menu && (c.mv || 0) < MENU_V && postsOf(p).length > 0) || days(c.at) > REFRESH_DAYS || (c.sig !== sig(p) && days(c.at) > 7); };
const prio = p => (FEE_KINDS.has(p.kind) || MENU_KINDS.has(p.kind) && postsOf(p).length ? 20 : 0) + (p.wikidata ? 10 : 0) + (p.fame || 0) + Math.min(p.hot || 0, 30) + (site(p) ? 5 : 0) + Math.min(postsOf(p).length, 6);
const todo = all.filter(p => (!ONLY || p.id === ONLY) && hasSource(p) && (ONLY || due(p))).sort((a, b) => prio(b) - prio(a));
console.log(`สถานที่ ${all.length} · มีแหล่งข้อมูล ${all.filter(hasSource).length} · สรุปแบบหลายแหล่งแล้ว ${Object.values(cache).filter(c => c.v >= VERSION).length} · รอสรุป ${todo.length} · AI: ${aiName()}`);

// ---------- แหล่ง: Lemon8 ----------
async function postText(link) {
  try {
    const html = await (await fetch(link, { headers: { "User-Agent": BOT, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text();
    const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
    const ld = JSON.parse(decodeURIComponent(big))?.state?.loaderData || {};
    const a = Object.values(ld).flatMap(v => v && typeof v === "object" ? Object.entries(v) : []).find(([k]) => k.includes("ArticleDetail"))?.[1];
    if (!a) return null;
    const body = clean(String(a.content || a.shortContent || "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, ""));
    const ocr = [].concat(Array.isArray(a.ocrText) ? a.ocrText : (() => { try { return JSON.parse(a.ocrText || "[]"); } catch { return [a.ocrText || ""]; } })()).join(" ").replace(/\s+/g, " ").trim();
    const cm = Object.values(ld).flatMap(v => v && typeof v === "object" ? Object.entries(v) : []).find(([k]) => k.includes("ArticleComments"))?.[1]?.items || [];
    const comments = cm.map(c => ({ t: String(c.text || "").replace(/\s+/g, " ").trim(), d: +c.diggCount || 0 })).filter(c => c.t.length >= 12)
      .sort((x, y) => y.d - x.d).slice(0, 5).map(c => c.t.slice(0, 120));
    const text = `${a.title}\n${body.slice(0, 1300)}${ocr ? `\n[ข้อความบนรูป] ${ocr.slice(0, 350)}` : ""}${comments.length ? `\n[คอมเมนต์] ${comments.join(" / ")}` : ""}`;
    const author = a.author?.linkName || a.user?.linkName || "";
    return { text, author, poi: a.locationInfo?.poiId ? { id: String(a.locationInfo.poiId), name: a.locationInfo.poiName || "" } : null };
  } catch { return null; }
}
const norm = s => String(s || "").toLowerCase().replace(/คาเฟ่|ร้านกาแฟ|ร้าน|\b(cafe|café|coffee|shop|the)\b/g, "").replace(/[^ก-๙a-z0-9]/g, "");
const sameName = (a, b) => { const x = norm(a), y = norm(b); return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)); };
async function poiPosts(id) {
  try {
    const html = await (await fetch(`https://www.lemon8-app.com/poi/${id}?region=th`, { headers: { "User-Agent": BOT, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text();
    const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
    const ld = JSON.parse(decodeURIComponent(big))?.state?.loaderData?.["routes/poi.$poi_id"] || {};
    const items = Object.entries(ld).find(([k]) => k.startsWith("$PoiPost"))?.[1]?.items || [];
    return items.filter(o => o.groupId && o.title).sort((a, b) => (+b.articleLikes || 0) - (+a.articleLikes || 0)).map(o => {
      const au = [o, ...Object.values(o)].find(v => v && typeof v === "object" && v.linkName) || {};
      return { link: `https://www.lemon8-app.com/${au.linkName ? "@" + au.linkName + "/" : ""}${o.groupId}?region=th`, source: `Lemon8${au.nickName ? " · " + au.nickName : ""}`, author: au.linkName || "", likes: +o.articleLikes || 0, title: o.title, text: `${o.title}\n${String(o.shortContent || "").slice(0, 700)}` };
    });
  } catch { return []; }
}

// ---------- แหล่ง: เว็บไซต์ทางการ ----------
const KEY = /เวลาเปิด|เวลาทำการ|เปิดให้บริการ|เปิดบริการ|เปิดทุกวัน|ปิดทุกวัน|หยุดทุก|ค่าเข้า|ค่าบัตร|บัตรผ่านประตู|อัตราค่า|ราคาบัตร|ราคา|ผู้ใหญ่|เด็ก|ต่างชาติ|ชาวไทย|เมนู|opening hours|open(?:ing)? (?:daily|time|hours)|business hours|hours|admission|ticket|entrance|price|adult|child|menu|฿|บาท|thb/gi;
const PAGE_HINT = /ticket|price|pricing|admission|rate|fee|hour|opening|visit|plan|info|บัตร|ราคา|ค่าเข้า|เวลา|อัตรา|เยี่ยมชม|ข้อมูล/i;
async function getHtml(url) {
  const r = await fetch(url, { headers: { "User-Agent": BROWSER, "Accept-Language": "th,en" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!r.ok || !/html/i.test(r.headers.get("content-type") || "")) return null;
  return { html: (await r.text()).slice(0, 800000), url: r.url };
}
const htmlText = html => clean(html.replace(/<(script|style|noscript|svg|nav|footer)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|tr|td|th|h\d)>/gi, "\n").replace(/<[^>]+>/g, " "));
function excerpt(text, max) {
  const spans = [];
  for (const m of text.matchAll(KEY)) { const a = Math.max(0, m.index - 140), b = Math.min(text.length, m.index + 320); if (!spans.length || a > spans.at(-1)[1]) spans.push([a, b]); else spans.at(-1)[1] = b; }
  return spans.map(([a, b]) => text.slice(a, b).trim()).join("\n…\n").slice(0, max);
}
async function websiteSource(url) {
  try {
    const home = await getHtml(url);
    if (!home) return null;
    const ld = [...home.html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1].trim()).join(" ").match(/"(openingHours|openingHoursSpecification|priceRange|offers)"[\s\S]{0,400}/g) || [];
    let text = excerpt(htmlText(home.html), 1800) + (ld.length ? "\n[schema] " + ld.join(" ").slice(0, 500) : "");
    // หน้าย่อยเรื่องราคา/บัตร/เวลาเปิด (เว็บเดียวกัน สูงสุด 2 หน้า)
    const host = new URL(home.url).hostname;
    const links = [...home.html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]{0,120}?)<\/a>/gi)]
      .map(m => { try { return { u: new URL(m[1], home.url).toString(), t: m[2].replace(/<[^>]+>/g, " ") }; } catch { return null; } })
      .filter(x => x && new URL(x.u).hostname === host && x.u !== home.url && PAGE_HINT.test(x.u + " " + x.t) && !/\.(pdf|jpg|png|zip)$/i.test(x.u));
    // หน้าราคา/บัตร/เวลาเปิดก่อน หน้าข้อมูลทั่วไปทีหลัง
    const STRONG = /ticket|price|pricing|admission|fee|rate|hour|opening|บัตร|ราคา|ค่าเข้า|อัตรา|เวลาเปิด|เวลาทำการ/i;
    const score = x => (STRONG.test(x.u) ? 4 : 0) + (STRONG.test(x.t) ? 3 : 0) + (/plan|visit|info|เยี่ยมชม|ข้อมูล/i.test(x.u + x.t) ? 1 : 0) - x.u.length / 200;
    for (const l of [...new Map(links.map(x => [x.u, x])).values()].sort((a, b) => score(b) - score(a)).slice(0, 2)) {
      await sleep(600);
      const sub = await getHtml(l.u).catch(() => null);
      if (sub) text += `\n[หน้า ${new URL(sub.url).pathname}]\n` + excerpt(htmlText(sub.html), 1600);
    }
    text = text.trim();
    return text.length >= 40 ? { id: "W", type: "web", label: host.replace(/^www\./, ""), link: home.url, text: text.slice(0, 3800) } : null;
  } catch { return null; }
}

// ---------- แหล่ง: Wikipedia / Wikivoyage ----------
const nameCore = s => String(s || "").replace(/\(.*?\)/g, "").replace(/[\s_]+/g, "").replace(/^(อุทยานแห่งชาติ|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|สวนสัตว์|วัด|น้ำตก|หาด|เกาะ|the)/i, "").slice(0, 4).toLowerCase();
async function wikiSource(url, name) {
  const m = String(url || "").match(/^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return null;
  try {
    const r = await fetch(`https://${m[1]}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=1800&redirects=1&format=json&titles=${m[2]}`, { headers: { "User-Agent": BOT }, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    const pg = Object.values(j.query?.pages || {})[0];
    const text = clean(pg?.extract || "");
    // ถูก redirect ไปบทความอื่นที่ไม่ใช่ที่นี่ (เช่น ซี ไลฟ์ → สยามพารากอน) → ไม่ใช้
    if (!text || (j.query?.redirects?.length && name && !text.replace(/\s+/g, "").toLowerCase().includes(nameCore(name)))) return null;
    return { type: "wiki", label: `Wikipedia (${m[1]})`, link: url, text };
  } catch { return null; }
}
async function voyageSource(p) {
  const en = nameOf(p).en;
  if (!en || en.length < 5) return null;
  try {
    const api = "https://en.wikivoyage.org/w/api.php";
    const s = await (await fetch(`${api}?action=query&list=search&srlimit=3&format=json&srsearch=${encodeURIComponent(`"${en}"`)}`, { headers: { "User-Agent": BOT }, signal: AbortSignal.timeout(15000) })).json();
    for (const hit of s.query?.search || []) {
      await sleep(400);
      const w = await (await fetch(`${api}?action=parse&prop=wikitext&format=json&page=${encodeURIComponent(hit.title)}`, { headers: { "User-Agent": BOT }, signal: AbortSignal.timeout(15000) })).json();
      const wt = w.parse?.wikitext?.["*"] || "";
      const key = en.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(" ").filter(x => x.length > 2).slice(0, 3);
      const line = wt.split("\n").find(l => /\{\{\s*(see|do|eat|drink|buy|listing|sleep)\b/i.test(l) && key.every(k => l.toLowerCase().includes(k)));
      if (line) return { type: "voyage", label: `Wikivoyage · ${hit.title}`, link: `https://en.wikivoyage.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`, text: clean(line.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/'''?/g, "")).slice(0, 1500) };
    }
  } catch {}
  return null;
}

async function gather(p) {
  const n = nameOf(p), srcs = [];
  const url = site(p);
  if (url) { const w = await websiteSource(url); if (w) srcs.push(w); }
  for (const l of ["th", "en"]) { const w = await wikiSource(p.wiki?.[l], l === "th" ? n.th : n.en); if (w) srcs.push({ ...w, id: "WP" + (srcs.filter(x => x.type === "wiki").length + 1) }); }
  const v = await voyageSource(p); if (v) srcs.push({ ...v, id: "WV" });
  // โพสต์รีวิว: ไลก์มากก่อน แต่ไม่เอาคนเดิมซ้ำ (ต้องเป็นคนละคนถึงนับเป็นคนละแหล่ง)
  const posts = postsOf(p).sort((a, b) => (b.likes || 0) - (a.likes || 0));
  const authors = new Set();
  let poi = null, k = 0;
  for (const x of posts) {
    if (k >= POSTS_PER) break;
    await sleep(900);
    const r = await postText(x.link);
    if (!r) continue;
    const who = r.author || (x.link.match(/@([^/]+)\//) || [])[1] || x.source;
    if (authors.has(who)) continue;
    authors.add(who); k++;
    srcs.push({ id: "L" + k, type: "lemon8", label: x.source || "Lemon8", link: x.link, likes: x.likes || 0, date: x.date, author: who, text: r.text });
    if (r.poi && !poi && sameName(r.poi.name, n.th || n.en)) poi = r.poi;
  }
  if ((poi || p.l8poi) && k < POSTS_PER + 2) {
    await sleep(900);
    for (const o of await poiPosts(poi?.id || p.l8poi)) {
      if (k >= POSTS_PER + 2) break;
      if (srcs.some(s => s.link === o.link) || authors.has(o.author)) continue;
      authors.add(o.author); k++;
      srcs.push({ id: "L" + k, type: "lemon8", label: o.source, link: o.link, likes: o.likes, author: o.author, text: o.text });
    }
  }
  return srcs;
}

// ---------- ตรวจข้อมูลจริงกับข้อความต้นทาง ----------
const flat = s => String(s || "").toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
const FEE_WORD = /บัตร|ค่าเข้า|ตั๋ว|ราคา|ผู้ใหญ่|เด็ก|คนละ|ท่านละ|ticket|admission|entry|entrance|price|adult|child|฿|บาท|thb|baht/;
// ตัวเลขราคานี้อยู่ในข้อความ (ใกล้คำเรื่องราคา) ไหม
const priceIn = (text, n) => { const t = flat(text); for (const m of t.matchAll(new RegExp(`(?<![\\d.])${n}(?![\\d])`, "g"))) if (FEE_WORD.test(t.slice(Math.max(0, m.index - 50), m.index + 30))) return true; return false; };
// เวลาเปิด-ปิดนี้อยู่ในข้อความไหม (10:00 = 10.00 / 10:00 / 10 โมง / 10am · 20:00 = 8pm / 8 pm)
function timeIn(text, hhmm) {
  const t = flat(text), [h, mm] = hhmm.split(":").map(Number);
  const hs = [...new Set([h, h % 12 || 12, h === 24 ? 0 : h])];
  return hs.some(x => new RegExp(`(?<!\\d)0?${x}\\s*[:.]\\s*${String(mm).padStart(2, "0")}(?!\\d)`).test(t)
    || (mm === 0 && new RegExp(`(?<!\\d)0?${x}\\s*(?:am|pm|a\\.m|p\\.m|โมง|น\\.)`).test(t)));
}
const is24 = text => /24\s*(?:ชั่วโมง|ชม\.?|hours?|hrs?|\/7)|ตลอด\s*24|open 24/i.test(text);
// แหล่งที่เป็นอิสระต่อกัน: เว็บไซต์ = 1, วิกิ = 1, Wikivoyage = 1, Lemon8 = 1 ต่อผู้โพสต์
const indep = list => new Set(list.map(s => s.type === "lemon8" ? "L:" + s.author : s.type)).size;
function supportOf(srcs, cited, test) {
  const byId = new Map(srcs.map(s => [s.id, s]));
  const fromCited = [].concat(cited || []).map(id => byId.get(String(id))).filter(s => s && test(s.text));
  // AI อ้างแหล่งไม่ครบ → นับแหล่งอื่นที่มีค่าเดียวกันด้วย
  const others = srcs.filter(s => !fromCited.includes(s) && test(s.text));
  return [...fromCited, ...others];
}
// ราคาเมนูอยู่ในข้อความ: ตัวเลขนี้ + (ชื่อเมนูอยู่ใกล้ๆ หรือมีคำว่า บาท/฿/.-)
function menuPriceIn(text, n, keys) {
  const t = flat(text);
  for (const m of t.matchAll(new RegExp(`(?<![\\d.])${n}(?![\\d])`, "g"))) {
    const near = t.slice(Math.max(0, m.index - 60), m.index + 20);
    if (/บาท|฿|thb|baht|\.-|ราคา|price/.test(near) || keys.some(k => near.includes(k))) return true;
  }
  return false;
}
const verified = sup => sup.some(s => s.type === "web") || indep(sup) >= 2;
const srcTag = sup => sup.some(s => s.type === "web") ? "web" : "reviews";
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)";
const RULE = new RegExp(`^(?:${DAY}(?:\\s*-\\s*${DAY})?(?:\\s*,\\s*${DAY}(?:\\s*-\\s*${DAY})?)*\\s+)?(?:off|closed|\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}(?:\\s*,\\s*\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2})*)$`);
const hoursOk = h => { const s = String(h || "").trim(); return s && s.length <= 160 && (s === "24/7" || s.split(/\s*;\s*/).filter(Boolean).every(r => RULE.test(r))) ? s.replace(/\s*;\s*/g, "; ") : null; };
const L3 = (o, max = 60) => { const r = {}; for (const l of ["th", "en", "zh"]) if (typeof o?.[l] === "string" && o[l].trim()) r[l] = o[l].trim().slice(0, max); return r.th || r.en ? r : null; };

function checkFacts(r, srcs, kind) {
  const facts = {}, log = [];
  // เวลาเปิด-ปิด: ทุกเวลาในค่าต้องพบในแหล่ง
  const h = hoursOk(r.hours?.value);
  if (h) {
    const times = h === "24/7" ? [] : [...h.matchAll(/\d{1,2}:\d{2}/g)].map(m => m[0]);
    const sup = supportOf(srcs, r.hours.src, t => h === "24/7" ? is24(t) : times.every(x => timeIn(t, x)));
    if (verified(sup)) facts.hours = { value: h, src: srcTag(sup), n: indep(sup), ids: sup.map(s => s.id) };
    else log.push(`เวลา ${h} (พบใน ${sup.map(s => s.id).join(",") || "ไม่มีแหล่ง"})`);
  }
  // ค่าเข้า: ตรวจทีละราคา · มีราคาจากเว็บไซต์ทางการ → ใช้เฉพาะชุดทางการ
  if (!MENU_KINDS.has(kind) || kind === "animalcafe") {
    const tiers = [];
    for (const x of [].concat(r.entry?.tiers || [])) {
      const price = Math.round(+x?.price);
      const who = L3(x?.who, 50);
      if (!(price > 0 && price <= 20000) || !who) continue;
      const sup = supportOf(srcs, x.src, t => priceIn(t, price));
      if (verified(sup)) tiers.push({ who, note: L3(x.note, 70) || undefined, price, web: sup.some(s => s.type === "web"), n: indep(sup), ids: sup.map(s => s.id) });
      else log.push(`ค่าเข้า ${who.th || who.en} ${price} (พบใน ${sup.map(s => s.id).join(",") || "ไม่มีแหล่ง"})`);
    }
    // ราคาทางการก่อน + ราคาจากรีวิว (ยืนยัน ≥ 2 แหล่ง) ที่ไม่ซ้ำราคาทางการ (เว็บมักบอกแค่ "เริ่มต้น")
    const official = tiers.filter(x => x.web);
    const use = [...official, ...tiers.filter(x => !x.web && !official.some(o => o.price === x.price)).map(x => ({ ...x, rv: true }))].slice(0, 8);
    // ไม่เอาราคาซ้ำ (ประเภทเดียวกัน ราคาเดียวกัน)
    const uniq = [...new Map(use.map(x => [`${x.who.th || x.who.en}|${x.price}`, x])).values()].sort((a, b) => (a.rv ? 1 : 0) - (b.rv ? 1 : 0) || a.price - b.price);
    if (uniq.length) facts.entry = { tiers: uniq.map(({ web, ...x }) => x), src: official.length ? "web" : "reviews" };
    else if (r.entry?.free === true) {
      const sup = supportOf(srcs, r.entry.freeSrc, t => /ฟรี|ไม่เสียค่า|ไม่มีค่าเข้า|free (?:entry|admission|of charge)|no (?:entry|admission) fee|admission(?: is)? free/i.test(t));
      if (verified(sup)) facts.entry = { free: true, src: srcTag(sup), n: indep(sup), ids: sup.map(s => s.id) };
      else log.push("เข้าฟรี (ยืนยันไม่ได้)");
    }
  }
  // ราคาเมนู (คาเฟ่/ร้านอาหาร/บาร์): ตรวจทีละเมนู — ราคาต้องอยู่ในข้อความของแหล่งที่อ้าง ใกล้ชื่อเมนูหรือคำว่า บาท/฿/.-
  // ช่วงราคา = จากเมนูที่ผ่านการตรวจ · ต้องมาจากเมนูบนเว็บไซต์ทางการ หรือรวมแล้วจาก ≥ 2 แหล่งที่เป็นอิสระ และอย่างน้อย 2 เมนู
  if (MENU_KINDS.has(kind)) {
    const ok = [];
    for (const it of [].concat(r.menu?.items || [])) {
      const price = Math.round(+it?.price), name = L3(it?.name, 40);
      if (!(price >= 10 && price <= 5000) || !name) continue;
      const keys = [name.th, name.en].filter(Boolean).flatMap(x => String(x).toLowerCase().split(/\s+/)).filter(w => w.length >= 3);
      const sup = supportOf(srcs, it.src, t => menuPriceIn(t, price, keys));
      if (sup.length) ok.push({ name, price, sup });
      else log.push(`เมนู ${name.th || name.en} ${price}`);
    }
    const all_ = ok.flatMap(x => x.sup);
    // ยืนยันหลายแหล่ง/เว็บไซต์ → "reviews"/"web" · รีวิวเดียว แต่ราคาอยู่ในโพสต์จริง ≥ 2 เมนู → "review1" (แอพแสดง ≈ และบอกว่ามาจากรีวิว)
    if (ok.length >= 2) {
      const ps = ok.map(x => x.price).sort((a, b) => a - b);
      // ตัดราคาสุดโต่ง (เมนูพิเศษ/ชุดใหญ่) เมื่อมีหลายเมนู
      const q = f => ps[Math.min(ps.length - 1, Math.round(f * (ps.length - 1)))];
      const [a, b] = ps.length >= 5 ? [q(0.1), q(0.9)] : [ps[0], ps.at(-1)];
      facts.menu = { min: a, max: b, src: verified(all_) ? srcTag(all_) : "review1", n: indep(all_), items: ok.sort((x, y) => x.price - y.price).slice(0, 6).map(x => ({ name: x.name, price: x.price })) };
    } else if (ok.length) log.push(`ช่วงราคาเมนู (ยืนยันได้ ${ok.length} เมนู จาก ${indep(all_)} แหล่ง ไม่พอ)`);
  }
  return { facts, log };
}

// ---------- ถาม AI ----------
const prompt = group => `You are building an accurate travel guide for places in Thailand. For each place you get SEVERAL SOURCES (official website "W", Wikipedia "WP…", Wikivoyage "WV", and real visitor reviews from Lemon8 "L1…"). Read ALL sources together.

1) Write a review summary IN YOUR OWN WORDS that combines what all sources say (do not copy sentences). Only use what the sources say about THIS place — no outside knowledge, no guessing. If sources contradict each other, prefer the official website, then the most recent and most repeated information. If the sources are not about this place at all, return "skip": true.
2) Extract FACTS with the ids of the sources that state them:
 - "hours": {"value": OpenStreetMap opening_hours e.g. "Mo-Su 10:00-20:00", "Tu-Su 09:00-17:00; Mo off", "24/7", "src": ["W","L2"]} or null
 - "entry": admission fee. List EVERY ticket type the sources give (adult, child, Thai citizen, foreigner, senior, online/early-bird, walk-in, combo/package…) as separate tiers:
   {"free": true/false/null, "freeSrc": [ids], "tiers": [{"who": {"th","en","zh"} e.g. {"th":"ผู้ใหญ่ (ซื้อออนไลน์)","en":"Adult (online)","zh":"成人（网上购票）"}, "price": number in baht exactly as written, "note": {"th","en","zh"} or null (e.g. height limit, weekday only, includes X), "src": [ids]}]}
   Thai attractions often have several prices: Thai vs foreigner, adult vs child (by age or height, e.g. "เด็กสูง 90-120 ซม."), student, senior (60+), free for small children/monks/disabled — give each as its own tier, and put age/height limits in "note". Read every source (website, reviews, comments, on-image text): different sources often list different ticket types.
   Use the price exactly as written in a source. Do NOT include parking, food, souvenirs, temporary discount codes or promotions that have ended. null if no source states a price.
 - "menu": for cafes/restaurants/bars ONLY: menu items with prices that the sources state, from as many different sources and reviewers as possible (drinks, desserts, main dishes, set menus, buffet per person) — read menu photos' on-image text too:
   {"items": [{"name": {"th","en"}, "price": number in baht exactly as written, "src": [ids]}]} (up to 12 items) or null
Return JSON {"results":[{"id","skip"?,
 "summary": {"th": 1-2 sentences (≤ 140 chars), "en", "zh"},
 "highlights": {"th": [≤ 4 items, ≤ 45 chars each], "en": [...], "zh": [...]},
 "mustTry": {"th": [things to do/eat the sources recommend ≤ 4], "en", "zh"},
 "tips": {"th": [≤ 4 practical tips: best time, booking, parking, how to get tickets cheaper, show/feeding times, what to bring], "en", "zh"},
 "cons": {"th": [≤ 3 things to know / downsides], "en", "zh"},
 "goodFor": tags from ${JSON.stringify(GOOD_FOR)} that the sources clearly support (≤ 4),
 "hours", "entry", "menu"}]}
Thai text must be natural Thai. Keep it concise.
Places: ${JSON.stringify(group.map(({ p, srcs }) => ({ id: p.id, name: nameOf(p).th || nameOf(p).en, name_en: nameOf(p).en, type: p.kind, sources: srcs.map(s => ({ id: s.id, kind: s.type, ...(s.date ? { date: s.date } : {}), text: s.text })) })))}`;

const L = (v, n, max) => { const r = {}; for (const l of ["th", "en", "zh"]) r[l] = [].concat(v?.[l] || []).filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, max)).slice(0, n); return r; };
let asked = 0, fails = 0, done = 0, factN = { hours: 0, entry: 0, menu: 0 }, rejected = 0;
// Gemini อ่านได้ยาว → ถามทีละ 4 สถานที่ (ประหยัดโควต้า) · GitHub Models (อ่านได้สั้น) ทีละ 1
// รวบรวมแหล่งของทั้งกลุ่มพร้อมกัน (เร็วขึ้น ~4 เท่า)
let i = 0;
while (i < todo.length && (SHOW || (aiAvailable() && asked < AI_MAX && fails < 3 && Date.now() - T0 < MINUTES * 60000))) {
  const size = SHOW ? 1 : aiName() === "Gemini" ? 4 : 1;
  const batch = todo.slice(i, i + size); i += size;
  const gathered = await Promise.all(batch.map(async p => ({ p, srcs: await gather(p) })));
  const group = [];
  for (const { p, srcs } of gathered) {
    if (SHOW) { console.log(`\n=== ${nameOf(p).th} (${p.id}) · ${srcs.length} แหล่ง`); for (const s of srcs) console.log(`--- ${s.id} ${s.label} ${s.link}\n${s.text.slice(0, 900)}`); continue; }
    if (srcs.length) group.push({ p, srcs });
    else cache[p.id] = { v: VERSION, sig: sig(p), at: new Date().toISOString(), skip: true, n: 0 };
  }
  if (SHOW || !group.length) continue;
  try {
    const out = await aiJSON(prompt(group), { temperature: 0.2 });
    asked++;
    for (const g of group) {
      const r = (out?.results || []).find(x => x.id === g.p.id);
      const sources = g.srcs.map(s => ({ id: s.id, type: s.type, source: s.label, link: s.link, ...(s.likes ? { likes: s.likes } : {}) }));
      const base = { v: VERSION, mv: MENU_V, sig: sig(g.p), at: new Date().toISOString(), n: g.srcs.length, src: sources };
      if (!r || r.skip) { cache[g.p.id] = { ...base, skip: true }; continue; }
      const { facts, log } = checkFacts(r, g.srcs, g.p.kind);
      for (const k of Object.keys(facts)) factN[k]++;
      rejected += log.length;
      if (log.length) console.log(`  ✗ ${nameOf(g.p).th}: ไม่ผ่านการตรวจ → ไม่ใช้: ${log.join(" · ")}`);
      cache[g.p.id] = {
        ...base,
        summary: L3(r.summary, 180) || { th: "" },
        highlights: L(r.highlights, 4, 60), mustTry: L(r.mustTry, 4, 60), tips: L(r.tips, 4, 110), cons: L(r.cons, 3, 100),
        goodFor: [].concat(r.goodFor || []).filter(x => GOOD_FOR.includes(x)).slice(0, 4),
        facts
      };
      done++;
    }
    await sleep(4000);
  } catch (e) { fails++; console.warn("AI สรุปรีวิวไม่ได้:", e.message.slice(0, 160)); }
}
if (SHOW) process.exit(0);
// ยังเหลือสถานที่ที่ต้องตรวจ และ AI ยังใช้ได้ → บอก GitHub Actions ให้รันรอบต่อไปเลย
const left = todo.length - i;
console.log(`เหลือรอตรวจ ${left} แห่ง`);
if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `more=${left > 0 && aiAvailable() && fails < 3 ? "true" : "false"}
left=${left}
`, { flag: "a" });

const live = new Set(all.map(p => p.id));
for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
await save("data/place-reviews.json", JSON.stringify(cache) + "\n");
console.log(`ถาม AI ${asked} ครั้ง · สรุปใหม่ ${done} แห่ง · ข้อมูลที่ผ่านการตรวจ: เวลาเปิด ${factN.hours} · ค่าเข้า ${factN.entry} · เมนู ${factN.menu} · ไม่ผ่าน (ไม่ใช้) ${rejected} ค่า · มีสรุปทั้งหมด ${Object.values(cache).filter(c => c.summary?.th).length} แห่ง`);
