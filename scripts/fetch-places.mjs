// รวบรวมสถานที่เที่ยวดังในไทย + ข่าวเทรนด์ → data/places.json (ฟรีทั้งหมด)
// - สวนสัตว์/สวนสนุก/พิพิธภัณฑ์/อุทยาน/คาเฟ่: Wikidata (เรียงตามความดัง = จำนวนภาษาที่มีบทความ Wikipedia)
//   รูปจาก Wikimedia Commons (พร้อมชื่อช่างภาพ/สัญญาอนุญาต), คำอธิบายจาก Wikipedia, เวลาเปิด/เว็บไซต์จาก OpenStreetMap
// - คาเฟ่สัตว์: OpenStreetMap (ชื่อร้านที่บอกชัดว่าเป็นคาเฟ่สัตว์)
// - บอร์ดเทรนด์: ข่าวล่าสุดของแต่ละหมวดจาก Google News · สถานที่ที่อยู่ในข่าวจะขึ้นป้าย 🔥 และขึ้นก่อน
// รัน: node scripts/fetch-places.mjs [--dry]
import { readFile, writeFile, rename } from "node:fs/promises";

const DRY = process.argv.includes("--dry");
const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const PER_KIND = 30;        // จำนวนสถานที่ดังสูงสุดต่อหมวด
// สถานที่ที่ปิดไปแล้วแต่ Wikidata ยังไม่อัปเดต (ใส่ชื่อภาษาอังกฤษ) — เพิ่มได้เมื่อเจอ
const CLOSED = [/^Dusit Zoo$/i];
const REFRESH_DAYS = 14;    // คำอธิบาย/เครดิตรูปเก่ากว่านี้ค่อยโหลดใหม่
const BBOX = "5.6,97.3,20.5,105.7"; // กรอบประเทศไทย

const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
const PROVINCES = win.PROVINCES;

async function get(url, opt = {}, tries = 2) {
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { ...opt, headers: { "User-Agent": UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(90000) });
      if (r.ok) return r;
      console.warn(`ตอบ ${r.status}:`, url.slice(0, 100));
      if (r.status !== 429 && r.status < 500) return null;
    } catch (e) { console.warn("โหลดไม่ได้:", url.slice(0, 100), e.message); }
    await sleep(5000 * i);
  }
  return null;
}

// ชื่อจังหวัดภาษาอังกฤษจาก Wikidata/OSM ("Chiang Mai Province") → id จังหวัดของแอพ
const normEn = s => String(s || "").toLowerCase().replace(/province|changwat|city|metropolis|special administrative area/g, "").replace(/[^a-z]/g, "");
function provinceByEn(name) {
  const n = normEn(name);
  if (!n) return null;
  if (n.includes("bangkok")) return "bangkok";
  return (PROVINCES.find(p => normEn(p.en) === n) || PROVINCES.find(p => n.length > 4 && (normEn(p.en).includes(n) || n.includes(normEn(p.en)))))?.id || null;
}

