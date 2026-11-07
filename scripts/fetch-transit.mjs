// ข้อมูลจุดเดินทางจริงจาก OpenStreetMap → data/transit.json (ใช้แนะนำการเดินทางในหน้ารายละเอียดงาน/ที่เที่ยว)
// - สถานีรถไฟฟ้า BTS / MRT / Airport Rail Link / รถไฟสายสีแดง (กรุงเทพฯ และปริมณฑล)
// - ท่าเรือ (เรือด่วนเจ้าพระยา เรือข้ามฟาก เรือคลองแสนแสบ)
// - สถานีรถไฟทั่วประเทศ, สถานีขนส่ง (บขส.), สนามบินที่มีเที่ยวบินพาณิชย์
// อัปเดตสัปดาห์ละครั้ง (ข้อมูลเปลี่ยนช้า) · ถ้า OSM ไม่ตอบ ใช้ไฟล์เดิม
// รัน: node scripts/fetch-transit.mjs [--force]
import { readFile, writeFile, rename } from "node:fs/promises";

const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const FORCE = process.argv.includes("--force");
const TH = "5.6,97.3,20.5,105.7", BKK = "13.45,100.2,14.15,100.95";
const root = new URL("../", import.meta.url);
const file = new URL("data/transit.json", root);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let prev = null;
try { prev = JSON.parse(await readFile(file, "utf8")); } catch {}
if (prev && !FORCE && (Date.now() - new Date(prev.updatedAt)) / 864e5 < 7) { console.log("ข้อมูลการเดินทางยังใหม่ (ไม่ถึง 7 วัน) ข้าม"); process.exit(0); }

const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
async function overpass(body) {
  const q = `[out:json][timeout:180];area["ISO3166-1"="TH"][admin_level=2]->.th;(${body});out center tags;`;
  for (const url of SERVERS) {
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(150000) });
      if (!r.ok) { console.warn(`ตอบ ${r.status}:`, url); continue; }
      const j = await r.json();
      if (j.remark && /error|timed out/i.test(j.remark)) { console.warn("Overpass:", j.remark.slice(0, 80)); continue; }
      return j.elements || [];
    } catch (e) { console.warn("โหลดไม่ได้:", url, e.message); }
    await sleep(3000);
  }
  return null;
}
const pt = e => ({ lat: +(e.lat ?? e.center?.lat).toFixed(5), lng: +(e.lon ?? e.center?.lon).toFixed(5) });
const names = t => ({ th: t["name:th"] || t.name, en: t["name:en"] || (/^[\x00-\x7F]+$/.test(t.name || "") ? t.name : undefined) });
// รวมจุดที่ชื่อเดียวกันอยู่ใกล้กัน (หนึ่งสถานีมีหลายทางเข้า/หลายจุดใน OSM)
function dedupe(list) {
  const out = [];
  for (const x of list) {
    if (!x.n.th || !x.lat) continue;
    if (out.some(y => y.t === x.t && y.n.th === x.n.th && Math.abs(y.lat - x.lat) + Math.abs(y.lng - x.lng) < 0.01)) continue;
    out.push(x);
  }
  return out;
}
// ระบบรถไฟฟ้าจากแท็ก network/operator/ชื่อ
function railType(t) {
  const s = `${t.network || ""} ${t.operator || ""} ${t.line || ""} ${t["name:en"] || ""} ${t.name || ""}`;
  if (/airport rail|แอร์พอร์ต|ARL/i.test(s)) return "ARL";
  if (/\bBTS\b|บีทีเอส|Skytrain|Bangkok Mass Transit/i.test(s)) return "BTS";
  if (/\bMRT\b|เอ็มอาร์ที|Metro|Bangkok Expressway and Metro|monorail|โมโนเรล|Yellow Line|Pink Line|สายสีเหลือง|สายสีชมพู|สายสีม่วง|Purple/i.test(s)) return "MRT";
  if (/SRT Red|สายสีแดง|Red Line|SRT Electrified|Krung Thep Aphiwat|กรุงเทพอภิวัฒน์/i.test(s)) return "SRT";
  return null;
}

// สำรอง: สถานีรถไฟฟ้าจาก Wikidata (มีครบทุกสาย พร้อมชื่อสาย) เมื่อ OSM ไม่ตอบ
async function wikidataRail() {
  const q = `SELECT ?s ?th ?en ?c (GROUP_CONCAT(DISTINCT ?ln; separator="|") AS ?lines) WHERE {
    ?s wdt:P17 wd:Q869; wdt:P625 ?c; wdt:P81 ?line. ?line rdfs:label ?ln FILTER(lang(?ln)="en")
    OPTIONAL { ?s rdfs:label ?th FILTER(lang(?th)="th") } OPTIONAL { ?s rdfs:label ?en FILTER(lang(?en)="en") }
  } GROUP BY ?s ?th ?en ?c`;
  try {
    const r = await fetch("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(90000) });
    if (!r.ok) return null;
    const [s, w, n, e] = BKK.split(",").map(Number);
    return (await r.json()).results.bindings.map(b => {
      const [lng, lat] = (b.c.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/) || []).slice(1).map(Number);
      const L = b.lines.value;
      const t = /Airport Rail/i.test(L) ? "ARL" : /Sukhumvit|Silom|Gold Line|BTS/i.test(L) ? "BTS" : /Blue Line|Purple Line|Yellow Line|Pink Line|MRT/i.test(L) ? "MRT" : /Red Line|SRT/i.test(L) ? "SRT" : null;
      return { n: { th: (b.th?.value || b.en?.value || "").replace(/^สถานี(รถไฟฟ้า)?/, "").trim(), en: b.en?.value?.replace(/ (BTS|MRT|ARL|railway)? ?station$/i, "") }, t, lat: +lat.toFixed(5), lng: +lng.toFixed(5) };
    }).filter(x => x.t && x.lat >= s && x.lat <= n && x.lng >= w && x.lng <= e);
  } catch (err) { console.warn("Wikidata ไม่ตอบ:", err.message); return null; }
}

