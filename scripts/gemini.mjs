// ตัวช่วยเรียก Google Gemini (โควต้าฟรี) ใช้ร่วมกันทุกสคริปต์
// Google เลิกใช้ชื่อรุ่นเก่าเป็นระยะ → ถามรายชื่อรุ่นที่ใช้ได้จริงจากคีย์นี้ แล้วเลือกรุ่น Flash ล่าสุดเอง
// บังคับรุ่นเองได้ด้วย GEMINI_MODEL=ชื่อรุ่น
const API = "https://generativelanguage.googleapis.com/v1beta";
let chosen;

export async function geminiModel(key) {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  if (chosen) return chosen;
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
    const names = res.ok ? (await res.json()).models
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace(/^models\//, "")) : [];
    // รุ่นข้อความทั่วไป (ไม่เอารุ่นรูปภาพ/เสียง/ทดลอง)
    const ok = names.filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/lite|image|tts|audio|live|exp|thinking|embedding/.test(n));
    const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    chosen = ok.includes("gemini-flash-latest") ? "gemini-flash-latest"
      : ok.filter(n => !/preview/.test(n)).sort((a, b) => ver(b) - ver(a))[0]
      || ok.sort((a, b) => ver(b) - ver(a))[0]
      || "gemini-flash-latest";
    console.log(`ใช้ Gemini รุ่น ${chosen}${res.ok ? "" : ` (อ่านรายชื่อรุ่นไม่ได้: ${res.status})`}`);
  } catch (e) { chosen = "gemini-flash-latest"; console.warn("อ่านรายชื่อรุ่น Gemini ไม่ได้:", e.message); }
  return chosen;
}

// ส่งคำสั่ง ได้ผลเป็น JSON กลับมา (โยน error พร้อม status ถ้าไม่สำเร็จ)
export async function geminiJSON(key, prompt, temperature = 0) {
  const model = await geminiModel(key);
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature } })
  });
  if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status} (${model})`), { status: res.status });
  const data = await res.json();
  return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || "null");
}
