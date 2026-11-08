// ตรวจลิงก์เว็บไซต์ของทุกสถานที่ (data/places.json + data/trend-places.json) ว่าเปิดได้จริง
// 1) แก้รูปแบบลิงก์: ไม่มี https:// ("www.x.com" "facebook.com/x") · ชื่อเพจเปล่าๆ จาก OSM ("zhancoffee", "100064142170983") → เพจ Facebook
// 2) เปิดลิงก์จริง: โดเมนไม่มีแล้ว / ต่อไม่ได้ / ใบรับรองเสีย / 404 410 / 5xx / หน้าโดเมนขาย (parked) = ลิงก์เสีย
//    403/429/401 = เว็บกันบอท (คนเปิดได้) ถือว่าใช้ได้ · Facebook/Instagram ตรวจจากเซิร์ฟเวอร์ไม่ได้ (ต้องล็อกอิน) → แก้แค่รูปแบบ
// 3) ลิงก์เสีย → ลองแบบ http/https, มี/ไม่มี www และเว็บทางการใน Wikidata (P856) · ไม่มีที่ใช้ได้ = ลบลิงก์ (แอพแสดงปุ่มแผนที่แทน)
// ผลจำไว้ใน data/link-check.json (ตรวจซ้ำทุก 30 วัน · ลิงก์เสียตรวจซ้ำทุก 7 วัน เผื่อเว็บล่มชั่วคราว)
// node scripts/check-links.mjs [--minutes 12]
import { readFile, writeFile, rename } from "node:fs/promises";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const MINUTES = arg("--minutes", 12), OK_DAYS = 30, BAD_DAYS = 7, PAR = 8;
const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const days = d => (Date.now() - new Date(d || 0)) / 864e5;
const today = new Date().toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

const data = await readJSON("data/places.json", null);
if (!data?.places) { console.error("อ่าน data/places.json ไม่ได้"); process.exit(1); }
const trend = await readJSON("data/trend-places.json", []);
const cache = await readJSON("data/link-check.json", {});
const all = [...data.places, ...trend];

// ---------- 1) รูปแบบลิงก์ ----------
const SOCIAL = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|tiktok\.com|line\.me|lin\.ee|x\.com|twitter\.com)$/i;
const TLD = /\.(com|net|org|info|biz|co|io|me|app|asia|travel|cafe|shop|store|site|online|xyz|fun|bar|pub|club|world|life|place|space|website|page|art|studio|coffee|restaurant|bkk|thai|in\.th|co\.th|or\.th|go\.th|ac\.th|ne\.th|mi\.th|th|cz|de|uk|fr|it|nl|jp|cn|sg|my|au|us)$/i;
export function normalize(u) {
  let s = String(u || "").split(/[;\s]+/)[0].trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) { /* ok */ }
  // โดเมนจริง (มี www. หรือ / หรือลงท้ายด้วยโดเมนที่มีอยู่จริง) — ไม่ใช่ชื่อเพจที่มีจุด ("bar.foucault", "part.of.moon")
  else if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s) && (/^www\.|\//i.test(s) || TLD.test(s.split("/")[0]))) s = "https://" + s;
  // ชื่อเพจเปล่าๆ (OSM contact:facebook) หรือเลขเพจ
  else if (/^@?[\w.\-%]{3,}$/.test(s)) s = "https://www.facebook.com/" + s.replace(/^@/, "");
  else return null;
  try {
    const x = new URL(s);
    if (!/^https?:$/.test(x.protocol) || !x.hostname.includes(".")) return null;
    // "https://bar.foucault/" (เคยเติม https:// ให้ชื่อเพจที่มีจุด) → เพจ Facebook
    if (!TLD.test(x.hostname) && !/^www\./.test(x.hostname) && x.pathname === "/" && !/^\d+(\.\d+){3}$/.test(x.hostname)) return "https://www.facebook.com/" + x.hostname;
    if (/(^|\.)m\.facebook\.com$|^web\.facebook\.com$/i.test(x.hostname)) x.hostname = "www.facebook.com";
    return x.toString();
  } catch { return null; }
}
const isSocial = u => { try { return SOCIAL.test(new URL(u).hostname.replace(/^www\./, "")); } catch { return false; } };

