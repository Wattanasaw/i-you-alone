// สถานที่จาก OpenStreetMap แยกทีละจังหวัด (ทุกหมวด) — ให้ทุกจังหวัดมีครบทุกหมวด ไม่ใช่แค่เมืองใหญ่
// เดิมดึงทั้งประเทศแล้วเอา N อันดับแรก → กรุงเทพฯ ได้ร้านน้อย จังหวัดเล็กแทบไม่มี และไม่มีหมวดร้านอาหารเลย
// ต่อจังหวัด: ร้านอาหาร คาเฟ่ ผับ/บาร์ พิพิธภัณฑ์ สวนสัตว์/อควาเรียม สวนสนุก/สวนน้ำ ธรรมชาติ แลนด์มาร์ก
// เลือกร้านที่มีข้อมูลพอให้ไปได้จริง (เวลาเปิด / เว็บ / เพจ / เบอร์โทร) เรียงตามความครบของข้อมูล · ตัดร้านเครือข่าย/แฟรนไชส์
// ผลจำไว้ใน data/osm-provinces.json · แต่ละรอบอัปเดตจังหวัดที่เก่าสุด (ค่าเริ่มต้น 20 จังหวัด/รอบ, ครบทุกจังหวัดใน ~4 วัน)
import { readFile, writeFile, rename } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJSON = async (p, fb) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return fb; } };
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// จำนวนสูงสุดต่อจังหวัด [จังหวัดทั่วไป, จังหวัดท่องเที่ยวหลัก, กรุงเทพฯ]
// (2026-11: เพิ่มจากเดิมหลายเท่า — เดิมจังหวัดเล็กได้ที่เที่ยวแค่ 1-5 แห่ง น้อยกว่าความจริงมาก)
export const CAPS = {
  restaurant: [25, 60, 200], cafe: [25, 60, 200], nightlife: [10, 40, 100], museum: [40, 40, 100],
  zoo: [20, 20, 30], themepark: [20, 20, 30], nature: [100, 150, 40], landmark: [80, 120, 200]
};
const BIG = new Set(["chiang-mai", "phuket", "chonburi", "krabi", "surat-thani", "prachuap-khiri-khan", "chiang-rai", "nakhon-ratchasima", "phang-nga", "rayong", "kanchanaburi", "phra-nakhon-si-ayutthaya", "khon-kaen", "songkhla", "nakhon-pathom", "nonthaburi", "samut-prakan", "pathum-thani"]);
const capOf = (kind, prov) => CAPS[kind][prov === "bangkok" ? 2 : BIG.has(prov) ? 1 : 0];

// ร้านเครือข่าย/แฟรนไชส์ (ไม่ใช่ "ร้านที่ไปเที่ยว")
const CHAIN = /amazon|อเมซอน|starbucks|สตาร์บัค|inthanin|อินทนิล|punthai|พันธุ์ไทย|true coffee|ทรู คอฟฟี่|black canyon|แบล็คแคนยอน|doi chaang|ดอยช้าง|coffee world|chao doi|ชาวดอย|kudsan|กาแฟพันธุ์|all cafe|7-?eleven|เซเว่น|\bptt\b|tim hortons|%|mezzo|cafe de norasingh|wawee|วาวี|dunkin|mister donut|after you|swensen|s&p|bake a wish|kamu|ชาตรามือ|cha tra mue|bearhouse|tiger sugar|\bmk\b|เอ็มเค|kfc|เคเอฟซี|mcdonald|แมคโดนัลด์|pizza hut|พิซซ่าฮัท|the pizza company|เดอะพิซซ่า|burger king|เบอร์เกอร์คิง|subway|ซับเวย์|yayoi|ยาโยอิ|fuji|ฟูจิ|bar ?b ?q plaza|บาร์บีคิวพลาซ่า|sizzler|ซิซซ์เลอร์|shabushi|ชาบูชิ|sukishi|ซูกิชิ|oishi|โออิชิ|chester|เชสเตอร์|texas chicken|hot ?pot|ฮอทพอท|coca|โคคา|daidomon|ไดโดมอน|tummour|ตำมั่ว|laem charoen|แหลมเจริญ|santa ?fe|ซานตาเฟ่|kenshin|ichiban|อิชิบัน|hachiban|ฮะจิบัง|sushiro|ซูชิโร่|dairy queen|bonchon|บอนชอน|chabuton|ชาบูตง|zen japanese|aka|nara thai|food ?court|ฟู้ดคอร์ท|canteen|โรงอาหาร/i;
const ADULT_ONLY = /a.?go.?go|อะโกโก้|โคโยตี้|coyote|massage|นวด|soapy|lady ?boy|girls?\b|ladies|beer bar|เบียร์บาร์|strip|cabaret|host(ess)? bar|gentlemen|cannabis|weed|กัญชา|\bbuds?\b|\b420\b|dispensary/i;
const ANIMAL = /(cat|dog|capybara|hedgehog|owl|meerkat|rabbit|bunny|alpaca|raccoon|husky|corgi|puppy|kitty|otter|แมว|หมา|สุนัข|กระต่าย|คาปิบารา|เม่น|นกฮูก|อัลปาก้า|ทาสแมว)[\s'’-]*(caf[eé]|coffee|คาเฟ่)|(caf[eé]|คาเฟ่)[\s'’-]*(cat|dog|แมว|หมา)/i;
const INFO = ["opening_hours", "website", "contact:website", "contact:facebook", "contact:instagram", "phone", "contact:phone"];
const fameOf = t => ["website", "contact:website", "opening_hours", "phone", "contact:phone", "contact:facebook", "contact:instagram", "name:en", "name:th", "image", "wikimedia_commons", "description", "cuisine", "addr:street"].filter(k => t[k]).length + (t.wikidata ? 3 : 0) + (t.wikipedia ? 2 : 0);