// ---------- หมวดสถานที่ ----------
// classes = ประเภทใน Wikidata, news = คำค้นหากระแสวัยรุ่น/ไวรัล (ไม่ใช่ข่าวทั่วไป)
// topic = หัวข้อต้องพูดถึงเรื่องของหมวดนั้นจริง (กันไวรัลเรื่องอื่นหลุดเข้ามา)
const KINDS = {
  cafe:       { topic: /คาเฟ่|cafe|café|ร้านกาแฟ|กาแฟ|เบเกอรี่|bakery|ขนม|เค้ก|ร้านนั่งชิล|ร้านขนม/i, classes: ["Q30022"], news: ["คาเฟ่ ไวรัล", "คาเฟ่ วัยรุ่น แห่เช็คอิน", "คาเฟ่ TikTok", "คาเฟ่ลับ จุดถ่ายรูป"] },
  animalcafe: { topic: /คาเฟ่\s*(แมว|หมา|สุนัข|สัตว์|นก|กระต่าย|นาก|เม่น)|คาปิบารา|แคทคาเฟ่|cat ?caf|dog ?caf|ฟาร์มสัตว์|ดองกี้|สัตว์เลี้ยง.*(คาเฟ่|ร้าน)|อัลปาก้า/i, classes: [], news: ["คาเฟ่แมว ไวรัล", "คาเฟ่สัตว์ น่ารัก ไวรัล", "คาปิบารา คาเฟ่", "คาเฟ่หมา เช็คอิน"] },
  zoo:        { topic: /สวนสัตว์|ซาฟารี|zoo|ฮิปโป|หมูเด้ง|ยีราฟ|เพนกวิน|แพนด้า|อควาเรียม|aquarium|โอเชียนเวิลด์|ฟาร์ม/i, classes: ["Q43501", "Q2281788", "Q1415221"], news: ["สวนสัตว์ ไวรัล", "สัตว์ น่ารัก แห่ดู สวนสัตว์", "สวนสัตว์ TikTok"] },
  themepark:  { topic: /สวนสนุก|สวนน้ำ|theme ?park|water ?park|ดรีมเวิลด์|dream ?world|สยามอะเมซิ่ง|แฮปปี้แลนด์|รามายณะ|เครื่องเล่น|รถไฟเหาะ|ลานสเก็ต|เพลย์กราวด์|playground|บ้านผีสิง/i, classes: ["Q194195", "Q2416723", "Q740326"], news: ["สวนสนุก วัยรุ่น", "สวนน้ำ ไวรัล", "สวนสนุก เปิดใหม่ เช็คอิน"] },
  museum:     { topic: /มิวเซียม|museum|พิพิธภัณฑ์|นิทรรศการ|exhibition|อาร์ตสเปซ|art ?space|แกลเลอรี|gallery|หอศิลป์|อาร์ตทอย|art ?toy|immersive/i, classes: ["Q33506", "Q207694"], news: ["มิวเซียม จุดถ่ายรูป", "นิทรรศการ ไวรัล เช็คอิน", "อาร์ตสเปซ วัยรุ่น", "นิทรรศการ เปิดใหม่ ห้ามพลาด", "immersive นิทรรศการ"] },
  park:       { topic: /อุทยาน|ดอย|ภู[ก-ฮ]|ทะเลหมอก|น้ำตก|แคมป์|camping|จุดชมวิว|เดินป่า|national park|เขาใหญ่|ป่า|ทุ่ง/i, classes: ["Q46169"], news: ["ที่เที่ยวธรรมชาติ ไวรัล", "จุดชมวิว ทะเลหมอก วัยรุ่น", "แคมป์ปิ้ง ฮิต เช็คอิน"] }
};
// เทรนด์ต้องมีคำแนวกระแส/วัยรุ่น และไม่ใช่ข่าวทั่วไป (ราชการ อุบัติเหตุ อาชญากรรม การเมือง ประกาศปิด)
const TREND_WORDS = /ไวรัล|viral|tiktok|ติ๊กต็อก|ติ๊กต๊อก|กระแส|ฮิต|แห่|เช็คอิน|เช็กอิน|check.?in|ถ่ายรูป|วัยรุ่น|มาแรง|ปัง|ฟิน|ห้ามพลาด|น่ารัก|คาเฟ่ลับ|ร้านลับ|ที่เที่ยวลับ|เปิดใหม่|instagram|ไอจี|\big\b|โซเชียล|ชาวเน็ต|จุดชมวิว|วิวสวย|มินิมอล|คิวยาว|ต้องไป|พิกัด/i;
const NOT_TREND = /เจ้าหน้าที่|รัฐมนตรี|ผู้ว่า|นายก|ตำรวจ|จับกุม|ดำเนินคดี|ศาล|เสียชีวิต|ตาย|ศพ|บาดเจ็บ|อุบัติเหตุ|ไฟไหม้|น้ำท่วม|พายุ|ประกาศปิด|ปิดชั่วคราว|ปิดให้บริการ|ห้ามเข้า|งบประมาณ|ประชุม|ลงนาม|mou|แถลง|ร้องเรียน|ทุจริต|หุ้น|กำไร|รายได้|ช่วยชีวิต|ลักลอบ|ล่าสัตว์|ยึด|update:|บริจาค|โรงพยาบาล|รพ\.|ซีรีส์|ละคร|นักแสดง|ดารา|ไอดอล|ทรัมป์|รับสมัคร|ประกวด|contest|สลด|สิ้นใจ|ช็อก|ใจสลาย|ตกจาก|ดับคาที่|สังคมตั้งคำถาม|ดราม่า|สำนักข่าว/i;
// เทรนด์ในไทยเท่านั้น
const ABROAD = /นิวยอร์ก|อเมริกา|ปารีส|ฝรั่งเศส|อังกฤษ|ยุโรป|ญี่ปุ่น|โตเกียว|โอซาก้า|เกาหลี|โซล|จีน|ปักกิ่ง|เซี่ยงไฮ้|ไต้หวัน|ฮ่องกง|สิงคโปร์|มาเลเซีย|เวียดนาม|บาหลี|นอร์เวย์|ออสเตรเลีย|ดูไบ|อินเดีย|ลาว|กัมพูชา|norway|paris|tokyo|korea/i;