// ---------- 2) เปิดลิงก์ ----------
const PARKED = /domain (?:name )?(?:is |may be )?for sale|buy this domain|this domain is parked|parked free|sedoparking|domain has expired|hugedomains|dan\.com|afternic|โดเมนนี้ขาย|account suspended|this account has been suspended|website (?:is )?expired/i;
async function probe(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "th,en", Accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
      const ct = r.headers.get("content-type") || "";
      const body = /html|text/i.test(ct) ? (await r.text()).slice(0, 60000) : "";
      if ([401, 403, 405, 406, 423, 429, 503, 999].includes(r.status)) return { ok: true, status: r.status, final: r.url };
      if (r.status >= 500) { if (i === 0) continue; return { ok: false, status: r.status, why: "server" }; }
      if (r.status === 404 || r.status === 410) return { ok: false, status: r.status, why: "notfound" };
      if (!r.ok) return { ok: false, status: r.status, why: "http" };
      if (PARKED.test(body) && body.length < 40000) return { ok: false, status: r.status, why: "parked", final: r.url };
      return { ok: true, status: r.status, final: r.url };
    } catch (e) {
      const code = e.cause?.code || e.name || "error";
      if (i === 0 && /Timeout|ECONNRESET|UND_ERR|EAI_AGAIN/i.test(code)) continue;
      // ใบรับรองขาดตัวกลาง: เบราว์เซอร์ดึงเองได้ เปิดได้ปกติ
      if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/.test(code)) return { ok: true, why: code };
      // ต่อไม่ได้/หมดเวลา: อาจล่มชั่วคราวหรือกันต่างประเทศ (GitHub Actions อยู่ต่างประเทศ) → ไม่ลบ
      if (/Timeout|ECONNRESET|ECONNREFUSED|UND_ERR|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(code)) return { ok: true, unsure: true, why: code };
      return { ok: false, why: code };
    }
  }
  return { ok: false, why: "error" };
}
const variants = u => {
  const x = new URL(u), out = [];
  const host = x.hostname.startsWith("www.") ? x.hostname.slice(4) : "www." + x.hostname;
  for (const proto of x.protocol === "http:" ? ["https:", "http:"] : ["https:", "http:"]) for (const h of [x.hostname, host]) {
    const y = new URL(u); y.protocol = proto; y.hostname = h;
    if (y.toString() !== u) out.push(y.toString());
  }
  // หน้าย่อยเสีย → ลองหน้าแรกของเว็บ
  if (x.pathname.length > 1) out.push(`${x.protocol}//${x.hostname}/`);
  return [...new Set(out)];
};
async function wikidataSites(q) {
  try {
    const r = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${q}.json`, { headers: { "User-Agent": "IYouAlone/1.0 (events app; link check)" }, signal: AbortSignal.timeout(15000) });
    const e = (await r.json()).entities?.[q];
    return (e?.claims?.P856 || []).filter(c => c.rank !== "deprecated").map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
  } catch { return []; }
}

// ---------- ตรวจ ----------
const T0 = Date.now();
const fixed = [], removed = [], replaced = [];
let checked = 0;
const fresh = c => c && days(c.at) < (c.ok && !c.unsure ? OK_DAYS : BAD_DAYS);
async function check(url) {
  if (fresh(cache[url])) return cache[url];
  if (Date.now() - T0 > MINUTES * 60000) return cache[url] || null; // หมดเวลา → รอบหน้า
  checked++;
  const r = await probe(url);
  cache[url] = { ...r, at: today };
  return cache[url];
}
// ลิงก์ที่เคยลบ → ตรวจซ้ำตามรอบ (เผื่อเว็บกลับมา)
for (const p of all) if (!p.website && p.websiteDead) { p.website = p.websiteDead; delete p.websiteDead; }
const manual = await readJSON("data/website-fix.json", {});
for (const p of all) if (manual[p.id]) { p.website = manual[p.id]; delete p.websiteDead; }
const jobs = all.filter(p => p.website);
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const p = jobs[next++];
    const orig = p.website, url = normalize(orig);
    if (!url) { removed.push(`${p.name?.th || p.name?.en} (${orig})`); delete p.website; continue; }
    if (url !== orig) { fixed.push(`${orig} → ${url}`); p.website = url; }
    if (isSocial(url)) continue;
    const r = await check(url);
    if (!r || r.ok) continue;
    // ลิงก์เสีย → หาที่ใช้ได้
    let alt = null;
    const cands = [...variants(url), ...(p.wikidata ? (await wikidataSites(p.wikidata)).map(normalize).filter(Boolean) : [])].filter(u => u !== url);
    for (const u of [...new Set(cands)]) { const x = isSocial(u) ? { ok: true } : await check(u); if (x?.ok && !x.unsure) { alt = u; break; } }
    if (alt) { replaced.push(`${p.name?.th || p.name?.en}: ${url} → ${alt}`); p.website = alt; }
    else { removed.push(`${p.name?.th || p.name?.en} (${url} · ${r.why}${r.status ? " " + r.status : ""})`); delete p.website; p.websiteDead = url; }
  }
}
await Promise.all([...Array(PAR)].map(worker));

// ลืมผลของลิงก์ที่ไม่มีใครใช้แล้ว (เก็บลิงก์เสียไว้ กันใส่กลับมาอีก)
const used = new Set(all.flatMap(p => [p.website, p.websiteDead]).filter(Boolean));
for (const u of Object.keys(cache)) if (!used.has(u) && cache[u].ok && days(cache[u].at) > OK_DAYS) delete cache[u];
await save("data/link-check.json", JSON.stringify(cache) + "\n");
// --dry = ตรวจอย่างเดียว ไม่แก้ข้อมูลสถานที่
if (!process.argv.includes("--dry")) {
  await save("data/places.json", JSON.stringify(data, null, 1) + "\n");
  await save("data/trend-places.json", JSON.stringify(trend, null, 1) + "\n");
}
const withSite = all.filter(p => p.website).length;
console.log(`ตรวจลิงก์ ${checked} ครั้ง · แก้รูปแบบ ${fixed.length} · เปลี่ยนเป็นเว็บที่ใช้ได้ ${replaced.length} · ลบลิงก์เสีย ${removed.length} · มีเว็บไซต์ ${withSite}/${all.length} · ${((Date.now() - T0) / 60000).toFixed(1)} นาที`);
for (const s of replaced) console.log("  ↪", s);
for (const s of removed) console.log("  ✗", s);
