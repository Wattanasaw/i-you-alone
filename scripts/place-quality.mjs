// คุณภาพข้อมูลสถานที่ + การจับคู่โพสต์รีวิวกับสถานที่ (ใช้ร่วมกันหลายสคริปต์)
// 1) specificPlaces: ไม่เอาสถานที่ที่ชื่อกว้างเกินไป ("บางแสน" = ทั้งตำบล → "หาดบางแสน") / ชื่อไม่ใช่สถานที่ / นอกประเทศไทย
// 2) postFits + bestOwners: โพสต์ต้องพูดถึง "ที่นี่" จริง ไม่ใช่ร้านอื่นในย่านเดียวกัน
//    เช่น "คาเฟ่ Sea and sand cocktail bar บางแสน" ไม่ใช่รีวิวของหาดบางแสน

// คำที่บอกว่าเป็นสถานที่ธรรมชาติ/สถานที่สำคัญจริงๆ (ไม่ใช่ชื่อตำบล/เมือง)
const TH_GEO = /หาด|เกาะ|ดอย|น้ำตก|อุทยาน|ภู|เขา|ถ้ำ|บึง|ทะเล|แม่น้ำ|อ่าว|แหลม|ป่า|สวน|ทุ่ง|หนอง|อ่าง|เขื่อน|คลอง|ผา|โป่ง|บ่อ|ลาน|จุดชม|สะพาน|ตลาด|ถนน|หมู่บ้าน|ชุมชน|แก่ง|ห้วย|ธาร|น้ำพุ|เนิน|วัด|พระ|อนุสาวรีย์|พิพิธ|ศาล|เจดีย์|ปราสาท|วัง|หอ|เมือง|โบราณ|สถาน|ศูนย์|ไร่|ฟาร์ม|บ้าน|ม่อน|กิ่ว|หิน|เวียง|โคก|เตา|ประตู|เรือ|บีช|ล่อง|ลำ|กุด|มูลนิธิ/;
const EN_GEO = /beach|bay|island|waterfall|falls|mountain|mount|peak|hill|cave|view ?point|cliff|lake|river|forest|park|garden|reservoir|dam|spring|cape|rock|lagoon|canyon|swamp|market|temple|\bwat\b|\bdoi\b|\bkhao\b|\bhat\b|\bhaad\b|\bko\b|\bkoh\b|\bphu\b|\bmon\b|\bao\b|\btham\b|nam tok|site|ruins|city|kilns|gate|pavilion|buddha|budda|cliff|triangle|ship|htms|uss|foundation|historic|old town|wiang|muang|mueang/i;
const ZH_BEACH = /海灘|海滩/, ZH_ISLAND = /岛|島/, ZH_FALL = /瀑布/;
const NATURE_KINDS = new Set(["nature", "park"]); // สถานที่สำคัญ (landmark) จาก Wikidata มักเป็นโบราณสถานชื่อเฉพาะอยู่แล้ว
// ชื่อที่ไม่ใช่สถานที่ (คำทั่วไป / ส่วนย่อยของสถานที่)
const NOT_A_PLACE = /^(จุดชมทิวทัศน์|จุดชมวิว|viewpoint|view point)$|^ชั้นที่\s*[๐-๙\d]/i;
const LAO = /[຀-໿]/;

const nameOf = p => typeof p.name === "string" ? { th: p.name } : (p.name || {});
const norm = s => String(s || "").toLowerCase().replace(/\s+/g, "");
const kmBetween = (a, b) => {
  const R = 6371, t = x => x * Math.PI / 180;
  const dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng);
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2));
};

