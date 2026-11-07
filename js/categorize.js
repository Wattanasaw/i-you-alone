// จัดหมวดอีเว้นท์ที่ "หลง" ให้ถูก จากคำในชื่ออีเว้นท์ (ใช้ทั้งในแอพ และใน scripts/event-details.mjs ทุกรอบดึงข้อมูล)
// AI/กฎเดิมบางทีจัดผิด เช่น speed dating ในบาร์ → ปาร์ตี้/ผับ, Cat Expo → อาหาร, conference → งานแฟร์
// ย้ายเฉพาะกรณีที่ชื่อบอกชัด (from → to) ไม่ไปแตะอีเว้นท์ที่ไม่เข้ากฎ · คืนค่า null = ไม่ควรแสดง (เช่น งานกัญชา)
(function (root) {
  const R = {
    hide: /\b(420|cannabis|weed|marijuana|kush)\b|กัญชา/i,
    social: /\b(speed ?dating|singles?|dating|matchmaking|blind ?date|cupid|new friends|make friends|meet new people|social club|book club|reading club|language exchange|board ?game night|no strangers|introverts?)\b|คนโสด|หาคู่|หาแฟน|จับคู่|หาเพื่อนใหม่|เพื่อนใหม่|ชมรมหนังสือ|ชมรมอ่าน|บอร์ดเกม/i,
    festival: /\b(loy ?krathong|songkran|yi ?peng|yeepeng|lanterns? festival|sky lanterns?|countdown|fireworks|chinese new year|vegetarian festival)\b|ลอยกระทง|สงกรานต์|งานวัด|งานประจำปี|ประเพณี|ยี่เป็ง|เคาท์ดาวน์|เคานต์ดาวน์|เทศกาลโคม|พลุ|ตรุษจีน|กินเจ/i,
    notFestival: /concert|คอนเสิร์ต|fansign|fan ?meet|fancon|showcase|dinner|ดินเนอร์|buffet|บุฟเฟ่ต์|pool party|run\b|วิ่ง/i,
    party: /\b(full ?moon|half ?moon|waterfall festival|hii festival|jungle party|pool party|boat party|yacht party|t-?dance|rave|white party|party|parties|cocktails?|bar crawl|pub crawl)\b|ปาร์ตี้/i,
    seminar: /\b(conference|conf|congress|summit|symposium|forum|convention|seminar|talks?|keynote|panel|ted ?x|pechakucha|webinar|meetup)\b|สัมมนา|ประชุมวิชาการ|เสวนา|ทอล์ก|บรรยาย/i,
    learning: /\b(workshop|masterclass|class|course|bootcamp|training|camp|lab|hands-?on|mastery|diy|development|developers?|fundamentals|essentials|theory and practice|programming|coding|software testing|rag|llms?|ai agents?|for everyday work|from concept to)\b|เวิร์กช็อป|เวิร์คช็อป|เวิร์กชอป|เวิร์คชอป|คอร์ส|ค่าย|ห้องเรียนจำลอง|อบรม|ติว|ตะลุยโจทย์|คลาส/i,
    expo: /\b(expo|trade ?show|card show|traders show|fair|techspo)\b|มหกรรม|งานแสดงสินค้า|แฟร์|เอ็กซ์โป/i,
    exhibition: /\b(exhibition|exhibit|pop-?up|art center|art island|gallery|museum|immersive)\b|นิทรรศการ|ป๊อปอัพ|พิพิธภัณฑ์/i,
    motor: /\b(driving experience|motor ?show|car show|auto salon)\b|ยานยนต์|มอเตอร์โชว์/i
  };
  const is = (re, t) => re.test(t);
  function fixCategory(ev) {
    const t = String(ev?.title || ""), c = ev?.category;
    if (is(R.hide, t)) return null;
    if (c !== "social" && is(R.social, t)) return "social";
    if (["food", "concert", "expo", "nightlife"].includes(c) && is(R.festival, t) && !is(R.notFestival, t)) return "festival";
    if (["concert", "food", "learning", "seminar"].includes(c) && is(R.party, t) && !is(R.seminar, t)) return "nightlife";
    if (["learning", "seminar", "food", "concert"].includes(c) && is(R.expo, t) && !is(R.seminar, t)) return "expo";
    // ประชุมวิชาการ/สัมมนาใหญ่ ชัดเจนที่สุด (แม้ชื่อมีคำว่า development/AI)
    if (["expo", "concert", "learning"].includes(c) && /\b(conference|conf|congress|summit|symposium|convention)\b/i.test(t) && !/\bexpo\b/i.test(t)) return "seminar";
    if (["expo", "seminar"].includes(c) && is(R.learning, t)) return "learning";
    if (["expo", "concert", "learning"].includes(c) && is(R.seminar, t) && !is(R.learning, t)) return "seminar";
    if (["expo", "concert"].includes(c) && is(R.exhibition, t)) return "exhibition";
    if (["expo", "learning", "seminar"].includes(c) && is(R.motor, t)) return "motor";
    // หมวดเดิม "สัมมนา/เรียนรู้": ไม่ใช่การเรียนลงมือทำ = สัมมนา/ทอล์ก
    if (c === "learning" && !is(R.learning, t)) return "seminar";
    return c;
  }
  root.IYA_fixCategory = fixCategory;
})(typeof window !== "undefined" ? window : globalThis);
