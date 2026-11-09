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
    // ป๊อปอัพสโตร์/ร้านขายของที่ระลึก/คาเฟ่ธีมศิลปิน = ไปดู/ซื้อของ ไม่ใช่การแสดง → นิทรรศการ/ป๊อปอัพ (ไม่เข้า K-POP/แฟนมีต)
    popup: /\b(pop-?up( store| shop| cafe)?|popup|merch(andise)? (store|shop)|collab cafe|theme cafe|birthday cafe)\b|ป๊อปอัพ|ป็อปอัพ/i,
    kpop: /\b(k-?pop|kpop|k-?drama|korean|babymonster|big ?bang|qwer|bambam|jay ?b|got7|stray ?kids|suho|exo|enhypen|blackpink|jennie|jisoo|rosé|twice|seventeen|nct( ?127| ?dream| ?wish)?|wayv|aespa|le ?sserafim|newjeans|itzy|tomorrow ?x ?together|ateez|bts|jimin|jungkook|j-?hope|red ?velvet|mamamoo|\(?g\)?i-?dle|i-?dle|kiss ?of ?life|illit|boynextdoor|riize|zerobaseone|zb1|plave|nmixx|kep1er|fromis_?9|taeyeon|sunmi|chung ?ha|hwasa|akmu|day6|n\.ssign|xikers|cravity|monsta ?x|shinee|taemin|super ?junior|2pm|ikon|dreamcatcher|viviz|p1harmony|so ?ji ?sub|lee ?min ?ho|park ?bo ?gum|cha ?eun ?woo|btob|oh ?my ?girl|apink|g-?dragon|taeyang|daesung|zico|jay ?park|ph-?1|dynamic ?duo|epik ?high|10cm|hyolyn|baekhyun|xiumin|doyoung|taeil|mark ?tuan|jackson ?wang|yugyeom|youngjae|jinyoung|evnne|tempest|8turn|ampers&one|nexz|kickflip|hearts2hearts|izna|meovv|close ?your ?eyes|wave ?to ?earth|allday ?project)\b|[\uAC00-\uD7A3]{2}|เคป็อป|เกาหลี/i,
    anime: /\b(cosplay(er)?s?|anime|anisong|manga|comic ?-?con|comiket|otaku|vtubers?|isekai|japan expo|game ?show|e-?sports?|gaming (festival|expo|con)|tcg|trading card|card (expo|show|game)|pok[eé]mon|gundam|hololive|wonder ?festival|doujin)\b|คอสเพลย์|คอสเพล|อนิเมะ|การ์ตูนญี่ปุ่น|มังงะ|เกมโชว์|อีสปอร์ต|การ์ดเกม/i,
    // ดนตรีจากเกม/อนิเมะเล่นสด = คอนเสิร์ต (อยู่หมวดคอนเสิร์ต)
    animeConcert: /\b(concert|orchestra|symphon(y|ic)|live in|tour|recital)\b|คอนเสิร์ต/i,
    film: /\b(screenings?|cinema|movie night|film (lab|festival|fest|club|night|series)|rooftop (cinema|movie)|outdoor (cinema|movie)|sunday cinema)\b|ฉายหนัง|ฉายภาพยนตร์|เทศกาลหนัง|เทศกาลภาพยนตร์|ดูหนังกลางแปลง|หนังกลางแปลง/i,
    notFilm: /\bin concert\b|film concert|live concert|fan ?screening|final episode/i,
    market: /\b(markets?|bazaars?|flea|craft fair|vintage fair|art ?toy fair|christmas fair|ploenchit fair|otop|marché)\b|ตลาดนัด|ตลาด|มาร์เก็ต|มาร์เก็ท|ถนนคนเดิน|งานกาชาด|สินค้าชุมชน|โอทอป|ของดี.{0,12}(จังหวัด|ชุมชน|เมือง)/i,
    notMarket: /market(ing| research| insights?|place conference)|stock market|money market|capital market|crypto|traders?/i,
    fanmeet: /\b(fan ?meet(ing)?s?|fan-?con|fancon|fan ?sign|fansign|fan ?screening|fan ?party|meet ?(&|and) ?greet|hi-?touch|final episode)\b|แฟนมีต|แฟนคอน|แฟนไซน์/i,
    show: /\b(the musical|musical|theatre|theater|stage play|ballet|opera|circus|cirque|magic show|stand-?up|comedy|on ice|world live|puppet)\b|มิวสิคัล|ละครเวที|บัลเล่ต์|บัลเลต์|โอเปร่า|ละครสัตว์|มายากล|เดี่ยวไมโครโฟน|ทอล์คโชว์/i,
    notShow: /\bin concert\b|orchestra|piano|recital/i,
    run: /\b(run|runs|running|runner|marathon|half ?marathon|trail|ultra|ekiden|cross ?country|walk ?(&|and)? ?run|10k|21k|42k)\b|วิ่ง|มาราธอน|เทรล|ฮาล์ฟ|รัน(\s|$)/i,
    motor: /\b(driving experience|motor ?show|motor ?expo|car show|auto salon|auto show|bike week|big ?bike)\b|ยานยนต์|มอเตอร์โชว์|มอเตอร์ เอ็กซ์โป|งานแสดงรถ|บิ๊กไบค์/i,
    // งานแข่งรถ/มอเตอร์สปอร์ต (MotoGP F1 Super GT ดริฟท์ แดร็ก โกคาร์ท)
    race: /\b(moto ?gp|motogp|f1|formula ?(1|one|e|4)|grand ?prix|gp\b|super ?gt|superbike|wsbk|touring car|tcr|endurance|drag ?race|drag ?racing|drift(ing)?|rally|karting|go-?kart|motocross|supercross|enduro|time attack|track ?day|racing|race ?week|speed ?fest|circuit|bangsaen grand prix|super ?series|porsche carrera cup|gt3|nascar)\b|แข่งรถ|ดริฟท์|ดริฟต์|โมโตจีพี|ซูเปอร์ไบค์|แรลลี่|โกคาร์ท|โมโตครอส|สนามแข่ง|เซอร์กิต|ช้าง อินเตอร์เนชั่นแนล เซอร์กิต|บุรีรัมย์ เซอร์กิต/i
  };
  const is = (re, t) => re.test(t);
  function fixCategory(ev) {
    const t = String(ev?.title || ""), c = ev?.category;
    if (is(R.hide, t)) return null;
    // หมวดที่ยุบแล้ว: คาเฟ่ → อาหาร/คาเฟ่ · แฟลชเซล → ตลาดนัด/ช้อปปิ้ง
    if (c === "cafe") return fixCategory({ ...ev, category: "food" });
    if (c === "sale") return fixCategory({ ...ev, category: "market" });
    // อนิเมะ/เกม/คอสเพลย์ (ไม่ใช่คอนเสิร์ตเพลงเกม/อนิเมะ · ไม่ใช่ทอล์ก)
    if (c !== "anime" && c !== "seminar" && is(R.anime, t) && !(c === "concert" && is(R.animeConcert, t))) return "anime";
    // ฉายหนัง
    if (!["film", "fanmeet", "kpop"].includes(c) && is(R.film, t) && !is(R.notFilm, t)) return "film";
    // งานที่ประกาศยกเลิก (ชื่องานเหลือแค่ "ยกเลิก"/"Cancelled") → ไม่แสดง
    if (/^\s*(ยกเลิก|cancell?ed)(\s|$|[:\-–|])/i.test(t)) return null;
    // ประชุมวิชาการ/สัมมนาใหญ่ (ชื่อบอกชัด) → สัมมนา ก่อนกฎอื่น ("Veterinary Conference" เคยไปเวิร์กช็อปเพราะมีคำว่า Theme/Development)
    if (["learning", "expo", "concert", "seminar"].includes(c) && /\b(conference|congress|summit|symposium|convention)\b/i.test(t) && !/\b(expo|masterclass|workshop|camp)\b/i.test(t)) return "seminar";
    // ---- กรณีเฉพาะที่ตรวจเจอจากรายการจริง (ใช้ชื่องาน + สรุปงาน) ----
    const s = `${t} ${ev?.summary || ""}`;
    if (/\bwonderfruit\b/i.test(t)) return "concert";                                   // เทศกาลดนตรี/ศิลปะ (หน้าขายบัตร "The November Sale")
    if (/\b(furry|furbidden|bangkok ?beasts)\b/i.test(t)) return "expo";                // งานรวมตัวแฟนเฟอร์รี่ (คอนเวนชัน)
    if (/\brally games\b|movie rally/i.test(t)) return "expo";                          // เกมแรลลี่ธีมภาพยนตร์ ไม่ใช่งานแข่งรถ/เทศกาล
    if (/temples? to heaven|ไหว้พระ\s?9\s?วัด/i.test(t)) return "festival";             // ทัวร์ไหว้พระ
    if (/คริสตจักร|church/i.test(s) && /คริสต์มาส|christmas/i.test(s)) return "festival";
    if (c === "motor" && is(R.party, t)) return "nightlife";                            // ปาร์ตี้ดูแข่งรถ (Watch party)
    if (["concert", "nightlife"].includes(c) && /\b(improv|twoprov)\b|ด้นสด|sihnsart show|ละครเวที|มิวสิคัล/i.test(s) && !/คอนเสิร์ต|concert/i.test(t)) return "show";
    if (c === "concert" && /\b(premiere|starlympics)\b|^road to the /i.test(t)) return "fanmeet";       // งานเปิดตัวซีรีส์/กีฬาสีนักแสดง
    if (c === "nightlife" && /\bconcert\b|คอนเสิร์ต/i.test(t) && !is(R.party, t)) return "concert";
    if (c === "social" && !is(R.social, t) && /\b(dinner|buffet|brunch|thanksgiving)\b/i.test(t)) return "food";
    if (["seminar", "learning"].includes(c) && /\b(yoga|yogini|pilates)\b|โยคะ|พิลาทิส/i.test(s)) return "outdoor";
    if (c === "seminar" && /\b(paint|pottery|weav(e|ing)|craft|terracotta|clay)\b|ปั้น|ระบายสี|ทอผ้า/i.test(t)) return "learning";
    if (c === "outdoor" && /\bdj\b|tomorrowland|\bparty\b/i.test(s) && !is(R.run, t)) return "nightlife";
    if (c === "outdoor" && /\b\d+\s?km\b|วิ่ง|\brunning\b/i.test(s) && !/\b(muay|fight|lumpinee|football|ฟุตบอล)\b/i.test(t)) return "run";
    // ป๊อปอัพสโตร์ (ก่อน K-POP/แฟนมีต)
    if (c !== "exhibition" && is(R.popup, t) && !is(R.fanmeet, t) && !/\b(concert|tour|live)\b|คอนเสิร์ต/i.test(t)) return "exhibition";
    // K-POP: เฉพาะการแสดง/พบปะศิลปินเกาหลี — คอนเสิร์ต แฟนคอน แฟนมีต แฟนไซน์ โชว์เคส
    if (["concert", "fanmeet", "expo", "exhibition", "nightlife", "festival"].includes(c) && is(R.kpop, t) && !is(R.popup, t)) return "kpop";
    // ชื่องานไม่บอก แต่รายละเอียด (AI สรุปจากหน้างาน) บอกว่าเป็นศิลปิน/วง/นักแสดงเกาหลี
    if (["concert", "fanmeet"].includes(c) && /k-?pop|ศิลปินเกาหลี|(วง|นักร้อง|ไอดอล|นักแสดง|บอยแบนด์|เกิร์ลกรุ๊ป)[^ ]{0,12}s?เกาหลี|korean (artist|band|singer|actor|actress|idol|group)/i.test(`${ev?.details || ""} ${ev?.summary || ""}`)) return "kpop";
    // ตลาดนัด/มาร์เก็ต (ไม่ใช่สัมมนาการตลาด/ตลาดหุ้น)
    if (c !== "market" && !["seminar", "learning"].includes(c) && is(R.market, t) && !is(R.notMarket, t)) return "market";
    // งานวิ่ง: แยกจากกีฬา (แหล่ง RunLah = งานวิ่งทั้งหมด)
    if (c === "outdoor" && !is(R.party, t) && (ev?.sourceName === "RunLah" || is(R.run, t))) return "run";
    // แฟนมีต/แฟนคอน/ป๊อปอัพศิลปิน · ละครเวที/มิวสิคัล/โชว์
    if (["concert", "expo", "exhibition", "nightlife"].includes(c) && is(R.fanmeet, t)) return is(R.kpop, t) ? "kpop" : "fanmeet";
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
    // งานแข่งรถ → ยานยนต์/แข่งรถ (ไม่ใช่ปาร์ตี้ธีมแข่งรถ / งานวิ่งในสนามแข่ง)
    if (c !== "motor" && ["outdoor", "run", "expo", "concert", "festival", "exhibition"].includes(c) && is(R.race, t) && !is(R.party, t) && !is(R.run, t) && !/\b(movie|rally games|treasure rally|photo rally|walk rally)\b/i.test(t)) return "motor";
    // หมวดเดิม "สัมมนา/เรียนรู้": ไม่ใช่การเรียนลงมือทำ = สัมมนา/ทอล์ก
    if (c === "learning" && !is(R.learning, t)) return "seminar";
    return c;
  }
  root.IYA_fixCategory = fixCategory;
})(typeof window !== "undefined" ? window : globalThis);