async function wikidata(kind, classes) {
  if (!classes.length) return [];
  const sparql = `SELECT ?p (MAX(?l) AS ?links) (SAMPLE(?c) AS ?coord) (SAMPLE(?img) AS ?image) (SAMPLE(?th) AS ?nameTh) (SAMPLE(?en) AS ?nameEn) (SAMPLE(?zh) AS ?nameZh)
    (SAMPLE(?thA) AS ?artTh) (SAMPLE(?enA) AS ?artEn) (SAMPLE(?zhA) AS ?artZh) (SAMPLE(?web) AS ?website) (SAMPLE(?provEn) AS ?province) (SAMPLE(?bkk) AS ?inBangkok) WHERE {
    VALUES ?cls { ${classes.map(c => "wd:" + c).join(" ")} }
    ?p wdt:P31/wdt:P279* ?cls; wdt:P17 wd:Q869; wdt:P625 ?c; wikibase:sitelinks ?l.
    FILTER NOT EXISTS { ?p wdt:P576 [] }  # เลิกกิจการแล้ว
    FILTER NOT EXISTS { ?p wdt:P3999 [] } # มีวันปิดทำการถาวร
    OPTIONAL { ?p wdt:P18 ?img }
    OPTIONAL { ?p rdfs:label ?th FILTER(lang(?th)="th") } OPTIONAL { ?p rdfs:label ?en FILTER(lang(?en)="en") } OPTIONAL { ?p rdfs:label ?zh FILTER(lang(?zh)="zh") }
    OPTIONAL { ?thA schema:about ?p; schema:isPartOf <https://th.wikipedia.org/> }
    OPTIONAL { ?enA schema:about ?p; schema:isPartOf <https://en.wikipedia.org/> }
    OPTIONAL { ?zhA schema:about ?p; schema:isPartOf <https://zh.wikipedia.org/> }
    OPTIONAL { ?p wdt:P856 ?web }
    OPTIONAL { ?p wdt:P131+ ?prov. ?prov wdt:P31 wd:Q50198; rdfs:label ?provEn FILTER(lang(?provEn)="en") }
    OPTIONAL { ?p wdt:P131+ wd:Q1861. BIND(true AS ?bkk) }
  } GROUP BY ?p ORDER BY DESC(?links) LIMIT ${PER_KIND}`;
  const r = await get("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql), { headers: { Accept: "application/sparql-results+json" } }, 3);
  if (!r) return null;
  const v = (row, k) => row[k]?.value;
  return (await r.json()).results.bindings.map(row => {
    const [lng, lat] = (v(row, "coord").match(/Point\(([-\d.]+) ([-\d.]+)\)/) || []).slice(1).map(Number);
    const qid = v(row, "p").split("/").pop();
    const art = l => v(row, "art" + l);
    return {
      id: "wd-" + qid, wikidata: qid, kind, fame: +v(row, "links"),
      name: { th: v(row, "nameTh") || v(row, "nameEn"), en: v(row, "nameEn") || v(row, "nameTh"), zh: v(row, "nameZh") },
      lat: +lat.toFixed(5), lng: +lng.toFixed(5),
      province: v(row, "inBangkok") ? "bangkok" : provinceByEn(v(row, "province")),
      website: v(row, "website"),
      wiki: { th: art("Th"), en: art("En"), zh: art("Zh") },
      imageFile: v(row, "image") ? decodeURIComponent(v(row, "image").split("/").pop()) : undefined
    };
  }).filter(p => p.name.th && p.lat && !CLOSED.some(re => re.test(p.name.en || "")));
}

// Overpass (ฐานข้อมูล OpenStreetMap) มีหลายเซิร์ฟเวอร์ฟรี: เซิร์ฟเวอร์หลักไม่ว่างก็ลองตัวสำรอง
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
async function overpass(q) {
  for (const url of OVERPASS) {
    const r = await get(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 1);
    if (!r) continue;
    try {
      const j = await r.json();
      // เซิร์ฟเวอร์ไม่ว่างบางทีตอบ 200 แต่แนบ remark ว่าหมดเวลา → ลองเซิร์ฟเวอร์ถัดไป
      if (j.remark && /error|timed out|out of memory/i.test(j.remark)) { console.warn("Overpass:", j.remark.slice(0, 100)); continue; }
      return j.elements || [];
    } catch {}
  }
  return null;
}

// คาเฟ่สัตว์จาก OpenStreetMap: ชื่อร้านต้องบอกชัดว่าเป็นคาเฟ่ + สัตว์
const ANIMAL = "cat|dog|capybara|hedgehog|owl|meerkat|rabbit|bunny|alpaca|raccoon|husky|corgi|puppy|kitty|otter|แมว|หมา|สุนัข|กระต่าย|คาปิบารา|เม่น|นกฮูก|อัลปาก้า|แพะ|ทาสแมว";
const ANIMAL_CAFE = new RegExp(`(${ANIMAL})[\\s'’-]*(caf[eé]|coffee|คาเฟ่|cafe)|(caf[eé]|คาเฟ่)[\\s'’-]*(${ANIMAL})|แคทคาเฟ่|catcafe`, "i");
async function osmAnimalCafes() {
  const q = `[out:json][timeout:90];nwr["amenity"="cafe"]["name"~"${ANIMAL}",i](${BBOX});out center tags 600;`;
  const els = await overpass(q);
  if (!els) return null;
  return els.filter(e => ANIMAL_CAFE.test(e.tags.name) || ANIMAL_CAFE.test(e.tags["name:en"] || "")).map(e => ({
    id: `osm-${e.type[0]}${e.id}`, kind: "animalcafe", fame: ["website", "opening_hours", "phone", "contact:facebook", "contact:instagram", "name:en"].filter(k => e.tags[k]).length,
    name: { th: e.tags["name:th"] || e.tags.name, en: e.tags["name:en"] || e.tags.name, zh: e.tags["name:zh"] },
    lat: +(e.lat ?? e.center.lat).toFixed(5), lng: +(e.lon ?? e.center.lon).toFixed(5),
    website: e.tags.website || e.tags["contact:facebook"] || e.tags["contact:instagram"],
    hours: e.tags.opening_hours, phone: e.tags.phone || e.tags["contact:phone"],
    address: [e.tags["addr:housenumber"], e.tags["addr:street"], e.tags["addr:subdistrict"], e.tags["addr:district"]].filter(Boolean).join(" ") || undefined,
    provinceHint: e.tags["addr:province"] || e.tags["is_in:province"]
  }));
}

// เวลาเปิด/เว็บไซต์/ค่าเข้า/เบอร์โทร จาก OpenStreetMap ของสถานที่ที่ผูกกับ Wikidata
async function osmByWikidata(qids) {
  if (!qids.length) return {};
  const q = `[out:json][timeout:120];nwr["wikidata"~"^(${qids.join("|")})$"](${BBOX});out tags 600;`;
  const out = {};
  for (const e of (await overpass(q)) || []) {
    const t = e.tags, o = out[t.wikidata] ||= {};
    o.hours ||= t.opening_hours; o.website ||= t.website || t["contact:website"]; o.phone ||= t.phone || t["contact:phone"];
    o.fee ||= t.fee; o.charge ||= t.charge;
    o.address ||= [t["addr:housenumber"], t["addr:street"], t["addr:district"]].filter(Boolean).join(" ") || undefined;
  }
  return out;
}

// จังหวัดจากพิกัด (Nominatim, 1 คำขอ/วินาที, จำไว้ใน geocache)
const geocache = await readJSON("data/geocache.json", {});
async function provinceAt(lat, lng) {
  const k = `rev|${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (k in geocache) return geocache[k];
  await sleep(1100);
  const r = await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&accept-language=en&lat=${lat}&lon=${lng}`, {}, 1);
  const a = r ? (await r.json()).address || {} : null;
  if (!a) return null;
  return (geocache[k] = provinceByEn(a.state || a.province || a.city));
}

