// เวลาเปิด-ปิด + ค่าเข้า + ช่วงราคาเมนู ให้ครบทุกสถานที่ (ฟรีทั้งหมด) → เติมเฉพาะช่องที่ยังว่าง ลง data/places.json + data/trend-places.json
// ลำดับความน่าเชื่อถือ (ที่มาแสดงในแอพ):
//   1) OpenStreetMap / เจ้าของร้าน / รีวิว Lemon8 (มีอยู่แล้วจากสคริปต์อื่น — ไม่ทับ)
//   2) web: เว็บไซต์ทางการของสถานที่ (ข้อมูล schema.org ในหน้าเว็บ หรือ AI อ่านข้อความในหน้าเว็บ — เฉพาะที่เขียนไว้ชัด)
//   3) review: AI อ่านจากโพสต์รีวิวจริง (เก็บไว้ใน data/place-reviews.json โดย place-reviews.mjs)
//   4) ai: ความรู้ทั่วไปของ AI เฉพาะสถานที่ที่มีชื่อเสียง/ข้อมูลทางการเป็นที่รู้กัน (AI ต้องมั่นใจ ไม่งั้น null)
//   5) typical: ค่าทั่วไปตามประเภท (ชายหาด/จุดชมวิว/ตลาด = ฟรี, วัด = ส่วนใหญ่ฟรี, อุทยานแห่งชาติ = อัตรากรมอุทยานฯ ทั่วไป)
// ผลจำไว้ใน data/place-info.json (ตรวจใหม่ทุก 90 วัน) · node scripts/place-info.mjs [--web 150] [--ai 30]
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const WEB_MAX = arg("--web", 150), AI_MAX = arg("--ai", 30), REFRESH = 90;
const MENU_KINDS = new Set(["cafe", "animalcafe", "restaurant", "nightlife"]);
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const days = t => (Date.now() - new Date(t || 0)) / 864e5;
const now = () => new Date().toISOString().slice(0, 10);

const data = await readJSON("data/places.json", null);
if (!data?.places) { console.error("ไม่มี data/places.json"); process.exit(1); }
const trendPl = await readJSON("data/trend-places.json", []);
const reviews = await readJSON("data/place-reviews.json", {});
const cache = await readJSON("data/place-info.json", {});
// เวลาเปิด-ปิด/ค่าเข้า/ช่วงราคาที่ผู้รีวิวเขียนไว้ในโพสต์ Lemon8 (place-lemon8.mjs อ่านจากข้อความ เก็บใน data/place-posts/NN.json → info)
const l8info = {};
for (let i = 0; i < 32; i++) for (const [id, e] of Object.entries(await readJSON(`data/place-posts/${String(i).padStart(2, "0")}.json`, {}))) if (e?.info) l8info[id] = e.info;
const all = [...data.places, ...trendPl];
const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
const provTh = id => win.PROVINCES.find(p => p.id === id)?.th || id;

// ---------- ตรวจค่า ----------
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)";
const RULE = new RegExp(`^(?:${DAY}(?:\\s*-\\s*${DAY})?(?:\\s*,\\s*${DAY}(?:\\s*-\\s*${DAY})?)*\\s+)?(?:off|closed|\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2}(?:\\s*,\\s*\\d{1,2}:\\d{2}\\s*-\\s*\\d{1,2}:\\d{2})*)$`);
export const hoursOk = h => { const s = String(h || "").trim(); return s && s.length <= 160 && (s === "24/7" || s.split(/\s*;\s*/).filter(Boolean).every(r => RULE.test(r))) ? s.replace(/\s*;\s*/g, "; ") : null; };
const baht = n => Number.isFinite(+n) && +n >= 10 && +n <= 20000 ? Math.round(+n) : undefined;
const entryOk = e => e?.free === true ? { free: true } : baht(e?.min) && baht(e?.max) && e.min < e.max ? { min: baht(e.min), max: baht(e.max) } : (baht(e?.thai) || baht(e?.foreign)) ? JSON.parse(JSON.stringify({ thai: baht(e?.thai), foreign: baht(e?.foreign) })) : null;
const menuOk = m => { let a = baht(m?.min), b = baht(m?.max); a ??= b; b ??= a; if (!a) return null; if (a > b) [a, b] = [b, a]; return b <= 5000 ? { min: a, max: b } : null; };

