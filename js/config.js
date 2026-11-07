// ===== ตั้งค่าแอพ — แก้ไขไฟล์นี้ไฟล์เดียวก็ปรับแอพได้เกือบทั้งหมด =====
// ข้อความหน้าจออื่น ๆ ทั้ง 3 ภาษาอยู่ใน js/i18n.js
window.APP_CONFIG = {
  siteName: "I You Alone",
  tagline: { th: "วันนี้ไปเที่ยวไหนดี?", en: "Where to go today?", zh: "今天去哪儿玩？" },
  contactEmail: "", // อีเมลสำหรับติดต่อลงโฆษณา เช่น "ads@yourmail.com"
  contactLine: "",  // LINE ID หรือลิงก์ LINE OA เช่น "https://lin.ee/xxxx"
  languages: ["th", "en", "zh"], // ภาษาที่เปิดให้เลือก

  // หมวดหมู่งาน (id ต้องตรงกับ category ใน data/events.json)
  categories: [
    // color / color2 = สีไล่เฉดของปกการ์ด
    { id: "concert", icon: "🎤", color: "#ff2d78", color2: "#7b2ff7", name: { th: "คอนเสิร์ต", en: "Concerts", zh: "演唱会" } },
    // ศิลปินเล่นตามผับบาร์ ปาร์ตี้ ดีเจ (แสดงป้าย 20+ อัตโนมัติ)
    { id: "nightlife", icon: "🌙", color: "#4c1d95", color2: "#db2777", adult: true, name: { th: "ปาร์ตี้/ผับ", en: "Nightlife", zh: "夜生活" } },
    // คนโสด/หาคู่/หาเพื่อนใหม่: speed dating, ปาร์ตี้คนโสด, ชมรม/มีตอัพหาเพื่อน
    { id: "social", icon: "💘", color: "#e11d48", color2: "#fb7185", name: { th: "หาเพื่อน/คู่", en: "Meet people", zh: "交友" } },
    { id: "seminar", icon: "🗣️", color: "#1d4ed8", color2: "#7c3aed", name: { th: "สัมมนา", en: "Talks", zh: "讲座" } },
    { id: "learning", icon: "🎓", color: "#2f7cf6", color2: "#00c2c7", name: { th: "เวิร์กช็อป", en: "Workshops", zh: "工作坊" } },
    { id: "book", icon: "📚", color: "#8b5cf6", color2: "#ec4899", name: { th: "งานหนังสือ", en: "Book fairs", zh: "书展" } },
    { id: "motor", icon: "🏎️", color: "#0ea47a", color2: "#1e3a8a", name: { th: "มอเตอร์โชว์", en: "Motor shows", zh: "车展" } },
    { id: "sale", icon: "🛍️", color: "#ff7a45", color2: "#ff2d55", name: { th: "แฟลชเซล", en: "Flash sales", zh: "限时特卖" } },
    { id: "food", icon: "🍜", color: "#f59e0b", color2: "#ef4444", name: { th: "อาหาร", en: "Food", zh: "美食" } },
    // งานประเพณี/เทศกาล (ลอยกระทง สงกรานต์ งานวัด เคาท์ดาวน์ ยี่เป็ง)
    { id: "festival", icon: "🏮", color: "#dc2626", color2: "#facc15", name: { th: "เทศกาล", en: "Festivals", zh: "节庆" } },
    { id: "outdoor", icon: "🏃", color: "#16a34a", color2: "#06b6d4", name: { th: "วิ่ง/กีฬา", en: "Sports", zh: "运动" } },
    { id: "cafe", icon: "☕", color: "#b45309", color2: "#f9a8d4", name: { th: "คาเฟ่", en: "Cafés", zh: "咖啡馆" } },
    { id: "expo", icon: "🏢", color: "#475569", color2: "#0ea5e9", name: { th: "งานแฟร์", en: "Expos", zh: "展会" } },
    { id: "exhibition", icon: "🎨", color: "#be185d", color2: "#f59e0b", name: { th: "นิทรรศการ", en: "Exhibitions", zh: "展览" } }
  ],

  // หมวดสถานที่เที่ยว (หน้า "ที่เที่ยว") — ข้อมูลจาก data/places.json (scripts/fetch-places.mjs)
  placeCategories: [
    // เรียง: คาเฟ่และสถานที่บันเทิงก่อน · restaurant = ร้านที่เจ้าของร้านเพิ่มเอง (ผ่าน AI ตรวจ)
    { id: "cafe", icon: "☕", color: "#b45309", color2: "#f9a8d4", name: { th: "คาเฟ่", en: "Cafés", zh: "咖啡馆" } },
    { id: "animalcafe", icon: "🐱", color: "#f97316", color2: "#facc15", name: { th: "คาเฟ่สัตว์", en: "Animal cafés", zh: "动物咖啡馆" } },
    { id: "restaurant", icon: "🍽️", color: "#dc2626", color2: "#f59e0b", name: { th: "ร้านอาหาร", en: "Restaurants", zh: "餐厅" } },
    // ผับ/บาร์/ร้านนั่งดื่มกลางคืน (แสดงป้าย 20+ อัตโนมัติ)
    { id: "nightlife", icon: "🍸", color: "#4c1d95", color2: "#db2777", adult: true, name: { th: "ผับ/บาร์", en: "Bars", zh: "酒吧" } },
    { id: "themepark", icon: "🎢", color: "#e11d48", color2: "#8b5cf6", name: { th: "สวนสนุก", en: "Theme parks", zh: "游乐园" } },
    { id: "zoo", icon: "🦒", color: "#65a30d", color2: "#0d9488", name: { th: "สวนสัตว์", en: "Zoos", zh: "动物园" } },
    { id: "beach", icon: "🏖️", color: "#0284c7", color2: "#22d3ee", name: { th: "ทะเล", en: "Beaches", zh: "海滩" } },
    { id: "nature", icon: "🏞️", color: "#0891b2", color2: "#22c55e", name: { th: "น้ำตก/วิว", en: "Nature", zh: "自然风光" } },
    { id: "temple", icon: "🛕", color: "#d97706", color2: "#f59e0b", name: { th: "วัด", en: "Temples", zh: "寺庙" } },
    { id: "landmark", icon: "📍", color: "#d97706", color2: "#7c3aed", name: { th: "แลนด์มาร์ก", en: "Landmarks", zh: "地标" } },
    { id: "museum", icon: "🏛️", color: "#475569", color2: "#a16207", name: { th: "พิพิธภัณฑ์", en: "Museums", zh: "博物馆" } },
    { id: "park", icon: "⛰️", color: "#15803d", color2: "#0369a1", name: { th: "อุทยาน", en: "National parks", zh: "国家公园" } }
  ],

  // ===== ระบบสมาชิก (Supabase แพ็กเกจฟรี) =====
  // ว่างไว้ = ปิดระบบสมาชิก (หน้า "บัญชี" จะแจ้งว่าเร็วๆ นี้) · วิธีเปิดดู README-TH.md หัวข้อ "ระบบสมาชิก"
  // anon key เป็นคีย์สาธารณะ ใส่ในเว็บได้ (ความปลอดภัยอยู่ที่ Row Level Security ใน supabase/schema.sql)
  // คะแนน/รีวิว/เวลาเปิดจาก Google Maps (Places API ทางการ) — ดึงสดเฉพาะเมื่อผู้ใช้กดปุ่มในหน้าสถานที่ ไม่เก็บลงข้อมูลของเรา
  // ว่าง = ปิดฟีเจอร์ · คีย์แบบเบราว์เซอร์ (ต้องจำกัดเว็บไซต์ + จำกัดเฉพาะ Places API (New) + ตั้งโควต้าต่อวันใน Google Cloud)
  googlePlaces: {
    apiKey: ""
  },

  members: {
    supabaseUrl: "https://sfqnckcnnszrvloybmtf.supabase.co",      // เช่น "https://xxxx.supabase.co"
    supabaseAnonKey: "sb_publishable_BsM0vVzgy5La0K1_75d9qw_0WR1Tnkk"   // Project Settings → API → anon public
  },

  // ===== โฆษณา =====
  // 1) ยังไม่มี Google AdSense: เว้นว่าง adsenseClient ไว้ แอพจะแสดงแบนเนอร์จาก data/ads.json
  //    (ขายโฆษณาตรงเองได้ ไม่ต้องรออนุมัติ) หรือป้าย "พื้นที่โฆษณาว่าง"
  // 2) ได้ AdSense แล้ว: ใส่ "ca-pub-xxxxxxxxxxxxxxxx" และ slot id ของแต่ละตำแหน่ง
  ads: {
    adsenseClient: "",
    slots: { home_top: "", list_inline: "", detail: "", news: "" },
    inlineEvery: 6 // แทรกโฆษณาทุกๆ กี่การ์ดในหน้ารายการ
  },

  // ===== Affiliate ของเว็บขายบัตร =====
  // ถ้าสมัครเป็นพันธมิตรกับเว็บขายบัตรแล้ว ใส่พารามิเตอร์ที่ได้ เช่น "aff=รหัสของคุณ"
  // แอพจะต่อเข้ากับปุ่ม "ซื้อบัตร" ของงานที่ดึงมาจากเว็บนั้นให้อัตโนมัติ
  ticketAffiliate: { "eventpop.me": "", "zipeventapp.com": "" },

  // ===== แอพมือถือ (Android/iOS) =====
  // แอพมีข้อมูลชุดหนึ่งติดเครื่องไว้ใช้ตอนออฟไลน์ แต่จะโหลดข้อมูลล่าสุดจากเว็บนี้ทุกครั้งที่เปิด
  webUrl: "https://wattanasaw.github.io/i-you-alone/",
  apkUrl: "https://github.com/Wattanasaw/i-you-alone/releases/download/android-latest/i-you-alone.apk",

  affiliateDisclosure: {
    th: "ลิงก์บางส่วนเป็นลิงก์พันธมิตร (Affiliate) เราอาจได้รับค่าคอมมิชชันเมื่อคุณซื้อผ่านลิงก์ โดยคุณไม่ต้องจ่ายเพิ่ม",
    en: "Some links are affiliate links. We may earn a commission when you buy through them, at no extra cost to you.",
    zh: "部分链接为联盟推广链接，您通过链接购买时我们可能获得佣金，您无需额外付费。"
  }
};