// คำอธิบายจาก Wikipedia (ตัดให้สั้น)
async function wikiSummary(url) {
  if (!url) return undefined;
  const m = url.match(/^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return undefined;
  await sleep(250);
  const r = await get(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`, {}, 1);
  const x = r ? (await r.json()).extract : "";
  if (!x) return undefined;
  return x.length > 420 ? x.slice(0, 420).replace(/[^.。!?]*$/, "") || x.slice(0, 420) + "…" : x;
}

// รูปจาก Commons + เครดิต (ผู้ถ่าย, สัญญาอนุญาต) ทีละ 40 ไฟล์
const stripHtml = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
async function commonsInfo(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const titles = files.slice(i, i + 40).map(f => "File:" + f).join("|");
    const r = await get(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=900&titles=${encodeURIComponent(titles)}`);
    const pages = r ? Object.values((await r.json()).query?.pages || {}) : [];
    for (const p of pages) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const md = ii.extmetadata || {};
      out[p.title.replace(/^File:/, "").replace(/ /g, "_")] = {
        image: ii.thumburl, imagePage: ii.descriptionurl,
        credit: [stripHtml(md.Artist?.value).slice(0, 60), md.LicenseShortName?.value].filter(Boolean).join(" · ") || "Wikimedia Commons"
      };
    }
    await sleep(500);
  }
  return out;
}

