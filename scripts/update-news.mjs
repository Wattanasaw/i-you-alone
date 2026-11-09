// ดึงข่าวอีเว้นท์อัตโนมัติจาก Google News RSS (ฟรี ไม่ต้องมี API key)
// ถ้าตั้งค่า GEMINI_API_KEY (ฟรีจาก Google AI Studio) จะให้ AI สกัดวันที่/สถานที่/ราคาเป็นร่างข้อมูลให้ด้วย
// รัน: node scripts/update-news.mjs
import { readFile, writeFile } from "node:fs/promises";
import { geminiJSON } from "./gemini.mjs";

const OUT = new URL("../data/news.json", import.meta.url);
const MAX_ITEMS = 120;     // เก็บข่าวล่าสุดกี่ข่าว
const MAX_AGE_DAYS = 30;   // ข่าวเก่ากว่านี้ตัดทิ้ง
const AI_PER_RUN = 15;     // ให้ AI สรุปข่าวใหม่สูงสุดกี่ข่าวต่อรอบ (อยู่ในโควต้าฟรี)

// คำค้นของแต่ละหมวด — เพิ่ม/แก้ได้ตามต้องการ
const QUERIES = {
  concert: ["คอนเสิร์ต กำหนดการ บัตร", "เฟสติวัล ดนตรี กรุงเทพ"],
  nightlife: ["ผับ บาร์ ดนตรีสด ศิลปิน โชว์", "ปาร์ตี้ ดีเจ ไนท์คลับ", "สปอนเซอร์ จัดงาน คอนเสิร์ตฟรี ศิลปิน"],
  seminar: ["งานสัมมนา ลงทะเบียน ฟรี", "ทอล์ก เสวนา กรุงเทพ"],
  learning: ["เวิร์กช็อป อบรม กรุงเทพ", "คลาสเรียน ทำเอง DIY"],
  social: ["speed dating กรุงเทพ", "ปาร์ตี้คนโสด หาคู่", "กิจกรรมหาเพื่อนใหม่"],
  book: ["งานหนังสือ มหกรรมหนังสือ"],
  motor: ["มอเตอร์โชว์", "มอเตอร์ เอ็กซ์โป งานแสดงรถยนต์", "MotoGP บุรีรัมย์ บัตร", "แข่งรถ ซูเปอร์ จีที ดริฟท์ สนามแข่ง", "บางแสน กรังด์ปรีซ์"],
  food: ["เทศกาลอาหาร ตลาดนัดอาหาร กรุงเทพ", "คาเฟ่ ป๊อปอัพ คอลแลบ", "เทศกาลกาแฟ"],
  festival: ["งานวัด งานประจำปี เทศกาล", "ลอยกระทง สงกรานต์ เคาท์ดาวน์ จัดที่ไหน"],
  run: ["งานวิ่ง มาราธอน เปิดรับสมัคร", "เทรลรัน ฟันรัน"],
  outdoor: ["HYROX ประเทศไทย", "ปั่นจักรยาน ไตรกีฬา กิจกรรมสุขภาพ", "ศึกมวย ONE ลุมพินี"],
  anime: ["งานคอสเพลย์ จัดงาน", "งานอนิเมะ Japan Expo Thailand", "Thailand Game Show งานเกม", "Comic Con กรุงเทพ", "อีสปอร์ต แข่งขัน ชมฟรี"],
  film: ["เทศกาลภาพยนตร์ กรุงเทพ", "โรงหนังกลางแจ้ง ฉายหนัง รูฟท็อป"],
  market: ["มหกรรมลดราคา ห้าง แฟลชเซล", "ตลาดนัด มาร์เก็ต จัดงาน", "มหกรรม OTOP สินค้าชุมชน จัดงาน", "ตลาดนัดอาร์ตทอย วินเทจ คราฟต์ มาร์เก็ต", "คริสต์มาสมาร์เก็ต งานกาชาด"],
  kpop: ["คอนเสิร์ต K-POP กรุงเทพ บัตร", "แฟนมีต ศิลปินเกาหลี กรุงเทพ"],
  fanmeet: ["แฟนมีต แฟนคอน กรุงเทพ"],
  show: ["ละครเวที มิวสิคัล เปิดขายบัตร", "โชว์ บัลเลต์ ละครสัตว์ กรุงเทพ"],
  expo: ["งานแสดงสินค้า ไบเทค อิมแพ็ค ศูนย์สิริกิติ์"],
  exhibition: ["นิทรรศการ กรุงเทพ", "นิทรรศการศิลปะ เปิดใหม่"]
};

