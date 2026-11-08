// รายละเอียดอีเว้นท์แบบอ่านแล้วรู้เรื่อง: เปิดหน้าอีเว้นท์ต้นทาง → AI สรุปจากข้อความในหน้านั้นเท่านั้น
//   - อีเว้นท์นี้คืออะไร มีอะไรให้ทำ/ดู เหมาะกับใคร (2–4 ประโยค)
//   - ใครมาบ้าง: ศิลปิน นักร้อง ดารา นักแสดง ดีเจ วิทยากร แขกรับเชิญ (เฉพาะชื่อที่หน้าเว็บระบุ)
//   - ไฮไลต์ · หมวดที่ถูกต้อง (แยก สัมมนา/เวิร์กช็อป และ งานแสดงสินค้า/นิทรรศการ)
// ผลจำไว้ใน data/event-details.json แล้วใส่ให้อีเว้นท์ทุกรอบ (ข้อมูลอีเว้นท์ถูกสร้างใหม่ทุกวัน)
// รัน หลัง scripts/ai-review.mjs · node scripts/event-details.mjs [--limit 50] [--ai 12]
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const UA = "Mozilla/5.0 (compatible; IYouAloneBot/1.0; +https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const LIMIT = arg("--limit", 120), AI_MAX = arg("--ai", 20), PER_ASK = 6;
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const win = {}; new Function("window", await readFile(new URL("js/config.js", root), "utf8"))(win);
const CATS = win.APP_CONFIG.categories.map(c => c.id);
// กฎจัดหมวดที่หลง (ไฟล์เดียวกับที่แอพใช้)
new Function("window", await readFile(new URL("js/categorize.js", root), "utf8"))(win);

const data = await readJSON("data/auto-events.json", null);
if (!data?.events) { console.error("อ่าน data/auto-events.json ไม่ได้"); process.exit(1); }
const manual = await readJSON("data/events.json", []);
const cache = await readJSON("data/event-details.json", {});
const sig = ev => createHash("sha1").update([ev.title, ev.startDate].join("|")).digest("hex").slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

