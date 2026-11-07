// ดึงงานอีเว้นท์จริงอัตโนมัติจากเว็บขายบัตร (Eventpop, Zipevent) → กรอง → บันทึก data/auto-events.json
// ฟรี ไม่ต้องใช้ API key  รัน: node scripts/fetch-events.mjs   (ทดลองไม่บันทึก: --dry)
// - เคารพ robots.txt, หน่วงเวลาระหว่างคำขอ, ใส่ชื่อบอทพร้อมลิงก์เว็บเรา
// - เก็บแค่ข้อเท็จจริง (ชื่อ วันที่ สถานที่ ราคา) + รูปปกจากต้นทาง พร้อมลิงก์กลับไปซื้อบัตรที่ต้นทาง
import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const UA = "Mozilla/5.0 (compatible; IYouAloneBot/1.0; +https://wattanasaw.github.io/i-you-alone/)";
const DELAY_MS = 1500;          // หน่วงระหว่างคำขอ (สุภาพกับเว็บต้นทาง)
const MAX_PAGES_PER_RUN = 220;  // จำนวนหน้างานสูงสุดที่เปิดต่อรอบ (รวมทุกแหล่ง)
const REFRESH_DAYS = 3;         // ข้อมูลเก่ากว่านี้ให้เปิดหน้าใหม่เพื่ออัปเดต
const MAX_DAYS_AHEAD = 365;     // ไม่เก็บงานที่ไกลเกิน 1 ปี
// ตัวกรองคำ: งานที่ชื่อมีคำเหล่านี้จะไม่ถูกเก็บ (แก้เพิ่มได้)
const BLOCK_WORDS = [/\btest\b/i, /ทดสอบ/, /staff only/i, /private/i, /internal/i, /คาสิโน|casino|พนัน/i, /18\+|adult/i];

const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- ข้อมูลอ้างอิง ----------
const venues = await readJSON("data/venues.json", []);
const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
const PROVINCES = win.PROVINCES;
// ชื่อเรียกอื่นของจังหวัด/เมือง → รหัสจังหวัด
const PLACE_ALIASES = {
  bangkok: ["กรุงเทพ", "กทม", "bangkok", "krung thep", "mbk", "siam paragon", "siam square", "สยาม", "iconsiam", "ไอคอนสยาม", "emsphere", "emquartier", "emporium",
    "one bangkok", "uob live", "union mall", "terminal 21", "central ladprao", "ลาดพร้าว", "sukhumvit", "สุขุมวิท", "silom", "สีลม", "sathorn", "สาทร", "thonglor", "ทองหล่อ",
    "ekkamai", "เอกมัย", "ratchada", "รัชดา", "rama 9", "พระราม 9", "chatuchak", "จตุจักร", "asiatique", "เอเชียทีค", "jodd fairs", "chulalongkorn", "จุฬาลงกรณ์", "thammasat tha prachan",
    "khao san", "ข้าวสาร", "yaowarat", "เยาวราช", "bangna", "bang na", "บางนา", "samyan", "สามย่าน", "lumpini", "ลุมพินี", "true icon hall", "glowfish", "the street ratchada", "pratunam", "ประตูน้ำ", "town in town", "ทาวน์อินทาวน์", "phaya thai", "พญาไท", "ari", "อารีย์", "huai khwang", "ห้วยขวาง"],
  "samut-prakan": ["mega bangna", "เมกาบางนา", "bang phli", "บางพลี", "suvarnabhumi", "สุวรรณภูมิ", "samrong", "สำโรง"], "chiang-mai": ["chiangmai", "เชียงใหม่"], chonburi: ["pattaya", "พัทยา", "บางแสน", "bang saen", "si racha", "ศรีราชา"],
  "prachuap-khiri-khan": ["hua hin", "หัวหิน", "pranburi", "ปราณบุรี"], phetchabun: ["khao kho", "เขาค้อ"], "nakhon-ratchasima": ["korat", "โคราช", "khao yai", "เขาใหญ่"],
  ayutthaya: ["ayutthaya", "อยุธยา"], phuket: ["phuket", "ภูเก็ต"], "surat-thani": ["koh samui", "เกาะสมุย", "samui", "koh phangan", "koh pha ngan", "เกาะพะงัน", "koh tao", "เกาะเต่า"],
  krabi: ["ao nang", "อ่าวนาง"], songkhla: ["hat yai", "หาดใหญ่"], nonthaburi: ["pak kret", "ปากเกร็ด"],
  "pathum-thani": ["rangsit", "รังสิต", "future park"]
};
const geocache = await readJSON("data/geocache.json", {});

// ---------- ดึงหน้าเว็บ ----------
const robotsCache = {};
async function allowed(url) {
  const u = new URL(url);
  if (!(u.origin in robotsCache)) {
    let rules = [];
    try {
      const txt = await (await fetch(u.origin + "/robots.txt", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) })).text();
      let applies = false;
      for (const line of txt.split("\n")) {
        const [k, ...rest] = line.split(":"); const v = rest.join(":").trim(); const key = k.trim().toLowerCase();
        if (key === "user-agent") applies = v === "*" || /iyoualone/i.test(v);
        else if (applies && key === "disallow" && v) rules.push(v);
      }
    } catch {}
    robotsCache[u.origin] = rules;
  }
  return !robotsCache[u.origin].some(r => u.pathname.startsWith(r));
}
let requests = 0;
async function getHtml(url, lang = "th,en;q=0.8") {
  if (!(await allowed(url))) { console.warn("robots.txt ไม่อนุญาต:", url); return null; }
  // เว็บโดนเรียกถี่อาจตอบ 429/5xx ชั่วคราว → รอนานขึ้นแล้วลองใหม่อีกครั้ง
  for (let attempt = 1; attempt <= 2; attempt++) {
    await sleep(attempt === 1 ? DELAY_MS : 8000); requests++;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": lang }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.text();
      console.warn(`ตอบ ${r.status}:`, url);
      if (r.status !== 429 && r.status < 500) return null;
    } catch (e) { console.warn("โหลดไม่ได้:", url, e.message); }
  }
  return null;
}

// ---------- ตัวช่วยอ่าน HTML ----------
const decode = s => String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
  .replace(/&ndash;|&mdash;/g, "–").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
