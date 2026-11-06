(async () => {
  "use strict";
  const C = window.APP_CONFIG;
  const $ = id => document.getElementById(id);
  const form = $("f");
  const get = async p => { try { const r = await fetch(p, { cache: "no-cache" }); return r.ok ? r.json() : null; } catch { return null; } };
  const [events = [], venues = [], news] = await Promise.all([get("data/events.json"), get("data/venues.json"), get("data/news.json")]).then(r => [r[0] || [], r[1] || [], r[2]]);
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  $("cat").innerHTML = C.categories.map(c => `<option value="${c.id}">${c.icon} ${esc(c.name.th || c.name)}</option>`).join("");
  const LANGS = ["en", "zh"], TR_FIELDS = ["title", "summary", "details", "highlights"];
  ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].forEach((d, i) => $("weekdays").insertAdjacentHTML("beforeend",
    `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" name="wd" value="${i}" style="width:auto">${d}</label>`));
  $("venue").innerHTML = `<option value="">— ใช้สถานที่ที่บันทึกไว้ในงานนี้ —</option>` + venues.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join("");
  $("existing").innerHTML += events.map(e => `<option value="${esc(e.id)}">${esc(e.title)} (${e.startDate})</option>`).join("");

  function addAff(a = {}) {
    const row = document.createElement("div");
    row.className = "aff-row";
    row.innerHTML = `<input placeholder="ข้อความปุ่ม" value="${esc(a.label)}"><input placeholder="แพลตฟอร์ม" value="${esc(a.platform)}"><input type="url" placeholder="https://..." value="${esc(a.url)}"><button type="button" class="btn">✕</button>`;
    row.querySelector("button").onclick = () => row.remove();
    $("affRows").appendChild(row);
  }
  $("addAff").onclick = () => addAff();

  let current = {}; // งานที่กำลังแก้ — เก็บไว้เพื่อไม่ให้ข้อมูลที่ฟอร์มไม่มีช่อง (เช่น travelTips, venue) หาย
  function fill(ev) {
    current = ev;
    form.reset();
    $("affRows").innerHTML = "";
    const set = (n, v) => { if (form.elements[n] && v != null) form.elements[n].value = v; };
    form.elements.venueId.value = ev.venue && !ev.venueId ? "" : (ev.venueId || venues[0]?.id || "");
    ["id", "title", "category", "venueId", "startDate", "endDate", "time", "openDays", "summary", "details", "organizer", "ticketUrl", "image", "sourceUrl", "sourceName"].forEach(k => set(k, ev[k]));
    set("priceType", ev.price?.type); set("priceNote", ev.price?.note); set("priceMin", ev.price?.min); set("priceMax", ev.price?.max);
    set("highlights", (ev.highlights || []).join("\n"));
    set("tags", (ev.tags || []).join(", "));
    set("races", (ev.races || []).join(", "));
    set("registerBy", ev.registerBy);
    form.querySelectorAll('[name="wd"]').forEach(c => { c.checked = (ev.weekdays || []).includes(Number(c.value)); });
    form.elements.featured.checked = !!ev.featured;
    form.elements.ongoing.checked = !!ev.ongoing;
    for (const l of LANGS) for (const f of TR_FIELDS) {
      const val = ev.i18n?.[l]?.[f];
      set(`${f}_${l}`, Array.isArray(val) ? val.join("\n") : val);
    }
    (ev.affiliateLinks || []).forEach(addAff);
  }
  $("existing").onchange = e => { const ev = events.find(x => x.id === e.target.value); fill(ev || {}); };

  const items = news?.items || [];
  if (items.length) {
    $("newsPick").innerHTML = "";
    items.forEach(it => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "btn";
      b.innerHTML = `${it.draft ? "🤖 " : ""}${esc(it.title)}<br><small style="color:var(--muted)">${esc(it.source || "")}</small>`;
      b.onclick = () => {
        const d = it.draft || {};
        fill({ ...d, title: d.title || it.title, category: d.category || it.category, sourceUrl: it.link, sourceName: it.source, id: d.id || "" });
        window.scrollTo({ top: form.offsetTop - 60, behavior: "smooth" });
      };
      $("newsPick").appendChild(b);
    });
  }

  function build() {
    const fd = new FormData(form), v = k => (fd.get(k) || "").toString().trim();
    const num = k => v(k) ? Number(v(k)) : undefined;
    const ongoing = form.elements.ongoing.checked;
    const ev = {
      ...current, sample: undefined, // แก้ผ่านหน้านี้แล้วถือเป็นข้อมูลจริง
      id: v("id"), title: v("title"), category: v("category"),
      startDate: v("startDate"), endDate: ongoing ? undefined : (v("endDate") || v("startDate")),
      ongoing: ongoing || undefined, openDays: ongoing && v("openDays") ? v("openDays") : undefined,
      time: v("time") || undefined,
      venueId: v("venueId") || undefined, venue: v("venueId") ? undefined : current.venue,
      price: { type: v("priceType"), min: num("priceMin"), max: num("priceMax"), note: v("priceNote") || undefined },
      featured: form.elements.featured.checked || undefined,
      summary: v("summary") || undefined, details: v("details") || undefined,
      highlights: v("highlights") ? v("highlights").split("\n").map(s => s.trim()).filter(Boolean) : undefined,
      tags: v("tags") ? v("tags").split(",").map(s => s.trim()).filter(Boolean) : undefined,
      races: v("races") ? v("races").split(",").map(s => s.trim()).filter(Boolean) : undefined,
      registerBy: v("registerBy") || undefined,
      weekdays: (() => { const w = fd.getAll("wd").map(Number); return w.length && w.length < 7 ? w : undefined; })(),
      organizer: v("organizer") || undefined, ticketUrl: v("ticketUrl") || undefined, image: v("image") || undefined,
      sourceUrl: v("sourceUrl") || undefined, sourceName: v("sourceName") || undefined
    };
    const aff = [...$("affRows").children].map(r => { const [l, p, u] = r.querySelectorAll("input"); return { label: l.value.trim(), platform: p.value.trim() || undefined, url: u.value.trim() }; }).filter(a => a.label && a.url);
    ev.affiliateLinks = aff.length ? aff : undefined;
    // คำแปล: เก็บช่องที่ฟอร์มไม่มี (เช่น time, openDays ที่สคริปต์แปลให้) ไว้ แล้วทับด้วยค่าที่กรอก
    const i18n = JSON.parse(JSON.stringify(current.i18n || {}));
    for (const l of LANGS) {
      i18n[l] = i18n[l] || {};
      for (const f of TR_FIELDS) {
        const val = v(`${f}_${l}`);
        i18n[l][f] = !val ? undefined : f === "highlights" ? val.split("\n").map(s => s.trim()).filter(Boolean) : val;
      }
      if (!Object.values(i18n[l]).some(x => x !== undefined)) delete i18n[l];
    }
    ev.i18n = Object.keys(i18n).length ? i18n : undefined;
    return JSON.parse(JSON.stringify(ev)); // ตัดค่าที่ว่างออก
  }

  // ตรวจเงื่อนไขที่ HTML ตรวจเองไม่ได้
  function valid() {
    const s = form.elements.startDate, e = form.elements.endDate;
    e.setCustomValidity(e.value && e.value < s.value ? "วันสิ้นสุดต้องไม่อยู่ก่อนวันเริ่ม" : "");
    const r = form.elements.registerBy;
    r.setCustomValidity(r.value && s.value && r.value > (e.value || s.value) && !form.elements.ongoing.checked ? "วันปิดรับสมัครต้องไม่อยู่หลังวันจัดงาน" : "");
    const id = form.elements.id;
    id.setCustomValidity(/^[a-z0-9-]+$/i.test(id.value) ? "" : "ใช้ได้เฉพาะภาษาอังกฤษ ตัวเลข และ - เช่น motor-expo-2026");
    form.elements.venueId.setCustomValidity(!form.elements.venueId.value && !current.venue ? "กรุณาเลือกสถานที่" : "");
    const min = Number(form.elements.priceMin.value), max = Number(form.elements.priceMax.value);
    form.elements.priceMax.setCustomValidity(min && max && min > max ? "ราคาสูงสุดต้องไม่น้อยกว่าราคาต่ำสุด" : "");
    return form.reportValidity();
  }

  // พอผู้ใช้แก้ค่า ล้างคำเตือนเดิม ไม่งั้นฟอร์มจะถูกบล็อกค้าง
  form.addEventListener("input", () => ["startDate", "endDate", "id", "priceMax", "venueId", "registerBy"].forEach(n => form.elements[n].setCustomValidity("")));

  form.onsubmit = e => { e.preventDefault(); if (valid()) $("out").textContent = JSON.stringify(build(), null, 2); };
  $("copy").onclick = async () => {
    if (!valid()) return;
    $("out").textContent = JSON.stringify(build(), null, 2);
    try { await navigator.clipboard.writeText($("out").textContent); alert("คัดลอกแล้ว"); } catch { alert("คัดลอกไม่สำเร็จ ให้เลือกข้อความแล้วคัดลอกเอง"); }
  };
  $("dl").onclick = () => {
    if (!valid()) return;
    const ev = build();
    const all = events.filter(x => x.id !== ev.id && !x.sample).concat(ev).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: "application/json" }));
    a.download = "events.json";
    a.click();
    events.splice(0, events.length, ...all);
  };
})();
