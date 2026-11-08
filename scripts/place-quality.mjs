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
  const best = [...times].sort((a, b) => b[1] - a[1])[0];
  if (best) {
    const off = [...offs].sort((a, b) => b[1] - a[1])[0];
    out.hours = `Mo-Su ${best[0]}${off ? `; ${off[0]} off` : ""}`;
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
  return out;
}
