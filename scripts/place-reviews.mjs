// สรุปรีวิวแต่ละสถานที่จากโพสต์รีวิวจริง (Lemon8) → data/place-reviews.json (แสดงในหน้ารายละเอียด "สรุปจากรีวิว")
// อ่านเนื้อโพสต์เต็ม (+ ตัวหนังสือบนรูป) ของโพสต์ที่พูดถึง/ปักหมุดสถานที่นั้น แล้วให้ AI สรุปด้วยคำของตัวเอง:
// จุดเด่น · ต้องลอง · เคล็ดลับ (ที่จอดรถ เวลาที่ดี การจอง) · ข้อควรรู้ · เหมาะกับ (แท็ก) — ไม่คัดลอกข้อความ, มีลิงก์ไปโพสต์ต้นฉบับ
// สรุปใหม่เมื่อมีโพสต์ใหม่หรือครบ 45 วัน · ไม่มี AI = ใช้ผลเดิม
// รัน หลัง scripts/trend-places.mjs · node scripts/place-reviews.mjs [--ai 25]
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
const AI_MAX = arg("--ai", 25), PER_ASK = 4, POSTS_PER = 4, REFRESH_DAYS = 45;
export const GOOD_FOR = ["photo", "work", "kids", "pets", "date", "group", "view", "nature", "chill", "budget", "night", "food"];
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const days = t => (Date.now() - new Date(t || 0)) / 864e5;

const data = await readJSON("data/places.json", { places: [] });
const trendPl = await readJSON("data/trend-places.json", []);
const cache = await readJSON("data/place-reviews.json", {});
const all = [...data.places, ...trendPl];
const sig = p => (p.posts || []).map(x => x.link).sort().join("|");

// สถานที่ที่มีโพสต์รีวิว: กระแสแรงก่อน, คาเฟ่/ร้าน/ที่บันเทิงก่อน
const FUN = new Set(["cafe", "animalcafe", "restaurant", "nightlife", "themepark", "zoo"]);
const todo = all.filter(p => p.posts?.length && (!cache[p.id] || cache[p.id].sig !== sig(p) && days(cache[p.id].at) > 7 || days(cache[p.id].at) > REFRESH_DAYS))
  .sort((a, b) => (b.hot || 0) + (FUN.has(b.kind) ? 5 : 0) - (a.hot || 0) - (FUN.has(a.kind) ? 5 : 0));
console.log(`สถานที่ที่มีโพสต์รีวิว ${all.filter(p => p.posts?.length).length} · สรุปแล้ว ${Object.keys(cache).length} · รอสรุป ${todo.length} · AI: ${aiName()}`);