// คืนรายการใหม่ + สถิติ · แก้ชื่อในตัว (เพิ่ม "หาด"/"เกาะ"/"น้ำตก" เมื่อภาษาอื่นบอกชัดว่าเป็นอะไร)
export function specificPlaces(places, log = console.log) {
  const out = [], dropped = [], renamed = [];
  for (const p of places) {
    const n = nameOf(p), th = (n.th || "").trim(), en = (n.en || "").trim(), zh = n.zh || "";
    if (LAO.test(th) || NOT_A_PLACE.test(th) || NOT_A_PLACE.test(en)) { dropped.push(th || en); continue; }
    // สถานที่จากโพสต์เทรนด์ (fromTrend) ได้ชื่อจากหมุดร้าน/สถานที่จริงบนแผนที่อยู่แล้ว ไม่ต้องเช็คข้อนี้
    if (NATURE_KINDS.has(p.kind) && !p.fromTrend && th && !/[a-z]/i.test(th) && !TH_GEO.test(th) && !EN_GEO.test(en)) {
      // ชื่อไทยเป็นแค่ชื่อพื้นที่ ("บางแสน") → ภาษาอื่นบอกว่าเป็นหาด/เกาะ/น้ำตก ใช้ชื่อเต็ม · ไม่บอก = กว้างเกิน ตัดออก
      const pre = ZH_BEACH.test(zh) ? "หาด" : ZH_ISLAND.test(zh) ? "เกาะ" : ZH_FALL.test(zh) ? "น้ำตก" : "";
      if (!pre) { dropped.push(th); continue; }
      p.name = { ...n, th: pre + th, ...(en && !EN_GEO.test(en) ? { en: en + (pre === "หาด" ? " Beach" : pre === "เกาะ" ? " Island" : " Waterfall") } : {}) };
      renamed.push(`${th} → ${p.name.th}`);
    }
    // ชื่อซ้ำกับสถานที่ใกล้ๆ (≤ 5 กม. — พิกัด Wikidata มักเป็นจุดกลางพื้นที่) ที่มีอยู่แล้ว → เก็บอันแรก (Wikidata มาก่อน OSM ข้อมูลครบกว่า)
    const key = norm(nameOf(p).th);
    const dup = key && out.find(q => norm(nameOf(q).th) === key && q.lat && p.lat && kmBetween(p, q) <= 5);
    if (dup) { for (const k of ["address", "hours", "website", "phone", "image", "imageCredit"]) if (!dup[k] && p[k]) dup[k] = p[k]; dropped.push(`${th} (ซ้ำ)`); continue; }
    out.push(p);
  }
  if (log) log(`ชื่อสถานที่: ตัดชื่อกว้าง/ไม่ใช่สถานที่/ซ้ำ ${dropped.length} (${dropped.slice(0, 12).join(", ")}${dropped.length > 12 ? " …" : ""}) · แก้ชื่อ ${renamed.length} (${renamed.slice(0, 6).join(", ")})`);
  return out;
}

// ---------- จับคู่โพสต์ ----------
// โพสต์ที่เป็นเรื่องร้าน/ที่พัก (ไม่ใช่สถานที่ธรรมชาติ/สถานที่สำคัญ)
const BUSINESS = /คาเฟ่|คาเฟ|ร้าน|บาร์|ค็อกเทล|ผับ|โรงแรม|ที่พัก|รีสอร์ท|รีสอร์ต|โฮมสเตย์|หมูกระทะ|บุฟเฟ่ต์|ชาบู|ปิ้งย่าง|อาหารทะเล|ซีฟู้ด|สปา|นวด|\bcafe\b|café|coffee|\bbar\b|cocktail|\bpub\b|hotel|resort|homestay|pool ?villa|restaurant|bistro|brunch|bakery/i;
const VENUE_KINDS = new Set(["cafe", "animalcafe", "restaurant", "nightlife"]);

// โพสต์นี้เป็นเรื่องของสถานที่นี้ได้ไหม (ไม่ดูชื่อ ดูแค่ประเภท): ที่เที่ยวธรรมชาติ/สถานที่สำคัญ ไม่รับโพสต์รีวิวร้าน/ที่พัก
// ยกเว้นชื่อสถานที่เองเป็นชื่อร้าน (ไม่มีในหมวดเหล่านี้ตามปกติ)
export function postFits(post, place) {
  if (VENUE_KINDS.has(place.kind)) return true;
  const n = nameOf(place);
  if (BUSINESS.test(`${n.th || ""} ${n.en || ""}`)) return true;
  return !BUSINESS.test(String(post.title || ""));
}