function kindOf(t) {
  const a = t.amenity, to = t.tourism;
  if (a === "restaurant") return "restaurant";
  if (a === "cafe") return ANIMAL.test(t.name) ? "animalcafe" : "cafe";
  if (/^(bar|pub|nightclub)$/.test(a || "")) return "nightlife";
  if (to === "zoo" || to === "aquarium") return "zoo";
  if (to === "theme_park" || t.leisure === "water_park") return "themepark";
  if (to === "museum" || to === "gallery") return "museum";
  if (t.natural === "beach" || t.waterway === "waterfall" || to === "viewpoint" || t.natural === "cave_entrance" || (/^(island|islet)$/.test(t.place || "") && (t.wikidata || t["name:en"]))) return "nature";
  if (to === "attraction" || /^(archaeological_site|ruins|monument|castle|memorial|temple)$/.test(t.historic || "") || (a === "place_of_worship" && (t.wikidata || t.tourism || t.wikipedia))) return "landmark";
  // ตลาดน้ำ ไนท์มาร์เก็ต ถนนคนเดิน (ต้องมีข้อมูลอ้างอิง กันตลาดสดทั่วไป) · สวนสาธารณะที่มีชื่อเสียง (มี Wikidata)
  if (a === "marketplace" && (t.wikidata || t.website || t.opening_hours || t["name:en"])) return "landmark";
  if (t.leisure === "park" && t.wikidata) return "landmark";
  return null;
}
const FOOD = new Set(["restaurant", "cafe", "animalcafe", "nightlife"]);
function keep(kind, t) {
  if (!t.name || t.brand || t["brand:wikidata"]) return false;
  if (FOOD.has(kind)) {
    if (CHAIN.test(t.name) || CHAIN.test(t["name:en"] || "")) return false;
    if (kind === "nightlife" && (ADULT_ONLY.test(t.name) || /hotel|hostel|lobby/i.test(t.name))) return false;
    // ร้าน: ต้องมีข้อมูลให้ไปได้จริงอย่างน้อย 1 อย่าง
    return INFO.some(k => t[k]) || !!t.wikidata;
  }
  return true;
}
const query = area => `[out:json][timeout:180];area(${area})->.a;(
nwr["amenity"~"^(restaurant|cafe|bar|pub|nightclub)$"]["name"](area.a);
nwr["tourism"~"^(zoo|aquarium|theme_park|museum|gallery|attraction|viewpoint)$"]["name"](area.a);
nwr["natural"="cave_entrance"]["name"](area.a);
nwr["place"~"^(island|islet)$"]["name"](area.a);
nwr["amenity"="marketplace"]["name"](area.a);
nwr["leisure"="park"]["name"]["wikidata"](area.a);
nwr["amenity"="place_of_worship"]["religion"="buddhist"]["tourism"](area.a);
nwr["amenity"="place_of_worship"]["religion"="buddhist"]["wikipedia"](area.a);
nwr["leisure"="water_park"]["name"](area.a);
nwr["natural"="beach"]["name"](area.a);
nwr["waterway"="waterfall"]["name"](area.a);
nwr["historic"~"^(archaeological_site|ruins|monument|castle|memorial|temple)$"]["name"](area.a);
nwr["amenity"="place_of_worship"]["religion"="buddhist"]["wikidata"](area.a);
);out center tags;`;