// ---------- ข้อความในหน้าอีเว้นท์ ----------
const decode = s => String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&ndash;|&mdash;/g, "–").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const JUNK = /^(home|login|sign ?in|sign ?up|menu|search|share|follow|cookie|privacy|terms|copyright|©|all rights|download|app store|google play|เข้าสู่ระบบ|สมัครสมาชิก|ค้นหา|หน้าแรก|แชร์|ติดตาม)/i;
async function pageText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "th,en;q=0.8" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return "";
  const html = (await res.text()).slice(0, 900000);
  const meta = p => decode((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`, "i")) || [])[1] || "");
  // คำอธิบายใน schema.org (มักเป็นรายละเอียดเต็ม)
  const ld = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(m => { try { return JSON.parse(m[1]); } catch { return null; } })
    .flat().filter(Boolean).map(x => [].concat(x["@graph"] || x)).flat().map(x => typeof x.description === "string" ? x.description : "").sort((a, b) => b.length - a.length)[0] || "";
  const body = (html.match(/<(main|article)[\s\S]*<\/\1>/i)?.[0] || html)
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n").replace(/<[^>]+>/g, " ");
  const lines = decode(body).split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(s => s.length >= 3 && !JUNK.test(s));
  const uniq = [...new Set(lines)];
  return `${meta("og:title")}\n${meta("og:description")}\n${decode(ld).slice(0, 2500)}\n${uniq.join("\n")}`.replace(/\n{2,}/g, "\n").slice(0, 4500);
}

// ---------- ถาม AI ----------
const todo = data.events.filter(ev => (ev.ticketUrl || ev.sourceUrl) && (cache[ev.id]?.sig !== sig(ev) || (cache[ev.id]?.about?.th && !cache[ev.id].about.zh)) && (ev.endDate || ev.startDate) >= today)
  .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).slice(0, aiAvailable() ? LIMIT : 0);
console.log(`อีเว้นท์ ${data.events.length} · มีรายละเอียดแล้ว ${Object.keys(cache).length} · รอบนี้ ${todo.length} · AI: ${aiName()}`);
const withText = [];
for (const ev of todo) {
  await sleep(1200);
  let text = "";
  try { text = await pageText(ev.ticketUrl || ev.sourceUrl); } catch {}
  if (text.length >= 200) withText.push({ ev, text });
  else cache[ev.id] = { sig: sig(ev), at: today, none: true };
}
let asked = 0, fails = 0, done = 0;
const L = (v, n, max) => [].concat(v || []).filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, max)).slice(0, n);
for (let i = 0; i < withText.length && asked < AI_MAX && fails < 3; i += PER_ASK) {
  const group = withText.slice(i, i + PER_ASK);
  const prompt = `You write event details for a Thai event app (users: Thai teens and young adults). Read the page text given for each event, understand it, then SUMMARIZE IT IN YOUR OWN WORDS — like a friend explaining the event. Do NOT copy or translate sentences from the page word for word, do not paste marketing slogans, hashtags, emoji lists, ticket rules or long schedules. Use ONLY facts from the page text. Never invent people, dates, prices or activities.
For each event return:
- "about": {"th": a 3–5 sentence summary in casual, natural Thai written by you (not copied): 1) what kind of event this is and its theme, 2) what actually happens / what you can do, see, eat, learn or win, 3) who it suits (e.g. families, students, fans of X, beginners), 4) anything notable (big names, first time in Thailand, free, limited seats). "en": same in English, "zh": same in Simplified Chinese}
- "people": performers and key people explicitly named in the text — artists, singers, bands, actors/actresses, celebrities, influencers, DJs, speakers, hosts, special guests, chefs, athletes. [{"name": as written (keep original spelling), "role": {"th": short role e.g. "ศิลปิน", "นักร้อง", "นักแสดง", "ดีเจ", "วิทยากร", "พิธีกร", "แขกรับเชิญ", "เชฟ", "en": ..., "zh": ...}}] max 12, [] if none. Do not list organizers/companies/sponsors as people.
- "highlights": {"th": [≤ 5 short points in your own words: what's included / special activities / why go — no copied slogans], "en": [...], "zh": [...]}
- "category": one of ${JSON.stringify(CATS)} — "festival" = traditional/seasonal festivals (Loy Krathong, Songkran, temple fairs, countdown), "social" = speed dating/singles/matchmaking/meet-new-friends clubs, "seminar" = talks/seminars/conferences (people listen), "learning" = workshops/courses/classes (hands-on), "expo" = trade/consumer fairs & expos, "exhibition" = art/museum/photo/immersive exhibitions, "concert" = concerts/music festivals (non-Korean), "kpop" = ONLY live events with Korean (K-pop) artists or Korean actors: concerts, fancons, fan meetings, fansigns, showcases (NOT pop-up stores/merch shops); "exhibition" also covers pop-up stores, merch shops and character/artist theme cafés; "market" = flea/night/craft/vintage/art-toy/Christmas markets, OTOP & community-product fairs, Red Cross fairs (people shop at many stalls); "fanmeet" = fan meetings, fancons, fansigns, fan screenings (non-Korean); "show" = musicals, stage plays, ballet, circus, comedy/magic shows; "run" = running events (marathon, fun run, trail run); "outdoor" = other sports (muay thai/fights, cycling, triathlon, fitness, yoga); "nightlife" = DJ/bar/club/party.
Return JSON {"results":[{"id","about","people","highlights","category"}]}
Events: ${JSON.stringify(group.map(({ ev, text }) => ({ id: ev.id, title: ev.title, category_now: ev.category, page: text })))}`;
  try {
    const out = await aiJSON(prompt, { temperature: 0.2 });
    asked++;
    for (const { ev } of group) {
      const r = (out?.results || []).find(x => x.id === ev.id);
      if (!r) continue;
      cache[ev.id] = {
        sig: sig(ev), at: today,
        about: { th: String(r.about?.th || "").trim().slice(0, 900), en: String(r.about?.en || "").trim().slice(0, 1000), zh: String(r.about?.zh || "").trim().slice(0, 600) },
        people: [].concat(r.people || []).filter(p => typeof p?.name === "string" && p.name.trim().length >= 2).slice(0, 12)
          .map(p => ({ name: p.name.trim().slice(0, 60), role: { th: String(p.role?.th || "").slice(0, 30), en: String(p.role?.en || "").slice(0, 30), zh: String(p.role?.zh || "").slice(0, 20) } })),
        highlights: { th: L(r.highlights?.th, 5, 90), en: L(r.highlights?.en, 5, 110), zh: L(r.highlights?.zh, 5, 60) },
        category: CATS.includes(r.category) ? r.category : undefined
      };
      done++;
    }
    await sleep(4000);
  } catch (e) { fails++; console.warn("AI สรุปอีเว้นท์ไม่ได้:", e.message.slice(0, 160)); }
}

// ---------- ใส่ผลให้อีเว้นท์ทุกตัว ----------
let applied = 0, splitN = 0;
for (const ev of [...data.events, ...manual]) {
  const c = cache[ev.id];
  if (c && c.sig === sig(ev) && !c.none) {
    if (c.about?.th) { ev.details = c.about.th; ev.aiDetails = true; ev.i18n = ev.i18n || {}; for (const l of ["en", "zh"]) if (c.about[l]) ev.i18n[l] = { ...(ev.i18n[l] || {}), details: c.about[l] }; }
    if (c.highlights?.th?.length) { ev.highlights = c.highlights.th; ev.i18n = ev.i18n || {}; for (const l of ["en", "zh"]) if (c.highlights[l]?.length) ev.i18n[l] = { ...(ev.i18n[l] || {}), highlights: c.highlights[l] }; }
    if (c.people?.length) ev.people = c.people;
    if (c.category) ev.category = c.category;
    applied++;
  }
  const s = win.IYA_fixCategory(ev);
  if (s === null) ev.hidden = true;
  else if (s !== ev.category) { ev.category = s; splitN++; }
}
const live = new Set(data.events.map(e => e.id));
for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
await save("data/event-details.json", JSON.stringify(cache) + "\n");
await save("data/auto-events.json", JSON.stringify(data, null, 2) + "\n");
await save("data/events.json", JSON.stringify(manual, null, 2) + "\n");
console.log(`ถาม AI ${asked} ครั้ง · สรุปใหม่ ${done} · ใส่รายละเอียด ${applied} อีเว้นท์ · แยกหมวดสัมมนา/นิทรรศการ ${splitN}`);
const cats = data.events.reduce((m, e) => (m[e.category] = (m[e.category] || 0) + 1, m), {});
console.log("หมวด:", JSON.stringify(cats));