const decode = s => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
  .trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : ""; };

async function fetchFeed(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:14d")}&hl=th&gl=TH&ceid=TH:th`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 IYouAloneBot" } });
  if (!res.ok) throw new Error(`${res.status} ${q}`);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1];
    const source = tag(it, "source");
    let title = tag(it, "title");
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, link: tag(it, "link"), pubDate: new Date(tag(it, "pubDate")).toISOString(), source };
  });
}

// ใช้ Gemini (ฟรี) สกัดข้อมูลงานจากหัวข้อข่าว — เป็นแค่ "ร่าง" ให้คนตรวจในหน้า admin ก่อนเผยแพร่
async function aiDraft(item, category) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const prompt = `จากหัวข้อข่าวภาษาไทยนี้ สกัดข้อมูลงานอีเว้นท์เป็น JSON เท่านั้น ถ้าไม่รู้ให้ใส่ null ห้ามเดา
หัวข้อ: "${item.title}" (แหล่ง: ${item.source}, วันที่ข่าว: ${item.pubDate.slice(0, 10)})
รูปแบบ: {"isEvent": boolean, "title": string, "category": one of ${JSON.stringify(Object.keys(QUERIES))}, "startDate": "YYYY-MM-DD"|null, "endDate": "YYYY-MM-DD"|null, "venueName": string|null, "price": {"type": "free"|"paid"|"mixed"|null, "min": number|null}, "summary": string}`;
  try {
    const d = await geminiJSON(key, prompt);
    if (!d?.isEvent) return { isEvent: false };
    return {
      title: d.title, category: d.category || category, startDate: d.startDate, endDate: d.endDate,
      summary: d.summary, details: d.venueName ? `สถานที่ (จากข่าว): ${d.venueName}` : undefined,
      price: d.price?.type ? { type: d.price.type, min: d.price.min ?? undefined } : undefined
    };
  } catch (e) { console.warn("AI failed:", e.message); return null; }
}

async function main() {
  let old = { items: [] };
  try { old = JSON.parse(await readFile(OUT, "utf8")); } catch {}
  const byLink = new Map(old.items.map(i => [i.link, i]));
  const seenTitles = new Set(old.items.map(i => i.title));
  // ข่าวที่ AI บอกว่าไม่ใช่งานอีเว้นท์ — จำไว้ ไม่ต้องส่งให้ AI ซ้ำทุกรอบ
  const rejected = new Set(old.rejected || []);
  const fresh = [];

  for (const [category, qs] of Object.entries(QUERIES)) {
    for (const q of qs) {
      try {
        for (const it of await fetchFeed(q)) {
          if (byLink.has(it.link) || seenTitles.has(it.title) || rejected.has(it.link)) continue;
          const item = { ...it, category };
          byLink.set(it.link, item); seenTitles.add(it.title); fresh.push(item);
        }
      } catch (e) { console.warn("feed failed:", e.message); }
      await new Promise(r => setTimeout(r, 800)); // สุภาพกับเซิร์ฟเวอร์
    }
  }

  let aiCount = 0, aiFails = 0;
  for (const item of fresh) {
    if (!process.env.GEMINI_API_KEY || aiCount >= AI_PER_RUN) break;
    const draft = await aiDraft(item, item.category);
    if (draft === null) {
      // คีย์ผิดหรือโควต้าหมด: หยุดเรียก AI รอบนี้ ข่าวยังอัปเดตตามปกติ
      if (++aiFails >= 3) { console.warn("AI ล้มเหลว 3 ครั้งติด — ข้ามการสรุปด้วย AI รอบนี้"); break; }
      continue;
    }
    aiFails = 0;
    aiCount++;
    if (draft.isEvent === false) { item.notEvent = true; rejected.add(item.link); } else item.draft = draft;
    await new Promise(r => setTimeout(r, 4500)); // ไม่เกินโควต้าฟรีต่อนาที
  }

  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  const items = [...byLink.values()]
    .filter(i => !i.notEvent && new Date(i.pubDate).getTime() > cutoff)
    .sort((a, b) => b.pubDate.localeCompare(a.pubDate))
    .slice(0, MAX_ITEMS);

  const keepRejected = [...rejected].slice(-1000);
  await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), items, rejected: keepRejected }, null, 2) + "\n");
  console.log(`news: +${fresh.length} ใหม่, ทั้งหมด ${items.length}, AI ${aiCount}`);
}

main();
