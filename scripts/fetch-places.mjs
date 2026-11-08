// รวบรวมสถานที่เที่ยวดังในไทย + ข่าวเทรนด์ → data/places.json (ฟรีทั้งหมด)
// - สวนสัตว์/สวนสนุก/พิพิธภัณฑ์/อุทยาน/คาเฟ่: Wikidata (เรียงตามความดัง = จำนวนภาษาที่มีบทความ Wikipedia)
//   รูปจาก Wikimedia Commons (พร้อมชื่อช่างภาพ/สัญญาอนุญาต), คำอธิบายจาก Wikipedia, เวลาเปิด/เว็บไซต์จาก OpenStreetMap
// - คาเฟ่สัตว์: OpenStreetMap (ชื่อร้านที่บอกชัดว่าเป็นคาเฟ่สัตว์)
// - บอร์ดเทรนด์: โพสต์รีวิวยอดฮิตช่วง 4 เดือนจาก Lemon8 (เสริมด้วยหัวข้อไวรัลจาก Google News)
// - ความถี่การค้นหา: ยอดเปิดอ่าน Wikipedia รายวัน + คำค้นมาแรงของ Google Trends
//   สถานที่ที่เป็นกระแส/คนค้นหาเพิ่มขึ้น ขึ้นป้ายและขึ้นก่อน (Instagram ห้ามดึงข้อมูลอัตโนมัติ จึงไม่ใช้)
// รัน: node scripts/fetch-places.mjs [--dry]
import { readFile, writeFile, rename } from "node:fs/promises";
import { specificPlaces, postFits, bestOwners, ownsPost } from "./place-quality.mjs";

