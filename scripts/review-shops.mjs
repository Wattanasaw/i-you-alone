// AI ตรวจร้านที่สมาชิกธุรกิจส่งเข้ามา ก่อนเผยแพร่ (รันใน GitHub Actions ทุก 2 ชั่วโมง)
// ตรวจ 2 อย่าง:
//  1) ตำแหน่งตรงกับแผนที่จริง: หมุดอยู่ในไทย + มีสถานที่ชื่อเดียวกันใน OpenStreetMap ภายใน 150 ม.
//     หรือ AI อ่านป้ายชื่อร้านในรูปได้ตรงกับชื่อที่ส่งมา
//  2) รูปภาพ: AI ดูทุกรูป — ต้องเป็นรูปจริงของร้าน (ไม่ใช่โลโก้/สกรีนช็อต/รูปจากเน็ต) ตรงประเภท และไม่มีเนื้อหาไม่เหมาะสม
// ผล: approved (ขึ้นแอพ) / needs_fix (แจ้งเหตุผลให้แก้) / rejected (เนื้อหาไม่เหมาะสม) — เจ้าของร้านเห็นเหตุผลในหน้าบัญชี
// ร้านที่อนุมัติแล้วทั้งหมด → data/business-places.json (แอพรวมเข้าหน้า "ที่เที่ยว" พร้อมป้าย "ร้านที่ยืนยันแล้ว")
// ต้องมี GitHub secrets: SUPABASE_URL, SUPABASE_SERVICE_KEY (ไม่มี = ข้าม) + AI (GEMINI_API_KEY หรือ GitHub Models)
import { readFile, writeFile, rename } from "node:fs/promises";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const URL_ = process.env.SUPABASE_URL?.replace(/\/$/, ""), KEY = process.env.SUPABASE_SERVICE_KEY;
const UA = "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)";
const BUCKET = "shop-photos", MAX_PER_RUN = 15;
const root = new URL("../", import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const save = async (p, text) => { const tmp = new URL(p + ".tmp", root); await writeFile(tmp, text); await rename(tmp, new URL(p, root)); };
if (!URL_ || !KEY) { console.log("ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_KEY — ข้าม (ระบบสมาชิกยังไม่เปิด)"); process.exit(0); }

const win = {}; new Function("window", await readFile(new URL("js/i18n.js", root), "utf8"))(win);
const PROVINCES = win.PROVINCES;
const PLACES = JSON.parse(await readFile(new URL("data/places.json", root), "utf8")).places || [];
function provinceId(state) {
  const th = String(state || "").replace(/^จังหวัด|^จ\.\s*/, "").trim();
  if (/กรุงเทพ|bangkok/i.test(th)) return "bangkok";
  const n = th.toLowerCase().replace(/province|changwat/g, "").replace(/[^a-z฀-๿]/g, "");
  return (PROVINCES.find(p => p.th === th) || PROVINCES.find(p => p.en.toLowerCase().replace(/[^a-z]/g, "") === n))?.id || null;
}

async function rest(path, opt = {}) {
  // คีย์แบบใหม่ (sb_secret_...) ส่งเฉพาะ apikey · คีย์ service_role แบบเก่า (JWT) ส่งเป็น Bearer ด้วย
  const auth = KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` };
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opt, headers: { apikey: KEY, ...auth, "Content-Type": "application/json", Prefer: "return=representation", ...(opt.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}
const photoUrl = path => `${URL_}/storage/v1/object/public/${BUCKET}/${path}`;

// ---------- 1) ตำแหน่ง ----------
const norm = s => String(s || "").toLowerCase().replace(/^(ร้าน|คาเฟ่|cafe|café|the)\s*/i, "").replace(/[^a-z0-9฀-๿]/g, "");
const sameName = (a, b) => { const x = norm(a), y = norm(b); return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)); };
const km = (a, b) => { const r = d => d * Math.PI / 180, h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
async function reverse(s) {
  await sleep(1100);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=th&lat=${s.lat}&lon=${s.lng}`, { headers: { "User-Agent": UA } });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function nearbyNames(s) {
  const q = `[out:json][timeout:40];nwr(around:150,${s.lat},${s.lng})["name"];out center tags 80;`;
  for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) continue;
      return ((await r.json()).elements || []).map(e => ({
        names: [e.tags.name, e.tags["name:th"], e.tags["name:en"], e.tags.brand].filter(Boolean),
        type: e.tags.amenity || e.tags.shop || e.tags.tourism || e.tags.leisure || "",
        d: Math.round(km(s, { lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon }) * 1000)
      })).filter(x => Number.isFinite(x.d)).sort((a, b) => a.d - b.d);
    } catch {}
  }
  return null; // ตรวจไม่ได้ (ไม่ใช่ไม่พบ)
}

