// สร้างรูปต้นแบบไอคอน/หน้าเปิดแอพ (assets/*.png) จากโลโก้ แล้วให้ @capacitor/assets ทำทุกขนาด
// รัน: node scripts/make-app-icons.mjs && npx capacitor-assets generate
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#ff7a45"/><stop offset=".5" stop-color="#ff2d78"/><stop offset="1" stop-color="#7b2ff7"/></linearGradient></defs>`;
// ตัว i + หมุด (พิกัดเดียวกับ icons/icon.svg)
const mark = `<path d="M256 70c-46 0-82 35-82 80 0 58 82 116 82 116s82-58 82-116c0-45-36-80-82-80z" fill="#fff"/>
  <circle cx="256" cy="148" r="28" fill="url(#g)"/>
  <rect x="210" y="296" width="92" height="148" rx="46" fill="#fff"/>`;
const svg = (body, bg = "") => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${grad}${bg}${body}</svg>`);
const png = (buf, size, file) => sharp(buf, { density: 600 }).resize(size, size).png().toFile(fileURLToPath(new URL(`../assets/${file}`, import.meta.url)));

await mkdir(new URL("../assets/", import.meta.url), { recursive: true });
const full = `<rect width="512" height="512" fill="url(#g)"/>`;
await png(svg(mark, full), 1024, "icon-only.png");
await png(svg(full), 1024, "icon-background.png");
// ไอคอนแบบปรับรูปทรงได้ของ Android: ย่อเครื่องหมายให้อยู่ในพื้นที่ปลอดภัยตรงกลาง
await png(svg(`<g transform="translate(128 128) scale(.5)">${mark}</g>`), 1024, "icon-foreground.png");
const splash = dark => svg(`<g transform="translate(206 206) scale(.195)"><rect width="512" height="512" rx="120" fill="url(#g)"/>${mark}</g>`, `<rect width="512" height="512" fill="${dark ? "#0f0a1e" : "#f7f5fb"}"/>`);
await png(splash(false), 2732, "splash.png");
await png(splash(true), 2732, "splash-dark.png");
console.log("สร้าง assets/ แล้ว");
