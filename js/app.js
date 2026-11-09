(() => {
  "use strict";
  const C = window.APP_CONFIG;
  const app = document.getElementById("app");
  const CAT = Object.fromEntries(C.categories.map(c => [c.id, c]));
  const PROV = Object.fromEntries(window.PROVINCES.map(p => [p.id, p]));
  const DAY = 86400000;

  const state = {
    events: [], venues: {}, ads: [], news: { updatedAt: null, items: [] },
    filters: { q: "", cat: "all", when: "all", price: "all", sort: "soon", showEnded: false, province: readLS("province", "all") },
    saved: new Set(readLS("saved", [])),
    lang: pickLang(),
    newsCat: "all",
    // มือถือเริ่มที่รายการย่อ (เห็นหลายงานต่อจอ) จอใหญ่เริ่มที่การ์ดรูปใหญ่
    view: readLS("view", window.innerWidth < 760 ? "list" : "grid"),
    places: [], trends: {}, placeCat: "all", placeQ: "", placeShow: 30,
    pos: null
  };
  // จังหวัดที่จำไว้ไม่ถูกต้อง (เช่น ค่าว่าง) → กลับไปทุกจังหวัด
  if (state.filters.province !== "all" && !PROV[state.filters.province]) state.filters.province = "all";

  // ---------- helpers ----------
  function readLS(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }
  function pickLang() {
    const langs = C.languages || ["th"];
    const saved = readLS("lang", null);
    if (langs.includes(saved)) return saved;
    const nav = (navigator.language || "th").slice(0, 2).toLowerCase();
    return langs.includes(nav) ? nav : langs[0];
  }
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => /^(https?:\/\/|#\/)/i.test(u || "") ? esc(u) : "#";

  // ---------- เปิดลิงก์ภายนอก ----------
  const UA = navigator.userAgent;
  // เปิดอยู่ในแอพมือถือ (Capacitor: Android/iOS) ไม่ใช่เว็บ
  const NATIVE = !!window.Capacitor?.isNativePlatform?.();
  // ระบบสมาชิก: ปิดไว้ก่อน (ซ่อนเมนูบัญชี ปุ่มอ้างสิทธิ์ร้าน และหน้า #/account)
  const MEMBERS = false;
  // ลิงก์ที่แชร์ให้คนอื่นต้องเป็นลิงก์เว็บจริง (ในแอพ location.href เป็น https://localhost)
  const publicUrl = () => NATIVE ? C.webUrl + location.hash : location.href;
  const PLATFORM = /Android/i.test(UA) ? "android"
    : (/iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1)) ? "ios" : "desktop";
  // ติดตั้งเป็นแอพแล้ว (เปิดจากไอคอนหน้าจอหลัก)
  const isStandalone = () => NATIVE || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // ข่าว / เว็บผู้จัด / ขายบัตร: ถ้าติดตั้งแอพแล้ว เปิดในหน้าต่างเดิม → มือถือจะเปิดเป็นเบราว์เซอร์ในแอพ
  // (Android: Chrome Custom Tab, iPhone: Safari View) กด ✕ / เสร็จสิ้น แล้วกลับมาที่แอพ
  // ถ้ายังไม่ได้ติดตั้ง เปิดแท็บใหม่เพื่อไม่ให้หน้าแอพหายไป
  const inAppLink = url => `href="${safeUrl(url)}" rel="noopener"${isStandalone() ? "" : ` target="_blank"`}`;

  // ---------- ภาษา ----------
  const dict = () => window.I18N[state.lang] || window.I18N.th;
  // ข้อความหน้าจอ: t("found", { n: 3 })
  const t = (key, params = {}) => String(dict()[key] ?? window.I18N.th[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
  // ข้อความที่เป็น { th, en, zh } ใน config
  // ภาษาจีนไม่มีคำแปล → ใช้ภาษาอังกฤษก่อน (อ่านง่ายกว่าภาษาไทยสำหรับคนจีน) แล้วค่อยไทย
  const pick = obj => typeof obj === "string" ? obj : (obj?.[state.lang] || (state.lang === "zh" ? obj?.en : "") || obj?.th || "");
  // เนื้อหางาน/สถานที่: ใช้คำแปลใน i18n.<lang> ถ้ามี ไม่งั้นใช้ภาษาไทยต้นฉบับ
  const tr = (item, field) => item?.i18n?.[state.lang]?.[field] ?? item?.[field];
  const isLatinName = s => /[a-z]/i.test(s || "") && !/[฀-๿]/.test(s || "");
  const evTitle = ev => isLatinName(ev?.title) ? (isLatinName(ev.i18n?.en?.title) ? ev.i18n.en.title : ev.title) : tr(ev, "title");
  const isTranslated = (item, field) => state.lang === "th" || item?.i18n?.[state.lang]?.[field] != null || item?.[field] == null;
  const catName = c => pick(c?.name);
  const provName = id => PROV[id] ? (PROV[id][state.lang] || PROV[id].en) : "";
  const locale = () => dict().locale;

  const parseDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const fmtDate = (d, opt = { day: "numeric", month: "short", year: "numeric" }) => d.toLocaleDateString(locale(), opt);
  const ymd = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

  // ร้านที่เปิดประจำ (ongoing เช่น คาเฟ่) ไม่มีวันจบ
  const endOf = ev => ev.ongoing ? new Date(9999, 0, 1) : parseDate(ev.endDate || ev.startDate);
  function dateRange(ev) {
    if (ev.ongoing) return tr(ev, "openDays") || t("openDaily");
    const s = parseDate(ev.startDate), e = parseDate(ev.endDate || ev.startDate);
    if (+s === +e) return fmtDate(s, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const sameYear = s.getFullYear() === e.getFullYear();
    return `${fmtDate(s, sameYear ? { day: "numeric", month: "short" } : undefined)} – ${fmtDate(e)}`;
  }
  function status(ev) {
    const now = today(), s = parseDate(ev.startDate), e = endOf(ev);
    if (now > e) return { key: "ended", text: t("ended") };
    if (ev.ongoing && now >= s) return { key: "open", text: (now - s) / DAY < 30 ? t("newOpen") : t("openNow") };
    if (now >= s) {
      const left = Math.round((e - now) / DAY);
      return { key: "live", text: left === 0 ? t("lastDay") : t("liveLeft", { n: left + 1 }) };
    }
    const n = Math.round((s - now) / DAY);
    return { key: "soon", text: n === 1 ? t("tomorrow") : t("inDays", { n }) };
  }
  function priceLabel(p = {}) {
    if (p.type === "free") return { cls: "free", text: t("free") };
    const fmt = n => Number(n).toLocaleString(locale());
    if (p.type === "mixed") return { cls: "free", text: t("mixed") };
    if (p.type === "unknown") return { cls: "paid", text: t("priceUnknown") };
    const ap = p.approx ? "≈ " : ""; // แปลงจากสกุลเงินอื่น (เช่น USD)
    if (p.min && p.max && p.min !== p.max) return { cls: "paid", text: `${ap}${t("currency")}${fmt(p.min)}–${fmt(p.max)}` };
    if (p.min) return { cls: "paid", text: `${ap}${t("currency")}${fmt(p.min)}` };
    return { cls: "paid", text: t("paid") };
  }
  // วันปิดรับสมัคร (งานวิ่ง/แข่งขัน): null ถ้าไม่มี
  function registration(ev) {
    if (!ev.registerBy || status(ev).key === "ended") return null;
    const n = Math.round((parseDate(ev.registerBy) - today()) / DAY);
    const date = fmtDate(parseDate(ev.registerBy), { day: "numeric", month: "short" });
    if (n < 0) return { closed: true, text: t("registerClosed") };
    return { closed: false, soon: n <= 7, text: n === 0 ? t("registerToday") : t("registerLeft", { n }), date: t("registerBy", { date }) };
  }
  const isFree = ev => ev.price?.type === "free" || ev.price?.type === "mixed";
  const venueOf = ev => (ev.venueId && state.venues[ev.venueId]) || ev.venue || null;
  const venueName = v => v && !v.online ? tr(v, "name") : t("online");
  const provinceOf = ev => venueOf(ev)?.province || null;
  // ชื่อสถานที่จัดงานมีชื่อจังหวัดอยู่แล้ว (เช่น "หัวหิน จ.ประจวบคีรีขันธ์") → ไม่ต่อท้ายจังหวัดซ้ำ
  const hasProv = (text, id) => { const p = (window.PROVINCES || []).find(x => (x.id || x[0]) === id); const names = [provName(id), ...(Array.isArray(p) ? p.slice(1) : [])].filter(Boolean); return names.some(n => String(text || "").toLowerCase().includes(String(n).toLowerCase())); };
  // งานออนไลน์แสดงทุกจังหวัด
  const inProvince = ev => state.filters.province === "all" || venueOf(ev)?.online || provinceOf(ev) === state.filters.province;
  function distanceKm(a, b) {
    const R = 6371, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function cover(ev, cls = "cover") {
    const cat = CAT[ev.category] || { icon: "📅", color: "#888" };
    const bg = `background:linear-gradient(135deg, ${cat.color}, ${cat.color2 || cat.color})`;
    const s = parseDate(ev.startDate);
    const chip = ev.ongoing && s <= today()
      ? `<div class="datechip"><b>${t("chipOpen")}</b><span>${t("chipDaily")}</span></div>`
      : `<div class="datechip"><b>${s.getDate()}</b><span>${fmtDate(s, { month: "short" })}</span></div>`;
    // รูปจริงจากต้นทาง ถ้าโหลดไม่ได้จะเหลือพื้นสีไล่เฉด + ไอคอนหมวดแทน
    const img = /^https:\/\//.test(ev.image || "")
      // โลโก้งานขนาดเล็ก (ตารางงานคอสเพลย์ Props&Ops) แสดงทั้งรูปไม่ตัดขอบ
      ? `<img class="cover-img${/propsops\.net\/event\/logo/.test(ev.image) ? " cover-logo" : ""}" src="${esc(ev.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="var c=this.nextElementSibling;if(c&&c.classList.contains('credit'))c.remove();this.remove()">${ev.sourceName ? `<span class="credit">📷 ${esc(ev.sourceName)}</span>` : ""}`
      : "";
    return `<div class="${cls}" style="${bg}"><span class="emoji">${cat.icon}</span>${img}${chip}`;
  }
  // ต่อพารามิเตอร์ Affiliate ของเว็บขายบัตร (ตั้งใน config.js) เข้ากับลิงก์ซื้อบัตร
  function withAffiliate(url) {
    try {
      const u = new URL(url);
      const param = Object.entries(C.ticketAffiliate || {}).find(([host, p]) => p && u.hostname.endsWith(host))?.[1];
      if (param) new URLSearchParams(param).forEach((v, k) => u.searchParams.set(k, v));
      return u.href;
    } catch { return url; }
  }

  // ---------- data ----------
  async function getJSON(path, fallback) {
    // แอพมือถือ: โหลดข้อมูลล่าสุดจากเว็บก่อน ถ้าออฟไลน์ใช้ชุดที่ติดมากับแอพ
    if (NATIVE) {
      try {
        const r = await fetch(C.webUrl + path, { cache: "no-cache", signal: AbortSignal.timeout(8000) });
        if (r.ok) return await r.json();
      } catch {}
    }
    try {
      const r = await fetch(path, { cache: "no-cache" });
      return r.ok ? await r.json() : fallback;
    } catch { return fallback; }
  }
  async function load() {
    const [events, venues, ads, news, auto, places, biz, trendPl, reviews, aiInfo, removed, outfits] = await Promise.all([
      getJSON("data/events.json", []),
      getJSON("data/venues.json", []),
      getJSON("data/ads.json", []),
      getJSON("data/news.json", { items: [] }),
      getJSON("data/auto-events.json", { events: [] }),
      getJSON("data/places.json", { places: [], trends: {} }),
      getJSON("data/business-places.json", []),  // ร้านที่สมาชิกธุรกิจเพิ่ม (AI ตรวจผ่านแล้ว)
      getJSON("data/trend-places.json", []),     // สถานที่จากโพสต์เทรนด์ (หมุดสถานที่ใน Lemon8 + พิกัด OSM)
      getJSON("data/place-reviews-lite.json", {}), // AI สรุปรีวิวจากโพสต์จริง: แค่สรุปสั้น + เหมาะกับ (รีวิวเต็มโหลดตอนเปิดหน้าสถานที่)
      getJSON("data/place-ai.json", {}),         // ข้อมูลที่เจ้าของแอพรวบรวมด้วย Gemini (scripts/import-gemini.mjs) — ใช้เสริมเมื่อไม่มีข้อมูลจากแหล่งอื่น
      getJSON("data/removed.json", {}),         // เนื้อหาที่เจ้าของขอให้ลบ (ลิงก์โพสต์ / ผู้โพสต์) → ไม่แสดงในแอพ
      getJSON("data/outfits.json", {})          // แนวการแต่งตัว + สินค้าลิงก์พันธมิตร (Shopee) ต่อแนว
    ]);
    // เจ้าของโพสต์ขอลบ: ตัดตามลิงก์โพสต์ หรือทุกโพสต์ของผู้โพสต์ (@ชื่อ)
    const rmLinks = new Set([].concat(removed?.links || [])), rmAuthors = new Set([].concat(removed?.authors || []).map(a => String(a).replace(/^@/, "").toLowerCase()));
    state.outfits = outfits || {};
    state.postOk = x => !rmLinks.has(x?.link) && !rmAuthors.has((String(x?.link || "").split("lemon8-app.com/@")[1] || "").split("/")[0].toLowerCase());
    state.reviews = reviews && typeof reviews === "object" ? reviews : {};
    state.reviewFull ??= {};
    state.ai = aiInfo && typeof aiInfo === "object" ? aiInfo : {};
    const bizList = Array.isArray(biz) ? biz : [], replaced = new Set(bizList.map(b => b.replaces).filter(Boolean));
    const base = [...(places.places || []).filter(p => !replaced.has(p.id)), ...bizList];
    const ids = new Set(base.map(p => p.id.replace(/^(osm|l8)-/, "")));
    // กันสถานที่ id ซ้ำ (แสดงสองการ์ดเหมือนกัน) — เก็บอันแรก
    const seenIds = new Set();
    state.places = [...base, ...(Array.isArray(trendPl) ? trendPl : []).filter(p => !ids.has(p.id.replace(/^(osm|l8)-/, "")))].filter(p => !seenIds.has(p.id) && seenIds.add(p.id));
    // ค่าจาก OpenStreetMap ที่มีหลายค่าคั่นด้วย ";" (เว็บไซต์ 2 ลิงก์, เบอร์ 2 เบอร์, ที่อยู่) → ใช้ค่าแรก / คั่นด้วย ", "
    // แก้หมวดที่ผิดรายที่ (ตรวจด้วยคนแล้ว) · "hide" = ไม่ใช่ที่เที่ยว (เช่น โรงแรม)
    const KIND_FIX = {
      "l8-42203861114024016": "cafe", "l8-42203860775297072": "cafe", "l8-22535797337218975": "cafe", "l8-42203861076315530": "cafe",
      "l8-22535865223462982": "cafe", "l8-22535797309026983": "cafe", "l8-34955879830612195": "cafe",
      "l8-22535865208351531": "zoo", "osm-n4764269638": "zoo", "wd-Q6583260": "zoo", "osm-w429602627": "zoo", "osm-w962532652": "zoo", "osm-n9094881748": "zoo", "osm-n13909525592": "hide", "wd-Q2132910": "landmark", "osm-w91562454": "hide"
    };
    for (const p of state.places) {
      if (typeof p.website === "string" && p.website.includes(";")) p.website = p.website.split(";")[0].trim();
      if (typeof p.phone === "string" && p.phone.includes(";")) p.phone = p.phone.split(";")[0].trim();
      if (typeof p.address === "string") p.address = p.address.replace(/\s*;\s*/g, ", ").trim();
      // แยกหมวดย่อยให้เข้าใจง่าย: ทะเล (ออกจาก น้ำตก/วิว) · วัด (ออกจาก แลนด์มาร์ก)
      const nm = `${p.name?.th || ""} ${p.name?.en || ""}`;
      if (KIND_FIX[p.id]) p.kind = KIND_FIX[p.id];
      // ชื่อบอกชัดว่าอยู่ผิดหมวด (OpenStreetMap ติดแท็กกว้าง เช่น ร้านกาแฟติดแท็ก bar)
      else if ((p.kind === "nightlife" || p.kind === "restaurant") && /café|cafe|coffee|คาเฟ่|กาแฟ|คอฟฟี่|kafe/i.test(nm) && !/\bbar\b|บาร์|pub|ผับ|beer|เบียร์|restaurant|ร้านอาหาร|dining|kitchen|ครัว|eatery/i.test(nm)) p.kind = "cafe";
      else if ((p.kind === "nightlife" || p.kind === "cafe") && /restaurant|ร้านอาหาร|ramen|ราเมง|ก๋วยเตี๋ยว|noodle|ラーメン/i.test(nm) && !/\bbar\b|บาร์|pub|ผับ/i.test(nm)) p.kind = "restaurant";
      else if (p.kind === "landmark" && /^\s*(ถ้ำ|ถ้ํา|เขา|ดอย|น้ำตก)/.test(nm)) p.kind = "nature";
      if (p.kind === "nature" && /หาด|ชายหาด|beach|เกาะ|island|อ่าว|\bbay\b|ทะเล(?!หมอก|สาบ|บัว)/i.test(nm) && !/เกาะเกร็ด|เกาะรัตนโกสินทร์|เกาะเมือง/.test(nm)
        // น้ำตก/ถ้ำ/ดอย/จุดชมวิวที่ชื่อมีคำว่า "หาด" ("น้ำตกแม่หาด") ไม่ใช่ทะเล
        && !/^\s*(น้ำตก|ถ้ำ|ดอย|ภู|จุดชมวิว|อ่างเก็บน้ำ|เขื่อน)|waterfall|\bcave\b|view ?point|reservoir|\bdam\b/i.test(nm)) p.kind = "beach";
      else if (p.kind === "landmark" && /^\s*(วัด|wat\b)|temple|พระธาตุ|พระมหาธาตุ|เจดีย์|วัด\S|สำนักสงฆ์|วรวิหาร/i.test(nm)) p.kind = "temple";
      // ข้อมูลจาก Gemini เติมเฉพาะช่องที่ยังว่าง (OpenStreetMap/รีวิว Lemon8/เจ้าของร้าน มาก่อน)
      const ai = state.ai[p.id];
      // เวลาเปิด/ราคาจาก AI ความรู้ทั่วไป ไม่ใช้ (ยังไม่ผ่านการตรวจกับเว็บไซต์ทางการ/หลายแหล่ง)
      if (ai?.closed) p.maybeClosed = true;
    }
    state.trends = Object.fromEntries(Object.entries(places.trends || {}).map(([k, v]) => [k, (v || []).filter(state.postOk)]));
    // ข้อมูลล่อ (hidden) ใช้ตรวจว่าใครคัดลอกไฟล์ข้อมูลไปทั้งชุด — ไม่แสดงในแอพ
    state.places = state.places.filter(p => !p.hidden && !p.ck && p.kind !== "hide");
    for (const p of state.places) if (p.posts) p.posts = p.posts.filter(state.postOk);
    // งานที่ดึงอัตโนมัติ + งานที่ใส่เอง: งานใส่เองที่ id ตรงกันจะทับงานอัตโนมัติ, hidden: true = ซ่อน
    const manualIds = new Set(events.map(e => e.id));
    // ร้าน/สถานที่ที่เปิดประจำทุกวัน และงานออนไลน์ ไม่นับเป็นงานอีเว้นท์ (คาเฟ่/ที่เที่ยวอยู่หน้า "ที่เที่ยว")
    const isEvent = e => !e.hidden && !e.ongoing && e.venueId !== "online";
    state.events = [...events.filter(isEvent), ...(auto.events || []).filter(e => !manualIds.has(e.id) && isEvent(e))];
    // งานประเพณี/เทศกาล แยกออกจาก อาหาร/คอนเสิร์ต/งานแฟร์ (ข้อมูลเก่าที่ยังไม่ได้จัดหมวดใหม่)
    // จัดหมวดที่หลงให้ถูกจากชื่ออีเว้นท์ (js/categorize.js — กฎเดียวกับตอนดึงข้อมูล) · null = ไม่แสดง
    state.events = state.events.filter(e => { const c = window.IYA_fixCategory ? window.IYA_fixCategory(e) : e.category; if (c === null) return false; e.category = c; return true; });
    state.venues = Object.fromEntries(venues.map(v => [v.id, v]));
    state.ads = ads.filter(a => a.active !== false);
    state.news = news;
  }

  // ---------- ads ----------
  let adsenseLoaded = false;
  function adSlot(placement) {
    const A = C.ads;
    // AdSense ห้ามใช้ในแอพ (ต้องใช้ AdMob) → ในแอพแสดงโฆษณาตรงจาก data/ads.json แทน
    if (!NATIVE && A.adsenseClient && A.slots[placement]) {
      if (!adsenseLoaded) {
        const s = document.createElement("script");
        s.async = true; s.crossOrigin = "anonymous";
        s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${A.adsenseClient}`;
        document.head.appendChild(s);
        adsenseLoaded = true;
      }
      return `<div class="ad adsense"><ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="${esc(A.adsenseClient)}" data-ad-slot="${esc(A.slots[placement])}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
    }
    const pool = state.ads.filter(a => !a.placements || a.placements.includes(placement));
    if (pool.length) {
      const a = pool[Math.floor(Math.random() * pool.length)];
      const title = tr(a, "title");
      return `<a class="ad" href="${safeUrl(a.url)}" target="_blank" rel="sponsored noopener">${a.image ? `<img src="${safeUrl(a.image)}" alt="${esc(title)}">` : `<strong>${esc(title)}</strong>`}</a>`;
    }
    return `<a class="ad" href="#/about">${t("adEmpty")}</a>`;
  }
  function activateAdsense() {
    if (!adsenseLoaded) return;
    document.querySelectorAll("ins.adsbygoogle:not([data-adsbygoogle-status])").forEach(() => {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
    });
  }

  // ---------- filtering ----------
  function matchesWhen(ev, when) {
    if (when === "all") return true;
    const now = today(), s = parseDate(ev.startDate), e = endOf(ev);
    let from = now, to = now;
    if (when === "weekend") {
      const dow = now.getDay(); // 0 = อาทิตย์
      from = new Date(+now + ((6 - dow + 7) % 7) * DAY);
      if (dow === 0) from = now;
      to = dow === 0 ? now : new Date(+from + DAY);
    } else if (when === "week") to = new Date(+now + 6 * DAY);
    else if (when === "month") to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    if (!(s <= to && e >= from)) return false;
    // กิจกรรมประจำที่มีเฉพาะบางวัน (weekdays: 0 = อาทิตย์ ... 6 = เสาร์) ต้องมีวันนั้นในช่วงที่เลือก
    if (ev.weekdays?.length) {
      for (let d = new Date(Math.max(+from, +s)), n = 0; d <= to && n < 31; d = new Date(+d + DAY), n++)
        if (ev.weekdays.includes(d.getDay())) return true;
      return false;
    }
    return true;
  }
  // ค้นหา: ไม่สนตัวพิมพ์/วรรณยุกต์ละติน ("pokemon" เจอ "Pokémon") — ตัดเฉพาะเครื่องหมายละติน (U+0300–036F) ไม่แตะสระ/วรรณยุกต์ไทย
  const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // คำที่คนไทยพิมพ์ทับศัพท์ → ชื่อภาษาอังกฤษในชื่องาน
  const Q_ALIAS = { "โปเกมอน": "pokemon", "โปเกม่อน": "pokemon", "วันพีซ": "one piece", "วันพีช": "one piece", "กันดั้ม": "gundam", "นารูโตะ": "naruto", "เคป๊อป": "k-pop", "เคป็อป": "k-pop", "คอส": "cos", "มาราธอน": "marathon", "ญี่ปุ่น": "japan" };
  const qAlts = q => { const f = fold(q), alts = [f]; for (const [th, en] of Object.entries(Q_ALIAS)) if (f.includes(th)) alts.push(f.replace(th, en)); return alts; };
  function filtered() {
    const f = state.filters, q = f.q.trim().toLowerCase();
    let list = state.events.filter(ev => {
      if (!f.showEnded && status(ev).key === "ended") return false;
      if (!inProvince(ev)) return false;
      if (f.cat !== "all" && ev.category !== f.cat) return false;
      if (f.price === "free" && !isFree(ev)) return false;
      if (f.price === "paid" && isFree(ev)) return false;
      if (!matchesWhen(ev, f.when)) return false;
      if (q) {
        const v = venueOf(ev);
        // ค้นได้ทั้งภาษาไทยต้นฉบับและคำแปลทุกภาษา
        const tx = Object.values(ev.i18n || {}).flatMap(x => [x.title, x.summary]);
        const vx = Object.values(v?.i18n || {}).map(x => x.name);
        const prov = PROV[provinceOf(ev)] || {};
        const cat = (C.categories || []).find(c => c.id === ev.category)?.name || {};
        const hay = fold([ev.title, ev.summary, v?.name, prov.th, prov.en, prov.zh, cat.th, cat.en, cat.zh, ...tx, ...vx, ...(ev.tags || [])].join(" "));
        if (!qAlts(q).some(a => hay.includes(a))) return false;
      }
      return true;
    });
    const byStart = (a, b) => a.startDate.localeCompare(b.startDate);
    if (f.sort === "ending") list.sort((a, b) => endOf(a) - endOf(b));
    else if (f.sort === "near" && state.pos) {
      const d = ev => { const v = venueOf(ev); return v?.lat ? distanceKm(state.pos, v) : 1e9; };
      list.sort((a, b) => d(a) - d(b));
    } else list.sort(byStart);
    // ดันงานที่ featured ขึ้นก่อน (เฉพาะเรียงตามวัน)
    if (f.sort === "soon") list.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    return list;
  }

  // ---------- views ----------
  // งานกลางคืน/ผับบาร์ หรือที่ AI ระบุว่ามีแอลกอฮอล์ → แสดงป้าย 20+
  const isAdult = ev => !!(ev.age20 || CAT[ev.category]?.adult);
  function card(ev) {
    const st = status(ev), pr = priceLabel(ev.price), v = venueOf(ev), cat = CAT[ev.category];
    const saved = state.saved.has(ev.id);
    const time = tr(ev, "time"), races = tr(ev, "races"), reg = registration(ev);
    let place = venueName(v);
    if (state.filters.province === "all" && v?.province && !hasProv(place, v.province)) place += ` · ${provName(v.province)}`;
    if (state.pos && v?.lat) place += ` · ${distanceKm(state.pos, v).toFixed(1)} ${t("km")}`;
    return `
      <article class="card ${st.key === "ended" ? "ended" : ""}">
        <button class="save-btn" data-save="${esc(ev.id)}" aria-label="${saved ? t("unsaveAria") : t("saveAria")}">${saved ? "❤️" : "🤍"}</button>
        <a href="#/event/${encodeURIComponent(ev.id)}">
          ${cover(ev)}
            <div class="badges">
              ${ev.featured ? `<span class="badge hot">${t("featured")}</span>` : ""}
              ${reg?.soon ? `<span class="badge hot">${t("registerSoon")}</span>` : ""}
              ${cat ? `<span class="badge">${esc(catName(cat))}</span>` : ""}
              
              ${ev.sponsor ? `<span class="badge sponsor">🎁 ${t("sponsor")}</span>` : ""}
            </div>
          </div>
          <div class="card-body">
            <h3>${esc(evTitle(ev))}</h3>
            <div class="meta">📅 <span>${esc(dateRange(ev))}${time ? ` · ${esc(time)}` : ""}</span></div>
            <div class="meta">📍 <span>${esc(place)}</span></div>
            ${ev.people?.length ? `<div class="meta people-line">⭐ <span>${esc(ev.people.slice(0, 3).map(p => p.name).join(", "))}${ev.people.length > 3 ? ` +${ev.people.length - 3}` : ""}</span></div>` : ""}
            ${races?.length ? `<div class="meta">🏁 <span>${races.map(esc).join(" · ")}</span></div>` : ""}
            ${reg ? `<div class="meta reg ${reg.closed ? "closed" : reg.soon ? "soon" : ""}">📝 <span>${esc(reg.closed ? reg.text : `${reg.date} · ${reg.text}`)}</span></div>` : ""}
            <div class="card-foot">
              <span class="price ${pr.cls}">${pr.text}</span>
              <span class="status ${st.key}">${st.text}</span>
            </div>
          </div>
        </a>
      </article>`;
  }

  // counts = { จังหวัด: จำนวน } · ไม่ส่งมา = นับงานที่ยังไม่จบ
  function provinceSelect(counts) {
    const f = state.filters;
    if (!counts) {
      counts = {};
      state.events.forEach(ev => { const p = provinceOf(ev); if (p && status(ev).key !== "ended") counts[p] = (counts[p] || 0) + 1; });
    }
    const byName = (a, b) => provName(a.id).localeCompare(provName(b.id), locale());
    const withEvents = window.PROVINCES.filter(p => counts[p.id]).sort(byName);
    const others = window.PROVINCES.filter(p => !counts[p.id]).sort(byName);
    const o = (p, n) => `<option value="${p.id}" ${f.province === p.id ? "selected" : ""}>${esc(provName(p.id))}${n ? ` (${n})` : ""}</option>`;
    return `<select id="province" class="province-select" aria-label="${t("provinceLabel")}">
      <option value="all">📍 ${t("allProvinces")}</option>
      <optgroup label="${t("hasEvents")}">${withEvents.map(p => o(p, counts[p.id])).join("")}</optgroup>
      <optgroup label="${t("otherProvinces")}">${others.map(p => o(p)).join("")}</optgroup>
    </select>`;
  }

  // เลื่อนแถบหมวด (แนวนอน) ให้หมวดที่เลือกอยู่ตรงกลาง โดยไม่เลื่อนหน้า
  function centerActiveChip() {
    const bar = app.querySelector(".chips"), a = bar?.querySelector(".active");
    if (a) bar.scrollLeft = a.offsetLeft - bar.offsetLeft - (bar.clientWidth - a.clientWidth) / 2;
  }

  // คะแนน "งานใหญ่": สายบันเทิง + สถานที่จัดใหญ่ + คำว่ามหกรรม/เฟสติวัล + หลายวัน + เข้าฟรี + มีสปอนเซอร์
  const BIG_CAT = { concert: 3, motor: 3, food: 2, festival: 3, expo: 2, book: 2, sale: 2, outdoor: 1, nightlife: 0, learning: -3, seminar: -3, social: 0, exhibition: 1, cafe: -3 };
  const BIG_VENUE = /impact|thunder ?dome|arena|stadium|สนามกีฬา|ราชมังคลา|rajamangala|bitec|ไบเทค|qsncc|ศูนย์การประชุม|ศูนย์ประชุม|convention|exhibition|เมืองทอง|central ?world|เซ็นทรัลเวิลด์|paragon|พารากอน|iconsiam|ไอคอนสยาม|lumpini|ลุมพินี|เบญจกิติ|ท้องสนามหลวง|beach|ชายหาด/i;
  const BIG_WORD = /festival|fest\b|เฟส|เทศกาล|มหกรรม|expo|เอ็กซ์โป|fair|แฟร์|world tour|tour\b|in bangkok|countdown|เคาท์ดาวน์|ลอยกระทง|สงกรานต์|carnival|คาร์นิวัล|motor show|มอเตอร์|งานหนังสือ|book fair|concert|คอนเสิร์ต|marathon|มาราธอน|music|ดนตรี/i;
  function bigScore(ev) {
    const v = venueOf(ev), text = `${ev.title} ${evTitle(ev)}`;
    let s = BIG_CAT[ev.category] ?? 0;
    if (ev.venueId && ev.venueId !== "online" || BIG_VENUE.test(v?.name || "")) s += 3;
    if (BIG_WORD.test(text)) s += 2;
    if (ev.endDate && ev.endDate !== ev.startDate) s += 1;
    if (isFree(ev)) s += 1;
    if (ev.sponsor) s += 1;
    if (ev.age20 || CAT[ev.category]?.adult) s -= 1;
    // AI ให้คะแนนรูปปก: สวยน่ากด → ดันขึ้น, ตาราง/ตัวหนังสือล้วน → กดลง
    if (ev.imageScore) s += (ev.imageScore - 6) / 2;
    return s;
  }

  function recommendFor(upcoming, skip) {
    const w = {};
    (window.IYA_MEMBER?.interests?.() || []).filter(x => !x.startsWith("p:")).forEach(c => { w[c] = (w[c] || 0) + 3; });
    state.events.filter(e => state.saved.has(e.id)).forEach(e => { w[e.category] = (w[e.category] || 0) + 1; });
    if (!Object.keys(w).length) return [];
    const home = window.IYA_MEMBER?.homeProvince?.();
    return upcoming.filter(e => !skip.has(e.id) && !state.saved.has(e.id) && w[e.category] && (parseDate(e.startDate) - today()) / DAY <= 45)
      .map(e => [e, w[e.category] * 2 + bigScore(e) + (home && provinceOf(e) === home ? 3 : 0)])
      .sort((x, y) => y[1] - x[1]).slice(0, 8).map(([e]) => e);
  }

  function renderHome() {
    const f = state.filters;
    const opt = (val, label, cur) => `<option value="${val}" ${cur === val ? "selected" : ""}>${label}</option>`;
    const hasSample = state.events.some(e => e.sample);
    const upcoming = state.events.filter(e => status(e).key !== "ended" && inProvince(e));
    // ห้ามพลาด: งานที่ปักหมุดเอง + งานใหญ่สายบันเทิงที่คนส่วนใหญ่ไปได้ (คะแนนสูงสุด 10 งาน ภายใน 60 วัน)
    const pinned = upcoming.filter(e => e.featured);
    // งานซีรีส์เดียวกันที่จัดหลายรอบ (ชื่อต่างกันแค่วันที่) เอาแค่รอบที่ใกล้สุด
    const series = e => e.title.toLowerCase().replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\d+(st|nd|rd|th)?|[^a-z฀-๿]+/g, "").slice(0, 24);
    const seen = new Set();
    const big = upcoming.filter(e => !e.featured && e.image && !(e.imageScore <= 3) && (parseDate(e.startDate) - today()) / DAY <= 60)
      .map(e => [e, bigScore(e)]).filter(([, s]) => s >= 4)
      .sort((a, b) => b[1] - a[1] || a[0].startDate.localeCompare(b[0].startDate))
      .filter(([e]) => {
        // สถานที่เล็ก/ปาร์ตี้ที่จัดซ้ำทุกเดือน: 1 งานต่อสถานที่ · ฮอลล์ใหญ่จัดหลายงานต่างกันได้
        const vn = venueName(venueOf(e)) || "", keys = [series(e), BIG_VENUE.test(vn) || e.venueId ? "" : "v:" + vn.toLowerCase()].filter(Boolean);
        if (keys.some(k => seen.has(k))) return false;
        keys.forEach(k => seen.add(k));
        return true;
      })
      .slice(0, 10 - pinned.length).map(([e]) => e);
    const featured = [...pinned, ...big].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const forYou = recommendFor(upcoming, new Set(featured.map(e => e.id)));
    // ตัวกรองเพิ่มเติมที่ใช้อยู่ (แสดงจำนวนบนปุ่ม "ตัวกรอง")
    const homeExtra = ["when", "price"].filter(k => f[k] !== "all").length + (f.sort !== "soon" && f.sort !== "near" ? 1 : 0) + (f.showEnded ? 1 : 0);
    app.innerHTML = `
      <section class="hero">
        <div class="blob"></div>
        <div class="eyebrow">${t("eyebrow")}</div>
        <h1>${esc(pick(C.tagline))}<br><span>${t("heroSub")}</span></h1>
        <p>${t("heroDesc")}</p>
        <div class="searchbox"><input class="search" id="q" type="search" placeholder="${esc(t("searchPh"))}" value="${esc(f.q)}"></div>
      </section>
      <!-- หมวดหมู่ + ตัวกรอง อยู่ด้วยกัน และติดด้านบนจอตอนเลื่อนดูรายการ -->
      <div class="filter-bar ${state.moreFilters ? "open" : ""}" id="filterBar">
      <div class="filters">
        <select id="catSel" class="cat-select ${f.cat !== "all" ? "on" : ""}" aria-label="${t("categories")}">
          <option value="all">${esc(t("categories"))}: ${esc(t("catAll"))}</option>
          ${C.categories.filter(c => f.cat === c.id || state.events.some(e => e.category === c.id && status(e).key !== "ended")).map(c => `<option value="${c.id}" ${f.cat === c.id ? "selected" : ""}>${c.icon} ${esc(catName(c))}</option>`).join("")}
        </select>
        <button type="button" class="pill-btn ${f.sort === "near" ? "on" : ""}" id="homeNear" aria-pressed="${f.sort === "near"}">📍 ${t("nearMe")}</button>
        ${provinceSelect()}
        <button type="button" class="pill-btn more-btn ${homeExtra ? "on" : ""}" data-more aria-expanded="${!!state.moreFilters}">⚙️ ${t("moreFilters")}${homeExtra ? ` (${homeExtra})` : ""}</button>
        <select id="when" class="xf" aria-label="${t("whenAll")}">
          ${opt("all", t("whenAll"), f.when)}${opt("today", t("whenToday"), f.when)}${opt("weekend", t("whenWeekend"), f.when)}${opt("week", t("whenWeek"), f.when)}${opt("month", t("whenMonth"), f.when)}
        </select>
        <select id="price" class="xf" aria-label="${t("priceAll")}">
          ${opt("all", t("priceAll"), f.price)}${opt("free", t("priceFree"), f.price)}${opt("paid", t("pricePaid"), f.price)}
        </select>
        <select id="sort" class="xf" aria-label="${t("sortSoon")}">
          ${opt("soon", t("sortSoon"), f.sort)}${opt("ending", t("sortEnding"), f.sort)}${opt("near", t("sortNear"), f.sort)}
        </select>
        <label class="toggle xf"><input type="checkbox" id="ended" ${f.showEnded ? "checked" : ""}> ${t("showEnded")}</label>
      </div>
      </div>
      ${hasSample ? `<p class="notice">${t("sampleNotice")}</p>` : ""}
      <div id="rails" ${f.q.trim() ? "hidden" : ""}>
      ${featured.length && f.cat === "all" ? `
        <div class="section-head"><h2>${t("mustSee")}</h2><small>${t("swipe")}</small></div>
        <div class="rail" id="rail">${featured.map(card).join("")}</div>` : ""}
      ${forYou.length && f.cat === "all" ? `
        <div class="section-head"><h2>✨ ${t("forYou")}</h2><small>${t("forYouWhy")}</small></div>
        <div class="rail" id="railYou">${forYou.map(card).join("")}</div>` : ""}
      </div>
      ${adSlot("home_top")}
      <div class="section-head" id="resultsHead"><h2>${f.cat !== "all" && CAT[f.cat] ? `${CAT[f.cat].icon} ${esc(catName(CAT[f.cat]))}` : t("allEvents")}${f.province !== "all" ? ` · ${esc(provName(f.province))}` : ""}</h2>${viewToggle()}</div>
      <div id="results"></div>`;
    centerActiveChip();
    bindView(renderResults);
    renderResults();
    const rail = document.getElementById("rail");
    if (rail) bindSave(rail, renderHome);
    const railYou = document.getElementById("railYou");
    if (railYou) bindSave(railYou, renderHome);
    document.getElementById("province").addEventListener("change", e => {
      f.province = e.target.value;
      writeLS("province", f.province);
      const y = window.scrollY;
      renderHome();
      window.scrollTo(0, y);
    });

    const q = document.getElementById("q");
    // กำลังค้นหา → ซ่อน "ห้ามพลาด/แนะนำ" ให้ผลค้นหาขึ้นมาก่อน
    q.addEventListener("input", () => { f.q = q.value; document.getElementById("rails").hidden = !!f.q.trim(); renderResults(); });
    // กดหมวด → แสดงเฉพาะหมวดนั้น แล้วเลื่อนให้รายการงานเริ่มใต้แถบตัวกรองพอดี
    document.getElementById("catSel").addEventListener("change", e => {
      f.cat = e.target.value;
      const y = window.scrollY;
      renderHome();
      window.scrollTo(0, y);
      document.getElementById("resultsHead").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    ["when", "price"].forEach(id => document.getElementById(id).addEventListener("change", e => { f[id] = e.target.value; renderResults(); }));
    document.getElementById("ended").addEventListener("change", e => { f.showEnded = e.target.checked; renderResults(); });
    // ใกล้ฉัน: เรียงงานจากใกล้ไปไกล (ขอตำแหน่งตอนกด) · กดซ้ำ = กลับไปเรียงตามวันที่
    document.getElementById("homeNear").addEventListener("click", () => {
      if (f.sort === "near") { f.sort = "soon"; return renderHome(); }
      locate(() => { if (state.pos) f.sort = "near"; renderHome(); });
    });
    document.getElementById("sort").addEventListener("change", e => {
      f.sort = e.target.value;
      if (f.sort === "near" && !state.pos) locate(renderResults); else renderResults();
    });
    activateAdsense();
  }

  // มุมมองรายการ: "list" = แถวย่อ เห็นหลายงานต่อจอ · "grid" = การ์ดรูปใหญ่
  function viewToggle() {
    const b = (v, icon, label) => `<button type="button" class="view-btn ${state.view === v ? "active" : ""}" data-view="${v}" aria-pressed="${state.view === v}" title="${label}" aria-label="${label}">${icon}</button>`;
    return `<div class="view-toggle" role="group">${b("list", "☰", t("viewList"))}${b("grid", "▦", t("viewGrid"))}</div>`;
  }
  function bindView(rerender) {
    app.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      writeLS("view", state.view);
      app.querySelectorAll("[data-view]").forEach(x => { x.classList.toggle("active", x.dataset.view === state.view); x.setAttribute("aria-pressed", x.dataset.view === state.view); });
      rerender();
    }));
  }

  function renderResults() {
    const list = filtered(), every = C.ads.inlineEvery || 6;
    const el = document.getElementById("results");
    if (!el) return;
    if (!list.length) {
      // ไม่พบ → ปุ่มล้างตัวกรอง (คำค้น หมวด ช่วงเวลา ราคา) ไม่ต้องไล่แก้ทีละช่อง
      const fl = state.filters, any = fl.q || fl.cat !== "all" || fl.when !== "all" || fl.price !== "all";
      el.innerHTML = `<p class="empty">${t("noResults")}</p>${any ? `<div class="actions" style="justify-content:center"><button type="button" class="btn primary" id="clearHome">✕ ${t("clearFilters")}</button></div>` : ""}`;
      document.getElementById("clearHome")?.addEventListener("click", () => { Object.assign(fl, { q: "", cat: "all", when: "all", price: "all" }); renderHome(); });
      return;
    }
    // แสดงทีละ 24 งาน (เดิมวาดทุกงานพร้อมกัน หน้ายาว 50,000px ทำให้มือถือหน่วง) · เปลี่ยนตัวกรอง = เริ่มใหม่
    const fkey = JSON.stringify(state.filters);
    if (state.evKey !== fkey) { state.evKey = fkey; state.evShow = 24; }
    const shown = list.slice(0, state.evShow);
    const parts = [];
    shown.forEach((ev, i) => {
      parts.push(card(ev));
      if ((i + 1) % every === 0 && i < shown.length - 1) parts.push(adSlot("list_inline"));
    });
    el.innerHTML = `<p class="result-count">${t("found", { n: list.length })}</p><div class="grid ${state.view}">${parts.join("")}</div>
      ${list.length > shown.length ? `<div class="actions" style="justify-content:center"><button class="btn primary" id="evMore">${t("showMoreEvents", { n: list.length - shown.length })}</button></div>` : ""}`;
    document.getElementById("evMore")?.addEventListener("click", () => { const y = window.scrollY; state.evShow += 24; renderResults(); window.scrollTo(0, y); });
    bindSave(el, () => { const y = window.scrollY; renderResults(); window.scrollTo(0, y); });
    activateAdsense();
  }

  function bindSave(root, rerender) {
    root.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", e => {
      e.preventDefault();
      const id = b.dataset.save;
      state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
      writeLS("saved", [...state.saved]);
      window.IYA_MEMBER?.sync?.();
      rerender();
    }));
  }

  // quiet = ไม่ขึ้น alert (หน้าที่เที่ยวจะแสดงตัวเลือก "เลือกจุดเอง" แทน)
  function locate(done, quiet) {
    if (!navigator.geolocation) { state.geoFail = true; if (!quiet) alert(t("geoUnsupported")); done(); return; }
    navigator.geolocation.getCurrentPosition(
      p => { state.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; state.geoFail = false; done(); },
      () => { state.geoFail = true; if (!quiet) alert(t("geoFailed")); done(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  // ---------- travel ----------
  // พิกัดโดยประมาณ (สถานที่จากเทรนด์ที่ไม่มีในแผนที่ OSM) → ให้ Google Maps ค้นจากชื่อ + ที่อยู่แทน จะได้หมุดตรงร้าน
  const mapsDest = v => v.lat && !v.approx ? `${v.lat},${v.lng}` : `${v.name} ${v.address || ""}`;
  // mode = driving | transit | walking | bicycling, หรือ null = เปิดหมุดสถานที่
  const mapsWeb = (v, mode) => mode
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsDest(v))}&travelmode=${mode}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsDest(v))}`;
  // ลิงก์ที่เปิดแอพ Google Maps โดยตรง ถ้าไม่มีแอพจะเปิดเว็บ Google Maps แทน
  function mapsLink(v, mode) {
    const web = mapsWeb(v, mode);
    // ในแอพ: ลิงก์เว็บ Google Maps ธรรมดา → ระบบเปิดแอพ Google Maps ให้เอง (ดูตัวดักคลิกด้านล่าง)
    if (NATIVE) return `href="${esc(web)}" data-native-maps`;
    if (PLATFORM === "android") {
      const intent = `intent://${web.replace(/^https:\/\//, "")}#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(web)};end`;
      return `href="${esc(intent)}"`;
    }
    if (PLATFORM === "ios") {
      const app = mode
        ? `comgooglemaps://?daddr=${encodeURIComponent(mapsDest(v))}&directionsmode=${mode}`
        : `comgooglemaps://?q=${encodeURIComponent(mapsDest(v))}`;
      return `href="${esc(app)}" data-maps-web="${esc(web)}"`;
    }
    return `href="${esc(web)}" target="_blank" rel="noopener"`;
  }
  // iPhone: ถ้าไม่มีแอพ Google Maps หน้ายังอยู่ที่เดิม → เปิดเว็บ Google Maps แทน
  document.addEventListener("click", e => {
    const a = e.target.closest("a[data-maps-web]");
    if (!a) return;
    const web = a.dataset.mapsWeb;
    let left = false;
    const onHide = () => { left = true; };
    document.addEventListener("visibilitychange", onHide, { once: true });
    setTimeout(() => { document.removeEventListener("visibilitychange", onHide); if (!left && !document.hidden) location.href = web; }, 1500);
  });
  // แอพมือถือ: ปุ่มย้อนกลับของเครื่อง (Android) → กลับหน้าก่อนหน้าในแอพ (เดิมเด้งออกจากแอพทันที ต้องกดปุ่ม "← กลับ" บนหน้าจออย่างเดียว)
  // ย้อนได้ → ย้อน · ไม่มีประวัติแต่อยู่หน้าอื่น → กลับหน้าแรก · อยู่หน้าแรกแล้ว → ออกจากแอพ
  if (NATIVE) window.Capacitor?.Plugins?.App?.addListener?.("backButton", ({ canGoBack }) => {
    const home = !location.hash || location.hash === "#/" || location.hash === "#";
    if (canGoBack) history.back();
    else if (!home) location.replace("#/");
    else window.Capacitor.Plugins.App.exitApp();
  });
  // แอพมือถือ: แผนที่ → เปิดแอพ Google Maps · ลิงก์ร้านค้า/Affiliate (Shopee, Lazada ฯลฯ) → เปิดแอพร้านค้านั้น (data-ext-app)
  // ลิงก์เว็บอื่น → เบราว์เซอร์ในแอพ (กดปิดแล้วกลับมาที่แอพ)
  if (NATIVE) document.addEventListener("click", e => {
    const a = e.target.closest("a[href^='http']");
    if (!a || a.download) return;
    e.preventDefault();
    const { Browser, AppLauncher, StoreLink } = window.Capacitor?.Plugins || {};
    // ลิงก์ร้านค้า/Affiliate → แอพร้านค้าโดยตรง (ปลั๊กอินในแอพ StoreLink) · เปิดไม่ได้ → เบราว์เซอร์ในแอพ
    if (a.hasAttribute("data-ext-app") && StoreLink) StoreLink.open({ url: a.href }).then(r => { if (r?.opened === "none") Browser?.open({ url: a.href }); }).catch(() => Browser?.open({ url: a.href }));
    else if ((a.hasAttribute("data-native-maps") || a.hasAttribute("data-ext-app")) && AppLauncher) AppLauncher.openUrl({ url: a.href }).catch(() => Browser?.open({ url: a.href }));
    else if (Browser) Browser.open({ url: a.href, presentationStyle: "popover" });
    else location.href = a.href;
  });
  // ข้อความเดินทาง: คำแปลเก็บเป็น array ตามลำดับเดียวกับ transit ต้นฉบับ
  const transitText = (owner, key, i, tip) => owner?.i18n?.[state.lang]?.[key]?.[i] ?? tip.text;
  function recommendation(v) {
    if (!state.pos || !v.lat) return "";
    const km = distanceKm(state.pos, v), k = km.toFixed(1);
    const railIdx = (v.transit || []).findIndex(x => /BTS|MRT|ARL|SRT/i.test(x.type));
    let text;
    if (km < 1.2) text = t("recWalk", { km: k, min: Math.round(km * 13) });
    else if (km < 4) text = t("recTaxi", { km: k });
    else if (railIdx >= 0 && km < 40) text = t("recRail", { km: k, rail: transitText(v, "transit", railIdx, v.transit[railIdx]) });
    else if (km > 400) text = t("recFar", { km: Math.round(km) });
    else text = `${t("recCar", { km: k })} ${v.parking ? t("recParking") : ""}`;
    return `<p class="recommend">💡 ${esc(text)}</p>`;
  }
  const TRANSIT_ICON = { BIKE: "🛵", BTS: "🚈", MRT: "🚇", ARL: "🚄", SRT: "🚆", BUS: "🚌", BOAT: "⛴️", WALK: "🚶", TAXI: "🚕", SHUTTLE: "🚐", AIR: "✈️", CAR: "🚗", PARK: "🅿️", TIP: "💡", SONGTHAEW: "🛻", RENT: "🔑", WIN: "🏍️", APPBIKE: "📱" };

  // ---------- เส้นทางแนะนำจากจุดเดินทางจริงรอบสถานที่ (data/transit.json จาก OpenStreetMap) ----------
  const BKK_CENTER = { lat: 13.7563, lng: 100.5018 };
  const fmtKm = d => d < 1 ? `${Math.round(d * 1000 / 10) * 10} ${t("meter")}` : `${d.toFixed(1)} ${t("km")}`;
  const fmtDuration = min => min < 60 ? t("minutes", { n: Math.max(1, Math.round(min)) }) : t("hourMin", { h: Math.floor(min / 60), m: Math.round(min % 60) });
  const tName = x => (state.lang === "th" ? x.n.th : x.n.en) || x.n.th || x.n.en;
  let transitLoad;
  function nearest(list, v, maxKm, n = 1) {
    const seen = new Set();
    return (list || []).map(x => [x, distanceKm(v, x)]).filter(([, d]) => d <= maxKm).sort((a, b) => a[1] - b[1])
      .filter(([x]) => { const k = x.t + tName(x); return !seen.has(k) && seen.add(k); }).slice(0, n);
  }
  // ระยะทางเดินเท้า ~75 ม./นาที · เกิน 1.2 กม. แนะนำต่อวิน/แท็กซี่ (~3 นาที/กม. ในเมือง)
  const lastMile = d => d <= 1.2 ? `🚶 ${t("walkMin", { n: Math.max(1, Math.round(d * 13.3)) })}` : `🛵 ${t("rideMin", { n: Math.max(3, Math.round(d * 3 + 2)) })}`;
  function guideItems(v, tr_) {
    const items = [];
    const rails = nearest(tr_.rail, v, 2.5, 2);
    const sep = state.lang === "th" ? "" : " "; // ไทย: "สถานีสยาม" / อังกฤษ: "BTS Siam"
    rails.forEach(([x, d]) => items.push([x.t, `${t("line_" + x.t)}${sep}${tName(x)} · ${fmtKm(d)} · ${lastMile(d)}`]));
    // ชื่อท่าเรือส่วนใหญ่ขึ้นต้นด้วย "ท่า" อยู่แล้ว
    const pierName = x => state.lang === "th" && !/^ท่า/.test(tName(x)) ? "ท่า" + tName(x) : tName(x);
    nearest(tr_.pier, v, 1.2).forEach(([x, d]) => items.push(["BOAT", `${t("pierNear", { name: pierName(x) })} · ${fmtKm(d)} · ${lastMile(d)}`]));
    if (!rails.length) {
      nearest(tr_.train, v, 40).forEach(([x, d]) => items.push(["SRT", `${t("trainNear", { name: tName(x) })} · ${fmtKm(d)}${d > 1.2 ? ` · ${t("thenLocal")}` : ""}`]));
      nearest(tr_.bus, v, 40).forEach(([x, d]) => items.push(["BUS", `${t("busNear", { name: tName(x) })} · ${fmtKm(d)}${d > 1.2 ? ` · ${t("thenLocal")}` : ""}`]));
    }
    // ไกลจากกรุงเทพฯ: แนะนำสนามบินใกล้สุด + ระยะขับรถ (ถนนจริงยาวกว่าเส้นตรง ~25%, เฉลี่ย 75 กม./ชม.)
    const fromBkk = distanceKm(BKK_CENTER, v);
    if (fromBkk > 40) {
      const road = fromBkk * 1.25;
      items.push(["CAR", t("fromBkk", { km: Math.round(road / 5) * 5, time: fmtDuration(road / 75 * 60 + 15) })]);
    }
    if (fromBkk > 250) nearest(tr_.air, v, 150).forEach(([x, d]) => items.push(["AIR", t("flyTo", { name: tName(x), iata: x.iata, km: Math.round(d) })]));
    return items;
  }
  // เติม "เส้นทางแนะนำ" หลังหน้าแสดงแล้ว (โหลดข้อมูลจุดเดินทางเฉพาะตอนเปิดหน้ารายละเอียด)
  // ---------- เรือข้ามฟากไปเกาะ (data/ferries.json: ท่าเรือ เวลา ราคาต่อคน รวบรวมจากประกาศ/ข่าว/เว็บจองตั๋ว) ----------
  let ferryLoad;
  const ferryData = () => (ferryLoad ||= getJSON("data/ferries.json", null));
  // สถานที่อยู่บนเกาะไหน (ในรัศมีของเกาะ)
  const islandAt = (fd, v) => (v?.lat ? (fd?.islands || []).find(i => distanceKm(i, v) <= i.r) : null) || null;
  const FERRY_ICON = { slow: "⛴️", ferry: "⛴️", car: "🚢", speed: "🚤", longtail: "🛶", tour: "🏝️" };
  const pickL = o => (o?.[state.lang] ?? o?.en ?? o?.th ?? "");
  // ท่าเรือที่ใกล้ต้นทางที่สุด (ตำแหน่งผู้ใช้ หรือกรุงเทพฯ)
  const nearestPier = (isl, from) => [...isl.routes].sort((a, b) => distanceKm(from, a) - distanceKm(from, b))[0];
  function ferryHtml(isl, fd) {
    const date = fd.checked ? new Date(fd.checked).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : "";
    return `<h3 class="subhead">🚢 ${esc(t("ferryTitle", { island: pickL(isl.name) }))}</h3>
      <ul class="travel-list ferry-list">${isl.routes.map(r => `<li><span>${FERRY_ICON[r.type] || "⛴️"}</span><span>
        <b>${esc(pickL(r.from))}</b><br>
        ${esc(t("ferryType_" + r.type))} · ~${esc(fmtDuration(r.min))} · <b>${r.approx ? "≈ " : ""}${range(r.price[0], r.price[1])}</b> ${esc(t("ferryPer"))}${r.car ? ` · 🚗 ${esc(t("ferryCar", { cost: range(r.car[0], r.car[1]) }))}` : ""}
        ${r.freq ? `<br><small>🕒 ${esc(pickL(r.freq))}</small>` : ""}</span></li>`).join("")}
        ${isl.extra ? `<li><span>💡</span><span>${esc(pickL(isl.extra))}</span></li>` : ""}
      </ul>
      <p class="disclosure">${esc(t("ferryNote", { date }))}</p>`;
  }
  async function hydrateFerry() {
    const box = document.getElementById("ferry");
    if (!box) return;
    const fd = await ferryData();
    if (!document.body.contains(box)) return;
    const isl = islandAt(fd, { lat: +box.dataset.lat, lng: +box.dataset.lng });
    box.innerHTML = isl ? ferryHtml(isl, fd) : "";
  }
  async function hydrateGuides() {
    renderCost();
    hydrateFerry();
    const box = document.getElementById("guide");
    if (!box) return;
    transitLoad ||= getJSON("data/transit.json", {});
    const tr_ = await transitLoad;
    if (!document.body.contains(box)) return;
    const v = { lat: +box.dataset.lat, lng: +box.dataset.lng };
    const items = guideItems(v, tr_);
    box.innerHTML = items.length
      ? items.map(([type, text]) => `<li><span>${TRANSIT_ICON[type] || "➡️"}</span><span>${esc(text)}</span></li>`).join("")
      : `<li><span>ℹ️</span><span>${t("noGuide")}</span></li>`;
  }
  // ---------- คำนวณค่าเดินทาง (ประมาณการ) จากตำแหน่งผู้ใช้ หรือกลางกรุงเทพฯ ----------
  // ตั้งค่ารถของตัวเองได้ (กม./ลิตร, ราคาน้ำมัน) จำไว้ในเครื่อง · สมาชิกจะซิงก์ข้ามเครื่อง
  const CAR_DEFAULT = { kmpl: 14, fuelType: "g95", fuel: 0, bikeKmpl: 40 };
  // ค่าที่บันทึกจากเวอร์ชันเก่า (ไม่มี fuelType) มีราคาน้ำมันตายตัว → ไม่ใช้ ให้ใช้ราคาจริงรายวันแทน
  const carCfg = () => { const c = { ...readLS("car", {}) }; if (!c.fuelType) delete c.fuel; return { ...CAR_DEFAULT, ...c }; };
  // ราคาน้ำมันจริงรายวัน (บางจาก · data/fuel.json อัปเดตทุกเช้า) → ไม่มีข้อมูลใช้ค่าสำรอง
  const FUEL_FALLBACK = { g95: 39.8, g91: 39.5, e20: 31.8, e85: 30.6, diesel: 41.8, b20: 33.5 };
  const FUEL_TYPES = ["g95", "g91", "e20", "e85", "diesel", "b20"];
  let fuelLoad;
  const fuelData = () => (fuelLoad ||= getJSON("data/fuel.json", null));
  function fuelPrice(fd, k) {
    if (k.fuel > 0) return { price: k.fuel, custom: true };
    return { price: fd?.prices?.[k.fuelType] || FUEL_FALLBACK[k.fuelType] || FUEL_FALLBACK.g95, date: fd?.date };
  }
  // มิเตอร์แท็กซี่ (ประกาศกรมการขนส่งทางบก มีผล 13 ม.ค. 2566): กม.แรก 35 บาท
  // กม.1–10 6.5 · 10–20 7 · 20–40 8 · 40–60 8.5 · 60–80 9 · 80+ 10.5 บาท/กม. · รถติด (ช้ากว่า 6 กม./ชม.) นาทีละ 3 บาท
  function taxiMeter(km) {
    const steps = [[10, 6.5], [20, 7], [40, 8], [60, 8.5], [80, 9], [Infinity, 10.5]];
    let fare = 35, left = Math.max(0, km - 1), from = 1;
    for (const [to, rate] of steps) { const seg = Math.min(left, to - from); if (seg <= 0) break; fare += seg * rate; left -= seg; from = to; }
    return fare;
  }
  // ค่ารถไฟฟ้าโดยประมาณตามระยะทาง (อัตราปี 2569): BTS 17–47 (+ส่วนต่อขยาย) · MRT สายสีน้ำเงิน 17–44
  // Airport Rail Link 15–45 · รถไฟชานเมืองสายสีแดง 12–42 — ค่าจริงขึ้นกับจำนวนสถานี จึงแสดงเป็นช่วง
  const RAIL_FARE = { BTS: [17, 3.2, 65], MRT: [17, 2.6, 44], ARL: [15, 1.4, 45], SRT: [12, 1.6, 42] };
  const railFare = (type, km) => { const [base, perKm, max] = RAIL_FARE[type] || RAIL_FARE.MRT; return Math.min(max, base + perKm * km); };
  // มอเตอร์ไซค์รับจ้าง (กฎกระทรวง 2559 · Grab Bike ใช้อัตราเดียวกัน): 2 กม.แรก 25 บาท · กม.2–5 ละ 5 บาท · กม.5–15 ละ 10 บาท · เกิน 15 กม. ตกลงราคา (คิด 10 บาท/กม.)
  const bikeFare = km => 25 + 5 * Math.min(Math.max(km - 2, 0), 3) + 10 * Math.max(km - 5, 0);
  // GrabCar/JustGrab กทม.และปริมณฑล (grab.com): 2 กม.แรก 45 บาท · กม.2–6 ละ 8 · กม.6–40 ละ 7 · เกิน 40 กม. ละ 10 บาท
  const grabCar = km => 45 + 8 * Math.min(Math.max(km - 2, 0), 4) + 7 * Math.min(Math.max(km - 6, 0), 34) + 10 * Math.max(km - 40, 0);
  const baht = n => `${Math.round(n / 5) * 5 < 10 ? Math.round(n) : (Math.round(n / 5) * 5).toLocaleString(locale())}`;
  const range = (a, b) => baht(a) === baht(b) ? `฿${baht(a)}` : `฿${baht(a)}–${baht(b)}`;
  // ระยะทางตามถนนจริง (OSRM บนข้อมูล OpenStreetMap · เซิร์ฟเวอร์สาธารณะของ FOSSGIS ฟรี)
  // ปัดพิกัดผู้ใช้เหลือ 3 ตำแหน่ง (~100 ม.) ก่อนส่ง · ถามครั้งเดียวต่อปลายทาง (จำไว้ในหน่วยความจำ)
  const routeCache = new Map();
  function roadRoute(from, to) {
    const o = `${(+from.lng).toFixed(3)},${(+from.lat).toFixed(3)}`, d = `${(+to.lng).toFixed(5)},${(+to.lat).toFixed(5)}`;
    const key = o + ";" + d;
    if (!routeCache.has(key)) routeCache.set(key, fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${key}?overview=false`, { signal: AbortSignal.timeout(9000) })
      .then(r => r.ok ? r.json() : null)
      .then(j => j?.code === "Ok" && j.routes?.[0] ? { km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60 } : null)
      .catch(() => null));
    return routeCache.get(key);
  }
  const inMetro = p => distanceKm(BKK_CENTER, p) <= 35;
  function costItems(v, trip, route, fd, tr_) {
    const from = state.pos || BKK_CENTER, line = distanceKm(from, v);
    // ไม่มีเส้นทางจริง: ประมาณถนนยาวกว่าเส้นตรง 25–35% · เวลาขับโล่งๆ ~35 กม./ชม. ในเมือง 70 กม./ชม. นอกเมือง
    const road = route?.km ?? line * (line < 30 ? 1.35 : 1.25);
    const freeMin = route?.min ?? road / (road < 30 ? 35 : 70) * 60;
    const k = carCfg(), x = trip === "round" ? 2 : 1, fp = fuelPrice(fd, k);
    const out = [];
    // ใกล้มาก: เดินได้ฟรี · ระยะสั้นในเมือง: วินมอเตอร์ไซค์ (อัตรากรมการขนส่งทางบก: 2 กม.แรกไม่เกิน 25 บาท, กม.ที่ 2–5 ไม่เกิน กม.ละ 5 บาท)
    if (road <= 1.5) out.push(["WALK", t("costWalk", { min: Math.max(1, Math.round(road * 13)) })]);
    // วินมอเตอร์ไซค์ (ป้ายวิน) ระยะสั้น · มอเตอร์ไซค์ผ่านแอพ (Grab Bike, LINE MAN Bike, Bolt Bike) ถึง ~30 กม.
    if (road <= 5 && (inMetro(v) || road <= 2)) { const w = bikeFare(road); out.push(["WIN", t("costWin", { cost: range(Math.max(15, w * 0.8) * x, w * x) })]); }
    const fuel = road / k.kmpl * fp.price * x;
    if (road >= 1) out.push(["CAR", t("costCar2", { km: Math.round(road * x), cost: range(fuel, fuel * 1.1), kmpl: k.kmpl, fuel: t("fuel_" + k.fuelType), price: fp.price.toFixed(2) })]);
    if (road >= 1 && road <= 300) { const b = road / k.bikeKmpl * fp.price * x; out.push(["BIKE", t("costBike", { cost: range(b, b * 1.1) })]); }
    if (road <= 80) {
      // รถติด: เวลาเดินทางจริงในกรุงเทพฯ ~1.3–2 เท่าของเวลาวิ่งโล่ง ส่วนที่ช้ากว่า 6 กม./ชม. คิดนาทีละ 3 บาท
      const m = taxiMeter(road), lo = (m + freeMin * 0.25 * 3) * x, hi = (m + freeMin * 0.9 * 3) * x;
      // แอพเรียกรถยนต์: อัตรา GrabCar กทม. (ช่วงคนเรียกเยอะราคาขึ้นได้ ~1.6 เท่า)
      const g = grabCar(road) * x;
      out.push(["TAXI", t("costTaxi2", { cost: range(lo, hi), app: range(g, Math.max(g * 1.6, hi * 1.2)) })]);
    }
    if (road <= 30) { const w = bikeFare(road); out.push(["APPBIKE", t("costAppBike", { cost: range(w * x, w * 1.5 * x) })]); }
    // รถไฟฟ้า: มีสถานีใกล้ทั้งต้นทางและปลายทาง (กทม. และปริมณฑล)
    if (tr_?.rail && inMetro(from) && inMetro(v) && line > 1.5) {
      const near = (p, max) => (tr_.rail.map(s => [s, distanceKm(p, s)]).filter(([, d]) => d <= max).sort((a, b) => a[1] - b[1])[0]);
      const a1 = near(from, 2), b1 = near(v, 2.5);
      if (a1 && b1 && tName(a1[0]) !== tName(b1[0])) {
        const km = distanceKm(a1[0], b1[0]) * 1.2;
        const fare = a1[0].t === b1[0].t ? railFare(a1[0].t, km) : railFare(a1[0].t, km / 2) + railFare(b1[0].t, km / 2);
        const sep = state.lang === "th" ? "" : " ";
        out.push([a1[0].t, t("costRail", { from: `${t("line_" + a1[0].t)}${sep}${tName(a1[0])}`, to: `${t("line_" + b1[0].t)}${sep}${tName(b1[0])}`, cost: range(fare * 0.85 * x, fare * 1.1 * x) })]);
      } else out.push(["BUS", t("costCityBus", { cost: range(8 * x, 25 * x) })]);
    }
    // รถไฟทางไกล (การรถไฟฯ): สถานีใกล้ต้นทางและปลายทางไม่เกิน 15 กม. ระยะระหว่างสถานี 30 กม.ขึ้นไป
    // ค่าโดยสารต่อ กม. เทียบจากราคาปี 2569 กรุงเทพ–เชียงใหม่ 751 กม.: ชั้น 3 นั่ง 205–271 · ชั้น 2 579–1,105 · ชั้น 1 นอน 1,453–1,794 บาท
    if (tr_?.train && line >= 30) {
      // ในกรุงเทพฯ/ปริมณฑล รถไฟทางไกลขึ้น-ลงที่สถานีกลางกรุงเทพอภิวัฒน์ (สถานีใกล้สุดอาจเป็นสถานีขนส่งสินค้าหรือที่หยุดรถเล็ก)
      const HUB = { n: { th: "กลางกรุงเทพอภิวัฒน์", en: "Krung Thep Aphiwat Central", zh: "曼谷中央车站" }, t: "SRT", lat: 13.8037, lng: 100.5408 };
      const near = p => inMetro(p) ? [HUB, distanceKm(p, HUB)] : tr_.train.map(s => [s, distanceKm(p, s)]).filter(([, d]) => d <= 15).sort((a, b) => a[1] - b[1])[0];
      const a1 = near(from), b1 = near(v);
      if (a1 && b1 && tName(a1[0]) !== tName(b1[0])) {
        // คนละสายที่แยกจากกรุงเทพฯ (เช่น เหนือ ↔ ใต้) ต้องต่อรถที่กรุงเทพฯ → ระยะทางอ้อมผ่านกรุงเทพฯ
        const A = a1[0], B = b1[0], dA = distanceKm(BKK_CENTER, A), dB = distanceKm(BKK_CENTER, B), dAB = distanceKm(A, B);
        const viaBkk = dA > 80 && dB > 80 && dAB > Math.max(dA, dB);
        const km = (viaBkk ? dA + dB : dAB) * 1.25;
        if (km >= 30) {
          const cls = [[t("train3"), 0.27, 0.36, 8]];
          if (km >= 50) cls.push([t("train2"), 0.77, 1.47, 60]);
          if (km >= 300) cls.push([t("train1"), 1.93, 2.39, 400]);
          const fares = cls.map(([n, lo, hi, min]) => `${n} ${range(Math.max(min, km * lo) * x, Math.max(min * 1.3, km * hi) * x)}`).join(" · ");
          out.push(["SRT", t("costTrain", { from: tName(A), to: tName(B), km: Math.round(km), fares }) + (viaBkk ? " " + t("trainViaBkk") : "")]);
        }
      }
    }
    if (road > 80) out.push(["BUS", t("costCoach", { cost: range(road * 0.7 * x, road * 1.3 * x) })]);
    if (road > 400) out.push(["AIR", t("costFly")]);
    return { out, road, freeMin, fp };
  }
  async function renderCost() {
    const box = document.getElementById("cost");
    if (!box) return;
    const v = { lat: +box.dataset.lat, lng: +box.dataset.lng }, trip = box.dataset.trip || "one";
    const real = state.pos && !state.pos.manual;
    if (!box.innerHTML && state.pos) box.innerHTML = `<p class="cost-from">⏳ ${t("costRouting")}</p>`;
    transitLoad ||= getJSON("data/transit.json", {});
    // ปลายทางอยู่บนเกาะ (ไม่มีสะพาน) → คิดค่าเดินทางถึงท่าเรือที่ใกล้ต้นทางที่สุด แล้วบวกค่าเรือ
    const isl = islandAt(await ferryData(), v);
    const pier = isl && nearestPier(isl, state.pos || BKK_CENTER);
    const dest = pier ? { lat: pier.lat, lng: pier.lng } : v;
    const [route, fd, tr_] = await Promise.all([state.pos ? roadRoute(state.pos, dest) : null, fuelData(), transitLoad]);
    if (!document.body.contains(box)) return;
    const { out, road, freeMin, fp } = costItems(dest, trip, route, fd, tr_);
    if (pier) {
      const x = trip === "round" ? 2 : 1;
      const same = isl.routes.filter(r => distanceKm(r, pier) < 3);
      out.push(...same.map(r => ["BOAT", t("costFerry", { type: t("ferryType_" + r.type), min: fmtDuration(r.min), cost: range(r.price[0] * x, r.price[1] * x) }) + (r.car ? " · " + t("ferryCar", { cost: range(r.car[0] * x, r.car[1] * x) }) : "")]));
    }
    const k = carCfg();
    const fromText = !state.pos ? t("costFromBkk") : real ? t("costFromMe") : t("costFromArea", { area: state.pos.label || "" });
    box.innerHTML = `
      <p class="cost-from">${esc(fromText)}</p>
      ${pier ? `<p class="cost-route">⚓ ${esc(t("costToPier", { pier: pickL(pier.from), island: pickL(isl.name) }))}</p>` : ""}
      ${route ? `<p class="cost-route">🛣️ ${t("costRoute", { km: road.toFixed(1), time: fmtDuration(freeMin), busy: fmtDuration(freeMin * (road < 40 ? 2 : 1.3) + 5) })}</p>` : state.pos ? `<p class="cost-route">📏 ${t("costRouteEst", { km: Math.round(road) })}</p>` : ""}
      <div class="seg" role="group">
        <button type="button" class="${trip === "one" ? "active" : ""}" data-trip="one">${t("oneWay")}</button>
        <button type="button" class="${trip === "round" ? "active" : ""}" data-trip="round">${t("roundTrip")}</button>
      </div>
      <ul class="travel-list">${out.map(([type, text]) => `<li><span>${TRANSIT_ICON[type] || "➡️"}</span><span>${esc(text)}</span></li>`).join("")}</ul>
      <details class="car-cfg"><summary>⚙️ ${t("carSettings")}</summary>
        <label>${t("fuelType")} <select id="fueltype">${FUEL_TYPES.map(f => `<option value="${f}" ${k.fuelType === f ? "selected" : ""}>${t("fuel_" + f)}</option>`).join("")}</select></label>
        <label>${t("kmpl")} <input type="number" inputmode="decimal" min="3" max="60" step="0.5" id="kmpl" value="${k.kmpl}"></label>
        <label>${t("fuelPrice")} <input type="number" inputmode="decimal" min="0" max="80" step="0.01" id="fuelp" value="${k.fuel || ""}" placeholder="${fp.custom ? "" : fp.price.toFixed(2)}"></label>
      </details>
      <p class="disclosure">${[fp.date && !fp.custom ? t("costFuelSrc", { date: new Date(fp.date).toLocaleDateString(locale(), { day: "numeric", month: "short" }) }) : "", route ? t("costRouteSrc") : "", t("costNote2")].filter(Boolean).join(" · ")}</p>`;
    box.querySelectorAll("[data-trip]").forEach(b => b.addEventListener("click", () => { box.dataset.trip = b.dataset.trip; renderCost(); }));
    const save = () => {
      writeLS("car", { ...readLS("car", {}), fuelType: document.getElementById("fueltype").value, kmpl: +document.getElementById("kmpl").value || CAR_DEFAULT.kmpl, fuel: +document.getElementById("fuelp").value || 0 });
      window.IYA_MEMBER?.sync?.();
      renderCost().then(() => { const c = box.querySelector(".car-cfg"); if (c) c.open = true; });
    };
    box.querySelectorAll(".car-cfg input, .car-cfg select").forEach(i => i.addEventListener("change", save));
  }

  // ที่พักใกล้งาน (Trip.com): ค้นรอบพิกัดสถานที่จัดงาน เช็คอินวันงาน 1 คืน · ต่อรหัส Affiliate จาก config.js
  // (รูปแบบลิงก์เดียวกับที่ Trip.com สร้างเมื่อค้นจากสถานที่สำคัญ: searchType=LM + พิกัดใน searchValue)
  function hotelLink(ev, v) {
    const day = d => new Date(Date.now() + 7 * 3600e3 + d * 864e5).toISOString().slice(0, 10);
    const checkin = ev.startDate < day(0) ? day(0) : ev.startDate;
    const out = new Date(checkin + "T00:00:00Z"); out.setUTCDate(out.getUTCDate() + 1);
    const name = String(v.i18n?.[state.lang]?.name || v.name || "").slice(0, 80);
    const u = new URL(state.lang === "th" ? "https://th.trip.com/hotels/list" : "https://www.trip.com/hotels/list");
    // cityId ต้องมี (ไม่มีบางครั้งได้ 0 ผลลัพธ์) · ค่ากรุงเทพ (359) ใช้ได้ทั่วไทย เพราะค้นตามพิกัดใน searchValue (ทดสอบแล้วกับเชียงใหม่)
    const p = { cityId: 359, searchType: "LM", searchWord: name, destName: name, optionId: 0, searchValue: `13|0*13*${v.lat}|${v.lng}|${name}|0|1`,
      checkin, checkout: out.toISOString().slice(0, 10), crn: 1, adult: 2, curr: "THB", ...(state.lang === "en" ? { locale: "en-US" } : {}) };
    const aff = C.tripAffiliate || {};
    if (aff.allianceId && aff.sid) Object.assign(p, { Allianceid: aff.allianceId, SID: aff.sid, trip_sub1: String(ev.id || "event").slice(0, 40), trip_sub3: aff.sub3 || "" }); // sub1 = รหัสงาน (ดูในรายงาน Trip.com ว่าจองจากงานไหน)
    Object.entries(p).forEach(([k, x]) => u.searchParams.set(k, x));
    return u.href;
  }
  // ที่พักใกล้ที่เที่ยว (Trip.com): เช็คอินคืนวันเสาร์ที่จะถึง (วันนี้เป็นเสาร์ = วันนี้) 1 คืน · trip_sub1 = รหัสสถานที่
  function placeHotelBlock(p) {
    if (!p.lat || !p.lng) return "";
    const now = new Date(Date.now() + 7 * 3600e3), sat = new Date(now); sat.setUTCDate(now.getUTCDate() + ((6 - now.getUTCDay() + 7) % 7));
    const name = placeName(p);
    // อุทยาน/ธรรมชาติ: พิกัดมักอยู่กลางป่า (Trip.com ค้นในรัศมีแคบ → 0 ที่พัก) → ใช้พิกัดร้านอาหาร/คาเฟ่ที่ใกล้ที่สุด (ภายใน 40 กม.) ซึ่งเป็นย่านที่มีที่พัก
    let at = { lat: p.lat, lng: p.lng };
    if (["park", "nature"].includes(p.kind)) {
      let best = null, bd = 40;
      for (const q of state.places) if ((q.kind === "cafe" || q.kind === "restaurant") && q.lat && Math.abs(q.lat - p.lat) < 0.4 && Math.abs(q.lng - p.lng) < 0.4) { const d = distanceKm(p, q); if (d < bd) { bd = d; best = q; } }
      if (best) at = { lat: best.lat, lng: best.lng };
    }
    // ปุ่มเต็มแถวใต้ปุ่มนำทาง/แผนที่ (อยู่ใน .pd-actions)
    return `<a class="btn pd-hotel" href="${esc(hotelLink({ startDate: sat.toISOString().slice(0, 10), id: p.id }, { name, ...at }))}" target="_blank" rel="sponsored nofollow noopener" data-ext-app title="${esc(t("hotelsNearDesc", { place: name }))}">🏨 ${t("hotelsNearBtn")}</a>`;
  }
  // จุดกึ่งกลางของสถานที่ในจังหวัด (ใช้เมื่อสถานที่จัดงานไม่มีพิกัด)
  const provCenters = {};
  const provCenter = id => provCenters[id] ??= (() => {
    const ps = state.places.filter(p => p.lat && p.province === id);
    return ps.length ? { lat: +(ps.reduce((s, p) => s + +p.lat, 0) / ps.length).toFixed(5), lng: +(ps.reduce((s, p) => s + +p.lng, 0) / ps.length).toFixed(5) } : null;
  })();
  function hotelPanel(ev, v) {
    if (!v || v.online) return "";
    // มีพิกัดสถานที่จัดงาน = ที่พักรอบงาน · ไม่มี = ที่พักในจังหวัด (จุดกึ่งกลาง)
    const prov = provinceOf(ev), c = v.lat && v.lng ? null : prov && provCenter(prov);
    if (!(v.lat && v.lng) && !c) return "";
    const loc = c ? { ...v, ...c, name: provName(prov), i18n: undefined } : v;
    return `
      <section class="panel hotels">
        <h2>${t("hotelsTitle")}</h2>
        <p class="muted" style="margin:0 0 10px">${c ? t("hotelsDescProv", { prov: esc(provName(prov)) }) : t("hotelsDesc", { venue: esc(v.name || "") })}</p>
        <a class="btn primary block" href="${esc(hotelLink(ev, loc))}" target="_blank" rel="sponsored nofollow noopener" data-ext-app>🏨 ${t("hotelsBtn")}</a>
        ${C.tripAffiliate?.allianceId ? `<p class="disclosure">${esc(pick(C.affiliateDisclosure))}</p>` : ""}
      </section>`;
  }
  function travelPanel(ev, v) {
    if (!v || v.online) return `<section class="panel"><h2>${t("onlineTitle")}</h2><p>${t("onlineDesc")}</p></section>`;
    const tips = [
      ...(v.transit || []).map((x, i) => ({ type: x.type, text: transitText(v, "transit", i, x) })),
      ...(ev.travelTips || []).map((x, i) => ({ type: x.type, text: transitText(ev, "travelTips", i, x) }))
    ];
    const label = type => dict().transitType?.[type] || type;
    return `
      <section class="panel" id="travel">
        <h2>${t("travel")}</h2>
        <div id="rec">${recommendation(v) || `<button class="btn block" id="locBtn">${t("useLocation")}</button>`}</div>
        <div class="travel-modes">
          <a class="btn" ${mapsLink(v, "driving")}>${t("drive")}</a>
          <a class="btn" ${mapsLink(v, "transit")}>${t("transit")}</a>
          <a class="btn" ${mapsLink(v, "walking")}>${t("walk")}</a>
          <a class="btn" ${mapsLink(v, "bicycling")}>${t("bike")}</a>
        </div>
        ${v.lat ? `<div id="ferry" data-lat="${v.lat}" data-lng="${v.lng}"></div>
        <h3 class="subhead">🧭 ${t("bestWay")}</h3>
        <ul class="travel-list" id="guide" data-lat="${v.lat}" data-lng="${v.lng}"><li><span>⏳</span><span>${t("loading")}</span></li></ul>
        <details class="cost-box"><summary class="subhead">💰 ${t("travelCost")}</summary>
        <div id="cost" data-lat="${v.lat}" data-lng="${v.lng}"></div></details>` : ""}
        ${tips.length ? `<h3 class="subhead">${t("noCar")}</h3>
        <ul class="travel-list">
          ${tips.map(x => `<li><span>${TRANSIT_ICON[x.type] || "➡️"}</span><span><b>${esc(label(x.type))}</b> ${esc(x.text)}</span></li>`).join("")}
        </ul>` : v.lat ? "" : `<h3 class="subhead">${t("noCar")}</h3><ul class="travel-list"><li><span>ℹ️</span><span>${t("noTransit")}</span></li></ul>`}
        <h3 class="subhead">${t("byCar")}</h3>
        <ul class="travel-list">
          <li><span>🅿️</span><span>${esc(tr(v, "parking") || t("noParking"))}${v.lat ? ` <a class="maps-link" href="${esc(`https://www.google.com/maps/search/parking/@${v.lat},${v.lng},16z`)}" ${NATIVE ? "data-native-maps" : `target="_blank" rel="noopener"`}>${t("findParking")}</a>` : ""}</span></li>
        </ul>
      </section>`;
  }

  // ---------- calendar ----------
  function gcalLink(ev, v) {
    const s = parseDate(ev.startDate), e = new Date(+parseDate(ev.endDate || ev.startDate) + DAY);
    const p = new URLSearchParams({ action: "TEMPLATE", text: evTitle(ev), dates: `${ymd(s)}/${ymd(e)}`, location: venueName(v), details: `${tr(ev, "summary") || ""}\n${publicUrl()}` });
    return `https://calendar.google.com/calendar/render?${p}`;
  }
  function downloadIcs(ev, v) {
    const s = parseDate(ev.startDate), e = new Date(+parseDate(ev.endDate || ev.startDate) + DAY);
    const clean = x => String(x || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IYouAlone//TH", "BEGIN:VEVENT",
      `UID:${ev.id}@iyoualone`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      `DTSTART;VALUE=DATE:${ymd(s)}`, `DTEND;VALUE=DATE:${ymd(e)}`,
      `SUMMARY:${clean(evTitle(ev))}`, `LOCATION:${clean(venueName(v))}`, `DESCRIPTION:${clean(tr(ev, "summary"))}`,
      "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = `${ev.id}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function renderDetail(id) {
    const ev = state.events.find(e => e.id === id);
    if (!ev) { app.innerHTML = `<a class="back" href="#/">${t("back")}</a><p class="empty">${t("notFound")}</p>`; return; }
    const v = venueOf(ev), st = status(ev), pr = priceLabel(ev.price), cat = CAT[ev.category];
    const saved = state.saved.has(ev.id);
    const title = evTitle(ev), details = tr(ev, "details") || tr(ev, "summary"), highlights = tr(ev, "highlights");
    const priceNote = ev.i18n?.[state.lang]?.priceNote ?? ev.price?.note;
    // แท็กเป็นคำค้นภาษาไทย: ภาษาอื่นแสดงเฉพาะเมื่อมีแท็กที่แปลไว้
    const tags = state.lang === "th" ? ev.tags : ev.i18n?.[state.lang]?.tags;
    const races = tr(ev, "races"), reg = registration(ev);
    const original = !["title", "details", "highlights"].every(k => isTranslated(ev, k));
    document.title = `${title} — ${C.siteName}`;
    const paragraphs = String(details || "").split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("");
    const address = [tr(v, "address"), v?.province && !hasProv(tr(v, "address"), v.province) ? provName(v.province) : ""].filter(Boolean).join(" · ");
    app.innerHTML = `
      <a class="back" href="#/">${t("backList")}</a>
      <div class="detail">
        ${cover(ev, "cover detail-cover")}</div>
        <h1>${esc(title)}</h1>
        <div class="tags">
          ${cat ? `<span class="tag">${cat.icon} ${esc(catName(cat))}</span>` : ""}
          <span class="price ${pr.cls}">${pr.text}</span>
          <span class="status ${st.key}">${st.text}</span>
          
          ${ev.sponsor ? `<span class="tag sponsor">🎁 ${esc(t("sponsorBy", { name: ev.sponsor }))}</span>` : ""}
          ${ev.aiChecked ? `<span class="tag ai">🤖 ${t("aiChecked")}</span>` : ""}
        </div>
        ${isAdult(ev) ? `<p class="adult-note">${t("age20Note")}</p>` : ""}
        <div class="actions">
          ${ev.ticketUrl ? `<a class="btn primary" ${inAppLink(withAffiliate(ev.ticketUrl))}>${ev.sourceName ? t("buyAt", { site: esc(/facebook\.com|fb\.me/i.test(ev.ticketUrl) ? "Facebook" : ev.sourceName) }) : isFree(ev) ? t("register") : t("buyTicket")}</a>` : ""}
          <button class="btn" id="saveBtn">${saved ? t("saved") : t("save")}</button>
          ${ev.ongoing ? "" : `<a class="btn" href="${gcalLink(ev, v)}" target="_blank" rel="noopener">${t("gcal")}</a>
          <button class="btn" id="icsBtn">${t("ics")}</button>`}
          <button class="btn" id="shareBtn">${t("share")}</button>
        </div>
        <div class="detail-layout" style="margin-top:18px">
          <div>
            <section class="panel">
              <h2>${t("keyInfo")}</h2>
              <dl class="facts">
                <div><dt>${ev.ongoing ? "🕒" : "📅"}</dt><dd>${esc(dateRange(ev))}<small>${esc(tr(ev, "time") || "")}</small></dd></div>
                <div><dt>📍</dt><dd>${esc(venueName(v))}<small>${esc(address)}</small>${v && !v.online ? `<a class="maps-link" ${mapsLink(v, null)}>${t("openMaps")}</a>` : ""}</dd></div>
                ${races?.length ? `<div><dt>🏁</dt><dd>${t("races")}<div class="tags" style="margin-top:4px">${races.map(r => `<span class="tag race">${esc(r)}</span>`).join("")}</div></dd></div>` : ""}
                ${reg ? `<div><dt>📝</dt><dd class="reg ${reg.closed ? "closed" : reg.soon ? "soon" : ""}">${esc(reg.closed ? reg.text : reg.date)}<small>${reg.closed ? "" : esc(reg.text)}</small></dd></div>` : ""}
                <div><dt>💰</dt><dd>${pr.text}<small>${esc(priceNote || "")}</small></dd></div>
                ${ev.organizer ? `<div><dt>🏢</dt><dd>${t("organizer")}: ${esc(tr(ev, "organizer"))}</dd></div>` : ""}
              </dl>
            </section>
            ${ev.people?.length ? `<section class="panel people">
              <h2>⭐ ${t("whoComing")}</h2>
              <ul class="people-list">${ev.people.map(p => `<li><b>${esc(p.name)}</b>${pick(p.role) ? `<small>${esc(pick(p.role))}</small>` : ""}</li>`).join("")}</ul>
            </section>` : ""}
            <section class="panel prose">
              <h2>${t("details")}</h2>
              ${original ? `<p class="disclosure" style="margin:0 0 10px">${t("originalThai")}</p>` : ""}
              ${paragraphs ? `<p class="disclosure" style="margin:0 0 8px">${ev.aiDetails ? t("detailsAI") : t("detailsSrc")}</p>` : ""}
              ${paragraphs}
              ${highlights?.length ? `<h3 style="font-size:.95rem">${t("highlights")}</h3><ul>${highlights.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
              ${tags?.length ? `<div class="tags">${tags.map(x => `<span class="tag">#${esc(x)}</span>`).join("")}</div>` : ""}
              ${ev.sourceUrl ? `<p class="disclosure">${t("source")}: <a ${inAppLink(ev.sourceUrl)}>${esc(ev.sourceName || t("viewSource"))}</a> · ${t("sourceNote")}</p>` : ""}
            </section>
            ${ev.affiliateLinks?.length ? `
            <section class="panel affiliate">
              <h2>${t("deals")}</h2>
              <div class="aff-links">
                ${ev.affiliateLinks.map((a, i) => `<a class="btn" href="${safeUrl(a.url)}" target="_blank" rel="sponsored nofollow noopener" data-ext-app><span>${esc(ev.i18n?.[state.lang]?.affiliateLabels?.[i] ?? a.label)}</span><span>${esc(a.platform || "")} →</span></a>`).join("")}
              </div>
              <p class="disclosure">${esc(pick(C.affiliateDisclosure))}</p>
            </section>` : ""}
          </div>
          <div>
            ${travelPanel(ev, v)}
            ${hotelPanel(ev, v)}
            <div style="margin-top:14px">${adSlot("detail")}</div>
          </div>
        </div>
      </div>`;

    document.getElementById("saveBtn").onclick = () => {
      state.saved.has(ev.id) ? state.saved.delete(ev.id) : state.saved.add(ev.id);
      writeLS("saved", [...state.saved]);
      renderDetail(id);
    };
    const ics = document.getElementById("icsBtn");
    if (ics) ics.onclick = () => downloadIcs(ev, v);
    document.getElementById("shareBtn").onclick = async () => {
      const data = { title, text: `${title} · ${dateRange(ev)}`, url: publicUrl() };
      const Share = window.Capacitor?.Plugins?.Share;
      if (NATIVE && Share) { try { await Share.share({ ...data, dialogTitle: title }); } catch {} }
      else if (navigator.share) { try { await navigator.share(data); } catch {} }
      else { try { await navigator.clipboard.writeText(data.url); alert(t("copied")); } catch {} }
    };
    const loc = document.getElementById("locBtn");
    if (loc) loc.onclick = () => locate(() => { document.getElementById("rec").innerHTML = recommendation(v) || ""; renderCost(); });
    activateAdsense();
  }

  function renderSaved() {
    const list = state.events.filter(e => state.saved.has(e.id)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const places = state.places.filter(p => state.saved.has(placeKey(p)));
    app.innerHTML = `<div class="page"><h1>${t("savedTitle")}</h1>
      ${list.length ? `<div class="grid">${list.map(card).join("")}</div>` : places.length ? "" : `<div class="empty-state"><div class="empty-ico">🤍</div><p>${t("savedEmpty")}</p><div class="actions" style="justify-content:center"><a class="btn primary" href="#/">🎉 ${t("navExplore")}</a><a class="btn" href="#/places">🗺️ ${t("navPlaces")}</a></div></div>`}
      ${places.length ? `<div class="section-head"><h2>🗺️ ${t("savedPlaces")}</h2></div><div class="place-list">${places.map(placeCard).join("")}</div>` : ""}</div>`;
    bindSave(app, renderSaved);
  }

  // ---------- ที่เที่ยว ----------
  const PCAT = Object.fromEntries((C.placeCategories || []).map(c => [c.id, c]));
  const placeKey = p => "place:" + p.id;
  // ชื่อจริงเป็นภาษาอังกฤษ (แบรนด์/ร้านชื่ออังกฤษ ตัดสินโดย scripts/name-origin.mjs) → ใช้ชื่ออังกฤษเป็นชื่อหลักทุกภาษา (จีนมีชื่อจีนทางการใช้ชื่อจีน)
  const placeName = p => p.nameEn && p.name?.en ? (state.lang === "zh" && p.name.zh || p.name.en) : p.name?.[state.lang] || p.name?.th || p.name?.en || "";
  // ชื่อรอง: ชื่อไทยเมื่อชื่อหลักเป็นอังกฤษ · ไม่งั้นชื่ออังกฤษ
  const placeSubName = p => { const n = placeName(p), alt = p.nameEn ? p.name?.th : p.name?.en; return alt && alt !== n ? alt : ""; };
  // คำอธิบาย: ภาษาที่เลือก → ไทย → อังกฤษ
  const placeSummary = p => p.summary?.[state.lang] || p.summary?.th || p.summary?.en || "";
  const placeVenue = p => ({ name: placeName(p), address: p.address, province: p.province, lat: p.lat, lng: p.lng, approx: p.approx });
  // การเดินทางของสถานที่: รูปแบบเดียวกับหน้าอีเว้นท์ ("ไม่ใช้รถ" + "ใช้รถ"/ที่จอด)
  // ใช้ข้อมูลจริงก่อน (คำแนะนำการเดินทางจาก AI, เคล็ดลับที่จอดรถจากรีวิว) แล้วเติมคำแนะนำทั่วไปตามประเภทและพื้นที่
  const METRO = new Set(["bangkok", "nonthaburi", "samutprakan", "pathumthani"]);
  const FAR_KINDS = new Set(["nature", "park", "beach", "zoo", "themepark"]);
  function placeTravelVenue(p) {
    const v = placeVenue(p), transit = [], metro = METRO.has(p.province);
    const aiTravel = state.ai[p.id]?.travel;
    if (aiTravel?.th) transit.push({ type: "TIP", text: pick(aiTravel) || aiTravel.th });
    if (metro) transit.push({ type: "TAXI", text: t("plTaxiCity") });
    else {
      transit.push({ type: "SONGTHAEW", text: t("plLocal") });
      if (FAR_KINDS.has(p.kind)) transit.push({ type: "RENT", text: t("plRent") });
    }
    if (p.kind === "nightlife") transit.push({ type: "TAXI", text: t("plNight") });
    // ที่จอดรถ: เคล็ดลับจากรีวิวจริง → ไม่มีใช้ค่าทั่วไปตามประเภท
    const tips = reviewOf(p)?.tips, i = (tips?.th || []).findIndex(s => /จอด|parking/i.test(s));
    const fromReview = i >= 0 ? (tips[state.lang]?.[i] || tips.en?.[i] || tips.th[i]) : "";
    const typical = FAR_KINDS.has(p.kind) || ["temple", "museum"].includes(p.kind) ? t("parkLot")
      : ["cafe", "animalcafe", "restaurant", "nightlife"].includes(p.kind) ? (metro ? t("parkShopCity") : t("parkShop")) : t("parkCity");
    v.transit = transit;
    v.parking = fromReview ? `${fromReview} (${t("fromReviews")})` : `${typical} (${t("typicalInfo")})`;
    return v;
  }
  // เวลาเปิดแบบ OpenStreetMap ("Mo-Su 09:00-18:00") → อ่านง่ายขึ้น
  const DAYS = { th: { Mo: "จ.", Tu: "อ.", We: "พ.", Th: "พฤ.", Fr: "ศ.", Sa: "ส.", Su: "อา.", PH: "วันหยุดนักขัตฤกษ์", off: "ปิด" },
    en: { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "public holidays", off: "closed" },
    zh: { Mo: "周一", Tu: "周二", We: "周三", Th: "周四", Fr: "周五", Sa: "周六", Su: "周日", PH: "公共假日", off: "休息" } };
  const fmtHours = h => {
    if (!h) return "";
    if (/^\s*(24\/7|Mo-Su 00:00-(24:00|23:59))\s*$/.test(h)) return t("open24");
    const d = DAYS[state.lang] || DAYS.th;
    return h.replace(/\b00:00-(24:00|23:59)\b/g, t("open24")).replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, m => d[m]).replace(/\boff\b/g, d.off).replace(/;\s*/g, " · ");
  };
  // ค่าเข้า: ฟรี / "40 บาท (ต่างชาติ 200)" / "เสียค่าเข้า" (รู้ว่าเสียแต่ไม่รู้ราคา) / "-" (ไม่มีข้อมูล)
  const fmtBaht = n => `${Number(n).toLocaleString(locale())} ${t("baht")}`;
  function feeText(p) {
    const e = p.entry;
    if (e?.free || p.fee === "no") return t("feeNo");
    if (e?.tiers?.length) {
      const ps = e.tiers.map(x => x.price), lo = Math.min(...ps), hi = Math.max(...ps);
      return lo === hi ? fmtBaht(lo) : `${Number(lo).toLocaleString(locale())}–${fmtBaht(hi)}`;
    }
    if (e?.min && e?.max) return `${Number(e.min).toLocaleString(locale())}–${fmtBaht(e.max)}`;
    if (e?.thai || e?.foreign) return [e.thai && fmtBaht(e.thai), e.foreign && e.foreign !== e.thai && `${t("foreigner")} ${fmtBaht(e.foreign)}`].filter(Boolean).join(" · ");
    if (p.fee === "yes") return t("feeYes");
    return "-";
  }
  const MENU_KINDS = new Set(["cafe", "animalcafe", "restaurant", "nightlife"]);
  // ค่าเข้าแต่ละประเภทบัตร (ผู้ใหญ่/เด็ก/คนไทย/ต่างชาติ/ออนไลน์/หน้างาน) · ราคาที่มาจากรีวิวบอกกำกับ
  const feeTiers = p => {
    const ts = p.entry?.tiers;
    if (!ts || ts.length < 2 && !ts[0]?.note) return "";
    return `<ul class="fee-tiers">${ts.map(x => `<li><span>${esc(pick(x.who))}${x.note ? `<small>${esc(pick(x.note))}</small>` : ""}</span><b>${fmtBaht(x.price)}</b>${x.rv ? `<small class="src-note src-review">${t("srcVerified")}</small>` : ""}</li>`).join("")}</ul>`;
  };
  // ที่มาของเวลาเปิด/ราคา (OSM ไม่ต้องบอก) — ข้อมูลประมาณ/AI บอกชัดให้ผู้ใช้เช็กก่อนไป
  const SRC_KEY = { review1: "srcReview1", Lemon8: "fromReviews", review: "srcVerified", owner: "fromOwner", web: "srcWeb", ai: "srcAI", typical: "srcTypical" };
  const approx = src => src === "typical" || src === "ai" || src === "review1" ? "≈ " : "";
  const srcNote = src => SRC_KEY[src] ? `<small class="src-note src-${src}">${t(SRC_KEY[src])}</small>` : "";
  const menuText = p => p.menuPrice ? (p.menuPrice.min === p.menuPrice.max ? `~${fmtBaht(p.menuPrice.min)}` : `${Number(p.menuPrice.min).toLocaleString(locale())}–${fmtBaht(p.menuPrice.max)}`) : "-";
  const inPlaceProvince = p => state.filters.province === "all" || p.province === state.filters.province;

  // รูปปก: รูปที่ AI คัดแล้ว → ไม่มี ใช้รูปปกโพสต์รีวิว Lemon8 ที่พูดถึงที่นี่ (ไลก์มากสุด มีลายน้ำ+เครดิตผู้โพสต์) → ไอคอนหมวด
  function coverOf(p) {
    if (/^https:\/\//.test(p.image || "") && (p.imageTh || imgOk(p.image))) return { src: p.image, th: p.imageTh, credit: p.imageCredit || (isL8img(p.image) ? "Lemon8" : "Wikimedia Commons"), post: isL8img(p.image) };
    // คัดรูปโพสต์: หัวข้อมีชื่อสถานที่ก่อน (รูปร้าน/บรรยากาศ) · ตัดโพสต์แต่งตัว/เซลฟี่ (รูปคน ไม่ใช่รูปสถานที่) → แล้วค่อยดูไลก์
    const keys = coverKeys(p);
    const score = x => { const tl = String(x.title || "").toLowerCase(); return (keys.some(k => tl.includes(k)) ? 2 : 0) + (PERSON_POST.test(tl) ? -3 : 0); };
    const post = placePosts(p).filter(x => x.th || imgOk(x.image)).sort((a, b) => (score(b) - score(a)) || ((b.likes || 0) - (a.likes || 0)))[0];
    return post ? { src: post.image, thumb: post.thumb, th: post.th, credit: post.source || "Lemon8", post: true } : null;
  }
  const PERSON_POST = /ootd|outfit|แต่งตัว|ลุค|look|เซลฟี่|selfie|แต่งหน้า|makeup|ทรงผม|hair|นางแบบ|โพสท่า|ถ่ายรูปคน|ชุดไป/i;
  const COVER_GENERIC = /^(คาเฟ่|cafe|café|coffee|ร้าน|the|bar|บาร์|restaurant|ร้านอาหาร|museum|พิพิธภัณฑ์|สวน|park|วัด|wat)$/i;
  // คำจากชื่อสถานที่ที่ใช้ตรวจหัวข้อโพสต์ ("Timo Cafe" → timo cafe, timo)
  function coverKeys(p) {
    const n = typeof p.name === "string" ? { th: p.name } : (p.name || {});
    const full = [n.th, n.en].filter(Boolean).map(s => s.toLowerCase().trim());
    const words = full.flatMap(s => s.split(/[\s\-–|·,()]+/)).filter(w => w.length >= 3 && !COVER_GENERIC.test(w));
    return [...new Set([...full, ...words])].filter(s => s.length >= 3);
  }
  function placeCover(p, cls = "cover") {
    const c = PCAT[p.kind] || { icon: "📍", color: "#888" };
    const cv = coverOf(p);
    const img = cv
      ? `${cv.post ? fitBg(cv.src, cv.thumb, cv.th) : ""}<img class="cover-img${cv.post ? " img-fit" : ""}" ${cv.post ? imgSrc(cv.src, cv.thumb, 800, 0, cv.th) : imgSrc(cv.src, cv.thumb, cls.includes("pd-cover") ? 800 : 480, cls.includes("pd-cover") ? 600 : 360)} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="${IMG_RETRY}var c=this.nextElementSibling;if(c&&c.classList.contains('credit'))c.remove();this.remove()"><span class="credit">📷 ${esc(cv.credit)}</span>`
      : "";
    return `<div class="${cls}" style="background:linear-gradient(135deg, ${c.color}, ${c.color2 || c.color})"><span class="emoji">${c.icon}</span>${img}`;
  }
  // สรุปรีวิว (AI จากโพสต์จริง) ของสถานที่ · ภาษาที่เลือก ไม่มีใช้ไทย
  const GOOD_ICON = { photo: "📸", work: "💻", kids: "👶", pets: "🐾", date: "💑", group: "👯", view: "🌄", nature: "🌿", chill: "☕", budget: "💸", night: "🌙", food: "😋" };
  // สรุปรีวิว: จากโพสต์ Lemon8 จริงก่อน · ไม่มี → ข้อมูลที่รวบรวมด้วย Gemini (แสดงป้าย "AI อาจคลาดเคลื่อน")
  // หน้าแรกโหลดแค่สรุปสั้น (place-reviews-lite.json) · รีวิวเต็มแบ่ง 32 ไฟล์ โหลดเมื่อเปิดหน้าสถานที่ (แบ่งด้วย placeShard เหมือน place-posts)
  const reviewShards = new Map();
  function loadFullReview(p) {
    const n = placeShard(p.id);
    if (!reviewShards.has(n)) reviewShards.set(n, getJSON(`data/place-reviews/${String(n).padStart(2, "0")}.json`, {}));
    return reviewShards.get(n).then(s => {
      const full = s?.[p.id];
      state.reviewFull[p.id] = full || null;
      return !!full;
    });
  }
  const reviewOf = p => {
    const r = state.reviewFull?.[p.id] || state.reviews?.[p.id];
    if (r && r.summary && !r.skip) return r;
    const a = state.ai?.[p.id];
    return a?.summary?.th || a?.highlights?.th?.length ? { ...a, ai: true } : null;
  };
  // ตัดเรื่องราคาออกจากข้อความสรุปรีวิว (ราคาแสดงแยกในช่องค่าเข้า/ราคาเมนูแล้ว)
  const PRICE_RE = /ราคา|แพง|ถูกมาก|ถูกดี|คุ้มค่า|คุ้มราคา|บาท|฿|ค่าใช้จ่าย|ค่าเข้า|ค่าบัตร|ค่าบริการ|เป็นมิตรกับกระเป๋า|\bprices?\b|\bpriced\b|pricey|pricier|expensive|cheap|affordabl|overpriced|value for money|good value|budget|\bcosts?\b|\bTHB\b|\bbaht\b|\bfees?\b|admission|价格|价位|昂贵|偏贵|较贵|很贵|便宜|实惠|性价比|泰铢|门票|费用/i;
  const NOUN_END = /(เครื่องดื่ม|อาหาร|ขนม|เมนู|กาแฟ|เค้ก|บุฟเฟ่ต์|ของกิน|ของ|สินค้า|ที่พัก|ห้อง|ตั๋ว|บัตร|ทุกอย่าง)$/;
  const TH_CONN = /\s*(และ|แต่|ส่วน|รวมถึง|พร้อม|โดย|ซึ่ง)$/;
  const EN_ADJ = /\s*,?\s*(?:and\s+|with\s+|at\s+)?(?:very\s+|quite\s+|reasonably\s+|fairly\s+|relatively\s+)?(?:affordable|cheap|reasonable|budget[- ]friendly|inexpensive|pricey|expensive|good[- ]value|low[- ]cost)\s+(?:prices?|drinks?|food|menus?|meals?|items?|desserts?|coffee|snacks?|dishes)\b/gi;
  const EN_FEE = /\s*,?\s*(?:and\s+|with\s+)?(?:free|no)\s+(?:admission|entry|entrance)(?:\s+(?:fees?|charges?))?\b|\s*,?\s*(?:and\s+|with\s+)?an?\s+(?:\d[\d,]*\s*(?:baht|THB)\s+)?(?:admission|entry|entrance)\s+(?:fees?|charges?)\b/gi;
  function noPriceTh(s) {
    const out = [];
    for (const x of s.split(/\s+/).filter(Boolean)) {
      const m = x.match(PRICE_RE);
      if (!m) { out.push(x); continue; }
      if (m.index >= 6) { const pre = x.slice(0, m.index).replace(TH_CONN, "").trim(); if (pre && !NOUN_END.test(pre)) out.push(pre); }
    }
    let r = out.join(" ");
    for (let i = 0; i < 3; i++) r = r.replace(/\s+(และ|แต่|ส่วน|รวมถึง|พร้อม|โดย)$/, "").trim();
    return r;
  }
  function noPriceOther(s) {
    s = s.replace(EN_ADJ, "").replace(EN_FEE, "");
    if (!PRICE_RE.test(s)) return s.replace(/\s+([,.])/g, "$1");
    const cjk = /[一-鿿]/.test(s);
    // ทีละประโยค → ทีละวลี (คั่นด้วยจุลภาค) ตัดวลีที่พูดถึงราคา
    const sents = s.match(/[^.!?。！？]+[.!?。！？]?/g) || [s];
    return sents.map(st => {
      if (!PRICE_RE.test(st)) return st;
      const end = (st.match(/[.!?。！？]\s*$/) || [""])[0].trim();
      const cl = st.replace(/[.!?。！？]\s*$/, "").split(cjk ? /[，、;；]/ : /,\s*|;\s*/);
      const keep = cl.filter(c => !PRICE_RE.test(c));
      if (!keep.length) return "";
      return (cjk ? keep.join("，") : keep.join(", ")).trim() + end;
    }).filter(Boolean).join(cjk ? "" : " ").trim();
  }
  function noPrice(s) {
    if (typeof s === "string") s = s.replace(/with (?:free|no) (?:admission|entry|entrance)(?: fees?)? and /gi, "with ");
    if (typeof s !== "string" || !s || !(PRICE_RE.test(s) || EN_ADJ.test(s))) return s;
    EN_ADJ.lastIndex = 0;
    return /[฀-๿]/.test(s) ? noPriceTh(s) : noPriceOther(s);
  }
  const rvList = v => { const l = v?.[state.lang]?.length ? v[state.lang] : v?.th || []; return l.filter(x => x && !PRICE_RE.test(x)); };
  // คำอธิบายของทุกสถานที่ (จากข้อมูลจริงเท่านั้น ไม่แต่งเอง):
  // AI สรุปรีวิว → คำอธิบายจาก Wikipedia/OSM → โพสต์ Lemon8 ที่พูดถึง → ประโยคพื้นฐานจากหมวด เขต และเวลาเปิด
  // อำเภอ/เขต: ภาษาไทย "อ.X"/"เขตX" · ภาษาอื่นใช้ชื่ออังกฤษ (ไม่มีก็ใช้ชื่อไทย)
  let distEnMap = null;
  // ชื่ออำเภอไทย → อังกฤษ (ใช้กับตัวเลือกอำเภอในตัวกรอง)
  const distEn = d => { if (state.lang === "th") return d; distEnMap ||= new Map(state.places.filter(p => p.districtEn).map(p => [p.district, p.districtEn])); return distEnMap.get(d) || d; };
  const distName = p => (state.lang !== "th" && p.districtEn) || p.district;
  const distLabel = p => p.district ? (state.lang === "th" ? `${p.province === "bangkok" ? t("districtBkk") : t("districtShort")}${p.district}` : distName(p)) : "";
  // ---------- แต่งตัวไปที่นี่: แนวการแต่งตัวตามหมวด/ชื่อสถานที่ + สินค้าลิงก์พันธมิตร (data/outfits.json) ----------
  function outfitStyle(p) {
    const nm = `${p.name?.th || ""} ${p.name?.en || ""}`;
    const k = p.kind;
    // เกาะกลางเมือง/แม่น้ำ ไม่ใช่ทะเล
    const cityIsland = /เกาะเกร็ด|เกาะรัตนโกสินทร์|เกาะเมือง|rattanakosin|koh kret/i.test(nm);
    if (/พระราชวัง|พระบรมมหาราชวัง|พระที่นั่ง|พระตำหนัก|\bpalace\b|ธรรมกาย|ศาลเจ้า|มัสยิด|\bshrine\b|\bmosque\b/i.test(nm) || k === "temple") return "modest";
    if (["nature", "park", "beach"].includes(k) && !cityIsland) {
      if (/หาด|ชายหาด|\bbeach\b|ดำน้ำ|\bdiv(e|ing)\b|snorkel/i.test(nm)) return "beach";
      if (/น้ำตก|waterfall|ถ้ำ|ถ้ํา|\bcave\b|เขื่อน|\bdam\b|แก่ง|rafting/i.test(nm)) return "hiking";
      if (/ดอย|ภู|ม่อน|ผา|เขา|จุดชมวิว|ทะเลหมอก|mountain|\bdoi\b|\bphu\b|view ?point/i.test(nm) && !/หมู่เกาะ|เกาะ|อ่าว|ทะเล(?!หมอก|สาบ|บัว)|marine/i.test(nm)) return "mountain";
      if (k === "beach" || /เกาะ|หมู่เกาะ|อ่าว|ทะเล(?!หมอก|สาบ|บัว)|island|\bbay\b|marine/i.test(nm)) return "beach";
      return "hiking";
    }
    if (k === "themepark" || k === "zoo") {
      // พิพิธภัณฑ์/สถานแสดงสัตว์น้ำ = ในร่ม เดินชมสบายๆ
      if (/สัตว์น้ำ|พันธุ์ปลา|aquari|underwater|sea ?life|ocean ?world/i.test(nm)) return "city";
      if (/สวนน้ำ|สระว่ายน้ำ|water|aqua|slide|splash|surf|wake|lagoon|slip ?n ?fly|andamanda|อันดามันดา/i.test(nm)) return "waterpark";
      if (/ดำน้ำ|\bdiv(e|ing)\b/i.test(nm)) return "beach";
      if (k === "zoo" || /ช้าง|elephant|monkey|ลิง|ฟาร์ม|farm|ผลไม้|fruit|garden|สวนดอกไม้|flower|pony/i.test(nm)) return "farm";
      return "themepark";
    }
    if (k === "nightlife") return "night";
    if (["cafe", "animalcafe", "restaurant"].includes(k)) return "cafe";
    return "city";
  }
  // คลังสินค้าแนวละ ~50 ชิ้น → สุ่มโชว์ 15 ชิ้นทุกครั้งที่เปิดหน้าสถานที่ (แต่ละที่/แต่ละครั้งไม่ซ้ำกัน)
  // จำชุดที่สุ่มไว้ต่อสถานที่จนกว่าจะออกจากหน้า เพื่อไม่ให้สลับเองตอนหน้าวาดใหม่ (เช่น เปลี่ยนภาษา)
  const outfitSeen = new Map();
  function outfitPick(p, list, n = 15) {
    const key = p.id + "|" + list.length;
    if (outfitSeen.has(key)) return outfitSeen.get(key);
    const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const gear = shuffle(list.filter(x => x.gear)), wear = shuffle(list.filter(x => !x.gear));
    const g = Math.min(gear.length, 3), out = [...wear.slice(0, n - g), ...gear.slice(0, g)];
    const res = shuffle(out).slice(0, n);
    outfitSeen.clear(); outfitSeen.set(key, res);
    return res;
  }
  function outfitBlock(p) {
    const st = state.outfits?.styles?.[outfitStyle(p)];
    if (!st) return "";
    const m = new Date().getMonth(), cold = st.tipCold && (m >= 10 || m <= 1);
    const items = outfitPick(p, (st.products || []).filter(x => /^https:\/\//.test(x?.url || "")));
    return `<section class="panel outfit-box">
      <h2>👗 ${t("outfitTitle")}</h2>
      <p class="outfit-style">${st.icon || ""} ${esc(pick(st.name))}</p>
      <p>${esc(pick(st.tip))}</p>
      ${cold ? `<p class="outfit-cold">❄️ ${esc(pick(st.tipCold))}</p>` : ""}
      ${items.length ? `<div class="outfit-rail">${items.map(x => `<a class="outfit-item" href="${safeUrl(x.url)}" target="_blank" rel="sponsored nofollow noopener" data-ext-app>
          ${x.image ? `<img src="${safeUrl(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
          <span>${esc(pick(x.title) || x.title || "")}</span>${x.price ? `<b>${fmtBaht(x.price)}</b>` : ""}</a>`).join("")}</div>
        <small class="outfit-note">${t("outfitAffiliate")}</small>` : ""}
    </section>`;
  }
  function placeBlurb(p) {
    const rv = reviewOf(p);
    if (rv?.summary && noPrice(pick(rv.summary))) return noPrice(pick(rv.summary));
    const own = noPrice(placeSummary(p));
    if (own) return own;
    const posts = placePosts(p);
    if (posts.length) {
      const top = [...posts].sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
      return t("blurbPosts", { n: posts.length, title: String(top.title || "").replace(/\s+/g, " ").trim().slice(0, 70) });
    }
    const c = PCAT[p.kind];
    const area = [distLabel(p), provName(p.province)].filter(Boolean).join(" ");
    return t("blurbBasic", { kind: c ? pick(c.name) : "", area }) + (p.hours ? ` ${t("blurbHours", { hours: fmtHours(p.hours) })}` : "");
  }
  // การ์ดที่เที่ยวแบบรายการ (ไม่มีรูป ไม่มีไอคอน): กรอบสีตามหมวด · ชื่อ · แท็ก · เขต/อำเภอ จังหวัด ระยะทาง · เวลาเปิด · ราคา · คำอธิบาย · เหมาะกับ
  function placeCard(p) {
    const c = PCAT[p.kind] || { icon: "📍", color: "#888" }, saved = state.saved.has(placeKey(p));
    const where = [distLabel(p), provName(p.province), state.pos && p.lat ? `${distanceKm(state.pos, p).toFixed(1)} ${t("km")}` : ""].filter(Boolean).join(" · ");
    const rv = reviewOf(p), summary = placeBlurb(p);
    const open = placeOpen(p);
    const price = [MENU_KINDS.has(p.kind) && menuText(p) !== "-" ? `🍽️ ${approx(p.menuPrice?.src)}${esc(menuText(p))}` : "", (!MENU_KINDS.has(p.kind) || p.kind === "animalcafe") && feeText(p) !== "-" ? `🎟️ ${approx(p.entry?.src)}${esc(feeText(p))}` : ""].filter(Boolean).join(" · ");
    return `
      <article class="card place-row" style="--c1:${c.color};--c2:${c.color2 || c.color}">
        <button class="save-btn" data-save="${esc(placeKey(p))}" aria-label="${saved ? t("unsaveAria") : t("saveAria")}">${saved ? "❤️" : "🤍"}</button>
        <a href="#/place/${encodeURIComponent(p.id)}">
          <div class="pr-body">
            <h3>${esc(placeName(p))}</h3>
            <div class="pr-tags">${c.name ? `<span class="cat">${c.icon} ${esc(pick(c.name))}</span>` : ""}${p.trend ? `<span class="hot">🔥 ${t("trending")}</span>` : p.rising ? `<span class="hot">📈 ${t("searchRising")}</span>` : ""}${p.business ? `<span class="ok">✅ ${t("verifiedShop")}</span>` : ""}</div>
            <div class="meta">📍 <span>${esc(where)}</span></div>
            ${p.hours || price ? `<div class="meta">${p.hours ? `🕒 <span>${open === true ? `<b class="open-now">${t("openNowShort")}</b> · ` : open === false ? `<b class="closed-now">${t("closedNow")}</b> · ` : ""}${approx(p.hoursSrc)}${esc(fmtHours(p.hours))}</span>` : ""}${p.hours && price ? " · " : ""}${price}</div>` : ""}
            ${summary ? `<p class="place-sum">${esc(summary.slice(0, 120))}${summary.length > 120 ? "…" : ""}</p>` : ""}
            ${rv?.goodFor?.length ? `<div class="good-for">${rv.goodFor.slice(0, 4).map(g => `<span>${GOOD_ICON[g] || "✨"} ${esc(t("gf_" + g))}</span>`).join("")}</div>` : ""}
          </div>
        </a>
      </article>`;
  }

  // ---------- "เปิดอยู่ตอนนี้" จากเวลาเปิดของ OpenStreetMap (รูปแบบที่พบบ่อย) → true/false/null (ไม่รู้) ----------
  const DAY_IDX = { mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6, su: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0, di: 2, mi: 3, do: 4, so: 0 };
  function daysOf(spec) {
    if (!spec || /^(daily|everyday)$/i.test(spec)) return [0, 1, 2, 3, 4, 5, 6];
    const out = new Set();
    for (const part of spec.split(",")) {
      const [x, y] = part.trim().toLowerCase().split(/\s*-\s*/).map(d => DAY_IDX[d]);
      if (x == null) continue;
      if (y == null) { out.add(x); continue; }
      for (let d = x, n = 0; n < 7; d = (d + 1) % 7, n++) { out.add(d); if (d === y) break; }
    }
    return [...out];
  }
  function openNow(hours, now = new Date()) {
    const h = String(hours || "").trim();
    if (!h) return null;
    if (/^24\/7$/.test(h)) return true;
    const day = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    let state_ = null, matched = false;
    // กฎหลังทับกฎก่อน (ตามหลัก OSM) · คั่นด้วย ; หรือ , ที่ตามด้วยชื่อวัน
    for (const rule of h.split(/;|,(?=\s*[A-Za-z]{2,3}\b)/)) {
      const m = rule.trim().match(/^((?:[A-Za-z]{2,3}(?:\s*-\s*[A-Za-z]{2,3})?\s*,?\s*)+|daily)?\s*(.*)$/i);
      if (!m) continue;
      const spec = (m[1] || "").replace(/\bPH\b,?/gi, "").trim().replace(/,$/, "");
      if (m[1] && !spec && /PH/i.test(m[1])) continue; // กฎของวันหยุดนักขัตฤกษ์อย่างเดียว ข้าม
      if (!daysOf(spec).includes(day)) continue;
      const body = m[2].trim();
      matched = true;
      if (/^(off|closed)$/i.test(body)) { state_ = false; continue; }
      const ranges = [...body.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
      if (!ranges.length) continue;
      state_ = ranges.some(r => { const s = +r[1] * 60 + +r[2]; let e = +r[3] * 60 + +r[4]; if (e <= s) e += 1440; return (mins >= s && mins < e) || (mins + 1440 >= s && mins + 1440 < e); });
    }
    return matched ? state_ : false; // มีเวลาเปิดแต่ไม่มีกฎของวันนี้ = ปิด
  }
  window.IYA_openNow = openNow; // ใช้ทดสอบ
  // เวลาเปิด "โดยประมาณ" (ค่าทั่วไปตามประเภท) ไม่ใช้ตัดสินว่าเปิดอยู่ตอนนี้
  const placeOpen = p => p.hoursSrc === "typical" ? null : openNow(p.hours);

  // ตัวกรองหน้าที่เที่ยว (จำค่าไว้ในเครื่อง)
  const PF_DEFAULT = { sort: "rec", dist: 0, open: false, free: false, hot: false, district: "", districtOf: "" };
  state.pf = { ...PF_DEFAULT, ...readLS("placeFilters", {}) };
  // ตำแหน่งไม่ได้จำข้ามการเปิดแอพ → "ใกล้ฉัน" ที่ค้างไว้จะไม่มีพิกัด กลับเป็นเรียงแบบแนะนำ (ไม่งั้นปุ่มดูเหมือนเปิดอยู่แต่ไม่ได้เรียงตามระยะ)
  if (state.pf.sort === "near") state.pf.sort = "rec";
  // คาเฟ่ + สถานที่บันเทิง (สวนสนุก สวนสัตว์ คาเฟ่สัตว์) ที่มีรูป ดันขึ้นก่อนในมุมมอง "แนะนำ"
  const FUN_BOOST = { cafe: 70, animalcafe: 70, themepark: 60, restaurant: 50, nightlife: 50, zoo: 45 };
  // มีรูปปก (รูปที่ AI คัด หรือรูปจากโพสต์รีวิว) = ดันขึ้น; รูปจากโพสต์ได้คะแนนรูปกลางๆ (6)
  const hasCover = p => !!(p.image || coverOf(p));
  // ไม่ต้องมีรูปก็ขึ้นก่อนได้: หมวดสนุก + กระแส + มีสรุปรีวิว สำคัญกว่ารูป (รูปเป็นแค่โบนัสเล็กน้อย)
  const placeRank = p => (FUN_BOOST[p.kind] || 0) + (p.business ? 30 : 0) + (p.hot ? 100 + Math.min(p.hot, 60) * 3 : 0) + (p.rising ? 40 : 0) + (reviewOf(p) ? 35 : 0) + (hasCover(p) ? 10 : 0) + Math.min(p.fame || 0, 15);
  // ชื่อที่ใช้จับคู่โพสต์ (ตัดคำนำหน้าทั่วไปออก แต่ถ้าเหลือแค่ชื่อจังหวัด เช่น "สวนสัตว์เชียงใหม่" → "เชียงใหม่" ไม่ใช้ กันจับผิดที่)
  let provNameSet = null;
  const placeNames = p => {
    provNameSet ||= new Set(Object.values(PROV).flatMap(x => [x.th, x.en, x.th?.replace(/^จังหวัด/, "")]).filter(Boolean).map(s => s.toLowerCase()).concat(["กรุงเทพ", "bangkok"]));
    return [...new Set([p.name?.th, p.name?.en, p.name?.th?.replace(/^(อุทยานแห่งชาติ|สวนสัตว์|พิพิธภัณฑสถานแห่งชาติ|พิพิธภัณฑ์|คาเฟ่|ร้าน|วัด)\s*/, "")]
      .filter(s => s && s.length >= 6).map(s => s.toLowerCase().trim()))].filter(s => !provNameSet.has(s));
  };
  // โพสต์ที่พูดถึงสถานที่นี้: จากข้อมูลรายสถานที่ (fetch-places) หรือจับคู่กับบอร์ดเทรนด์
  // (จำผลไว้ต่อสถานที่ — ถูกเรียกบ่อยตอนเรียงลำดับ/วาดการ์ด)
  const postCache = new WeakMap();
  // รีวิว Lemon8 เต็มของแต่ละสถานที่ (ทุกโพสต์ที่หาเจอ สูงสุด 120) แบ่งเก็บ 32 ไฟล์ โหลดเฉพาะไฟล์ของสถานที่ที่เปิดดู
  // (แบ่งไฟล์ด้วย FNV-1a เหมือน scripts/place-lemon8.mjs)
  const placeShard = id => { let h = 0x811c9dc5; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h % 32; };
  const shardLoads = new Map();
  function loadPlaceReviews(p) {
    const n = placeShard(p.id);
    if (!shardLoads.has(n)) shardLoads.set(n, getJSON(`data/place-posts/${String(n).padStart(2, "0")}.json`, {}));
    return shardLoads.get(n).then(s => {
      const extra = s?.[p.id]?.posts;
      if (extra?.length && !p.allPostsLoaded) { p.allPosts = extra.filter(state.postOk).map(x => ({ ...x, tag: 1 })); postCache.delete(p); }
      p.allPostsLoaded = true;
      return !!extra?.length;
    });
  }
  function placePosts(p) {
    if (postCache.has(p)) return postCache.get(p);
    let out = [];
    if (p.allPosts?.length) {
      out = [...new Map([...(p.posts || []), ...p.allPosts].map(x => [x.link, { ...x, kind: p.kind }])).values()];
      postCache.set(p, out);
      return out;
    }
    const names = placeNames(p);
    // ตรวจซ้ำว่าหัวโพสต์มีชื่อสถานที่จริง (ข้อมูลรอบเก่าอาจจับคู่ด้วยชื่อจังหวัด) — ร้านธุรกิจ/โพสต์ที่ผู้โพสต์ปักหมุดที่นี่ (tag) เชื่อได้
    if (p.posts?.length) out = p.posts.filter(x => p.business || p.fromTrend || x.tag || names.some(nm => String(x.title || "").toLowerCase().includes(nm))).map(x => ({ ...x, kind: p.kind }));
    if (!out.length && names.length) out = Object.entries(state.trends).flatMap(([k, items]) => items.map(n => ({ ...n, kind: k })))
      .filter(n => names.some(nm => String(n.title || "").toLowerCase().includes(nm))).sort((x, y) => (y.likes || 0) - (x.likes || 0)).slice(0, 4);
    postCache.set(p, out);
    return out;
  }
  const relDate = d => { const n = Math.round((Date.now() - new Date(d)) / 864e5); return n <= 0 ? t("today") : n < 30 ? t("daysAgo", { n }) : new Date(d).toLocaleDateString(locale(), { day: "numeric", month: "short" }); };
  // โพสต์ยอดนิยม (ไลก์ ≥ 100 หรือ ≥ 20% ของโพสต์ที่ไลก์สูงสุดในชุดนั้น) เรียงใหม่สุดก่อน
  function freshPopular(list) {
    const min = Math.min(100, Math.max(0, ...list.map(n => n.likes || 0)) * 0.2);
    // โพสต์ใหม่ (≤ 14 วัน) ยังไม่ทันมีไลก์เยอะ → ใช้เกณฑ์ไลก์ต่ำกว่า (≥ 10) ให้เทรนด์ล่าสุดขึ้นก่อนเสมอ
    const recent = n => n.date && (Date.now() - new Date(n.date)) / 864e5 <= 14;
    return list.filter(n => (n.likes || 0) >= min || (recent(n) && (n.likes || 0) >= Math.min(10, min))).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || (b.likes || 0) - (a.likes || 0));
  }
  const fmtLikes = n => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n || 0);
  // สถานที่ที่โพสต์เทรนด์พูดถึง (ใช้บนบอร์ดเทรนด์)
  let trendPlaceCache = null;
  let postPlace = null;
  function placeOfPost(n) {
    // 1) โพสต์นี้ถูกผูกกับสถานที่แล้ว (สคริปต์จับคู่ชื่อ+พิกัดบนแผนที่) 2) ชื่อสถานที่อยู่ในหัวโพสต์
    postPlace ||= new Map(state.places.flatMap(p => (p.posts || []).map(x => [x.link, p])));
    if (postPlace.has(n.link)) return postPlace.get(n.link);
    trendPlaceCache ||= state.places.filter(p => placeNames(p).length).map(p => [p, placeNames(p)]);
    const title = String(n.title || "").toLowerCase();
    return trendPlaceCache.find(([, names]) => names.some(nm => title.includes(nm)))?.[0] || null;
  }
  function trendCard(n) {
    const pl = n.pl || placeOfPost(n);
    return `<div class="news-item trend-item" style="--c1:${PCAT[n.kind]?.color || "var(--accent)"}">
      <a class="trend-link" ${inAppLink(n.link)}>
        ${trendThumb(n)}
        <h3>${esc(n.title)}</h3>
        <div class="meta">${PCAT[n.kind]?.icon || ""} ${esc(n.source || "")}${n.date ? ` · ${relDate(n.date)}` : ""}</div>
      </a>
      ${pl ? `<a class="trend-place" href="#/place/${encodeURIComponent(pl.id)}">📍 ${esc(placeName(pl))}</a>` : ""}
    </div>`;
  }
  // ลิงก์รูป CDN ของ Lemon8 มีวันหมดอายุ (x-expires) → หมดแล้วไม่ใช้
  const imgOk = u => /^https:\/\//.test(u || "") && !(+(String(u).match(/[?&]x-expires=(\d+)/) || [])[1] < Date.now() / 1000);
  // รูปจาก Lemon8 เป็นรูปเต็ม 1080px (200 KB – 1.3 MB) → ย่อผ่าน wsrv.nl (ฟรี · ~20–40 KB) จากลิงก์ CDN (ช่อง thumb ที่ scripts/thumbs.mjs หาไว้)
  // ย่อไม่ได้ → onerror สลับไปรูปเดิม (data-o) → ยังไม่ได้ค่อยซ่อน
  const CDN = /^https:\/\/[^/]*(tiktokcdn|lemon8cdn|byteimg)[^/]*\//;
  const isL8img = u => CDN.test(u || "") || /^https:\/\/www\.lemon8-app\.com\/seo\/image\?/.test(u || "");
  const localUrl = th => (NATIVE ? C.webUrl : "") + th;
  function imgSrc(u, thumb, w, h, th) {
    const base = imgOk(thumb) ? thumb : CDN.test(u || "") && imgOk(u) ? u : "";
    // รูปย่อที่เก็บในเว็บเราเอง (scripts/thumbs.mjs · เร็ว ไม่หมดอายุ) → ล้มเหลวค่อยใช้รูปเดิม
    if (th) return `src="${esc(localUrl(th))}" data-o="${esc(imgOk(u) ? u : base || u)}"`;
    if (!base) return `src="${esc(u)}"`;
    const small = `https://wsrv.nl/?url=${encodeURIComponent(base)}&w=${w}${h ? `&h=${h}&fit=cover` : ""}&output=webp&q=72`;
    return `src="${esc(small)}" data-o="${esc(imgOk(u) ? u : base)}"`;
  }
  const IMG_RETRY = "if(this.dataset.o){this.src=this.dataset.o;this.dataset.o='';return}";
  const fitBg = (u, thumb, th) => `<img class="img-bg" ${imgSrc(u, thumb, 120, 0, th)} alt="" aria-hidden="true" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">`;
  // แจ้งโพสต์ที่ไม่ตรงสถานที่ / เจ้าของโพสต์ขอให้ลบ → เปิด GitHub Issue ที่กรอกชื่อสถานที่ไว้แล้ว (ไม่ส่งข้อมูลส่วนตัว)
  function reportUrl(p, name) {
    const title = `แจ้งโพสต์: ${name} (${p.id})`;
    const body = `สถานที่: ${name}
รหัส: ${p.id}

ลิงก์โพสต์ที่ไม่ตรงสถานที่ / ต้องการให้ลบ:

เหตุผล:
`;
    return `https://github.com/Wattanasaw/i-you-alone/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  }
  function trendThumb(n) {
    const title = String(n.title || "").toLowerCase();
    // รูปปกของโพสต์ (พรีวิวจาก Lemon8 มีลายน้ำผู้โพสต์) → ไม่มีใช้รูปสถานที่ที่ชื่ออยู่ในโพสต์ → ไอคอนหมวด
    const p = !n.image && state.places.find(x => x.image && [x.name?.th, x.name?.en].some(s => s && s.length >= 6 && title.includes(s.toLowerCase())));
    const own = n.th || imgOk(n.image);
    const src = own ? n.image : p?.image, thumb = own ? n.thumb : "", th = own ? n.th : p?.imageTh;
    const pc = PCAT[n.kind] || { icon: "🔥", color: "#ff7a45" };
    return `<span class="trend-thumb" style="background:linear-gradient(135deg, ${pc.color}, ${pc.color2 || pc.color})">${pc.icon}${src ? `<img ${imgSrc(src, thumb, 340, 425, th)} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="${IMG_RETRY}this.remove()">` : ""}${n.likes ? `<b class="trend-likes">❤️ ${n.likes >= 1000 ? (n.likes / 1000).toFixed(1) + "K" : n.likes}</b>` : ""}</span>`;
  }

  // ตัวเลือกจุดเอง เมื่อเบราว์เซอร์/เครื่องไม่ให้ตำแหน่ง
  function nearPicker() {
    const prov = state.filters.province;
    let opts;
    if (prov === "all") {
      const counts = state.places.reduce((m, p) => (m[p.province] = (m[p.province] || 0) + 1, m), {});
      opts = window.PROVINCES.filter(p => counts[p.id]).sort((a, b) => provName(a.id).localeCompare(provName(b.id), locale())).map(p => `<option value="prov:${p.id}">${esc(provName(p.id))}</option>`).join("");
    } else {
      const ds = [...new Set(state.places.filter(p => p.province === prov && p.district).map(p => p.district))].sort((a, b) => a.localeCompare(b, "th"));
      opts = `<option value="prov:${prov}">${esc(t("provCenter", { prov: provName(prov) }))}</option>` + ds.map(d => `<option value="dist:${esc(d)}">${esc(distEn(d))}</option>`).join("");
    }
    return `<div class="geo-pick" role="group" aria-label="${t("nearPickLabel")}">
      <p>📍 ${t("geoPickNote")}</p>
      <div class="geo-pick-row"><select id="nearPick" aria-label="${t("nearPickLabel")}"><option value="">${t(prov === "all" ? "pickProvince" : "pickArea")}</option>${opts}</select>
      <button type="button" class="pill-btn" id="nearRetry">🔄 ${t("geoRetry")}</button></div>
    </div>`;
  }

  function renderPlaces() {
    const cat = state.placeCat;
    const counts = {};
    state.places.filter(inPlaceProvince).forEach(p => { counts[p.kind] = (counts[p.kind] || 0) + 1; });
    // ค้นหาจากชื่อ (ไทย/อังกฤษ/จีน) ที่อยู่ และชื่อจังหวัด
    const q = state.placeQ.trim().toLowerCase();
    const alts = qAlts(q);
    const match = p => !q || [p.name?.th, p.name?.en, p.name?.zh, p.address, provName(p.province), PROV[p.province]?.th].some(s => { const h = fold(s); return alts.some(a => h.includes(a)); });
    const pf = state.pf, near = pf.sort === "near" && state.pos;
    // ใกล้ฉัน: ไม่จำกัดจังหวัด (ดูรอบตัวจริงๆ)
    // เขต/อำเภอ: เลือกได้เมื่อเลือกจังหวัดแล้ว (เปลี่ยนจังหวัด = ล้างเขต)
    const prov = state.filters.province, distOn = !near && prov !== "all";
    if (!distOn || (pf.districtOf && pf.districtOf !== prov)) { pf.district = ""; pf.districtOf = ""; }
    const inProv = state.places.filter(p => (near || inPlaceProvince(p)) && (cat === "all" || p.kind === cat) && match(p));
    const districts = distOn ? Object.entries(inProv.reduce((m, p) => (p.district && (m[p.district] = (m[p.district] || 0) + 1), m), {})).sort((x, y) => x[0].localeCompare(y[0], "th")) : [];
    const base = inProv.filter(p => !pf.district || p.district === pf.district);
    const tests = {
      open: p => placeOpen(p) === true, free: p => p.fee === "no" || p.entry?.free === true, hot: p => !!(p.hot || p.trend),
      dist: p => !near || !pf.dist || distanceKm(state.pos, p) <= pf.dist
    };
    const passAll = (p, skip) => Object.entries(tests).every(([k, f]) => k === skip || (k === "dist" ? f(p) : !pf[k] || f(p)));
    let list = base.filter(p => passAll(p));
    // จำนวนที่จะได้ถ้ากดตัวกรองนั้น (แสดงบนปุ่ม)
    const would = k => base.filter(p => passAll(p, k) && tests[k](p)).length;
    const SORTS = {
      rec: (a, b) => placeRank(b) - placeRank(a),                                    // แนะนำ: กระแส → ค้นหาเพิ่ม → รูปสวย → ดัง
      near: (a, b) => distanceKm(state.pos, a) - distanceKm(state.pos, b),
      popular: (a, b) => (b.views || 0) - (a.views || 0) || (b.fame || 0) - (a.fame || 0),
      reviews: (a, b) => (reviewOf(b) ? 1 : 0) - (reviewOf(a) ? 1 : 0) || placeRank(b) - placeRank(a)
    };
    list = [...list].sort(SORTS[near ? "near" : pf.sort === "near" ? "rec" : pf.sort] || SORTS.rec);
    // พิมพ์ค้นหา: ชื่อตรงคำค้นมาก่อน ("เขาใหญ่" → อุทยานแห่งชาติเขาใหญ่ ก่อนคาเฟ่ที่ชื่อมีคำว่าเขาใหญ่) แล้วตามด้วยที่ดัง
    if (q && !near) {
      const PREFIX = /^(อุทยานแห่งชาติ|อช\.?|วนอุทยาน|วัด|พิพิธภัณฑ์|ตลาด|น้ำตก|ถ้ำ|เกาะ|หาด|ดอย|ภู|เขื่อน|สวน|national park|wat|temple|museum)\s*/i;
      const score = p => {
        const names = [p.name?.th, p.name?.en, p.name?.zh].filter(Boolean).map(fold);
        if (names.some(n => alts.includes(n) || alts.includes(n.replace(PREFIX, "").trim()))) return 3;
        if (names.some(n => alts.some(a => n.startsWith(a)))) return 2;
        return names.some(n => alts.some(a => n.includes(a))) ? 1 : 0;
      };
      const sc = new Map(list.map(p => [p, score(p) * 1000 + (score(p) >= 3 ? Math.min(p.fame || 0, 50) * 10 : 0)]));
      list.sort((a, b) => sc.get(b) - sc.get(a)); // sort คงลำดับเดิมเมื่อคะแนนเท่ากัน
    }
    const activeCount = ["open", "free", "hot"].filter(k => pf[k]).length + (near && pf.dist ? 1 : 0) + (pf.district ? 1 : 0);
    const placeExtra = ["open", "free", "hot"].filter(k => pf[k]).length + (pf.district ? 1 : 0) + (pf.sort !== "rec" && pf.sort !== "near" ? 1 : 0);
    // แสดงทีละ 30 แห่ง กด "ดูเพิ่ม" ได้ (หลายร้อยแห่งพร้อมกันทำให้แอพหน่วง)
    const shown = list.slice(0, state.placeShow);
    // บอร์ดเทรนด์: เฉพาะโพสต์ยอดนิยม (ไลก์ ≥ 100 หรือครึ่งบนของหมวด) แล้วเรียงตามวันที่ใหม่สุดก่อน
    // + โพสต์ของสถานที่ที่รวบรวมจากเทรนด์ (ผูกกับพิกัดจริงแล้ว)
    const pool = [...new Map([
      ...(cat === "all" ? Object.entries(state.trends) : [[cat, state.trends[cat] || []]]).flatMap(([k, items]) => items.map(n => ({ ...n, kind: k }))),
      // โพสต์ที่ผูกกับสถานที่แล้ว (ทุกสถานที่ ไม่ใช่แค่ที่มาจากเทรนด์) → บอร์ดมีโพสต์มากขึ้น
      ...state.places.filter(p => p.posts?.length && (cat === "all" || p.kind === cat) && inPlaceProvince(p)).flatMap(p => placePosts(p).map(n => ({ ...n, kind: p.kind, pl: p })))
    ].map(n => [n.link, n])).values()]
      // ต้องรู้ว่าโพสต์พูดถึงสถานที่ไหน (มีป้าย 📍) ถึงขึ้นบอร์ดเทรนด์
      .map(n => n.pl ? n : { ...n, pl: placeOfPost(n) }).filter(n => n.pl && inPlaceProvince(n.pl) && (cat === "all" || n.pl.kind === cat));
    // โพสต์ที่มีรูปปกขึ้นก่อน (การ์ดไม่มีรูปดูเหมือนโหลดไม่เสร็จ) — ไม่มีรูปใช้เมื่อโพสต์มีรูปไม่พอ
    const fp = freshPopular(pool), withImg = fp.filter(n => String(n.image || "").startsWith("https://"));
    // สถานที่ละไม่เกิน 2 โพสต์ (บอร์ดไม่ซ้ำร้านเดิม)
    const perPl = new Map();
    const board = (withImg.length >= 6 ? withImg : fp).filter(n => { const c = perPl.get(n.pl) || 0; perPl.set(n.pl, c + 1); return c < 2; }).slice(0, cat === "all" ? 40 : 24);
    app.innerHTML = `<div class="page">
      <h1 class="page-title">🗺️ ${t("placesTitle")}</h1>
      <!-- จังหวัด + หมวด อยู่ด้วยกันในแถบตัวกรอง ติดด้านบนตอนเลื่อน -->
      <div class="searchbox place-search"><input class="search" id="pq" type="search" placeholder="${esc(t("placesSearch"))}" value="${esc(state.placeQ)}"></div>
      <div class="filter-bar ${state.moreFilters ? "open" : ""}">
        <div class="filters places-row">
          <select id="pcatSel" class="cat-select ${cat !== "all" ? "on" : ""}" aria-label="${t("categories")}">
            <option value="all">${esc(t("categories"))}: ${esc(t("catAll"))}</option>
            ${C.placeCategories.map(c => `<option value="${c.id}" ${cat === c.id ? "selected" : ""}>${c.icon} ${esc(pick(c.name))} (${counts[c.id] || 0})</option>`).join("")}
          </select>
          <button type="button" class="pill-btn ${pf.sort === "near" ? "on" : ""}" id="pfNear" aria-pressed="${pf.sort === "near"}">📍 ${near && state.pos?.label ? esc(t("nearPlace", { place: state.pos.label })) : t("nearMe")}</button>
          ${near ? `<select id="pfDist" aria-label="${t("distance")}">${[0, 2, 5, 10, 20, 50, 100].map(d => `<option value="${d}" ${pf.dist === d ? "selected" : ""}>${d ? t("withinKm", { n: d }) : t("anyDistance")}</option>`).join("")}</select>` : provinceSelect(state.places.reduce((m, p) => (m[p.province] = (m[p.province] || 0) + 1, m), {}))}
          <button type="button" class="pill-btn more-btn ${placeExtra ? "on" : ""}" data-more aria-expanded="${!!state.moreFilters}">⚙️ ${t("moreFilters")}${placeExtra ? ` (${placeExtra})` : ""}</button>
          ${distOn && districts.length ? `<select id="pfDistrict" class="xf" aria-label="${t("districtLabel")}"><option value="">🏘️ ${t(prov === "bangkok" ? "allDistrictsBkk" : "allDistricts")}</option>${districts.map(([d, n]) => `<option value="${esc(d)}" ${pf.district === d ? "selected" : ""}>${esc(distEn(d))} (${n})</option>`).join("")}</select>` : ""}
          <select id="pfSort" class="xf" aria-label="${t("sortBy")}">
            ${[["rec", t("sortRec")], ["popular", t("sortPopular")], ["reviews", t("sortReviews")]].map(([v, l]) => `<option value="${v}" ${(pf.sort === v || (pf.sort === "near" && v === "rec")) ? "selected" : ""}>${l}</option>`).join("")}
          </select>
          ${[["open", "🟢", t("openNowFilter")], ["hot", "🔥", t("trending")], ["free", "🆓", t("feeNo")]].map(([k, i, l]) => `<button type="button" class="pill-btn xf ${pf[k] ? "on" : ""}" data-pf="${k}" aria-pressed="${!!pf[k]}">${i} ${esc(l)} <small>${would(k)}</small></button>`).join("")}
          ${activeCount ? `<button type="button" class="pill-btn clear xf" id="pfClear">✕ ${t("clearFilters")}</button>` : ""}
        </div>
      </div>
      ${state.geoFail && !(near && state.pos) ? nearPicker() : ""}
      ${board.length ? `<section class="trend-board">
        <div class="section-head"><h2>${t("trendBoard")}</h2><small>${t("swipe")}</small></div>
        <div class="news-list">${board.map(trendCard).join("")}</div></section>` : ""}
      <div class="section-head" id="placesHead"><h2>${cat !== "all" && PCAT[cat] ? `${PCAT[cat].icon} ${esc(pick(PCAT[cat].name))}` : t("placesAll")} <small>${t("placesFound", { n: list.length })}</small></h2></div>
      ${list.length ? `<div class="place-list">${shown.map(placeCard).join("")}</div>` : ""}
      ${adSlot("list_inline")}
      ${list.length ? "" : `<p class="empty">${t("noPlaces")}</p>`}
      ${list.length > shown.length ? `<div class="actions" style="justify-content:center"><button class="btn primary" id="moreBtn">${t("showMore", { n: list.length - shown.length })}</button></div>` : ""}
      <p class="disclosure">${t("placeNote")}</p></div>`;
    centerActiveChip();
    const keep = fn => () => { const y = window.scrollY; fn(); window.scrollTo(0, y); };
    document.getElementById("moreBtn")?.addEventListener("click", keep(() => { state.placeShow += 30; renderPlaces(); }));
    const pq = document.getElementById("pq");
    let timer;
    pq.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.placeQ = pq.value; state.placeShow = 30;
        const pos = pq.selectionStart;
        keep(renderPlaces)();
        const again = document.getElementById("pq"); again.focus(); again.setSelectionRange(pos, pos);
      }, 250);
    });
    document.getElementById("pcatSel").addEventListener("change", e => {
      state.placeShow = 30;
      state.placeCat = e.target.value;
      const y = window.scrollY;
      renderPlaces();
      window.scrollTo(0, y);
    });
    document.getElementById("province")?.addEventListener("change", e => {
      state.filters.province = e.target.value;
      writeLS("province", state.filters.province);
      state.placeShow = 30;
      keep(renderPlaces)();
    });
    // ตัวกรองที่เที่ยว
    const setPf = patch => { Object.assign(state.pf, patch); writeLS("placeFilters", state.pf); state.placeShow = 30; keep(renderPlaces)(); };
    document.getElementById("pfNear").addEventListener("click", () => {
      if (state.pf.sort === "near") return setPf({ sort: "rec", dist: 0 });
      // ระบุตำแหน่งไม่ได้ → ไม่เด้ง alert แต่โชว์ตัวเลือกพื้นที่ (nearPicker) ใต้แถบตัวกรองแทน
      locate(() => { if (state.pos) setPf({ sort: "near", dist: state.pf.dist || 20 }); else setPf({ sort: "rec" }); }, true);
    });
    // ระบุตำแหน่งไม่ได้ → เลือกจุดเอง (จังหวัด → เขต/อำเภอ) ใช้จุดกึ่งกลางของสถานที่ในพื้นที่นั้นเป็น "ตำแหน่งของฉัน"
    document.getElementById("nearPick")?.addEventListener("change", e => {
      const [type, val] = e.target.value.split(":");
      if (!val) return;
      if (type === "prov" && state.filters.province === "all") { state.filters.province = val; writeLS("province", val); keep(renderPlaces)(); return; }
      const inArea = state.places.filter(p => p.lat && p.province === state.filters.province && (type !== "dist" || p.district === val));
      if (!inArea.length) return;
      const lat = inArea.reduce((s, p) => s + +p.lat, 0) / inArea.length, lng = inArea.reduce((s, p) => s + +p.lng, 0) / inArea.length;
      state.pos = { lat, lng, label: type === "dist" ? val : provName(state.filters.province), manual: true };
      setPf({ sort: "near", dist: state.pf.dist || 10 });
    });
    document.getElementById("nearRetry")?.addEventListener("click", () => locate(() => { if (state.pos) setPf({ sort: "near", dist: state.pf.dist || 20 }); else keep(renderPlaces)(); }, true));
    document.getElementById("pfDist")?.addEventListener("change", e => setPf({ dist: +e.target.value }));
    document.getElementById("pfSort").addEventListener("change", e => setPf({ sort: e.target.value }));
    document.getElementById("pfDistrict")?.addEventListener("change", e => setPf({ district: e.target.value, districtOf: e.target.value ? state.filters.province : "" }));
    app.querySelectorAll("[data-pf]").forEach(b => b.addEventListener("click", () => setPf({ [b.dataset.pf]: !state.pf[b.dataset.pf] })));
    // เคยเลือก "ใกล้ฉัน" ไว้ แต่เพิ่งเปิดแอพ (ยังไม่มีตำแหน่ง) → ขอตำแหน่งให้อีกครั้ง (ครั้งเดียวต่อการเปิด)
    if (state.pf.sort === "near" && !state.pos && !state.nearTried) { state.nearTried = true; locate(() => { if (!state.pos) state.pf.sort = "rec"; keep(renderPlaces)(); }, true); }
    document.getElementById("pfClear")?.addEventListener("click", () => setPf({ open: false, free: false, hot: false, district: "", districtOf: "", dist: state.pf.sort === "near" ? 0 : state.pf.dist }));
    bindSave(app, keep(renderPlaces));
    activateAdsense();
  }

  // "สรุปจากรีวิว": เหมาะกับ · จุดเด่น · ต้องลอง · เคล็ดลับ · ข้อควรรู้ (แต่ละหัวข้อแสดงเมื่อมีข้อมูล) + ลิงก์โพสต์ต้นทาง
  function reviewBlock(rv) {
    const sec = (icon, key, list) => list.length ? `<div class="rv-sec"><b>${icon} ${t(key)}</b><ul>${list.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
    return `<section class="panel rv-box" aria-label="${t("rvTitle")}">
      <div class="rv-head"><h2>📝 ${t("rvTitle")}</h2><small>${rv.ai ? t("aiBadge") : t("rvFrom", { n: rv.n || rv.src?.length || 1 })}</small></div>
      ${rv.ai ? `<p class="ai-note">🤖 ${t("aiNote")}</p>` : ""}
      ${rv.goodFor?.length ? `<div class="good-for">${rv.goodFor.map(g => `<span>${GOOD_ICON[g] || "✨"} ${esc(t("gf_" + g))}</span>`).join("")}</div>` : ""}
      ${sec("✨", "rvHighlights", rvList(rv.highlights))}
      ${sec("😋", "rvMustTry", rvList(rv.mustTry))}
      ${sec("💡", "rvTips", rvList(rv.tips))}
      ${sec("⚠️", "rvCons", rvList(rv.cons))}
      ${rv.src?.length ? `<p class="rv-src">${t("rvSources")}: ${rv.src.map(s => `<a ${inAppLink(s.link)}>${{ web: "🌐 ", wiki: "📖 ", voyage: "🧳 " }[s.type] || ""}${esc(String(s.source || "Lemon8").replace(/^Lemon8 · /, "@"))}</a>`).join(" · ")}</p>` : ""}
      ${rv.ai && rv.sources?.length ? `<p class="rv-src">${t("rvSources")}: ${rv.sources.map(u => { let h = u; try { h = new URL(u).hostname.replace(/^www\./, ""); } catch {} return `<a ${inAppLink(u)}>${esc(h)}</a>`; }).join(" · ")}</p>` : ""}
    </section>`;
  }

  function renderPlace(id) {
    const p = state.places.find(x => x.id === id);
    if (!p) { app.innerHTML = `<a class="back" href="#/places">${t("back")}</a><p class="empty">${t("placeNotFound")}</p><div class="actions" style="justify-content:center"><a class="btn primary" href="#/places">${t("placesAll")}</a></div>`; return; }
    const c = PCAT[p.kind], v = placeVenue(p), saved = state.saved.has(placeKey(p));
    const name = placeName(p), rv = reviewOf(p), summary = placeSummary(p) || placeBlurb(p);
    const wiki = p.wiki?.[state.lang] || p.wiki?.th || p.wiki?.en;
    document.title = `${name} — ${C.siteName}`;
    // หน้ารายละเอียดแบบกะทัดรัด: รูปปก+ชื่อ → ข้อมูลด่วน → ปุ่มนำทาง → แท็บ (ภาพรวม / การเดินทาง / กระแส) ไม่ต้องเลื่อนยาว
    const posts = placePosts(p), open = placeOpen(p);
    // โพสต์ยอดนิยมที่สุด (ไลก์มากสุด) แสดงรูปใหญ่บนสุดของแท็บกระแส
    const top = [...posts].sort((a, b) => (b.likes || 0) - (a.likes || 0))[0];
    const topCv = top && (top.th || imgOk(top.image) ? { src: top.image, thumb: top.thumb, th: top.th } : coverOf(p)), topImg = topCv?.src;
    const topHtml = top ? `<a class="trend-hero" ${inAppLink(top.link)}>
        <span class="th-img" style="background:linear-gradient(135deg, ${c?.color || "#ff7a45"}, ${c?.color2 || c?.color || "#ff2d78"})">${c?.icon || "🔥"}${topImg ? `${fitBg(topImg, topCv.thumb, topCv.th)}<img class="img-fit" ${imgSrc(topImg, topCv.thumb, 800, 0, topCv.th)} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="${IMG_RETRY}this.remove()">` : ""}</span>
        <span class="th-badge">👑 ${t("topPost")}${top.likes ? ` · ❤️ ${fmtLikes(top.likes)}` : ""}</span>
        <span class="th-txt"><b>${esc(top.title)}</b><small>${esc(String(top.source || "Lemon8").replace(/^Lemon8 · /, "@"))}${top.date ? ` · ${relDate(top.date)}` : ""}</small></span>
      </a>` : "";
    const tabs = [["overview", "📋 " + t("tabOverview")], ["travel", "🧭 " + t("tabTravel")], ...(posts.length ? [["trends", `🔥 ${t("tabTrends")} ${posts.length}`]] : [])];
    if (!tabs.some(([k]) => k === state.placeTab)) state.placeTab = "overview";
    const quick = [
      p.hours ? `<span class="q ${open === true ? "ok" : open === false ? "off" : ""}">🕒 ${open === true ? t("openNowShort") : open === false ? t("closedNow") : approx(p.hoursSrc) + esc(fmtHours(p.hours))}</span>` : "",
      (!MENU_KINDS.has(p.kind) || p.kind === "animalcafe") && feeText(p) !== "-" ? `<span class="q">🎟️ ${approx(p.entry?.src)}${esc(feeText(p))}</span>` : "",
      MENU_KINDS.has(p.kind) && menuText(p) !== "-" ? `<span class="q">🍽️ ${approx(p.menuPrice?.src)}${esc(menuText(p))}</span>` : "",
      `<span class="q">📍 ${esc([distLabel(p), state.pos && p.lat ? `${distanceKm(state.pos, p).toFixed(1)} ${t("km")}` : provName(p.province)].filter(Boolean).join(" · "))}</span>`
    ].join("");
    // ข้อมูลสำคัญ: รูปแบบเดียวกับหน้ารายละเอียดงาน (panel + facts + บรรทัดรอง)
    const area = [distLabel(p), provName(p.province)].filter(Boolean).join(" · ");
    const facts = `<section class="panel">
        <h2>${t("keyInfo")}</h2>
        <dl class="facts">
          <div><dt>📍</dt><dd>${esc(p.address || name)}<small>${esc(area)}</small><a class="maps-link" ${mapsLink(v, null)}>${t("openMaps")}</a></dd></div>
          <div><dt>🕒</dt><dd>${esc(fmtHours(p.hours) || t("hoursUnknown"))}${open != null ? `<small class="${open ? "open-now" : "closed-now"}">${open ? t("openNowShort") : t("closedNow")}</small>` : ""}${srcNote(p.hoursSrc)}</dd></div>
          ${!MENU_KINDS.has(p.kind) || p.kind === "animalcafe" ? `<div><dt>🎟️</dt><dd>${t("fee")}: ${esc(feeText(p))}${srcNote(p.entry?.src)}${feeTiers(p)}</dd></div>` : ""}
          ${MENU_KINDS.has(p.kind) ? `<div><dt>🍽️</dt><dd>${t("menuPrice")}: ${esc(menuText(p))}${srcNote(p.menuPrice?.src)}</dd></div>` : ""}
          ${p.phone ? `<div><dt>☎️</dt><dd><a href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">${esc(p.phone.split(";")[0])}</a></dd></div>` : ""}
        </dl>
      </section>`;
    app.innerHTML = `
      <a class="back" href="#/places">${t("backPlaces")}</a>
      <div class="pd">
        <div class="pd-hero ${coverOf(p) ? "" : "noimg"}">
          ${placeCover(p, "cover pd-cover")}</div>
          <div class="pd-hero-text">
            <div class="pd-tags">${c ? `<span>${c.icon} ${esc(pick(c.name))}</span>` : ""}${p.business ? `<span>✅ ${t("verifiedShop")}</span>` : ""}${p.trend ? `<span class="hot">🔥 ${t("trending")}</span>` : p.rising ? `<span class="hot">📈 ${t("searchUp", { n: p.rising })}</span>` : ""}</div>
            <h1>${esc(name)}</h1>
            ${placeSubName(p) ? `<p class="pd-sub">${esc(placeSubName(p))}</p>` : ""}
          </div>
          <div class="pd-icons">
            <button class="icon-btn" id="saveBtn" aria-label="${saved ? t("unsaveAria") : t("saveAria")}">${saved ? "❤️" : "🤍"}</button>
            <button class="icon-btn" id="shareBtn" aria-label="${t("share")}">🔗</button>
          </div>
        </div>
        <div class="pd-quick">${quick}</div>
        <div class="pd-actions">
          <a class="btn primary" ${mapsLink(v, "driving")}>🧭 ${t("navigate")}</a>
          ${p.website ? `<a class="btn" ${inAppLink(p.website)}>🌐 ${t("website")}</a>` : `<a class="btn" ${mapsLink(v, null)}>🗺️ ${t("openMapsShort")}</a>`}
          ${placeHotelBlock(p)}
        </div>
        ${p.lat && C.tripAffiliate?.allianceId ? `<p class="disclosure pd-aff">${esc(pick(C.affiliateDisclosure))}</p>` : ""}
        <div class="pd-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${state.placeTab === k ? "active" : ""}" data-ptab="${k}" aria-selected="${state.placeTab === k}">${l}</button>`).join("")}</div>
        <section class="pd-panel" data-panel="overview" ${state.placeTab === "overview" ? "" : "hidden"}>
          ${summary ? `<p class="pd-summary" id="pdSum">${esc(summary)}</p>${summary.length > 180 ? `<button class="link-btn" id="pdMore">${t("readMore")}</button>` : ""}` : ""}
          ${facts}
          ${c?.adult ? `<p class="adult-note">${t("age20Place")}</p>` : ""}
          ${p.maybeClosed ? `<p class="adult-note">⚠️ ${t("aiClosed")}</p>` : ""}
          ${rv ? reviewBlock(rv) : ""}
          ${outfitBlock(p)}
          ${window.IYA_GOOGLE?.block(p) || ""}
          <p class="pd-links">${p.fromTrend ? `<span>🔥 ${t("fromTrendNote")}</span>` : ""}${wiki ? `<a ${inAppLink(wiki)}>📖 ${t("wikipedia")}</a>` : ""}${p.imagePage ? `<span>${t("photo")}: <a ${inAppLink(p.imagePage)}>${esc(p.imageCredit || "Wikimedia Commons")}</a></span>` : ""}</p>
          ${MEMBERS && !p.business ? `<a class="claim-link" href="#/account/new-shop?ref=${encodeURIComponent(p.id)}">🏪 ${t(p.image ? "claimPlace" : "claimPlaceNoPhoto")}</a>` : ""}
        </section>
        <section class="pd-panel" data-panel="travel" ${state.placeTab === "travel" ? "" : "hidden"}>${travelPanel({}, placeTravelVenue(p))}</section>
        ${posts.length ? `<section class="pd-panel trend-board place-trends" data-panel="trends" ${state.placeTab === "trends" ? "" : "hidden"}>
          ${topHtml}
          <p class="muted">${t("placeTrendsSub")}</p>
          <div class="news-list">${[...posts].filter(n => n !== top).sort((a, b) => (b.likes || 0) - (a.likes || 0) || String(b.date || "").localeCompare(String(a.date || ""))).map(n => `<div class="news-item trend-item"><a class="trend-link" ${inAppLink(n.link)}>${trendThumb(n)}<h3>${esc(n.title)}</h3><div class="meta">${n.likes ? `❤️ ${fmtLikes(n.likes)} · ` : ""}${esc(n.source || "Lemon8")}${n.date ? ` · ${relDate(n.date)}` : ""}</div></a></div>`).join("")}</div>
          <a class="btn block" style="margin-top:12px" ${inAppLink(`https://www.lemon8-app.com/experience/${encodeURIComponent(p.name?.th || p.name?.en || name)}?region=th`)}>🍋 ${t("moreOnLemon8")}</a>
          <a class="report-link" href="${reportUrl(p, name)}" target="_blank" rel="noopener">🚩 ${t("reportPost")}</a>
        </section>` : ""}
        ${adSlot("detail")}
        <p class="disclosure">${t("placeNote")}</p>
      </div>`;
    // แท็บ: สลับเนื้อหาโดยไม่ต้องเลื่อน (จำแท็บล่าสุดไว้ระหว่างเปิดสถานที่อื่น)
    app.querySelectorAll("[data-ptab]").forEach(b => b.addEventListener("click", () => {
      state.placeTab = b.dataset.ptab;
      app.querySelectorAll(".pd-tabs [data-ptab]").forEach(x => { const on = x.dataset.ptab === state.placeTab; x.classList.toggle("active", on); x.setAttribute("aria-selected", on); });
      app.querySelectorAll("[data-panel]").forEach(x => { x.hidden = x.dataset.panel !== state.placeTab; });
      if (!b.closest(".pd-tabs")) app.querySelector(".pd-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    document.getElementById("pdMore")?.addEventListener("click", e => { document.getElementById("pdSum").classList.add("open"); e.target.remove(); });
    document.getElementById("saveBtn").addEventListener("click", () => {
      const k = placeKey(p);
      state.saved.has(k) ? state.saved.delete(k) : state.saved.add(k);
      writeLS("saved", [...state.saved]);
      renderPlace(id);
    });
    document.getElementById("shareBtn").addEventListener("click", async () => {
      const data = { title: name, text: name, url: publicUrl() };
      const Share = window.Capacitor?.Plugins?.Share;
      if (NATIVE && Share) { try { await Share.share({ ...data, dialogTitle: name }); } catch {} }
      else if (navigator.share) { try { await navigator.share(data); } catch {} }
      else { try { await navigator.clipboard.writeText(data.url); alert(t("copied")); } catch {} }
    });
    const lb = document.getElementById("locBtn");
    if (lb) lb.addEventListener("click", () => locate(() => { state.placeTab = "travel"; renderPlace(id); hydrateGuides(); }));
    window.IYA_GOOGLE?.bind(p);
    activateAdsense();
    // โหลดรีวิว Lemon8 เต็มของที่นี่ แล้ววาดใหม่ (ยังอยู่หน้าเดิม · คงตำแหน่งเลื่อน)
    if (!p.allPostsLoaded) loadPlaceReviews(p).then(had => {
      if (!had || location.hash !== `#/place/${encodeURIComponent(id)}`) return;
      const y = window.scrollY;
      renderPlace(id); hydrateGuides();
      window.scrollTo(0, y);
    });
    // สรุปรีวิวเต็ม (จุดเด่น ต้องลอง เคล็ดลับ ที่จอดรถ แหล่งอ้างอิง) โหลดเฉพาะตอนเปิดหน้านี้
    if (state.reviews[p.id] && !(p.id in state.reviewFull)) loadFullReview(p).then(had => {
      if (!had || location.hash !== `#/place/${encodeURIComponent(id)}`) return;
      const y = window.scrollY;
      renderPlace(id); hydrateGuides();
      window.scrollTo(0, y);
    });
  }

  // บนมือถือที่ยังไม่ได้ติดตั้งแอพ: ชวนติดตั้ง เพื่อให้ลิงก์เปิดในแอพ
  const installHint = () => PLATFORM !== "desktop" && !isStandalone()
    ? `<div class="install-hint"><span>${t("installHint")}</span><a href="#/about">${t("installHow")}</a></div>` : "";

  function renderNews() {
    const n = state.news, items = n.items || [];
    const label = id => CAT[id] ? `${CAT[id].icon} ${catName(CAT[id])}` : t("general");
    // ปุ่มหมวดเล็ก ๆ: แสดงเฉพาะหมวดที่มีข่าว พร้อมจำนวน
    const counts = {};
    items.forEach(it => { counts[it.category] = (counts[it.category] || 0) + 1; });
    if (state.newsCat !== "all" && !counts[state.newsCat]) state.newsCat = "all";
    const pill = (id, text, num) =>
      `<button class="pill ${state.newsCat === id ? "active" : ""}" data-ncat="${id}" aria-pressed="${state.newsCat === id}">${text} <small>${num}</small></button>`;
    app.innerHTML = `<div class="page">
      <h1>${t("newsTitle")}</h1>
      <p class="result-count">${t("newsSub")}${n.updatedAt ? ` · ${t("updated")} ${new Date(n.updatedAt).toLocaleString(locale())}` : ""}${t("newsThaiNote") ? `<br>${t("newsThaiNote")}` : ""}</p>
      ${items.length ? `<div class="pills" role="group" aria-label="${t("categories")}">
        ${pill("all", t("catAll"), items.length)}
        ${C.categories.filter(c => counts[c.id]).map(c => pill(c.id, `${c.icon} ${esc(catName(c))}`, counts[c.id])).join("")}
      </div>` : ""}
      ${installHint()}
      ${adSlot("news")}
      <div class="news-list" id="newsList"></div></div>`;
    const list = () => {
      const shown = state.newsCat === "all" ? items : items.filter(it => it.category === state.newsCat);
      document.getElementById("newsList").innerHTML = shown.length ? shown.map(it => `
          <a class="news-item" ${inAppLink(it.link)} style="--c1:${CAT[it.category]?.color || "var(--accent)"}">
            <h3>${esc(it.title)}</h3>
            <div class="meta">${label(it.category)} · ${esc(it.source || "")} · ${it.pubDate ? new Date(it.pubDate).toLocaleDateString(locale()) : ""}</div>
          </a>`).join("") : `<p class="empty">${t("newsEmpty")}</p>`;
    };
    list();
    app.querySelectorAll("[data-ncat]").forEach(b => b.addEventListener("click", () => {
      state.newsCat = b.dataset.ncat;
      app.querySelectorAll("[data-ncat]").forEach(x => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
      list();
    }));
    activateAdsense();
  }

  function renderAbout() {
    const contact = [
      C.contactEmail && `<a class="btn primary" href="mailto:${esc(C.contactEmail)}">✉️ ${esc(C.contactEmail)}</a>`,
      C.contactLine && `<a class="btn" href="${safeUrl(C.contactLine)}" target="_blank" rel="noopener">💬 LINE</a>`
    ].filter(Boolean).join("");
    const site = esc(C.siteName);
    app.innerHTML = `<div class="page">
      <h1>${t("aboutTitle", { site })}</h1>
      <section class="panel prose">
        <p>${t("about1", { site })}</p>
        <p>${t("about2")}</p>
        <p class="disclosure">${esc(pick(C.affiliateDisclosure))}</p>
      </section>
      <section class="panel prose">
        <h2>${t("adsTitle")}</h2>
        <p>${t("adsDesc")}</p>
        <div class="actions">${contact || `<a class="btn" href="https://github.com/Wattanasaw/i-you-alone/issues" target="_blank" rel="noopener">💬 ${t("contactUs")}</a>`}</div>
      </section>
      ${NATIVE ? "" : `<section class="panel prose">
        <h2>${t("installTitle")}</h2>
        <p>${t("installDesc")}</p>
        ${C.apkUrl && !NATIVE && PLATFORM !== "ios" ? `<div class="actions"><a class="btn primary" href="${safeUrl(C.apkUrl)}" download>📲 ${t("getApp")}</a></div><p class="disclosure">${t("getAppDesc")}</p>` : ""}
      </section>`}
      <p class="disclosure"><a href="privacy.html" ${NATIVE ? "" : `target="_blank" rel="noopener"`}>${t("privacy")}</a></p></div>`;
  }

  // ---------- ตัวเลือกภาษา + ข้อความคงที่ใน index.html ----------
  function applyStaticText() {
    document.documentElement.lang = state.lang === "zh" ? "zh-CN" : state.lang;
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.getElementById("footerText").textContent = `© ${new Date().getFullYear()} ${C.siteName} · ${t("footer")}`;
    const sel = document.getElementById("langSel");
    window.IYA_MEMBER?.paint?.();
    sel.innerHTML = (C.languages || ["th"]).map(l => `<option value="${l}" ${l === state.lang ? "selected" : ""}>${window.I18N[l].langName}</option>`).join("");
    paintThemeBtn();
  }
  // ---------- โหมดกลางคืน (night light): สลับธีมมืด/สว่าง จำค่าไว้ในเครื่อง ----------
  const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (document.documentElement.dataset.theme || (darkMQ.matches ? "dark" : "light")) === "dark";
  function paintThemeBtn() {
    const b = document.getElementById("themeBtn"), dark = isDark();
    b.textContent = dark ? "☀️" : "🌙";
    b.title = b.ariaLabel = t(dark ? "themeLight" : "themeDark");
    b.setAttribute("aria-pressed", dark);
    document.querySelector('meta[name="theme-color"]').content = dark ? "#0f0c1a" : "#ff2d78";
  }
  document.getElementById("themeBtn").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    const root = document.documentElement;
    root.classList.add("theme-anim");
    root.dataset.theme = next;
    writeLS("theme", next);
    paintThemeBtn();
    setTimeout(() => root.classList.remove("theme-anim"), 400);
  });
  darkMQ.addEventListener?.("change", paintThemeBtn);

  document.getElementById("langSel").addEventListener("change", e => {
    state.lang = e.target.value;
    writeLS("lang", state.lang);
    applyStaticText();
    route();
  });

  // ---------- แถบตัวกรองยุบตอนเลื่อนลง (เหลือแถวหมวดหมู่) ให้เห็นรายการมากขึ้น ----------
  let lastY = window.scrollY, hold = 0;
  window.addEventListener("scroll", () => {
    const y = window.scrollY, bar = app.querySelector(".filter-bar");
    // แถบย่อ/ขยาย → ความสูงเปลี่ยน เบราว์เซอร์เลื่อนหน้าชดเชยเอง (ไม่ใช่ผู้ใช้เลื่อน) → พักการตรวจครู่หนึ่ง กันสลับไปมา
    if (Date.now() < hold) { lastY = y; return; }
    if (bar) {
      const stuck = bar.getBoundingClientRect().top <= parseFloat(getComputedStyle(bar).top) + 1;
      const was = bar.className;
      if (y > lastY + 8 && stuck) bar.classList.add("slim");
      else if (y < lastY - 8 || (!stuck && y < 40)) bar.classList.remove("slim");
      // ติดด้านบนกลางหน้า = แถวเดียวเลื่อนข้างได้ (ไม่บังรายการ) · อยู่ตำแหน่งปกติบนสุด = แสดงครบทุกตัวเลือก
      bar.classList.toggle("stuck", stuck && y > 60);
      if (was !== bar.className) { hold = Date.now() + 400; lastY = window.scrollY; return; }
    }
    if (Math.abs(y - lastY) > 8) lastY = y;
  }, { passive: true });

  // ---------- router ----------
  document.addEventListener("click", e => {
    const b = e.target.closest?.("[data-more]");
    if (!b) return;
    state.moreFilters = !state.moreFilters;
    b.closest(".filter-bar")?.classList.toggle("open", state.moreFilters);
    b.setAttribute("aria-expanded", String(state.moreFilters));
  });
  // ปุ่มกลับขึ้นบนสุด (รายการยาว) — โผล่เมื่อเลื่อนลงเกิน ~1.5 จอ
  const toTop = document.createElement("button");
  toTop.type = "button"; toTop.className = "to-top"; toTop.textContent = "↑";
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  document.body.append(toTop);
  const paintTop = () => { toTop.classList.toggle("show", window.scrollY > window.innerHeight * 1.5); toTop.setAttribute("aria-label", t("toTop")); toTop.title = t("toTop"); };
  window.addEventListener("scroll", paintTop, { passive: true });
  function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [, page, arg] = h.split("/");
    document.title = `${C.siteName} — ${t("siteTitle")}`;
    const nav = page === "event" ? "" : page === "place" ? "places" : (page || "home");
    document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === nav));
    if (page === "event") renderDetail(decodeURIComponent(arg || ""));
    else if (page === "place") renderPlace(decodeURIComponent(arg || ""));
    else if (page === "places") renderPlaces();
    else if (page === "saved") renderSaved();
    else if (page === "news") renderNews();
    else if (page === "about") renderAbout();
    else if (page === "account") MEMBERS && window.IYA_MEMBER ? window.IYA_MEMBER.render(app, arg) : renderAbout();
    else renderHome();
    window.scrollTo(0, 0);
    hydrateGuides();
  }

  applyStaticText();
  window.addEventListener("hashchange", route);
  load().then(() => {
    // เริ่มระบบสมาชิกก่อนแสดงหน้า (คืนสถานะเข้าระบบเบื้องหลัง ไม่ต้องรอ)
    if (MEMBERS) window.IYA_MEMBER?.init({ C, state, t, esc, pick, provName, readLS, writeLS, locate });
    window.IYA_GOOGLE?.init({ C, t, esc, provName, inAppLink, lang: () => state.lang });
    route();
  });

  // แอพมือถือมีไฟล์ติดเครื่องอยู่แล้ว ไม่ต้องใช้ service worker
  if (!NATIVE && "serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