const out = { updatedAt: new Date().toISOString() };
const parts = {
  rail: `node["railway"="station"](${BKK});node["public_transport"="station"]["railway"](${BKK});`,
  pier: `nwr["amenity"="ferry_terminal"](${BKK});nwr["public_transport"="station"]["ferry"="yes"](${BKK});`,
  train: `node["railway"~"^(station|halt)$"]["name"](area.th);`,
  bus: `nwr["amenity"="bus_station"]["name"](area.th);`,
  air: `nwr["aeroway"="aerodrome"]["iata"](area.th);`
};
// สถานีรถไฟฟ้า: ใช้ Wikidata ก่อน (มีชื่อสายครบ) ไม่ได้ค่อยใช้ OSM
const wdRail = await wikidataRail();
if (wdRail?.length > 100) { out.rail = dedupe(wdRail); delete parts.rail; console.log(`rail: Wikidata ${out.rail.length}`); }
for (const [k, body] of Object.entries(parts)) {
  const els = await overpass(body);
  if (!els && k === "rail") {
    const wd = await wikidataRail();
    if (wd?.length) { out.rail = dedupe(wd); console.log(`rail: Wikidata ${out.rail.length}`); continue; }
  }
  if (!els) { out[k] = prev?.[k] || []; console.warn(`${k}: OSM ไม่ตอบ ใช้ชุดเดิม ${out[k].length}`); continue; }
  let list = [];
  if (k === "rail") list = els.map(e => ({ n: { ...names(e.tags), th: (names(e.tags).th || "").replace(/^สถานี(รถไฟฟ้า)?/, "").trim() }, t: railType(e.tags), ...pt(e) })).filter(x => x.t);
  if (k === "pier") list = els.map(e => ({ n: names(e.tags), t: "BOAT", ...pt(e) }));
  // สถานีรถไฟทางไกล: ไม่เอาสถานีรถไฟฟ้า/รถไฟใต้ดินในเมือง
  // ต้องเป็นสถานีของการรถไฟฯ (ไม่เอารถราง/กระเช้า/รถไฟเล็กในสวนสนุก)
  const isSRT = t => /State Railway|การรถไฟ|SRT|รฟท/i.test(`${t.operator || ""} ${t.network || ""}`) || t.train === "yes" || t["railway:ref"] || t.uic_ref;
  if (k === "train") list = els.filter(e => !/subway|light_rail|monorail|funicular|tram/.test(e.tags.station || "") && !railType(e.tags) && isSRT(e.tags) && !/tourist|heritage|tram|cable/i.test(`${e.tags.usage || ""} ${e.tags.railway || ""}`)).map(e => ({ n: names(e.tags), t: "SRT", ...pt(e) }));
  if (k === "bus") list = els.map(e => ({ n: names(e.tags), t: "BUS", ...pt(e) }));
  // สนามบินพาณิชย์เท่านั้น (ไม่เอาฐานบินทหาร)
  if (k === "air") list = els.filter(e => /^[A-Z]{3}$/.test(e.tags.iata) && /^VT/.test(e.tags.icao || "VT") && !/ฐานบิน|air base|military|กองบิน/i.test(`${e.tags.name} ${e.tags["name:en"]} ${e.tags.military || ""} ${e.tags.landuse || ""}`)).map(e => ({ n: names(e.tags), t: "AIR", iata: e.tags.iata, ...pt(e) }));
  // กรอบพิกัดครอบเพื่อนบ้านบางส่วน → ตัดจุดที่อยู่นอกไทย (ตามชื่อเมืองชายแดน)
  out[k] = dedupe(list).filter(x => !/poipet|ปอยเปต|cambodia|กัมพูชา|laos|ลาว|vientiane|เวียงจันทน์|malaysia|มาเลเซีย|myanmar|พม่า|kedah|perlis|kelantan|myawaddy|เมียวดี|tachileik|ท่าขี้เหล็ก/i.test(`${x.n.th} ${x.n.en || ""}`));
  console.log(`${k}: ${out[k].length}`);
  await sleep(2000);
}
const tmp = new URL("data/transit.json.tmp", root);
await writeFile(tmp, JSON.stringify(out) + "\n");
await rename(tmp, file);
