/* فرحة — سكربت الموقع ولوحة التحكم (ملف ستاتيك مستقل عن قوالب Django) */
(function () {
  "use strict";
  var doc = document;

  /* ------------------------------------------------ الوضع الداكن */
  var KEY = "leila-theme";
  function apply(theme) {
    doc.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch (e) {}
  }
  var saved;
  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }
  if (saved) {
    apply(saved);
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    apply("dark");
  }

  /* الصور اللي بتتبدّل مع الثيم (اللوجو وصورة الهيرو) متحطوطة كـbackground-image.
     ساعة التبديل المتصفح بيشيل القديمة فوراً ويستنى الجديدة تنزل من الشبكة —
     قياس على الموقع المباشر: 466ms للوجو و471ms للهيرو، والمكان بيفضل فاضي
     طول المدة دي. الحل إننا نسخّن نسخة الثيم التاني في الكاش وقت الفراغ،
     فالضغطة تلاقيها جاهزة والتبديل يبقى فوري.

     بنقرا الروابط من الـCSS نفسه بدل ما نكتبها هنا، فلو اتغيّر اسم أو مسار
     صورة الكود ده مايبقاش محتاج تعديل. */
  var warmed = {};
  /* الروابط جوّه ‎custom property‎ زي ‎--hero-img‎ بترجع من ‎getComputedStyle‎
     زي ما هي مكتوبة (‎../images/x.webp‎) — نسبةً لملف الـCSS مش للصفحة.
     لازم نحلّها على مسار الاستايل شيت وإلا نسخّن رابط 404. */
  function styleBase() {
    var sheets = doc.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var href = sheets[i].href;
      if (href && href.indexOf("site.css") !== -1) return href;
    }
    return location.href;
  }
  function absolute(url) {
    try { return new URL(url, styleBase()).href; } catch (e) { return ""; }
  }
  function themeImageUrls(theme) {
    var urls = [];
    var picks = [
      [doc.querySelector(".brand"), "background-image"],
      [doc.querySelector(".brand--stacked"), "background-image"],
      [doc.querySelector(".hero-art"), "--hero-img"]
    ];
    picks.forEach(function (pair) {
      var el = pair[0];
      if (!el) return;
      var raw = pair[1] === "--hero-img"
        ? getComputedStyle(el).getPropertyValue("--hero-img")
        : getComputedStyle(el).backgroundImage;
      var m = /url\(\s*["']?(.*?)["']?\s*\)/.exec(raw || "");
      if (!m || !m[1]) return;
      var swapped = theme === "dark"
        ? m[1].replace(/-light(\.[a-z0-9]+)(\?|$)/i, "-dark$1$2")
        : m[1].replace(/-dark(\.[a-z0-9]+)(\?|$)/i, "-light$1$2");
      if (swapped === m[1]) return;
      var full = absolute(swapped);
      if (full) urls.push(full);
    });
    return urls;
  }
  function warmTheme(theme) {
    themeImageUrls(theme).forEach(function (url) {
      if (warmed[url]) return;
      warmed[url] = true;
      var img = new Image();
      img.decoding = "async";
      img.src = url;
    });
  }
  /* صورة الهيرو ليها نسخة لكل لغة (‎home-arabic-*‎ / ‎home-english-*‎).
     تبديل اللغة بيعمل POST وبيرجّع الصفحة من جديد، فالصورة الجديدة
     بتنزل من الشبكة وقتها. تسخينها وقت الفراغ بيخلي الوش جاهز أول
     ما الصفحة ترجع بدل ما يفضل فاضي وهي بتنزل. */
  function warmOtherLanguage() {
    var art = doc.querySelector(".hero-art");
    if (!art) return;
    var raw = getComputedStyle(art).getPropertyValue("--hero-img");
    var m = /url\(\s*["']?(.*?)["']?\s*\)/.exec(raw || "");
    if (!m || !m[1]) return;
    var swapped = m[1].indexOf("-arabic-") !== -1
      ? m[1].replace("-arabic-", "-english-")
      : m[1].replace("-english-", "-arabic-");
    if (swapped === m[1]) return;
    var url = absolute(swapped);
    if (!url || warmed[url]) return;
    warmed[url] = true;
    var img = new Image();
    img.decoding = "async";
    img.src = url;
  }
  function warmOther() {
    var current = doc.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    warmTheme(current === "dark" ? "light" : "dark");
    warmOtherLanguage();
  }
  /* بعد ما الصفحة تخلص تحميل عشان مانزاحمش موارد أول رسم */
  function scheduleWarm() {
    if (window.requestIdleCallback) window.requestIdleCallback(warmOther, { timeout: 3000 });
    else setTimeout(warmOther, 1200);
  }
  if (doc.readyState === "complete") scheduleWarm();
  else window.addEventListener("load", scheduleWarm, { once: true });

  /* لو المستخدم قرّب من الزرار قبل ما الفراغ ييجي، نسخّن على طول */
  doc.addEventListener("pointerenter", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("[data-theme-toggle]")) warmOther();
  }, true);

  doc.addEventListener("click", function (e) {
    if (!e.target.closest("[data-theme-toggle]")) return;
    var now = doc.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    apply(now);
    /* دلوقتي «التاني» بقى العكس — سخّنه للضغطة الجاية */
    warmOther();
  });

  /* ------------------------------------------------ إجراءات القوالب */
  var actionMenus = Array.prototype.slice.call(doc.querySelectorAll("[data-template-actions]"));
  function closeActionMenus(except) {
    actionMenus.forEach(function (wrap) {
      if (wrap === except) return;
      var trigger = wrap.querySelector("[data-template-actions-toggle]");
      var panel = wrap.querySelector("[data-template-actions-panel]");
      if (trigger) trigger.setAttribute("aria-expanded", "false");
      if (panel) panel.hidden = true;
    });
  }
  actionMenus.forEach(function (wrap) {
    var trigger = wrap.querySelector("[data-template-actions-toggle]");
    var panel = wrap.querySelector("[data-template-actions-panel]");
    if (!trigger || !panel) return;
    trigger.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var open = trigger.getAttribute("aria-expanded") === "true";
      closeActionMenus(wrap);
      trigger.setAttribute("aria-expanded", open ? "false" : "true");
      panel.hidden = open;
    });
    panel.addEventListener("click", function (e) {
      e.stopPropagation();
      if (e.target.closest("a")) {
        closeActionMenus();
      }
    });
  });
  doc.addEventListener("click", function () { closeActionMenus(); });
  doc.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeActionMenus();
  });

  /* ------------------------------------------------ الترويسة العائمة */
  var nav = doc.getElementById("site-nav");
  var burger = doc.getElementById("nav-burger");
  var menu = doc.getElementById("nav-menu");
  var scrim = doc.getElementById("nav-scrim");

  if (nav) {
    var ticking = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        nav.classList.toggle("is-stuck", window.scrollY > 12);
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    /* ---- تحديد القسم الحالي فقط (scroll-spy) ----
       بيراقب الأقسام اللي ليها روابط في الشريط، وينوّر واحد بس:
       أقرب قسم لأعلى الشاشة تحت الترويسة. */
    var spyLinks = Array.prototype.slice.call(nav.querySelectorAll(".nav-links a[data-spy]"));
    var onHome = spyLinks.length > 0 && doc.querySelector("#" + spyLinks[0].dataset.spy);

    if (onHome) {
      var sections = spyLinks
        .map(function (a) { return doc.getElementById(a.dataset.spy); })
        .filter(Boolean);

      var setActive = function (id) {
        spyLinks.forEach(function (a) {
          a.classList.toggle("is-active", a.dataset.spy === id);
        });
      };

      var spyTick = false;
      var spy = function () {
        if (spyTick) return;
        spyTick = true;
        window.requestAnimationFrame(function () {
          spyTick = false;
          var line = (nav.offsetHeight || 90) + 40;   /* خط القياس تحت الترويسة */
          var current = null;

          /* آخر قسم بدايته فوق خط القياس */
          for (var i = 0; i < sections.length; i++) {
            if (sections[i].getBoundingClientRect().top <= line) current = sections[i].id;
          }
          /* لو وصلنا آخر الصفحة، نوّر آخر قسم */
          if (window.innerHeight + window.scrollY >= doc.body.offsetHeight - 4) {
            current = sections[sections.length - 1].id;
          }
          setActive(current);
        });
      };
      window.addEventListener("scroll", spy, { passive: true });
      window.addEventListener("resize", spy);
      spy();
    } else if (!nav.querySelector(".nav-links a.is-active")) {
      /* صفحات تانية: نوّر الرابط اللي مساره مطابق.
         بس لو السيرفر محددش واحد أصلاً — لوحة التحكم بتحدده بمتغيّر nav،
         ولو زوّدنا فوقه هيتلوّن اتنين مع بعض لأن /dashboard/ بادئة لكل
         مسارات اللوحة. */
      var here = location.pathname;
      var best = null, bestLen = 0;
      Array.prototype.forEach.call(nav.querySelectorAll(".nav-links a"), function (a) {
        var path = (a.getAttribute("href") || "").split("#")[0];
        if (path && path !== "/" && here.indexOf(path) === 0 && path.length > bestLen) {
          best = a; bestLen = path.length;      /* أطول مسار مطابق هو الأدق */
        }
      });
      if (best) best.classList.add("is-active");
    }
  }

  if (burger && menu) {
    var setMenu = function (open) {
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "إغلاق القائمة" : "فتح القائمة");
      menu.classList.toggle("is-open", open);
      if (scrim) scrim.hidden = !open;
    };
    burger.addEventListener("click", function () {
      setMenu(burger.getAttribute("aria-expanded") !== "true");
    });
    if (scrim) scrim.addEventListener("click", function () { setMenu(false); });
    menu.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && burger.getAttribute("aria-expanded") === "true") {
        setMenu(false);
        burger.focus();
      }
    });
    /* لو المستخدم كبّر الشاشة والقائمة مفتوحة */
    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) setMenu(false);
    });
  }

  /* ------------------------------------------------ ماسح الدخول */
  var scanPage = doc.querySelector("[data-checkin-page]");
  if (scanPage) initScanner(scanPage);

  function initScanner(root) {
    var video = root.querySelector("[data-scan-video]");
    var idle = root.querySelector("[data-scan-idle]");
    var startBtn = root.querySelector("[data-scan-start]");
    var stopBtn = root.querySelector("[data-scan-stop]");
    var support = root.querySelector("[data-scan-support]");
    var result = root.querySelector("[data-scan-result]");
    var logEl = root.querySelector("[data-scan-log]");
    var url = root.getAttribute("data-scan-url");
    var stream = null, detector = null, timer = null;
    var lastToken = "", lastAt = 0;

    var hasDetector = "BarcodeDetector" in window;
    if (!hasDetector) {
      support.textContent =
        "متصفحك مابيدعمش قراءة الأكواد بالكاميرا (الغالب على آيفون). " +
        "استخدم كروم على أندرويد، أو الصق الرمز في الخانة تحت.";
      startBtn.disabled = true;
    } else {
      support.textContent = "وجّه الكاميرا على كود الضيف — التسجيل بيتم تلقائياً.";
    }

    function show(kind, title, lines) {
      result.className = "checkin-result is-" + kind;
      result.replaceChildren();
      var h = doc.createElement("strong");
      h.textContent = title;
      result.appendChild(h);
      (lines || []).forEach(function (t) {
        if (!t) return;
        var p = doc.createElement("p");
        p.textContent = t;
        result.appendChild(p);
      });
    }

    function send(token) {
      var now = Date.now();
      // نفس الكود قدام الكاميرا بيتقرا عشرات المرات في الثانية
      if (token === lastToken && now - lastAt < 2500) return;
      lastToken = token; lastAt = now;

      var body = new FormData();
      body.append("token", token);
      fetch(url, {
        method: "POST",
        headers: { "X-CSRFToken": csrf(), "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin",
        body: body
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (d) {
          if (!d.ok) { show("bad", "✕ " + (d.error || "تعذّر التسجيل")); return; }
          var meta = [];
          if (d.code) meta.push(d.code);
          if (d.group) meta.push(d.group);
          if (d.rsvp) meta.push("الرد: " + d.rsvp);
          // العدّاد ده أهم حاجة على الباب: كام دخل من كام
          var count = (d.used != null && d.allowed != null)
            ? d.used + " من " + d.allowed + " · متبقي " + d.left : "";

          if (d.already) {
            show("bad", "✕ " + d.name + " — " + (d.error || "التصريح مستخدم"),
              [count, meta.join(" · ")]);
          } else {
            var line = count + (d.left === 0 ? " · اكتمل" : "");
            show("ok", "✓ " + d.name, [line, meta.join(" · "), "الساعة " + d.at]);
            var li = doc.createElement("li");
            li.textContent = d.at + " — " + d.name +
              (d.allowed > 1 ? " (" + d.used + "/" + d.allowed + ")" : "");
            logEl.insertBefore(li, logEl.firstChild);
            while (logEl.children.length > 12) logEl.removeChild(logEl.lastChild);
          }
          var a = root.querySelector("[data-arrived]"), t = root.querySelector("[data-total]");
          if (a && d.arrived != null) a.textContent = d.arrived;
          if (t && d.total != null) t.textContent = d.total;
        })
        .catch(function () { show("bad", "✕ تعذّر الاتصال بالخادم"); });
    }

    function tick() {
      if (!detector || !video.videoWidth) return;
      detector.detect(video).then(function (codes) {
        if (codes && codes.length) send(String(codes[0].rawValue || "").trim());
      }).catch(function () {});
    }

    startBtn.addEventListener("click", function () {
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }, audio: false
      }).then(function (s) {
        stream = s;
        video.srcObject = s;
        video.play();
        idle.hidden = true;
        startBtn.hidden = true;
        stopBtn.hidden = false;
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        timer = setInterval(tick, 350);
      }).catch(function () {
        support.textContent = "مفيش إذن للكاميرا. اسمح بالوصول من إعدادات المتصفح.";
      });
    });

    stopBtn.addEventListener("click", function () {
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null; detector = null;
      video.srcObject = null;
      idle.hidden = false;
      startBtn.hidden = false;
      stopBtn.hidden = true;
    });

    root.querySelector("[data-manual-form]").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = e.target.querySelector("input[name=token]");
      var v = (input.value || "").trim();
      if (!v) return;
      lastToken = "";                 // الإدخال اليدوي مايتمنعش بالتكرار
      send(v);
      input.value = "";
    });
  }

  /* ------------------------------------------------ نسخ رابط الضيف */
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-copy]");
    if (!btn) return;
    var text = btn.getAttribute("data-copy");
    var done = function () {
      var old = btn.textContent;
      btn.textContent = "✓ اتنسخ";
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt("انسخ الرابط:", text); });
    } else {
      window.prompt("انسخ الرابط:", text);
    }
  });

  /* ------------------------------------------------ تسجيل دخول الضيوف */
  function csrf() {
    var m = doc.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  doc.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-checkin]");
    if (!btn) return;
    btn.disabled = true;
    fetch(btn.getAttribute("data-checkin"), {
      method: "POST",
      headers: { "X-CSRFToken": csrf(), "X-Requested-With": "XMLHttpRequest" },
      credentials: "same-origin"
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.disabled = false;
        btn.textContent = d.checked_in ? "✓ دخل" : "تسجيل الدخول";
      })
      .catch(function () { btn.disabled = false; });
  });

  /* ------------------------------------------------ رسم بياني بسيط */
  var chartHost = doc.querySelector("[data-chart]");
  var chartNode = doc.getElementById("chart-data");
  if (chartHost && chartNode) {
    var rows;
    try { rows = JSON.parse(chartNode.textContent) || []; } catch (e) { rows = []; }
    if (!rows.length) {
      chartHost.textContent = "لا توجد بيانات بعد.";
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.views || 0; })) || 1;
    rows.forEach(function (r) {
      var row = doc.createElement("div");
      row.style.cssText = "display:grid;grid-template-columns:150px 1fr auto;gap:10px;align-items:center;margin-bottom:9px;font-size:13px";

      var label = doc.createElement("span");
      label.textContent = r.label;
      label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)";

      var track = doc.createElement("div");
      track.style.cssText = "height:9px;background:var(--surface-2);border-radius:99px;overflow:hidden";
      var fill = doc.createElement("div");
      fill.style.cssText = "height:100%;background:var(--accent);border-radius:99px;width:" +
        Math.round(((r.views || 0) / max) * 100) + "%";
      track.appendChild(fill);

      var val = doc.createElement("b");
      val.textContent = (r.views || 0) + " / " + (r.rsvps || 0);
      val.style.color = "var(--accent)";

      row.appendChild(label); row.appendChild(track); row.appendChild(val);
      chartHost.appendChild(row);
    });
  }

  /* ---------------------------------------------------------- إضافات الطلب
     حاجتين بس:
     ١) الإضافة المربوطة بباقات معيّنة بتختفي لما تختار باقة تانية —
        وبنشيل علامتها كمان، وإلا كان هيتبعت اختيار مخفي والسيرفر يرفض
        الفورم من غير ما المستخدم يشوف السبب.
     ٢) إجمالي حيّ تحت الاختيارات: العميل يعرف هيدفع كام قبل ما يبعت. */
  (function initAddons() {
    var box = doc.querySelector("[data-addons]");
    if (!box) return;
    var totalNode = doc.querySelector("[data-addons-total]");
    var planSel = doc.querySelector("select[name=plan]");
    var rows = Array.prototype.slice.call(box.querySelectorAll("[data-addon]"));
    var currency = box.getAttribute("data-currency") || "";

    function refresh() {
      var plan = planSel ? planSel.value : "";
      var total = 0, shown = 0;
      rows.forEach(function (row) {
        var raw = (row.getAttribute("data-plans") || "").trim();
        var allowed = raw ? raw.split(/\s+/) : [];
        var ok = !allowed.length || (plan && allowed.indexOf(plan) !== -1);
        row.hidden = !ok;
        var input = row.querySelector("input");
        if (!ok) { input.checked = false; return; }
        shown++;
        if (input.checked) total += Number(input.getAttribute("data-price")) || 0;
      });
      box.hidden = shown === 0;
      if (totalNode) {
        totalNode.hidden = total === 0;
        totalNode.textContent = "إجمالي الإضافات: +" + total + " " + currency;
      }
    }

    box.addEventListener("change", refresh);
    if (planSel) planSel.addEventListener("change", refresh);
    refresh();
  })();
})();
