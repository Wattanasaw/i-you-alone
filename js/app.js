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
    pos: null
  };

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
  const PLATFORM = /Android/i.test(UA) ? "android"
    : (/iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1)) ? "ios" : "desktop";
  // ติดตั้งเป็นแอพแล้ว (เปิดจากไอคอนหน้าจอหลัก)
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // ข่าว / เว็บผู้จัด / ขายบัตร: ถ้าติดตั้งแอพแล้ว เปิดในหน้าต่างเดิม → มือถือจะเปิดเป็นเบราว์เซอร์ในแอพ
  // (Android: Chrome Custom Tab, iPhone: Safari View) กด ✕ / เสร็จสิ้น แล้วกลับมาที่แอพ
  // ถ้ายังไม่ได้ติดตั้ง เปิดแท็บใหม่เพื่อไม่ให้หน้าแอพหายไป
  const inAppLink = url => `href="${safeUrl(url)}" rel="noopener"${isStandalone() ? "" : ` target="_blank"`}`;

  // ---------- ภาษา ----------
  const dict = () => window.I18N[state.lang] || window.I18N.th;
  // ข้อความหน้าจอ: t("found", { n: 3 })
  const t = (key, params = {}) => String(dict()[key] ?? window.I18N.th[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
  // ข้อความที่เป็น { th, en, zh } ใน config
  const pick = obj => typeof obj === "string" ? obj : (obj?.[state.lang] || obj?.th || "");
  // เนื้อหางาน/สถานที่: ใช้คำแปลใน i18n.<lang> ถ้ามี ไม่งั้นใช้ภาษาไทยต้นฉบับ
  const tr = (item, field) => item?.i18n?.[state.lang]?.[field] ?? item?.[field];
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
    if (p.min && p.max && p.min !== p.max) return { cls: "paid", text: `${t("currency")}${fmt(p.min)}–${fmt(p.max)}` };
    if (p.min) return { cls: "paid", text: `${t("currency")}${fmt(p.min)}` };
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
    const bg = ev.image
      ? `background-image:url('${safeUrl(ev.image)}')`
      : `background:linear-gradient(135deg, ${cat.color}, ${cat.color2 || cat.color})`;
    const s = parseDate(ev.startDate);
    const chip = ev.ongoing && s <= today()
      ? `<div class="datechip"><b>${t("chipOpen")}</b><span>${t("chipDaily")}</span></div>`
      : `<div class="datechip"><b>${s.getDate()}</b><span>${fmtDate(s, { month: "short" })}</span></div>`;
    return `<div class="${cls}" style="${bg}">${chip}${ev.image ? "" : `<span class="emoji">${cat.icon}</span>`}`;
  }

  // ---------- data ----------
  async function getJSON(path, fallback) {
    try {
      const r = await fetch(path, { cache: "no-cache" });
      return r.ok ? await r.json() : fallback;
    } catch { return fallback; }
  }
  async function load() {
    const [events, venues, ads, news] = await Promise.all([
      getJSON("data/events.json", []),
      getJSON("data/venues.json", []),
      getJSON("data/ads.json", []),
      getJSON("data/news.json", { items: [] })
    ]);
    state.events = events;
    state.venues = Object.fromEntries(venues.map(v => [v.id, v]));
    state.ads = ads.filter(a => a.active !== false);
    state.news = news;
  }

  // ---------- ads ----------
  let adsenseLoaded = false;
  function adSlot(placement) {
    const A = C.ads;
    if (A.adsenseClient && A.slots[placement]) {
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
        const hay = [ev.title, ev.summary, v?.name, prov.th, prov.en, prov.zh, ...tx, ...vx, ...(ev.tags || [])].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
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
  function card(ev) {
    const st = status(ev), pr = priceLabel(ev.price), v = venueOf(ev), cat = CAT[ev.category];
    const saved = state.saved.has(ev.id);
    const time = tr(ev, "time"), races = tr(ev, "races"), reg = registration(ev);
    let place = venueName(v);
    if (state.filters.province === "all" && v?.province) place += ` · ${provName(v.province)}`;
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
            </div>
          </div>
          <div class="card-body">
            <h3>${esc(tr(ev, "title"))}</h3>
            <div class="meta">📅 <span>${esc(dateRange(ev))}${time ? ` · ${esc(time)}` : ""}</span></div>
            <div class="meta">📍 <span>${esc(place)}</span></div>
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

  function provinceSelect() {
    const f = state.filters;
    const counts = {};
    state.events.forEach(ev => { const p = provinceOf(ev); if (p && status(ev).key !== "ended") counts[p] = (counts[p] || 0) + 1; });
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

  function renderHome() {
    const f = state.filters;
    const opt = (val, label, cur) => `<option value="${val}" ${cur === val ? "selected" : ""}>${label}</option>`;
    const hasSample = state.events.some(e => e.sample);
    const upcoming = state.events.filter(e => status(e).key !== "ended" && inProvince(e));
    const live = upcoming.filter(e => status(e).key === "live").length;
    const free = upcoming.filter(isFree).length;
    const featured = upcoming.filter(e => e.featured).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const catTile = (id, icon, name, c1, c2) =>
      `<button class="cat ${f.cat === id ? "active" : ""}" data-cat="${id}" style="--c1:${c1};--c2:${c2}"><i>${icon}</i>${esc(name)}</button>`;
    app.innerHTML = `
      <section class="hero">
        <div class="blob"></div>
        <div class="eyebrow">${t("eyebrow")}</div>
        <h1>${esc(pick(C.tagline))}<br><span>${t("heroSub")}</span></h1>
        <p>${t("heroDesc")}</p>
        <div class="searchbox"><input class="search" id="q" type="search" placeholder="${esc(t("searchPh"))}" value="${esc(f.q)}"></div>
        <div class="hero-row">
          ${provinceSelect()}
        </div>
        <div class="stats">
          <button class="stat" data-quick="live"><b>${live}</b>${t("statLive")}</button>
          <button class="stat" data-quick="free"><b>${free}</b>${t("statFree")}</button>
          <button class="stat" data-quick="weekend"><b>${upcoming.filter(e => matchesWhen(e, "weekend")).length}</b>${t("statWeekend")}</button>
        </div>
      </section>
      ${hasSample ? `<p class="notice">${t("sampleNotice")}</p>` : ""}
      ${featured.length ? `
        <div class="section-head"><h2>${t("mustSee")}</h2><small>${t("swipe")}</small></div>
        <div class="rail" id="rail">${featured.map(card).join("")}</div>` : ""}
      ${adSlot("home_top")}
      <div class="section-head"><h2>${t("categories")}</h2></div>
      <div class="cats">
        ${catTile("all", "🌈", t("catAll"), "#ff7a45", "#7b2ff7")}
        ${C.categories.map(c => catTile(c.id, c.icon, catName(c), c.color, c.color2 || c.color)).join("")}
      </div>
      <div class="section-head"><h2>${t("allEvents")}${f.province !== "all" ? ` · ${esc(provName(f.province))}` : ""}</h2></div>
      <div class="filters">
        <select id="when" aria-label="${t("whenAll")}">
          ${opt("all", t("whenAll"), f.when)}${opt("today", t("whenToday"), f.when)}${opt("weekend", t("whenWeekend"), f.when)}${opt("week", t("whenWeek"), f.when)}${opt("month", t("whenMonth"), f.when)}
        </select>
        <select id="price" aria-label="${t("priceAll")}">
          ${opt("all", t("priceAll"), f.price)}${opt("free", t("priceFree"), f.price)}${opt("paid", t("pricePaid"), f.price)}
        </select>
        <select id="sort" aria-label="${t("sortSoon")}">
          ${opt("soon", t("sortSoon"), f.sort)}${opt("ending", t("sortEnding"), f.sort)}${opt("near", t("sortNear"), f.sort)}
        </select>
        <label class="toggle"><input type="checkbox" id="ended" ${f.showEnded ? "checked" : ""}> ${t("showEnded")}</label>
      </div>
      <div id="results"></div>`;
    renderResults();
    const rail = document.getElementById("rail");
    if (rail) bindSave(rail, renderHome);
    app.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => {
      const k = b.dataset.quick;
      if (k === "free") { f.price = "free"; f.when = "all"; }
      else if (k === "weekend") { f.when = "weekend"; f.price = "all"; }
      else { f.when = "today"; f.price = "all"; }
      renderHome();
      document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    document.getElementById("province").addEventListener("change", e => {
      f.province = e.target.value;
      writeLS("province", f.province);
      renderHome();
    });

    const q = document.getElementById("q");
    q.addEventListener("input", () => { f.q = q.value; renderResults(); });
    app.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => {
      f.cat = b.dataset.cat;
      app.querySelectorAll("[data-cat]").forEach(x => x.classList.toggle("active", x === b));
      renderResults();
    }));
    ["when", "price"].forEach(id => document.getElementById(id).addEventListener("change", e => { f[id] = e.target.value; renderResults(); }));
    document.getElementById("ended").addEventListener("change", e => { f.showEnded = e.target.checked; renderResults(); });
    document.getElementById("sort").addEventListener("change", e => {
      f.sort = e.target.value;
      if (f.sort === "near" && !state.pos) locate(renderResults); else renderResults();
    });
    activateAdsense();
  }

  function renderResults() {
    const list = filtered(), every = C.ads.inlineEvery || 6;
    const el = document.getElementById("results");
    if (!el) return;
    if (!list.length) { el.innerHTML = `<p class="empty">${t("noResults")}</p>`; return; }
    const parts = [];
    list.forEach((ev, i) => {
      parts.push(card(ev));
      if ((i + 1) % every === 0 && i < list.length - 1) parts.push(adSlot("list_inline"));
    });
    el.innerHTML = `<p class="result-count">${t("found", { n: list.length })}</p><div class="grid">${parts.join("")}</div>`;
    bindSave(el, renderResults);
    activateAdsense();
  }

  function bindSave(root, rerender) {
    root.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", e => {
      e.preventDefault();
      const id = b.dataset.save;
      state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
      writeLS("saved", [...state.saved]);
      rerender();
    }));
  }

  function locate(done) {
    if (!navigator.geolocation) { alert(t("geoUnsupported")); return; }
    navigator.geolocation.getCurrentPosition(
      p => { state.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; done(); },
      () => { alert(t("geoFailed")); done(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  // ---------- travel ----------
  const mapsDest = v => v.lat ? `${v.lat},${v.lng}` : `${v.name} ${v.address || ""}`;
  // mode = driving | transit | walking | bicycling, หรือ null = เปิดหมุดสถานที่
  const mapsWeb = (v, mode) => mode
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsDest(v))}&travelmode=${mode}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsDest(v))}`;
  // ลิงก์ที่เปิดแอพ Google Maps โดยตรง ถ้าไม่มีแอพจะเปิดเว็บ Google Maps แทน
  function mapsLink(v, mode) {
    const web = mapsWeb(v, mode);
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
  // ข้อความเดินทาง: คำแปลเก็บเป็น array ตามลำดับเดียวกับ transit ต้นฉบับ
  const transitText = (owner, key, i, tip) => owner?.i18n?.[state.lang]?.[key]?.[i] ?? tip.text;
  function recommendation(v) {
    if (!state.pos || !v.lat) return "";
    const km = distanceKm(state.pos, v), k = km.toFixed(1);
    const railIdx = (v.transit || []).findIndex(x => /BTS|MRT|ARL|SRT/i.test(x.type));
    let text;
    if (km < 1.2) text = t("recWalk", { km: k, min: Math.round(km * 13) });
    else if (km < 4) text = t("recTaxi", { km: k });
    else if (railIdx >= 0) text = t("recRail", { km: k, rail: transitText(v, "transit", railIdx, v.transit[railIdx]) });
    else text = `${t("recCar", { km: k })} ${v.parking ? t("recParking") : ""}`;
    return `<p class="recommend">💡 ${esc(text)}</p>`;
  }
  const TRANSIT_ICON = { BTS: "🚈", MRT: "🚇", ARL: "🚄", SRT: "🚆", BUS: "🚌", BOAT: "⛴️", WALK: "🚶", TAXI: "🚕", SHUTTLE: "🚐" };
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
        <h3 class="subhead">${t("noCar")}</h3>
        <ul class="travel-list">
          ${tips.length ? tips.map(x => `<li><span>${TRANSIT_ICON[x.type] || "➡️"}</span><span><b>${esc(label(x.type))}</b> ${esc(x.text)}</span></li>`).join("") : `<li><span>ℹ️</span><span>${t("noTransit")}</span></li>`}
        </ul>
        <h3 class="subhead">${t("byCar")}</h3>
        <ul class="travel-list">
          <li><span>🅿️</span><span>${esc(tr(v, "parking") || t("noParking"))}</span></li>
        </ul>
      </section>`;
  }

  // ---------- calendar ----------
  function gcalLink(ev, v) {
    const s = parseDate(ev.startDate), e = new Date(+parseDate(ev.endDate || ev.startDate) + DAY);
    const p = new URLSearchParams({ action: "TEMPLATE", text: tr(ev, "title"), dates: `${ymd(s)}/${ymd(e)}`, location: venueName(v), details: `${tr(ev, "summary") || ""}\n${location.href}` });
    return `https://calendar.google.com/calendar/render?${p}`;
  }
  function downloadIcs(ev, v) {
    const s = parseDate(ev.startDate), e = new Date(+parseDate(ev.endDate || ev.startDate) + DAY);
    const clean = x => String(x || "").replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IYouAlone//TH", "BEGIN:VEVENT",
      `UID:${ev.id}@iyoualone`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
      `DTSTART;VALUE=DATE:${ymd(s)}`, `DTEND;VALUE=DATE:${ymd(e)}`,
      `SUMMARY:${clean(tr(ev, "title"))}`, `LOCATION:${clean(venueName(v))}`, `DESCRIPTION:${clean(tr(ev, "summary"))}`,
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
    const title = tr(ev, "title"), details = tr(ev, "details") || tr(ev, "summary"), highlights = tr(ev, "highlights");
    const priceNote = ev.i18n?.[state.lang]?.priceNote ?? ev.price?.note;
    // แท็กเป็นคำค้นภาษาไทย: ภาษาอื่นแสดงเฉพาะเมื่อมีแท็กที่แปลไว้
    const tags = state.lang === "th" ? ev.tags : ev.i18n?.[state.lang]?.tags;
    const races = tr(ev, "races"), reg = registration(ev);
    const original = !["title", "details", "highlights"].every(k => isTranslated(ev, k));
    document.title = `${title} — ${C.siteName}`;
    const paragraphs = String(details || "").split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join("");
    const address = [tr(v, "address"), v?.province ? provName(v.province) : ""].filter(Boolean).join(" · ");
    app.innerHTML = `
      <a class="back" href="#/">${t("backList")}</a>
      <div class="detail">
        ${cover(ev, "cover detail-cover")}</div>
        <h1>${esc(title)}</h1>
        <div class="tags">
          ${cat ? `<span class="tag">${cat.icon} ${esc(catName(cat))}</span>` : ""}
          <span class="price ${pr.cls}">${pr.text}</span>
          <span class="status ${st.key}">${st.text}</span>
        </div>
        <div class="actions">
          ${ev.ticketUrl ? `<a class="btn primary" ${inAppLink(ev.ticketUrl)}>${isFree(ev) ? t("register") : t("buyTicket")}</a>` : ""}
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
            <section class="panel prose">
              <h2>${t("details")}</h2>
              ${original ? `<p class="disclosure" style="margin:0 0 10px">${t("originalThai")}</p>` : ""}
              ${paragraphs}
              ${highlights?.length ? `<h3 style="font-size:.95rem">${t("highlights")}</h3><ul>${highlights.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
              ${tags?.length ? `<div class="tags">${tags.map(x => `<span class="tag">#${esc(x)}</span>`).join("")}</div>` : ""}
              ${ev.sourceUrl ? `<p class="disclosure">${t("source")}: <a ${inAppLink(ev.sourceUrl)}>${esc(ev.sourceName || t("viewSource"))}</a> · ${t("sourceNote")}</p>` : ""}
            </section>
            ${ev.affiliateLinks?.length ? `
            <section class="panel affiliate">
              <h2>${t("deals")}</h2>
              <div class="aff-links">
                ${ev.affiliateLinks.map((a, i) => `<a class="btn" href="${safeUrl(a.url)}" target="_blank" rel="sponsored nofollow noopener"><span>${esc(ev.i18n?.[state.lang]?.affiliateLabels?.[i] ?? a.label)}</span><span>${esc(a.platform || "")} →</span></a>`).join("")}
              </div>
              <p class="disclosure">${esc(pick(C.affiliateDisclosure))}</p>
            </section>` : ""}
          </div>
          <div>
            ${travelPanel(ev, v)}
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
      const data = { title, text: `${title} · ${dateRange(ev)}`, url: location.href };
      if (navigator.share) { try { await navigator.share(data); } catch {} }
      else { try { await navigator.clipboard.writeText(location.href); alert(t("copied")); } catch {} }
    };
    const loc = document.getElementById("locBtn");
    if (loc) loc.onclick = () => locate(() => { document.getElementById("rec").innerHTML = recommendation(v) || ""; });
    activateAdsense();
  }

  function renderSaved() {
    const list = state.events.filter(e => state.saved.has(e.id)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    app.innerHTML = `<div class="page"><h1>${t("savedTitle")}</h1>
      ${list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<p class="empty">${t("savedEmpty")}</p>`}</div>`;
    bindSave(app, renderSaved);
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
        <div class="actions">${contact || `<span class="tag">${t("contactSetup")}</span>`}</div>
      </section>
      <section class="panel prose">
        <h2>${t("installTitle")}</h2>
        <p>${t("installDesc")}</p>
      </section></div>`;
  }

  // ---------- ตัวเลือกภาษา + ข้อความคงที่ใน index.html ----------
  function applyStaticText() {
    document.documentElement.lang = state.lang === "zh" ? "zh-CN" : state.lang;
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.getElementById("footerText").textContent = `© ${new Date().getFullYear()} ${C.siteName} · ${t("footer")}`;
    const sel = document.getElementById("langSel");
    sel.innerHTML = (C.languages || ["th"]).map(l => `<option value="${l}" ${l === state.lang ? "selected" : ""}>${window.I18N[l].langName}</option>`).join("");
  }
  document.getElementById("langSel").addEventListener("change", e => {
    state.lang = e.target.value;
    writeLS("lang", state.lang);
    applyStaticText();
    route();
  });

  // ---------- router ----------
  function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    const [, page, arg] = h.split("/");
    document.title = `${C.siteName} — ${t("siteTitle")}`;
    const nav = page === "event" ? "" : (page || "home");
    document.querySelectorAll("[data-nav]").forEach(a => a.classList.toggle("active", a.dataset.nav === nav));
    if (page === "event") renderDetail(decodeURIComponent(arg || ""));
    else if (page === "saved") renderSaved();
    else if (page === "news") renderNews();
    else if (page === "about") renderAbout();
    else renderHome();
    window.scrollTo(0, 0);
  }

  applyStaticText();
  window.addEventListener("hashchange", route);
  load().then(route);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
