// แยก data/place-reviews.json (ไฟล์หลัก ~3.7 MB ที่สคริปต์อื่นใช้) เป็นไฟล์สำหรับแอพ ให้หน้าแรกโหลดเบาลง:
//   data/place-reviews-lite.json  — เฉพาะที่การ์ด/การเรียงลำดับใช้ (สรุปสั้น · เหมาะกับ · จำนวนแหล่ง)  โหลดตอนเปิดแอพ
//   data/place-reviews/NN.json    — รีวิวเต็ม (จุดเด่น ต้องลอง เคล็ดลับ ข้อควรรู้ แหล่งอ้างอิง) แบ่ง 32 ไฟล์ โหลดเมื่อเปิดหน้าสถานที่
// แบ่งไฟล์ด้วย FNV-1a เหมือน placeShard ใน js/app.js และ data/place-posts
// รัน: node scripts/split-reviews.mjs   (place-reviews.mjs เรียกให้อัตโนมัติหลังบันทึก)
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
export const SHARDS = 32;
export const shardOf = id => { let h = 0x811c9dc5; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h % SHARDS; };
// ช่องที่สคริปต์ใช้ภายใน แอพไม่ใช้ → ไม่ส่งไปให้ผู้ใช้
const INTERNAL = new Set(["v", "fv", "sig", "at"]);

export async function splitReviews(all) {
  all ??= JSON.parse(await readFile(new URL("data/place-reviews.json", root), "utf8"));
  const lite = {}, shards = Array.from({ length: SHARDS }, () => ({}));
  for (const [id, r] of Object.entries(all)) {
    if (!r?.summary || r.skip) continue; // แอพแสดงเฉพาะที่มีสรุป
    lite[id] = { summary: r.summary, ...(r.goodFor?.length ? { goodFor: r.goodFor } : {}), n: r.n || r.src?.length || 1 };
    shards[shardOf(id)][id] = Object.fromEntries(Object.entries(r).filter(([k]) => !INTERNAL.has(k)));
  }
  const save = async (p, obj) => { const u = new URL(p, root), tmp = new URL(p + ".tmp", root); await writeFile(tmp, JSON.stringify(obj) + "\n"); await rename(tmp, u); };
  await mkdir(new URL("data/place-reviews/", root), { recursive: true });
  await save("data/place-reviews-lite.json", lite);
  for (let i = 0; i < SHARDS; i++) await save(`data/place-reviews/${String(i).padStart(2, "0")}.json`, shards[i]);
  return Object.keys(lite).length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) console.log(`แยกรีวิว ${await splitReviews()} แห่ง → place-reviews-lite.json + place-reviews/00–31.json`);