// แต่ละโพสต์ให้เฉพาะสถานที่ที่ชื่อตรงยาวที่สุด (เจาะจงที่สุด) — "หาดบางแสน" ชนะ "บางแสน", ร้าน X ชนะย่านที่ร้านอยู่
// namesOf(place) → ชื่อ (ตัวเล็ก) ที่ใช้ค้นในหัวโพสต์ · คืน Map(link → ความยาวชื่อที่ตรงที่สุด)
export function bestOwners(posts, places, namesOf) {
  const best = new Map();
  const lists = places.map(p => namesOf(p)).filter(ns => ns.length);
  for (const x of posts) {
    const t = String(x.title || "").toLowerCase();
    let m = 0;
    for (const ns of lists) for (const n of ns) if (n.length > m && t.includes(n)) m = n.length;
    if (m) best.set(x.link, m);
  }
  return best;
}
// ชื่อที่ตรงกับหัวโพสต์ยาวพอเทียบกับชื่อที่เจาะจงที่สุดไหม
export const ownsPost = (post, ns, best) => {
  const t = String(post.title || "").toLowerCase();
  const mine = Math.max(0, ...ns.filter(n => t.includes(n)).map(n => n.length));
  const top = best.get(post.link) || 0;
  return mine === 0 ? true : mine >= top; // ไม่ได้ตรงที่หัวโพสต์ (ตรงที่เนื้อหา) → ไม่ตัดด้วยกฎนี้
};

