/* بوابة القاعة — الكشف الحيّ اللي تحت الماسح.

   الماسح نفسه مش هنا: بيتعلّق من site.js على [data-checkin-page]، ودي
   نفس البنية المستخدمة في شاشة الاستقبال في لوحة التحكم. الملف ده
   مسؤول عن حاجة واحدة: إن الكشف اللي على الباب يفضل صحيح — بيتحدّث
   لوحده، وبيقبل تسجيل يدوي لما الـQR يعاند.

   الباب ممكن يكون عليه أكتر من تليفون فاتحين نفس الرابط، فالسيرفر هو
   مصدر الحقيقة الوحيد: كل تحديث بيعيد بناء الكشف من الرد، مش بيعدّل
   الصفوف محلياً وبيفترض إن الباقي زيها.
*/
(function () {
  "use strict";

  var doc = document;
  var root = doc.querySelector("[data-venue]");
  if (!root) return;

  var stateUrl = root.getAttribute("data-state-url");
  var markUrl = root.getAttribute("data-mark-url");
  var rowsHost = root.querySelector("[data-venue-rows]");
  var noneEl = root.querySelector("[data-venue-none]");
  var searchEl = root.querySelector("[data-venue-search]");
  var tabs = Array.prototype.slice.call(root.querySelectorAll("[data-venue-filter]"));
  var logEl = root.querySelector("[data-scan-log]");

  var rows = [];
  var filter = "all";
  var query = "";
  var busy = false;

  /* -------------------------------------------------- أدوات صغيّرة */
  function csrf() {
    var m = doc.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  function setText(sel, value) {
    var el = root.querySelector(sel);
    if (el && value != null) el.textContent = value;
  }

  function norm(t) {
    return String(t || "").trim().toLowerCase();
  }

  /* -------------------------------------------------- رسم الكشف */
  function matches(row) {
    if (filter === "in" && !row.checked_in) return false;
    if (filter === "out" && row.checked_in) return false;
    if (!query) return true;
    return norm(row.name).indexOf(query) > -1 ||
           norm(row.code).indexOf(query) > -1 ||
           norm(row.group).indexOf(query) > -1;
  }

  function button(id, action, label, cls) {
    var b = doc.createElement("button");
    b.type = "button";
    b.className = "btn " + cls + " btn--sm";
    b.textContent = label;
    b.setAttribute("data-venue-mark", id);
    b.setAttribute("data-action", action);
    return b;
  }

  function draw() {
    if (!rowsHost) return;
    var shown = rows.filter(matches);
    rowsHost.replaceChildren();

    shown.forEach(function (row) {
      var card = doc.createElement("article");
      card.className = "venue-row" + (row.checked_in ? " is-in" : "");

      var main = doc.createElement("div");
      main.className = "venue-row-main";
      var name = doc.createElement("strong");
      name.textContent = row.name;
      var meta = doc.createElement("span");
      meta.className = "venue-row-meta";
      var code = doc.createElement("code");
      code.textContent = row.code || "";
      meta.appendChild(code);
      if (row.group) meta.appendChild(doc.createTextNode(" · " + row.group));
      main.appendChild(name);
      main.appendChild(meta);

      var count = doc.createElement("div");
      count.className = "venue-row-count";
      count.textContent = row.used + " / " + row.allowed;

      var state = doc.createElement("div");
      state.className = "venue-row-state";
      var badge = doc.createElement("span");
      badge.className = "venue-badge" + (row.checked_in ? " venue-badge--in" : "");
      badge.textContent = row.checked_in ? ("دخل " + (row.at || "")) : "لسه";
      state.appendChild(badge);

      var actions = doc.createElement("div");
      actions.className = "venue-row-actions";
      // التصريح اللي خلص مالوش زر دخول — الزرار اللي بيرفض الضغط
      // أحسن من زرار بيشتغل وبيرجّع خطأ كل مرة
      if (row.left > 0) actions.appendChild(button(row.id, "in", "دخول", "btn--gold"));
      if (row.used > 0) actions.appendChild(button(row.id, "undo", "تراجع", "btn--ghost"));

      card.appendChild(main);
      card.appendChild(count);
      card.appendChild(state);
      card.appendChild(actions);
      rowsHost.appendChild(card);
    });

    if (noneEl) noneEl.hidden = shown.length > 0 || rows.length === 0;
  }

  function apply(data) {
    if (!data || !data.ok) return;
    if (Array.isArray(data.rows)) rows = data.rows;
    var s = data.stats || {};
    setText("[data-venue-arrived]", s.arrived);
    setText("[data-venue-waiting]", s.waiting);
    setText("[data-venue-guests]", s.guests);
    setText("[data-venue-used]", s.used);
    setText("[data-venue-allowed]", s.allowed);
    setText("[data-arrived]", s.used);
    setText("[data-total]", s.allowed);
    draw();
  }

  /* -------------------------------------------------- الشبكة */
  function refresh() {
    if (doc.hidden) return;            // تليفون في الجيب مايستهلكش داتا
    fetch(stateUrl, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin"
    })
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function () {});
  }

  function mark(id, action) {
    if (busy) return;
    busy = true;
    var body = new FormData();
    body.append("guest", id);
    body.append("action", action);
    fetch(markUrl, {
      method: "POST",
      headers: { "X-CSRFToken": csrf(), "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin",
      body: body
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        busy = false;
        apply(d);
        if (d && d.error) flash(d.error, "bad");
        else if (d && d.guest) {
          flash(action === "undo"
            ? "↩ اترجع تسجيل " + d.guest.name
            : "✓ " + d.guest.name + " — " + d.guest.used + " من " + d.guest.allowed,
            action === "undo" ? "warn" : "ok");
        }
      })
      .catch(function () { busy = false; flash("تعذّر الاتصال بالخادم", "bad"); });
  }

  /* نفس صندوق نتيجة المسح — القاعة بتبص في مكان واحد مش اتنين */
  function flash(text, kind) {
    var box = root.querySelector("[data-scan-result]");
    if (!box) return;
    box.className = "checkin-result is-" + (kind || "ok");
    box.replaceChildren();
    var h = doc.createElement("strong");
    h.textContent = text;
    box.appendChild(h);
  }

  /* -------------------------------------------------- الربط */
  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-venue-mark]");
    if (!btn) return;
    mark(btn.getAttribute("data-venue-mark"), btn.getAttribute("data-action") || "in");
  });

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      query = norm(searchEl.value);
      draw();
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      filter = tab.getAttribute("data-venue-filter") || "all";
      tabs.forEach(function (t) { t.classList.toggle("is-on", t === tab); });
      draw();
    });
  });

  /* المسحة الناجحة بتضيف سطر في سجل الماسح. بدل ما نلزق نفسنا جوه
     كود الماسح، بنسمع على السجل: أول ما يتغيّر، نجيب الكشف من جديد. */
  if (logEl && "MutationObserver" in window) {
    new MutationObserver(function () { refresh(); })
      .observe(logEl, { childList: true });
  }

  doc.addEventListener("visibilitychange", function () {
    if (!doc.hidden) refresh();
  });

  refresh();
  setInterval(refresh, 8000);
})();
