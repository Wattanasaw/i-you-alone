// ราคาน้ำมันขายปลีกวันนี้ (บางจาก · กทม.) → data/fuel.json ใช้คำนวณค่าน้ำมันในหน้าการเดินทาง
// ดึงไม่ได้ → เก็บค่าเดิมไว้ (แอพมีค่าสำรองในตัว) · node scripts/fuel-price.mjs
import { readFile, writeFile, rename } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const OUT = new URL("data/fuel.json", root);
// ชื่อน้ำมันของบางจาก → ชนิดในแอพ
const MAP = [
  ["g95", /^แก๊สโซฮอล์ 95/], ["g91", /^แก๊สโซฮอล์ 91/], ["e20", /^แก๊สโซฮอล์ E20/], ["e85", /^แก๊สโซฮอล์ E85/],
  ["diesel", /^ไฮดีเซล S$|^ไฮดีเซล$|^ดีเซล$/], ["b20", /^ดีเซล B20/]
];
try {
  const res = await fetch("https://oil-price.bangchak.co.th/ApiOilPrice2/th", { headers: { "User-Agent": "IYouAloneBot/1.0 (+https://wattanasaw.github.io/i-you-alone/)" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = (await res.json())[0];
  const list = JSON.parse(j.OilList || "[]");
  const prices = {};
  for (const [id, re] of MAP) {
    const o = list.find(x => re.test(String(x.OilName || "").trim()));
    const p = +o?.PriceToday;
    if (p > 10 && p < 100) prices[id] = p;
  }
  if (!prices.g95) throw new Error("ไม่พบราคาแก๊สโซฮอล์ 95");
  // วันที่ราคามีผล (พ.ศ. dd/mm/yyyy → ค.ศ.)
  const [d, m, y] = String(j.OilPriceDate || "").split("/").map(Number);
  const date = y ? `${y - 543}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : new Date().toISOString().slice(0, 10);
  const out = { date, src: "Bangchak", prices };
  const tmp = new URL("data/fuel.json.tmp", root);
  await writeFile(tmp, JSON.stringify(out, null, 1) + "\n");
  await rename(tmp, OUT);
  console.log("ราคาน้ำมัน", date, JSON.stringify(prices));
} catch (e) {
  console.warn("ดึงราคาน้ำมันไม่ได้ ใช้ค่าเดิม:", e.message);
  try { await readFile(OUT); } catch { console.warn("ยังไม่มี data/fuel.json — แอพใช้ค่าสำรอง"); }
}
