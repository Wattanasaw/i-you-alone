// ดึงงานอีเว้นท์จริงอัตโนมัติจากเว็บขายบัตร (Eventpop, Zipevent) → กรอง → บันทึก data/auto-events.json
// ฟรี ไม่ต้องใช้ API key  รัน: node scripts/fetch-events.mjs   (ทดลองไม่บันทึก: --dry)
// - เคารพ robots.txt, หน่วงเวลาระหว่างคำขอ, ใส่ชื่อบอทพร้อมลิงก์เว็บเรา
// - เก็บแค่ข้อเท็จจริง (ชื่อ วันที่ สถานที่ ราคา) + รูปปกจากต้นทาง พร้อมลิงก์กลับไปซื้อบัตรที่ต้นทาง
import { readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const UA = "Mozilla/5.0 (compatible; IYouAloneBot/1.0; +https://wattanasaw.github.io/i-you-alone/)";
const DELAY_MS = 1500;          // หน่วงระหว่างคำขอ (สุภาพกับเว็บต้นทาง)
const MAX_PAGES_PER_RUN = 140;  // จำนวนหน้างานสูงสุดที่เปิดต่อรอบ
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
const prices = arr => [...new Set(arr.map(s => Number(String(s).replace(/,/g, ""))).filter(n => n >= 20 && n <= 100000))].sort((a, b) => a - b);

// ---------- ตัวอ่านของแต่ละแหล่ง ----------
const SOURCES = {
  eventpop: {
    name: "Eventpop",
    lang: "en", // หน้าภาษาอังกฤษมีรูปแบบวันที่แน่นอน ("06 Dec 2026 at 16:00")
    async list() {
      const cats = ["concert", "music-festival", "run", "book", "food-and-drink", "education", "business", "art-and-design", "health", "experience",
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
      return {
        title, image, summary: meta(html, "og:description"),
        dates: datesIn(dateLine), time: (dateLine.match(/at (\d{1,2}:\d{2})/) || [])[1],
        venueText: L[venueIdx], provinceText: provLine.replace(/,\s*(Thailand|ประเทศไทย)$/i, ""), outsideThailand: !provLine && /,\s*(Singapore|Malaysia|Vietnam|Japan|Korea|Indonesia|Philippines|Laos|Cambodia)/i.test(L.slice(venueIdx, venueIdx + 3).join(" ")),
        catText: L.slice(Math.max(0, di - 4), di).join(" "),
        prices: prices([...priceText.matchAll(/([\d,]{2,})(?:\.\d+)?\s*(?:บาท|THB|฿)|฿\s*([\d,]{2,})/g)].map(m => m[1] || m[2])),
        free: /เข้าชมฟรี|เข้างานฟรี|เข้าร่วมฟรี|free (?:entry|admission)|ไม่มีค่าใช้จ่าย/i.test(L.slice(0, 80).join(" ")) && !priceText,
        bodyText: L.slice(venueIdx + 1, venueIdx + 80).join(" ")
      };
    }
  },
  zipevent: {
    name: "Zipevent",
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
  }
};

// ---------- จัดหมวด / สถานที่ / จังหวัด ----------
const CATEGORY_RULES = [
  ["outdoor", /\b(run|running|marathon|trail|hyrox|triathlon|fun ?run|cycling|bike|yoga|fitness|sport|workout|crossfit)\b|วิ่ง|มาราธอน|ปั่นจักรยาน|ไตรกีฬา|โยคะ|ฟิตเนส|กีฬา/i],
  ["book", /\bbook|หนังสือ/i],
  ["motor", /\bmotor|car show|auto ?salon|รถยนต์|มอเตอร์|บิ๊กไบค์/i],
  ["cafe", /\bcoffee|caf[eé]|กาแฟ|คาเฟ่/i],
  ["food", /\bfood|drink|beer|wine|whisky|cocktail|gastro|dining|festival of taste|อาหาร|เครื่องดื่ม|เบียร์|ไวน์/i],
  ["sale", /\bsale\b|flash ?sale|ลดราคา|ลดกระหน่ำ|เซล|outlet/i],
  ["learning", /\b(education|business|seminar|summit|conference|forum|workshop|course|class|training|bootcamp|symposium|talk|webinar|meetup)\b|สัมมนา|อบรม|เวิร์กช็อป|เวิร์คช็อป|คอร์ส|เรียน|ประชุม|ฟอรั่ม/i],
  ["concert", /\b(concert|music|festival|live|fan ?meeting|fan ?con|showcase|tour|dj|party|nightlife|comedy|performing|musical|theatre|theater|stand ?up)\b|คอนเสิร์ต|เทศกาลดนตรี|แฟนมีต|ละครเวที|ดนตรี/i],
  ["expo", /\b(expo|exhibition|fair|art|design|museum|gallery|gaming|games|e-?sport|cartoon|anime|experience|kids|family|hobbies)\b|นิทรรศการ|งานแสดง|มหกรรม|พิพิธภัณฑ์|ศิลปะ/i]
];
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

async function build(src, ref, p) {
  const item = { title: p?.title, url: ref.url };
  if (!p || !p.title) return reject("อ่านหน้าไม่ได้", item);
  if (BLOCK_WORDS.some(re => re.test(p.title))) return reject("คำต้องห้าม", item);
  const [start, ...rest] = [...new Set(p.dates)].sort();
  const end = rest.length ? rest[rest.length - 1] : start;
  if (!start) return reject("ไม่มีวันที่", item);
  if (end < today) return reject("จบแล้ว", item);
  if (start > maxDate) return reject("ไกลเกิน 1 ปี", item);
  if (p.outsideThailand) return reject("อยู่นอกประเทศไทย", item);

  const ev = {
    id: ref.id, auto: true, title: p.title.slice(0, 160), category: categorize(p.title, p.catText),
    startDate: start, endDate: end, time: p.time,
    price: p.free ? { type: "free" } : p.prices.length ? { type: "paid", min: p.prices[0], max: p.prices[p.prices.length - 1] } : { type: "unknown" },
    summary: cleanSummary(p.summary, p.title),
    image: /^https:\/\//.test(p.image || "") ? p.image : undefined,
    ticketUrl: ref.url, sourceUrl: ref.url, sourceName: src.name,
    fetchedAt: new Date().toISOString()
  };
  // งานยาวเกิน 4 เดือน (พิพิธภัณฑ์/นิทรรศการถาวร) → แสดงแบบเปิดประจำ
  if ((new Date(end) - new Date(start)) / 864e5 > 120) { ev.ongoing = true; delete ev.endDate; ev.startDate = start; }

  if (isOnline(p.venueText)) { ev.venueId = "online"; return ev; }
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
    const src = url.includes("eventpop") ? SOURCES.eventpop : SOURCES.zipevent;
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
const PERMANENT = new Set(["จบแล้ว", "อยู่นอกประเทศไทย", "คำต้องห้าม"]);
const out = [], stats = {};
let opened = 0;
for (const [key, src] of Object.entries(SOURCES)) {
  let refs = [];
  try { refs = await src.list(); } catch (e) { console.warn(`${src.name}: อ่านรายการไม่ได้`, e.message); }
  stats[src.name] = { found: refs.length, kept: 0, opened: 0 };
  refs = refs.filter(r => !skip.has(r.id));
  // ใหม่ก่อน แล้วค่อยอันที่ข้อมูลเก่า (sort แบบคงลำดับเดิม)
  refs.sort((a, b) => (prevById[a.id] ? 1 : 0) - (prevById[b.id] ? 1 : 0));
  // แบ่งโควต้าเปิดหน้าให้ทุกแหล่ง
  const quota = Math.ceil(MAX_PAGES_PER_RUN / Object.keys(SOURCES).length);
  let openedHere = 0;
  for (const ref of refs) {
    const old = prevById[ref.id];
    const fresh = old && (Date.now() - new Date(old.fetchedAt)) / 864e5 < REFRESH_DAYS;
    let ev = null;
    if (fresh) ev = old;
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

// กรองซ้ำข้ามแหล่ง: ชื่อ + วันเริ่มเหมือนกัน
const seen = new Set(), events = [];
for (const e of out) { const k = norm(e.title).replace(/\s/g, "").slice(0, 40) + e.startDate; if (seen.has(k)) { reject("ซ้ำกับแหล่งอื่น", e); continue; } seen.add(k); events.push(e); }
events.sort((a, b) => a.startDate.localeCompare(b.startDate));

const byCat = events.reduce((m, e) => (m[e.category] = (m[e.category] || 0) + 1, m), {});
console.log(`คำขอทั้งหมด ${requests} · เก็บ ${events.length} งาน`, JSON.stringify(stats), "\nหมวด:", JSON.stringify(byCat));
for (const [why, list] of Object.entries(rejects)) console.log(`กรองออก (${why}): ${list.length}`, list.slice(0, 4).join(" | "));
if (DRY) { console.log(JSON.stringify(events.slice(0, 6), null, 1)); process.exit(0); }
// เขียนไฟล์ชั่วคราวก่อนแล้วค่อยสลับ → ถ้าโดนหยุดกลางทาง ไฟล์เดิมยังอยู่ครบ
const save = async (p, text) => { const u = new URL(p, root), tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, u); };
await save("data/auto-events.json", JSON.stringify({ updatedAt: new Date().toISOString(), stats, events, skip: [...skip].slice(-3000) }, null, 2) + "\n");
await save("data/geocache.json", JSON.stringify(geocache, null, 1) + "\n");