function toPlace(e, kind, prov) {
  const t = e.tags;
  const file = (t.wikimedia_commons || "").replace(/^File:/i, "") || (/commons\.wikimedia\.org\/wiki\/File:(.+)$/.exec(t.image || "") || [])[1];
  return {
    id: `osm-${e.type[0]}${e.id}`, kind, fame: fameOf(t), osmWikidata: t.wikidata, province: prov,
    name: { th: t["name:th"] || t.name, en: t["name:en"] || (/^[\x00-\x7F]+$/.test(t.name) ? t.name : undefined), zh: t["name:zh"] },
    lat: +(e.lat ?? e.center.lat).toFixed(5), lng: +(e.lon ?? e.center.lon).toFixed(5),
    website: t.website || t["contact:website"] || t["contact:facebook"] || t["contact:instagram"],
    hours: t.opening_hours, phone: t.phone || t["contact:phone"], fee: t.fee, charge: t.charge,
    cuisine: t.cuisine,
    address: [t["addr:housenumber"], t["addr:street"], t["addr:subdistrict"], t["addr:district"]].filter(Boolean).join(" ") || undefined,
    osmDescription: t["description:th"] || t.description,
    imageFile: file ? decodeURIComponent(file).replace(/ /g, "_") : undefined
  };
}

// overpass(q) → elements | null  ·  provinceByEn(name) → id จังหวัด
export async function osmProvincePlaces({ overpass, provinceByEn, perRun = 20, minutes = 15, log = console.log }) {
  const cache = await readJSON("data/osm-provinces.json", {});
  cache._areas ||= {};
  // รหัสพื้นที่ของแต่ละจังหวัด (relation ที่มี ISO3166-2 = TH-xx)
  if (Object.keys(cache._areas).length < 77) {
    const rel = await overpass(`[out:json][timeout:60];rel["ISO3166-2"~"^TH-"]["admin_level"="4"];out tags;`);
    for (const r of rel || []) { const id = provinceByEn(r.tags["name:en"] || r.tags.name); if (id) cache._areas[id] = 3600000000 + r.id; }
  }
  const provs = Object.keys(cache._areas).sort((a, b) => String(cache[a]?.at || "").localeCompare(String(cache[b]?.at || "")));
  const T0 = Date.now();
  let done = 0;
  for (const prov of provs.slice(0, perRun)) {
    if (Date.now() - T0 > minutes * 60000) break;
    await sleep(1500);
    const els = await overpass(query(cache._areas[prov]));
    if (!els) continue;
    const byKind = {};
    for (const e of els) {
      if (!(e.lat || e.center)) continue;
      const kind = kindOf(e.tags || {});
      if (!kind || !keep(kind, e.tags)) continue;
      (byKind[kind] ||= []).push(toPlace(e, kind, prov));
    }
    const items = [];
    for (const [kind, list] of Object.entries(byKind)) {
      // ชื่อซ้ำ (สาขาเดียวกันหลายจุด / จุดเดียวกันหลาย element) เก็บอันที่ข้อมูลครบสุด
      const seen = new Set();
      const uniq = list.sort((a, b) => b.fame - a.fame).filter(p => { const k = String(p.name.th || p.name.en).toLowerCase(); return !seen.has(k) && seen.add(k); });
      items.push(...uniq.slice(0, kind === "animalcafe" ? 20 : capOf(kind, prov)));
    }
    cache[prov] = { at: new Date().toISOString(), items };
    done++;
    log(`  OSM ${prov}: ${Object.entries(byKind).map(([k, l]) => `${k} ${Math.min(l.length, k === "animalcafe" ? 20 : capOf(k, prov))}/${l.length}`).join(" · ")}`);
  }
  await save("data/osm-provinces.json", JSON.stringify(cache) + "\n");
  const all = Object.entries(cache).filter(([k]) => k !== "_areas").flatMap(([, v]) => v.items || []);
  log(`OpenStreetMap รายจังหวัด: อัปเดต ${done} จังหวัด · มีข้อมูล ${Object.keys(cache).length - 1}/77 จังหวัด · ${all.length} แห่ง`);
  return all;
}

// รันเดี่ยว: node scripts/osm-provinces.mjs [--all] — เติมแคชทุกจังหวัด (ใช้ตอนเริ่มต้น)
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}` || process.argv[1]?.endsWith("osm-provinces.mjs")) {
  const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
  const P = win.PROVINCES;
  const normEn = s => String(s || "").toLowerCase().replace(/province|changwat|city|metropolis|special administrative area/g, "").replace(/[^a-z]/g, "");
  const provinceByEn = name => { const n = normEn(name); if (!n) return null; if (n.includes("bangkok")) return "bangkok"; return (P.find(p => normEn(p.en) === n) || P.find(p => n.length > 4 && (normEn(p.en).includes(n) || n.includes(normEn(p.en)))))?.id || null; };
  const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  const overpass = async q => {
    for (const url of SERVERS) for (let i = 0; i < 2; i++) {
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "User-Agent": "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)" }, signal: AbortSignal.timeout(200000) });
        if (r.ok) { const j = await r.json(); if (!j.remark || !/error|timed out|out of memory/i.test(j.remark)) return j.elements; }
      } catch {}
      await sleep(10000);
    }
    return null;
  };
  await osmProvincePlaces({ overpass, provinceByEn, perRun: process.argv.includes("--all") ? 77 : 20, minutes: process.argv.includes("--all") ? 120 : 15 });
}
