// ระบบสมาชิก I You Alone (Supabase แพ็กเกจฟรี) — เปิดใช้เมื่อใส่ค่าใน APP_CONFIG.members (js/config.js)
// - เข้าระบบด้วยรหัส OTP 6 หลักทางอีเมล (ไม่ต้องตั้งรหัสผ่าน ใช้ได้ทั้งเว็บและแอพมือถือ)
// - บุคคลทั่วไป: เลือกความสนใจ/จังหวัด → แนะนำงานและที่เที่ยว, ซิงก์รายการบันทึก + ตั้งค่ารถ (คำนวณค่าเดินทาง) ข้ามเครื่อง
// - ธุรกิจ: เพิ่มร้าน (รูป 1–5 รูป + ปักหมุดบนแผนที่จริง) → รอ AI ตรวจรูปและตำแหน่ง (scripts/review-shops.mjs) ก่อนเผยแพร่
(() => {
  const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet";
  const BUCKET = "shop-photos";
  const M = window.IYA_MEMBER = { user: null, profile: null, ready: false };
  let X, sb = null;

  const cfg = () => X?.C.members || {};
  M.enabled = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);
  const loadScript = src => new Promise((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
  });
  const loadCss = href => { if (!document.querySelector(`link[href="${href}"]`)) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); } };
  async function client() {
    if (sb) return sb;
    await loadScript(SDK);
    sb = window.supabase.createClient(cfg().supabaseUrl, cfg().supabaseAnonKey, { auth: { persistSession: true, storageKey: "iya-auth", detectSessionInUrl: false } });
    return sb;
  }
  const t = (k, v) => X.t(k, v), esc = s => X.esc(s);
  const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };

  // ---------- เริ่มต้น: คืนสถานะเข้าระบบเดิม ----------
  M.init = async ctx => {
    X = ctx;
    paintNav();
    if (!M.enabled()) { M.ready = true; return; }
    try {
      const c = await client();
      const { data } = await c.auth.getSession();
      M.user = data.session?.user || null;
      if (M.user) await loadProfile();
      c.auth.onAuthStateChange(async (_e, s) => {
        const was = M.user?.id;
        M.user = s?.user || null;
        if (M.user && M.user.id !== was) await loadProfile();
        if (!M.user) M.profile = null;
        paintNav();
      });
    } catch (e) { console.warn("ระบบสมาชิกโหลดไม่ได้", e); }
    M.ready = true;
    paintNav();
  };
  M.paint = () => X && paintNav();
  function paintNav() {
    document.querySelectorAll("[data-member-label]").forEach(el => {
      el.textContent = M.profile?.display_name ? M.profile.display_name.slice(0, 12) : t(M.user ? "navAccount" : "navLogin");
    });
  }
  async function loadProfile() {
    const { data } = await sb.from("profiles").select("*").eq("id", M.user.id).maybeSingle();
    M.profile = data || null;
    if (M.profile) mergeLocal();
  }
  // รวมรายการบันทึกในเครื่องกับในบัญชี (ไม่ทิ้งของเดิมฝั่งใด)
  function mergeLocal() {
    const local = X.readLS("saved", []), merged = [...new Set([...(M.profile.saved || []), ...local])];
    X.state.saved = new Set(merged);
    X.writeLS("saved", merged);
    if (M.profile.car?.kmpl) X.writeLS("car", M.profile.car);
    if (merged.length !== (M.profile.saved || []).length) M.sync();
  }
  M.sync = debounce(async () => {
    if (!sb || !M.user || !M.profile) return;
    await sb.from("profiles").update({ saved: [...X.state.saved].slice(-500), car: X.readLS("car", {}), updated_at: new Date().toISOString() }).eq("id", M.user.id);
  }, 900);
  M.interests = () => M.profile?.interests || [];
  M.homeProvince = () => M.profile?.home_province || null;

  // ---------- หน้า "บัญชี" ----------
  M.render = async (app, arg = "") => {
    // ลิงก์ "เป็นเจ้าของที่นี่?" → new-shop?ref=<id สถานที่> (จำไว้เผื่อต้องเข้าระบบก่อน)
    const ref = (arg.match(/[?&]ref=([^&]+)/) || [])[1];
    if (ref) sessionStorage.setItem("iya-claim", decodeURIComponent(ref));
    arg = arg.split("?")[0];
    if (!M.enabled()) return renderSoon(app);
    if (!M.ready) { app.innerHTML = `<p class="loading">${t("loading")}</p>`; await waitReady(); }
    if (!M.user) return renderLogin(app);
    if (!M.profile || arg === "edit") return renderProfileForm(app);
    const claim = sessionStorage.getItem("iya-claim");
    if ((arg === "new-shop" || claim) && M.profile.account_type === "business") return renderShopForm(app, claim);
    if (claim && M.profile.account_type !== "business") return renderDashboard(app, t("claimNeedBusiness"));
    return renderDashboard(app);
  };
  const waitReady = () => new Promise(r => { const h = setInterval(() => { if (M.ready) { clearInterval(h); r(); } }, 100); });

  function renderSoon(app) {
    app.innerHTML = `<div class="page narrow">
      <h1 class="page-title">👤 ${t("memberTitle")}</h1>
      <p class="notice">${t("memberSoon")}</p>
      <section class="panel"><h2>🙋 ${t("memberPersonal")}</h2><ul class="feature-list">${t("memberPersonalList").split("|").map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>
      <section class="panel"><h2>🏪 ${t("memberBusiness")}</h2><ul class="feature-list">${t("memberBusinessList").split("|").map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>
    </div>`;
  }

  function renderLogin(app, sentTo) {
    app.innerHTML = `<div class="page narrow">
      <h1 class="page-title">👤 ${t("memberLogin")}</h1>
      <section class="panel member-form">
        ${sentTo ? `
          <p>${t("otpSent", { email: esc(sentTo) })}</p>
          <label>${t("otpCode")}<input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]*" placeholder="123456"></label>
          <button class="btn primary block" id="verify">${t("otpVerify")}</button>
          <button class="btn block ghost" id="back">${t("otpChange")}</button>`
        : `
          <p class="muted">${t("loginDesc")}</p>
          <label>${t("email")}<input id="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>
          <label class="check"><input type="checkbox" id="pdpa"> <span>${t("pdpaAgree")} <a href="privacy.html" target="_blank" rel="noopener">${t("privacyPolicy")}</a></span></label>
          <button class="btn primary block" id="send">${t("otpSend")}</button>`}
        <p class="form-msg" id="msg" role="status"></p>
      </section></div>`;
    const msg = s => { document.getElementById("msg").textContent = s || ""; };
    if (!sentTo) {
      document.getElementById("send").onclick = async () => {
        const email = document.getElementById("email").value.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg(t("emailInvalid"));
        if (!document.getElementById("pdpa").checked) return msg(t("pdpaRequired"));
        msg(t("loading"));
        const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
        if (error) return msg(`${t("errorTry")} (${error.message})`);
        sessionStorage.setItem("iya-pdpa", new Date().toISOString());
        renderLogin(app, email);
      };
    } else {
      document.getElementById("back").onclick = () => renderLogin(app);
      document.getElementById("verify").onclick = async () => {
        const token = document.getElementById("otp").value.trim();
        if (!/^\d{6,8}$/.test(token)) return msg(t("otpInvalid"));
        msg(t("loading"));
        const { data, error } = await sb.auth.verifyOtp({ email: sentTo, token, type: "email" });
        if (error) return msg(t("otpWrong"));
        M.user = data.user;
        await loadProfile();
        paintNav();
        M.render(app);
      };
    }
  }

  function renderProfileForm(app) {
    const p = M.profile || {}, picked = new Set(p.interests || []);
    const chips = [...X.C.categories.map(c => [c.id, c.icon, X.pick(c.name)]), ...X.C.placeCategories.map(c => ["p:" + c.id, c.icon, X.pick(c.name)])];
    app.innerHTML = `<div class="page narrow">
      <h1 class="page-title">👤 ${t(M.profile ? "profileEdit" : "profileSetup")}</h1>
      <section class="panel member-form">
        <fieldset class="acct-type"><legend>${t("accountType")}</legend>
          <label class="radio-card"><input type="radio" name="atype" value="personal" ${p.account_type !== "business" ? "checked" : ""}><b>🙋 ${t("memberPersonal")}</b><small>${t("personalDesc")}</small></label>
          <label class="radio-card"><input type="radio" name="atype" value="business" ${p.account_type === "business" ? "checked" : ""}><b>🏪 ${t("memberBusiness")}</b><small>${t("businessDesc")}</small></label>
        </fieldset>
        <label>${t("displayName")}<input id="dname" maxlength="60" value="${esc(p.display_name || "")}"></label>
        <label>${t("homeProvince")}<select id="hprov"><option value="">—</option>${window.PROVINCES.map(x => `<option value="${x.id}" ${p.home_province === x.id ? "selected" : ""}>${esc(X.provName(x.id))}</option>`).join("")}</select></label>
        <p class="label">${t("interests")}</p>
        <div class="chips wrap">${chips.map(([id, icon, name]) => `<button type="button" class="chip ${picked.has(id) ? "active" : ""}" data-int="${id}" aria-pressed="${picked.has(id)}"><i>${icon}</i>${esc(name)}</button>`).join("")}</div>
        <button class="btn primary block" id="saveProfile">${t("save")}</button>
        <p class="form-msg" id="msg" role="status"></p>
      </section></div>`;
    app.querySelectorAll("[data-int]").forEach(b => b.onclick = () => { const on = !b.classList.contains("active"); b.classList.toggle("active", on); b.setAttribute("aria-pressed", on); });
    document.getElementById("saveProfile").onclick = async () => {
      const row = {
        id: M.user.id,
        account_type: app.querySelector("[name=atype]:checked").value,
        display_name: document.getElementById("dname").value.trim().slice(0, 60) || null,
        home_province: document.getElementById("hprov").value || null,
        interests: [...app.querySelectorAll("[data-int].active")].map(b => b.dataset.int),
        saved: [...X.state.saved], car: X.readLS("car", {}),
        pdpa_consent_at: p.pdpa_consent_at || sessionStorage.getItem("iya-pdpa") || new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const { data, error } = await sb.from("profiles").upsert(row).select().single();
      if (error) { document.getElementById("msg").textContent = `${t("errorTry")} (${error.message})`; return; }
      M.profile = data; paintNav();
      location.hash = "#/account";
      M.render(app);
    };
  }

  const STATUS = { pending: ["⏳", "statusPending"], approved: ["✅", "statusApproved"], rejected: ["⛔", "statusRejected"], needs_fix: ["✏️", "statusNeedsFix"] };
  async function renderDashboard(app, notice) {
    const p = M.profile, biz = p.account_type === "business";
    app.innerHTML = `<div class="page narrow">
      ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
      <h1 class="page-title">👋 ${esc(p.display_name || M.user.email)}</h1>
      <p class="muted">${biz ? "🏪 " + t("memberBusiness") : "🙋 " + t("memberPersonal")} · ${esc(M.user.email)}</p>
      <div class="actions">
        <a class="btn" href="#/account/edit">✏️ ${t("profileEdit")}</a>
        <a class="btn" href="#/saved">❤️ ${t("navSaved")} (${X.state.saved.size})</a>
        <button class="btn ghost" id="logout">${t("logout")}</button>
      </div>
      ${biz ? `<section class="panel"><div class="section-head"><h2>🏪 ${t("myShops")}</h2><a class="btn primary" href="#/account/new-shop">＋ ${t("addShop")}</a></div><div id="shops"><p class="loading">${t("loading")}</p></div><p class="disclosure">${t("shopReviewNote")}</p></section>`
        : `<section class="panel"><h2>✨ ${t("forYou")}</h2><p class="muted">${t("forYouDesc")}</p><a class="btn primary" href="#/">${t("seeForYou")}</a></section>`}
      <p class="disclosure">${t("memberDataNote")}</p>
    </div>`;
    document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); M.user = null; M.profile = null; paintNav(); location.hash = "#/"; };
    if (!biz) return;
    const { data, error } = await sb.from("submissions").select("*").order("created_at", { ascending: false });
    const box = document.getElementById("shops");
    if (error) { box.innerHTML = `<p class="empty">${esc(error.message)}</p>`; return; }
    box.innerHTML = data.length ? data.map(s => {
      const [icon, key] = STATUS[s.status] || ["•", s.status];
      const reasons = s.ai_result?.reasons || [];
      return `<article class="shop-row">
        <img src="${esc(publicUrl(s.photos[0]))}" alt="" loading="lazy">
        <div><b>${esc(s.name)}</b><div class="meta">${icon} ${t(key)}${s.reviewed_at ? ` · ${new Date(s.reviewed_at).toLocaleDateString()}` : ""}</div>
        ${reasons.length ? `<ul class="ai-reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
        <button class="link-btn" data-del="${s.id}">${t("delete")}</button></div>
      </article>`;
    }).join("") : `<p class="empty">${t("noShops")}</p>`;
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
      if (!confirm(t("confirmDelete"))) return;
      await sb.from("submissions").delete().eq("id", b.dataset.del);
      renderDashboard(app);
    });
  }
  const publicUrl = path => `${cfg().supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;

  // ---------- ฟอร์มเพิ่มร้าน: รูปจริง + ปักหมุดบนแผนที่ OpenStreetMap ----------
  const KIND_OF = { cafe: "cafe", animalcafe: "animalcafe", restaurant: "restaurant" };
  async function renderShopForm(app, refId) {
    const ref = refId && X.state.places.find(x => x.id === refId);
    app.innerHTML = `<div class="page narrow">
      <a class="back" href="#/account">${t("back")}</a>
      <h1 class="page-title">🏪 ${t(ref ? "claimTitle" : "addShop")}</h1>
      ${ref ? `<p class="notice">${t("claimDesc", { name: esc(ref.name?.th || ref.name?.en || "") })}</p>` : ""}
      <section class="panel member-form">
        <label>${t("shopName")} *<input id="sname" maxlength="80" required></label>
        <label>${t("shopKind")} *<select id="skind">${["restaurant", "cafe", "animalcafe", "attraction"].map(k => `<option value="${k}">${t("kind_" + k)}</option>`).join("")}</select></label>
        <label>${t("shopDesc")}<textarea id="sdesc" maxlength="600" rows="3"></textarea></label>
        <p class="label">${t("shopPhotos")} * <small>${t("shopPhotosHint")}</small></p>
        <input id="sphotos" type="file" accept="image/jpeg,image/png,image/webp" multiple>
        <div class="photo-preview" id="preview"></div>
        <p class="label">${t("shopPin")} * <small>${t("shopPinHint")}</small></p>
        <div class="actions"><button type="button" class="btn" id="here">${t("pinHere")}</button></div>
        <div id="map" class="pin-map"></div>
        <p class="muted" id="where"></p>
        <label>${t("address")}<input id="saddr" maxlength="200"></label>
        <div class="two-col">
          <label>${t("priceMenuMin")}<input id="pmin" type="number" inputmode="numeric" min="0" max="100000"></label>
          <label>${t("priceMenuMax")}<input id="pmax" type="number" inputmode="numeric" min="0" max="100000"></label>
        </div>
        <label>${t("entryFee")}<input id="pentry" type="number" inputmode="numeric" min="0" max="100000"></label>
        <label>${t("hours")}<input id="shours" maxlength="120" placeholder="จ.-ศ. 09:00-18:00"></label>
        <label>${t("phone")}<input id="sphone" maxlength="30" inputmode="tel"></label>
        <label>${t("website")}<input id="sweb" maxlength="200" inputmode="url" placeholder="https://"></label>
        <label class="check"><input type="checkbox" id="sown"> <span>${t("shopOwnerConfirm")}</span></label>
        <button class="btn primary block" id="submitShop">${t("submitShop")}</button>
        <p class="form-msg" id="msg" role="status"></p>
      </section></div>`;
    const msg = s => { document.getElementById("msg").textContent = s || ""; };
    const num = id => { const v = document.getElementById(id).value; return v === "" ? null : Math.max(0, Math.round(+v)); };
    // แผนที่ (Leaflet + แผนที่ OpenStreetMap ฟรี) — ลากหมุดให้ตรงหน้าร้าน
    loadCss(LEAFLET + ".css");
    await loadScript(LEAFLET + ".js");
    if (ref) {
      document.getElementById("sname").value = ref.name?.th || ref.name?.en || "";
      document.getElementById("skind").value = KIND_OF[ref.kind] || "attraction";
      if (ref.hours) document.getElementById("shours").value = ref.hours;
      if (ref.phone) document.getElementById("sphone").value = ref.phone;
      if (/^https?:/.test(ref.website || "")) document.getElementById("sweb").value = ref.website;
      if (ref.address) document.getElementById("saddr").value = ref.address;
    }
    const start = ref || X.state.pos || { lat: 13.7563, lng: 100.5018 };
    const map = L.map("map").setView([start.lat, start.lng], ref || X.state.pos ? 17 : 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
    let pin = null;
    const where = async ll => {
      document.getElementById("where").textContent = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${ll.lat}&lon=${ll.lng}&accept-language=th`);
        const j = await r.json();
        document.getElementById("where").textContent = `📍 ${j.display_name || ""}`;
        const a = document.getElementById("saddr"); if (!a.value) a.value = (j.display_name || "").split(",").slice(0, 3).join(",");
      } catch {}
    };
    const place = ll => { if (pin) pin.setLatLng(ll); else { pin = L.marker(ll, { draggable: true }).addTo(map); pin.on("dragend", () => where(pin.getLatLng())); } where(ll); };
    map.on("click", e => place(e.latlng));
    if (ref) place(L.latLng(ref.lat, ref.lng));
    document.getElementById("here").onclick = () => X.locate(() => { if (X.state.pos) { map.setView([X.state.pos.lat, X.state.pos.lng], 18); place(X.state.pos); } });
    // ย่อรูปก่อนอัปโหลด (ด้านยาวไม่เกิน 1600px, JPEG) ประหยัดพื้นที่ฟรี
    let files = [];
    document.getElementById("sphotos").onchange = async e => {
      files = [...e.target.files].slice(0, 5);
      document.getElementById("preview").innerHTML = files.map(f => `<img src="${URL.createObjectURL(f)}" alt="">`).join("");
    };
    document.getElementById("submitShop").onclick = async () => {
      const name = document.getElementById("sname").value.trim();
      if (name.length < 2) return msg(t("shopNameRequired"));
      if (!files.length) return msg(t("shopPhotoRequired"));
      if (!pin) return msg(t("shopPinRequired"));
      if (!document.getElementById("sown").checked) return msg(t("shopOwnerRequired"));
      const ll = pin.getLatLng();
      if (ll.lat < 5.5 || ll.lat > 20.6 || ll.lng < 97.3 || ll.lng > 105.7) return msg(t("shopOutside"));
      msg(t("uploading"));
      const btn = document.getElementById("submitShop"); btn.disabled = true;
      try {
        const paths = [];
        for (const [i, f] of files.entries()) {
          const blob = await shrink(f);
          const path = `${M.user.id}/${Date.now()}-${i}.jpg`;
          const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (error) throw error;
          paths.push(path);
        }
        const web = document.getElementById("sweb").value.trim();
        const { error } = await sb.from("submissions").insert({
          kind: document.getElementById("skind").value, name, description: document.getElementById("sdesc").value.trim() || null,
          lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6), address: document.getElementById("saddr").value.trim() || null,
          hours: document.getElementById("shours").value.trim() || null, phone: document.getElementById("sphone").value.trim() || null,
          website: /^https?:\/\//.test(web) ? web : null, photos: paths,
          price_min: num("pmin"), price_max: num("pmax"), entry_fee: num("pentry"),
          ...(ref ? { ref_place: ref.id } : {})
        });
        if (error) throw error;
        sessionStorage.removeItem("iya-claim");
        location.hash = "#/account";
      } catch (e) { msg(`${t("errorTry")} (${e.message})`); btn.disabled = false; }
    };
  }
  function shrink(file) {
    return new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? ok(b) : fail(new Error("resize")), "image/jpeg", .85);
      };
      img.onerror = () => fail(new Error(t("shopPhotoBad")));
      img.src = URL.createObjectURL(file);
    });
  }
})();