// ---------- ชื่อเรียกสั้นที่คนใช้โพสต์จริง ----------
// ชื่อทางการยาวๆ ("บางกอก ซี ไลฟ์ โอเชียนเวิลด์", "Sea Life Bangkok Ocean World") มักค้นใน Lemon8 ไม่เจอ (404)
// แต่คนโพสต์ว่า "Sea Life Bangkok" / "ซีไลฟ์" → ใช้ช่วงคำต่อเนื่องของชื่อ (อย่างน้อย 2 คำ) เป็นชื่อเรียกสั้น
// ต้องมีคำเฉพาะ (ไม่ใช่แค่ชื่อจังหวัด/คำทั่วไป) และไม่ซ้ำกับสถานที่อื่น (ชื่อสั้นที่ใช้ได้หลายที่ = ไม่ใช้)
const ALIAS_STOP = /^(the|of|and|at|in|on|de|la|by|bangkok|thailand|thai|siam|chiang|mai|rai|phuket|pattaya|krabi|samui|hua|hin|ayutthaya|sukhothai|nakhon|pathom|ratchasima|si|songkhla|hat|yai|udon|thani|khon|kaen|ubon|ratchathani|lampang|lamphun|nan|phrae|phayao|kanchanaburi|rayong|chonburi|chon|buri|trat|chanthaburi|prachuap|khiri|khan|phetchaburi|ratchaburi|surat|national|museum|park|temple|wat|phra|world|city|zoo|market|cafe|café|coffee|garden|gallery|art|center|centre|house|hall|old|new|royal|grand|great|big|little|night|floating|beach|island|koh|ko|waterfall|mount|doi|khao|cave|lake|river|bay|point|view|resort|hotel|bar|restaurant|shop|ocean|land|road|street|walking|square|plaza|mall|palace|monument|memorial|museums|aquarium|safari|water|theme|amusement|farm|village|community|historical|history|science|national|open|zoological|wildlife|sanctuary|forest|reserve|centre|kingdom|town)$/i;
const TH_STOP = /^(กรุงเทพ|กรุงเทพฯ|กรุงเทพมหานคร|บางกอก|แบงคอก|ไทย|ประเทศไทย|เชียงใหม่|เชียงราย|ภูเก็ต|พัทยา|กระบี่|สมุย|หัวหิน|อยุธยา|พิพิธภัณฑ์|พิพิธภัณฑสถานแห่งชาติ|สวนสัตว์|สวนสนุก|สวนน้ำ|อุทยาน|อุทยานแห่งชาติ|วัด|พระ|ตลาด|คาเฟ่|ร้าน|เวิลด์|เวิร์ลด์|แลนด์|ซิตี้|พาร์ค|โอเชียนเวิลด์|มิวเซียม|แกลเลอรี่|หาด|เกาะ|น้ำตก|ดอย|เขา|ถ้ำ|สวน|ศูนย์|บ้าน|แห่ง|ชาติ|และ|ของ)$/;
const words = s => String(s || "").toLowerCase().replace(/[()\[\],.:;'"“”‘’!?·\-–—&]/g, " ").split(/\s+/).filter(Boolean);
const CONNECT = /^(the|of|and|at|in|on|de|la|by|@|&|-|และ|ของ|ที่)$/i;
function nameSpans(name, stop, thai) {
  const w = words(name), out = [];
  if (w.length < 2) return out;
  const distinct = part => part.filter(x => !stop.test(x) && !CONNECT.test(x));
  for (let j = w.length - 1; j >= 2; j--) {
    const part = w.slice(0, j), tail = w.slice(j), d = distinct(part);
    if (CONNECT.test(part[0]) && part.length < 3) continue;
    if (CONNECT.test(part.at(-1))) continue;
    if (d.join("").length < 5) continue;
    // ตัดได้เฉพาะคำทั่วไปท้ายชื่อ ("Ocean World", "Museum") หรือเหลือคำเฉพาะ ≥ 2 คำ
    if (!(tail.every(x => stop.test(x) || CONNECT.test(x)) || (d.length >= 2 && d.join("").length >= 8))) continue;
    const s = part.join(" ");
    if (s.length >= 7) out.push(s);
  }
  // ชื่อไทยที่เว้นวรรคระหว่างพยางค์ ("ซี ไลฟ์") → คนเขียนติดกัน
  if (thai && /[฀-๿]/.test(name)) for (const s of [...out]) { const j = s.replace(/s+/g, ""); if (j.length >= 5) out.push(j); }
  return out;
}
// places → Map(id → ชื่อเรียกสั้น[] ตัวเล็ก) เรียงคำค้นที่น่าจะเจอก่อน (ขึ้นต้นชื่อ/ยาวกว่าก่อน)
export function aliasMap(places) {
  const cand = new Map(), count = new Map(), fullNames = new Set();
  for (const p of places) { const n = nameOf(p); for (const s of [n.th, n.en]) if (s) fullNames.add(String(s).toLowerCase().trim()); }
  for (const p of places) {
    const n = nameOf(p);
    const list = [...new Set([...nameSpans(n.en, ALIAS_STOP, false), ...nameSpans(n.th, TH_STOP, true)])];
    cand.set(p.id, list);
    for (const a of list) count.set(a, (count.get(a) || 0) + 1);
  }
  const out = new Map();
  for (const p of places) {
    const n = nameOf(p), en = String(n.en || "").toLowerCase(), th = String(n.th || "").toLowerCase();
    const ok = cand.get(p.id).filter(a => count.get(a) === 1 && !fullNames.has(a)
      // ชื่อสั้นที่เป็นส่วนหนึ่งของชื่อสถานที่อื่นด้วย → กำกวม ไม่ใช้
      && ![...fullNames].some(f => f !== en && f !== th && f.includes(a)));
    ok.sort((a, b) => ((en.startsWith(a) || th.startsWith(a) ? 0 : 1) - (en.startsWith(b) || th.startsWith(b) ? 0 : 1)) || b.length - a.length);
    if (ok.length) out.set(p.id, ok.slice(0, 6));
  }
  return out;
}

// ---------- เวลาเปิด-ปิด + ช่วงราคา จากโพสต์รีวิว (ไม่ใช้ AI — อ่านจากข้อความที่ผู้รีวิวเขียนชัดๆ) ----------
// bodies: ข้อความโพสต์ (หัวข้อ + เนื้อหา + ข้อความบนรูป) ตัวเล็ก · คืน { hours?, price?: {min,max,n} }
const DAY = { "จันทร์": "Mo", "อังคาร": "Tu", "พุธ": "We", "พฤหัส": "Th", "พฤหัสบดี": "Th", "ศุกร์": "Fr", "เสาร์": "Sa", "อาทิตย์": "Su",
  monday: "Mo", tuesday: "Tu", wednesday: "We", thursday: "Th", friday: "Fr", saturday: "Sa", sunday: "Su" };
const pad = n => String(n).padStart(2, "0");
export function infoFromPosts(bodies, kind) {
  const out = {};
  // เวลา: "เปิด 10.00-20.00 น." "⏰ 9:00 - 18:00" "open 10am" (เฉพาะรูปแบบ ชม.นาที–ชม.นาที ที่มีคำว่าเปิด/เวลา/open นำหน้าใกล้ๆ)
  const times = new Map(), offs = new Map();
  for (const b of bodies) {
    const seen = new Set();
    for (const m of b.matchAll(/(?:เปิด|เวลา|open|⏰|🕙|🕘|🕚|🕐|🕑|🕒|🕓|🕔|🕕|🕖|🕗)[^\d\n]{0,18}(\d{1,2})[.:](\d{2})\s*(?:น\.?|am|pm)?\s*(?:-|–|—|~|ถึง|to)\s*(\d{1,2})[.:](\d{2})/gi)) {
      const [h1, m1, h2, m2] = [+m[1], +m[2], +m[3], +m[4]];
      if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59 || (h1 === h2 && m1 === m2)) continue;
      const k = `${pad(h1)}:${pad(m1)}-${pad(h2)}:${pad(m2)}`;
      if (!seen.has(k)) { seen.add(k); times.set(k, (times.get(k) || 0) + 1); }
    }
    for (const m of b.matchAll(/(?:หยุด|ปิด|closed?)\s*(?:ทุก)?\s*(?:วัน)?\s*(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi)) {
      const d = DAY[m[1].toLowerCase()];
      if (d) offs.set(d, (offs.get(d) || 0) + 1);
    }
  }
  // "เปิด 24 ชั่วโมง" / "open 24 hours"
  const h24 = bodies.filter(b => /(?:เปิด|open)\s*(?:ทุกวัน\s*)?24\s*(?:ชั่วโมง|ชม\.?|hours?|hrs?|\/7)/i.test(b)).length;
  const best = [...times].sort((a, b) => b[1] - a[1])[0];
  if (h24 >= 2 && (!best || h24 >= best[1])) { out.hours = "24/7"; out.hoursN = h24; }
  else if (best && best[1] >= 2) {
    const off = [...offs].sort((a, b) => b[1] - a[1])[0];
    out.hours = `Mo-Su ${best[0]}${off ? `; ${off[0]} off` : ""}`;
    out.hoursN = best[1]; // จำนวนโพสต์ที่เขียนเวลาตรงกัน
  }
  // ราคา (ร้านอาหาร/คาเฟ่/บาร์): ตัวเลขที่มี "บาท" "฿" ".-" ติดกัน · ช่วงกลางของราคาที่พบ (ตัดค่าสุดโต่ง) · ต้องพบอย่างน้อย 3 ราคา
  if (VENUE_KINDS.has(kind)) {
    const prices = [];
    for (const b of bodies) for (const m of b.matchAll(/(?:฿\s*(\d{2,4})(?!\d)|(?<![\d.,])(\d{2,4})\s*(?:บาท|฿|\.-|thb\b))/gi)) {
      const v = +(m[1] || m[2]);
      // ไม่ใช่ราคาอาหาร: ค่าจอด/ส่วนลด/โปรฯ ลด
      const before = b.slice(Math.max(0, m.index - 14), m.index);
      if (/จอด|ส่วนลด|ลด|off|คูปอง|voucher/.test(before)) continue;
      if (v >= 20 && v <= 3000) prices.push(v);
    }
    if (prices.length >= 3) {
      prices.sort((a, b) => a - b);
      const q = f => prices[Math.min(prices.length - 1, Math.round(f * (prices.length - 1)))];
      const r = v => v >= 100 ? Math.round(v / 10) * 10 : Math.round(v / 5) * 5;
      out.price = { min: r(q(0.15)), max: r(q(0.85)), n: prices.length };
      if (out.price.max < out.price.min) out.price.max = out.price.min;
    }
  }
  // ค่าเข้า/ค่าบัตร (สวนสัตว์ พิพิธภัณฑ์ สวนสนุก อุทยาน ฯลฯ): ตัวเลขบาทที่อยู่หลังคำว่า บัตร/ค่าเข้า/ตั๋ว · ต้องพบอย่างน้อย 2 ครั้ง
  if (!VENUE_KINDS.has(kind) || kind === "animalcafe") {
    const fees = [];
    for (const b of bodies) {
      // ฟรี: "เข้าฟรี" ที่ไม่ใช่โปรฯ เด็ก/ผู้สูงอายุ/วันเกิด
      for (const m of b.matchAll(/(?:เข้าฟรี|เข้าชมฟรี|ไม่เสียค่าเข้า|ไม่มีค่าเข้า|ค่าเข้าฟรี|free entry|free admission)/g)) {
        if (!/เด็ก|kid|child|ผู้สูงอายุ|วันเกิด|birthday|สูงไม่เกิน|ต่ำกว่า|ใบที่|ซื้อ|โปร/.test(b.slice(Math.max(0, m.index - 40), m.index + 30))) fees.push(0);
      }
      for (const m of b.matchAll(/(?:บัตร|ค่าเข้า|ค่าบัตร|ตั๋ว|ค่าตั๋ว|จ่าย|คนละ|ท่านละ|ราคา|ticket|admission|entrance)[^\d\n]{0,20}?(\d{1,3},\d{3}|\d{2,4})\s*(?:บาท|฿|\.-|thb\b)/gi)) {
        const v = +m[1].replace(/,/g, "");
        const near = b.slice(Math.max(0, m.index - 16), m.index + m[0].length + 6);
        if (/จอด|ส่วนลด|ลด\s|off|คูปอง|voucher|รายปี|annual|ที่พัก|โรงแรม|ห้อง/.test(near)) continue;
        if (v >= 10 && v <= 5000) fees.push(v);
      }
    }
    const paid = fees.filter(v => v > 0);
    if (fees.filter(v => v === 0).length >= 3 && !paid.length) out.entry = { free: true };
    else if (paid.length >= 2) {
      paid.sort((a, b) => a - b);
      const q = f => paid[Math.min(paid.length - 1, Math.round(f * (paid.length - 1)))];
      const r = v => v >= 100 ? Math.round(v / 10) * 10 : Math.round(v / 5) * 5;
      const lo = r(q(0.2)), hi = r(q(0.8));
      out.entry = lo === hi ? { thai: lo } : { min: lo, max: hi };
    }
  }
  return out;
}

// ---------- เนื้อหาที่เจ้าของขอให้ลบ (data/removed.json: {"links": [ลิงก์โพสต์], "authors": ["@ชื่อผู้โพสต์"]}) ----------
// สคริปต์ไม่เก็บโพสต์เหล่านี้อีก (รูปย่อที่เก็บไว้ถูกลบตามใน thumbs.mjs) · แอพก็กรองซ้ำอีกชั้น
import { readFileSync } from "node:fs";
let removedCache;
export function postAllowed(x) {
  if (!removedCache) {
    let r = {};
    try { r = JSON.parse(readFileSync(new URL("../data/removed.json", import.meta.url), "utf8")); } catch {}
    removedCache = { links: new Set([].concat(r.links || [])), authors: new Set([].concat(r.authors || []).map(a => String(a).replace(/^@/, "").toLowerCase())) };
  }
  const link = String(x?.link || "");
  const author = (link.split("lemon8-app.com/@")[1] || "").split("/")[0].toLowerCase();
  return !removedCache.links.has(link) && !removedCache.authors.has(author);
}

// ---------- โพสต์นี้เป็นเรื่องของ "ที่นี่" จริงไหม (ใช้ร่วมทุกสคริปต์ที่ผูกโพสต์กับสถานที่) ----------
// ปัญหาเดิม: "อุทยานแห่งชาติเขาใหญ่" ตัดคำนำหน้าเหลือ "เขาใหญ่" = ชื่ออำเภอ/ย่าน → โพสต์ Pandora, คาเฟ่, รีสอร์ทในเขาใหญ่หลุดมาเป็นรีวิวอุทยาน
// กฎ: ชื่อเต็ม (ไทย/อังกฤษ) หรือชื่อเรียกสั้นที่ไม่ซ้ำใคร อยู่ในหัวโพสต์ หรือบนปก (ข้อความบนรูปแรก ≥ 6 ตัวอักษร)
//     ชื่อที่ตัดคำนำหน้า ต้องมีคำบอกประเภทติดกัน ("อุทยานเขาใหญ่" "อช.เขาใหญ่" "น้ำตก เอราวัณ") และปกต้องไม่ใช่รูปร้าน/ที่พัก
//     อุทยานแห่งชาติ: ชื่อเรียกสั้นจากชื่ออังกฤษ ("kaeng krachan") ต้องมีคำว่า อุทยาน/national park ด้วย
// post: { title, cover?, coverDesc? } (cover = ข้อความบนรูปแรก + คำบรรยายรูป, ตัวเล็ก) · aliases = ชื่อเรียกสั้น (ตัวเล็ก) ถ้ามี
const STRIP = /^(อุทยานแห่งชาติ|สวนสัตว์เปิด|สวนสัตว์|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|สวนน้ำ|สวนสนุก|หอศิลป์|คาเฟ่|ร้าน|วัด|น้ำตก|หาด|ชายหาด)\s*/;
const TYPE_WORD = [[/^อุทยาน/, "อุทยาน|อช\\."], [/^น้ำตก/, "น้ำตก"], [/^(ชาย)?หาด/, "หาด"], [/^วัด/, "วัด"], [/^สวนสัตว์/, "สวนสัตว์(?:เปิด)?"],
  [/^พิพิธ/, "พิพิธภัณฑ์|พิพิธภัณฑ"], [/^สวนน้ำ/, "สวนน้ำ"], [/^สวนสนุก/, "สวนสนุก"], [/^หอศิลป์/, "หอศิลป์"]];
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COVER_BIZ = /คาเฟ่|คาเฟ|ร้าน|บาร์|ผับ|โรงแรม|ที่พัก|รีสอร์ท|รีสอร์ต|โฮมสเตย์|แคมป์ปิ้ง|\bcafe\b|café|coffee|hotel|resort|restaurant/i;
const KIND_WORD = {
  park: /อุทยาน|อช\.|national park/,
  zoo: /zoo|safari|aquarium|สวนสัตว์|อควาเรียม|ซาฟารี|สัตว์|animal|wildlife/,
  themepark: /water ?park|สวนน้ำ|theme ?park|สวนสนุก|amusement|สวน|garden|world|land|ฟาร์ม|farm/,
  museum: /museum|พิพิธ|gallery|หอศิลป์|\bart\b|exhibition|นิทรรศการ/,
  other: /วัด|temple|หาด|beach|เกาะ|island|น้ำตก|waterfall|ตลาด|market|พระราชวัง|palace|ปราสาท|อุทยาน|สวน|park|ดอย|ภู|เขา|ถ้ำ|cave|จุดชมวิว|viewpoint/
};
// ชื่อเรียกสั้นซ้ำกับที่ในต่างประเทศ ("harvest moon" ที่แอฟริกาใต้)
const ABROAD = /ต่างประเทศ|แอฟริกา|ญี่ปุ่น|เกาหลี|ไต้หวัน|ฮ่องกง|จีน|ยุโรป|อเมริกา|ออสเตรเลีย|นิวซีแลนด์|สวิส|อังกฤษ|ฝรั่งเศส|อิตาลี|เวียดนาม|ลาว|กัมพูชา|มาเลเซีย|สิงคโปร์|บาหลี|อินโดนีเซีย|ดูไบ|japan|korea|taiwan|hong kong|china|europe|africa|australia|singapore|bali|vietnam/i;
const aboutCache = new Map();
function aboutParts(place, aliases = []) {
  const key = place.id + "|" + aliases.join(",");
  if (aboutCache.has(key)) return aboutCache.get(key);
  const n = nameOf(place), th = String(n.th || "").trim(), lth = th.toLowerCase();
  const cut = th.replace(STRIP, "").trim().toLowerCase();
  const ctx = TYPE_WORD.find(([re]) => re.test(th))?.[1];
  const weak = ctx && cut && cut !== lth ? cut : "";
  const near = weak && new RegExp(`(?:${ctx})(?:ฯ|สถาน)?\\s*(?:แห่งชาติ|เเห่งชาติ)?\\s*(?:น้ำตก)?\\s*${reEsc(weak)}${ctx === "วัด" ? "" : `|${reEsc(weak)}\\s*(?:${ctx})`}`);
  // ชื่อเรียกสั้นของที่ที่ไม่ใช่ร้าน ("harvest moon", "nong khai", "black mountain") มักเป็นคำทั่วไป/ชื่อเมืองด้วย
  // → ต้องมีคำบอกประเภทของที่นี่ หรือชื่อจังหวัด ในหัวโพสต์/ปกด้วย
  const venue = VENUE_KINDS.has(place.kind);
  const prov = String(place.province || "").replace(/-/g, " ").toLowerCase();
  const park = venue ? [] : aliases.filter(a => a !== prov);
  const nameBiz = COVER_BIZ.test(`${th} ${n.en || ""}`);
  const kindRe = KIND_WORD[place.kind] || KIND_WORD.other;
  const strong = [...new Set([lth, String(n.en || "").toLowerCase().trim(), !ctx && cut !== lth ? cut : "", ...(venue ? aliases : [])])]
    .filter(s => s && s.length >= 4 && s !== weak);
  const r = { strong, weak, near, park, kindRe, prov, nameBiz };
  aboutCache.set(key, r);
  return r;
}
export function postAbout(post, place, aliases) {
  const { strong, weak, near, park, kindRe, prov, nameBiz } = aboutParts(place, aliases || []);
  const t = String(post.title || "").toLowerCase(), cover = post.cover || "";
  if (strong.some(n => t.includes(n) || (n.length >= 6 && cover.includes(n)))) return true;
  const both = `${t} ${cover}`;
  if (park.some(n => t.includes(n) || cover.includes(n)) && !ABROAD.test(both) && (kindRe.test(both) || (place.kind !== "park" && prov && both.includes(prov))) && (nameBiz || !COVER_BIZ.test(`${t} ${post.coverDesc || ""}`))) return true;
  return !!weak && (near.test(t) || near.test(cover)) && !COVER_BIZ.test(post.coverDesc || "");
}

// ---------- แก้หมวดสถานที่ที่หลง (จากชื่อ) · null = ไม่ใช่ที่เที่ยว ตัดออก ----------
// ประเภทจาก OSM/Wikidata บางทีไม่ตรง: คาเฟ่ติดป้ายร้านอาหาร, ถ้ำ/หาดเป็นแลนด์มาร์ก, วัดเป็นธรรมชาติ, ตลาดสดเทศบาลเป็นแลนด์มาร์ก
const NOT_ATTRACTION = /ตลาดสด|fresh ?market|food market|ตลาดเทศบาล|municipal(ity)? (food |fresh )?market|tour office|travel agency|สำนักงาน|protection unit|หน่วยพิทักษ์|ด่านตรวจ|ranger station|^tiger temple$|โรงพยาบาล(?!ช้าง)|โรงแรม|hotel|hostel|guest ?house|หอพัก|คอนโด|apartment/i;
export function fixKind(p) {
  const n = nameOf(p), name = `${n.th || ""} | ${n.en || ""}`, k = p.kind;
  // ร้าน (คาเฟ่/ร้านอาหาร/บาร์) ในโรงแรมยังเป็นร้านที่ไปได้ → ไม่ตัด
  if (!["museum", "cafe", "animalcafe", "restaurant", "nightlife"].includes(k) && NOT_ATTRACTION.test(name)) return null;
  if (k === "restaurant" && /คาเฟ่|\bcaf[eé]\b|coffee|กาแฟ/i.test(name)) return "cafe";
  if (k === "nature" && /^วัด|\bwat\b|temple/i.test(name)) return "landmark";
  if (["landmark", "zoo"].includes(k) && /^อุทยานแห่งชาติ|national park/i.test(name)) return "park";
  if (k === "landmark" && /^(ถ้ำ|หาด|ชายหาด|น้ำตก|เกาะ|จุดชมวิว)|\b(cave|beach|waterfall|island|viewpoint)\b/i.test(name) && !/^วัด|\bwat\b|temple/i.test(name)) return "nature";
  if (k === "landmark" && /อควาเรียม|\baquarium\b|สวนสัตว์|\bzoo\b/i.test(name)) return "zoo";
  if (k === "landmark" && /สวนน้ำ|water ?park|สวนสนุก|theme ?park/i.test(name)) return "themepark";
  if (k === "landmark" && /พิพิธภัณฑ์|\bmuseum\b|หอศิลป์|art (center|gallery)/i.test(name)) return "museum";
  return k;
}
