/* ================================================================
   فرحة — سكربت صفحة الدعوة
   ملف ستاتيك مستقل تماماً عن قوالب Django.
   كل البيانات تصل عبر خصائص data-* أو عبر <script type="application/json">،
   ولا يُكتب أي متغيّر Django داخل هذا الملف — وهذا مقصود:
   أي أداة تنسيق HTML لن تستطيع كسر هذا الكود.
   ================================================================ */
(function () {
  "use strict";

  var doc = document;
  var root = doc.querySelector("[data-invite-root]") || doc.body;

  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }

  // ---------------------------------------------------------- العد التنازلي
  function initCountdowns() {
    var nodes = $$("[data-countdown]");
    if (!nodes.length) return;

    function tick() {
      var now = Date.now();
      nodes.forEach(function (el) {
        var iso = el.getAttribute("data-countdown");
        if (!iso) return;
        var target = new Date(iso).getTime();
        if (isNaN(target)) return;
        var diff = target - now;

        if (diff <= 0) {
          if (!el.classList.contains("is-done")) {
            el.classList.add("is-done");
            el.textContent = el.getAttribute("data-finished") || "";
          }
          return;
        }
        var s = Math.floor(diff / 1000);
        var parts = {
          days: Math.floor(s / 86400),
          hours: Math.floor((s % 86400) / 3600),
          minutes: Math.floor((s % 3600) / 60),
          seconds: s % 60
        };
        Object.keys(parts).forEach(function (key) {
          var slot = el.querySelector('[data-cd="' + key + '"]');
          if (slot) {
            var v = pad(parts[key]);
            if (slot.textContent !== v) slot.textContent = v;
          }
        });
      });
    }
    tick();
    setInterval(tick, 1000);
  }

  // ---------------------------------------------------------- الحركات
  function initAnimations() {
    var nodes = $$(".lb-anim");
    if (!nodes.length) return;

    if (!("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    nodes.forEach(function (n) { io.observe(n); });
  }

  // ---------------------------------------------------------- التمرير الناعم
  function initScrollLinks() {
    doc.addEventListener("click", function (e) {
      var link = e.target.closest('a[href^="#"], [data-scroll]');
      if (!link) return;
      var sel = link.getAttribute("href") || link.getAttribute("data-scroll");
      if (!sel || sel === "#" || sel.length < 2) return;
      var target = doc.querySelector(sel);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // ---------------------------------------------------------- نسخ ومشاركة
  function initShare() {
    doc.addEventListener("click", function (e) {
      var copyBtn = e.target.closest("[data-copy-link]");
      if (copyBtn) {
        e.preventDefault();
        var url = location.href;
        var done = copyBtn.getAttribute("data-done") || "تم النسخ";
        var label = copyBtn.querySelector("span");
        var write = navigator.clipboard
          ? navigator.clipboard.writeText(url)
          : Promise.reject();
        write.then(function () {
          if (!label) return;
          var old = label.textContent;
          label.textContent = done;
          setTimeout(function () { label.textContent = old; }, 2000);
        }).catch(function () {
          window.prompt("انسخ الرابط", url);
        });
        return;
      }

      var shareBtn = e.target.closest("[data-native-share]");
      if (shareBtn) {
        e.preventDefault();
        if (navigator.share) {
          navigator.share({ title: doc.title, url: location.href }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(location.href);
        }
      }
    });
  }

  // ---------------------------------------------------------- تكبير الصور
  function initLightbox() {
    var box = null;
    doc.addEventListener("click", function (e) {
      var img = e.target.closest('.lb-gallery[data-lightbox="1"] .lb-gitem img');
      if (!img) return;
      if (!box) {
        box = doc.createElement("div");
        box.className = "lb-lightbox";
        box.setAttribute("role", "dialog");
        box.innerHTML = "<img alt=''>";
        box.addEventListener("click", function () { box.hidden = true; });
        doc.body.appendChild(box);
      }
      box.querySelector("img").src = img.currentSrc || img.src;
      box.hidden = false;
    });
    doc.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && box) box.hidden = true;
    });
  }

  // ---------------------------------------------------------- الفيديو
  function initVideo() {
    $$("[data-video]").forEach(function (holder) {
      var url = holder.getAttribute("data-video");
      var poster = holder.getAttribute("data-poster");
      var autoplay = holder.hasAttribute("data-autoplay");
      var loop = holder.hasAttribute("data-loop");
      var yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
      var vimeo = url.match(/vimeo\.com\/(\d+)/);

      function embed() {
        var frame = doc.createElement("iframe");
        frame.setAttribute("allow", "accelerometer; autoplay; encrypted-media; picture-in-picture");
        frame.setAttribute("allowfullscreen", "");
        frame.setAttribute("title", "فيديو المناسبة");
        if (yt) {
          frame.src = "https://www.youtube-nocookie.com/embed/" + yt[1] +
            "?rel=0&autoplay=1" + (loop ? "&loop=1&playlist=" + yt[1] : "");
        } else if (vimeo) {
          frame.src = "https://player.vimeo.com/video/" + vimeo[1] + "?autoplay=1";
        } else {
          var v = doc.createElement("video");
          v.src = url; v.controls = true; v.playsInline = true;
          v.loop = loop; v.autoplay = true;
          if (poster) v.poster = poster;
          holder.replaceChildren(v);
          return;
        }
        holder.replaceChildren(frame);
      }

      if (autoplay && !yt && !vimeo) {
        var v = doc.createElement("video");
        v.src = url; v.muted = true; v.autoplay = true;
        v.loop = loop; v.playsInline = true; v.controls = true;
        if (poster) v.poster = poster;
        holder.replaceChildren(v);
        return;
      }

      // لا نحمّل مشغّلات الطرف الثالث إلا بضغطة — أسرع وأفضل للخصوصية
      var btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "lb-video-play";
      btn.setAttribute("aria-label", "تشغيل الفيديو");
      if (poster) btn.style.setProperty("--poster", 'url("' + poster.replace(/"/g, "%22") + '")');
      btn.innerHTML = "<span>▶</span>";
      btn.addEventListener("click", embed);
      holder.replaceChildren(btn);
    });
  }

  // ---------------------------------------------------------- الموسيقى
  function initMusic() {
    var cfgNode = doc.getElementById("invite-music");
    if (!cfgNode) return;
    var cfg;
    try { cfg = JSON.parse(cfgNode.textContent); } catch (err) { return; }
    if (!cfg || !cfg.url || cfg.player === "hidden") return;

    var audio = new Audio(cfg.url);
    audio.loop = cfg.loop !== false;
    audio.preload = "none";

    var btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "lb-music" + (cfg.player === "bar" ? " lb-music--bar" : "");
    btn.setAttribute("aria-label", "تشغيل الموسيقى");
    btn.innerHTML = "♪";
    doc.body.appendChild(btn);

    function play() {
      audio.play().then(function () {
        btn.classList.add("is-playing");
        btn.setAttribute("aria-label", "إيقاف الموسيقى");
      }).catch(function () { /* المتصفح منع التشغيل — ينتظر ضغطة المستخدم */ });
    }
    function pause() {
      audio.pause();
      btn.classList.remove("is-playing");
      btn.setAttribute("aria-label", "تشغيل الموسيقى");
    }

    btn.addEventListener("click", function () {
      if (audio.paused) play(); else pause();
    });

    if (cfg.autoplay) {
      play();
      // بعض المتصفحات تسمح بالتشغيل بعد أول تفاعل من المستخدم
      var once = function () {
        if (audio.paused) play();
        doc.removeEventListener("click", once);
        doc.removeEventListener("touchstart", once);
      };
      doc.addEventListener("click", once, { once: true });
      doc.addEventListener("touchstart", once, { once: true });
    }
    window.__lbMusic = { play: play, pause: pause, audio: audio };
  }

  // ---------------------------------------------------------- الشاشة الافتتاحية
  function initIntro() {
    var intro = $(".lb-intro");
    if (!intro) return;
    doc.body.style.overflow = "hidden";
    var open = function () {
      intro.classList.add("is-open");
      doc.body.style.overflow = "";
      if (window.__lbMusic) window.__lbMusic.play();
      setTimeout(function () { intro.remove(); }, 700);
    };
    var btn = $("[data-intro-open]", intro);
    if (btn) btn.addEventListener("click", open);
    intro.addEventListener("click", function (e) { if (e.target === intro) open(); });
  }

  // ---------------------------------------------------------- نموذج RSVP
  function initRsvp() {
    var form = $("[data-rsvp-form]");
    if (!form) return;

    form.addEventListener("submit", function (e) {
      if (form.hasAttribute("data-demo")) {
        e.preventDefault();
        showMessage("هذه معاينة — لن يُسجَّل الرد.");
        return;
      }
      if (!window.fetch) return; // ارجع للإرسال العادي

      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.dataset.old = btn.textContent; btn.textContent = "جارٍ الإرسال…"; }

      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin"
      })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (data) {
          if (data && data.ok) {
            showMessage(data.message || "", true);
            form.querySelectorAll("input, textarea, button").forEach(function (el) {
              el.disabled = true;
            });
          } else {
            showMessage((data && data.error) || "تعذّر الإرسال، حاول مرة أخرى.");
            if (btn) { btn.disabled = false; btn.textContent = btn.dataset.old; }
          }
        })
        .catch(function () {
          showMessage("تعذّر الاتصال، حاول مرة أخرى.");
          if (btn) { btn.disabled = false; btn.textContent = btn.dataset.old; }
        });
    });

    function showMessage(text, success) {
      var msg = form.querySelector("[data-rsvp-msg]");
      if (!msg) return;
      if (text) msg.textContent = text;
      msg.hidden = false;
      msg.style.background = success === false ? "rgba(180,65,60,.12)" : "";
      msg.style.color = success === false ? "#b4413c" : "";
      msg.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // ---------------------------------------------------------- الإقلاع
  function boot() {
    initCountdowns();
    initAnimations();
    initScrollLinks();
    initShare();
    initLightbox();
    initVideo();
    initMusic();
    initIntro();
    initRsvp();
    root.setAttribute("data-ready", "1");
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // إعادة التهيئة بعد تحديث المعاينة داخل المحرر
  window.__lbRefresh = function () {
    initCountdowns();
    initVideo();
    $$(".lb-anim").forEach(function (n) { n.classList.add("is-in"); });
  };
})();
