// ข้อมูลจาก Google Maps (Places API (New) ทางการ) ในหน้ารายละเอียดสถานที่
// - ดึงสดเฉพาะเมื่อผู้ใช้กดปุ่ม (ประหยัดโควต้าฟรี) · ไม่เก็บเนื้อหาลงข้อมูลของแอพ (ตามเงื่อนไข Google)
// - จำเฉพาะ place_id ในเครื่อง (เงื่อนไข Google อนุญาตให้เก็บ place_id ได้) และผลในหน่วยความจำระหว่างเปิดแอพ
// - ขั้นหา place_id ใช้ Text Search แบบ "IDs only" (ไม่มีค่าใช้จ่าย) · ขั้นรายละเอียดใช้โควต้าฟรีรายเดือน
// - ต้องแสดงที่มา "Google Maps" + ชื่อผู้รีวิว (ตามนโยบายการแสดงผลของ Google)
(function () {
  const API = "https://places.googleapis.com/v1";
  const mem = new Map();
  const ids = (() => { try { return JSON.parse(localStorage.getItem("iya-gpid") || "{}"); } catch { return {}; } })();
  const saveIds = () => { try { localStorage.setItem("iya-gpid", JSON.stringify(ids)); } catch {} };
  let X = null; // { C, t, esc, lang, inAppLink }

  const enabled = () => !!X?.C?.googlePlaces?.apiKey;
  const headers = mask => ({ "Content-Type": "application/json", "X-Goog-Api-Key": X.C.googlePlaces.apiKey, "X-Goog-FieldMask": mask });
  const lang = () => ({ th: "th", en: "en", zh: "zh-CN" }[X.lang()] || "th");

  // ชื่อที่พบตรงกับชื่อสถานที่ของเราไหม (กันได้ร้านผิด)
  const norm = s => String(s || "").toLowerCase().replace(/คาเฟ่|ร้านกาแฟ|ร้าน|\b(cafe|café|coffee|shop|the|and|restaurant)\b/g, "").replace(/[^ก-๙a-z0-9]/g, "");
  const similar = (a, b) => { const x = norm(a), y = norm(b); return x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)); };

  async function findId(p) {
    if (ids[p.id]) return ids[p.id];
    const names = [p.name?.th, p.name?.en].filter(Boolean);
    const body = {
      textQuery: `${names[0]} ${p.district || ""} ${X.provName(p.province)}`.replace(/\s+/g, " ").trim(),
      languageCode: lang(), regionCode: "TH", pageSize: 3,
      ...(p.lat ? { locationBias: { circle: { center: { latitude: +p.lat, longitude: +p.lng }, radius: p.approx ? 5000 : 800 } } } : {})
    };
    const r = await fetch(`${API}/places:searchText`, { method: "POST", headers: headers("places.id,places.displayName"), body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`search ${r.status}`);
    const list = (await r.json()).places || [];
    const hit = list.find(x => names.some(n => similar(n, x.displayName?.text))) || null;
    if (!hit) return null;
    ids[p.id] = hit.id; saveIds();
    return hit.id;
  }

  async function details(id) {
    const mask = "id,displayName,rating,userRatingCount,googleMapsUri,regularOpeningHours.weekdayDescriptions,regularOpeningHours.openNow,editorialSummary,reviews,priceRange";
    const r = await fetch(`${API}/places/${encodeURIComponent(id)}?languageCode=${lang()}`, { headers: headers(mask) });
    if (!r.ok) throw new Error(`details ${r.status}`);
    return r.json();
  }

  const stars = n => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));
  function view(g) {
    const { t, esc, inAppLink } = X;
    const price = g.priceRange?.startPrice?.units ? `฿${Number(g.priceRange.startPrice.units).toLocaleString()}${g.priceRange.endPrice?.units ? `–${Number(g.priceRange.endPrice.units).toLocaleString()}` : "+"}` : "";
    return `
      <div class="g-head">
        ${g.rating ? `<div class="g-rating"><b>${g.rating.toFixed(1)}</b><span class="g-stars" aria-hidden="true">${stars(g.rating)}</span><small>${t("gReviewsCount", { n: (g.userRatingCount || 0).toLocaleString() })}</small></div>` : `<p class="muted">${t("gNoRating")}</p>`}
        ${price ? `<span class="g-price">💰 ${esc(price)}</span>` : ""}
      </div>
      ${g.editorialSummary?.text ? `<p class="g-sum">${esc(g.editorialSummary.text)}</p>` : ""}
      ${g.regularOpeningHours?.weekdayDescriptions?.length ? `<details class="g-hours"><summary>🕒 ${t("gHours")}${g.regularOpeningHours.openNow != null ? ` · <b class="${g.regularOpeningHours.openNow ? "open-now" : "closed-now"}">${t(g.regularOpeningHours.openNow ? "openNowShort" : "closedNow")}</b>` : ""}</summary><ul>${g.regularOpeningHours.weekdayDescriptions.map(d => `<li>${esc(d)}</li>`).join("")}</ul></details>` : ""}
      ${(g.reviews || []).slice(0, 5).map(rv => `
        <div class="g-review">
          <div class="g-rv-head">${rv.authorAttribution?.uri ? `<a ${inAppLink(rv.authorAttribution.uri)}>${esc(rv.authorAttribution.displayName || "")}</a>` : `<b>${esc(rv.authorAttribution?.displayName || "")}</b>`}
            <span class="g-stars small">${stars(rv.rating || 0)}</span><small>${esc(rv.relativePublishTimeDescription || "")}</small></div>
          <p>${esc((rv.text?.text || rv.originalText?.text || "").slice(0, 400))}</p>
        </div>`).join("")}
      <p class="g-attr">${g.googleMapsUri ? `<a ${inAppLink(g.googleMapsUri)}>${t("gOpenInMaps")}</a> · ` : ""}<span>${t("gSource")}</span></p>`;
  }

  window.IYA_GOOGLE = {
    init(ctx) { X = ctx; },
    enabled,
    // กล่องในหน้ารายละเอียด (ปุ่ม → ดึงข้อมูล)
    block(p) {
      if (!enabled()) return "";
      const cached = mem.get(p.id);
      return `<section class="panel g-box" id="gBox" data-pid="${X.esc(p.id)}">
        <div class="rv-head"><h2>⭐ ${X.t("gTitle")}</h2><small>Google Maps</small></div>
        <div id="gBody">${cached ? view(cached) : `<button type="button" class="btn" id="gLoad">⭐ ${X.t("gLoad")}</button><p class="muted small">${X.t("gLoadNote")}</p>`}</div>
      </section>`;
    },
    bind(p) {
      const btn = document.getElementById("gLoad");
      if (!btn) return;
      btn.addEventListener("click", async () => {
        const body = document.getElementById("gBody");
        body.innerHTML = `<p class="muted">${X.t("loading")}</p>`;
        try {
          const id = await findId(p);
          if (!id) { body.innerHTML = `<p class="muted">${X.t("gNotFound")}</p>`; return; }
          const g = await details(id);
          mem.set(p.id, g);
          body.innerHTML = view(g);
        } catch (e) {
          console.warn("Google Places:", e.message);
          body.innerHTML = `<p class="muted">${X.t(/429/.test(e.message) ? "gQuota" : "gError")}</p>`;
        }
      });
    }
  };
})();