// ---------- ข่าวเทรนด์ ----------
const decode = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
const tag = (xml, n) => { const m = xml.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)); return m ? decode(m[1]) : ""; };
async function news(q) {
  const r = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:30d")}&hl=th&gl=TH&ceid=TH:th`, {}, 1);
  const xml = r ? await r.text() : "";
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1], source = tag(it, "source");
    let title = tag(it, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(it, "link"), source, date: new Date(tag(it, "pubDate")).toISOString().slice(0, 10) };
  });
}
// ชื่อหลักของสถานที่สำหรับจับคู่กับหัวข่าว ("อุทยานแห่งชาติเขาใหญ่" → "เขาใหญ่")
const GENERIC = /^(อุทยานแห่งชาติ|สวนสัตว์เปิด|สวนสัตว์|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|สวนน้ำ|สวนสนุก|หอศิลป์|สถานแสดงพันธุ์สัตว์น้ำ|คาเฟ่)\s*/;
const coreNames = p => [...new Set([p.name.th?.replace(GENERIC, ""), p.name.th, p.name.en].filter(n => n && n.length >= 4))];

// ---------- ทำงาน ----------
const prev = await readJSON("data/places.json", { places: [] });
const prevById = Object.fromEntries((prev.places || []).map(p => [p.id, p]));
let places = [];
for (const [kind, k] of Object.entries(KINDS)) {
  if (!k.classes.length) continue;
  let found = await wikidata(kind, k.classes);
  // Wikidata ไม่ว่าง → ใช้ชุดเดิมของหมวดนี้ไปก่อน ไม่ให้หมวดหายไปจากแอพ
  if (!found) { found = (prev.places || []).filter(p => p.kind === kind && p.wikidata); console.warn(`${kind}: Wikidata ไม่ตอบ ใช้ชุดเดิม ${found.length}`); }
  console.log(`${kind}: Wikidata ${found.length}`);
  places.push(...found);
  await sleep(1500);
}
let animal = await osmAnimalCafes();
// OSM ล่มทุกเซิร์ฟเวอร์ → ใช้รายการเดิมไปก่อน
if (!animal) { animal = (prev.places || []).filter(p => p.kind === "animalcafe"); console.warn("OSM ไม่ตอบ ใช้คาเฟ่สัตว์ชุดเดิม", animal.length); }
console.log(`animalcafe: OSM ${animal.length}`);
places.push(...animal.sort((a, b) => b.fame - a.fame).slice(0, PER_KIND * 2));