// ---------- 2) เว็บไซต์ทางการ ----------
const SOCIAL = /facebook|fb\.com|fb\.me|instagram|line\.me|lin\.ee|tiktok|twitter|x\.com|youtube|google\.|goo\.gl|wongnai|tripadvisor|agoda|booking\.com|klook|linktr/i;
const DOW = { monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su", publicholidays: "PH" };
function fromLd(objs) {
  const out = {};
  const walk = o => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    if (o.openingHours && !out.hours) out.hours = hoursOk([].concat(o.openingHours).join("; "));
    if (o.openingHoursSpecification && !out.hours) {
      const rules = [].concat(o.openingHoursSpecification).map(s => {
        const d = [].concat(s.dayOfWeek || []).map(x => DOW[String(x).split("/").pop().toLowerCase()]).filter(Boolean);
        const hm = v => String(v || "").slice(0, 5);
        return d.length && /^\d{1,2}:\d{2}$/.test(hm(s.opens)) && /^\d{1,2}:\d{2}$/.test(hm(s.closes)) ? `${d.join(",")} ${hm(s.opens)}-${hm(s.closes)}` : null;
      });
      if (rules.length && rules.every(Boolean)) out.hours = hoursOk(rules.join("; "));
    }
    if (o.priceRange && !out.menu) { const n = String(o.priceRange).match(/\d{2,5}/g); if (n) out.menu = menuOk({ min: n[0], max: n[1] || n[0] }); }
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  };
  walk(objs);
  return out;
}
const KEY = /เวลาเปิด|เวลาทำการ|เปิดบริการ|เปิดให้บริการ|เปิดทุกวัน|ปิดทุกวัน|เวลา\s*\d|ค่าเข้า|ค่าบัตร|บัตรผ่านประตู|อัตราค่า|ราคาบัตร|ราคา|เมนู|opening hours|open(?:ing)? (?:daily|time|hours)|business hours|hours|admission|ticket|entrance fee|price|menu|฿|บาท/gi;
async function webInfo(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "th,en" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return null;
  const html = (await res.text()).slice(0, 600000);
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => { try { return JSON.parse(m[1].trim()); } catch { return null; } }).filter(Boolean);
  const got = fromLd(ld);
  const text = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#\d+;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
  // เฉพาะช่วงข้อความรอบคำว่า เวลาเปิด/ราคา/ค่าเข้า (ไม่ส่งทั้งหน้าให้ AI)
  const spans = [];
  for (const m of text.matchAll(KEY)) { const a = Math.max(0, m.index - 120), b = Math.min(text.length, m.index + 260); if (!spans.length || a > spans.at(-1)[1]) spans.push([a, b]); else spans.at(-1)[1] = b; }
  const excerpt = spans.map(([a, b]) => text.slice(a, b).trim()).join("\n…\n").slice(0, 2200);
  return { ...got, excerpt };
}