// ---------- 2) รูป ----------
async function photo(path) {
  try {
    const r = await fetch(photoUrl(path), { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return { mime: r.headers.get("content-type")?.split(";")[0] || "image/jpeg", b64: buf.toString("base64") };
  } catch { return null; }
}
const KIND_EN = { restaurant: "restaurant", cafe: "café", animalcafe: "animal café (cat/dog/etc. café)", attraction: "tourist attraction" };

async function review(s) {
  const rev = await reverse(s);
  const inThailand = !rev || rev.address?.country_code === "th";
  const province = provinceId(rev?.address?.state || rev?.address?.province || (rev?.address?.city === "กรุงเทพมหานคร" ? "กรุงเทพ" : ""));
  const near = await nearbyNames(s);
  // เจ้าของร้านเพิ่มข้อมูลให้สถานที่ที่มีในแอพอยู่แล้ว: หมุดต้องอยู่ใกล้ตำแหน่งเดิม (≤ 200 ม.)
  const refPlace = s.ref_place && PLACES.find(p => p.id === s.ref_place);
  const refD = refPlace ? Math.round(km(s, refPlace) * 1000) : null;
  const match = (refPlace && refD <= 200 ? { names: [refPlace.name?.th || refPlace.name?.en], d: refD } : null) || near?.find(x => x.names.some(n => sameName(n, s.name)));
  const images = (await Promise.all(s.photos.slice(0, 5).map(photo))).filter(Boolean);
  if (!images.length) return { status: "needs_fix", reasons: ["โหลดรูปไม่ได้ กรุณาอัปโหลดรูปใหม่"], province };

  const prompt = `You verify a shop listing submitted by a business owner to a Thai travel app before it is published.
Shop: ${JSON.stringify({ name: s.name, type: KIND_EN[s.kind], description: s.description || "", address_from_pin: rev?.display_name || "", named_places_on_map_within_150m: (near || []).slice(0, 12).map(x => `${x.names[0]} (${x.type}, ${x.d} m)`) })}
${images.length} photos are attached in order (numbered from 0). For EACH photo report:
- real_photo: true if it is a genuine camera photo of a real place/food/drink (false for logos, posters, menus-only graphics, screenshots, AI-generated or obvious stock/watermarked internet images)
- matches_type: true if it plausibly shows this type of business (storefront, interior, food, drinks, animals for an animal café, the attraction itself)
- inappropriate: true for nudity, violence, illegal items, hate, or misleading content
- sign_text: the shop name text visible on any sign/menu/cup in the photo, or null
- quality: 1–10 (sharp, bright, well-framed)
Then overall:
- name_ok: false if the name/description is spam, offensive, a phone number/URL only, or clearly misleading
- sign_matches_name: true if any visible sign text matches the shop name (Thai/English transliteration allowed)
- cover: photo number best suited as the cover (most attractive real photo)
- summary_th: 1–2 neutral Thai sentences describing the shop using only the given data and what the photos show (no prices or claims you cannot see)
- problems_th: list of short Thai explanations of any problems, written to the shop owner (empty if none)
Return JSON: {"photos":[{"i","real_photo","matches_type","inappropriate","sign_text","quality"}],"name_ok","sign_matches_name","cover","summary_th","problems_th":[]}`;
  const ai = await aiJSON(prompt, { images });
  const ph = Array.isArray(ai?.photos) ? ai.photos : [];
  const good = ph.filter(p => p.real_photo && p.matches_type && !p.inappropriate && +p.quality >= 4);
  const reasons = Array.isArray(ai?.problems_th) ? ai.problems_th.map(String).slice(0, 5) : [];
  const checks = { inThailand, osmMatch: match ? `${match.names[0]} (${match.d} ม.)` : null, overpassOk: near !== null, signMatch: !!ai?.sign_matches_name, goodPhotos: good.length, photos: ph.length };
  const base = { province, checks, cover: Number.isInteger(+ai?.cover) && +ai.cover < s.photos.length ? +ai.cover : 0, summary: String(ai?.summary_th || "").slice(0, 240) };

  if (ph.some(p => p.inappropriate) || ai?.name_ok === false)
    return { ...base, status: "rejected", reasons: reasons.length ? reasons : ["เนื้อหาหรือรูปภาพไม่เหมาะสมกับการเผยแพร่"] };
  if (!inThailand) return { ...base, status: "needs_fix", reasons: ["หมุดตำแหน่งไม่อยู่ในประเทศไทย"] };
  if (!good.length) return { ...base, status: "needs_fix", reasons: [...reasons, "ต้องมีรูปจริงของร้านอย่างน้อย 1 รูป (หน้าร้าน บรรยากาศ หรืออาหาร/เครื่องดื่ม) ที่ชัดเจน"].slice(0, 5) };
  if (!match && !ai?.sign_matches_name) {
    return { ...base, status: "needs_fix", reasons: [...reasons, near === null
      ? "ตรวจตำแหน่งบนแผนที่ไม่สำเร็จชั่วคราว — เพิ่มรูปหน้าร้านที่เห็นป้ายชื่อชัดเจน แล้วส่งตรวจอีกครั้ง"
      : "ไม่พบร้านชื่อนี้บนแผนที่ใกล้หมุด และไม่เห็นป้ายชื่อร้านในรูป — ตรวจให้หมุดตรงหน้าร้าน หรือเพิ่มรูปหน้าร้านที่เห็นป้ายชื่อชัดเจน"].slice(0, 5) };
  }
  return { ...base, status: "approved", reasons: [] };
}

// ---------- ทำงาน ----------
const pending = await rest(`submissions?status=eq.pending&select=*&order=created_at.asc&limit=${MAX_PER_RUN}`);
console.log(`ร้านรอตรวจ ${pending.length} · AI: ${aiName()}`);
let done = 0;
for (const s of pending) {
  if (!aiAvailable()) { console.log("ไม่มี AI ที่ใช้ได้รอบนี้ — เก็บไว้ตรวจรอบหน้า"); break; }
  try {
    const r = await review(s);
    await rest(`submissions?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({
      status: r.status, province: r.province || s.province,
      ai_result: { reasons: r.reasons, checks: r.checks, cover: r.cover, summary: r.summary, by: aiName() },
      reviewed_at: new Date().toISOString()
    }) });
    done++;
    console.log(`${r.status}: ${s.name} ${r.reasons.join(" / ")}`);
  } catch (e) { console.warn(`ตรวจ ${s.name} ไม่สำเร็จ (รอบหน้าลองใหม่):`, e.message.slice(0, 160)); if (e.status === 429) break; }
  await sleep(4000);
}

// ร้านที่อนุมัติแล้วทั้งหมด → ไฟล์ข้อมูลของแอพ
const approved = await rest("submissions?status=eq.approved&select=*&order=reviewed_at.desc&limit=2000");
const places = approved.map(s => ({
  id: "biz-" + s.id, kind: s.kind === "attraction" ? (PLACES.find(p => p.id === s.ref_place)?.kind || "landmark") : s.kind, business: true, fame: 6,
  replaces: s.ref_place || undefined,
  name: { th: s.name }, lat: s.lat, lng: s.lng, province: s.province || s.ai_result?.province || null,
  address: s.address || undefined, hours: s.hours || undefined, phone: s.phone || undefined, website: s.website || undefined,
  image: photoUrl(s.photos[s.ai_result?.cover || 0] || s.photos[0]), imageCredit: "รูปจากร้าน",
  photos: s.photos.map(photoUrl),
  summary: { th: s.ai_result?.summary || s.description || "" },
  menuPrice: s.price_min != null || s.price_max != null ? { min: s.price_min ?? s.price_max, max: s.price_max ?? s.price_min, src: "owner" } : undefined,
  entry: s.entry_fee === 0 ? { free: true, src: "owner" } : s.entry_fee ? { thai: s.entry_fee, src: "owner" } : undefined,
  verifiedAt: s.reviewed_at
})).filter(p => p.province);
await save("data/business-places.json", JSON.stringify(places, null, 1) + "\n");
console.log(`ตรวจรอบนี้ ${done} ร้าน · เผยแพร่ทั้งหมด ${places.length} ร้าน`);
