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

    // ---------------------------------------------------------- فيديوهات القوالب المستوردة
  // القالب المستورد قد يحتوي <video> خاماً بدون data-video؛ بعض القوالب
  // تعتمد على JavaScript الأصلي لاستدعاء play(). نفعّل الفيديو الصامت
  // بأمان من Runtime المنصة، بدون تشغيل أي JavaScript مستورد.
  function initImportedMedia() {
    $$(".lb-custom video").forEach(function (video) {
      if (video.dataset.lbMediaBound === "1") return;
      video.dataset.lbMediaBound = "1";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.style.visibility = "visible";
      var tryPlay = function () {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      };
      tryPlay();
      ["pointerdown", "touchstart", "keydown", "scroll"].forEach(function (eventName) {
        doc.addEventListener(eventName, tryPlay, { once: true, passive: true });
      });
    });
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
      var noControls = holder.hasAttribute("data-no-controls");
      var wantSound = holder.hasAttribute("data-sound");
      var yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
      var vimeo = url.match(/vimeo\.com\/(\d+)/);

      function embed() {
        var frame = doc.createElement("iframe");
        frame.setAttribute("allow", "accelerometer; autoplay; encrypted-media; picture-in-picture");
        frame.setAttribute("allowfullscreen", "");
        frame.setAttribute("title", "فيديو المناسبة");
        if (yt) {
          /* controls=0 بيخفي شريط يوتيوب — بس الشعار وزر «شاهد على
             يوتيوب» بيفضلوا، مشغّلهم مش تحت إيدنا. */
          frame.src = "https://www.youtube-nocookie.com/embed/" + yt[1] +
            "?rel=0&autoplay=1" + (noControls ? "&controls=0&modestbranding=1" : "") +
            (loop ? "&loop=1&playlist=" + yt[1] : "");
        } else if (vimeo) {
          frame.src = "https://player.vimeo.com/video/" + vimeo[1] +
            "?autoplay=1" + (noControls ? "&controls=0" : "");
        } else {
          var v = doc.createElement("video");
          v.src = url; v.controls = !noControls; v.playsInline = true;
          v.loop = loop; v.autoplay = true;
          if (poster) v.poster = poster;
          holder.replaceChildren(v);
          return;
        }
        holder.replaceChildren(frame);
      }

      /* الملف بتاعنا: بنركّب <video> على طول بمشغّل المتصفح نفسه.
         قبل كده كنا بنحط زر تشغيل بديل ونستنى ضغطة — وده كان غلط
         لسببين: ضغطة زيادة على ملف مالوش طرف تالت أصلاً، وإن الحاوية
         بتفضل من غير مقاس لحد ما يتضغط. مع نسبة «زي ما هو» ده كان
         بيسيب شريط رفيع مكان الفيديو لحد أول ضغطة. الحمل مش مشكلة:
         preload=metadata بينزّل الترويسة بس، ولو فيه صورة غلاف
         بنستخدم none والغلاف بيبان فوراً. */
      if (!yt && !vimeo) {
        /* لمسة الضيف على زر «افتح الدعوة» في الشاشة الافتتاحية هي إذن
           التشغيل الوحيد اللي المتصفح بيعترف بيه — وهي كمان الإذن
           الوحيد اللي بيسمح بصوت. فطالما فيه افتتاحية، بنستنّاها بدل
           ما نبدأ صامت. من غيرها مفيش لمسة مضمونة والصامت هو الطريق
           الوحيد اللي الفيديو بيشتغل بيه أصلاً. */
        var gate = !!doc.querySelector(".lb-intro");
        var withSound = autoplay && wantSound && gate;

        var v = doc.createElement("video");
        v.src = url; v.loop = loop; v.playsInline = true;
        v.controls = !noControls;
        /* حتى مع الشريط ظاهر: قايمة الـ⋮ فيها «تنزيل» و«سرعة التشغيل».
           ده فيديو العروسين مش ملف عام — بنقفل الاتنين. */
        v.setAttribute("controlsList", "nodownload noplaybackrate noremoteplayback");
        v.disablePictureInPicture = true;
        v.preload = poster ? "none" : "metadata";
        if (poster) v.poster = poster;
        if (autoplay && !withSound) { v.muted = true; v.autoplay = true; v.preload = "auto"; }
        // النسبة الحقيقية مابتتعرفش غير من الملف — بنبلّغ بيها الحاوية
        // عشان «زي ما هو» تاخد شكلها من غير قفزة في التخطيط
        v.addEventListener("loadedmetadata", function () {
          if (v.videoWidth && v.videoHeight) {
            holder.style.setProperty("--vid-ratio", v.videoWidth + " / " + v.videoHeight);
          }
        });
        holder.replaceChildren(v);

        /* التشغيل التلقائي ممكن يترفض: وضع توفير الطاقة في iOS، أو
           Data Saver، أو إعداد المتصفح اللي بيمنع الوسائط. ولو الشريط
           مخفي ساعتها الضيف بيبص على صورة ساكنة مالهاش أي زر —
           فبنرجّع الشريط بدل ما نسيبه مقفول على فيديو واقف. */
        var tryPlay = function () {
          var p = v.play();
          if (p && p.catch) p.catch(function () { v.controls = true; });
        };

        /* مانشغّلش كل فيديوهات الدعوة مع بعض — بيهنّج الموبايل وبياكل
           داتا الضيف، والصوت بيتلخبط لو أكتر من واحد شغال. بيبدأ لما
           القسم يوصل للشاشة ويقف لما يعدّي. */
        var watch = function () {
          if (typeof IntersectionObserver !== "function") { tryPlay(); return; }
          new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
              if (en.isIntersecting) tryPlay();
              else if (!v.paused) v.pause();
            });
          }, { threshold: 0.35 }).observe(v);
        };

        /* الموسيقى والفيديو الصوتي مايشتغلوش فوق بعض. بنوطّي الموسيقى
           وقت الفيديو ونرجّعها لما يقف — ولو كانت مقفولة أصلاً مانلمسهاش. */
        var ducked = false;
        var duck = function () {
          var m = window.__lbMusic;
          if (m && m.audio && !m.audio.paused) { ducked = true; m.pause(); }
        };
        var unduck = function () {
          if (!ducked) return;
          ducked = false;
          if (window.__lbMusic) window.__lbMusic.play();
        };

        if (withSound) {
          /* صلاحية اللمسة لحظة الضغطة نفسها بس. لو استنّينا الفيديو
             يوصل للشاشة الإذن بيبقى راح — فبنشغّله ونوقفه فوراً جوّه
             المستمع، وبعد كده العنصر بيفضل مسموح ليه يشتغل بصوت في أي
             وقت. ولو الافتتاحية اتفتحت بالعدّاد التلقائي مش بضغطة،
             مفيش لمسة أصلاً والمتصفح بيرفض — بنرجع صامت. */
          var arm = function () {
            v.addEventListener("play", duck);
            v.addEventListener("pause", unduck);
            v.addEventListener("ended", unduck);
            watch();
          };
          doc.addEventListener("lb:intro-open", function () {
            var p = v.play();
            if (!p || !p.then) { v.pause(); arm(); return; }
            p.then(function () { v.pause(); v.currentTime = 0; })
              .catch(function () { v.muted = true; })
              .then(arm, arm);
          }, { once: true });
        } else if (autoplay) {
          watch();
        } else if (noControls) {
          /* من غير شريط ومن غير تشغيل تلقائي الفيديو بيبقى صورة ساكنة.
             الضغطة على الفيديو نفسه بقت هي زر التشغيل/الإيقاف. */
          v.style.cursor = "pointer";
          v.addEventListener("click", function () {
            if (v.paused) tryPlay(); else v.pause();
          });
        }
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

    // __lbRefresh بيتنادى أكتر من مرة. لو العقدة دي اتربطت خلاص
    // مانربطهاش تاني — وإلا كل تحديث معاينة بيضيف مستمع زيادة
    if (intro.dataset.lbBound) return;
    intro.dataset.lbBound = "1";

    // داخل المحرر بنخفيها بس ما نشيلهاش، عشان تقدر ترجع تعاينها وتعدّلها
    var editable = intro.hasAttribute("data-intro-editable");
    var timer = null;

    // لو كانت مفتوحة قبل تحديث المعاينة، مانرجعش نقفل التمرير عليه
    var startsOpen = intro.classList.contains("is-open");
    doc.body.style.overflow = startsOpen ? "" : "hidden";

    var open = function () {
      if (timer) { clearTimeout(timer); timer = null; }
      intro.classList.add("is-open");
      doc.body.style.overflow = "";
      if (window.__lbMusic) window.__lbMusic.play();
      var vid = $("[data-intro-video]", intro);
      if (vid) { try { vid.pause(); } catch (e) {} }
      if (!editable) setTimeout(function () { intro.remove(); }, 700);
      // التمرير التلقائي مستني الإشارة دي — قبلها التمرير مقفول أصلاً
      doc.dispatchEvent(new CustomEvent("lb:intro-open"));
    };

    var reopen = function () {
      intro.classList.remove("is-open");
      doc.body.style.overflow = "hidden";
      var vid = $("[data-intro-video]", intro);
      if (vid) { try { vid.currentTime = 0; vid.play(); } catch (e) {} }
      startAuto();
    };
    window.__lbIntro = { open: open, reopen: reopen };

    function startAuto() {
      var secs = parseFloat(intro.getAttribute("data-intro-auto") || "0");
      if (timer) clearTimeout(timer);
      if (secs > 0) timer = setTimeout(open, secs * 1000);
    }
    // لو الفيديو مستني ضغطة، العدّاد التلقائي يستنى معاه — وإلا
    // الدعوة بتفتح لوحدها والضيف لسه ما شافش الافتتاحية
    var awaitsPlay = !!$("[data-intro-video][data-intro-manual]", intro);
    if (!startsOpen && !awaitsPlay) startAuto();

    var video = $("[data-intro-video]", intro);
    var playBtn = $("[data-intro-play]", intro);
    if (video && !video.getAttribute("poster")) {
      /* لو مفيش صورة غلاف، نلتقط أول فريم من الفيديو ونستخدمه كغلاف.
         ده يتعمل في المتصفح عشان يشتغل أيضاً مع فيديوهات المكتبة والروابط
         الخارجية، ولو منع CORS الرسم على canvas يفضل الفيديو شغال طبيعي. */
      video.preload = "auto";
      var captureFirstFrame = function () {
        if (video.poster || video.readyState < 2) return;
        try {
          var canvas = doc.createElement("canvas");
          canvas.width = video.videoWidth || 1;
          canvas.height = video.videoHeight || 1;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          video.poster = canvas.toDataURL("image/jpeg", 0.82);
        } catch (e) {
          // روابط الفيديو الخارجية قد تمنع canvas بسبب CORS — لا نعطل التشغيل.
        }
      };
      video.addEventListener("loadeddata", captureFirstFrame, { once: true });
      video.addEventListener("canplay", captureFirstFrame, { once: true });
      if (video.readyState >= 2) captureFirstFrame();
    }
    if (video) {
      /* وضعين للبداية:

         تلقائي — لازم يبدأ **صامت**، ده شرط المتصفح مش اختيار.
         بزر    — لمسة الضيف بتديك إذن التشغيل بصوت من أول ثانية،
                  وده أحسن تجربة لما الفيديو ليه صوت مقصود. */
      var manual = video.hasAttribute("data-intro-manual");

      if (manual && playBtn) {
        intro.classList.add("is-awaiting-play");
        playBtn.addEventListener("click", function (e) {
          e.stopPropagation();          // ما نفتحش الدعوة بالغلط
          intro.classList.remove("is-awaiting-play");
          video.muted = false;          // مسموح — الضغطة دي إذن صريح
          var play = video.play();
          if (play && play.catch) {
            play.catch(function () {
              // بعض الأجهزة بترفض الصوت برضو — نجرّب صامت
              video.muted = true;
              var again = video.play();
              if (again && again.catch) {
                again.catch(function () {
                  intro.classList.add("is-video-blocked");
                });
              }
            });
          }
          var sound = $("[data-intro-sound]", intro);
          if (sound) { sound.classList.add("is-on"); sound.setAttribute("aria-pressed", "true"); }
          if (window.__lbMusic) window.__lbMusic.pause();
          startAuto();                  // العدّاد يبدأ من دلوقتي
        });
      } else {
        video.muted = true;
        var tryPlay = video.play();
        if (tryPlay && tryPlay.catch) {
          // iOS في وضع توفير الطاقة بيرفض التشغيل — الغلاف بيفضل ظاهر
          tryPlay.catch(function () { intro.classList.add("is-video-blocked"); });
        }
      }
      video.addEventListener("ended", function () {
        if (!intro.getAttribute("data-intro-auto")) open();
      });

      /* زر الصوت: الطريقة الوحيدة المسموحة لتشغيل صوت الفيديو.
         المتصفح بيسمح بإلغاء الكتم **بس** لو جاي من لمسة المستخدم
         نفسه، فمفيش نسخة أوتوماتيكية من ده مهما عملنا.
         بنخفي الزر لو الفيديو أصلاً مالوش مسار صوت — زرار بيوعد بحاجة
         مش موجودة أسوأ من مفيش زرار. */
      var sound = $("[data-intro-sound]", intro);
      if (sound) {
        var hideIfSilent = function () {
          if (hasAudio(video) === false) sound.hidden = true;
        };
        video.addEventListener("loadeddata", hideIfSilent);
        if (video.readyState >= 2) hideIfSilent();

        sound.addEventListener("click", function (e) {
          e.stopPropagation();               // ما نفتحش الدعوة بالغلط
          video.muted = !video.muted;
          if (!video.muted) { try { video.play(); } catch (err) {} }
          sound.setAttribute("aria-pressed", String(!video.muted));
          sound.setAttribute("aria-label",
            video.muted ? "تشغيل صوت الفيديو" : "كتم صوت الفيديو");
          sound.classList.toggle("is-on", !video.muted);
          // لو الفيديو والموسيقى شغّالين مع بعض هيتزنقوا في ودن الضيف
          if (!video.muted && window.__lbMusic) window.__lbMusic.pause();
        });
      }
    }

    var btn = $("[data-intro-open]", intro);
    if (btn) btn.addEventListener("click", open);

    /* الزر بقى اختياري — لو المصمّم فضّى نصه مايتعرضش خالص. ساعتها
       لازم يفضل فيه مخرج، وإلا الضيف بيتقفل على الافتتاحية والتمرير
       مقفول تحته. المخارج: نهاية الفيديو، العدّاد التلقائي، ولمسة في
       أي مكان.

       ولمسة «أي مكان» مش مسموحة وإحنا لسه مستنيين زر التشغيل — الضيف
       ساعتها ما شافش الافتتاحية أصلاً، والضغطة المفروض تروح لزر
       التشغيل مش تتخطّى كل حاجة. زر التشغيل وزر الصوت بيوقّفوا
       الضغطة بنفسهم فمش هيوصلوا هنا. */
    intro.addEventListener("click", function (e) {
      if (intro.classList.contains("is-awaiting-play")) return;
      if (btn) { if (e.target === intro) open(); return; }
      open();
    });
    if (!btn) intro.style.cursor = "pointer";
  }

  /** هل الفيديو فيه مسار صوت؟ ``null`` يعني المتصفح مش بيقول. */
  function hasAudio(v) {
    if (typeof v.mozHasAudio === "boolean") return v.mozHasAudio;
    if (v.audioTracks && typeof v.audioTracks.length === "number") {
      return v.audioTracks.length > 0;
    }
    if (typeof v.webkitAudioDecodedByteCount === "number") {
      return v.webkitAudioDecodedByteCount > 0;
    }
    return null;                              // مش عارفين — نسيب الزر ظاهر
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
            if (data.pass) showPass(data.pass);
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

    /* تصريح الدخول بعد تأكيد الحضور.

       بنوريه في نفس الصفحة فوراً — لو استنينا الضيف يفتح رابط تاني،
       نصّهم مش هيفتحوه، ويوم الفرح يقفوا على الباب من غير رمز. */
    function showPass(info) {
      var wrap = form.querySelector("[data-rsvp-pass]");
      if (!wrap) {
        wrap = doc.createElement("div");
        wrap.setAttribute("data-rsvp-pass", "");
        form.appendChild(wrap);
      }
      wrap.className = "lb-pass";
      wrap.replaceChildren();

      var title = doc.createElement("p");
      title.className = "lb-pass-title";
      title.textContent = "تصريح دخولك";
      wrap.appendChild(title);

      var img = doc.createElement("img");
      img.className = "lb-pass-qr";
      img.src = info.qr;
      img.alt = "رمز الدخول " + (info.code || "");
      img.loading = "lazy";
      wrap.appendChild(img);

      var code = doc.createElement("p");
      code.className = "lb-pass-code";
      code.textContent = info.code || "";
      wrap.appendChild(code);

      var note = doc.createElement("p");
      note.className = "lb-pass-note";
      note.textContent = "يكفي " + info.entries +
        (info.entries === 1 ? " شخص واحد" : " أشخاص") + " — وريّه على الباب.";
      wrap.appendChild(note);

      var row = doc.createElement("div");
      row.className = "lb-pass-actions";
      var dl = doc.createElement("a");
      dl.className = "lb-btn lb-btn--solid";
      dl.href = info.download;
      dl.setAttribute("download", "");
      dl.textContent = "تحميل الرمز";
      var open = doc.createElement("a");
      open.className = "lb-btn";
      open.href = info.url;
      open.target = "_blank";
      open.rel = "noopener";
      open.textContent = "فتح التصريح";
      row.appendChild(dl);
      row.appendChild(open);
      wrap.appendChild(row);

      wrap.scrollIntoView({ behavior: "smooth", block: "center" });
    }

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

  // ---------------------------------------------------------- تبديل اللغة بدون إعادة تحميل
  function initLanguageToggle() {
    var link = $("[data-lang-toggle]");
    if (!link || link.dataset.lbLangBound) return;
    link.dataset.lbLangBound = "1";

    link.addEventListener("click", function (e) {
      e.preventDefault();
      if (link.dataset.loading === "1") return;

      var current = $("[data-invite-language-content]");
      if (!current || !window.fetch || !window.DOMParser) {
        window.location.href = link.href;
        return;
      }

      var scrollX = window.scrollX;
      var scrollY = window.scrollY;
      var intro = $(".lb-intro");
      var introState = intro
        ? (intro.classList.contains("is-open") ? "open" : "closed")
        : "gone";
      link.dataset.loading = "1";
      link.setAttribute("aria-busy", "true");

      fetch(link.href, {
        headers: { "X-Requested-With": "XMLHttpRequest" },
        credentials: "same-origin"
      })
        .then(function (response) {
          if (!response.ok) throw new Error("language request failed");
          return response.text();
        })
        .then(function (markup) {
          var parsed = new DOMParser().parseFromString(markup, "text/html");
          var next = parsed.querySelector("[data-invite-language-content]");
          if (!next) throw new Error("translated content missing");

          var nextLang = parsed.documentElement.getAttribute("lang");
          var nextDir = parsed.documentElement.getAttribute("dir");
          if (nextLang) doc.documentElement.setAttribute("lang", nextLang);
          if (nextDir) doc.documentElement.setAttribute("dir", nextDir);

          var title = parsed.querySelector("title");
          var description = parsed.querySelector('meta[name="description"]');
          if (title) doc.title = title.textContent;
          if (description) {
            var currentDescription = doc.querySelector('meta[name="description"]');
            if (currentDescription) currentDescription.setAttribute("content", description.getAttribute("content") || "");
          }

          var nextLink = next.querySelector("[data-lang-toggle]");
          var nextUrl = nextLink ? nextLink.href : link.href;
          current.replaceWith(next);
          try { window.history.replaceState({}, "", nextUrl); } catch (err) {}

          var newIntro = $(".lb-intro");
          if (introState === "gone" && newIntro) {
            newIntro.remove();
            doc.body.style.overflow = "";
          } else if (introState === "open" && newIntro) {
            newIntro.classList.add("is-open");
          }

          initVideo();
          initIntro();
          initRsvp();
          initAnimations();
          initLanguageToggle();

          if (introState === "gone" || introState === "open") {
            var activeIntro = $(".lb-intro");
            if (activeIntro) activeIntro.classList.remove("is-awaiting-play");
            doc.body.style.overflow = "";
          }
          window.requestAnimationFrame(function () {
            window.scrollTo(scrollX, scrollY);
          });
        })
        .catch(function () {
          // لا نغيّر الصفحة لو فشل الطلب — الزر يفضل قابلاً لإعادة المحاولة.
        })
        .then(function () {
          link.dataset.loading = "";
          link.removeAttribute("aria-busy");
        });
    });
  }

  // ---------------------------------------------------------- التمرير التلقائي
  /* الدعوة بتنزل لوحدها بالراحة زي العرض.

     تلات قرارات مقصودة هنا:

     ١) **الضيف أهم من العرض.** أي لمسة أو تمرير أو ضغطة زرار بتوقّفه
        فوراً وماترجعوش يشتغل لوحده تاني. حاجة بتحرّك الصفحة تحت إيد
        الواحد وهو بيقرا أسوأ من إنها ماتشتغلش أصلاً.
     ٢) **بيتحرّك بالبكسل الجزئي.** ‎scrollBy‎ بعدد صحيح كل إطار بيدّي
        حركة متقطّعة على الشاشات السريعة. بنجمّع الكسور ونمرّر لما
        توصل بكسل كامل.
     ٣) **prefers-reduced-motion بيلغيه خالص.** ناس بتتعبها الحركة
        التلقائية فعلاً، والإعداد ده هو طلبهم الصريح. */
  var SCROLL_PPS = { slow: 18, normal: 34, fast: 60 };   // بكسل في الثانية

  function initAutoScroll() {
    var node = doc.getElementById("invite-scroll");
    if (!node) return;
    var cfg;
    try { cfg = JSON.parse(node.textContent); } catch (e) { return; }
    if (!cfg || !cfg.enabled) return;
    if (window.__lbScroll) return;                       // اتربط قبل كده
    if (window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var speed = SCROLL_PPS[cfg.speed] || SCROLL_PPS.normal;
    var delay = Math.max(0, Number(cfg.delay) || 0) * 1000;
    var loop = !!cfg.loop;
    var running = false, raf = null, last = 0, carry = 0, startTimer = null;
    var stoppedByUser = false;

    var btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "lb-autoscroll";
    btn.hidden = true;
    btn.innerHTML =
      '<svg class="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M7 5h3.4v14H7zM13.6 5H17v14h-3.4z"/></svg>' +
      '<svg class="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M8 5.2v13.6L19 12 8 5.2Z"/></svg>';
    doc.body.appendChild(btn);

    function atBottom() {
      var el = doc.scrollingElement || doc.documentElement;
      return el.scrollTop + window.innerHeight >= el.scrollHeight - 2;
    }

    function frame(now) {
      if (!running) return;
      if (!last) last = now;
      var dt = Math.min(now - last, 100);          // تبويب راجع من الخلفية
      last = now;
      carry += (speed * dt) / 1000;
      var step = Math.floor(carry);
      if (step >= 1) {
        carry -= step;
        // ‎auto‎ مش ‎smooth‎: التنعيم مع حركة مستمرة بيتخانق مع نفسه
        window.scrollBy({ top: step, behavior: "auto" });
      }
      if (atBottom()) {
        if (loop) { window.scrollTo({ top: 0, behavior: "smooth" }); carry = 0; }
        else { stop(true); return; }
      }
      raf = window.requestAnimationFrame(frame);
    }

    function start() {
      if (running || stoppedByUser) return;
      running = true; last = 0; carry = 0;
      btn.hidden = false;
      btn.classList.remove("is-paused");
      btn.setAttribute("aria-label", "إيقاف التمرير التلقائي");
      raf = window.requestAnimationFrame(frame);
    }

    function stop(finished) {
      running = false;
      if (raf) { window.cancelAnimationFrame(raf); raf = null; }
      if (startTimer) { clearTimeout(startTimer); startTimer = null; }
      btn.classList.add("is-paused");
      btn.setAttribute("aria-label", "تشغيل التمرير التلقائي");
      // خلص لآخر الصفحة؟ الزر مالوش لازمة تاني
      if (finished && !loop) btn.hidden = true;
    }

    /* أي تدخّل من الضيف بيوقّفه نهائياً. الزر نفسه مستثنى — دي ضغطة
       على تحكّم بتاعنا مش محاولة قراءة. */
    function userStop(e) {
      if (e && e.target && btn.contains(e.target)) return;
      stoppedByUser = true;
      stop(false);
    }
    ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (ev) {
      window.addEventListener(ev, userStop, { passive: true });
    });

    btn.addEventListener("click", function () {
      stoppedByUser = false;
      if (running) { stoppedByUser = true; stop(false); }
      else start();
    });

    function schedule() {
      if (startTimer) clearTimeout(startTimer);
      stoppedByUser = false;
      startTimer = setTimeout(start, delay);
    }

    // الافتتاحية بتقفل التمرير على الصفحة، فمالوش معنى نبدأ قبلها
    window.__lbScroll = { start: schedule, stop: stop };
    if ($(".lb-intro:not(.is-open)")) {
      doc.addEventListener("lb:intro-open", schedule, { once: true });
    } else {
      schedule();
    }
  }

  // ---------------------------------------------------------- الإقلاع
  function revealWhenReady() {
    var revealed = false;
    var reveal = function () {
      if (revealed) return;
      revealed = true;
      root.setAttribute("data-ready", "1");
    };
    // لا نعرض القالب قبل اكتمال الخطوط، حتى لا يظهر لحظياً بخطوط وأبعاد
    // مختلفة ثم يقفز إلى مكانه النهائي. المهلة تمنع بقاء الصفحة مخفية لو
    // تعذر تحميل خط خارجي.
    var fontReady = (doc.fonts && doc.fonts.ready && typeof doc.fonts.ready.then === "function")
      ? doc.fonts.ready : Promise.resolve();
    // الـruntime تحسينات تفاعلية غير حرجة؛ لا ننتظره حتى لا يتأخر أول ظهور.
    // يتم تحميله بالتوازي من loader، بينما الصفحة تظهر بمجرد جاهزية الخطوط.
    fontReady.then(reveal, reveal);
    window.setTimeout(reveal, 3000);
  }

  function boot() {
    initCountdowns();
    initAnimations();
    initScrollLinks();
    initShare();
    initLightbox();
    initVideo();
    initImportedMedia();
    initMusic();

    initIntro();
    initLanguageToggle();
    initRsvp();
    initAutoScroll();
    revealWhenReady();
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
    initImportedMedia();
    // المحرر بيستبدل عقدة .lb-intro لما تعدّل إعداداتها — العقدة

    // الجديدة مالهاش مستمعين، فبنربطها تاني
    initIntro();
    initLanguageToggle();
    $$(".lb-anim").forEach(function (n) { n.classList.add("is-in"); });
  };
})();