const meta = (html, p) => decode((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']*)`, "i"))
  || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${p}["']`, "i")) || [])[1]);
const lines = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "\n").split("\n").map(decode).map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  "ม.ค.": 1, "ก.พ.": 2, "มี.ค.": 3, "เม.ย.": 4, "พ.ค.": 5, "มิ.ย.": 6, "ก.ค.": 7, "ส.ค.": 8, "ก.ย.": 9, "ต.ค.": 10, "พ.ย.": 11, "ธ.ค.": 12,
  มกราคม: 1, กุมภาพันธ์: 2, มีนาคม: 3, เมษายน: 4, พฤษภาคม: 5, มิถุนายน: 6, กรกฎาคม: 7, สิงหาคม: 8, กันยายน: 9, ตุลาคม: 10, พฤศจิกายน: 11, ธันวาคม: 12 };
const DATE_RE = /(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s+(\d{4})/gi;
function datesIn(text) {
  return [...text.matchAll(DATE_RE)].map(m => {
    const mon = MONTHS[m[2].toLowerCase().slice(0, /^[a-z]/i.test(m[2]) ? 3 : undefined)] || MONTHS[m[2]];
    let y = +m[3]; if (y > 2400) y -= 543; // พ.ศ. → ค.ศ.
    return mon ? `${y}-${String(mon).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}` : null;
  }).filter(Boolean);
}
// ช่วงวันที่แบบย่อ: "02-13 ธันวาคม 2569", "23 October – 25 October 2026", "30 Nov - 2 Dec 2026"
const MON_RE = DATE_RE.source.match(/\\s\+\((.+)\)\\s\+/)[1];
const RANGE_RE = new RegExp(`(?<!\\d)(\\d{1,2})(?:\\s+(${MON_RE}))?\\s*[-–—]\\s*(\\d{1,2})\\s+(${MON_RE})\\s+(\\d{4})`, "gi");
function rangeDates(text) {
  const full = datesIn(String(text || ""));
  if (full.length >= 2) return full.slice(0, 2);
  for (const m of String(text || "").matchAll(RANGE_RE)) {
    const [end] = datesIn(`${m[3]} ${m[4]} ${m[5]}`);
    if (!end) continue;
    let [start] = datesIn(`${m[1]} ${m[2] || m[4]} ${m[5]}`);
    if (start > end) start = (+start.slice(0, 4) - 1) + start.slice(4); // ข้ามปี (ธ.ค. → ม.ค.)
    return [start, end];
  }
  return datesIn(text).slice(0, 2);
}
// งานแสดงสินค้าเฉพาะนักธุรกิจ (B2B) — คนทั่วไปเข้าไม่ได้/ไม่ได้ประโยชน์
const TRADE = /\b(trade (show|fair|exhibition)|b2b|conference|summit|congress|symposium|forum|convention of|business matching|for professionals?)\b|เฉพาะผู้ประกอบการ|ผู้ประกอบการธุรกิจ|เครือข่ายทางธุรกิจ|สร้างเครือข่าย|นักธุรกิจ|ผู้เชี่ยวชาญด้าน|เจรจาธุรกิจ|ประชุมวิชาการ/i;
const SALE_PROMO = /\bsale\b|weekend|mega|grand|fair|festival|market|ลดราคา|ลดกระหน่ำ|มหกรรม|แฟร์|เทศกาล/i;
// อัตราแลกเปลี่ยน (ฟรี ไม่ต้องใช้คีย์ · open.er-api.com) ใช้แปลงราคาบัตรสกุลอื่นเป็นบาทโดยประมาณ
const FX = await fetch("https://open.er-api.com/v6/latest/THB", { signal: AbortSignal.timeout(15000) }).then(r => r.json()).then(j => j.result === "success" ? j.rates : {}).catch(() => ({}));
const toBaht = (v, cur) => !cur || /^THB$/i.test(cur) ? +v : FX[String(cur).toUpperCase()] ? Math.round(+v / FX[String(cur).toUpperCase()]) : null;
const prices = arr => [...new Set(arr.map(s => Number(String(s).replace(/,/g, ""))).filter(n => n >= 20 && n <= 100000))].sort((a, b) => a - b);

// ---------- ตัวอ่านข้อมูลงานมาตรฐาน schema.org (JSON-LD) ใช้ร่วมกันหลายเว็บ ----------
const zw = s => String(s || "").replace(/[\u200b-\u200f\u2060-\u2064\ufeff]/g, "").replace(/\s+/g, " ").trim();
function ldEvents(html) {
  const out = [];
  const walk = x => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const types = [].concat(x["@type"] || []);
    if (types.some(t => /Event$|Festival/.test(t)) && x.name && x.startDate) out.push(x);
    ["@graph", "itemListElement", "item", "subEvent"].forEach(k => x[k] && walk(x[k]));
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { walk(JSON.parse(m[1])); } catch {} }
  return out;
}
// งาน schema.org → รูปแบบเดียวกับตัวอ่านเว็บอื่น (build() ใช้ต่อ)
function fromLd(ev, catHint = "") {
  const loc = [].concat(ev.location || [])[0] || {}, addr = typeof loc.address === "string" ? { streetAddress: loc.address } : loc.address || {};
  // ราคาสกุลอื่น (เช่น USD ใน Eventbrite) แปลงเป็นบาทโดยประมาณ (fx = true → แอพแสดง ≈)
  let fx = false;
  const offers = [].concat(ev.offers || []).flatMap(o => [].concat(o.offers || o)).flatMap(o => {
    const v = [o.price, o.lowPrice, o.highPrice].filter(v => v != null && v !== "");
    if (o.priceCurrency && !/^THB$/i.test(o.priceCurrency) && v.some(x => +x > 0)) fx = true;
    return v.map(x => toBaht(x, o.priceCurrency)).filter(x => x != null);
  });
  const d = s => String(s || "").slice(0, 10);
  const online = /Online/i.test(ev.eventAttendanceMode || "") || /VirtualLocation/.test(loc["@type"] || "");
  const country = zw(addr.addressCountry?.name || addr.addressCountry);
  const types = [].concat(ev["@type"]).join(" ");
  return {
    title: zw(decode(ev.name)), image: [].concat(ev.image || [])[0]?.url || [].concat(ev.image || [])[0],
    summary: zw(decode(ev.description)), dates: [d(ev.startDate), d(ev.endDate || ev.startDate)].filter(x => /^\d{4}-\d\d-\d\d$/.test(x)),
    time: (String(ev.startDate).match(/T(\d\d:\d\d)/) || [])[1]?.replace(/^00:00$/, "") || undefined,
    venueText: online ? "Online" : zw(loc.name || addr.streetAddress), provinceText: zw(addr.addressRegion || addr.addressLocality),
    outsideThailand: !!country && !/^(TH|THA|Thailand|ไทย|ประเทศไทย)$/i.test(country),
    catText: `${catHint} ${/Sports/.test(types) ? "run sport" : ""} ${/Music/.test(types) ? "concert" : ""} ${/Festival/.test(types) ? "festival" : ""}`,
    prices: prices(offers), fx, free: offers.length > 0 && offers.every(v => +v === 0) || ev.isAccessibleForFree === true,
    bodyText: zw(`${addr.streetAddress || ""} ${addr.addressLocality || ""} ${ev.description || ""}`).slice(0, 600)
  };
}
// งาน Eventbrite ส่วนมากเป็นมีตติ้ง/ทัวร์/เปิดบ้านมหาลัย → ตัดออก เหลืองานอีเว้นท์จริง
const EB_SKIP = /hangout|meet ?up|networking|language exchange|open day|info session|webinar|walking tour|city tour|day tour|cooking class|yoga class|free consultation|seminar on|study abroad|university|speed dating|business|investor|real estate|visa/i;

// ---------- ตัวอ่านของแต่ละแหล่ง ----------
const SOURCES = {
  eventpop: {
    name: "Eventpop",
    lang: "en", // หน้าภาษาอังกฤษมีรูปแบบวันที่แน่นอน ("06 Dec 2026 at 16:00")
    async list() {
      const cats = ["nightlife", "party", "concert", "music-festival", "run", "book", "food-and-drink", "education", "business", "art-and-design", "health", "experience",
        "kids-and-family", "performing-arts", "fan-meeting", "games", "e-sport", "hobbies-and-special-interests", "charity", "comedy"];
      const urls = new Set();
      for (const c of cats) {
        for (let page = 1; page <= 3; page++) {
          const html = await getHtml(`https://www.eventpop.me/g/${c}${page > 1 ? `?page=${page}` : ""}`);
          if (!html) break;
          const found = [...html.matchAll(/href="(?:https:\/\/www\.eventpop\.me)?\/e\/(\d+)(\/[^"?#]*)?/g)].map(m => `https://www.eventpop.me/e/${m[1]}${m[2] || ""}`);
          const before = urls.size; found.forEach(u => urls.add(u));
          if (!html.includes(`page=${page + 1}`) || urls.size === before) break;
        }
      }
      // หนึ่งงานอาจมีหลายลิงก์ (มี/ไม่มี slug) → เก็บอันที่ยาวสุดต่อ id
      const byId = {};
      for (const u of urls) { const id = u.match(/\/e\/(\d+)/)[1]; if (!byId[id] || u.length > byId[id].length) byId[id] = u; }
      // หน้าหมวดมีงานเก่าปนมา: เลข id สูง = งานใหม่ เปิดก่อน
      return Object.entries(byId).sort((a, b) => b[0] - a[0]).map(([id, url]) => ({ id: `ep-${id}`, url }));
    },
    parse(html, url) {
      const L = lines(html);
      const title = meta(html, "og:title").replace(/^Eventpop\s*\|\s*/i, "");
      const di = L.findIndex(l => /^\d{1,2} [A-Z][a-z]{2} \d{4}/.test(l));
      if (di < 0) return null;
      const dateLine = L[di] + (/^\d{1,2} [A-Z][a-z]{2} \d{4}/.test(L[di + 1] || "") ? " " + L[di + 1] : "");
      const venueIdx = /^\d{1,2} [A-Z][a-z]{2} \d{4}/.test(L[di + 1] || "") ? di + 2 : di + 1;
      const provLine = L.slice(venueIdx, venueIdx + 3).find(l => /,\s*(Thailand|ประเทศไทย)$/i.test(l)) || "";
      // og:image บางงานเป็นรูปว่าง (/images/cover-placeholder.jpg) → ใช้รูปโปสเตอร์ในหน้าแทน
      const og = meta(html, "og:image");
      const poster = (html.match(/https:\/\/p-u\.popcdn\.net\/event_details\/posters\/[^"'\s]+\/large\/[^"'\s]+/) || [])[0];
      const image = /placeholder/i.test(og) || !/^https:\/\//.test(og) ? poster : og;
      const ticketIdx = L.findIndex(l => /ราคาบัตร|ประเภทบัตร|ticket price|ticket type|ราคา/i.test(l));
      const priceText = ticketIdx >= 0 ? L.slice(ticketIdx, ticketIdx + 30).join(" ") : "";
      // ช่วงราคาบัตรที่ Eventpop ฝังไว้ในหน้า (หน่วยสตางค์) เช่น "priceRangeSatangs":[1200000,1850000] = 12,000–18,500 บาท
      const range = html.match(/priceRangeSatangs(?:&quot;|")\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
      const rangeBaht = range ? [Math.round(+range[1] / 100), Math.round(+range[2] / 100)] : null;
      return {
        title, image, summary: meta(html, "og:description"),
        dates: datesIn(dateLine), time: (dateLine.match(/at (\d{1,2}:\d{2})/) || [])[1],
        venueText: L[venueIdx], provinceText: provLine.replace(/,\s*(Thailand|ประเทศไทย)$/i, ""), outsideThailand: !provLine && /,\s*(Singapore|Malaysia|Vietnam|Japan|Korea|Indonesia|Philippines|Laos|Cambodia)/i.test(L.slice(venueIdx, venueIdx + 3).join(" ")),
        catText: L.slice(Math.max(0, di - 4), di).join(" "),
        prices: rangeBaht && rangeBaht[1] > 0 ? prices(rangeBaht) : prices([...priceText.matchAll(/([\d,]{2,})(?:\.\d+)?\s*(?:บาท|THB|฿)|฿\s*([\d,]{2,})/g)].map(m => m[1] || m[2])),
        free: rangeBaht ? rangeBaht[1] === 0 : /เข้าชมฟรี|เข้างานฟรี|เข้าร่วมฟรี|free (?:entry|admission)|ไม่มีค่าใช้จ่าย/i.test(L.slice(0, 80).join(" ")) && !priceText,
        bodyText: L.slice(venueIdx + 1, venueIdx + 80).join(" ")
      };
    }
  },
  zipevent: {
    name: "Zipevent", quota: 40,
    async list() {
      const urls = new Set();
      const html = await getHtml("https://www.zipeventapp.com/event/allevent");
      [...(html || "").matchAll(/href="(https:\/\/www\.zipeventapp\.com\/e\/[^"?#]+)/g)].forEach(m => urls.add(m[1]));
      // หน้ารวมโหลดงานเพิ่มด้วย JavaScript → ใช้ sitemap แทน (เรียงเก่า→ใหม่ จึงเอาท้ายสุด = งานใหม่ล่าสุด)
      const sm = await getHtml("https://www.zipeventapp.com/sitemap.xml");
      const locs = [...(sm || "").matchAll(/<loc>(https:\/\/www\.zipeventapp\.com\/e\/[^<]+)<\/loc>/g)].map(m => m[1]);
      locs.slice(-150).reverse().forEach(u => urls.add(u));
      return [...urls].map(url => ({ id: "zip-" + url.split("/e/")[1].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60), url }));
    },
    parse(html, url) {
      const L = lines(html);
      const title = meta(html, "og:title").replace(/\s*\|\s*Zipevent.*$/i, "").replace(/\s+/g, " ");
      const di = L.findIndex(l => datesIn(l).length && l.length < 60);
      if (di < 0) return null;
      const timeM = (L[di + 1] || "").match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      const venueIdx = timeM ? di + 2 : di + 1;
      const buyIdx = L.findIndex((l, i) => i > venueIdx && /^(ซื้อตั๋ว|buy ticket|ลงทะเบียน|register)/i.test(l));
      const cats = L.slice(venueIdx + 1, buyIdx > 0 ? Math.min(buyIdx, venueIdx + 6) : venueIdx + 4);
      const priceLines = L.filter(l => /^[\d,]+(?:\.\d+)?\s*THB$/i.test(l)).map(l => l.replace(/\s*THB/i, ""));
      return {
        title, image: meta(html, "og:image"), summary: meta(html, "og:description"),
        dates: datesIn(L[di]), time: timeM ? `${timeM[1]}–${timeM[2]}` : undefined,
        venueText: L[venueIdx], provinceText: "", catText: cats.join(" "),
        prices: prices(priceLines.map(p => p.split(".")[0])),
        free: /(?:^|\s)(?:ฟรี|free)(?:\s|$)/i.test(L.slice(di, di + 40).join(" ")) && !priceLines.length,
        bodyText: L.slice(venueIdx, venueIdx + 120).join(" ")
      };
    }
  },
  // คอนเสิร์ตใหญ่/การแสดง/กีฬา — หน้ารายละเอียดมีข้อมูล schema.org
  thaiticketmajor: {
    name: "ThaiTicketMajor", quota: 40,
    async list() {
      const urls = new Set();
      for (const c of ["concert", "performance", "sport", "exhibition"]) {
        const html = await getHtml(`https://www.thaiticketmajor.com/${c}/`);
        [...(html || "").matchAll(/href="(?:https:\/\/www\.thaiticketmajor\.com)?\/(concert|performance|sport|exhibition)\/([a-z0-9-]+)\.html/g)]
          .forEach(m => urls.add(`https://www.thaiticketmajor.com/${m[1]}/${m[2]}.html`));
      }
      return [...urls].map(url => ({ id: "ttm-" + url.split("/").pop().replace(/\.html$/, "").slice(0, 60), url }));
    },
    parse(html, url) {
      // หน้ามีงานแนะนำอื่นปนมาด้วย → เลือกงานที่ชื่อตรงกับหัวหน้าเว็บ
      const og = norm(meta(html, "og:title").replace(/^Official Ticket\s*\|\s*/i, ""));
      const all = ldEvents(html);
      const ev = all.find(e => norm(decode(e.name)) === og) || all.find(e => og.includes(norm(decode(e.name)).slice(0, 20)));
      if (!ev) return null;
      const p = fromLd(ev, /\/sport\//.test(url) ? "sport" : /\/exhibition\//.test(url) ? "exhibition" : "concert");
      p.title = p.title.replace(/^Official Ticket\s*\|\s*/i, "");
      if (!p.image) p.image = meta(html, "og:image");
      // ราคาบัตรในหน้า (เช่น "ราคาบัตร 2,500 / 3,500 บาท")
      if (!p.prices.length) p.prices = prices([...lines(html).join(" ").matchAll(/([\d,]{3,})\s*(?:บาท|THB|฿)/g)].map(m => m[1]));
      return p;
    }
  },
  // งานวิ่ง/ปั่น/ไตรกีฬา ทั่วประเทศ
  runlah: {
    name: "RunLah", quota: 40,
    async list() {
      const sm = await getHtml("https://www.runlah.com/sitemap.xml");
      const locs = [...(sm || "").matchAll(/<loc>(https:\/\/www\.runlah\.com\/([A-Za-z]{8}))<\/loc>/g)];
      return locs.map(m => ({ id: "run-" + m[2], url: m[1] }));
    },
    parse(html) {
      const ev = ldEvents(html)[0];
      return ev ? fromLd(ev, "run") : null;
    }
  },
  // งานในเมืองท่องเที่ยว — หน้ารวมมีข้อมูลครบ ไม่ต้องเปิดทีละงาน
  eventbrite: {
    name: "Eventbrite", lang: "en",
    async list() {
      const refs = [];
      for (const city of ["bangkok", "chiang-mai", "phuket", "pattaya", "krabi", "hua-hin"]) {
        for (const page of [1, 2]) {
          const html = await getHtml(`https://www.eventbrite.com/d/thailand--${city}/events/${page > 1 ? `?page=${page}` : ""}`, "en");
          if (!html) break;
          for (const ev of ldEvents(html)) {
            const id = (String(ev.url).match(/-(\d{9,})(?:\?|$)/) || [])[1];
            if (!id || EB_SKIP.test(ev.name)) continue;
            // หน้ารวมไม่มีราคา → ไม่มีราคา/ฟรี ให้เปิดหน้างาน (มีราคาบัตรใน schema.org)
            const parsed = fromLd(ev);
            refs.push({ id: "eb-" + id, url: String(ev.url).split("?")[0], ...(parsed.prices.length || parsed.free ? { parsed } : {}) });
          }
        }
      }
      return [...new Map(refs.map(r => [r.id, r])).values()];
    },
    parse(html) {
      const ev = ldEvents(html)[0];
      return ev ? fromLd(ev) : null;
    }
  },
  // ---------- ศูนย์แสดงสินค้า: มหกรรม/มอเตอร์โชว์/งานแฟร์เข้าฟรี ที่ไม่ได้ขายบัตรผ่านเว็บขายตั๋ว ----------
  // อิมแพ็ค เมืองทองธานี (มอเตอร์ เอ็กซ์โป, งานเฟอร์นิเจอร์, คอนเสิร์ต) — หน้างานมีข้อมูล schema.org ครบ
  impact: {
    name: "IMPACT", quota: 40,
    async list() {
      const sm = await getHtml("https://www.impact.co.th/sitemap.th-TH.4seo.1.xml");
      // ไม่เอางานแสดงสินค้าเฉพาะธุรกิจ/ประชุม/สัมมนา
      return [...(sm || "").matchAll(/<loc>(https:\/\/www\.impact\.co\.th\/th\/visitors\/event-calendar\/(exhibition-public|concert|special-event|family-show)\/([^<]+))<\/loc>/g)]
        .map(m => ({ id: "imp-" + m[3].toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60), url: m[1] }))
        .reverse(); // sitemap เรียงเก่า→ใหม่ → เปิดงานใหม่ก่อน
    },
    parse(html) {
      const ev = ldEvents(html)[0];
      if (!ev) return null;
      const p = fromLd(ev, `${decode(ev.name)} ${decode(ev.description || "")}`);
      // ที่อยู่ในหน้าเป็นลิงก์แผนที่ → ใช้ชื่อฮอลล์ + อิมแพ็ค
      p.venueText = /อิมแพ็ค|impact/i.test(p.venueText) ? p.venueText : `${p.venueText} อิมแพ็ค เมืองทองธานี`.trim();
      p.provinceText = "นนทบุรี";
      if (!p.image) p.image = meta(html, "og:image");
      // ราคา "100 บาท" ในข้อเสนอ หรือ "เข้าชมฟรี" ในคำอธิบาย
      if (/เข้าชมฟรี|เข้างานฟรี|free admission|free entry/i.test(ev.description || "")) { p.free = true; p.prices = []; }
      return p;
    }
  },
  // ศูนย์ฯ สิริกิติ์ (งานหนังสือ, Cat Expo, งานอาหาร) — วันที่อยู่ในบรรทัดใต้ชื่องาน
  qsncc: {
    name: "QSNCC", quota: 40,
    async list() {
      const sm = await getHtml("https://qsncc.com/sitemap.xml");
      const y = new Date().getFullYear();
      const urls = [...new Set([...(sm || "").matchAll(/<loc>(https:\/\/qsncc\.com\/th\/whats-on\/event-calendar\/([^<]+?)\/?)<\/loc>/g)].map(m => m[1]))];
      // ชื่อที่มีปีเก่า = งานจบแล้ว ข้าม · ปีนี้/ปีหน้าเปิดก่อน
      const yr = u => +((u.match(/(20\d\d)/g) || []).pop() || 0);
      return urls.filter(u => !yr(u) || yr(u) >= y).sort((a, b) => yr(b) - yr(a))
        .map(url => ({ id: "qs-" + decodeURIComponent(url).split("/").filter(Boolean).pop().toLowerCase().replace(/[^a-z0-9฀-๿]+/g, "-").slice(0, 60), url }));
    },
    parse(html) {
      const L = lines(html);
      const i = L.findIndex(l => /^(Upcoming|Ongoing|On-going|กำลังจะมาถึง|กำลังจัดงาน)$/i.test(l));
      if (i < 1) return null;
      const title = decode(L[i - 1]);
      const timeM = (L[i + 3] || "").match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
      const hall = L[timeM ? i + 4 : i + 3] || "";
      const endIdx = L.findIndex((l, k) => k > i && /^(Share|แชร์)$/i.test(l));
      const body = L.slice(i + 5, endIdx > i ? endIdx : i + 25).join(" ");
      return {
        title, image: meta(html, "og:image").split("?")[0], summary: L.slice(i + 4, i + 12).filter(l => !/^https?:|is interested$|^Exhibition Hall|^ห้อง|^\d{1,2}:\d{2}/i.test(l)).slice(0, 3).join(" "),
        dates: rangeDates(L[i + 1]), time: timeM ? `${timeM[1]}–${timeM[2]}` : undefined,
        venueText: `ศูนย์การประชุมแห่งชาติสิริกิติ์ (QSNCC) ${/hall|ห้อง|ชั้น/i.test(hall) ? hall : ""}`.trim(), provinceText: "กรุงเทพ",
        catText: `${title} ${body}`, prices: [], free: /เข้าชมฟรี|เข้างานฟรี|ฟรีค่าเข้า|free admission|free entry/i.test(body),
        trade: TRADE.test(`${title} ${body}`), bodyText: body
      };
    }
  },
  // ห้าง: อีเว้นท์/แฟร์ และมหกรรมลดราคาทั้งห้าง (สยามพารากอน)
  siamparagon: {
    name: "Siam Paragon", quota: 25, lang: "en",
    async list() {
      const sm = await getHtml("https://www.siamparagon.co.th/sitemap.xml");
      const locs = [...(sm || "").matchAll(/<loc>(https:\/\/www\.siamparagon\.co\.th\/(events|promotions)\/([^<]+))<\/loc>/g)];
      // โปรโมชั่นมีส่วนลดบัตรเครดิต/ร้านอาหารเยอะ → เอาเฉพาะงานลดราคาทั้งห้าง/แฟร์
      return locs.filter(m => m[2] === "events" || SALE_PROMO.test(m[3].replace(/-/g, " ")))
        .map(m => ({ id: "spg-" + m[3].toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60), url: m[1], promo: m[2] === "promotions" }));
    },
    parse(html, url) {
      const L = lines(html);
      const title = decode(meta(html, "og:title")).replace(/\s*[|-]\s*Siam Paragon.*$/i, "");
      const di = L.findIndex((l, k) => k > 5 && l.length < 90 && rangeDates(l).length);
      if (!title || di < 0) return null;
      const promo = /\/promotions\//.test(url);
      return {
        title, image: meta(html, "og:image"), summary: meta(html, "og:description") || meta(html, "description"),
        dates: rangeDates(L[di]), time: (L[di].match(/(\d{1,2}[:.]\d{2})/) || [])[1],
        venueText: "Siam Paragon", provinceText: "กรุงเทพ",
        catText: `${promo ? "sale ลดราคา" : ""} ${title} ${meta(html, "og:description")}`,
        prices: [], free: true, bodyText: L.slice(di, di + 30).join(" ")
      };
    }
  }
};

// ---------- จัดหมวด / สถานที่ / จังหวัด ----------
const CATEGORY_RULES = [
  ["outdoor", /\b(run|running|marathon|trail|hyrox|triathlon|fun ?run|cycling|bike|yoga|fitness|sport|workout|crossfit)\b|วิ่ง|มาราธอน|ปั่นจักรยาน|ไตรกีฬา|โยคะ|ฟิตเนส|กีฬา/i],
  ["book", /\bbook|หนังสือ/i],
  ["motor", /\bmotor|car show|auto ?salon|รถยนต์|ยานยนต์|มอเตอร์|บิ๊กไบค์|รถจักรยานยนต์/i],
  ["cafe", /\bcoffee|caf[eé]|กาแฟ|คาเฟ่/i],
  ["food", /\bfood|drink|beer|wine|whisky|cocktail|gastro|dining|festival of taste|อาหาร|เครื่องดื่ม|เบียร์|ไวน์/i],
  ["sale", /\bsale\b|flash ?sale|super weekend|ลดราคา|ลดกระหน่ำ|เซล|outlet|มหกรรมลด/i],
  // เรียนลงมือทำ (เวิร์กช็อป คอร์ส คลาส อบรม) ก่อน สัมมนา/ทอล์ก (ฟังบรรยาย)
  ["learning", /\b(workshop|course|class|classes|training|bootcamp|masterclass|lesson|hands-?on|diy)\b|อบรม|เวิร์กช็อป|เวิร์คช็อป|เวิร์คชอป|คอร์ส|คลาส|เรียนทำ|ฝึกทำ|สอนทำ|ลงมือทำ/i],
  ["seminar", /\b(education|business|seminar|summit|conference|forum|symposium|talk|talks|webinar|meetup|keynote|panel|lecture|ted ?x)\b|สัมมนา|ประชุม|ฟอรั่ม|ทอล์ก|บรรยาย|เสวนา|ปาฐกถา|เรียน/i],
  ["nightlife", /\b(nightlife|night ?club|club night|clubbing|bar|pub|party|parties|dj|rave|after ?party|happy hour|ladies night)\b|ผับ|บาร์|ปาร์ตี้|ไนท์คลับ|ไนท์ไลฟ์|ดีเจ|แดนซ์ฮอลล์/i],
  ["concert", /\b(concert|music|festival|live|fan ?meeting|fan ?con|showcase|tour|comedy|performing|musical|theatre|theater|stand ?up)\b|คอนเสิร์ต|เทศกาลดนตรี|แฟนมีต|ละครเวที|ดนตรี/i],
  ["exhibition", /\b(exhibition|exhibit|art|arts|museum|gallery|immersive|installation|biennale|photography|pop-?up|art ?toy)\b|นิทรรศการ|พิพิธภัณฑ์|ศิลปะ|แกลเลอรี|อาร์ต|ภาพถ่าย|ป๊อปอัพ/i],
  ["expo", /\b(expo|fair|trade show|design|gaming|games|e-?sport|cartoon|anime|experience|kids|family|hobbies|convention)\b|งานแสดงสินค้า|งานแสดง|มหกรรม|แฟร์|เอ็กซ์โป/i]
];
const NIGHT_RULE = CATEGORY_RULES.find(([id]) => id === "nightlife")[1];
const NIGHT_VENUE =/\b(bar|pub|club|lounge|rooftop|speakeasy|taproom|brewery)\b|ผับ|บาร์|คลับ|รูฟท็อป/i;
// ผู้สนับสนุน: "Singha Corporation presents ..." หรือ "สนับสนุนโดย ..." ในชื่อ/คำอธิบาย
function sponsorOf(title, summary) {
  const clean = s => s.replace(/^[\s|:,-]+|[\s|:,.-]+$/g, "").trim();
  const t = String(title || "").match(/(?:^|\|\s*)([^|]{2,40}?)\s+(?:proudly\s+)?presents?\b/i);
  const s = !t && String(summary || "").match(/(?:สนับสนุนโดย|ผู้สนับสนุนหลัก|sponsored by|powered by|presented by)\s*:?\s*([^\n,.|!]{2,40})/i);
  // คำอธิบายมักต่อข้อความติดกัน ("AssociationHosted at: ...") → ตัดที่คำถัดไป
  const name = t ? clean(t[1]) : s && clean(s[1].split(/(?<=[a-z])(?=[A-Z])/)[0].split(/\b(?:hosted|held|venue|date)\b|\s(?:at|in|on)\s|:/i)[0]);
  return name && !/^(we|eventpop|zipevent|the|and)$/i.test(name) ? name : undefined;
}
const categorize = (title, catText) => {
  for (const text of [catText, title]) for (const [id, re] of CATEGORY_RULES) if (re.test(text || "")) return id;
  return "expo";
};
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9฀-๿]+/g, " ").trim();
function matchVenue(text) {
  const t = norm(text);
  // ใส่ชื่อที่เจาะจงกว่าก่อน (thunder dome ก่อน impact)
  for (const v of [...venues].sort((a, b) => (b.aliases || []).join().length - (a.aliases || []).join().length)) {
    if ((v.aliases || []).some(a => t.includes(norm(a)))) return v;
  }
  return null;
}
// คำอังกฤษต้องตรงทั้งคำ (กัน "ari" ใน "safari"), ชื่อจังหวัดไทยที่เป็นคำทั่วไปด้วย (เลย ตาก แพร่) ต้องมี "จังหวัด/จ." นำหน้า
const RISKY_TH = new Set(["เลย", "ตาก", "แพร่", "น่าน", "ตรัง", "ยะลา"]);
const hasWord = (t, w) => {
  const x = norm(w);
  if (/^[a-z0-9 ]+$/.test(x)) return new RegExp(`(^|[^a-z0-9])${x.replace(/ /g, "\\s+")}($|[^a-z0-9])`).test(t);
  return t.includes(x);
};
function provinceFrom(text, { strict = false } = {}) {
  const t = norm(text);
  // ชื่อยาว/เจาะจงก่อน ("mega bangna" ก่อน "bangna")
  const pairs = Object.entries(PLACE_ALIASES).flatMap(([id, ws]) => ws.map(w => [id, w])).sort((a, b) => b[1].length - a[1].length);
  for (const [id, w] of pairs) if ((!strict || w.length >= 5) && hasWord(t, w)) return id;
  for (const p of PROVINCES) {
    if (hasWord(t, p.en)) return p.id;
    const th = norm(p.th);
    if (RISKY_TH.has(p.th) || strict ? new RegExp(`(จังหวัด|จ)\\s*${th}`).test(t) : t.includes(th)) return p.id;
  }
  return null;
}
const isOnline = text => /\b(online|zoom|livestream|live stream|virtual|webinar)\b|ออนไลน์/i.test(text || "");

// แปลงชื่อสถานที่เป็นพิกัดด้วย OpenStreetMap Nominatim (ฟรี, 1 คำขอ/วินาที, เก็บแคชไว้)
async function geocode(name, provinceId) {
  const key = norm(name) + "|" + (provinceId || "");
  if (key in geocache) return geocache[key];
  const prov = PROVINCES.find(p => p.id === provinceId);
  // ลองหลายแบบ: ชื่อเต็ม → ทีละส่วนที่คั่นด้วยจุลภาค (เช่น "JAM SPACE, MBK Center" → "MBK Center")
  const clean = name.replace(/ชั้น\s*\S+|floor\s*\d+|fl\.?\s*\d+|\d+(?:st|nd|rd|th)\s*fl(?:oor)?\.?|zone\s*\w+|โซน\s*\S+|hall\s*\d+/gi, " ").replace(/\s+/g, " ").trim();
  const noParen = clean.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim(), inParen = (clean.match(/\(([^)]+)\)/) || [])[1];
  const tries = [...new Set([clean, noParen, inParen, ...noParen.split(/[,|/]/).map(s => s.trim()).filter(s => s.length > 3).reverse()].filter(Boolean))].slice(0, 4);
  for (const t of tries) {
    const q = [t, prov?.en, "Thailand"].filter(Boolean).join(", ");
    await sleep(1100); // นโยบาย Nominatim: ไม่เกิน 1 คำขอ/วินาที
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=th&addressdetails=1&accept-language=en&q=${encodeURIComponent(q)}`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      const [hit] = r.ok ? await r.json() : [];
      if (hit) return (geocache[key] = { lat: +(+hit.lat).toFixed(5), lng: +(+hit.lon).toFixed(5), state: hit.address?.state || hit.address?.city || "" });
    } catch { return null; } // ไม่เก็บแคชถ้าเน็ตล่ม จะลองใหม่รอบหน้า
  }
  return (geocache[key] = null);
}

// ---------- รวมเป็นข้อมูลงาน + กรอง ----------
const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // วันที่ตามเวลาไทย
const maxDate = new Date(Date.now() + MAX_DAYS_AHEAD * 864e5).toISOString().slice(0, 10);
const rejects = {};
let lastReject = null;
const reject = (why, item) => { lastReject = why; (rejects[why] = rejects[why] || []).push(item.title || item.url); return null; };

// คำอธิบายสั้น: ตัดส่วนที่ซ้ำกับชื่องาน ถ้าเหลือสั้นเกินไปไม่ใส่
function cleanSummary(s, title) {
  let x = String(s || "").replace(/\s+/g, " ").trim();
  if (norm(x).startsWith(norm(title))) x = x.slice(title.length).replace(/^[\s\-–:|]+/, "");
  if (x.length < 15) return undefined;
  return x.length > 180 ? x.slice(0, 180) + "…" : x;
}

// ราคาที่เขียนไว้ในรายละเอียดงาน (หน้าเว็บที่ตารางบัตรโหลดด้วย JavaScript เช่น Zipevent)
// "ค่าลงทะเบียน: 6,900 บาท", "บัตรราคา 1,500 บาท", "Ticket: ฿990" — ต้องมีคำว่า ราคา/บัตร/ค่า... อยู่ใกล้ตัวเลข
const PRICE_NEAR = /(?:ราคา|บัตร|ตั๋ว|ค่า(?:ลงทะเบียน|เข้า(?:ชม|งาน|ร่วม)?|สมัคร|เรียน|อบรม|บัตร)|ticket|price|admission|entry fee|registration fee|early ?bird|presale|regular)[^\n]{0,40}?(?:฿\s*([\d,]{2,7})|([\d,]{2,7})(?:\.\d+)?\s*(?:บาท|thb|฿|\.-))/gi;
const bodyPrices = text => prices([...String(text || "").matchAll(PRICE_NEAR)].map(m => m[1] || m[2]));

async function build(src, ref, p) {
  const item = { title: p?.title, url: ref.url };
  if (!p || !p.title) return reject("อ่านหน้าไม่ได้", item);
  if (!p.prices?.length && !p.free) p.prices = bodyPrices(`${p.summary || ""}\n${p.bodyText || ""}`);
  if (BLOCK_WORDS.some(re => re.test(p.title))) return reject("คำต้องห้าม", item);
  const [start, ...rest] = [...new Set(p.dates)].sort();
  const end = rest.length ? rest[rest.length - 1] : start;
  if (!start) return reject("ไม่มีวันที่", item);
  if (end < today) return reject("จบแล้ว", item);
  if (start > maxDate) return reject("ไกลเกิน 1 ปี", item);
  if (p.outsideThailand) return reject("อยู่นอกประเทศไทย", item);
  if (p.trade) return reject("งานเฉพาะธุรกิจ (B2B)", item);

  const ev = {
    id: ref.id, auto: true, title: p.title.slice(0, 160), category: categorize(p.title, p.catText),
    startDate: start, endDate: end, time: p.time,
    price: p.free ? { type: "free" } : p.prices.length ? { type: "paid", min: p.prices[0], max: p.prices[p.prices.length - 1], ...(p.fx ? { approx: true } : {}) } : { type: "unknown" },
    summary: cleanSummary(p.summary, p.title),
    image: /^https:\/\//.test(p.image || "") ? p.image.trim().replace(/ /g, "%20") : undefined,
    ticketUrl: ref.url, sourceUrl: ref.url, sourceName: src.name,
    fetchedAt: new Date().toISOString()
  };
  // คอนเสิร์ตที่จัดในผับ/บาร์/คลับ → หมวดไนท์ไลฟ์
  if (ev.category === "concert" && NIGHT_VENUE.test(p.venueText || "")) ev.category = "nightlife";
  const sponsor = sponsorOf(p.title, p.summary);
  if (sponsor) ev.sponsor = sponsor;
  // งานยาวเกิน 4 เดือน (พิพิธภัณฑ์/นิทรรศการถาวร) → แสดงแบบเปิดประจำ
  // เปิดยาวเกิน 4 เดือน (พิพิธภัณฑ์/นิทรรศการถาวร/ร้าน) = สถานที่เปิดประจำ ไม่ใช่งานอีเว้นท์
  if ((new Date(end) - new Date(start)) / 864e5 > 120) return reject("เปิดประจำ ไม่ใช่อีเว้นท์", item);
  // งานออนไลน์ไม่เก็บ (แอพเน้นงานที่ไปร่วมได้จริง)
  if (isOnline(p.venueText)) return reject("งานออนไลน์", item);
  const known = matchVenue(`${p.venueText} ${p.provinceText}`);
  if (known) { ev.venueId = known.id; return ev; }
  if (!p.venueText) return reject("ไม่มีสถานที่", item);
  let province = provinceFrom(`${p.provinceText} ${p.venueText}`);
  const geo = await geocode(p.venueText, province);
  if (!province && geo?.state) province = provinceFrom(geo.state);
  // ทางสุดท้าย: หาชื่อจังหวัด/ย่านในรายละเอียดงาน
  if (!province) province = provinceFrom(p.bodyText, { strict: true });
  if (!province) return reject("ระบุจังหวัดไม่ได้", item);
  ev.venue = { name: p.venueText.slice(0, 120), province, ...(geo ? { lat: geo.lat, lng: geo.lng } : {}) };
  return ev;
}

// ---------- ทดลองอ่านทีละหน้า: node scripts/fetch-events.mjs --url <ลิงก์งาน> ----------
const testIdx = process.argv.indexOf("--url");
if (testIdx > 0) {
  for (const url of process.argv.slice(testIdx + 1)) {
    const src = Object.values(SOURCES).find(s => url.toLowerCase().includes(s.name.toLowerCase().replace(/\s/g, ""))) || SOURCES.zipevent;
    const html = await getHtml(url, src.lang);
    const p = html && src.parse(html, url);
    const ev = await build(src, { id: "test", url }, p);
    console.log(`\n== ${url}\n parsed:`, JSON.stringify({ ...p, bodyText: undefined, summary: p?.summary?.slice(0, 60) }), "\n event:", JSON.stringify(ev), ev ? "" : `\n ❌ ${lastReject}`);
  }
  process.exit(0);
}

// ---------- ทำงาน ----------
let prev = await readJSON("data/auto-events.json", null);
// ไฟล์มีอยู่แต่อ่านไม่ได้ (เช่นโดนตัดกลางทาง) → หยุด ไม่เริ่มจากศูนย์ทับงานเดิม
if (!prev && existsSync(new URL("data/auto-events.json", root))) { console.error("data/auto-events.json เสีย — กู้จาก git ก่อน"); process.exit(1); }
prev ??= { events: [] };
const prevById = Object.fromEntries((prev.events || []).map(e => [e.id, e]));
// งานที่เคยตรวจแล้วว่าจบแล้ว/นอกไทย/ไม่ผ่านตัวกรองถาวร → ไม่ต้องเปิดซ้ำ
const skip = new Set(prev.skip || []);
const PERMANENT = new Set(["งานเฉพาะธุรกิจ (B2B)", "จบแล้ว", "อยู่นอกประเทศไทย", "คำต้องห้าม", "เปิดประจำ ไม่ใช่อีเว้นท์", "งานออนไลน์"]);
const out = [], stats = {};
let opened = 0;
for (const [key, src] of Object.entries(SOURCES)) {
  let refs = [];
  try { refs = await src.list(); } catch (e) { console.warn(`${src.name}: อ่านรายการไม่ได้`, e.message); }
  stats[src.name] = { found: refs.length, kept: 0, opened: 0 };
  refs = refs.filter(r => !skip.has(r.id));
  // ใหม่ก่อน แล้วค่อยอันที่ข้อมูลเก่า (sort แบบคงลำดับเดิม)
  refs.sort((a, b) => (prevById[a.id] ? 1 : 0) - (prevById[b.id] ? 1 : 0));
  // โควต้าเปิดหน้าต่อแหล่ง (กำหนดเองได้ที่ quota ของแหล่งนั้น)
  const quota = src.quota || 70;
  let openedHere = 0;
  for (const ref of refs) {
    const old = prevById[ref.id];
    // งานที่ยังไม่รู้ราคา เปิดหน้าใหม่ทุก 3 วัน (ผู้จัดมักใส่ราคาทีหลัง)
    const age = old ? (Date.now() - new Date(old.fetchedAt)) / 864e5 : Infinity;
    const fresh = age < REFRESH_DAYS && (old.price?.type !== "unknown" || age < 3);
    let ev = null;
    // แหล่งที่หน้ารวมมีข้อมูลครบแล้ว (Eventbrite) ไม่ต้องเปิดหน้างาน
    if (ref.parsed) {
      lastReject = null;
      ev = await build(src, ref, ref.parsed);
      if (!ev && PERMANENT.has(lastReject)) skip.add(ref.id);
    } else if (fresh) ev = old;
    else if (openedHere < quota && opened < MAX_PAGES_PER_RUN) {
      const html = await getHtml(ref.url, src.lang); opened++; openedHere++; stats[src.name].opened++;
      lastReject = null;
      ev = await build(src, ref, html ? src.parse(html, ref.url) : null);
      if (!ev && PERMANENT.has(lastReject)) skip.add(ref.id);
    } else ev = old || null; // เกินโควต้ารอบนี้: ใช้ข้อมูลเดิมไปก่อน
    if (ev && (ev.endDate || ev.startDate) >= today || ev?.ongoing) { out.push(ev); stats[src.name].kept++; }
  }
}
// งานที่หายจากหน้ารวมแต่ยังไม่จบ: เก็บไว้ต่อ (เว็บต้นทางอาจแค่เลื่อนหน้า)
for (const e of prev.events || []) if (!out.find(x => x.id === e.id) && ((e.endDate || e.startDate) >= today || e.ongoing)) out.push(e);
// งานเดิมที่เป็นแบบเปิดประจำ/ออนไลน์ (เก็บไว้ก่อนเปลี่ยนกฎ) → เอาออก และไม่เปิดหน้าซ้ำอีก
for (let i = out.length - 1; i >= 0; i--) if (out[i].ongoing || out[i].venueId === "online") { skip.add(out[i].id); out.splice(i, 1); }

// ใช้กฎใหม่กับงานเดิมที่ยังไม่ถึงรอบเปิดหน้าใหม่ด้วย (สปอนเซอร์ / คอนเสิร์ตในผับบาร์)
for (const e of out) {
  if (!e.sponsor) { const s = sponsorOf(e.title, e.summary); if (s) e.sponsor = s; }
  if (e.category === "concert" && (NIGHT_VENUE.test(e.venue?.name || "") || NIGHT_RULE.test(e.title))) e.category = "nightlife";
}
// กรองซ้ำข้ามแหล่ง: ชื่อ + วันเริ่มเหมือนกัน
const seen = new Set(), events = [];
// + สถานที่และวันเดียวกัน ชื่อมีคำหลักร่วมกันเกินครึ่ง (เช่น "BABYMONSTER WORLD TOUR [CHOOM]" กับ "WORLD TOUR [춤 (CHOOM)]")
const STOP = new Set(["world", "tour", "bangkok", "thailand", "concert", "live", "the", "and", "in", "presents", "official", "2026", "2027", "2028"]);
const words = t => new Set(norm(t).split(" ").filter(w => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)));
const placeKey = e => e.venueId || norm(e.venue?.name);
const similar = (a, b) => {
  if (a.startDate !== b.startDate || placeKey(a) !== placeKey(b)) return false;
  const A = words(a.title), B = words(b.title), common = [...A].filter(w => B.has(w)).length;
  return common > 0 && common >= Math.min(A.size, B.size) / 2;
};
for (const e of out) {
  const k = norm(e.title).replace(/\s/g, "").slice(0, 40) + e.startDate;
  if (seen.has(k) || events.some(x => similar(x, e))) { reject("ซ้ำกับแหล่งอื่น", e); continue; }
  seen.add(k); events.push(e);
}
events.sort((a, b) => a.startDate.localeCompare(b.startDate));

const byCat = events.reduce((m, e) => (m[e.category] = (m[e.category] || 0) + 1, m), {});
console.log(`คำขอทั้งหมด ${requests} · เก็บ ${events.length} งาน`, JSON.stringify(stats), "\nหมวด:", JSON.stringify(byCat));
for (const [why, list] of Object.entries(rejects)) console.log(`กรองออก (${why}): ${list.length}`, list.slice(0, 4).join(" | "));
if (DRY) { console.log(JSON.stringify(events.slice(0, 6), null, 1)); process.exit(0); }
// เขียนไฟล์ชั่วคราวก่อนแล้วค่อยสลับ → ถ้าโดนหยุดกลางทาง ไฟล์เดิมยังอยู่ครบ
const save = async (p, text) => { const u = new URL(p, root), tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, u); };
await save("data/auto-events.json", JSON.stringify({ updatedAt: new Date().toISOString(), stats, events, skip: [...skip].slice(-3000) }, null, 2) + "\n");
await save("data/geocache.json", JSON.stringify(geocache, null, 1) + "\n");
