// รวมไฟล์เว็บเป็นชุดสำหรับแอพมือถือ (www/) แล้ว Capacitor จะนำไปใส่ในแอพ Android/iOS
// รัน: npm run app:sync   (= node scripts/build-app.mjs && npx cap sync)
import { cp, rm, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const out = new URL("www/", root);
await rm(out, { recursive: true, force: true });
await mkdir(new URL("data/", out), { recursive: true });

// หน้าเว็บ + รูป + โค้ด (ไม่เอาหน้าหลังบ้าน admin และ service worker)
for (const f of ["index.html", "privacy.html", "manifest.webmanifest"]) await cp(new URL(f, root), new URL(f, out));
for (const d of ["css", "icons"]) await cp(new URL(d + "/", root), new URL(d + "/", out), { recursive: true });
await cp(new URL("js/", root), new URL("js/", out), { recursive: true, filter: src => !src.endsWith("admin.js") });
// ข้อมูลชุดล่าสุด ติดแอพไว้ใช้ตอนออฟไลน์ (เปิดแอพแล้วมีเน็ตจะโหลดชุดใหม่จากเว็บเอง)
for (const f of ["events", "venues", "ads", "news", "auto-events", "places", "transit", "business-places", "trend-places", "place-reviews-lite", "place-ai", "outfits", "removed"]) await cp(new URL(`data/${f}.json`, root), new URL(`data/${f}.json`, out));
// รีวิวเต็มแบ่งไฟล์ (โหลดเมื่อเปิดหน้าสถานที่)
await cp(new URL("data/place-reviews/", root), new URL("data/place-reviews/", out), { recursive: true });
// บีบโค้ดในแอพ (ตัดคอมเมนต์/ช่องว่าง เปลี่ยนชื่อตัวแปรภายใน) — คนแกะไฟล์ APK อ่านและลอกยากขึ้น ไฟล์เล็กลง
// (เว็บบน GitHub Pages ยังใช้ไฟล์เดิม) · ใช้ esbuild แปลงทีละไฟล์ ไม่รวมไฟล์ (สคริปต์ใช้ตัวแปร window ร่วมกัน)
{
  const { transform } = await import("esbuild");
  const { readdir, readFile, writeFile } = await import("node:fs/promises");
  let before = 0, after = 0;
  for (const [dir, loader] of [["js/", "js"], ["css/", "css"]]) {
    for (const f of await readdir(new URL(dir, out))) {
      if (!f.endsWith("." + loader)) continue;
      const file = new URL(dir + f, out);
      const src = await readFile(file, "utf8");
      const r = await transform(src, { loader, minify: true, legalComments: "none", target: loader === "js" ? "es2020" : undefined, charset: "utf8" });
      await writeFile(file, `/* I You Alone © ${new Date().getFullYear()} Wattanasaw — สงวนลิขสิทธิ์ All rights reserved */\n` + r.code);
      before += src.length; after += r.code.length;
    }
  }
  console.log(`บีบโค้ดแอพ: ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB`);
}
console.log("สร้าง www/ สำหรับแอพแล้ว");