const DRY = process.argv.includes("--dry");
const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const PER_KIND = 60;        // จำนวนสถานที่ดังจาก Wikidata สูงสุดต่อหมวด
// จำนวนสูงสุดจาก OpenStreetMap ต่อหมวด (เรียงจากข้อมูลครบที่สุด)
const OSM_LIMIT = { nightlife: 300, cafe: 250, animalcafe: 80, zoo: 150, themepark: 150, museum: 250, park: 180, nature: 300, landmark: 300 };
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
      const r = await fetch(url, { ...opt, headers: { "User-Agent": UA, ...(opt.headers || {}) }, signal: AbortSignal.timeout(opt.timeout || 90000) });
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
  // ชื่อจังหวัดภาษาไทยใน addr:province ("จังหวัดเชียงใหม่", "กรุงเทพมหานคร")
  const th = String(name || "").replace(/^จังหวัด|^จ\.\s*/, "").trim();
  if (/กรุงเทพ/.test(th)) return "bangkok";
  const byTh = th && PROVINCES.find(p => p.th === th);
  if (byTh) return byTh.id;
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
  park:       { topic: /อุทยาน|ดอย|ภู[ก-ฮ]|ทะเลหมอก|น้ำตก|แคมป์|camping|จุดชมวิว|เดินป่า|national park|เขาใหญ่|ป่า|ทุ่ง/i, classes: ["Q46169"], news: ["ที่เที่ยวธรรมชาติ ไวรัล", "จุดชมวิว ทะเลหมอก วัยรุ่น", "แคมป์ปิ้ง ฮิต เช็คอิน"] },
  // น้ำตก ชายหาด เกาะ
  nature:     { topic: /ทะเล|ชายหาด|หาด|เกาะ|น้ำตก|จุดชมวิว|วิว|ทะเลหมอก|beach|island|waterfall|viewpoint/i, classes: ["Q34038", "Q40080", "Q23442"], news: ["ทะเล ไวรัล วัยรุ่น", "น้ำตก เช็คอิน", "จุดชมวิว ไวรัล"] },
  nightlife:  { topic: /ผับ|บาร์|\bbar\b|\bpub\b|ร้านเหล้า|ร้านนั่งดื่ม|ค็อกเทล|cocktail|rooftop|รูฟท็อป|คราฟต์เบียร์|ดนตรีสด|ไนท์คลับ|ที่เที่ยวกลางคืน/i, classes: [], news: ["บาร์ลับ ไวรัล", "ร้านเหล้า เปิดใหม่ วัยรุ่น", "รูฟท็อปบาร์ วิวสวย"] },
  // วัดพุทธ โบราณสถาน
  landmark:   { topic: /วัด|แลนด์มาร์ก|landmark|โบราณสถาน|อุทยานประวัติศาสตร์|พระธาตุ|เจดีย์|ถนนคนเดิน|ตลาดน้ำ|ตลาด/i, classes: ["Q5393308", "Q839954"], news: ["วัดสวย ไวรัล", "แลนด์มาร์กใหม่ เช็คอิน", "ตลาด ไวรัล วัยรุ่น"] }
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
// เซิร์ฟเวอร์ที่ล้มเหลว 2 ครั้งในรอบนี้ → ข้าม (เดิมรอหมดเวลาทุกเซิร์ฟเวอร์ทุกหมวด เสียเวลารวมได้เกินชั่วโมง)
const overpassFails = {};
const T0 = Date.now(), mins = () => ((Date.now() - T0) / 60000).toFixed(1);
async function overpass(q) {
  for (const url of OVERPASS) {
    if ((overpassFails[url] || 0) >= 2) continue;
    const t = Date.now();
    const r = await get(url, { method: "POST", timeout: 120000, body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 1);
    console.log(`  Overpass ${new URL(url).host} ${r ? r.status : "ล้มเหลว"} ใน ${((Date.now() - t) / 1000).toFixed(0)} วิ`);
    if (!r) { overpassFails[url] = (overpassFails[url] || 0) + 1; continue; }
    try {
      const j = await r.json();
      // เซิร์ฟเวอร์ไม่ว่างบางทีตอบ 200 แต่แนบ remark ว่าหมดเวลา → ลองเซิร์ฟเวอร์ถัดไป
      if (j.remark && /error|timed out|out of memory/i.test(j.remark)) { console.warn("Overpass:", j.remark.slice(0, 100)); overpassFails[url] = (overpassFails[url] || 0) + 1; continue; }
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

// สถานที่จาก OpenStreetMap ตามประเภท (เสริม Wikidata ซึ่งมีแต่ที่ดังมากๆ)
const OSM_QUERY = {
  zoo: `nwr["tourism"="zoo"]["name"](${BBOX});nwr["tourism"="aquarium"]["name"](${BBOX});`,
  themepark: `nwr["tourism"="theme_park"]["name"](${BBOX});nwr["leisure"="water_park"]["name"](${BBOX});`,
  museum: `nwr["tourism"="museum"]["name"](${BBOX});`,
  park: `nwr["boundary"="national_park"]["name"](${BBOX});nwr["boundary"="protected_area"]["protect_class"="2"]["name"](${BBOX});`,
  nature: `nwr["natural"="beach"]["name"](${BBOX});nwr["waterway"="waterfall"]["name"](${BBOX});nwr["tourism"="viewpoint"]["name"](${BBOX});`,
  // แลนด์มาร์ก: จุดท่องเที่ยว/โบราณสถาน/วัดที่เป็นแหล่งท่องเที่ยว (มีข้อมูลอ้างอิง)
  landmark: `nwr["tourism"="attraction"]["name"](${BBOX});nwr["historic"~"^(archaeological_site|ruins|monument|castle)$"]["name"](${BBOX});nwr["amenity"="place_of_worship"]["religion"="buddhist"]["wikidata"](${BBOX});`,
  // ผับ/บาร์/ไนท์คลับ: เฉพาะร้านที่มีเวลาเปิด หรือเว็บ/เพจ (ข้อมูลพอให้ไปได้จริง)
  nightlife: `nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]["opening_hours"](${BBOX});nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]["website"](${BBOX});nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]["contact:facebook"](${BBOX});nwr["amenity"~"^(bar|pub|nightclub)$"]["name"]["contact:instagram"](${BBOX});`,
  // คาเฟ่ทั่วไปมีเป็นหมื่น → เอาเฉพาะร้านที่ข้อมูลครบ (เวลาเปิด + เว็บ/เพจ)
  cafe: `nwr["amenity"="cafe"]["name"]["opening_hours"]["website"](${BBOX});nwr["amenity"="cafe"]["name"]["opening_hours"]["contact:facebook"](${BBOX});nwr["amenity"="cafe"]["name"]["opening_hours"]["contact:instagram"](${BBOX});nwr["amenity"="cafe"]["name"]["tourism"="attraction"](${BBOX});`
};
// ร้านเครือข่าย/แฟรนไชส์ ไม่ใช่ "คาเฟ่ที่ไปเที่ยว"
const CHAIN = /amazon|อเมซอน|starbucks|สตาร์บัค|inthanin|อินทนิล|punthai|พันธุ์ไทย|true coffee|ทรู คอฟฟี่|black canyon|แบล็คแคนยอน|doi chaang|ดอยช้าง|coffee world|chao doi|ชาวดอย|kudsan|กาแฟพันธุ์|all cafe|7-?eleven|เซเว่น|ptt|tim hortons|%|mezzo|cafe de norasingh|wawee|วาวี|dunkin|mister donut|after you|swensen|s&p|bake a wish|kamu|ชาตรามือ|cha tra mue|bearhouse|tiger sugar/i;
// ผับ/บาร์: ไม่รวมอะโกโก้/สถานบริการ/อาบอบนวด/บาร์โฮสเตส (แอพแนะนำที่เที่ยวทั่วไป)
const ADULT_ONLY = /a.?go.?go|อะโกโก้|โคโยตี้|coyote|massage|นวด|soapy|lady ?boy|girls?\b|ladies|beer bar|เบียร์บาร์|strip|cabaret|host(ess)? bar|gentlemen|cannabis|weed|กัญชา|\bbuds?\b|\b420\b|dispensary/i;
const osmTagsFame = t => ["website", "contact:website", "opening_hours", "phone", "contact:phone", "contact:facebook", "contact:instagram", "name:en", "image", "wikimedia_commons", "description"].filter(k => t[k]).length + (t.wikidata ? 3 : 0) + (t.wikipedia ? 2 : 0);
async function osmKind(kind) {
  const q = `[out:json][timeout:150];(${OSM_QUERY[kind]});out center tags;`;
  const els = await overpass(q);
  if (!els) return null;
  return els.filter(e => e.tags?.name && (e.lat || e.center) && !(kind === "cafe" && (CHAIN.test(e.tags.name) || e.tags.brand))
      && !(kind === "nightlife" && (ADULT_ONLY.test(e.tags.name) || e.tags.brand || /hotel|hostel|lobby/i.test(e.tags.name))))
    .map(e => {
      const t = e.tags;
      const file = (t.wikimedia_commons || "").replace(/^File:/i, "") || (/commons\.wikimedia\.org\/wiki\/File:(.+)$/.exec(t.image || "") || [])[1];
      return {
        id: `osm-${e.type[0]}${e.id}`, kind, fame: osmTagsFame(t), osmWikidata: t.wikidata,
        name: { th: t["name:th"] || t.name, en: t["name:en"] || (/^[\x00-\x7F]+$/.test(t.name) ? t.name : undefined), zh: t["name:zh"] },
        lat: +(e.lat ?? e.center.lat).toFixed(5), lng: +(e.lon ?? e.center.lon).toFixed(5),
        website: t.website || t["contact:website"] || t["contact:facebook"] || t["contact:instagram"],
        hours: t.opening_hours, phone: t.phone || t["contact:phone"], fee: t.fee, charge: t.charge,
        address: [t["addr:housenumber"], t["addr:street"], t["addr:subdistrict"], t["addr:district"]].filter(Boolean).join(" ") || undefined,
        provinceHint: t["addr:province"] || t["is_in:province"],
        osmDescription: t["description:th"] || t.description,
        imageFile: file ? decodeURIComponent(file).replace(/ /g, "_") : undefined
      };
    })
    .sort((a, b) => b.fame - a.fame).slice(0, OSM_LIMIT[kind]);
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
let lookups = 0;
async function provinceAt(lat, lng) {
  const k = `rev|${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (k in geocache) return geocache[k];
  if (lookups >= 300) return null; // เกินโควต้ารอบนี้ → สถานที่นี้รอรอบหน้า
  await sleep(1100);
  const r = await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&accept-language=en&lat=${lat}&lon=${lng}`, {}, 1);
  const a = r ? (await r.json()).address || {} : null;
  if (!a) return null;
  geocache[k] = provinceByEn(a.state || a.province || a.city);
  // รอบแรกต้องค้นหลายร้อยแห่ง → บันทึกแคชเป็นระยะ ถ้าโดนหยุดกลางทางรอบหน้าจะไม่ต้องค้นซ้ำ
  if (++lookups % 25 === 0 && !DRY) await save("data/geocache.json", JSON.stringify(geocache, null, 1) + "\n");
  return geocache[k];
}

// คำอธิบายจาก Wikipedia (ตัดให้สั้น)
// บทความถูก redirect ไปเรื่องอื่น (เช่น "บางกอก ซี ไลฟ์" → "สยามพารากอน") → คำอธิบายไม่ใช่ของที่นี่ ไม่ใช้
const nameCore = s => String(s || "").replace(/(.*?)/g, "").replace(/[s_]+/g, "").replace(/^(อุทยานแห่งชาติ|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|สวนสัตว์|วัด|น้ำตก|หาด|เกาะ|the)/i, "").slice(0, 4).toLowerCase();
const aboutPlace = (text, ...names) => { const t = String(text || "").replace(/s+/g, "").toLowerCase(); return names.some(n => !n || t.includes(nameCore(n))); };
async function wikiSummary(url, name) {
  if (!url) return undefined;
  const m = url.match(/^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return undefined;
  await sleep(250);
  const r = await get(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`, {}, 1);
  const j = r ? await r.json() : {}, x = j.extract || "";
  if (!x) return undefined;
  if (j.title && j.title.replace(/ /g, "_") !== decodeURIComponent(m[2]) && !aboutPlace(x, name)) return undefined;
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
// ---------- เทรนด์วัยรุ่นจาก Lemon8 (โพสต์รีวิวสาธารณะ, robots.txt อนุญาต) ----------
// ดึงหน้า "ค้นพบ" ของคำค้น → โพสต์ (ชื่อ, ยอดไลก์, ผู้โพสต์, ลิงก์รูปปกพรีวิว) · วันที่โพสต์ถอดจากเลขโพสต์
const LEMON8 = {
  cafe: ["คาเฟ่เปิดใหม่", "คาเฟ่"], animalcafe: ["คาเฟ่แมว", "คาเฟ่สัตว์", "คาเฟ่หมา"], zoo: ["สวนสัตว์", "ฟาร์มสัตว์"],
  themepark: ["สวนสนุก", "สวนน้ำ"], museum: ["นิทรรศการ", "พิพิธภัณฑ์"], park: ["อุทยานแห่งชาติ", "กางเต็นท์", "ทะเลหมอก"],
  nature: ["น้ำตก", "ทะเล", "จุดชมวิว"], nightlife: ["บาร์ลับ", "ร้านเหล้า", "รูฟท็อปบาร์"], landmark: ["วัดสวย", "ที่เที่ยว", "ตลาดน้ำ"]
};
const LEMON8_DAYS = 120;
// จังหวัด/ย่านเที่ยวยอดนิยม → หน้า "ที่เที่ยว…/คาเฟ่…" ใน Lemon8 (ช่วยจับกระแสรายสถานที่)
const AREAS = ["กรุงเทพ", "เชียงใหม่", "เชียงราย", "ภูเก็ต", "กระบี่", "พัทยา", "หัวหิน", "เขาใหญ่", "กาญจนบุรี", "อยุธยา", "น่าน", "ระยอง", "เกาะช้าง", "นครปฐม", "อัมพวา", "ปาย", "ขอนแก่น", "สงขลา", "ราชบุรี", "จันทบุรี"];
const BUZZ_PER_RUN = 120; // ค้นชื่อสถานที่ใน Lemon8 ต่อรอบ (~2.5 วินาที/ครั้ง) // เอาเฉพาะโพสต์ช่วง 4 เดือนล่าสุด = เทรนด์ช่วงนี้
async function lemon8(keyword) {
  await sleep(2500);
  const r = await get(`https://www.lemon8-app.com/experience/${encodeURIComponent(keyword)}?region=th`, { headers: { "Accept-Language": "th" } }, 1);
  if (!r) return [];
  const html = await r.text();
  const big = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).sort((a, b) => b.length - a.length)[0] || "";
  let data; try { data = JSON.parse(decodeURIComponent(big)); } catch { return []; }
  const found = new Map();
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.groupId && typeof o.title === "string" && !found.has(o.groupId)) found.set(o.groupId, o);
    for (const v of Object.values(o)) if (v && typeof v === "object") walk(v);
  })(data);
  return [...found.values()].map(o => {
    const author = [o, ...Object.values(o)].find(v => v && typeof v === "object" && v.linkName) || {};
    const date = new Date(Number(BigInt(o.groupId) >> 32n) * 1000);
    return {
      title: o.title.replace(/\s+/g, " ").trim(), likes: +o.articleLikes || 0, date: date.toISOString().slice(0, 10),
      link: `https://www.lemon8-app.com/${author.linkName ? "@" + author.linkName + "/" : ""}${o.groupId}?region=th`,
      source: `Lemon8${author.nickName ? " · " + author.nickName : ""}`, from: "lemon8",
      // รูปปกโพสต์: ลิงก์พรีวิวของ Lemon8 เอง (มีลายน้ำชื่อผู้โพสต์) แสดงแบบลิงก์ตรง ไม่ดาวน์โหลดเก็บ
      image: [o.largeImage?.url, o.imageList?.[0]?.url].find(u => /^https:\/\/www\.lemon8-app\.com\/seo\/image\?/.test(u || ""))
    };
  }).filter(p => p.title.length >= 8 && (Date.now() - new Date(p.date)) / 864e5 <= LEMON8_DAYS);
}

// ---------- ความถี่การค้นหา ----------
// ยอดคนเปิดอ่านหน้า Wikipedia ของสถานที่ (รายวัน, ฟรีจาก Wikimedia) = ตัวแทนว่ามีคนค้นหาที่นี่บ่อยแค่ไหน
async function pageviews(url) {
  const m = url?.match(/^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return null;
  const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, "");
  await sleep(150);
  const r = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${m[1]}.wikipedia/all-access/user/${m[2]}/daily/${ymd(new Date(Date.now() - 76 * 864e5))}/${ymd(new Date(Date.now() - 864e5))}`, {}, 1);
  const items = r ? (await r.json()).items || [] : [];
  if (items.length < 20) return null;
  const avg = a => a.reduce((s, x) => s + x.views, 0) / Math.max(1, a.length);
  return { recent: avg(items.slice(-14)), before: avg(items.slice(0, -14)) };
}
// คำค้นมาแรงในไทยรายวันจาก Google Trends (RSS ทางการ) — สะสมไว้ 14 วัน
async function googleTrends() {
  const r = await get("https://trends.google.com/trending/rss?geo=TH", {}, 1);
  const xml = r ? await r.text() : "";
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({ term: tag(m[1], "title"), traffic: tag(m[1], "ht:approx_traffic"), date: new Date().toISOString().slice(0, 10) })).filter(x => x.term);
}

// ชื่อหลักของสถานที่สำหรับจับคู่กับหัวข่าว ("อุทยานแห่งชาติเขาใหญ่" → "เขาใหญ่")
const GENERIC = /^(อุทยานแห่งชาติ|สวนสัตว์เปิด|สวนสัตว์|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|สวนน้ำ|สวนสนุก|หอศิลป์|สถานแสดงพันธุ์สัตว์น้ำ|คาเฟ่|วัด|น้ำตก)\s*/;
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
console.log(`[${mins()} นาที] Wikidata เสร็จ`);
let animal = await osmAnimalCafes();
// OSM ล่มทุกเซิร์ฟเวอร์ → ใช้รายการเดิมไปก่อน
if (!animal) { animal = (prev.places || []).filter(p => p.kind === "animalcafe"); console.warn("OSM ไม่ตอบ ใช้คาเฟ่สัตว์ชุดเดิม", animal.length); }
console.log(`animalcafe: OSM ${animal.length}`);
places.push(...animal.sort((a, b) => b.fame - a.fame).slice(0, OSM_LIMIT.animalcafe));

// เสริมจาก OpenStreetMap ทุกหมวด · ที่ซ้ำกับ Wikidata (ผูก wikidata เดียวกัน หรือชื่อ/ตำแหน่งเดียวกัน) ข้าม
const km = (a, b) => { const r = x => x * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const nm = s => String(s || "").toLowerCase().replace(/[^a-z0-9฀-๿]/g, "");
for (const kind of Object.keys(OSM_QUERY)) {
  await sleep(2000);
  let found = await osmKind(kind);
  // เซิร์ฟเวอร์ยุ่ง → พักแล้วลองใหม่อีกรอบ
  if (!found) { await sleep(30000); found = await osmKind(kind); }
  if (!found) { found = (prev.places || []).filter(p => p.kind === kind && p.id.startsWith("osm-")); console.warn(`${kind}: OSM ไม่ตอบ ใช้ชุดเดิม ${found.length}`); }
  const qids = new Set(places.map(p => p.wikidata).filter(Boolean));
  const added = found.filter(o => !(o.osmWikidata && qids.has(o.osmWikidata))
    && !places.some(p => km(p, o) < 0.15 || (km(p, o) < 1.5 && (nm(p.name.th) === nm(o.name.th) || nm(p.name.en) && nm(p.name.en) === nm(o.name.en)))));
  console.log(`${kind}: OSM ${found.length} → เพิ่มใหม่ ${added.length}`);
  places.push(...added);
}
console.log(`[${mins()} นาที] OpenStreetMap เสร็จ`);
// ชื่อเป็นคำกว้างๆ ("น้ำตก", "Cat cafe") = ข้อมูลไม่พอให้คนหาเจอ และไปตรงกับโพสต์เทรนด์ทั่วไปผิดๆ → ตัดออก
const GENERIC_NAME = /^(น้ำตก|ชายหาด|หาด|จุดชมวิว|ร้านกาแฟ|คาเฟ่|คาเฟ่แมว|คาเฟ่หมา|แมวคาเฟ่|วัด|สวนสาธารณะ|พิพิธภัณฑ์|สวนสัตว์|สวนน้ำ|อุทยาน|ถ้ำ|cafe|café|coffee|coffee shop|cat ?cafe|dog ?cafe|waterfall|beach|view ?point|zoo|museum|park|temple|cave)\s*\d*$/i;
for (let i = places.length - 1; i >= 0; i--) if (GENERIC_NAME.test((places[i].name.th || places[i].name.en || "").trim())) places.splice(i, 1);
// ชื่อกว้างเกินไป ("บางแสน" → "หาดบางแสน") / ไม่ใช่สถานที่ / ซ้ำกับที่ใกล้ๆ
places = specificPlaces(places);

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
    p.summary = old.summary;
    if (p.summary?.th && p.wiki?.th && !aboutPlace(p.summary.th, p.name?.th, decodeURIComponent(p.wiki.th.split("/wiki/")[1] || ""))) delete p.summary.th;
    p.image = old.image; p.imagePage = old.imagePage; p.imageCredit = old.imageCredit; p.fetchedAt = old.fetchedAt;
  } else {
    p.summary = {};
    for (const l of ["th", "en", "zh"]) { const s = await wikiSummary(p.wiki?.[l], l === "th" ? p.name?.th : null); if (s) p.summary[l] = s; }
    // สถานที่จาก OSM ไม่มีบทความ Wikipedia → ใช้คำอธิบายใน OSM (ถ้ามี)
    if (!Object.keys(p.summary).length && p.osmDescription) p.summary.th = p.osmDescription.slice(0, 300);
    const im = p.imageFile && imgs[p.imageFile.replace(/ /g, "_")];
    if (im) { p.image = im.image; p.imagePage = im.imagePage; p.imageCredit = im.credit; }
    p.fetchedAt = new Date().toISOString();
  }
  delete p.imageFile; delete p.osmDescription; delete p.osmWikidata;
}
places = places.filter(p => p.province);
console.log(`[${mins()} นาที] จังหวัด/คำอธิบาย/รูป เสร็จ (ค้นจังหวัดใหม่ ${lookups})`);

// บอร์ดเทรนด์: โพสต์ Lemon8 ยอดไลก์สูงช่วง 4 เดือนล่าสุด + หัวข้อไวรัลจากข่าว (เสริมเมื่อโพสต์น้อย)
const trends = {};
const clean = n => !NOT_TREND.test(n.title) && !ABROAD.test(n.title);
// คลังโพสต์ Lemon8 ช่วง 4 เดือน (ทุกโพสต์ ไม่ใช่แค่ 10 อันดับบนบอร์ด) ใช้นับว่าสถานที่ไหนถูกพูดถึงบ่อย
const pool = new Map();
const addPool = list => list.filter(clean).forEach(p => pool.set(p.link, p));
for (const [kind, k] of Object.entries(KINDS)) {
  const posts = [];
  for (const kw of LEMON8[kind] || []) posts.push(...await lemon8(kw));
  addPool(posts);
  // ไลก์สูงสุด 10 โพสต์ + โพสต์ใหม่ล่าสุดที่ยอดนิยม (ไลก์ ≥ 100) อีก 6 → แอพเรียงตามวันที่
  const all = [...new Map(posts.map(p => [p.link, p])).values()].filter(clean);
  const fresh = all.filter(p => p.likes >= 100).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  const lemon = [...new Map([...[...all].sort((a, b) => b.likes - a.likes).slice(0, 10), ...fresh].map(p => [p.link, p])).values()];
  let items = lemon;
  if (lemon.length < 6) {
    const raw = [];
    for (const q of k.news) { raw.push(...await news(q)); await sleep(1200); }
    // ตัดคำท้ายหัวข้อแบบอัลบั้มรูป (" รูปที่ 7")
    raw.forEach(n => { n.title = n.title.replace(/\s*รูปที่\s*\d+\s*$/, "").trim(); });
    const viral = [...new Map(raw.map(n => [n.title, n])).values()]
      .filter(n => n.title.length >= 25 && !/^tiktok\s*·/i.test(n.title))
      .filter(n => TREND_WORDS.test(n.title) && k.topic.test(n.title) && clean(n))
      .sort((a, b) => b.date.localeCompare(a.date));
    items = [...lemon, ...viral].slice(0, 10);
  }
  trends[kind] = items;
  console.log(`เทรนด์ ${kind}: Lemon8 ${lemon.length} + ข่าวไวรัล ${items.length - lemon.length}`);
}

console.log(`[${mins()} นาที] บอร์ดเทรนด์ เสร็จ`);
// คำค้นมาแรงจาก Google: สะสม 14 วัน
const searchTrends = [...await googleTrends(), ...(prev.searchTrends || [])]
  .filter((x, i, a) => a.findIndex(y => y.term === x.term) === i && (Date.now() - new Date(x.date)) / 864e5 <= 14).slice(0, 400);

// ความถี่การค้นหาจาก Wikipedia: ทุกสถานที่ที่มีบทความ (ไทยก่อน ไม่มีใช้อังกฤษ)
let pvOk = 0;
for (const p of places) {
  const pv = await pageviews(p.wiki?.th) || await pageviews(p.wiki?.en);
  if (!pv) { p.views = prevById[p.id]?.views; p.rising = prevById[p.id]?.rising; continue; }
  pvOk++;
  p.views = Math.round(pv.recent);
  // ค้นหาเพิ่มขึ้นชัดเจน: 2 สัปดาห์ล่าสุดมากกว่าช่วงก่อนหน้า 40% ขึ้นไป และมีคนค้นพอสมควร
  p.rising = pv.before > 0 && pv.recent >= 15 && pv.recent / pv.before >= 1.4 ? Math.round((pv.recent / pv.before - 1) * 100) : undefined;
}
console.log(`ยอดค้นหา Wikipedia: ${pvOk} แห่ง · ค้นหาเพิ่มขึ้น ${places.filter(p => p.rising).length} · คำค้นมาแรง Google สะสม ${searchTrends.length}`);

// ---------- คะแนนกระแสรายสถานที่ ----------
// 1) โพสต์ท่องเที่ยวรายจังหวัด/ย่านยอดฮิตใน Lemon8 (เพิ่มคลังโพสต์ให้กว้าง)
for (const area of AREAS) for (const kw of [`ที่เที่ยว${area}`, `คาเฟ่${area}`]) addPool(await lemon8(kw));
// 2) ค้นชื่อสถานที่ใน Lemon8 ตรงๆ (หมุนเวียน วันละ BUZZ_PER_RUN แห่ง ที่ดัง/คนค้นเยอะก่อน ผลใช้ได้ 10 วัน)
const slimPost = x => ({ title: x.title.slice(0, 140), likes: x.likes, date: x.date, link: x.link, source: x.source, image: x.image });
const daysAgo = t => (Date.now() - new Date(t || 0)) / 864e5;
// ชื่อสั้น/คำทั่วไป ("ใหม่", "กลาง") ไปตรงกับโพสต์อื่นมั่ว → ใช้เฉพาะชื่อยาว 6 ตัวอักษรขึ้นไป
const buzzNames = p => coreNames(p).map(n => n.toLowerCase().trim()).filter(n => n.length >= 6);
// + โพสต์ต้องเป็นเรื่องของที่นี่จริง: ที่เที่ยวธรรมชาติไม่รับรีวิวร้าน/ที่พัก · โพสต์ที่ตรงกับชื่อสถานที่อื่นที่เจาะจงกว่า (ชื่อยาวกว่า) ให้ที่นั้น
let BEST = new Map();
const mentions = (p, posts) => { const names = buzzNames(p); if (!names.length) return []; return posts.filter(x => names.some(nm => x.title.toLowerCase().includes(nm)) && postFits(x, p) && ownsPost(x, names, BEST)); };
for (const p of places) if (prevById[p.id]?.l8 && daysAgo(prevById[p.id].l8.at) <= 10) p.l8 = prevById[p.id].l8;
const due = places.filter(p => !p.l8).sort((a, b) => (b.views || 0) / 20 + (b.fame || 0) + (b.image ? 5 : 0) - ((a.views || 0) / 20 + (a.fame || 0) + (a.image ? 5 : 0))).slice(0, BUZZ_PER_RUN);
console.log(`[${mins()} นาที] ยอดค้นหา + คลังรายจังหวัด เสร็จ`);
for (const p of due) {
  if (Date.now() - T0 > 40 * 60000) { console.warn("ใช้เวลาเกิน 40 นาที หยุดค้นชื่อสถานที่ใน Lemon8 ไว้รอบหน้า"); break; }
  const q = p.name.th?.length >= 4 ? p.name.th : p.name.en;
  if (!q) continue;
  const m = mentions(p, (await lemon8(q)).filter(clean));
  p.l8 = { n: m.length, likes: m.reduce((s, x) => s + x.likes, 0), at: new Date().toISOString().slice(0, 10), posts: m.sort((a, b) => b.likes - a.likes).slice(0, 4).map(slimPost) };
}
// 3) รวมคะแนน: โพสต์ที่พูดถึง (ถ่วงยอดไลก์) + คำค้นมาแรง Google + ยอดค้นหา Wikipedia ที่พุ่งขึ้น
const poolPosts = [...pool.values()];
BEST = bestOwners(poolPosts, places, buzzNames);
for (const p of places) {
  const names = buzzNames(p);
  const m = mentions(p, poolPosts);
  const google = searchTrends.filter(x => names.some(nm => x.term.toLowerCase().includes(nm) || nm.includes(x.term.toLowerCase()) && x.term.length >= 4)).length;
  const lemonScore = Math.max(m.reduce((s, x) => s + 1 + Math.log10(1 + x.likes), 0), p.l8 ? p.l8.n + Math.log10(1 + p.l8.likes) * 1.5 : 0);
  const hot = lemonScore + google * 4 + (p.rising ? 2 + Math.min(p.rising, 300) / 100 : 0);
  p.hot = hot >= 3 ? +hot.toFixed(1) : undefined;           // คะแนนกระแส (ใช้เรียงลำดับแนะนำ)
  p.trend = (m.length + (p.l8?.n || 0) + google) || undefined; // จำนวนครั้งที่ถูกพูดถึง (ป้าย 🔥)
  // โพสต์เทรนด์ที่พูดถึงที่นี่ (แสดงในหน้ารายละเอียด) — รวมจากคลังรายจังหวัด + ค้นชื่อตรง, ยอดไลก์สูงก่อน
  const posts = [...new Map([...m.map(slimPost), ...(p.l8?.posts || []).filter(x => postFits(x, p))].map(x => [x.link, x])).values()].sort((a, b) => b.likes - a.likes).slice(0, 4);
  if (posts.length) p.posts = posts; else delete p.posts;
  if (!p.hot) delete p.trend;
}
console.log(`[${mins()} นาที] เสร็จทั้งหมด`);
console.log(`คลังโพสต์ Lemon8 ${pool.size} โพสต์ · ค้นชื่อสถานที่ ${due.length} แห่ง · มีกระแส ${places.filter(p => p.hot).length} แห่ง`);
// เรียง: คะแนนกระแส → คนค้นหาเพิ่มขึ้น → คนค้นหาเยอะ → ความดัง
places.sort((a, b) => (b.hot || 0) - (a.hot || 0) || (b.rising ? 1 : 0) - (a.rising ? 1 : 0) || (b.views || 0) - (a.views || 0) || b.fame - a.fame);
console.log("มาแรง 10 อันดับ:", places.filter(p => p.hot).slice(0, 10).map(p => `${p.name.th || p.name.en} (${p.hot})`).join(", "));

const byKind = places.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {});
console.log("สถานที่:", places.length, JSON.stringify(byKind), "· มีรูป", places.filter(p => p.image).length, "· อยู่ในข่าว", places.filter(p => p.trend).length);
console.log("เทรนด์:", Object.entries(trends).map(([k, v]) => `${k} ${v.length}`).join(", "));
if (DRY) { console.log(JSON.stringify(places.slice(0, 3), null, 1)); process.exit(0); }
await save("data/places.json", JSON.stringify({ updatedAt: new Date().toISOString(), places, trends, searchTrends }, null, 1) + "\n");
await save("data/geocache.json", JSON.stringify(geocache, null, 1) + "\n");
