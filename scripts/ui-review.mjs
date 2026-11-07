// ให้ AI (Gemini / GitHub Models) ตรวจความใช้งานง่ายของแอพจาก "ภาพหน้าจอจริง" บนมือถือ
// ถ่ายภาพเว็บจริงด้วย Playwright (จอ 390×844) หลายหน้า → ส่งให้ AI วิเคราะห์ปัญหา UI/UX + ข้อเสนอแนะ → reports/ui-review.md
// รันใน GitHub Actions (.github/workflows/ui-review.yml) · ในเครื่อง: ติดตั้ง playwright ไว้ใน .tools/ ก่อน
import { writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { aiJSON, aiAvailable, aiName } from "./gemini.mjs";

const root = new URL("../", import.meta.url);
const BASE = (process.env.UI_URL || "https://wattanasaw.github.io/i-you-alone/").replace(/\/?$/, "/");
let chromium;
try { ({ chromium } = await import("playwright")); } catch { ({ chromium } = createRequire(new URL(".tools/package.json", root))("playwright")); }
if (!aiAvailable()) { console.log("ไม่มี AI (GEMINI_API_KEY/GITHUB_TOKEN) — ข้าม"); process.exit(0); }

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: "th-TH", isMobile: true, hasTouch: true });
const wait = ms => page.waitForTimeout(ms);
const shots = [], notes = [];
async function shot(label, fn) {
  try {
    await fn();
    await wait(1800);
    const buf = await page.screenshot({ type: "jpeg", quality: 62 });
    const m = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, y: Math.round(scrollY) }));
    shots.push({ label, mime: "image/jpeg", b64: buf.toString("base64") });
    notes.push(`${shots.length - 1}. ${label} — ความยาวหน้า ${m.height}px (จอ 844px), ตำแหน่งเลื่อน ${m.y}px`);
  } catch (e) { console.warn("ถ่ายภาพไม่ได้:", label, e.message); }
}
const go = async hash => { await page.goto(BASE + hash, { waitUntil: "networkidle", timeout: 60000 }); };

await shot("หน้าแรก (อีเว้นท์) — จอแรก", () => go("#/"));
await shot("หน้าแรก — เลื่อนลงไปที่รายการงาน", async () => { await page.evaluate(() => document.getElementById("results")?.scrollIntoView()); });
await shot("รายละเอียดงาน", async () => { const h = await page.evaluate(() => document.querySelector('a[href^="#/event/"]')?.getAttribute("href")); await go(h || "#/"); });
await shot("หน้าที่เที่ยว — จอแรก", () => go("#/places"));
await shot("หน้าที่เที่ยว — เลื่อนลงไปที่รายการ", async () => { await page.evaluate(() => document.getElementById("placesHead")?.scrollIntoView()); });
await shot("รายละเอียดสถานที่ — แท็บภาพรวม", async () => { const h = await page.evaluate(() => [...document.querySelectorAll(".place-card")].find(c => c.querySelector("img.cover-img"))?.querySelector("a")?.getAttribute("href")); await go(h || "#/places"); });
await shot("รายละเอียดสถานที่ — แท็บการเดินทาง", async () => { await page.click('[data-ptab="travel"]').catch(() => {}); });
await shot("หน้าบันทึก", () => go("#/saved"));
await shot("หน้าบัญชีสมาชิก", () => go("#/account"));
await browser.close();
console.log(`ถ่ายภาพ ${shots.length} หน้า · AI: ${aiName()}`);

const prompt = `คุณเป็นผู้เชี่ยวชาญ UX/UI แอพมือถือ ตรวจแอพ "I You Alone" (รวมงานอีเว้นท์และที่เที่ยวในไทย กลุ่มเป้าหมายวัยรุ่น/วัยทำงานคนไทย ใช้บนมือถือเป็นหลัก)
แนบภาพหน้าจอมือถือจริง ${shots.length} ภาพตามลำดับ (เลข 0 เป็นต้นไป):
${notes.join("\n")}
ประเมินความใช้งานง่าย: ลำดับความสำคัญของข้อมูล, ต้องเลื่อนมากไหม, ปุ่มกดง่ายไหม (ขนาด ≥ 44px), ตัวหนังสืออ่านง่ายไหม/คอนทราสต์, ความสม่ำเสมอ, สิ่งที่ชวนสับสน, สิ่งที่ขาด
ตอบเป็นภาษาไทย ให้เจาะจงพอที่นักพัฒนาแก้ได้ทันที (บอกว่าอยู่ภาพไหน ส่วนไหน ควรแก้เป็นอะไร) ห้ามชมทั่วไป
ส่งกลับ JSON:
{"score": 1-10, "summary": "สรุป 2-3 ประโยค",
 "issues": [{"screen": เลขภาพ, "severity": "high|medium|low", "problem": "...", "fix": "..."}],
 "top_fixes": ["5 อย่างที่ควรแก้ก่อน เรียงตามผลกระทบ"],
 "good": ["สิ่งที่ทำได้ดีแล้ว (สั้นๆ ไม่เกิน 3 ข้อ)"]}`;
const r = await aiJSON(prompt, { images: shots });
const sev = { high: "🔴 สูง", medium: "🟠 กลาง", low: "🟢 ต่ำ" };
const md = `# ผลตรวจ UI โดย AI (${aiName()})

ตรวจเมื่อ ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · จอมือถือ 390×844 · เว็บ ${BASE}

**คะแนนความใช้งานง่าย: ${r?.score ?? "-"}/10**

${r?.summary || ""}

## ควรแก้ก่อน
${(r?.top_fixes || []).map((x, i) => `${i + 1}. ${x}`).join("\n")}

## ปัญหาที่พบ
| หน้าจอ | ระดับ | ปัญหา | วิธีแก้ |
|---|---|---|---|
${(r?.issues || []).sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity)).map(x => `| ${shots[x.screen]?.label || x.screen} | ${sev[x.severity] || x.severity} | ${String(x.problem).replace(/\|/g, "/")} | ${String(x.fix).replace(/\|/g, "/")} |`).join("\n")}

## ทำได้ดีแล้ว
${(r?.good || []).map(x => `- ${x}`).join("\n")}

## หน้าที่ตรวจ
${notes.map(n => `- ${n}`).join("\n")}
`;
await mkdir(new URL("reports/", root), { recursive: true });
await writeFile(new URL("reports/ui-review.md", root), md);
console.log(md);
