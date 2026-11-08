// จัดหมวดอีเว้นท์ที่ "หลง" ให้ถูก จากคำในชื่ออีเว้นท์ (ใช้ทั้งในแอพ และใน scripts/event-details.mjs ทุกรอบดึงข้อมูล)
// AI/กฎเดิมบางทีจัดผิด เช่น speed dating ในบาร์ → ปาร์ตี้/ผับ, Cat Expo → อาหาร, conference → งานแฟร์
// ย้ายเฉพาะกรณีที่ชื่อบอกชัด (from → to) ไม่ไปแตะอีเว้นท์ที่ไม่เข้ากฎ · คืนค่า null = ไม่ควรแสดง (เช่น งานกัญชา)
(function (root) {
  const R = {
    hide: /\b(420|cannabis|weed|marijuana|kush)\b|กัญชา/i,
    social: /\b(speed ?dating|singles?|dating|matchmaking|blind ?date|cupid|new friends|make friends|meet new people|social club|book club|reading club|language exchange|board ?game night|no strangers|introverts?|tinder)\b|คนโสด|หาคู่|หาแฟน|จับคู่|หาเพื่อนใหม่|เพื่อนใหม่|ชมรมหนังสือ|ชมรมอ่าน|บอร์ดเกม/i,
    festival: /\b(loy ?krathong|songkran|yi ?peng|yeepeng|lanterns? festival|sky lanterns?|countdown|fireworks|chinese new year|vegetarian festival)\b|ลอยกระทง|สงกรานต์|งานวัด|งานประจำปี|ประเพณี|ยี่เป็ง|เคาท์ดาวน์|เคานต์ดาวน์|เทศกาลโคม|พลุ|ตรุษจีน|กินเจ/i,
    notFestival: /music festival|concert|คอนเสิร์ต|fansign|fan ?meet|fancon|showcase|dinner|ดินเนอร์|buffet|บุฟเฟ่ต์|pool party|run\b|วิ่ง/i,
    party: /\b(full ?moon|half ?moon|waterfall festival|hii festival|jungle party|pool party|boat party|yacht party|t-?dance|rave|white party|party|parties|cocktails?|bar crawl|pub crawl)\b|ปาร์ตี้/i,
    seminar: /\b(conference|conf|congress|summit|symposium|forum|convention|seminar|talks?|keynote|panel|ted ?x|pechakucha|webinar|meetup)\b|สัมมนา|ประชุมวิชาการ|เสวนา|ทอล์ก|บรรยาย/i,
    learning: /\b(workshop|masterclass|class|course|bootcamp|training|camp|lab|hands-?on|mastery|diy|development|developers?|fundamentals|essentials|theory and practice|programming|coding|software testing|rag|llms?|ai agents?|for everyday work|from concept to)\b|เวิร์กช็อป|เวิร์คช็อป|เวิร์กชอป|เวิร์คชอป|คอร์ส|ค่าย|ห้องเรียนจำลอง|อบรม|ติว|ตะลุยโจทย์|คลาส/i,
    expo: /\b(expo|trade ?show|card show|traders show|fair|techspo)\b|มหกรรม|งานแสดงสินค้า|แฟร์|เอ็กซ์โป/i,
    exhibition: /\b(exhibition|exhibit|pop-?up|art center|art island|gallery|museum|immersive)\b|นิทรรศการ|ป๊อปอัพ|พิพิธภัณฑ์/i,
    market: /\b(markets?|bazaars?|flea|craft fair|vintage fair|art ?toy fair|christmas fair|ploenchit fair|otop|marché)\b|ตลาดนัด|ตลาด|มาร์เก็ต|มาร์เก็ท|ถนนคนเดิน|งานกาชาด|สินค้าชุมชน|โอทอป|ของดี.{0,12}(จังหวัด|ชุมชน|เมือง)/i,
    notMarket: /market(ing| research| insights?|place conference)|stock market|money market|capital market|crypto|traders?/i,
    fanmeet: /\b(fan ?meet(ing)?s?|fan-?con|fancon|fan ?sign|fansign|fan ?screening|fan ?party|meet ?(&|and) ?greet|hi-?touch|character pop-?up|official .{0,30}pop-?up|final episode)\b|แฟนมีต|แฟนคอน|แฟนไซน์/i,
    show: /\b(the musical|musical|theatre|theater|stage play|ballet|opera|circus|cirque|magic show|stand-?up|comedy|on ice|world live|puppet)\b|มิวสิคัล|ละครเวที|บัลเล่ต์|บัลเลต์|โอเปร่า|ละครสัตว์|มายากล|เดี่ยวไมโครโฟน|ทอล์คโชว์/i,
    notShow: /\bin concert\b|orchestra|piano|recital/i,
    run: /\b(run|runs|running|runner|marathon|half ?marathon|trail|ultra|ekiden|cross ?country|walk ?(&|and)? ?run|10k|21k|42k)\b|วิ่ง|มาราธอน|เทรล|ฮาล์ฟ|รัน(\s|$)/i,
    motor: /\b(driving experience|motor ?show|car show|auto salon)\b|ยานยนต์|มอเตอร์โชว์/i
  };
  const is = (re, t) => re.test(t);
  function fixCategory(ev) {
    const t = String(ev?.title || ""), c = ev?.category;
    if (is(R.hide, t)) return null;
    // ตลาดนัด/มาร์เก็ต (ไม่ใช่สัมมนาการตลาด/ตลาดหุ้น)
    if (c !== "market" && !["seminar", "learning"].includes(c) && is(R.market, t) && !is(R.notMarket, t)) return "market";
    // งานวิ่ง: แยกจากกีฬา (แหล่ง RunLah = งานวิ่งทั้งหมด)
    if (c === "outdoor" && !is(R.party, t) && (ev?.sourceName === "RunLah" || is(R.run, t))) return "run";
    // แฟนมีต/แฟนคอน/ป๊อปอัพศิลปิน · ละครเวที/มิวสิคัล/โชว์
    if (["concert", "expo", "exhibition", "nightlife"].includes(c) && is(R.fanmeet, t)) return "fanmeet";
    if (["concert", "expo", "exhibition"].includes(c) && is(R.show, t) && !is(R.notShow, t)) return "show";
    // คริสต์มาส/ฮาโลวีนเฟสติวัล (งานรวมกิจกรรม ไม่ใช่คอนเสิร์ต)
    if (["concert", "expo"].includes(c) && /\b(christmas|halloween) (festival|fair|fest)\b|คริสต์มาส เฟสติวัล/i.test(t)) return "festival";
    // วงดนตรี/ศิลปินต่างชาติ (ชื่อภาษารัสเซีย) · fan screening · music festival → คอนเสิร์ต
    if (["expo", "nightlife", "festival", "seminar"].includes(c) && (/[\u0400-\u04FF]{3}/.test(t) || /\b(music|beats?) festival\b|\bkirtan\b/i.test(t))) return "concert";
    // ทอล์ก/งานบรรยายที่ไม่มีคำว่า seminar (ภาษาฝรั่งเศส · หัวข้อ AI)
    if (["expo", "outdoor"].includes(c) && /\bcomment se\b|\bconférence\b|\bunsucking ai\b|\bai era\b|pattern recognition|machine learning/i.test(t)) return "seminar";
    if (["concert", "festival"].includes(c) && /\baviation festival\b/i.test(t)) return "seminar";
    if (c === "outdoor" && is(R.party, t)) return "nightlife";
    if (c === "outdoor" && /\b(breathwork|sauna|ice bath|meditation)\b|สมาธิ/i.test(t)) return "learning";
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