// เนื้อโพสต์เต็มจากหน้าโพสต์ (HTML → ข้อความ)
async function postText(link) {
  try {
    const html = await (await fetch(link, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text();
    const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
    const ld = JSON.parse(decodeURIComponent(big))?.state?.loaderData || {};
    const a = Object.values(ld).flatMap(v => v && typeof v === "object" ? Object.entries(v) : []).find(([k]) => k.includes("ArticleDetail"))?.[1];
    if (!a) return null;
    const body = String(a.content || a.shortContent || "").replace(/<br\s*\/?>|<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
    const ocr = [].concat(Array.isArray(a.ocrText) ? a.ocrText : (() => { try { return JSON.parse(a.ocrText || "[]"); } catch { return [a.ocrText || ""]; } })()).join(" ").replace(/\s+/g, " ").trim();
    // คอมเมนต์ของคนที่ไปมาแล้ว (ประสบการณ์จริงเพิ่ม เช่น "คิวยาว", "จอดรถยาก") — ไลก์มากก่อน สูงสุด 6 อัน
    const cm = Object.values(ld).flatMap(v => v && typeof v === "object" ? Object.entries(v) : []).find(([k]) => k.includes("ArticleComments"))?.[1]?.items || [];
    const comments = cm.map(c => ({ t: String(c.text || "").replace(/\s+/g, " ").trim(), d: +c.diggCount || 0 })).filter(c => c.t.length >= 12)
      .sort((x, y) => y.d - x.d).slice(0, 6).map(c => c.t.slice(0, 140));
    const text = `${a.title}\n${body.slice(0, 1400)}${ocr ? `\n[ข้อความบนรูป] ${ocr.slice(0, 300)}` : ""}${comments.length ? `\n[คอมเมนต์] ${comments.join(" / ")}` : ""}`;
    return { text, poi: a.locationInfo?.poiId ? { id: String(a.locationInfo.poiId), name: a.locationInfo.poiName || "" } : null };
  } catch { return null; }
}

const norm = s => String(s || "").toLowerCase().replace(/คาเฟ่|ร้านกาแฟ|ร้าน|\b(cafe|café|coffee|shop|the)\b/g, "").replace(/[^ก-๙a-z0-9]/g, "");
const sameName = (a, b) => { const x = norm(a), y = norm(b); return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)); };
// รีวิวที่ปักหมุดสถานที่เดียวกัน (หน้า poi ของ Lemon8)
async function poiPosts(id) {
  try {
    const html = await (await fetch(`https://www.lemon8-app.com/poi/${id}?region=th`, { headers: { "User-Agent": UA, "Accept-Language": "th" }, signal: AbortSignal.timeout(20000) })).text();
    const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
    const ld = JSON.parse(decodeURIComponent(big))?.state?.loaderData?.["routes/poi.$poi_id"] || {};
    const items = Object.entries(ld).find(([k]) => k.startsWith("$PoiPost"))?.[1]?.items || [];
    return items.filter(o => o.groupId && o.title).sort((a, b) => (+b.articleLikes || 0) - (+a.articleLikes || 0)).map(o => {
      const au = [o, ...Object.values(o)].find(v => v && typeof v === "object" && v.linkName) || {};
      return { link: `https://www.lemon8-app.com/${au.linkName ? "@" + au.linkName + "/" : ""}${o.groupId}?region=th`, source: `Lemon8${au.nickName ? " · " + au.nickName : ""}`, likes: +o.articleLikes || 0, title: o.title, text: String(o.shortContent || "").slice(0, 600) };
    });
  } catch { return []; }
}

let asked = 0, fails = 0, done = 0;
for (let i = 0; i < todo.length && aiAvailable() && asked < AI_MAX && fails < 3; i += PER_ASK) {
  const group = [];
  for (const p of todo.slice(i, i + PER_ASK)) {
    const posts = [...p.posts].sort((a, b) => (b.likes || 0) - (a.likes || 0)).slice(0, POSTS_PER);
    const texts = [];
    let poi = null;
    for (const x of posts) {
      await sleep(1100);
      const r = await postText(x.link);
      if (!r) continue;
      texts.push(r.text);
      if (r.poi && !poi && sameName(r.poi.name, p.name?.th || p.name?.en)) poi = r.poi;
    }
    // โพสต์ปักหมุดร้านนี้ → หน้าสถานที่ใน Lemon8 มีรีวิวอื่นที่ปักหมุดที่เดียวกันอีก (เพิ่มสูงสุด 4 รีวิว)
    if (poi || p.l8poi) {
      await sleep(1100);
      for (const o of await poiPosts(poi?.id || p.l8poi)) {
        if (posts.length >= POSTS_PER + 4) break;
        if (posts.some(x => x.link === o.link)) continue;
        posts.push(o); texts.push(`${o.title}\n${o.text}`);
      }
    }
    if (texts.length) group.push({ p, posts, texts });
    else cache[p.id] = { ...(cache[p.id] || {}), sig: sig(p), at: new Date().toISOString() };
  }
  if (!group.length) continue;
  const prompt = `คุณสรุปรีวิวสถานที่ในประเทศไทยจากโพสต์ของผู้ใช้จริง สำหรับแอพแนะนำที่เที่ยวของวัยรุ่น
กฎ: ใช้เฉพาะข้อมูลที่อยู่ในรีวิวของสถานที่นั้นจริงๆ ห้ามเดา ห้ามใช้ความรู้ทั่วไป · เขียนด้วยคำของตัวเอง สั้น กระชับ (ไม่คัดลอกประโยคจากโพสต์) · ข้อมูลไหนไม่มีให้เป็น [] หรือ null
· ถ้าโพสต์พูดถึงหลายที่ ใช้เฉพาะส่วนที่เกี่ยวกับสถานที่ที่ระบุ · ถ้าข้อมูลไม่พอสรุป (ไม่เกี่ยวกับสถานที่นี้เลย) ให้ "skip": true
ต่อสถานที่ ส่ง:
- "summary": {"th": 1 ประโยค (≤ 90 ตัวอักษร) บอกว่าที่นี่เป็นยังไง, "en": same in English}
- "highlights": {"th": [จุดเด่น ≤ 4 ข้อ ข้อละ ≤ 40 ตัวอักษร], "en": [...]}
- "mustTry": {"th": [เมนู/กิจกรรมที่รีวิวแนะนำ ≤ 4], "en": [...]}
- "tips": {"th": [เคล็ดลับ ≤ 3 เช่น ที่จอดรถ เวลาที่ควรไป ต้องจองไหม ค่าใช้จ่าย], "en": [...]}
- "cons": {"th": [ข้อควรรู้/ข้อเสียที่รีวิวบอก ≤ 2], "en": [...]}
- "goodFor": แท็กจาก ${JSON.stringify(GOOD_FOR)} เฉพาะที่รีวิวสื่อชัด (≤ 4) (photo=มุมถ่ายรูป, work=นั่งทำงาน, kids=พาเด็ก, pets=พาสัตว์เลี้ยงไปได้/มีสัตว์ให้เล่น, date=เดท, group=ไปเป็นกลุ่ม, view=วิวสวย, nature=ธรรมชาติ, chill=นั่งชิล, budget=ราคาไม่แพง, night=เที่ยวกลางคืน, food=อาหารอร่อย)
- "hours": เวลาเปิด-ปิดถ้ารีวิวบอกชัด ในรูปแบบ OpenStreetMap เช่น "Mo-Fr 09:00-18:00; Sa,Su 08:00-20:00" หรือ "Tu-Su 10:00-22:00; Mo off" ไม่บอก = null
- "entry": ค่าเข้าผู้ใหญ่ถ้ารีวิวบอกชัด {"free": true} หรือ {"thai": บาท, "foreign": บาท หรือ null} ไม่บอก = null
- "menu": ช่วงราคาอาหาร/เครื่องดื่มของร้านนี้ถ้ารีวิวบอก {"min": บาท, "max": บาท} ไม่บอก = null
ส่งกลับ JSON: {"results":[{"id", "skip"?, "summary", "highlights", "mustTry", "tips", "cons", "goodFor", "hours", "entry", "menu"}]}
สถานที่: ${JSON.stringify(group.map(({ p, texts }) => ({ id: p.id, name: p.name?.th || p.name?.en, type: p.kind, reviews: texts })))}`;
  try {
    const out = await aiJSON(prompt, { temperature: 0.2 });
    asked++;
    const L = (v, n, max) => ({ th: [].concat(v?.th || []).filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, max)).slice(0, n), en: [].concat(v?.en || []).filter(s => typeof s === "string" && s.trim()).map(s => s.trim().slice(0, max)).slice(0, n) });
    for (const g of group) {
      const r = (out?.results || []).find(x => x.id === g.p.id);
      const base = { sig: sig(g.p), at: new Date().toISOString(), n: g.texts.length, src: g.posts.map(x => ({ link: x.link, source: x.source, likes: x.likes })) };
      if (!r || r.skip) { cache[g.p.id] = { ...base, skip: true }; continue; }
      cache[g.p.id] = {
        ...base,
        summary: { th: String(r.summary?.th || "").slice(0, 140), en: String(r.summary?.en || "").slice(0, 160) },
        highlights: L(r.highlights, 4, 60), mustTry: L(r.mustTry, 4, 50), tips: L(r.tips, 3, 80), cons: L(r.cons, 2, 80),
        goodFor: [].concat(r.goodFor || []).filter(x => GOOD_FOR.includes(x)).slice(0, 4),
        // เวลาเปิด/ราคาที่รีวิวบอก (place-info.mjs ตรวจรูปแบบอีกครั้งก่อนใช้)
        hours: typeof r.hours === "string" ? r.hours.slice(0, 160) : undefined, entry: r.entry || undefined, menu: r.menu || undefined
      };
      done++;
    }
    await sleep(4000);
  } catch (e) { fails++; console.warn("AI สรุปรีวิวไม่ได้:", e.message.slice(0, 160)); }
}

const live = new Set(all.map(p => p.id));
for (const id of Object.keys(cache)) if (!live.has(id)) delete cache[id];
await save("data/place-reviews.json", JSON.stringify(cache) + "\n");
console.log(`ถาม AI ${asked} ครั้ง · สรุปใหม่ ${done} แห่ง · มีสรุปรีวิวทั้งหมด ${Object.values(cache).filter(c => c.summary).length} แห่ง`);
