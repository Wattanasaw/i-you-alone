// ===== ตั้งค่าแอพ — แก้ไขไฟล์นี้ไฟล์เดียวก็ปรับแอพได้เกือบทั้งหมด =====
// ข้อความหน้าจออื่น ๆ ทั้ง 3 ภาษาอยู่ใน js/i18n.js
window.APP_CONFIG = {
  siteName: "I You Alone",
  tagline: { th: "วันนี้ไปงานไหนดี?", en: "Where to go today?", zh: "今天去哪儿玩？" },
  contactEmail: "", // อีเมลสำหรับติดต่อลงโฆษณา เช่น "ads@yourmail.com"
  contactLine: "",  // LINE ID หรือลิงก์ LINE OA เช่น "https://lin.ee/xxxx"
  languages: ["th", "en", "zh"], // ภาษาที่เปิดให้เลือก

  // หมวดหมู่งาน (id ต้องตรงกับ category ใน data/events.json)
  categories: [
    // color / color2 = สีไล่เฉดของปกการ์ด
    { id: "concert", icon: "🎤", color: "#ff2d78", color2: "#7b2ff7", name: { th: "คอนเสิร์ต/บันเทิง", en: "Concerts & shows", zh: "演唱会/娱乐" } },
    // ศิลปินเล่นตามผับบาร์ ปาร์ตี้ ดีเจ (แสดงป้าย 20+ อัตโนมัติ)
    { id: "nightlife", icon: "🌙", color: "#4c1d95", color2: "#db2777", adult: true, name: { th: "ไนท์ไลฟ์/ผับบาร์", en: "Nightlife & bars", zh: "夜生活/酒吧" } },
    { id: "learning", icon: "🎓", color: "#2f7cf6", color2: "#00c2c7", name: { th: "สัมมนา/เรียนรู้", en: "Seminars & learning", zh: "讲座/学习" } },
    { id: "book", icon: "📚", color: "#8b5cf6", color2: "#ec4899", name: { th: "งานหนังสือ", en: "Book fairs", zh: "书展" } },
    { id: "motor", icon: "🏎️", color: "#0ea47a", color2: "#1e3a8a", name: { th: "มอเตอร์โชว์", en: "Motor shows", zh: "车展" } },
    { id: "sale", icon: "🛍️", color: "#ff7a45", color2: "#ff2d55", name: { th: "แฟลชเซล/ลดราคา", en: "Flash sales", zh: "限时特卖" } },
    { id: "food", icon: "🍜", color: "#f59e0b", color2: "#ef4444", name: { th: "อาหาร/เทศกาล", en: "Food & festivals", zh: "美食/节庆" } },
    { id: "outdoor", icon: "🏃", color: "#16a34a", color2: "#06b6d4", name: { th: "เอาท์ดอร์/สายสุขภาพ", en: "Outdoor & fitness", zh: "户外/健身" } },
    { id: "cafe", icon: "☕", color: "#b45309", color2: "#f9a8d4", name: { th: "คาเฟ่", en: "Cafés", zh: "咖啡馆" } },
    { id: "expo", icon: "🎨", color: "#475569", color2: "#0ea5e9", name: { th: "งานแสดงสินค้า/นิทรรศการ", en: "Expos & exhibitions", zh: "展会/展览" } }
  ],

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