// สถานที่เดียวกันอาจอยู่หลายหมวด (เช่น สวนสัตว์ที่เป็นพิพิธภัณฑ์ด้วย) → เก็บหมวดแรก
const seen = new Set();
places = places.filter(p => !seen.has(p.id) && seen.add(p.id));

// เติมข้อมูล OSM / จังหวัด / คำอธิบาย / รูป
const osm = await osmByWikidata(places.filter(p => p.wikidata).map(p => p.wikidata));
const needImg = places.filter(p => p.imageFile && !(prevById[p.id]?.image && fresh(prevById[p.id]))).map(p => p.imageFile.replace(/ /g, "_"));
function fresh(old) { return old?.fetchedAt && (Date.now() - new Date(old.fetchedAt)) / 864e5 < REFRESH_DAYS; }
const imgs = await commonsInfo([...new Set(needImg)]);
for (const p of places) {
  const old = prevById[p.id];
  Object.assign(p, Object.fromEntries(Object.entries(osm[p.wikidata] || {}).filter(([k, v]) => v && !p[k])));
  // OSM ไม่ตอบรอบนี้ → ใช้เวลาเปิด/เว็บ/ค่าเข้าเดิม
  for (const k of ["hours", "website", "phone", "fee", "charge", "address"]) if (!p[k] && old?.[k]) p[k] = old[k];
  p.province ||= provinceByEn(p.provinceHint) || old?.province || await provinceAt(p.lat, p.lng);
  delete p.provinceHint;
  if (fresh(old)) {
    p.summary = old.summary; p.image = old.image; p.imagePage = old.imagePage; p.imageCredit = old.imageCredit; p.fetchedAt = old.fetchedAt;
  } else {
    p.summary = {};
    for (const l of ["th", "en", "zh"]) { const s = await wikiSummary(p.wiki?.[l]); if (s) p.summary[l] = s; }
    const im = p.imageFile && imgs[p.imageFile.replace(/ /g, "_")];
    if (im) { p.image = im.image; p.imagePage = im.imagePage; p.imageCredit = im.credit; }
    p.fetchedAt = new Date().toISOString();
  }
  delete p.imageFile;
}
places = places.filter(p => p.province);

// บอร์ดเทรนด์: ข่าวของแต่ละหมวด + นับว่าสถานที่ไหนอยู่ในข่าว
const trends = {};
for (const [kind, k] of Object.entries(KINDS)) {
  const items = [];
  for (const q of k.news) { items.push(...await news(q)); await sleep(1200); }
  // ตัดคำท้ายหัวข้อแบบอัลบั้มรูป (" รูปที่ 7")
  items.forEach(n => { n.title = n.title.replace(/\s*รูปที่\s*\d+\s*$/, "").trim(); });
  const uniq = [...new Map(items.map(n => [n.title, n])).values()]
    .filter(n => n.title.length >= 25 && !/^tiktok\s*·/i.test(n.title))
    .filter(n => TREND_WORDS.test(n.title) && k.topic.test(n.title) && !NOT_TREND.test(n.title) && !ABROAD.test(n.title))
    .sort((a, b) => b.date.localeCompare(a.date));
  trends[kind] = uniq.slice(0, 12);
}
const allNews = Object.values(trends).flat();
for (const p of places) {
  const names = coreNames(p);
  const hits = allNews.filter(n => names.some(nm => n.title.toLowerCase().includes(nm.toLowerCase())));
  p.trend = hits.length || undefined;
}
// เรียง: กำลังเป็นข่าวก่อน แล้วตามความดัง
places.sort((a, b) => (b.trend || 0) - (a.trend || 0) || b.fame - a.fame);

const byKind = places.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {});
console.log("สถานที่:", places.length, JSON.stringify(byKind), "· มีรูป", places.filter(p => p.image).length, "· อยู่ในข่าว", places.filter(p => p.trend).length);
console.log("ข่าวเทรนด์:", Object.entries(trends).map(([k, v]) => `${k} ${v.length}`).join(", "));
if (DRY) { console.log(JSON.stringify(places.slice(0, 3), null, 1)); process.exit(0); }
await save("data/places.json", JSON.stringify({ updatedAt: new Date().toISOString(), places, trends }, null, 1) + "\n");
await save("data/geocache.json", JSON.stringify(geocache, null, 1) + "\n");
