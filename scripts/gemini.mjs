// ตัวช่วยเรียก Google Gemini (โควต้าฟรี) ใช้ร่วมกันทุกสคริปต์
// Google เลิกใช้ชื่อรุ่นเก่าเป็นระยะ → ถามรายชื่อรุ่นที่ใช้ได้จริงจากคีย์นี้ แล้วเรียงรุ่น Flash ที่เหมาะไว้หลายตัว
// ถ้ารุ่นแรกไม่ว่าง (503) หรือไม่มี (404) จะลองใหม่ แล้วเปลี่ยนไปรุ่นถัดไปเอง · บังคับรุ่นเองได้ด้วย GEMINI_MODEL=ชื่อรุ่น
const API = "https://generativelanguage.googleapis.com/v1beta";
const sleep = ms => new Promise(r => setTimeout(r, ms));
let candidates, current = 0;

export async function geminiModels(key) {
  if (candidates) return candidates;
  if (process.env.GEMINI_MODEL) return (candidates = [process.env.GEMINI_MODEL]);
  let names = [];
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    if (res.ok) names = (await res.json()).models
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace(/^models\//, ""));
    else console.warn("อ่านรายชื่อรุ่น Gemini ไม่ได้:", res.status);
  } catch (e) { console.warn("อ่านรายชื่อรุ่น Gemini ไม่ได้:", e.message); }
  // รุ่นข้อความทั่วไป (ไม่เอารุ่นรูปภาพ/เสียง/ทดลอง)
  const text = names.filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/image|tts|audio|live|exp|thinking|embedding/.test(n));
  const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const rank = n => (/latest/.test(n) ? 0 : 1) + (/preview/.test(n) ? 2 : 0) + (/lite/.test(n) ? 4 : 0);
  candidates = text.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a));
  if (!candidates.length) candidates = ["gemini-flash-latest", "gemini-flash-lite-latest"];
  console.log(`รุ่น Gemini ที่จะใช้ (เรียงตามลำดับ): ${candidates.slice(0, 4).join(", ")}`);
  return candidates;
}

// ส่งคำสั่ง ได้ผลเป็น JSON กลับมา (โยน error พร้อม status ถ้าไม่สำเร็จ)
export async function geminiJSON(key, prompt, temperature = 0) {
  const list = await geminiModels(key);
  let lastErr;
  while (current < list.length) {
    const model = list[current];
    for (let attempt = 1; attempt <= 2; attempt++) {
      let res;
      try {
        res = await fetch(`${API}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature } }),
          signal: AbortSignal.timeout(90000)
        });
      } catch (e) {
        // เน็ตหลุด/เซิร์ฟเวอร์ไม่ตอบ → ถือว่าไม่ว่างชั่วคราว (503)
        res = { ok: false, status: 503 };
        console.warn(`Gemini ไม่ตอบ (${model}): ${e.message}`);
      }
      if (res.ok) {
        const data = await res.json();
        return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "null");
      }
      // แนบข้อความจาก Google สั้นๆ ไว้ดูสาเหตุ (เช่น โควต้าแบบไหนหมด)
      let why = "";
      try { why = ((await res.json()).error?.message || "").replace(/\s+/g, " ").slice(0, 220); } catch {}
      lastErr = Object.assign(new Error(`Gemini ${res.status} (${model})${why ? ": " + why : ""}`), { status: res.status });
      // 429 = โควต้าฟรีหมด → หยุด (เปลี่ยนรุ่นก็ไม่ช่วยมาก รอรอบหน้า)
      if (res.status === 429) throw lastErr;
      if (res.status === 503 && attempt === 1) { await sleep(6000); continue; }
      break;
    }
    // รุ่นนี้ไม่ว่าง/ไม่มี → ใช้รุ่นถัดไปตลอดรอบนี้
    if (lastErr.status === 503 || lastErr.status === 404 || lastErr.status === 500) {
      current++;
      if (current < list.length) console.warn(`${lastErr.message} → เปลี่ยนไปใช้ ${list[current]}`);
      continue;
    }
    throw lastErr;
  }
  current = Math.max(0, list.length - 1); // ทุกรุ่นล้มเหลว: รอบต่อไปลองรุ่นสุดท้ายซ้ำ
  throw lastErr;
}
