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
for (const f of ["events", "venues", "ads", "news", "auto-events", "places", "transit"]) await cp(new URL(`data/${f}.json`, root), new URL(`data/${f}.json`, out));
console.log("สร้าง www/ สำหรับแอพแล้ว");