const need = p => ({ hours: !p.hours, entry: !MENU_KINDS.has(p.kind) || p.kind === "animalcafe" ? !p.entry && !p.fee : false, menu: MENU_KINDS.has(p.kind) && !p.menuPrice });
const needs = p => { const n = need(p); return n.hours || n.entry || n.menu; };
const site = p => [p.website].flat().find(u => /^https?:\/\//.test(u || "") && !SOCIAL.test(u));
const stale = (p, k) => !cache[p.id]?.[k] || days(cache[p.id][k].at) > REFRESH;
const put = (p, k, v) => { cache[p.id] = { ...(cache[p.id] || {}), [k]: { ...v, at: now() } }; };

const webTodo = all.filter(p => needs(p) && site(p) && stale(p, "web")).slice(0, WEB_MAX);
console.log(`สถานที่ ${all.length} · ยังขาดเวลาเปิด/ราคา ${all.filter(needs).length} · เปิดเว็บไซต์รอบนี้ ${webTodo.length} · AI: ${aiName()}`);
const forAI = [];
let webLd = 0;
for (const p of webTodo) {
  await sleep(600);
  let w = null;
  try { w = await webInfo(site(p)); } catch {}
  if (!w) { put(p, "web", {}); continue; }
  if (w.hours || w.menu) webLd++;
  put(p, "web", { hours: w.hours || undefined, menu: MENU_KINDS.has(p.kind) ? w.menu || undefined : undefined });
  const n = need(p);
  if (w.excerpt && ((n.hours && !w.hours) || n.entry || (n.menu && !w.menu))) forAI.push({ p, text: w.excerpt });
}
console.log(`เว็บไซต์: มีข้อมูล schema.org ${webLd} แห่ง · ส่งให้ AI อ่านข้อความ ${forAI.length} แห่ง`);

let asked = 0, fails = 0;
const ask = async prompt => { if (!aiAvailable() || asked >= AI_MAX || fails >= 3) return null; try { asked++; const r = await aiJSON(prompt, { temperature: 0 }); await sleep(4000); return r; } catch (e) { fails++; console.warn("AI:", e.message.slice(0, 140)); return null; } };
const FORMAT = `"hours": OpenStreetMap opening_hours format e.g. "Mo-Fr 09:00-18:00; Sa,Su 08:00-20:00", "Tu-Su 10:00-22:00; Mo off", "24/7" (closing after midnight like 18:00-02:00) or null;
"entry": admission fee for an adult: {"free": true} or {"thai": THB for Thai people, "foreign": THB for foreigners or null} or null;
"menu": only for cafés/restaurants/bars: typical food/drink price range {"min": THB, "max": THB} or null`;
for (let i = 0; i < forAI.length; i += 5) {
  const group = forAI.slice(i, i + 5);
  const out = await ask(`Extract opening hours and prices for each place in Thailand from text on ITS OWN official website. Use only what the text states explicitly for this place; never guess. Return per place:
${FORMAT}
Return JSON {"results":[{"id","hours","entry","menu"}]}
Places: ${JSON.stringify(group.map(({ p, text }) => ({ id: p.id, name: p.name?.th || p.name?.en, type: p.kind, text })))}`);
  if (!out) break;
  for (const r of out.results || []) {
    const g = group.find(x => x.p.id === r.id);
    if (!g) continue;
    const old = cache[r.id]?.web || {};
    put(g.p, "web", { hours: old.hours || hoursOk(r.hours) || undefined, entry: entryOk(r.entry) || undefined, menu: old.menu || (MENU_KINDS.has(g.p.kind) ? menuOk(r.menu) : null) || undefined });
  }
}

// ---------- 4) ความรู้ทั่วไปของ AI (เฉพาะที่มีชื่อเสียง: มีบทความ Wikipedia/Wikidata หรือเป็นกระแส หรือเป็นสถานที่ประเภทที่มีข้อมูลทางการ) ----------
const FAMOUS = p => p.wikidata || p.wiki || (p.fame || 0) >= 6 || (p.hot || 0) >= 5 || ["zoo", "themepark", "museum", "park"].includes(p.kind);
const known = all.filter(p => needs(p) && FAMOUS(p) && stale(p, "ai"))
  .sort((a, b) => (b.wikidata ? 5 : 0) + (b.fame || 0) + (b.hot || 0) - (a.wikidata ? 5 : 0) - (a.fame || 0) - (a.hot || 0));
for (let i = 0; i < known.length; i += 15) {
  const group = known.slice(i, i + 15);
  const out = await ask(`You know many well-known tourist attractions in Thailand. For each place below, give its regular opening hours and admission fee ONLY if you are confident from widely published official information (e.g. national parks' DNP fees, famous temples, zoos, theme parks, museums). If you are not sure about a place or a field, return null for it — wrong information is worse than none. Do not apply one place's info to another.
Per place:
${FORMAT}
"conf": "high" | "medium" | "low"
Return JSON {"results":[{"id","hours","entry","menu","conf"}]}
Places: ${JSON.stringify(group.map(p => ({ id: p.id, name: p.name?.th || p.name?.en, name_en: p.name?.en, type: p.kind, area: [p.district, provTh(p.province)].filter(Boolean).join(", ") })))}`);
  if (!out) break;
  for (const p of group) put(p, "ai", {}); // ถามแล้ว (ไม่ถามซ้ำจนครบ 90 วัน)
  for (const r of out.results || []) {
    const p = group.find(x => x.id === r.id);
    if (!p || !["high", "medium"].includes(r.conf)) continue;
    put(p, "ai", { conf: r.conf, hours: hoursOk(r.hours) || undefined, entry: entryOk(r.entry) || undefined, menu: MENU_KINDS.has(p.kind) ? menuOk(r.menu) || undefined : undefined });
  }
}

// ---------- 5) ค่าทั่วไปตามประเภท ----------
const nm = p => `${p.name?.th || ""} ${p.name?.en || ""}`;
function typical(p) {
  const n = nm(p);
  if (p.kind === "nature" && /หาด|ชายหาด|beach/i.test(n) && !/เกาะ|island|อุทยาน/i.test(n)) return { entry: { free: true }, hours: "24/7" };
  if (p.kind === "nature" && /จุดชมวิว|view ?point|ชมวิว/i.test(n)) return { entry: { free: true } };
  if (/ตลาด|market|ถนนคนเดิน|walking street/i.test(n)) return { entry: { free: true } };
  if (p.kind === "landmark" && /^\s*(วัด|wat\b)/i.test(n)) return { entry: { free: true }, hours: "08:00-17:00" };
  if (p.kind === "park" && /อุทยานแห่งชาติ|national park/i.test(n)) return { entry: { thai: 40, foreign: 200 }, hours: "08:00-18:00" };
  if (/สวนสาธารณะ|public park/i.test(n)) return { entry: { free: true }, hours: "05:00-21:00" };
  return null;
}

// ---------- ใส่ลงข้อมูล (เฉพาะช่องว่าง) ----------
const stat = { web: 0, review: 0, ai: 0, typical: 0 };
for (const p of all) {
  // ล้างค่าที่สคริปต์นี้เคยใส่ (ให้ค่าจากแหล่งที่ดีกว่าที่มาทีหลังได้ทับ)
  if (p.hoursSrc) { delete p.hours; delete p.hoursSrc; }
  if (["web", "review", "ai", "typical"].includes(p.entry?.src)) delete p.entry;
  if (["web", "review", "ai", "typical"].includes(p.menuPrice?.src)) delete p.menuPrice;
  const rv = reviews[p.id] || {};
  const c = cache[p.id] || {};
  const li = l8info[p.id] || {};
  const srcs = [["web", c.web], ["review", { hours: hoursOk(rv.hours) || hoursOk(li.hours), entry: entryOk(rv.entry) || entryOk(li.entry), menu: menuOk(rv.menu) || menuOk(li.price) }], ["ai", c.ai], ["typical", typical(p)]];
  const n = need(p);
  for (const [src, v] of srcs) {
    if (!v) continue;
    if (n.hours && !p.hours && v.hours) { p.hours = v.hours; p.hoursSrc = src; stat[src]++; }
    if (n.entry && !p.entry && v.entry) { p.entry = { ...v.entry, src }; stat[src]++; }
    if (n.menu && !p.menuPrice && v.menu) { p.menuPrice = { ...v.menu, src }; stat[src]++; }
  }
}
const live = new Set(all.map(p => p.id));
for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
await save("data/place-info.json", JSON.stringify(cache) + "\n");
await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
await save("data/trend-places.json", JSON.stringify(trendPl, null, 1) + "\n");
const has = f => all.filter(f).length;
console.log(`เติมข้อมูล: เว็บไซต์ ${stat.web} · รีวิว ${stat.review} · AI ความรู้ทั่วไป ${stat.ai} · ค่าทั่วไปตามประเภท ${stat.typical} · ถาม AI ${asked} ครั้ง`);
console.log(`ตอนนี้มีเวลาเปิด ${has(p => p.hours)}/${all.length} · ค่าเข้า ${has(p => p.entry || p.fee)}/${has(p => !MENU_KINDS.has(p.kind) || p.kind === "animalcafe")} · ราคาเมนู ${has(p => p.menuPrice)}/${has(p => MENU_KINDS.has(p.kind))}`);
