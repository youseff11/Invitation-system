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

  /* ------------------------------------------------ تبديل اللغة
     الصفحات اللي بتطبع اللغتين مع بعض (‎<html data-bilingual>‎) بتتبدّل
     في المتصفح على طول زي الوضع الليلي — صفة واحدة على ‎<html>‎ والـCSS
     بيوري اللغة المطلوبة. السيرفر بيتبلّغ في الخلفية عشان أي صفحة
     تانية تتفتح باللغة الصح.

     الصفحات التانية (لوحة التحكم مثلاً) لسه محتاجة السيرفر، فبنسيب
     الفورم يشتغل عادي ونحفظ مكان السكرول عشان الرجعة تبقى في مكانها. */
  (function () {
    var form = doc.querySelector(".lang-form");
    if (!form) return;
    var root = doc.documentElement;
    var bilingual = root.hasAttribute("data-bilingual");

    if (!bilingual) {
      form.addEventListener("submit", function () {
        try {
          sessionStorage.setItem("farha-lang-switch", String(Math.round(window.scrollY)));
        } catch (e) {}
        var btn = form.querySelector(".lang-btn");
        if (btn) btn.classList.add("is-busy");
      });
      return;
    }

    function applyLang(lang) {
      root.setAttribute("lang", lang);
      root.setAttribute("dir", lang === "ar" ? "rtl" : "ltr");

      var title = root.getAttribute("data-title-" + lang);
      if (title) doc.title = title;

      /* السمات (title / aria-label) — مش عناصر فيبقى الـCSS مايوصلهاش */
      var attrs = doc.querySelectorAll("[data-bi-attr]");
      Array.prototype.forEach.call(attrs, function (el) {
        var name = el.getAttribute("data-bi-attr");
        var val = el.getAttribute("data-bi-" + lang);
        if (name && val !== null) el.setAttribute(name, val);
      });

      /* الفورم يفضل مظبوط لو الجافاسكربت وقف بعد كده لأي سبب */
      var input = form.querySelector('input[name="language"]');
      if (input) input.value = lang === "ar" ? "en" : "ar";
    }

    /* لو المتصفح فاكر لغة غير اللي السيرفر رسمها، السكربت في base.html
       بيكون ظبّط ‎lang‎ و‎dir‎ قبل الرسم — بنكمّل الباقي هنا. */
    applyLang(root.getAttribute("lang") === "en" ? "en" : "ar");

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var next = root.getAttribute("lang") === "ar" ? "en" : "ar";

      var swap = function () { applyLang(next); };
      if (doc.startViewTransition && !(window.matchMedia &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
        doc.startViewTransition(swap);
      } else {
        swap();
      }

      try { localStorage.setItem("farha-lang", next); } catch (e2) {}

      /* تبليغ السيرفر في الخلفية — من غير انتظار ومن غير إعادة تحميل */
      try {
        var fd = new FormData(form);
        fd.set("language", next);
        fetch(form.action, {
          method: "POST", body: fd, credentials: "same-origin", keepalive: true
        }).catch(function () {});
      } catch (e3) {}
    });
  })();

  /* ------------------------------------------------ مؤثرات الصفحة الرئيسية
     نجوم بتقع + شهاب + ظهور تدريجي بالسكرول.
     كله بيقف لو المستخدم مفعّل «تقليل الحركة»، وبيقف كمان لما التاب يبقى
     مخفي عشان ما ياكلش بطارية على الموبايل. */
  (function () {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* ---- النجوم ---- */
    var fields = doc.querySelectorAll("[data-fx-stars]");
    if (fields.length && !reduce) {
      /* مسافة السقوط = ارتفاع الحاوية نفسها، عشان النجمة تخفت وهي بتخرج
         من تحت مش تختفي فجأة عند حافة القص. */
      function sizeFields() {
        fields.forEach(function (f) {
          var h = f.getAttribute("data-fx-scale") === "page"
                ? window.innerHeight
                : (f.offsetHeight || window.innerHeight);
          f.style.setProperty("--fall", (h + 70) + "px");
        });
      }
      sizeFields();
      var rz;
      window.addEventListener("resize", function () {
        clearTimeout(rz); rz = setTimeout(sizeFields, 200);
      }, { passive: true });

      fields.forEach(function (field) {
        var count = parseInt(field.getAttribute("data-fx-count"), 10) || 20;
        /* على الشاشات الصغيرة نص العدد — أداء أحسن وشكل أهدى */
        if (window.innerWidth < 700) count = Math.round(count * 0.55);
        var frag = doc.createDocumentFragment();
        for (var i = 0; i < count; i++) {
          var star = doc.createElement("span");
          star.className = "fx-star" + (i % 4 === 0 ? " fx-star--spark" : "");
          var size = (Math.random() * 3 + 1.6).toFixed(1);      /* 1.6 → 4.6px */
          var dur = (Math.random() * 9 + 9).toFixed(1);         /* 9 → 18s */
          var delay = (-Math.random() * 18).toFixed(1);         /* تبدأ متفرقة مش سوا */
          var drift = Math.round((Math.random() - 0.5) * 120);  /* ميل يمين/شمال */
          star.style.cssText =
            "inset-inline-start:" + (Math.random() * 100).toFixed(2) + "%;" +
            "--s:" + size + "px;--dur:" + dur + "s;--delay:" + delay + "s;" +
            "--drift:" + drift + "px;--peak:" + (Math.random() * 0.45 + 0.4).toFixed(2) + ";";
          frag.appendChild(star);
        }
        field.appendChild(frag);
      });
    }

    /* ---- الشهاب: بيعدّي كل 6-14 ثانية من مكان عشوائي فوق ---- */
    var shootBox = doc.querySelector("[data-fx-shooting]");
    if (shootBox && !reduce) {
      var timer = null;
      function shoot() {
        if (doc.hidden || shootBox.classList.contains("fx-idle")) return;
        var el = doc.createElement("span");
        el.className = "fx-shoot";
        el.style.top = (Math.random() * 42 + 4).toFixed(1) + "%";
        el.style.insetInlineEnd = (Math.random() * 34 - 6).toFixed(1) + "%";
        shootBox.appendChild(el);
        setTimeout(function () { el.remove(); }, 1700);
      }
      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(function () { shoot(); schedule(); },
                           Math.random() * 8000 + 6000);
      }
      schedule();
      doc.addEventListener("visibilitychange", function () {
        if (doc.hidden) clearTimeout(timer); else schedule();
      });
    }

    /* ---- إيقاف مؤثرات الهيرو وهي مش على الشاشة ----
       النجوم بتفضل شغالة (وبتعيد رسم طبقتها كل فريم) حتى وهي مخفية.
       بنوقفها أول ما الهيرو يخرج، وبنوقفها كمان لو التاب اتخفى. */
    var hero = doc.querySelector(".hero");
    if (hero && !reduce && "IntersectionObserver" in window) {
      var fxHosts = hero.querySelectorAll("[data-fx-stars], [data-fx-shooting]");
      var setIdle = function (idle) {
        Array.prototype.forEach.call(fxHosts, function (el) {
          el.classList.toggle("fx-idle", idle);
        });
      };
      var onScreen = true;
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        setIdle(!onScreen || doc.hidden);
      }, { threshold: 0 }).observe(hero);
      doc.addEventListener("visibilitychange", function () {
        setIdle(!onScreen || doc.hidden);
      });
    }

    /* ---- الظهور التدريجي ---- */
    var items = doc.querySelectorAll("[data-reveal]");
    if (!items.length) return;

    /* راجعين من تبديل لغة: كل حاجة تظهر على طول والصفحة ترجع لنفس
       المكان اللي المستخدم كان واقف فيه — فالتبديل يحس كأنه في مكانه. */
    var back = null;
    try { back = sessionStorage.getItem("farha-lang-switch"); } catch (e) {}
    if (back !== null) {
      try { sessionStorage.removeItem("farha-lang-switch"); } catch (e) {}
      items.forEach(function (el) { el.classList.add("is-in"); });
      var y = parseInt(back, 10) || 0;
      if (y > 0) {
        var prev = history.scrollRestoration;
        try { history.scrollRestoration = "manual"; } catch (e) {}
        /* ‎html { scroll-behavior: smooth }‎ بيحوّل النطة دي لأنيميشن،
           والمتصفح بيلغيها وهو بيرجّع الصفحة لأولها — فبنقفله لحظياً. */
        var root = doc.documentElement;
        var jump = function () {
          var keep = root.style.scrollBehavior;
          root.style.scrollBehavior = "auto";
          window.scrollTo(0, y);
          root.style.scrollBehavior = keep;
        };
        jump();
        /* الصور بتغيّر الارتفاعات وهي بتخلص تحميل — نعيد الضبط بعدها */
        window.addEventListener("load", function () {
          jump();
          requestAnimationFrame(function () {
            jump();
            try { history.scrollRestoration = prev || "auto"; } catch (e) {}
          });
        }, { once: true });
      }
      return;
    }

    if (reduce || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        if (el.hasAttribute("data-reveal-stagger")) {
          /* ترتيب العنصر جوّه أبوه بيحدد التأخير — الكروت بتظهر ورا بعض */
          var idx = Array.prototype.indexOf.call(el.parentNode.children, el);
          el.style.setProperty("--reveal-delay", Math.min(idx, 8) * 70 + "ms");
        }
        el.classList.add("is-in");
        io.unobserve(el);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { io.observe(el); });
  })();

})();
