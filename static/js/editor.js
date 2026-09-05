/* ================================================================
   فرحة — المحرر البصري
   ----------------------------------------------------------------
   ملف ستاتيك مستقل تماماً. لا يحتوي على أي متغيّر من قوالب Django.
   كل البيانات تصل عبر عناصر <script type="application/json">:
     #editor-schema     وصف كل أنواع البلوكات وحقولها
     #editor-document   مستند الدعوة الحالي
     #editor-meta       الروابط والمعرّفات
     #editor-features   المزايا المتاحة في باقة العميل
     #editor-assets     الملفات المرفوعة
   بهذا الفصل يستحيل أن يكسر أي منسّق HTML هذا الكود.
   ================================================================ */
(function () {
  "use strict";

  // ---------------------------------------------------------- أدوات
  var doc = document;
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function el(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function readJSON(id, fallback) {
    var node = doc.getElementById(id);
    if (!node) return fallback;
    try { return JSON.parse(node.textContent); } catch (e) { return fallback; }
  }
  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    };
  }
  function uid(type) {
    return type + "-" + Math.random().toString(36).slice(2, 8);
  }
  function csrf() {
    var m = doc.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  // ---------------------------------------------------------- الحالة
  var SCHEMA = readJSON("editor-schema", { blocks: {}, theme_fields: [], settings_fields: [] });
  var META = readJSON("editor-meta", { urls: {} });
  var FEATURES = readJSON("editor-features", []);
  var FONTS = readJSON("editor-fonts", []);
  var FAVORITES = readJSON("editor-favorites", []);
  var ASSETS = readJSON("editor-assets", []);

  var MUSIC = readJSON("editor-music", []);   // مكتبة الموسيقى المشتركة
  var INTROS = readJSON("editor-intros", []); // معرض فيديوهات الافتتاحية

  var state = {
    doc: readJSON("editor-document", { theme: {}, settings: {}, blocks: [] }),
    selected: null,
    selEl: null,        // العنصر المحدَّد جوّه قسم مستورد (اسم data-move)
    fromPreview: false, // الاختيار جه من ضغطة جوّه المعاينة؟ (يمنع قفزة التمرير)
    clip: null,         // حافظة عناصر القوالب المستوردة (نسخ/لصق)
    device: "mobile",
    dirty: false,
    saving: false,
        history: [],
    future: [],
    layersOpen: false,
    sectionBoundsBlock: null

  };

  var refs = {};
  var HISTORY_MAX = 60;

  function hasFeature(key) { return !key || FEATURES.indexOf(key) !== -1; }
  function blockSpec(type) { return SCHEMA.blocks[type]; }
  function findBlock(id) {
    for (var i = 0; i < state.doc.blocks.length; i++) {
      if (state.doc.blocks[i].id === id) return state.doc.blocks[i];
    }
    return null;
  }
  function blockIndex(id) {
    for (var i = 0; i < state.doc.blocks.length; i++) {
      if (state.doc.blocks[i].id === id) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------- التاريخ
  function snapshot() {
    state.history.push(JSON.stringify(state.doc));
    if (state.history.length > HISTORY_MAX) state.history.shift();
    state.future.length = 0;
    updateHistoryButtons();
  }
  function undo() {
    if (!state.history.length) return;
    state.future.push(JSON.stringify(state.doc));
    state.doc = JSON.parse(state.history.pop());
    afterHistory();
  }
  function redo() {
    if (!state.future.length) return;
    state.history.push(JSON.stringify(state.doc));
    state.doc = JSON.parse(state.future.pop());
    afterHistory();
  }
  function afterHistory() {
    if (state.selected && !findBlock(state.selected)) state.selected = null;
    renderBlockList();
    renderInspector();
    renderThemePane();
    renderSettingsPane();
    markDirty();
    requestPreview();
    updateHistoryButtons();
  }
  function updateHistoryButtons() {
    if (refs.undo) refs.undo.disabled = !state.history.length;
    if (refs.redo) refs.redo.disabled = !state.future.length;
  }

  // ---------------------------------------------------------- حالة الحفظ
  function setSaveState(kind, text) {
    if (!refs.saveState) return;
    refs.saveState.className = "ed-save-state is-" + kind;
    refs.saveState.textContent = text;
  }
  function markDirty() {
    state.dirty = true;
    setSaveState("dirty", "تغييرات غير محفوظة");
    scheduleAutosave();
  }

  // ------------------------------------------------------- الحفظ التلقائي
  /* المستند بيتبعت كامل في كل حفظة، والقوالب المستوردة تقيلة — فالحفظ
     بيستنى سكوت كامل بدل ما يترمي مع كل حرف أو مع كل بكسل في السلايدر.
     السحب بيأجّله كمان: مافيش فايدة نحفظ نص حركة.
     ‎save()‎ نفسها بترجّع فوراً لو في حفظة شغالة، فمفيش طلبين مع بعض. */
  var AUTOSAVE_IDLE = 2500;      // ملّي ثانية سكوت قبل الحفظ
  var AUTOSAVE_RETRY = 1200;     // إعادة محاولة لو لسه بنسحب أو بنحفظ
  var autosaveTimer = null;
  var autosaveOff = false;

  function scheduleAutosave() {
    if (autosaveOff || !META || !META.urls || !META.urls.save) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(runAutosave, AUTOSAVE_IDLE);
  }

  function runAutosave() {
    autosaveTimer = null;
    if (autosaveOff || !state.dirty) return;
    // لسه بيسحب أو بيكتب أو في حفظة شغالة — نأجّل بدل ما نقاطعه
    if (drag || state.saving || isTypingNow()) {
      autosaveTimer = setTimeout(runAutosave, AUTOSAVE_RETRY);
      return;
    }
    save(true).then(function (ok) {
      // فشل الاتصال بيوقف التكرار: ‎save‎ عرضت الخطأ خلاص، ومحاولة كل
      // ثانيتين هتفضل ترمي رسائل. زر «حفظ» اليدوي فاضل شغال.
      if (!ok) autosaveOff = true;
    });
  }

  function isTypingNow() {
    var fdoc = frameDoc();
    var active = fdoc && fdoc.activeElement;
    return !!(active && active.getAttribute &&
              active.getAttribute("contenteditable") === "true");
  }

  // ---------------------------------------------------------- التنبيهات
  function toast(message, kind) {
    var box = refs.toasts;
    if (!box) return;
    var t = el("div", "ed-toast" + (kind ? " ed-toast--" + kind : ""), message);
    box.appendChild(t);
    setTimeout(function () {
      t.style.opacity = "0";
      setTimeout(function () { t.remove(); }, 250);
    }, kind === "error" ? 5200 : 2800);
  }

  // ==========================================================
  // بناء الحقول من الـschema
  // ==========================================================
  function addFontOption(select, font) {
    if (!select || !font || !font.value) return;
    var exists = Array.prototype.some.call(select.options, function (o) {
      return o.value === font.value;
    });
    if (exists) return;
    var option = el("option", null, font.label || font.name || font.family);
    option.value = font.value;
    option.style.fontFamily = font.value;
    select.appendChild(option);
  }

  function fontUploadError(data) {
    var errors = data && data.errors;
    if (errors && typeof errors === "object") {
      return Object.keys(errors).map(function (key) {
        return Array.isArray(errors[key]) ? errors[key].join("، ") : String(errors[key]);
      }).join(" — ");
    }
    return (data && data.error) || "تعذّر إضافة الخط.";
  }

  function uploadedFontFamily(filename) {
    var stem = String(filename || "").replace(/\.[^.]+$/, "");
    stem = stem.replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!/^[A-Za-z]/.test(stem)) stem = "UploadedFont";
    return stem.slice(0, 118) || "UploadedFont";
  }

  function uploadFontFile(select, setValue, file) {
    if (!file) return;
    var stem = String(file.name || "").replace(/\.[^.]+$/, "").trim();
    var fd = new FormData();
    fd.append("name", (stem || "خط مرفوع").slice(0, 120));
    fd.append("family", uploadedFontFamily(file.name));
    fd.append("weight", "400");
    fd.append("style", "normal");
    fd.append("is_active", "on");
    fd.append("file", file);
    fetch(META.urls.fontCreate, {
      method: "POST",
      headers: { "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: fd
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data || !data.ok || !data.font) {
        toast(fontUploadError(data), "error");
        return;
      }
      FONTS.push(data.font);
      addFontOption(select, data.font);
      select.value = data.font.value;
      setValue(select.value);
      toast("اتضاف الخط للمكتبة واتطبق على النص.", "ok");
    }).catch(function () { toast("تعذّر الاتصال لإضافة الخط.", "error"); });
  }

  function buildInlineFontTools(select, setValue) {
    var tools = el("div", "ed-font-tools ed-font-tools--compact");
    var separator = el("option", null, "──────── إضافة خط ────────");
    separator.value = "";
    separator.disabled = true;
    select.appendChild(separator);

    var importOption = el("option", null, "استيراد خط من المكتبة");
    importOption.value = "__font_library__";
    select.appendChild(importOption);
    var uploadOption = el("option", null, "رفع خط من الملفات");
    uploadOption.value = "__font_upload__";
    select.appendChild(uploadOption);

    var library = doc.createElement("select");
    library.className = "ed-input";
    library.hidden = true;
    var libraryPlaceholder = el("option", null, "اختار خطاً من المكتبة");
    libraryPlaceholder.value = "";
    library.appendChild(libraryPlaceholder);
    if (FONTS.length) {
      FONTS.forEach(function (font) {
        if (!font || !font.value) return;
        var option = el("option", null, font.label || font.name || font.family);
        option.value = font.value;
        option.style.fontFamily = font.value;
        library.appendChild(option);
      });
    } else {
      var empty = el("option", null, "لا توجد خطوط مرفوعة بعد");
      empty.disabled = true;
      library.appendChild(empty);
    }

    var file = doc.createElement("input");
    file.type = "file";
    file.accept = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
    file.hidden = true;
    select.__fontRealValue = select.value || "";

    select.addEventListener("change", function () {
      var choice = select.value;
      if (choice === "__font_library__") {
        select.value = select.__fontRealValue || "";
        library.hidden = false;
        library.focus();
      } else if (choice === "__font_upload__") {
        select.value = select.__fontRealValue || "";
        file.click();
      } else {
        select.__fontRealValue = choice;
      }
    });
    library.addEventListener("change", function () {
      if (!library.value) return;
      select.value = library.value;
      select.__fontRealValue = library.value;
      setValue(select.value);
      library.hidden = true;
      toast("اتطبق الخط من المكتبة.", "ok");
    });
    file.addEventListener("change", function () {
      uploadFontFile(select, setValue, file.files && file.files[0]);
      file.value = "";
    });
    tools.appendChild(library);
    tools.appendChild(file);
    return tools;
  }

  /* ---------------------------------------------------------------
     ترس النص — تنسيق كل نص جوّه ترسه هو

     مفيش خريطة مكتوبة بالإيد هنا خالص. المخطط الجاي من ‎blocks.py‎
     بيعلّم كل حقل تنسيق بـ‎style_of‎ (بتاع أنهي نص) و‎style_role‎
     (الترتيب جوّه اللوحة)، والدالة دي بتلمّهم من نفس قايمة الحقول
     اللي الحقل الأب فيها — يعني حقل جديد في بايثون بيظهر في الترس
     من غير أي سطر جافاسكربت.

     ‎setBySpec‎ بيكتب في مفتاح الحقل اللي تديهوله، مش في مفتاح الحقل
     الأب. من غيره القيمة كانت بتتكتب مكان **نص الحقل** نفسه. */
  var TEXT_STYLE_ORDER = {
    font: 1, color: 2, size: 3, weight: 4, align: 5, ls: 6, lh: 7, zz_extra: 9
  };

  function textStyleChildren(ctx, key) {
    var specs = (ctx && ctx.specs) || [];
    var out = [];
    for (var i = 0; i < specs.length; i++) {
      if (specs[i] && specs[i].style_of === key) out.push(specs[i]);
    }
    out.sort(function (a, b) {
      return (TEXT_STYLE_ORDER[a.style_role] || 8) -
             (TEXT_STYLE_ORDER[b.style_role] || 8);
    });
    return out;
  }

  function buildTextStyleGear(spec, ctx, setBySpec) {
    if (!ctx || typeof setBySpec !== "function") return null;
    var children = textStyleChildren(ctx, spec.key);
    if (!children.length) return null;

    var gear = el("button", "ed-font-gear", "⚙");
    gear.type = "button";
    gear.title = "تنسيق النص: الخط واللون والحجم";
    gear.setAttribute("aria-label", "تنسيق النص");
    var panel = el("div", "ed-inline-font-panel");
    panel.hidden = true;
    children.forEach(function (child) {
      panel.appendChild(buildField(
        child,
        function () { return ctx.get(child); },
        function (v) { setBySpec(child, v); }
      ));
    });
    gear.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      gear.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    });
    return { gear: gear, panel: panel };
  }

  /* عنصر القايمة ممكن يبقى نوعه مختلف عن اللي جنبه (نص/صورة/زرار).
     ‎show_kind‎ في المخطط بيقول الحقل ده لأنهي نوع. النوع بيتحدد وقت
     الإضافة ومابيتغيّرش، فمفيش داعي نعيد بناء الكارت. */
  function fieldFitsItem(sub, item) {
    if (!sub || !sub.show_kind || !sub.show_kind.length) return true;
    var kind = (item && item.kind) || "text";
    return sub.show_kind.indexOf(kind) !== -1;
  }

  var LIST_ITEM_ICONS = { text: "¶", image: "▣", button: "⬬" };

  /** عنوان كارت العنصر — أول حاجة فيه كلام، وإلا نوعه. */
  function listItemTitle(spec, item, index) {
    var fields = spec.fields || [];
    for (var i = 0; i < fields.length; i++) {
      var sub = fields[i];
      if (!fieldFitsItem(sub, item)) continue;
      if (sub.type !== "text" && sub.type !== "textarea") continue;
      var value = item[sub.key];
      if (typeof value === "string" && value.trim()) {
        return String(value).trim().slice(0, 40);
      }
    }
    if (item && item.kind && LIST_ITEM_ICONS[item.kind]) {
      var kindLabel = { text: "نص", image: "صورة", button: "زرار" }[item.kind];
      return LIST_ITEM_ICONS[item.kind] + " " + kindLabel + " " + (index + 1);
    }
    return String(item.label || item.name || ("عنصر " + (index + 1))).slice(0, 40);
  }

  /** يحط حقل النص ومعاه ترسه لو ليه تنسيق، وإلا يحطه لوحده. */
  function appendWithGear(wrap, input, spec, ctx, setBySpec) {
    var gear = buildTextStyleGear(spec, ctx, setBySpec);
    if (!gear) { wrap.appendChild(input); return; }
    var row = el("div", "ed-text-control-row");
    row.appendChild(input);
    row.appendChild(gear.gear);
    wrap.appendChild(row);
    wrap.appendChild(gear.panel);
  }

  function buildField(spec, getValue, setValue, setBySpec, ctx) {

    var wrap = el("div", "ed-field");
    // الميزة خارج الباقة = تحذير فقط؛ الحقل يظل قابلاً للتعديل والحفظ.
    var gated = !hasFeature(spec.feature);
    var disabled = false;

    var label = el("label");
    label.appendChild(el("span", null, spec.label));
    if (gated) {
      var lock = el("b", null, "تحذير: خارج الباقة");
      lock.style.fontSize = "10px";
      lock.style.color = "var(--e-warn, #a66a00)";
      label.appendChild(lock);
    }

    var value = getValue();
    var input;

    switch (spec.type) {
      // ---------------------------------------------------- نص
      case "text":
      case "url":
      case "date":
      case "datetime":
        input = el("input", "ed-input");
        input.type = spec.type === "datetime" ? "datetime-local"
          : spec.type === "date" ? "date"
            : spec.type === "url" ? "url" : "text";
        input.value = value == null ? "" : value;
        if (spec.placeholder) input.placeholder = spec.placeholder;
                input.addEventListener("input", function () { setValue(input.value); });
        wrap.appendChild(label);
        appendWithGear(wrap, input, spec, ctx, setBySpec);
        break;

      case "textarea":

      case "html":
        input = el("textarea");
        input.rows = spec.type === "html" ? 5 : 3;
        input.value = value == null ? "" : value;
        input.addEventListener("input", function () { setValue(input.value); });
        wrap.appendChild(label);
        appendWithGear(wrap, input, spec, ctx, setBySpec);
        break;

      // ---------------------------------------------------- رقم / شريط
      case "number":
        input = el("input", "ed-input");
        input.type = "number";
        if (spec.min != null) input.min = spec.min;
        if (spec.max != null) input.max = spec.max;
        input.value = value == null ? "" : value;
        input.addEventListener("input", function () { setValue(input.value); });
        wrap.appendChild(label);
        wrap.appendChild(input);
        break;

      case "range": {
        var out = el("b", null, String(value) + (spec.unit || ""));
        label.appendChild(out);
        input = doc.createElement("input");
        input.type = "range";
        if (spec.min != null) input.min = spec.min;
        if (spec.max != null) input.max = spec.max;
        if (spec.step != null) input.step = spec.step;
        input.value = value;
        var num = el("input", "ed-input");
        num.type = "number";
        num.style.width = "72px";
        num.value = value;
        if (spec.min != null) num.min = spec.min;
        if (spec.max != null) num.max = spec.max;
        if (spec.step != null) num.step = spec.step;

        input.addEventListener("input", function () {
          out.textContent = input.value + (spec.unit || "");
          num.value = input.value;
          setValue(input.value);
        });
        num.addEventListener("input", function () {
          input.value = num.value;
          out.textContent = num.value + (spec.unit || "");
          setValue(num.value);
        });
        var row = el("div", "ed-row");
        row.appendChild(input);
        row.appendChild(num);
        wrap.appendChild(label);
        wrap.appendChild(row);
        break;
      }

      // ---------------------------------------------------- لون
      case "color": {
        var picker = doc.createElement("input");
        picker.type = "color";
        picker.value = /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#b8914f";
        var hex = el("input", "ed-input");
        hex.type = "text";
        hex.value = value == null ? "" : value;
        hex.placeholder = "افتراضي القالب";
        picker.addEventListener("input", function () {
          hex.value = picker.value;
          setValue(picker.value);
        });
        hex.addEventListener("input", function () {
          if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value;
          setValue(hex.value);
        });
        var cbox = el("div", "ed-color-row");
        cbox.appendChild(picker);
        cbox.appendChild(hex);
        if (spec.key === "bg_color") {
          var clearColor = el("button", "ed-btn ed-btn--sm ed-color-clear", "مسح");
          clearColor.type = "button";
          clearColor.title = "مسح لون الخلفية والعودة للون القالب";
          clearColor.addEventListener("click", function () {
            hex.value = "";
            picker.value = "#b8914f";
            setValue("");
          });
          cbox.appendChild(clearColor);
        }
        wrap.appendChild(label);
        wrap.appendChild(cbox);
        break;
      }

      // ---------------------------------------------------- اختيار
      case "select":
      case "font": {
        input = doc.createElement("select");
        var opts = (spec.options || SCHEMA.fonts || []).slice();
        if (spec.type === "font") {
          var seenFonts = {};
          opts.forEach(function (o) { if (o && o.value) seenFonts[o.value] = true; });
          FONTS.forEach(function (font) {
            if (!font || !font.value || seenFonts[font.value]) return;
            opts.push({ value: font.value, label: "من مكتبة الخطوط — " + (font.label || font.name || font.family) });
            seenFonts[font.value] = true;
          });
          var blank = el("option", null, "— افتراضي القالب —");

          blank.value = "";
          input.appendChild(blank);
        }
        opts.forEach(function (o) {
          var op = el("option", null, o.label);
          op.value = o.value;
          if (spec.type === "font") op.style.fontFamily = o.value;
          input.appendChild(op);
        });
                input.value = value == null ? "" : value;
        input.addEventListener("change", function () {
          if (input.value === "__font_library__" || input.value === "__font_upload__") return;
          setValue(input.value);
        });
        wrap.appendChild(label);

        wrap.appendChild(input);
        // إضافة الخط تتم من نفس القائمة؛ تفاصيل الاسم والوزن والنمط لم تعد
        // تظهر في المحرر، بينما الرفع يرسل قيماً افتراضية آمنة للخلفية.
        wrap.appendChild(buildInlineFontTools(input, setValue));
        break;

      }

      // ---------------------------------------------------- محاذاة

      case "align": {
        var group = el("div", "ed-align");
        [["right", "يمين"], ["center", "وسط"], ["left", "يسار"]].forEach(function (pair) {
          var b = el("button", null, pair[1]);
          b.type = "button";
          if (value === pair[0]) b.classList.add("is-active");
          b.addEventListener("click", function () {
            $$("button", group).forEach(function (x) { x.classList.remove("is-active"); });
            b.classList.add("is-active");
            setValue(pair[0]);
          });
          group.appendChild(b);
        });
        wrap.appendChild(label);
        wrap.appendChild(group);
        break;
      }

      // ---------------------------------------------------- مفتاح
      case "toggle": {
        var tl = el("label", "ed-toggle");
        tl.appendChild(el("span", null, spec.label));
        var chk = doc.createElement("input");
        chk.type = "checkbox";
        chk.checked = !!value;
        chk.disabled = disabled;
        chk.addEventListener("change", function () { setValue(chk.checked); });
        tl.appendChild(chk);
        tl.appendChild(el("span", "ed-switch"));
        wrap.appendChild(tl);
        break;
      }

      // ---------------------------------------------------- صورة
      case "media":
      case "image": {
        var mediaKind = spec.media_kind || "image";
        var isImage = mediaKind === "image";
        var thumb = el("div", "ed-image-thumb");
        thumb.setAttribute("role", "button");
        thumb.tabIndex = 0;
        function paint(v) {
          if (v && isImage) {
            thumb.style.backgroundImage = 'url("' + String(v).replace(/"/g, "%22") + '")';
            thumb.textContent = "";
          } else {
            thumb.style.backgroundImage = "";
            thumb.textContent = v ? (mediaKind === "video" ? "▶" : "♪") : "＋";
          }
        }
        paint(value);
        var urlInput = el("input", "ed-input");
        urlInput.type = "text";
        urlInput.placeholder = isImage ? "أو الصق رابط صورة" : "أو الصق رابط الملف";
        urlInput.value = value == null ? "" : value;
                urlInput.addEventListener("input", function () {
          paint(urlInput.value);
          if (mediaKind === "video" && spec.key === "intro_video") {
            state.doc.settings.intro_poster = "";
          }
          setValue(urlInput.value);
        });

        var pickBtn = el("button", "ed-btn ed-btn--sm",
          isImage ? "اختر أو ارفع صورة" : (mediaKind === "video" ? "اختر أو ارفع فيديو" : "اختر أو ارفع ملف"));
        pickBtn.type = "button";
                function open() {
          openAssetPicker(function (url, meta) {
            urlInput.value = url;
            paint(url);
            if (mediaKind === "video" && spec.key === "intro_video") {
              state.doc.settings.intro_poster = (meta && (meta.poster || meta.thumb)) || "";
            }
            setValue(url);
          }, mediaKind);
        }

        pickBtn.addEventListener("click", open);
        thumb.addEventListener("click", open);
        thumb.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });

        var side = el("div", "ed-image-side");
        side.appendChild(urlInput);
        side.appendChild(pickBtn);

        if (isImage) {
          var cropBtn = el("button", "ed-btn ed-btn--sm", "قصّ الصورة");
          cropBtn.type = "button";
          cropBtn.addEventListener("click", function () {
            var current = urlInput.value;
            var asset = null;
            for (var i = 0; i < ASSETS.length; i++) {
              if (ASSETS[i].url === current) { asset = ASSETS[i]; break; }
            }
            if (!asset) {
              toast("اختر صورة من المكتبة الأول عشان تقدر تقصها.", "error");
              return;
            }
            openCropper(asset, function (url) {
              urlInput.value = url;
              paint(url);
              setValue(url);
            });
          });
          side.appendChild(cropBtn);
        }
        var ibox = el("div", "ed-image");
        ibox.appendChild(thumb);
        ibox.appendChild(side);
        wrap.appendChild(label);
        wrap.appendChild(ibox);
        break;
      }

      // ---------------------------------------------------- أيقونة
      case "icon": {
        input = doc.createElement("select");
        var none = el("option", null, "— بدون —");
        none.value = "";
        input.appendChild(none);
        ["calendar", "clock", "pin", "heart", "ring", "gift", "phone",
          "star", "music", "camera", "cake", "car", "dress", "info"].forEach(function (n) {
          var op = el("option", null, n);
          op.value = n;
          input.appendChild(op);
        });
        input.value = value || "";
        input.addEventListener("change", function () { setValue(input.value); });
        wrap.appendChild(label);
        wrap.appendChild(input);
        break;
      }

      // ---------------------------------------------------- قائمة متكررة
      case "list": {
        var listBox = el("div", "ed-list");
        var items = Array.isArray(value) ? value : [];

        function redraw() {
          listBox.replaceChildren();
          if (!items.length) {
            listBox.appendChild(el("p", "ed-hint", "لا توجد عناصر بعد."));
          }
          items.forEach(function (item, index) {
            var card = el("div", "ed-list-item");
            var head = el("div", "ed-list-head");
            head.appendChild(el("span", null, listItemTitle(spec, item, index)));

            var up = el("button", "ed-icon-btn", "▲");
            up.type = "button"; up.title = "لأعلى";
            up.addEventListener("click", function () {
              if (index === 0) return;
              snapshot();
              items.splice(index - 1, 0, items.splice(index, 1)[0]);
              setValue(items); redraw(); requestPreview();
            });

            var down = el("button", "ed-icon-btn", "▼");
            down.type = "button"; down.title = "لأسفل";
            down.addEventListener("click", function () {
              if (index >= items.length - 1) return;
              snapshot();
              items.splice(index + 1, 0, items.splice(index, 1)[0]);
              setValue(items); redraw(); requestPreview();
            });

            var dup = el("button", "ed-icon-btn", "⧉");
            dup.type = "button"; dup.title = "تكرار";
            dup.addEventListener("click", function () {
              snapshot();
              items.splice(index + 1, 0, clone(item));
              setValue(items); redraw(); requestPreview();
            });

            var del = el("button", "ed-icon-btn", "✕");
            del.type = "button"; del.title = "حذف";
            del.addEventListener("click", function () {
              snapshot();
              items.splice(index, 1);
              setValue(items); redraw(); requestPreview();
            });

            head.appendChild(up); head.appendChild(down);
            head.appendChild(dup); head.appendChild(del);
            card.appendChild(head);

            var body = el("div", "ed-list-body");
            /* عنصر القايمة بيتخزن لوحده، فالترس بيتبني من حقول العنصر
               نفسه: ‎ctx.get‎ بتقرا من ‎item‎ و‎setBySpec‎ بتكتب فيه.
               من غير التمرير ده كان نص الأوفرلاي — وهو نص زي أي نص —
               يفضل من غير ترس وحقوله مفرودة تحته. */
            var itemSet = function (sub, v) {
              item[sub.key] = v;
              setValue(items);
              head.firstChild.textContent = listItemTitle(spec, item, index);
            };
            var itemCtx = {
              specs: spec.fields || [],
              get: function (sub) { return item[sub.key]; }
            };
            (spec.fields || []).forEach(function (sub) {
              // الحقول اللي جوّه الترس مابتتفردش تحته
              if (sub.editor_hidden) return;
              // ولا حقول نوع تاني (صورة في عنصر نص مثلاً)
              if (!fieldFitsItem(sub, item)) return;
              body.appendChild(buildField(
                sub,
                function () { return item[sub.key]; },
                function (v) { itemSet(sub, v); },
                itemSet,
                itemCtx
              ));
            });
            card.appendChild(body);
            listBox.appendChild(card);
          });
        }
        redraw();

        function addItem(variant) {
          snapshot();
          var row = {};
          (spec.fields || []).forEach(function (sub) { row[sub.key] = clone(sub.default); });
          if (variant) {
            row[variant.key] = variant.value;
            Object.keys(variant.seed || {}).forEach(function (k) {
              row[k] = variant.seed[k];
            });
          }
          items.push(row);
          setValue(items);
          redraw();
          requestPreview();
        }

        /* قايمة ليها أكتر من نوع عنصر (نص/صورة/زرار) بتعرض زرار لكل
           نوع **فوق** القايمة، عشان تبان من أول نظرة بدل ما تبقى
           مدفونة تحت العناصر. */
        var addBox;
        if ((spec.add_variants || []).length) {
          addBox = el("div", "ed-add-row");
          spec.add_variants.forEach(function (variant) {
            var b = el("button", "ed-btn ed-btn--sm ed-add-btn", variant.label);
            b.type = "button";
            b.addEventListener("click", function () { addItem(variant); });
            addBox.appendChild(b);
          });
        } else {
          addBox = el("button", "ed-btn ed-btn--sm ed-btn--block",
                      "＋ " + (spec.add_label || "إضافة عنصر"));
          addBox.type = "button";
          addBox.addEventListener("click", function () { addItem(null); });
        }

        wrap.appendChild(label);
        if (spec.add_variants) {
          wrap.appendChild(addBox);
          wrap.appendChild(listBox);
        } else {
          wrap.appendChild(listBox);
          wrap.appendChild(addBox);
        }
        break;
      }

      default:
        input = el("input", "ed-input");
        input.value = value == null ? "" : value;
        input.addEventListener("input", function () { setValue(input.value); });
        wrap.appendChild(label);
        wrap.appendChild(input);
    }

    // نسم الحقل بمفتاحه حتى يمكن مزامنته مع التحرير المباشر داخل المعاينة.
    // حقول التنسيق اللي جوّه الترس علّمت نفسها بمفاتيحها وهي بتتبني،
    // فمابنكتبش فوقها بمفتاح الحقل الأب.
    $$("input, textarea, select", wrap).forEach(function (n) {
      if (n.dataset.fieldKey) return;
      if (n.type !== "range" && n.type !== "color" && n.type !== "file") {
        n.dataset.fieldKey = spec.key;
      }
    });

    if (spec.help) wrap.appendChild(el("small", null, spec.help));
    if (disabled) {
      wrap.style.opacity = ".5";
      $$("input, select, textarea, button", wrap).forEach(function (n) { n.disabled = true; });
    }
    return wrap;
  }

  function buildGroups(specs, getValue, setValue, openFirst) {
    var frag = doc.createDocumentFragment();
    var groups = {};
    var order = [];
    specs.forEach(function (spec) {
      if (spec.editor_hidden) return;
      var g = spec.group || "المحتوى";
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(spec);
    });
    order.forEach(function (name, i) {
      var details = el("details", "ed-group");
      if (i === 0 && openFirst !== false) details.open = true;
      /* مجموعة بتفتح لوحدها مهما كان ترتيبها — للأدوات اللي المفروض
         تبان من غير ما المستخدم يدوّر عليها (زي أزرار إضافة عنصر). */
      if (groups[name].some(function (s) { return s.group_open; })) {
        details.open = true;
        details.classList.add("ed-group--accent");
      }
      var sum = el("summary");
      sum.appendChild(el("span", null, name));
      details.appendChild(sum);
      var body = el("div", "ed-group-body");
      // ‎ctx‎ بيدّي الترس طريقه لإخوات الحقل: القايمة نفسها عشان يلاقي
      // حقول التنسيق بتاعته، و‎get‎ عشان يقرا قيمة كل واحد فيهم.
      var ctx = { specs: specs, get: getValue };
      groups[name].forEach(function (spec) {
        body.appendChild(buildField(
          spec,
          function () { return getValue(spec); },
          function (v) { setValue(spec, v); },
          setValue,
          ctx
        ));
      });
      details.appendChild(body);
      frag.appendChild(details);
    });
    return frag;
  }

  function favoriteTypeLabel(type) {
    var spec = blockSpec(type);
    return spec && spec.label ? spec.label : type || "عنصر";
  }

  function renderFavorites() {
    var box = refs.favoritesBody;
    if (!box) return;
    box.replaceChildren();
    if (!FAVORITES.length) {
      box.appendChild(el("p", "ed-empty", "مكتبة المفضلة فاضية. اختَر قسماً واضغط «حفظ كمفضلة»."));
      return;
    }
    FAVORITES.forEach(function (favorite) {
      var row = el("div", "ed-favorite-row");
      var info = el("div", "ed-favorite-info");
      info.appendChild(el("strong", null, favorite.name));
      info.appendChild(el("small", "ed-hint", favoriteTypeLabel(favorite.blockType)));
      var use = el("button", "ed-btn ed-btn--sm ed-btn--primary", "استخدام");
      use.type = "button";
      use.addEventListener("click", function () { addFavoriteToDocument(favorite); });
      var remove = el("button", "ed-btn ed-btn--sm", "حذف");
      remove.type = "button";
      remove.addEventListener("click", function () { deleteFavorite(favorite.id); });
      row.appendChild(info);
      row.appendChild(use);
      row.appendChild(remove);
      box.appendChild(row);
    });
  }

  function openFavoriteLibrary() {
    renderFavorites();
    openModal(refs.favoritesModal);
  }

  function saveSelectedAsFavorite() {
    var block = state.selected ? findBlock(state.selected) : null;
    if (!block) {
      toast("اختَر قسماً أولاً لحفظه كمفضلة.", "error");
      return;
    }
    var name = window.prompt("اكتب اسماً لهذا العنصر المفضل:", block.label || favoriteTypeLabel(block.type));
    if (!name || !name.trim()) return;
    fetch(META.urls.favoriteCreate, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify({ name: name.trim(), block: clone(block) })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data || !data.ok || !data.favorite) {
        toast((data && data.error) || "تعذّر حفظ العنصر كمفضلة.", "error");
        return;
      }
      FAVORITES.unshift(data.favorite);
      toast("اتحفظ العنصر في مكتبة المفضلة.", "ok");
    }).catch(function () { toast("تعذّر الاتصال لحفظ المفضلة.", "error"); });
  }

  function addFavoriteToDocument(favorite) {
    var source = favorite && favorite.block ? clone(favorite.block) : null;
    if (!source || !source.type || !blockSpec(source.type)) {
      toast("العنصر المفضل غير صالح أو لم يعد مدعوماً.", "error");
      return;
    }
    var spec = blockSpec(source.type);
    if (spec.singleton && state.doc.blocks.some(function (b) { return b.type === source.type; })) {
      toast("هذا القسم موجود بالفعل ولا يمكن تكراره.", "error");
      return;
    }
    snapshot();
    source.id = uid(source.type);
    var after = state.selected ? blockIndex(state.selected) : state.doc.blocks.length - 1;
    state.doc.blocks.splice(Math.max(0, after + 1), 0, source);
    state.selected = source.id;
    renderBlockList();
    renderInspector();
    markDirty();
    requestPreview();
    closeModal(refs.favoritesModal);
    switchTab("inspector");
    toast("اتضافت نسخة من العنصر المفضل.", "ok");
  }

  function deleteFavorite(id) {
    if (!window.confirm("حذف العنصر من مكتبة المفضلة؟")) return;
    fetch(META.urls.favoriteDeleteBase + encodeURIComponent(id) + "/", {
      method: "POST",
      headers: { "X-CSRFToken": csrf() },
      credentials: "same-origin"
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data || !data.ok) {
        toast("تعذّر حذف المفضلة.", "error");
        return;
      }
      FAVORITES = FAVORITES.filter(function (item) { return String(item.id) !== String(id); });
      renderFavorites();
      toast("اتحذفت المفضلة.", "ok");
    }).catch(function () { toast("تعذّر الاتصال لحذف المفضلة.", "error"); });
  }

  // ==========================================================
  // قائمة الأقسام
  // ==========================================================
  var dragId = null;

  function renderBlockList() {
    var box = refs.blockList;
    if (!box) return;
    box.replaceChildren();

    if (!state.doc.blocks.length) {
      box.appendChild(el("p", "ed-empty", "لا توجد أقسام. اضغط «إضافة قسم» للبدء."));
      return;
    }

    state.doc.blocks.forEach(function (block) {
      var spec = blockSpec(block.type) || { label: block.type, icon: "□", feature: "" };
      var gated = !hasFeature(spec.feature);

      var row = el("div", "ed-block");
      row.dataset.id = block.id;
      row.draggable = true;
      if (block.id === state.selected) row.classList.add("is-selected");
      if (!block.visible) row.classList.add("is-hidden");

      row.appendChild(el("span", "ed-block-grip", "⠿"));
      row.appendChild(el("span", "ed-block-icon", spec.icon));
      // الاسم اللي كتبه المستخدم بيسبق اسم النوع — بيفرق جداً مع
      // القوالب المستوردة اللي كل أقسامها من نفس النوع
      var nameEl = el("span", "ed-block-name", block.label || spec.label);
      if (block.label) nameEl.title = block.label + " — " + spec.label;
      row.appendChild(nameEl);
      if (gated) row.appendChild(el("span", "ed-block-tag", "تحذير"));

      var actions = el("div", "ed-block-actions");

      var eye = el("button", "ed-icon-btn" + (block.visible ? " is-on" : ""), block.visible ? "◉" : "○");
      eye.type = "button";
      eye.title = block.visible ? "إخفاء القسم" : "إظهار القسم";
      eye.addEventListener("click", function (e) {
        e.stopPropagation();
        snapshot();
        block.visible = !block.visible;
        renderBlockList();
        markDirty();
        requestPreview();
      });

      var dup = el("button", "ed-icon-btn", "⧉");
      dup.type = "button";
      dup.title = "تكرار القسم";
      dup.addEventListener("click", function (e) {
        e.stopPropagation();
        if (spec.singleton) { toast("هذا القسم لا يمكن تكراره.", "error"); return; }
        snapshot();
        var copy = clone(block);
        copy.id = uid(block.type);
        state.doc.blocks.splice(blockIndex(block.id) + 1, 0, copy);
        state.selected = copy.id;
        renderBlockList(); renderInspector(); markDirty(); requestPreview();
      });

      var del = el("button", "ed-icon-btn", "✕");
      del.type = "button";
      del.title = "حذف القسم";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!window.confirm("حذف قسم «" + spec.label + "»؟")) return;
        snapshot();
        state.doc.blocks.splice(blockIndex(block.id), 1);
        if (state.selected === block.id) state.selected = null;
        renderBlockList(); renderInspector(); markDirty(); requestPreview();
      });

      actions.appendChild(eye);
      actions.appendChild(dup);
      actions.appendChild(del);
      row.appendChild(actions);

      row.addEventListener("click", function () { selectBlock(block.id); });

      // ---- السحب والإفلات
      row.addEventListener("dragstart", function (e) {
        dragId = block.id;
        row.classList.add("is-dragging");
        try { e.dataTransfer.setData("text/plain", block.id); } catch (err) {}
        e.dataTransfer.effectAllowed = "move";
      });
      row.addEventListener("dragend", function () {
        dragId = null;
        $$(".ed-block", box).forEach(function (n) {
          n.classList.remove("is-dragging", "is-over");
        });
      });
      row.addEventListener("dragover", function (e) {
        e.preventDefault();
        if (dragId && dragId !== block.id) row.classList.add("is-over");
      });
      row.addEventListener("dragleave", function () { row.classList.remove("is-over"); });
      row.addEventListener("drop", function (e) {
        e.preventDefault();
        row.classList.remove("is-over");
        if (!dragId || dragId === block.id) return;
        snapshot();
        var from = blockIndex(dragId);
        var to = blockIndex(block.id);
        if (from < 0 || to < 0) return;
        state.doc.blocks.splice(to, 0, state.doc.blocks.splice(from, 1)[0]);
        renderBlockList(); markDirty(); requestPreview();
      });

      box.appendChild(row);
    });
  }

  function selectBlock(id) {
    if (state.sectionBoundsBlock && state.sectionBoundsBlock !== id) {
      state.sectionBoundsBlock = null;
      clearSectionBounds();
    }
    state.selected = id;
    renderBlockList();
    renderInspector();
    switchTab("inspector");
    highlightInPreview(id);
  }

  // ==========================================================
  // لوحة خصائص القسم
  // ==========================================================
  // إعادة بناء لوحة الخصائص بعد تعديل الموضع كانت بتقفل كل <details>.
  // نحتفظ بحالة الفتح حسب عنوان المجموعة، ثم نرجعها بعد البناء.
  function captureInspectorGroups() {
    var open = {};
    var box = refs.inspector;
    if (!box) return open;
    $$('details.ed-group', box).forEach(function (group, index) {
      if (group.parentElement !== box) return;
      var summary = group.querySelector('summary');
      var key = summary ? String(summary.textContent || '').trim() : ('group-' + index);
      if (key) open[key] = !!group.open;
    });
    return open;
  }

  function restoreInspectorGroups(open) {
    var box = refs.inspector;
    if (!box || !open) return;
    $$('details.ed-group', box).forEach(function (group, index) {
      if (group.parentElement !== box) return;
      var summary = group.querySelector('summary');
      var key = summary ? String(summary.textContent || '').trim() : ('group-' + index);
      if (Object.prototype.hasOwnProperty.call(open, key)) {
        group.open = open[key];
      }
    });
  }

  /* لازم تطابق ‎_SECTION_HEIGHT_MEDIA‎ في ‎tildacss.py‎ بالظبط، وإلا اللي
     تشوفه في المحرر يختلف عن اللي يتولّد على السيرفر. */
  var SECTION_HEIGHT_MEDIA = {
    /* ‎frame‎ = عرض إطار المحرر اللي الارتفاع اتسحب وهو شايفه. لو
       موجود، الارتفاع بيتكتب نسبة من عرض القسم مش بكسل ثابت — عشان
       نسبة الصندوق تفضل واحدة على أي تليفون، فخلفية ‎cover‎ تتقص زي
       ما بتتقص في المحرر بالظبط. */
    mobile: { key: "section_height_mobile", query: "@media (max-width:480px)",
              frame: 390 },
    tablet: { key: "section_height_tablet",
              query: "@media (min-width:481px) and (max-width:960px)",
              frame: 0 },
    desktop: { key: "section_height_desktop", query: "@media (min-width:961px)",
               frame: 0 }
  };

  /* عرض إطار الموبايل — الإطار اللي التصميم اتعمل وهو شايفه. */
  var MOBILE_FRAME = 390;

  /* نفس ‎_section_height_for‎ في ‎tildacss.py‎: قيمة المقاس نفسه ←
     القيمة القديمة الموحّدة ← تصميم الموبايل كنسبة. الخطوة
     التالتة بتمنع انهيار القسم على الشاشات الكبيرة: العناصر
     اللي فوق القسم كلها ‎absolute‎ فمابتضيفش طول، فالقسم
     بينهار على الحشو والعناصر تترصّ فوق بعضها. */
  function sectionHeightFor(st, key, frame, inheritPhone) {
    var value = Number(st[key] || 0);
    if (value > 0) return { value: value, frame: frame };
    var legacy = Number(st.section_height || 0);
    if (legacy > 0) return { value: legacy, frame: frame };
    if (key === "section_height_mobile" || !inheritPhone) return { value: 0, frame: frame };
    var inherited = Number(st.section_height_mobile || 0);
    if (inherited > 0) return { value: inherited, frame: MOBILE_FRAME };
    return { value: 0, frame: frame };
  }

  /** نفس ‎_section_height_value‎ في ‎tildacss.py‎ حرفاً بحرف. */
  function sectionHeightValue(value, frame) {
    if (!frame) return value + "px";
    var ratio = Math.round((value / frame) * 10000) / 10000;
    return "calc(100cqw*" + ratio + ")";
  }

  /* الارتفاع بالنسبة بيطلع بكسور (393 × 2.4359 = 957.297px)،
     والأقسام بتتراص تحت بعضها، فسفاري بيسيب جزء من
     البكسل مش مدهون فتبان خلفية المسرح زي خط أبيض بين
     الأقسام. نفس التقريب اللي في
     ``tildacss._section_height_decls`` بالظبط — لو اتغير هنا
     لازم يتغير هناك. */
  function sectionHeightDecls(size) {
    var plain = "height:" + size + "!important;min-height:" + size +
                "!important";
    if (size.indexOf("calc(") !== 0) return plain;
    var snapped = "round(" + size.slice(5, -1) + ",1px)";
    return plain + ";height:" + snapped + "!important;min-height:" +
           snapped + "!important";
  }

  function sectionHeightSpec() {
    return SECTION_HEIGHT_MEDIA[state.device] || SECTION_HEIGHT_MEDIA.mobile;
  }

  /* ستايل الإطار بيتحقن جوّه إطار المعاينة مش في صفحة المحرر — الاتنين
     مستندين مختلفين، و‎editor.css‎ مش بيوصل لجوّه. */
  var BOUNDS_STYLE = [
    ".lb-has-section-bounds{position:relative}",
    ".lb-section-bounds{position:absolute;inset:0;z-index:40;",
    "border:2px dashed rgba(197,160,90,.95);border-radius:6px;",
    "pointer-events:none}",
    ".lb-section-bounds__label{position:absolute;top:6px;left:6px;",
    "background:rgba(20,16,12,.86);color:#f5e9d2;padding:2px 8px;",
    "border-radius:999px;white-space:nowrap;direction:rtl;",
    "font:500 11px/1.7 system-ui,-apple-system,'Segoe UI',sans-serif}",
    ".lb-section-resize-handle{position:absolute;bottom:-11px;left:50%;",
    "transform:translateX(-50%);width:66px;height:22px;border-radius:999px;",
    "border:1px solid rgba(197,160,90,.95);background:#fff;color:#8a6a2f;",
    "cursor:ns-resize;pointer-events:auto;padding:0;",
    "box-shadow:0 2px 8px rgba(0,0,0,.18)}",
    ".lb-section-resize-handle::before{content:'';display:block;margin:auto;",
    "width:24px;height:2px;background:currentColor;border-radius:2px;",
    "box-shadow:0 5px 0 currentColor}",
    ".lb-section-resize-handle.is-dragging{background:#c5a05a;color:#fff}"
  ].join("");

  function ensureBoundsStyle(fdoc) {
    if (fdoc.querySelector("style[data-lb-bounds-style]")) return;
    var style = fdoc.createElement("style");
    style.setAttribute("data-lb-bounds-style", "1");
    style.textContent = BOUNDS_STYLE;
    (fdoc.head || fdoc.documentElement).appendChild(style);
  }

  /* ارتفاعات الأقسام لازم تتكتب من جديد بعد **كل** تحديث معاينة، مش
     وقت السحب بس.

     السبب: ‎applyPreview‎ بتستبدل ‎stage.innerHTML‎ وبتطبّق الخط
     والافتتاحية والموسيقى، لكنها **مابتجدّدش ‎zero_css‎** — الستايل
     اللي في رأس الإطار فاضل زي ما هو من أول تحميل الصفحة، بالارتفاع
     القديم. فكانت النتيجة إن السحب يشتغل، وبعد ثواني (لما المعاينة
     ترجع من السيرفر) القسم يرجع لحجمه الأصلي.

     عشان كده القاعدة دي مستقلة تماماً عن إطار الحدود: بتتكتب لكل
     الأقسام اللي ليها ارتفاع محفوظ، ومابتتشالش لما تقفل الإطار. */
  function syncSectionHeights(fdoc) {
    if (!fdoc) return;
    var style = fdoc.querySelector("style[data-lb-section-height]");
    if (!style) {
      style = fdoc.createElement("style");
      style.setAttribute("data-lb-section-height", "1");
      (fdoc.head || fdoc.documentElement).appendChild(style);
    }
    var out = [];
    ((state.doc && state.doc.blocks) || []).forEach(function (block) {
      /* كل الأنواع مش المستورد بس. المقبض معروض في كل قسم، فلو القاعدة
         دي اتكتبت لـ‎custom_html‎ لوحده يبقى السحب في أي قسم عادي
         بيشتغل وقت السحب بس (‎style‎ inline) وبيرجع لحجمه أول ما
         المعاينة تترد من السيرفر. */
      if (!block || !block.id) return;
      var st = block.style || {};
      var scope = "#" + block.id;
      /* القسم العادي عنده ‎#id‎ و‎> .lb-inner‎ بس؛ الباقي بيخص القوالب
         المستوردة ومابيطابقش حاجة جوّه القسم العادي. */
      var targets = [
        scope,
        scope + " > .lb-inner",
        scope + " > .lb-inner > .lb-custom",
        scope + " .lb-custom .t396__artboard",
        scope + " .lb-custom .t396__filter",
        scope + " .lb-custom .t396__carrier",
      ].join(",");
      var overflowTargets = [
        scope,
        scope + " > .lb-inner",
        scope + " .lb-custom",
        scope + " .lb-custom .t396__artboard",
      ].join(",");

      Object.keys(SECTION_HEIGHT_MEDIA).forEach(function (device) {
        var spec = SECTION_HEIGHT_MEDIA[device];
        /* القسم المستورد عنده تخطيط لكل مقاس فمابينهارش —
           نفس استثناء ``imported`` في ``tildacss.section_surface_css``. */
        var inheritPhone = !(block.props &&
                             typeof block.props.html === "string");
        var got = sectionHeightFor(st, spec.key, spec.frame, inheritPhone);
        var value = got.value;
        if (!(value > 0)) return;
        /* ‎!important‎ زي القاعدة اللي السيرفر بيولّدها بالظبط. من غيرها
           القاعدة المستوردة ‎#imp-4 #recXXX .t396__artboard{height:...}‎
           — معرّفين + كلاس، نفس الخصوصية — بتكسب بالترتيب لأنها
           متطبوعة بعدنا.
           و‎min-height‎ مكتوبة معاها لأن ‎.lb‎ عندها
           ‎min-height:var(--block-section-height)‎ من الحقل القديم —
           من غير ما نكتب فوقها التصغير تحت القيمة القديمة مابيحصلش. */
        var size = sectionHeightValue(value, got.frame);
        out.push(spec.query + "{" + targets + "{" +
                 sectionHeightDecls(size) + "}" +
                 overflowTargets + "{overflow:visible!important}}");

      });
    });
    style.textContent = out.join("");
  }

  function clearSectionBounds() {
    var fdoc = frameDoc();
    if (!fdoc) return;
    if (typeof fdoc.__lbSectionBoundsCleanup === "function") {
      fdoc.__lbSectionBoundsCleanup();
      fdoc.__lbSectionBoundsCleanup = null;
    }
    fdoc.querySelectorAll("[data-lb-section-bounds]").forEach(function (node) {
      node.remove();
    });
    fdoc.querySelectorAll(".lb-has-section-bounds").forEach(function (node) {
      node.classList.remove("lb-has-section-bounds");
    });
    /* ستايل الارتفاعات مابيتشالش هنا عن قصد: هو مش جزء من إطار
       الحدود، وقفل الإطار مالوش علاقة بارتفاع القسم. */
  }

  function applySectionBounds() {
    clearSectionBounds();
    if (!state.sectionBoundsBlock) return;
    var fdoc = frameDoc();
    var block = findBlock(state.sectionBoundsBlock);
    if (!fdoc || !block) return;
    var target = fdoc.querySelector('[data-block="' + block.id + '"]');
    if (!target) return;

    ensureBoundsStyle(fdoc);
    target.classList.add("lb-has-section-bounds");
    /* الارتفاع الحقيقي بتاع القسم المستورد على الـartboard مش على
       الـ‎<section>‎، فبنقيس ونكتب عليه هو. */
    var artboard = target.querySelector(".t396__artboard") || target;

    var overlay = fdoc.createElement("div");
    overlay.className = "lb-section-bounds";
    overlay.setAttribute("data-lb-section-bounds", "1");
    overlay.setAttribute("aria-hidden", "true");

    var label = fdoc.createElement("span");
    label.className = "lb-section-bounds__label";
    label.textContent = "حدود القسم";
    overlay.appendChild(label);

    var handle = fdoc.createElement("button");
    handle.type = "button";
    handle.className = "lb-section-resize-handle";
    handle.setAttribute("aria-label", "تغيير ارتفاع القسم");
    handle.title = "اسحب لتكبير أو تصغير القسم";
    overlay.appendChild(handle);
    target.appendChild(overlay);

    var startY = 0;
    var startHeight = 0;
    var resizing = false;

    var docBody = fdoc.body;
    var spec = sectionHeightSpec();
    var deviceName = { mobile: "موبايل", tablet: "تابلت",
                       desktop: "ديسكتوب" }[state.device] || state.device;
    var setHeight = function (value) {
      var next = Math.round(Math.max(120, Math.min(2400, value)) / 10) * 10;
      block.style = block.style || {};
      /* قيمة لكل مقاس: القالب المستورد بيحدد ارتفاع مختلف لكل مقاس،
         ورقم واحد كان هيظبط مقاس ويكسر التانيين. */
      block.style[spec.key] = next;
      /* لا نعتمد على style tag وحده أثناء السحب؛ بعض القوالب
         المستوردة تضع style inline أو قاعدة أقوى على الجذر الداخلي.
         طبّق الارتفاع فوراً على كل طبقات القسم الفعلية، ثم اكتب
         قاعدة الميديا للحفظ والمعاينة التالية. */
      [
        target,
        target.querySelector(".lb-inner"),
        target.querySelector(".lb-custom"),
        target.querySelector(".lb-custom .t396__artboard"),
        target.querySelector(".lb-custom .t396__filter"),
        target.querySelector(".lb-custom .t396__carrier"),
      ].forEach(function (node) {
        if (!node || !node.style) return;
        node.style.setProperty("height", next + "px", "important");
        /* ‎.lb‎ عندها ‎min-height‎ من الحقل القديم؛ من غير ما نكتب
           عليها القسم مابيصغّرش تحتها وإنت بتسحب. */
        node.style.setProperty("min-height", next + "px", "important");
      });
      syncSectionHeights(fdoc);
      label.textContent = "حدود القسم · " + deviceName + " · " + next + "px";

    };
    var stop = function (event) {
      if (!resizing) return;
      resizing = false;
      if (event && handle.releasePointerCapture && handle.hasPointerCapture &&
          handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      handle.classList.remove("is-dragging");
      if (docBody) docBody.style.userSelect = "";
      markDirty();
      requestPreview();
    };
    /* الرقم المعروض من أول لحظة: القيمة المحفوظة للمقاس ده، أو المقاس
       الحقيقي لو لسه محدش سحب. من غير كده الإطار بيفتح بكلمة مجرّدة
       والمستخدم مايعرفش هو واقف فين. */
    (function () {
      var stored = Number((block.style || {})[spec.key] || 0);
      if (!stored) stored = Math.round(artboard.getBoundingClientRect().height);
      if (stored > 0) {
        label.textContent = "حدود القسم · " + deviceName + " · " + stored + "px";
      }
    })();

    handle.addEventListener("pointerdown", function (event) {
      event.preventDefault();
      event.stopPropagation();
      resizing = true;
      startY = event.clientY;
      startHeight = artboard.getBoundingClientRect().height;
      snapshot();
      handle.classList.add("is-dragging");
      if (docBody) docBody.style.userSelect = "none";
      if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener("pointermove", function (event) {
      if (!resizing) return;
      event.preventDefault();
      setHeight(startHeight + event.clientY - startY);
    });
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    fdoc.__lbSectionBoundsCleanup = function () {
      resizing = false;
      if (docBody) docBody.style.userSelect = "";
    };
  }

  function toggleSectionBounds(blockId) {
    state.sectionBoundsBlock = state.sectionBoundsBlock === blockId ? null : blockId;
    applySectionBounds();
    renderInspector();
  }

  function renderInspector() {
    var box = refs.inspector;
    if (!box) return;
    var openGroups = captureInspectorGroups();
    box.replaceChildren();

    var block = state.selected ? findBlock(state.selected) : null;
    if (!block) {
      box.appendChild(el("p", "ed-empty",
        "اختر قسماً من القائمة أو اضغط عليه داخل المعاينة لتعديله."));
      return;
    }
    var spec = blockSpec(block.type);
    if (!spec) return;

    var head = el("div", "ed-section-head");
    var title = el("div");
    title.appendChild(el("p", "ed-kicker", "القسم المحدَّد"));
    title.appendChild(el("strong", null, block.label || spec.label));
    head.appendChild(title);

        var favoriteBtn = el("button", "ed-btn ed-btn--sm", "☆ حفظ كمفضلة");
    favoriteBtn.type = "button";
    favoriteBtn.title = "حفظ هذا القسم بكل إعداداته في المكتبة";
    favoriteBtn.addEventListener("click", saveSelectedAsFavorite);
    head.appendChild(favoriteBtn);

    if (block.type === "custom_html" || hasCodeBox(block)) {
      var layersBtn = el("button", "ed-btn ed-btn--sm ed-layers-btn", "☷ الطبقات");
      layersBtn.type = "button";
      layersBtn.title = "اختيار أي عنصر داخل هذا القسم من قائمة الطبقات";
      layersBtn.setAttribute("aria-expanded", state.layersOpen ? "true" : "false");
      layersBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.layersOpen = !state.layersOpen;
        renderInspector();
      });
      head.appendChild(layersBtn);
    }

    var back = el("button", "ed-btn ed-btn--sm", "الأقسام ↩");

    back.type = "button";
    back.addEventListener("click", function () { switchTab("blocks"); });
    head.appendChild(back);

    box.appendChild(head);

    // إعادة تسمية القسم — الاسم بيظهر في قائمة الأقسام
    var nameField = el("div", "ed-field");
    var nameLabel = el("label");
    nameLabel.appendChild(el("span", null, "اسم القسم في القائمة"));
    nameField.appendChild(nameLabel);
    var nameInput = el("input", "ed-input");
    nameInput.type = "text";
    nameInput.maxLength = 60;
    nameInput.placeholder = spec.label;
    nameInput.value = block.label || "";
    nameInput.addEventListener("input", function () {
      block.label = nameInput.value;
      markDirty();
    });
    nameInput.addEventListener("change", renderBlockList);
    nameField.appendChild(nameInput);
    box.appendChild(nameField);

    var boundsTools = el("div", "ed-section-bounds-tools");
    var boundsBtn = el(
      "button",
      "ed-btn ed-btn--sm ed-btn--block",
      state.sectionBoundsBlock === block.id ? "إخفاء حدود القسم" : "إظهار حدود القسم"
    );
    boundsBtn.type = "button";
    boundsBtn.addEventListener("click", function () { toggleSectionBounds(block.id); });
    boundsTools.appendChild(boundsBtn);
    boundsTools.appendChild(el("small", "ed-hint", "أظهر الإطار ثم اسحب المقبض السفلي لتكبير القسم أو تصغيره."));
    box.appendChild(boundsTools);

    if (spec.description) box.appendChild(el("p", "ed-hint", spec.description));
    if (!hasFeature(spec.feature)) {
      var warn = el("p", "ed-hint", "هذا القسم غير متاح في باقة العميل الحالية ولن يظهر للضيوف.");
      warn.style.color = "var(--e-danger)";
      box.appendChild(warn);
    }

    // القسم المستورد: الأدوات البصرية الأول، والكود آخر حاجة ومقفول.
    // اللي بيرفع قالب جاهز عايز يغيّر لون ويكتب نص، مش يقرا HTML.
    var codeLast = block.type === "custom_html";
    if (!codeLast) {
      box.appendChild(buildGroups(
        spec.props,
        function (s) { return block.props[s.key]; },
        function (s, v) { block.props[s.key] = v; markDirty(); requestPreview(); },
        false
      ));
    }

    // في القسم المستورد لوحة العنصر هي الأداة الأساسية — تيجي الأول
    if (codeLast) {
      box.appendChild(buildLayersGroup(block));
      box.appendChild(buildElementGroup(block));
      box.appendChild(buildColorGroup(block));
    } else if (hasCodeBox(block)) {
      /* قسم عادي فيه «كود متقدّم»: العناصر اللي جوّه الكود محتاجة نفس
         لوحة «العنصر المحدَّد» — ضغطة على الكلام تفتح الترس وتغيّر
         الخط واللون والمقاس من غير ما يفتح الكود. */
      box.appendChild(buildLayersGroup(block));
      box.appendChild(buildElementGroup(block));
    }

    if (spec.style && spec.style.length) {
      box.appendChild(buildGroups(
        spec.style,
        function (s) { return block.style[s.key]; },
        function (s, v) { block.style[s.key] = v; markDirty(); requestPreview(); },
        false
      ));
    }

    box.appendChild(buildLayoutGroup(block, spec));
    if (codeLast) {
      /* «عناصر فوق القسم» بقت متاحة في القسم المستورد كمان.
         الفرق عن إضافة نص/صورة من «العنصر المحدَّد»: دي بتتحط جوّه
         كود القالب نفسه، ودي طبقة فوق القسم بتتسحب لأي حتة ومابتلمسش
         الكود — والزرار موجود في دي بس. */
            var hasImportedCountdown = /countdowncontainer|countdown[-_ ]?(?:grid|wrapper|container|heading|sub)|section-countdown|time-block|number-wrap|(?:^|[\s"'_-])cd-(?:days?|hours?|mins?|minutes?|secs?|seconds?)(?:$|[\s"'_-])/i.test(
        String((block.props || {}).html || "")
      );
      var COUNTDOWN_ONLY_KEYS = { countdown_date: 1, countdown_dir: 1 };
      var advancedProps = spec.props.filter(function (s) {
        return !COUNTDOWN_ONLY_KEYS[s.key] || hasImportedCountdown;
      });

      box.appendChild(buildGroups(
        advancedProps,
        function (s) { return block.props[s.key]; },
        function (s, v) { block.props[s.key] = v; markDirty(); requestPreview(); },
        false
      ));
        }
    restoreInspectorGroups(openGroups);
    syncCollapseTool();
  }

  // ==========================================================
  // لوحة العنصر — تحكّم كامل في أي حاجة جوّه قسم مستورد

  // ==========================================================
  /* القسم المستورد مالوش حقول معروفة مسبقاً، فبدل ما نسيب المستخدم
     يكتب CSS بإيده بنخلي كل تحكّم يتطبّق كـstyle مضمّن على العنصر
     نفسه. الميزة إن ده بيتخزن جوّه props.html وبينجو من المنقّي
     (الخصائص دي كلها في قايمة السماح)، ومحتاجش مفاتيح جديدة. */

  var EL_NAMES = {
    H1: "عنوان رئيسي", H2: "عنوان", H3: "عنوان فرعي", H4: "عنوان صغير",
    H5: "عنوان صغير", H6: "عنوان صغير", P: "فقرة", SPAN: "نص",
    A: "رابط", IMG: "صورة", LI: "عنصر قائمة", UL: "قائمة", OL: "قائمة",
    DIV: "مجموعة", SECTION: "مجموعة", HEADER: "ترويسة", FOOTER: "خاتمة",
    FIGURE: "صورة", BLOCKQUOTE: "اقتباس", TABLE: "جدول", TD: "خانة",
    STRONG: "نص عريض", EM: "نص مائل", SMALL: "نص صغير", BUTTON: "زر"
  };

  var WEIGHTS = [["", "زي ما هو"], ["300", "خفيف"], ["400", "عادي"],
                 ["500", "متوسط"], ["600", "شبه عريض"], ["700", "عريض"]];
  var ALIGNS = [["", "زي ما هو"], ["right", "يمين"], ["center", "وسط"],
                ["left", "يسار"]];

  function styleOf(node, prop) {
    return node.style.getPropertyValue(prop) || "";
  }

  function computedPx(node, prop) {
    var v = parseFloat(node.ownerDocument.defaultView.getComputedStyle(node)[prop]);
    return isNaN(v) ? 0 : Math.round(v);
  }

  /** صف تحكّم: عنوان + عنصر إدخال. */
  /* ---- رابط الخريطة القابل للتضمين -------------------------------------
     نفس منطق ‎renderer.map_embed_url‎ في بايثون بالظبط. جوجل بيرفض عرض
     رابط الخرايط العادي جوّه ‎<iframe>‎، فاللي بيلزق الرابط من شريط
     العنوان كان بيشوف إطار مكسور. بنحوّله لرابط ‎output=embed‎، وبنرجّع
     ‎""‎ لما مانعرفش (الروابط المختصرة) عشان المنادي يقول للمستخدم. */
  function mapLatLngPair(text) {
    var m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(String(text || ""));
    if (!m) return "";
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return "";
    return lat + "," + lng;
  }

  function mapEmbedFromQuery(query, zoom) {
    if (!query) return "";
    return "https://www.google.com/maps?q=" + encodeURIComponent(query).replace(/%2C/g, ",") +
      (zoom ? "&z=" + zoom : "") + "&output=embed";
  }

  function mapEmbedUrl(value) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    if (/<iframe/i.test(raw)) {
      var src = /<iframe[^>]*\ssrc\s*=\s*(['"])([\s\S]*?)\1/i.exec(raw);
      if (!src) return "";
      raw = src[2].trim().replace(/&amp;/g, "&");
    }
    if (!/^https?:\/\//i.test(raw)) {
      var typed = mapLatLngPair(raw);
      if (typed) return mapEmbedFromQuery(typed, "16");
      return raw.length <= 300 ? mapEmbedFromQuery(raw, "") : "";
    }
    var url;
    try { url = new URL(raw); } catch (err) { return ""; }
    var host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "goo.gl" || host === "maps.app.goo.gl" || host === "g.co") return "";
    if (host.indexOf("google.") < 0) return raw;
    if (url.pathname.indexOf("/maps/embed") >= 0 ||
        /(?:^|&)output=embed(?:&|$)/.test(url.search.replace(/^\?/, ""))) return raw;

    function first() {
      for (var i = 0; i < arguments.length; i++) {
        var v = url.searchParams.get(arguments[i]);
        if (v && v.trim()) return v.trim();
      }
      return "";
    }
    var at = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/.exec(url.pathname);
    var zoom = "";
    var z = first("z", "zoom");
    if (/^\d{1,2}(?:\.\d+)?$/.test(z)) zoom = z;
    else if (at && at[3]) zoom = String(Math.round(parseFloat(at[3])));

    var pair = "";
    var precise = /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(raw);
    if (precise) pair = mapLatLngPair(precise[1] + "," + precise[2]);
    if (!pair) pair = mapLatLngPair(first("ll", "sll", "center"));
    if (!pair && at) pair = mapLatLngPair(at[1] + "," + at[2]);
    if (!pair) {
      ["q", "query", "daddr", "destination"].some(function (key) {
        pair = mapLatLngPair(first(key));
        return !!pair;
      });
    }
    if (!pair) {
      url.pathname.split("/").some(function (segment) {
        var decoded = segment;
        try { decoded = decodeURIComponent(segment); } catch (err3) { /* زي ما هو */ }
        pair = mapLatLngPair(decoded);
        return !!pair;
      });
    }
    if (pair) return mapEmbedFromQuery(pair, zoom || "16");

    var text = first("q", "query", "daddr", "destination");
    if (!text) {
      var place = /\/maps\/(?:place|search|dir)\/([^/@?]+)/.exec(url.pathname);
      if (place) {
        try { text = decodeURIComponent(place[1]); } catch (err2) { text = place[1]; }
        text = text.replace(/\+/g, " ").trim();
      }
    }
    return text ? mapEmbedFromQuery(text.slice(0, 300), zoom) : "";
  }

  var MAP_EMBED_HELP =
    "الرابط ده مايتعرضش جوّه إطار. افتح المكان في خرائط جوجل ← مشاركة ← " +
    "«تضمين خريطة» والصق الكود، أو الصق الإحداثيات كده: 29.990823, 31.130000";

  function ctrlRow(label, input, extra) {
    var row = el("div", "ed-field");
    var lab = el("label");
    lab.appendChild(el("span", null, label));
    row.appendChild(lab);
    var line = el("div", "ed-ctrl-line");
    line.appendChild(input);
    if (extra) line.appendChild(extra);
    row.appendChild(line);
    return row;
  }

  // ---------- عمليات على العنصر (نسخ/لصق/تكرار/إضافة/حذف) ----------

  /** الجذر اللي بنعيد بناء الـHTML منه بعد أي تعديل. */
  /* «جذر التحرير»: القسم المستورد (‎.lb-custom‎) أو مربع «كود متقدّم».
     الاتنين بيتعاملوا بنفس الطريقة — العناصر جوّاهم بتتحدّد وتتنسّق
     وتتحرّك — واللي بيختلف هو الخانة اللي بنحفظ فيها. */
  function customRoot(node) {
    return node && node.closest
      ? node.closest(".lb-custom, .lb-extra-html, .lb-intro-extra") : null;
  }

  function isCodeRoot(root) {
    return !!root && !root.classList.contains("lb-custom");
  }

  /** يحفظ الجذر في خانته: ‎props.html‎ للمستورد، وخانة الكود للمربع. */
  function commitRoot(block, root) {
    if (!root) return;
    if (isCodeRoot(root)) { codeWriteBack(root); return; }
    block.props.html = serializeCustom(root);
    markDirty();
  }

  /** يحفظ الـHTML ويعيد بناء المعاينة (عشان الترقيم يتظبط). */
  function commitStructure(block, root) {
    commitRoot(block, root);
    requestPreview();
  }

  /** نسخة نضيفة من العنصر — من غير معرّفات أو علاماتنا. */
  function cleanCopy(node) {
    var c = node.cloneNode(true);
    var strip = function (n) {
      n.removeAttribute("data-move");
      n.removeAttribute("data-lb-edit");
      n.removeAttribute("data-lb-text");
      n.removeAttribute("contenteditable");
      n.classList.remove("lb-el-picked");
      if (!n.getAttribute("class")) n.removeAttribute("class");
    };
    strip(c);
    c.querySelectorAll("*").forEach(strip);
    return c;
  }

  function copyElement() {
    var n = selectedElNode();
    if (!n) return false;
    state.clip = cleanCopy(n).outerHTML;
    toast("اتنسخ العنصر — Ctrl+V للصق", "ok");
    return true;
  }

  function pasteElement(inside) {
    var n = selectedElNode();
    var block = findBlock(state.selected);
    if (!n || !block || !state.clip) return false;
    var root = customRoot(n);
    if (!root) return false;

    var holder = n.ownerDocument.createElement("div");
    holder.innerHTML = state.clip;
    var fresh = holder.firstElementChild;
    if (!fresh) return false;

    snapshot();
    // نص قابل للكتابة مايتحطش جوّاه عناصر — بنحط بعده
    if (inside && !n.getAttribute("data-lb-text")) n.appendChild(fresh);
    else n.insertAdjacentElement("afterend", fresh);
    state.selEl = null;                 // العنصر الجديد هياخد رقم جديد
    commitStructure(block, root);
    toast(inside ? "اتلصق جوّه العنصر" : "اتلصقت نسخة", "ok");
    return true;
  }

  function duplicateElement() {
    if (!copyElementSilent()) return false;
    return pasteElement(false);
  }

  function copyElementSilent() {
    var n = selectedElNode();
    if (!n) return false;
    state.clip = cleanCopy(n).outerHTML;
    return true;
  }

  function deleteElement() {
    var n = selectedElNode();
    var block = findBlock(state.selected);
    if (!n || !block) return false;
    var root = customRoot(n);
    if (!root) return false;
    snapshot();
    if (block.layout) delete block.layout[state.selEl];
    n.remove();
    state.selEl = null;
    commitStructure(block, root);
    renderInspector();
    toast("اتحذف العنصر — Ctrl+Z للتراجع", "ok");
    return true;
  }

  /** يضيف عنصر جديد (صورة أو نص) جوّه المحدَّد أو بعده. */
  function insertInto(node, block, elem) {
    var root = customRoot(node);
    if (!root) return;
    snapshot();
    /* الصورة والفيديو عناصر لا تقبل عناصر HTML مرئية بداخلها؛ لو أضفنا
       نصاً أو صورة داخلهما سيظهر كـfallback أو يختفي. نضع الإضافة بعدهما.
       العناصر الحاوية مثل div/section تظل الإضافة داخلها. */
    var tag = (node.tagName || "").toUpperCase();
    var cannotContain = /^(IMG|VIDEO|AUDIO|SOURCE|BR|HR|INPUT|SELECT|TEXTAREA)$/.test(tag);
    if (node.getAttribute("data-lb-text") || cannotContain) {
      node.insertAdjacentElement("afterend", elem);
    } else {
      node.appendChild(elem);
    }
    state.selEl = null;
    commitStructure(block, root);
  }

  function selectParentElement() {
    var n = selectedElNode();
    if (!n) return;
    var up = n.parentElement;
    while (up && !up.getAttribute("data-move") && !up.classList.contains("lb-custom")) {
      up = up.parentElement;
    }
    if (!up || !up.getAttribute("data-move")) {
      toast("ده أعلى عنصر في القسم", "info");
      return;
    }
    state.selEl = up.getAttribute("data-move");
    markSelectedEl();
    renderInspector();
  }

    function layerLabel(node, index) {
    var tag = String(node.tagName || "").toUpperCase();
    var name = node.getAttribute("data-lb-text") === "1"
      ? "نص" : (EL_NAMES[tag] || tag.toLowerCase() || "عنصر");
    var frame = tag === "IFRAME" ? node : node.querySelector && node.querySelector("iframe");
    if (frame && /google\.com\/maps|maps\.googleapis\.com/i.test(frame.getAttribute("src") || "")) {
      name = "خريطة Google";
    } else if (tag === "IMG" || node.querySelector && node.querySelector("img")) {
      name = "صورة";
    } else if (tag === "VIDEO" || node.querySelector && node.querySelector("video")) {
      name = "فيديو";
    }
    var text = String(node.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 42) text = text.slice(0, 42) + "…";
    return (index + 1) + ". " + name + (text ? " — " + text : "");
  }

  function buildLayersGroup(block) {
    var wrap = el("details", "ed-group ed-layers-group");
    wrap.open = !!state.layersOpen;
    var sum = el("summary");
    sum.appendChild(el("span", null, "الطبقات / Layers"));
    wrap.appendChild(sum);
    var body = el("div", "ed-group-body ed-layers-list");
    wrap.appendChild(body);

    if (!state.layersOpen) return wrap;
    var fdoc = frameDoc();
    var section = fdoc && fdoc.querySelector('[data-block="' + block.id + '"]');
    // القسم ممكن يكون فيه الاتنين: قالب مستورد + مربع «كود متقدّم»
    var nodes = [];
    (section ? $$(".lb-custom, .lb-extra-html", section) : []).forEach(function (root) {
      $$("[data-move]", root).forEach(function (node) {
        if (node.closest("[data-block]") !== section) return;
        // Tilda يضع data-move على الحاوية وعلى العنصر الداخلي معاً.
        // نعرض العنصر المرئي الحقيقي فقط: نص، صورة، فيديو، iframe،
        // أو حاوية شكل لا تحتوي واحداً من هذه العناصر.
        var hasText = node.getAttribute("data-lb-text") === "1";
        var hasChildVisual = !!node.querySelector("[data-lb-text], img, video, iframe");
        if (hasText || !hasChildVisual) nodes.push(node);
      });
    });
    if (!nodes.length) {
      body.appendChild(el("p", "ed-hint", "لم يتم العثور على عناصر قابلة للاختيار داخل القسم."));
      return wrap;
    }

    nodes.forEach(function (node, index) {
      var button = el("div", "ed-layer-item");
      button.setAttribute("role", "button");
      button.tabIndex = 0;
      button.classList.toggle("is-active", node.getAttribute("data-move") === state.selEl);
      button.appendChild(el("span", "ed-layer-index", String(index + 1)));
      button.appendChild(el("span", "ed-layer-name", layerLabel(node, index)));
      var remove = el("button", "ed-layer-remove", "×");
      remove.type = "button";
      remove.title = "حذف هذه الطبقة";
      remove.setAttribute("aria-label", "حذف الطبقة");
      remove.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.selEl = node.getAttribute("data-move");
        if (window.confirm("هل تريد حذف هذه الطبقة؟")) deleteElement();
      });
      button.appendChild(remove);
      button.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.selEl = node.getAttribute("data-move");
        markSelectedEl();
        renderInspector();
      });
      button.addEventListener("dblclick", function (e) {
        e.preventDefault();
        e.stopPropagation();
        state.selEl = node.getAttribute("data-move");
        markSelectedEl();
        switchTab("inspector");
        renderInspector();
      });
      button.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          state.selEl = node.getAttribute("data-move");
          markSelectedEl();
          renderInspector();
        }
      });
      body.appendChild(button);
    });
    return wrap;
  }

  /** القسم ده فيه مربع «كود متقدّم» متولّد في المعاينة؟ */
  function hasCodeBox(block) {
    var fdoc = frameDoc();
    if (!fdoc || !block) return false;
    return !!fdoc.querySelector('[data-block="' + block.id + '"] .lb-extra-html');
  }

  function buildElementGroup(block) {

    var node = selectedElNode();
    var wrap = el("details", "ed-group");
    var sum = el("summary");
    sum.appendChild(el("span", null, "العنصر المحدَّد"));
    wrap.appendChild(sum);
    var body = el("div", "ed-group-body");
    wrap.appendChild(body);

    if (!node) {
      body.appendChild(el("p", "ed-hint",
        "اضغط على أي حاجة جوّه المعاينة — كلمة، صورة، زر — وهتتحكّم فيها من هنا."));
      return wrap;
    }
    var commit = function () {
      var root = customRoot(node);
      if (!root) return;
      // المربع: نزامن العنصر ده لوحده بالمسار بدل ما نحفظ اللقطة كلها
      if (isCodeRoot(root)) { codeWriteBack(root, node); return; }
      block.props.html = serializeCustom(root);
      markDirty();
    };
        var tag = node.tagName;
    var imageNode = tag === "IMG" ? node : node.querySelector("img");
    var videoNode = tag === "VIDEO" ? node : node.querySelector("video");
    var textNode = node.getAttribute("data-lb-text") === "1"
      ? node : node.querySelector("[data-lb-text]");
    var styleNode = imageNode || videoNode || textNode || node;
    var setStyle = function (prop, value) {
      if (value) styleNode.style.setProperty(prop, value);
      else styleNode.style.removeProperty(prop);
      commit();
    };


    /* الكلاسات اللي المحرر نفسه بيحطها مش من القالب — كانت بتطلع في
       اسم العنصر («صورة · lb-el-picked») وتوهم إنها كلاس التصميم. */
    var OWN = { "lb-el-picked": 1, "lb-el-typing": 1, "lb-dragging": 1, "lb-el-swap": 1 };
    var theirs = String(node.className || "").split(/\s+/).filter(function (c) {
      return c && !OWN[c];
    });
    var head = el("p", "ed-el-name",
      (EL_NAMES[tag] || tag.toLowerCase()) +
      (theirs.length ? " · " + theirs[0] : ""));
    body.appendChild(head);

    /* نفس فكرة ترس النص في الحقول العادية: كل أدوات التنسيق (الخط
       والحجم والسُمك والمحاذاة والألوان والتباعد) بتتلم ورا ترس واحد
       جنب النص، فالوحة تفضل «نص + ترس» مهما كان عدد الأدوات. مفيش أداة
       اتشالت — اللي اتغيّر مكانها. */
    var typoPanel = el("div", "ed-inline-font-panel");
    typoPanel.hidden = true;
    var typoGear = el("button", "ed-font-gear", "⚙");
    typoGear.type = "button";
    typoGear.title = "تنسيق العنصر: الخط واللون والحجم";
    typoGear.setAttribute("aria-label", "تنسيق العنصر");
    typoGear.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      typoPanel.hidden = !typoPanel.hidden;
      typoGear.setAttribute("aria-expanded", typoPanel.hidden ? "false" : "true");
    });
    // كل اللي تحت بيروح جوّه اللوحة بدل ما يتفرد في العمود
    var styleBox = typoPanel;

        if (textNode) {
      var textEditor = el("textarea", "ed-input");
      textEditor.rows = 4;
      textEditor.value = String(textNode.innerHTML || textNode.textContent || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "");
      textEditor.placeholder = "اكتب محتوى النص هنا";
      var textStarted = false;
      textEditor.addEventListener("input", function () {
        if (!textStarted) { snapshot(); textStarted = true; }
        textNode.textContent = textEditor.value;
        commit();
      });
      textEditor.addEventListener("change", function () { textStarted = false; });
      body.appendChild(ctrlRow("محتوى النص", textEditor, typoGear));
    } else {
      // مفيش نص (صورة، فيديو، خريطة) — الترس بيقف لوحده بعنوانه
      body.appendChild(ctrlRow("تنسيق العنصر", typoGear));
    }
    body.appendChild(typoPanel);

    /* الصورة مش نص. الخط والحجم والسُمك والمحاذاة وتباعد الحروف

       وارتفاع السطر ولون النص مالهمش أي تأثير على ‎<img>‎ — عرضها
       كان بيخلي اللوحة تبان زي ما هي مهما حرّكت فيها، وده أسوأ من
       إنها ناقصة. بنعرض أدوات الصورة بدالها. */
            var isImg = !!imageNode;
    var isVideo = !!videoNode;
    var mapFrame = tag === "IFRAME" ? node : node.querySelector("iframe");

    var isMap = !!mapFrame && (
      /google\.com\/maps|maps\.googleapis\.com/i.test(mapFrame.getAttribute("src") || "")
      || node.getAttribute("data-map") === "1"
    );
    var mapBox = isMap ? (node.closest(".tn-elem") || node) : null;
    var countdownRoot = node.closest && node.closest("#countdownContainer, .countdown-container");
    if (countdownRoot && block.type === "custom_html") {
      body.appendChild(el("p", "ed-hint",
        "ده عدّاد مستورد — تقدر تغيّر موعده واتجاه خاناته، وتختار أي تسمية من الطبقات لتعديل نصها أو خطها."));
      var dateInput = el("input", "ed-input");
      dateInput.type = "datetime-local";
      dateInput.value = String((block.props || {}).countdown_date || "");
      dateInput.title = "اتركه فارغاً لاستخدام موعد القالب الأصلي";
      dateInput.addEventListener("change", function () {
        snapshot();
        block.props.countdown_date = dateInput.value;
        markDirty();
        requestPreview();
      });
      var clearDate = el("button", "ed-btn ed-btn--sm", "استخدم موعد القالب");
      clearDate.type = "button";
      clearDate.addEventListener("click", function () {
        snapshot();
        block.props.countdown_date = "";
        dateInput.value = "";
        markDirty();
        requestPreview();
      });
      body.appendChild(ctrlRow("موعد العدّاد", dateInput, clearDate));

      /* اتجاه الخانات: ترتيب الأيام/الساعات/الدقائق/الثواني. القالب
         المستورد مثبّت الترتيب في الـHTML بتاعه، والاختيار ده بيقلبه
         بالـCSS من غير ما يلمس الكود. */
      var dirSelect = doc.createElement("select");
      dirSelect.className = "ed-input";
      dirSelect.dataset.fieldKey = "countdown_dir";
      [["", "زي ما هو (اتجاه القالب)"],
       ["rtl", "من اليمين للشمال — «أيام» على اليمين"],
       ["ltr", "من الشمال لليمين — «أيام» على الشمال"]].forEach(function (pair) {
        var op = el("option", null, pair[1]);
        op.value = pair[0];
        dirSelect.appendChild(op);
      });
      dirSelect.value = String((block.props || {}).countdown_dir || "");
      dirSelect.addEventListener("change", function () {
        snapshot();
        block.props.countdown_dir = dirSelect.value;
        markDirty();
        requestPreview();
      });
      body.appendChild(ctrlRow("اتجاه الخانات", dirSelect));
    }
    if (isImg) {

      styleBox.appendChild(el("p", "ed-hint",
        "دي صورة — أدوات الخط والنص مش بتأثر عليها فمخفية."));
    }

    // ---- الخط
        if (!isImg && !isMap) {
    var fontSel = el("select", "ed-input");

    fontSel.appendChild(new Option("زي ما هو", ""));
    var fontOptions = (SCHEMA.fonts || []).slice();
    var seenFontValues = {};
    fontOptions.forEach(function (f) { if (f && f.value) seenFontValues[f.value] = true; });
    FONTS.forEach(function (f) {
      if (!f || !f.value || seenFontValues[f.value]) return;
      fontOptions.push({ label: "من مكتبة الخطوط — " + (f.label || f.name || f.family), value: f.value });
      seenFontValues[f.value] = true;
    });
    fontOptions.forEach(function (f) {
      fontSel.appendChild(new Option(f.label, f.value));
    });

    /* المتصفح بيعيد كتابة font-family بعلامات تنصيص مزدوجة، فمقارنة
       نصية مباشرة مع قيمة الخيار بتفشل والقايمة بتبان فاضية. */
    var fontKey = function (v) {
      return String(v || "").replace(/["']/g, "").replace(/\s+/g, " ")
             .trim().toLowerCase();
    };
        var cur = fontKey(styleOf(styleNode, "font-family"));

    for (var fi = 0; fi < fontSel.options.length; fi++) {
      if (fontKey(fontSel.options[fi].value) === cur) {
        fontSel.selectedIndex = fi;
        break;
      }
    }
    fontSel.addEventListener("change", function () {
      snapshot(); setStyle("font-family", fontSel.value);
    });
        styleBox.appendChild(ctrlRow("الخط", fontSel));
    styleBox.appendChild(buildInlineFontTools(fontSel, function (value) {
      snapshot();
      setStyle("font-family", value);
    }));

    // ---- حجم الخط
    var sizeVal = parseFloat(styleOf(styleNode, "font-size")) || computedPx(styleNode, "fontSize");

    var size = el("input", "ed-input");
    size.type = "range"; size.min = 8; size.max = 120; size.step = 1;
    size.value = sizeVal;
    var sizeOut = el("b", "ed-ctrl-out", sizeVal + "px");
    var sizeStarted = false;
    size.addEventListener("input", function () {
      if (!sizeStarted) { snapshot(); sizeStarted = true; }
      sizeOut.textContent = size.value + "px";
      setStyle("font-size", size.value + "px");
    });
    size.addEventListener("change", function () { sizeStarted = false; });
    styleBox.appendChild(ctrlRow("حجم الخط", size, sizeOut));

    // ---- السُمك والمحاذاة
    [["font-weight", "سُمك الخط", WEIGHTS],
     ["text-align", "المحاذاة", ALIGNS]].forEach(function (spec) {
      var sel = el("select", "ed-input");
      spec[2].forEach(function (o) { sel.appendChild(new Option(o[1], o[0])); });
            sel.value = styleOf(styleNode, spec[0]);

      sel.addEventListener("change", function () {
        snapshot(); setStyle(spec[0], sel.value);
      });
      styleBox.appendChild(ctrlRow(spec[1], sel));
    });
    }

    /* لون الخلفية بيفضل مفيد على الصورة — بيبان ورا PNG شفاف ووقت
       التحميل. لون النص لأ. */
        // ---- الألوان
    (isMap ? [] : (isImg ? [["background-color", "لون الخلفية"]]
           : [["color", "لون النص"], ["background-color", "لون الخلفية"]]))
    .forEach(function (spec) {

      var input = el("input");
      input.type = "color";
      input.className = "ed-color";
            var cur = styleOf(styleNode, spec[0]);

      input.value = /^#[0-9a-fA-F]{6}$/.test(cur) ? cur : "#000000";
      var started = false;
      input.addEventListener("input", function () {
        if (!started) { snapshot(); started = true; }
        setStyle(spec[0], input.value);
      });
      input.addEventListener("change", function () { started = false; });
      var clear = el("button", "ed-btn ed-btn--sm", "مسح");
      clear.type = "button";
      clear.addEventListener("click", function () {
        snapshot(); setStyle(spec[0], "");
      });
      styleBox.appendChild(ctrlRow(spec[1], input, clear));
    });

        // ---- المسافات
    if (!isImg && !isMap) {

    [["letter-spacing", "تباعد الحروف", -3, 16, .5, "px"],
     ["line-height", "ارتفاع السطر", .8, 3.2, .05, ""]].forEach(function (spec) {
            var cur = parseFloat(styleOf(styleNode, spec[0]));

      if (isNaN(cur)) {
        cur = spec[0] === "line-height"
                    ? Math.round((computedPx(styleNode, "lineHeight") /
              (computedPx(styleNode, "fontSize") || 16)) * 100) / 100

          : 0;
      }
      var r = el("input", "ed-input");
      r.type = "range"; r.min = spec[2]; r.max = spec[3]; r.step = spec[4];
      r.value = cur;
      var out = el("b", "ed-ctrl-out", cur + spec[5]);
      var started = false;
      r.addEventListener("input", function () {
        if (!started) { snapshot(); started = true; }
        out.textContent = r.value + spec[5];
        setStyle(spec[0], r.value + spec[5]);
      });
      r.addEventListener("change", function () { started = false; });
      styleBox.appendChild(ctrlRow(spec[1], r, out));
    });
    }

    // ---- الفيديو: تبديل المصدر مع الحفاظ على نفس العنصر والتنسيق
    if (isVideo) {
      body.appendChild(el("p", "ed-hint",
        "ده فيديو — تقدر تختار فيديو تاني من المكتبة، ومكانه وتنسيقه هيفضلوا زي ما هم."));

      var setVideoSrc = function (url) {
        if (!url) return;
                videoNode.setAttribute("src", url);
        videoNode.setAttribute("preload", "auto");
        videoNode.removeAttribute("data-src");

        /* بعض القوالب تستخدم source داخلياً، ووجوده يكسب src الموجود على video. */
                Array.prototype.forEach.call(videoNode.querySelectorAll("source"), function (source) {

          source.setAttribute("src", url);
          source.removeAttribute("srcset");
        });
                if (typeof videoNode.load === "function") videoNode.load();

        commit();
        requestPreview();
      };

      var swapVideo = el("button", "ed-btn ed-btn--sm ed-btn--block", "بدّل الفيديو");
      swapVideo.type = "button";
      swapVideo.addEventListener("click", function () {
        openAssetPicker(function (url) {
          snapshot();
          setVideoSrc(url);
        }, "video");
      });
      body.appendChild(swapVideo);
    }

    // ---- الصور: تبديل وقص
    if (isImg) {
      var setSrc = function (url) {
        imageNode.setAttribute("src", url);
        /* srcset بيكسب على src — لو سبناها الصورة القديمة تفضل ظاهرة
           والمستخدم يفتكر إن التبديل مااشتغلش. */
        imageNode.removeAttribute("srcset");
        commit();
        requestPreview();
      };

      var swap = el("button", "ed-btn ed-btn--sm ed-btn--block", "بدّل الصورة");
      swap.type = "button";
      swap.addEventListener("click", function () {
        openAssetPicker(function (url) { snapshot(); setSrc(url); }, "image");
      });
      body.appendChild(swap);

      /* القص بيتم على الأصل المحفوظ في المكتبة مش على النسخة المعروضة،
         عشان ما يحصلش فقد جودة متراكم — يعني لازم الصورة تكون أصل في
         مكتبة الدعوة. صورة جاية مع قالب مستورد ومش مرفوعة عندنا مالهاش
         أصل نقص منه، فبنطلب يبدّلها من المكتبة الأول. */
      var crop = el("button", "ed-btn ed-btn--sm ed-btn--block", "قصّ الصورة");
      crop.type = "button";
      crop.addEventListener("click", function () {
        var src = imageNode.getAttribute("src") || "";
        var asset = null;
        for (var i = 0; i < ASSETS.length; i++) {
          if (ASSETS[i].url && src.indexOf(ASSETS[i].url) > -1) { asset = ASSETS[i]; break; }
        }
        if (!asset) {
          toast("الصورة دي مش من مكتبة الدعوة — اضغط «بدّل الصورة» " +
                "واختارها أو ارفعها، وبعدين تقدر تقصها.", "error");
          return;
        }
        openCropper(asset, function (url) { snapshot(); setSrc(url); });
      });
      body.appendChild(crop);

            // ---- مقاس الصورة واستدارتها — دي اللي بتأثر فعلاً على ‎<img>‎
      [["width", "عرض الصورة", 10, 100, 1, "%"],
       ["border-radius", "استدارة الحواف", 0, 200, 2, "px"]].forEach(function (spec) {
        var cur = parseFloat(styleOf(imageNode, spec[0]));

        if (isNaN(cur)) {
                    cur = spec[0] === "width" ? 100 : computedPx(imageNode, "borderTopLeftRadius") || 0;

        }
        var r2 = el("input", "ed-input");
        r2.type = "range"; r2.min = spec[2]; r2.max = spec[3]; r2.step = spec[4];
        r2.value = cur;
        var out2 = el("b", "ed-ctrl-out", cur + spec[5]);
        var began = false;
        r2.addEventListener("input", function () {
          if (!began) { snapshot(); began = true; }
          out2.textContent = r2.value + spec[5];
          setStyle(spec[0], r2.value + spec[5]);
        });
        r2.addEventListener("change", function () { began = false; });
        styleBox.appendChild(ctrlRow(spec[1], r2, out2));
      });
    }

        // ---- الخريطة: الرابط والحجم
    if (isMap) {
      body.appendChild(el("p", "ed-hint",
        "الخريطة محددة للتحرير؛ اسحبها أو غيّر الرابط والحجم من هنا. زوم Google متوقف داخل المحرر."));

      var mapUrl = el("input", "ed-input");
      mapUrl.type = "url";
      mapUrl.value = mapFrame.getAttribute("src") || "";
      mapUrl.placeholder = "رابط Google Maps أو رابط الخريطة";
      var applyMapUrl = el("button", "ed-btn ed-btn--sm ed-btn--block", "تغيير رابط الخريطة");
      applyMapUrl.type = "button";
      applyMapUrl.addEventListener("click", function () {
        var value = (mapUrl.value || "").trim();
        if (!value) { toast("اكتب رابط الخريطة أولاً.", "error"); return; }
        var mapSrc = mapEmbedUrl(value);
        if (!mapSrc) { toast(MAP_EMBED_HELP, "error"); return; }
        snapshot();
        mapFrame.setAttribute("src", mapSrc);
        mapUrl.value = mapSrc;
        commit();
        requestPreview();
        toast("اتغير رابط الخريطة.", "ok");
      });
      body.appendChild(ctrlRow("رابط الخريطة", mapUrl));
      body.appendChild(applyMapUrl);

      [["width", "عرض الخريطة"], ["height", "ارتفاع الخريطة"]].forEach(function (spec) {
                var raw = mapBox && (mapBox.getAttribute("data-lb-map-" + spec[0]) ||
          mapBox.getAttribute("data-field-" + spec[0] + "-value"));

        var current = parseFloat(raw) || (spec[0] === "width" ? 335 : 335);
        var input = el("input", "ed-input");
        input.type = "range"; input.min = 120; input.max = 900; input.step = 1;
        input.value = current;
        var output = el("b", "ed-ctrl-out", current + "px");
        var started = false;
        input.addEventListener("input", function () {
          if (!started) { snapshot(); started = true; }
          var value = Math.max(120, Math.min(900, parseFloat(input.value) || current));
          output.textContent = value + "px";
                    if (mapBox) {
            var baseAttr = "data-field-" + spec[0] + "-value";
            var responsiveAttr = new RegExp("^data-field-" + spec[0] + "-res-[^-]+-value$", "i");
            mapBox.setAttribute(baseAttr, value);
            // علامة صريحة بأن هذا المقاس اختاره المستخدم؛ renderer يحافظ عليه.
            mapBox.setAttribute("data-lb-map-" + spec[0], String(value));
            Array.prototype.forEach.call(mapBox.attributes, function (attr) {
              if (responsiveAttr.test(attr.name)) mapBox.setAttribute(attr.name, value);
            });
            mapBox.style.setProperty(spec[0], value + "px", "important");
          }
          if (mapFrame !== mapBox) {
            mapFrame.style.setProperty(spec[0], "100%", "important");
          } else {
            mapFrame.style.setProperty(spec[0], value + "px", "important");
          }

                    commit();
          // تحديث المعاينة أثناء السحب، بدون حفظ تلقائي.
          // debounce الموجود في requestPreview يمنع إرسال طلب لكل بكسل.
          requestPreview();
        });
        input.addEventListener("change", function () { started = false; requestPreview(); });

        body.appendChild(ctrlRow(spec[1], input, output));
      });
    }

    // ---- الموضع الدقيق
    var pos = (block.layout && block.layout[state.selEl]) || { dx: 0, dy: 0 };

    var nudge = el("div", "ed-nudge");
    [["→", -1, 0], ["←", 1, 0], ["↑", 0, -1], ["↓", 0, 1]].forEach(function (d) {
      var btn = el("button", "ed-btn ed-btn--sm", d[0]);
      btn.type = "button";
      var step = slotIsPx(state.selEl) ? 1 : 0.25;
      var stepY = slotUnitY(state.selEl) === "px" ? 1 : step;
      btn.title = slotIsPx(state.selEl) ? "تحريك بكسل واحد" : "تحريك ربع خطوة";
      btn.addEventListener("click", function () {
        snapshot();
        var p2 = layoutOf(block, state.selEl);
        p2.dx = Math.round(((p2.dx || 0) + d[1] * step) * 100) / 100;
        p2.dy = Math.round(((p2.dy || 0) + d[2] * stepY) * 100) / 100;
        applySlotOffset(node, p2.dx, p2.dy);
        markDirty();
        renderInspector();
      });
      nudge.appendChild(btn);
    });
    var reset = el("button", "ed-btn ed-btn--sm", "للأصل");
    reset.type = "button";
    reset.addEventListener("click", function () {
      snapshot();
      if (block.layout) delete block.layout[state.selEl];
      applySlotOffset(node, 0, 0);
      markDirty();
      renderInspector();
    });
    nudge.appendChild(reset);
    var posUnit = slotIsPx(state.selEl) ? "px" : "٪";
    body.appendChild(ctrlRow(
      "الموضع (" + (pos.dx || 0) + posUnit + " / " + (pos.dy || 0) + posUnit + ")",
      nudge));

    // ---- إضافة جوّه العنصر
    var isText = node.getAttribute("data-lb-text") === "1";
    var addRow = el("div", "ed-ctrl-line");
    var addImg = el("button", "ed-btn ed-btn--sm", "＋ صورة");
    addImg.type = "button";
    addImg.title = isText ? "هتتحط بعد العنصر" : "هتتحط جوّه العنصر";
    addImg.addEventListener("click", function () {
      openAssetPicker(function (url) {
        var img = node.ownerDocument.createElement("img");
        img.setAttribute("src", url);
        img.setAttribute("alt", "");
        img.setAttribute("style", "max-width:100%;height:auto;display:block");
        insertInto(node, block, img);
      }, "image");
    });
    var addTxt = el("button", "ed-btn ed-btn--sm", "＋ نص");
    addTxt.type = "button";
    addTxt.addEventListener("click", function () {
      var pnode = node.ownerDocument.createElement("p");
      pnode.textContent = "نص جديد — اضغط عليه واكتب";
      insertInto(node, block, pnode);
    });
    addRow.appendChild(addImg);
    addRow.appendChild(addTxt);
    body.appendChild(ctrlRow("إضافة نص أو صورة", addRow));

    // ---- نسخ ولصق وتكرار
    var clipRow = el("div", "ed-ctrl-line");
    var copyB = el("button", "ed-btn ed-btn--sm", "نسخ");
    copyB.type = "button";
    copyB.title = "Ctrl+C";
    copyB.addEventListener("click", function () { copyElement(); renderInspector(); });

    var dupB = el("button", "ed-btn ed-btn--sm", "كرّر");
    dupB.type = "button";
    dupB.title = "Ctrl+D";
    dupB.addEventListener("click", duplicateElement);

    var pasteB = el("button", "ed-btn ed-btn--sm", "لصق");
    pasteB.type = "button";
    pasteB.title = "Ctrl+V — بيلزق بعد العنصر";
    pasteB.disabled = !state.clip;
    pasteB.addEventListener("click", function () { pasteElement(false); });

    var pasteIn = el("button", "ed-btn ed-btn--sm", "لصق جوّه");
    pasteIn.type = "button";
    pasteIn.disabled = !state.clip || isText;
    pasteIn.addEventListener("click", function () { pasteElement(true); });

    clipRow.appendChild(copyB);
    clipRow.appendChild(dupB);
    clipRow.appendChild(pasteB);
    clipRow.appendChild(pasteIn);
    body.appendChild(ctrlRow("نسخ ولصق", clipRow));

    // ---- إخفاء وحذف
    var acts = el("div", "ed-ctrl-line");
    var up = el("button", "ed-btn ed-btn--sm", "↰ الأب");
    up.type = "button";
    up.title = "اختار العنصر اللي شايله";
    up.addEventListener("click", selectParentElement);

    var hidden = node.style.display === "none";
    var hide = el("button", "ed-btn ed-btn--sm", hidden ? "إظهار" : "إخفاء");
    hide.type = "button";
    hide.addEventListener("click", function () {
      snapshot(); setStyle("display", hidden ? "" : "none"); requestPreview();
    });

    var del = el("button", "ed-btn ed-btn--sm ed-btn--danger", "احذف");
    del.type = "button";
    del.title = "Delete";
    del.addEventListener("click", deleteElement);

    acts.appendChild(up);
    acts.appendChild(hide);
    acts.appendChild(del);
    body.appendChild(acts);

    if (isImg) {
      body.appendChild(el("p", "ed-hint",
        "اسحب الصورة وسيبها فوق صورة تانية في نفس القسم عشان يتبدّلوا " +
        "مع بعض — الهدف بيتعلّم بإطار مقطّع قبل ما تسيب."));
    }

    body.appendChild(el("p", "ed-hint",
      "ضغطة = اختيار · ضغطتين = كتابة · Esc يخرج من الكتابة. " +
      "Delete يحذف · Ctrl+C نسخ · Ctrl+V لصق · Ctrl+D تكرار · " +
      "الأسهم تحرّك ربع خطوة (مع Shift خطوة كاملة) · " +
      "Shift مع السحب = حركة دقيقة"));

    /* عنصر مالوش ولا أداة تنسيق (الخريطة مثلاً) — الترس يتشال بدل ما
       يفضل زرار بيفتح لوحة فاضية. */
    if (!typoPanel.childElementCount) {
      var gearRow = typoGear.closest ? typoGear.closest(".ed-field") : null;
      if (!textNode && gearRow) gearRow.remove();
      else if (typoGear.parentNode) typoGear.remove();
      typoPanel.remove();
    }

    return wrap;
  }

  /* ألوان القسم المستورد.

     القالب الجاهز بيحط ألوانه في CSS، والمستخدم مش المفروض يفتح الكود
     عشان يغيّر لون. بنستخرج كل لون مكتوب في ستايل القسم ونعرضه كـswatch،
     وأي تغيير بيتبدّل في كل مكان اللون ده مذكور فيه — في الستايل وفي
     خصائص style="" المضمّنة. */
  var HEX_RE = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
  var RGB_RE = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+\s*)?\)/g;

  function hex6(v) {
    if (v.length === 4) {
      return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return v.toLowerCase();
  }

  function rgbToHex(v) {
    var m = v.match(/\d{1,3}/g);
    if (!m || m.length < 3) return null;
    return "#" + m.slice(0, 3).map(function (x) {
      var n = Math.max(0, Math.min(255, parseInt(x, 10)));
      return (n < 16 ? "0" : "") + n.toString(16);
    }).join("");
  }

  /** كل الألوان في القسم مرتّبة بعدد مرات ظهورها (الأكتر أول). */
  function collectColors(block) {
    var text = (block.props.css || "") + "\n" + (block.props.html || "");
    var counts = {}, order = [];
    var add = function (raw, key) {
      if (!key) return;
      if (!counts[key]) { counts[key] = { n: 0, raws: {} }; order.push(key); }
      counts[key].n++;
      counts[key].raws[raw] = 1;
    };
    (text.match(HEX_RE) || []).forEach(function (v) { add(v, hex6(v)); });
    (text.match(RGB_RE) || []).forEach(function (v) { add(v, rgbToHex(v)); });
    order.sort(function (a, b) { return counts[b].n - counts[a].n; });
    return order.slice(0, 12).map(function (key) {
      return { hex: key, count: counts[key].n, raws: Object.keys(counts[key].raws) };
    });
  }

  function replaceColor(block, raws, next) {
    ["css", "html"].forEach(function (k) {
      var v = block.props[k];
      if (typeof v !== "string" || !v) return;
      raws.forEach(function (raw) {
        v = v.split(raw).join(next);
      });
      block.props[k] = v;
    });
  }

  function buildColorGroup(block) {
    var wrap = el("details", "ed-group");
    var sum = el("summary");
    sum.appendChild(el("span", null, "ألوان القسم"));
    wrap.appendChild(sum);
    var body = el("div", "ed-group-body");

    var colors = collectColors(block);
    if (!colors.length) {
      body.appendChild(el("p", "ed-hint", "مفيش ألوان مكتوبة في ستايل القسم ده."));
      wrap.appendChild(body);
      return wrap;
    }
    body.appendChild(el("p", "ed-hint",
      "غيّر أي لون هنا وهيتبدّل في كل مكان مستعمَل فيه داخل القسم."));

    var grid = el("div", "ed-swatches");
    colors.forEach(function (c) {
      var row = el("label", "ed-swatch");
      var input = el("input");
      input.type = "color";
      input.value = c.hex;
      var name = el("span", "ed-swatch-hex", c.hex);
      var uses = el("span", "ed-swatch-n", c.count + "×");

      var raws = c.raws.slice();
      var committed = false;
      input.addEventListener("focus", function () { committed = false; });
      input.addEventListener("input", function () {
        if (!committed) { snapshot(); committed = true; }   // خطوة تراجع واحدة
        replaceColor(block, raws, input.value);
        raws = [input.value];              // الجولة الجاية تبدّل اللون الجديد
        name.textContent = input.value;
        markDirty();
        requestPreview();
      });

      row.appendChild(input);
      row.appendChild(name);
      row.appendChild(uses);
      grid.appendChild(row);
    });
    body.appendChild(grid);
    wrap.appendChild(body);
    return wrap;
  }

  /* مجموعة "المواضع" — بتظهر بس لما يبقى فيه عنصر متحرّك، ومنها
     ضبط دقيق بالسهم أو رجوع للأصل. اللي بيحرّك بالماوس مش محتاجها،
     بس اللي عايز دقة أو بيصلّح غلطة محتاجها. */
  function buildLayoutGroup(block, spec) {
    var wrap = el("details", "ed-group");
    var sum = el("summary");
    sum.appendChild(el("span", null, "مواضع النصوص"));
    wrap.appendChild(sum);
    var body = el("div", "ed-group-body");

    var moved = Object.keys(block.layout || {});
    if (!moved.length) {
      body.appendChild(el("p", "ed-hint",
        "اسحب أي نص داخل المعاينة بالماوس لتحريكه. الإزاحة نسبية فتظل مضبوطة على كل الشاشات."));
      wrap.appendChild(body);
      return wrap;
    }
    var labels = {
      buttons: "الأزرار", ornament_top: "الزخرفة العلوية",
      ornament_bottom: "الزخرفة السفلية", image: "الصورة", gallery: "المعرض",
      map: "الخريطة", countdown: "العدّاد", qr: "رمز QR", form: "نموذج الحضور",
      details: "التفاصيل", video: "الفيديو", hosts: "أصحاب الدعوة",
      agenda: "البرنامج", share: "أزرار المشاركة", scroll_hint: "إشارة التمرير"
    };
    (spec.props || []).forEach(function (f) { labels[f.key] = f.label; });

    moved.forEach(function (slot) {
      var pos = block.layout[slot];
      var row = el("div", "ed-field");
      var lab = el("label");
      lab.appendChild(el("span", null, labels[slot] || slot));
      var val = el("b", null, pos.dx.toFixed(1) + "٪ / " + pos.dy.toFixed(1) + "٪");
      lab.appendChild(val);
      row.appendChild(lab);

      var line = el("div", "ed-row");
      [["→", "dx", 0.5], ["←", "dx", -0.5], ["↓", "dy", 0.5], ["↑", "dy", -0.5]].forEach(function (b) {
        var btn = el("button", "ed-btn ed-btn--sm", b[0]);
        btn.type = "button";
        btn.title = "تحريك خطوة صغيرة";
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          snapshot();
          pos[b[1]] = Math.round((pos[b[1]] + b[2]) * 100) / 100;
          var n = frameDoc() && frameDoc().querySelector(
            '[data-block="' + block.id + '"] [data-slot="' + slot + '"]');
          if (n) applySlotOffset(n, pos.dx, pos.dy);
          val.textContent = pos.dx.toFixed(1) + "٪ / " + pos.dy.toFixed(1) + "٪";
          markDirty();
        });
        line.appendChild(btn);
      });
      var zero = el("button", "ed-btn ed-btn--sm", "صفّر");
      zero.type = "button";
      zero.addEventListener("click", function () {
        snapshot();
        pos.dx = 0; pos.dy = 0;
        var n = frameDoc() && frameDoc().querySelector(
          '[data-block="' + block.id + '"] [data-slot="' + slot + '"]');
        if (n) applySlotOffset(n, 0, 0);
        pruneLayout(block);
        markDirty(); renderInspector();
      });
      line.appendChild(zero);
      row.appendChild(line);
      body.appendChild(row);
    });

    var reset = el("button", "ed-btn ed-btn--sm ed-btn--block", "إرجاع كل المواضع للأصل");
    reset.type = "button";
    reset.addEventListener("click", function () { resetBlockLayout(block.id); });
    body.appendChild(reset);

    wrap.appendChild(body);
    return wrap;
  }

  // ==========================================================
  // لوحة الثيم والإعدادات
  // ==========================================================
  function renderThemePane() {
    var box = refs.themePane;
    if (!box) return;
    box.replaceChildren();
    box.appendChild(el("p", "ed-kicker", "الهوية البصرية"));
    box.appendChild(el("p", "ed-hint",
      "هذه القيم تنطبق على الدعوة كلها. أي قسم يمكن أن يتجاوزها من تبويب خصائصه."));
    box.appendChild(buildGroups(
      SCHEMA.theme_fields,
      function (s) { return state.doc.theme[s.key]; },
      function (s, v) { state.doc.theme[s.key] = v; markDirty(); requestPreview(); }
    ));
    syncCollapseTool();
  }

  // ==========================================================
  // الترجمة — النسخة الإنجليزية للدعوة
  // ==========================================================
  /* مفيش ترجمة آلية: المصمّم بيكتب الإنجليزي بإيده وبيتخزّن جوّه
     المستند في ‎doc.i18n.en‎ كخريطة «مفتاح ← نص».

     شكل المفتاح هنا لازم يطابق اللي بايثون بتقراه في ‎apply_i18n‎ —
     فيه اختبار بيتأكد إن التنين متفقين، لأن أي فرق معناه ترجمة
     مكتوبة ومش ظاهرة والمستخدم مش هيعرف ليه. */
  var I18N_TEXT = { text: 1, textarea: 1 };

  /* نص وحدة واحدة من عنصر معلّم بـ‎data-move‎، أو ‎null‎ لو جوّاه وسوم
     حقيقية. ‎<br>‎ مسموح وبيتحوّل لسطر جديد — الجملة المكتوبة على
     سطرين جملة واحدة بيقراها الضيف. لازم يفضل مطابق لـ‎customtext.py‎. */
  function i18nUnitText(node) {
    var kids = node.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName !== "BR") return null;
    }
    var out = "";
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) out += n.textContent;
      else if (n.nodeType === 1 && n.tagName === "BR") out += "\n";
    });
    return out.split("\n").map(function (l) { return l.trim(); })
              .join("\n").trim();
  }
  var I18N_DATA = [
    ["name_one", "الاسم الأول"],
    ["name_two", "الاسم الثاني"],
    ["event_type", "نوع المناسبة"],
    ["venue", "اسم القاعة"],
    ["address", "العنوان"],
  ];

  /* لغة الدعوة الأساسية واللغة التانية — نفس منطق ‎blocks.py‎ بالظبط.
     الافتراضي عربي عشان الدعوات القديمة تفضل زي ما هي. */
  function baseLang() {
    var v = ((state.doc.theme || {}).base_lang || "ar").toLowerCase();
    return v === "en" ? "en" : "ar";
  }
  function altLang() { return baseLang() === "ar" ? "en" : "ar"; }
  /* اسمين لكل لغة: واحد اسم («النسخة العربية») وواحد صفة
     («كل نص عربي») — العربي مابيقبلش نفس الكلمة في الاتنين. */
  var LANG_NAME = { ar: "العربية", en: "الإنجليزية" };
  var LANG_ADJ = { ar: "عربي", en: "إنجليزي" };
  var LANG_DIR = { ar: "rtl", en: "ltr" };
  var LANG_PLACEHOLDER = { ar: "بالعربي…", en: "English…" };

  function i18nTable() {
    var alt = altLang();
    if (!state.doc.i18n) state.doc.i18n = {};
    if (!state.doc.i18n[alt]) state.doc.i18n[alt] = {};
    return state.doc.i18n[alt];
  }

  /* تنسيق كل نص مترجَم لوحده. الخط اللي يليق بالعربي مش بالضرورة يليق
     باللاتيني، فالترس اللي جنب الخانة بيغيّر خط النسخة المترجَمة بس —
     النص الأصلي بيفضل بخطه زي ما هو. */
  function i18nStyleTable() {
    var alt = altLang();
    if (!state.doc.i18n_style) state.doc.i18n_style = {};
    if (!state.doc.i18n_style[alt]) state.doc.i18n_style[alt] = {};
    return state.doc.i18n_style[alt];
  }

  var I18N_STYLE_SPECS = [
    { key: "font", label: "خط النسخة المترجَمة", type: "font",
      help: "سيبه فاضي عشان ياخد خط الدعوة." },
    { key: "size", label: "حجم الخط", type: "range", min: 0, max: 160,
      step: 1, unit: "px", help: "صفر = نفس حجم النص الأصلي." }
  ];

  /** ترس التنسيق لصف ترجمة واحد.

     محتوى اللوحة **بيتبني عند أول فتح بس**. قايمة الخطوط فيها كل خطوط
     المكتبة وكل ‎<option>‎ بياخد ‎font-family‎ بتاعته، وجدول الترجمة فيه
     عشرات الصفوف — فبناء اللوحات كلها مقدّماً كان بيعلّق المحرر تماماً،
     وبيتعاد مع كل تعديل لأن ‎renderI18nPane‎ بتعيد بناء الجدول. */
  function buildI18nStyleGear(key) {
    var gear = el("button", "ed-font-gear", "⚙");
    gear.type = "button";
    gear.title = "خط وحجم النص المترجَم — النص الأصلي مايتأثرش";
    gear.setAttribute("aria-label", "تنسيق النص المترجَم");
    // علامة إن النص ده متظبّط خطه — تبان من غير ما تفتح كل ترس
    if (i18nStyleTable()[key]) gear.classList.add("is-set");

    var panel = el("div", "ed-inline-font-panel");
    panel.hidden = true;
    var built = false;

    function buildOnce() {
      if (built) return;
      built = true;
      I18N_STYLE_SPECS.forEach(function (spec) {
        panel.appendChild(buildField(spec,
          function () {
            var row = i18nStyleTable()[key];
            return row ? row[spec.key] : (spec.type === "range" ? 0 : "");
          },
          function (v) {
            var table = i18nStyleTable();
            var row = table[key] || {};
            var empty = v === "" || v === null || v === undefined ||
                        (spec.type === "range" && !Number(v));
            if (empty) delete row[spec.key]; else row[spec.key] = v;
            if (Object.keys(row).length) table[key] = row; else delete table[key];
            gear.classList.toggle("is-set", !!table[key]);
            markDirty();
            requestPreview();
          }));
      });
    }

    gear.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      buildOnce();
      panel.hidden = !panel.hidden;
      gear.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    });
    return { gear: gear, panel: panel };
  }

  /** كل النصوص اللي ينفع تترجم — بنفس ترتيب ظهورها في الدعوة. */
  function i18nRows() {
    var rows = [];
    var push = function (key, label, value, group) {
      if (typeof value !== "string" || !value.trim()) return;
      rows.push({ key: key, label: label, value: value, group: group });
    };

    I18N_DATA.forEach(function (d) {
      var input = $('[data-inv-field="' + d[0] + '"]');
      push("data." + d[0], d[1], input ? input.value : "", "بيانات المناسبة");
    });

    (SCHEMA.settings_fields || []).forEach(function (s) {
      if (s.translate_units) {
        var src = state.doc.settings[s.key];
        if (typeof src !== "string" || !src) return;
        var box = new DOMParser().parseFromString(
          "<div>" + src + "</div>", "text/html").body.firstChild;
        Array.prototype.forEach.call(box.querySelectorAll("[data-move]"),
          function (n) {
            var text = i18nUnitText(n);
            if (text === null) return;
            push("settings." + s.key + "#" + n.getAttribute("data-move"),
                 "نص", text, "إعدادات الدعوة");
          });
        return;
      }
      if (s.translate === false || s.editor_hidden || !I18N_TEXT[s.type]) return;
      push("settings." + s.key, s.label, state.doc.settings[s.key], "إعدادات الدعوة");
    });

    (state.doc.blocks || []).forEach(function (block) {
      var spec = blockSpec(block.type);
      if (!spec) return;
      var group = block.label || spec.label;
      var props = block.props || {};
      spec.props.forEach(function (f) {
        var v = props[f.key];
        /* القسم المستورد وخانة «كود متقدّم»: الكلام جوّه الكود نفسه.
           الفحص ده قبل حاجز ‎translate‎ عن قصد — الحقل مايتترجمش
           كقيمة واحدة، بس وحدات النص اللي جوّاه تتترجم. لازم يفضل
           مطابق لـ‎translatable_entries‎ في blocks.py. */
        if (f.type === "html" || f.translate_units) {
          /* القسم المستورد كلامه جوّه الكود. بنقرا وحدات النص اللي
             المحرر معلّمها بـ‎data-move‎ ونعرض كل واحدة لوحدها —
             العنصر اللي جواه وسوم تانية بنسيبه، عشان الاستبدال
             مايمسحش ‎<br>‎ أو ‎<span>‎ ملوّن والمصمّم مايفهمش راح فين. */
          if (typeof v !== "string" || !v) return;
          var root = new DOMParser().parseFromString(
            "<div>" + v + "</div>", "text/html").body.firstChild;
          Array.prototype.forEach.call(root.querySelectorAll("[data-move]"),
            function (n) {
              var text = i18nUnitText(n);
              if (text === null) return;
              push(block.id + "." + f.key + "#" + n.getAttribute("data-move"),
                   "نص", text, group);
            });
          return;
        }
        if (f.translate === false) return;      // كود مش كلام
        if (I18N_TEXT[f.type]) {
          push(block.id + "." + f.key, f.label, v, group);
        } else if (f.type === "list" && Array.isArray(v)) {
          v.slice(0, 60).forEach(function (item, i) {
            if (!item || typeof item !== "object") return;
            (f.fields || []).forEach(function (sub) {
              if (!I18N_TEXT[sub.type]) return;
              push(block.id + "." + f.key + "." + i + "." + sub.key,
                   f.label + " " + (i + 1) + " — " + sub.label,
                   item[sub.key], group);
            });
          });
        }
      });
    });
    return rows;
  }

  function renderI18nPane() {
    var pane = $("[data-pane='i18n']");
    if (!pane) return;
    var host = $("[data-i18n-fields]", pane);
    var countEl = $("[data-i18n-count]", pane);
    if (!host) return;
    host.replaceChildren();

    /* عناوين اللوحة بتتكتب من لغة الدعوة نفسها: دعوة عربية بتطلب
       النسخة الإنجليزية، ودعوة إنجليزية بتطلب النسخة العربية. */
    var altName = LANG_NAME[altLang()];
    var kicker = $(".ed-kicker", pane);
    if (kicker) kicker.textContent = "النسخة " + altName;
    var intro = $("[data-i18n-intro]", pane);
    if (intro) {
      intro.textContent =
        "اكتب مقابل كل نص " + LANG_ADJ[baseLang()] + " نسخته " + altName + ". اللي تسيبه " +
        "فاضي بيفضل ظاهر بلغة الدعوة الأساسية. زرار اللغة مابيظهرش للضيف " +
        "غير لما تكتب سطر واحد على الأقل.";
    }

    var rows = i18nRows();
    var table = i18nTable();

    // مفاتيح اتخزّنت لنصوص اتغيّرت أو اتمسحت — بتفضل في المستند وهي
    // ميّتة. بنشيلها هنا عشان العدّاد يقول الحقيقة وزرار اللغة مايظهرش
    // بسبب ترجمة لقسم اتحذف.
    var live = {};
    rows.forEach(function (r) { live[r.key] = 1; });
    Object.keys(table).forEach(function (k) {
      if (!live[k]) delete table[k];
    });
    var styles = i18nStyleTable();
    Object.keys(styles).forEach(function (k) {
      if (!live[k]) delete styles[k];
    });

    var done = Object.keys(table).length;
    if (countEl) {
      countEl.textContent = done
        ? "مترجَم " + done + " من " + rows.length + " نص."
        : "لسه مفيش أي نص مترجَم — زرار اللغة مخفي عن الضيف.";
    }

    if (!rows.length) {
      host.appendChild(el("p", "ed-empty", "مفيش نصوص في الدعوة عشان تترجمها."));
      return;
    }

    var groups = {}, order = [];
    rows.forEach(function (r) {
      if (!groups[r.group]) { groups[r.group] = []; order.push(r.group); }
      groups[r.group].push(r);
    });

    order.forEach(function (name) {
      var wrap = el("details", "ed-group");
      wrap.open = true;
      var sum = el("summary");
      sum.appendChild(el("span", null, name));
      wrap.appendChild(sum);
      var body = el("div", "ed-group-body");

      groups[name].forEach(function (r) {
        var fld = el("div", "ed-field");
        var lab = el("label");
        lab.appendChild(el("span", null, r.label));
        fld.appendChild(lab);
        // نص اللغة الأساسية معروض مش قابل للتعديل — تعديله مكانه تبويبه
        var src = el("p", "ed-i18n-src", r.value);
        src.setAttribute("dir", LANG_DIR[baseLang()]);
        fld.appendChild(src);

        var multiline = r.value.length > 60 || r.value.indexOf("\n") > -1;
        var input = el(multiline ? "textarea" : "input", "ed-input");
        var styleGear = buildI18nStyleGear(r.key);
        // الاتجاه والـplaceholder بيتبعوا اللغة المطلوبة، مش إنجليزي دايماً
        input.setAttribute("dir", LANG_DIR[altLang()]);
        input.setAttribute("placeholder", LANG_PLACEHOLDER[altLang()]);
        if (input.tagName === "TEXTAREA") input.rows = 3;
        input.value = table[r.key] || "";
        input.addEventListener("input", function () {
          var v = input.value.trim();
          if (v) table[r.key] = v; else delete table[r.key];
          markDirty();
        });
        input.addEventListener("change", function () {
          renderI18nPane();
          requestPreview();
        });
        // الخانة والترس جنب بعض في سطر واحد، والّلوحة تحتهم
        var row = el("div", "ed-i18n-row");
        row.appendChild(input);
        row.appendChild(styleGear.gear);
        fld.appendChild(row);
        fld.appendChild(styleGear.panel);
        body.appendChild(fld);
      });

      wrap.appendChild(body);
      host.appendChild(wrap);
    });

    /* معاينة النسخة الإنجليزية جوّه المحرر. المعاينة بتتبعت للسيرفر
       أصلاً مع كل تعديل، فبنبعت معاها اللغة بس — نفس الكود اللي
       بيشوفه الضيف، مش محاكاة ليه. */
    var shownLang = state.previewLang || state.previewLangRendered || baseLang();
    var showingAlt = shownLang === altLang();
    var peek = el("button", "ed-btn ed-btn--sm ed-btn--block",
      showingAlt ? "رجّع المعاينة " + LANG_ADJ[baseLang()]
                 : "عاين بالنسخة " + altName);
    peek.type = "button";
    peek.addEventListener("click", function () {
      state.previewLang = showingAlt ? baseLang() : altLang();
      // اختيار صريح من المحرر: نخلّي ‎previewLangNow‎ ماتاخدش لغة الإطار
      state.previewLangRendered = state.previewLang;
      renderI18nPane();
      requestPreview();
    });
    host.insertBefore(peek, host.firstChild);

    var clear = $("[data-i18n-clear]", pane);
    if (clear && !clear.dataset.bound) {
      clear.dataset.bound = "1";
      clear.addEventListener("click", function () {
        if (!Object.keys(i18nTable()).length) return;
        var name = LANG_NAME[altLang()];
        if (!window.confirm("امسح النسخة " + name + " كلها؟")) return;
        snapshot();
        state.doc.i18n[altLang()] = {};
        if (state.doc.i18n_style) state.doc.i18n_style[altLang()] = {};
        markDirty();
        renderI18nPane();
        requestPreview();
        toast("اتمسحت النسخة " + name + " — Ctrl+Z للتراجع", "ok");
      });
    }
    syncCollapseTool();
  }

  function renderSettingsPane() {
    var box = refs.settingsPane;
    if (!box) return;
    var host = $("[data-settings-fields]", box);
    if (!host) return;
    host.replaceChildren();
    host.appendChild(buildGroups(
      SCHEMA.settings_fields,
      function (s) { return state.doc.settings[s.key]; },
            function (s, v) {
        state.doc.settings[s.key] = v;
        markDirty();
        // إعدادات الافتتاحية لا تحتاج تفريغ stage أو إعادة تشغيل runtime.
        // نطلب من applyPreview تبديل intro فقط حتى لا تظهر شاشة بيضاء.
        if (String(s.key || "").indexOf("intro_") === 0) {
          // تأثيرات وألوان زر التشغيل تتغير داخل iframe فوراً ولا تحتاج
          // إعادة بناء الافتتاحية أو طلب HTML جديد من السيرفر.
          if (applyIntroOptionLocally(s.key, v)) return;
          state.previewIntroOnly = true;
        }
        requestPreview();
      }

    ));
    syncCollapseTool();
  }

  // ==========================================================
  // المعاينة الحية
  // ==========================================================
  var previewReady = false;

  function frameDoc() {
    var frame = refs.frame;
    try { return frame && frame.contentDocument; } catch (e) { return null; }
  }


  function captureEditorScroll() {
    return {
      windowX: window.scrollX || window.pageXOffset || 0,
      windowY: window.scrollY || window.pageYOffset || 0,
      panelY: refs.panel ? refs.panel.scrollTop : 0,
      inspectorY: refs.inspector ? refs.inspector.scrollTop : 0
    };
  }

  function restoreEditorScroll(saved) {
    if (!saved) return;
    var restore = function () {
      window.scrollTo(saved.windowX, saved.windowY);
      if (refs.panel) refs.panel.scrollTop = saved.panelY;
      if (refs.inspector) refs.inspector.scrollTop = saved.inspectorY;
    };
    restore();
    window.requestAnimationFrame(restore);
    window.setTimeout(restore, 40);
  }

  /* اللغة اللي المعاينة معروضة بيها **فعلاً**.

     الضيف عنده زرار لغة جوّه المعاينة نفسها. لو المصمّم بدّل منه
     وبعدين غيّر أي حاجة (خط مثلاً)، كنا بنبعت اللغة الأساسية للسيرفر
     فالمعاينة بترجع للغة التانية لوحدها — وده اللي كان شكله «القالب
     بيقلب لغة وانا بغيّر خط»، وكمان كان بيخفي التعديل اللي لسه اتعمل.

     ‎previewLangRendered‎ بتفرّق بين الحالتين: لو اللغة اللي في الإطار
     مختلفة عن آخر لغة إحنا رسمناها، يبقى المستخدم بدّلها من جوّه —
     بناخدها. غير كده اختيار المحرر (زرار «عاين بالنسخة …») هو اللي يكسب. */
  function previewLangNow() {
    var fdoc = frameDoc();
    var shown = fdoc && fdoc.documentElement &&
                fdoc.documentElement.getAttribute("lang");
    if ((shown === "ar" || shown === "en") &&
        shown !== state.previewLangRendered) {
      state.previewLang = shown;
    }
    var lang = state.previewLang || baseLang();
    state.previewLangRendered = lang;
    return lang;
  }

  var requestPreview = debounce(function () {
    if (!previewReady) return;
    var editorScroll = captureEditorScroll();
        var fdoc = frameDoc();
    if (!fdoc) return;
    var previewIntroOnly = !!state.previewIntroOnly;
    state.previewIntroOnly = false;

    fetch(META.urls.preview, {

            method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify({ document: state.doc, lang: previewLangNow() })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        
        if (!data || !data.ok) { toast("تعذّر تحديث المعاينة.", "error"); return; }
        applyPreview(data, editorScroll, previewIntroOnly);

      })
      .catch(function () {
        
        toast("تعذّر الاتصال بالخادم لتحديث المعاينة.", "error");
      });
  }, 280);

  /* تحديث الشاشة الافتتاحية داخل المعاينة.

     الافتتاحية أخت لـ.lb-stage مش جواه، فتبديل الـstage لوحده كان
     بيسيبها زي ما هي — يعني تغيّر نص الافتتاحية أو صورتها وماتشوفش
     أي فرق غير لما تقفل المحرر وتفتحه تاني. */
    function applyIntroOptionLocally(key, value) {
    // الوضعان اليدويان لم يعودا مجرد class: وضع button يعرض نصاً فقط،
    // بينما button_effects يعرض markup مختلفاً بأيقونة وتأثيرات. لذلك نطلب
    // HTML الافتتاحية الجديد فوراً حتى يعمل التبديل في الاتجاهين من أول مرة.
    if (key === "intro_play_mode") return false;

    var fdoc = frameDoc();
    if (!fdoc) return false;
    var play = fdoc.querySelector("[data-intro-play]");
    if (!play) return false;

    if (key === "intro_play_color") {

      play.style.setProperty("--intro-item-color", String(value || ""));
      return true;
    }
    if (key === "intro_play_bg_color") {
      play.style.setProperty("--intro-play-bg", String(value || ""));
      return true;
    }
    return false;
  }

  /* جافاسكربت خانة «كود متقدّم».

     المعاينة بتتحدّث بـ‎stage.innerHTML = html‎، والمتصفح **مابيشغّلش**
     أي ‎<script>‎ بيدخل بالطريقة دي — فالكود كان بيشتغل في الدعوة
     المنشورة وماينفّذش في المحرر، والمصمّم يفتكره باظ. الحل المعتاد:
     نستبدل كل وسم بوسم جديد اتعمل بـ‎createElement‎، وده بيشتغل.

     السكربت بيتنقل مكان القديم بالظبط عشان ‎document.currentScript‎
     جوّه اللفّة تلاقي القسم الصح. */
  function runSectionScripts(fdoc) {
    if (!fdoc) return;
    /* ‎data-lb-ran‎ بيتحط على النسخة اللي اشتغلت. من غيره كان السكربت
       يتنفّذ تاني مع **كل** تحديث معاينة — والتحديث بيحصل مع كل حرف
       بتكتبه — فمستمعات الأحداث والمؤقتات تتكرّر والكود يتصرّف غلط.
       التحديث الكامل بيستبدل محتوى المسرح، فالسكربتات الجديدة بتيجي
       من السيرفر من غير العلامة دي وبتشتغل مرة واحدة. */
    fdoc.querySelectorAll(
      "script[data-lb-section-script]:not([data-lb-ran])"
    ).forEach(function (old) {
      var fresh = fdoc.createElement("script");
      fresh.setAttribute("data-lb-section-script", "1");
      fresh.setAttribute("data-lb-ran", "1");
      fresh.textContent = old.textContent;
      old.parentNode.replaceChild(fresh, old);
    });
  }

  function applyIntro(fdoc, html) {
    if (html === undefined) return;          // نسخة سيرفر قديمة — ما نلمسش حاجة
    var current = fdoc.querySelector(".lb-intro");
    // لا نحذف الافتتاحية عند رد معاينة ناقص؛ الحذف يحصل فقط إذا أُغلقت فعلاً.
    if (!html) {
      if (current && state.doc && state.doc.settings && state.doc.settings.intro_enabled === false) current.remove();
      return;
    }

    // لو الضيف/المحرر كان قافلها (is-open)، نفضل قافلينها بعد التحديث
    // عشان ما ترجعش تغطّي المعاينة مع كل حرف بتكتبه
    var wasOpen = current && current.classList.contains("is-open");
    var holder = fdoc.createElement("div");
    holder.innerHTML = html;
    var fresh = holder.firstElementChild;
    if (!fresh) return;
    if (wasOpen) fresh.classList.add("is-open");

    if (current) current.replaceWith(fresh);
    else fdoc.body.insertBefore(fresh, fdoc.body.firstChild);
  }

    function applyMusic(fdoc, cfg) {
    if (!fdoc) return;
    var node = fdoc.getElementById("invite-music");
    if (!node) return;
    node.textContent = JSON.stringify(cfg || {});
    var win = fdoc.defaultView;
    if (win && typeof win.__lbRefreshMusic === "function") {
      try { win.__lbRefreshMusic(); } catch (ignore) {}
    }
  }

  function applyFontCss(fdoc, css) {

    var style = fdoc.querySelector("style[data-font-faces]");
    if (!css) {
      if (style) style.remove();
      return;
    }
    if (!style) {
      style = fdoc.createElement("style");
      style.setAttribute("data-font-faces", "");
      (fdoc.head || fdoc.documentElement).appendChild(style);
    }
    style.textContent = css;
  }

  /* إزاحات النصوص وتنسيق كل نص لوحده بيتولدوا على السيرفر وبيعيشوا في
     رأس الإطار. ‎applyPreview‎ بتبدّل محتوى المسرح بس، فلو ماكتبناش
     الستايل ده من جديد كان بيفضل بتاع أول تحميل: تغيّر لون من الترس
     أو تحرّك نص، الرد يرجع، وشكل الصفحة زي ما هو لحد ريفريش كامل.
     بنكتب في **نفس** الوسم اللي القالب طبعه (‎data-lb-layout-css‎) مش
     في وسم جديد، عشان القاعدة القديمة تتشال فعلاً مش تتغطّى. */
  function applyLayoutCss(fdoc, css) {
    applyHeadCss(fdoc, "data-lb-layout-css", css);
  }

  /* ستايل الرأس اللي السيرفر بيولّده لكل مستند. لازم كل واحد فيهم
     يتكتب في **نفس** وسمه المتعلّم بعد كل تحديث معاينة، عشان القاعدة
     القديمة تتشال فعلاً مش تتغطّى. */
  function applyHeadCss(fdoc, attr, css) {
    if (!fdoc || typeof css !== "string") return;
    var style = fdoc.querySelector("style[" + attr + "]");
    if (!style) {
      style = fdoc.createElement("style");
      style.setAttribute(attr, "");
      (fdoc.head || fdoc.documentElement).appendChild(style);
    }
    style.textContent = css;
  }

  /* نفس منطق ‎_COUNTDOWN_DATE_RE‎ في ‎renderer.py‎: أي اسم متغيّر، بشرط
     إن التاريخ مكتوب بالإيد. ‎new Date()‎ الفاضية مابتتلمسش. */
  var COUNTDOWN_RUNTIME_DATE_RE =
    /\b(var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*new\s+Date\(\s*(?:\d{4}\s*,[^)]*|["'][^"']{4,}["']\s*|\d{9,}\s*)\)/;

  function restartTemplateRuntime(fdoc, countdownDate) {
    if (!fdoc) return Promise.resolve();
    var current = Array.prototype.slice.call(fdoc.querySelectorAll("script[data-lb-template-runtime]"));
    if (!current.length && !fdoc.__lbRuntimeOriginal) return Promise.resolve();
    if (!fdoc.__lbRuntimeOriginal) {
      fdoc.__lbRuntimeOriginal = current.map(function (script) {
        return {
          src: script.getAttribute("src") || "",
          type: script.getAttribute("type") || "",
          code: script.textContent || ""
        };
      });
    }
    var descriptors = fdoc.__lbRuntimeOriginal.map(function (item) {
      var copy = { src: item.src, type: item.type, code: item.code };
      if (!copy.src && countdownDate && COUNTDOWN_RUNTIME_DATE_RE.test(copy.code)) {
        copy.code = copy.code.replace(
          COUNTDOWN_RUNTIME_DATE_RE,
          function (whole, keyword, name) {
            return keyword + " " + name + "=new Date(" +
                   JSON.stringify(String(countdownDate)) + ")";
          }
        );
        /* سكربت العدّاد بيعلن ‎const‎ في النطاق العام. المعاينة بتتحدّث
           كذا مرة في نفس الصفحة، والإعلان التاني بيرمي
           «Identifier already declared» — يعني الموعد الجديد ما بيوصلش
           أبداً والعدّاد يفضل على التاريخ القديم. اللف في دالة بيدّي كل
           تشغيلة نطاقها الخاص. آمن هنا لأن السكربت مقفول على نفسه:
           بيقرا عناصره بالـid ومابيصدّرش حاجة لغيره. */
        copy.code = "(function(){\n" + copy.code + "\n})();";
      }
      return copy;
    });
    current.forEach(function (script) { script.remove(); });

    /* المؤقتات اللي التشغيلة القديمة عملتها لازم تقف قبل الجديدة.
       من غير كده كل تحديث معاينة بيسيب ‎setInterval‎ شغال ورا، وعدّاد
       بالموعد القديم بيفضل يكتب فوق العدّاد الجديد. */
    var frameWin = fdoc.defaultView;
    if (frameWin) {
      (frameWin.__lbRuntimeTimers || []).forEach(function (id) {
        try { frameWin.clearInterval(id); } catch (e) {}
      });
      frameWin.__lbRuntimeTimers = [];
      if (!frameWin.__lbTimersTracked) {
        frameWin.__lbTimersTracked = true;
        var nativeSetInterval = frameWin.setInterval;
        frameWin.setInterval = function () {
          var id = nativeSetInterval.apply(this, arguments);
          if (frameWin.__lbRuntimeTimers) frameWin.__lbRuntimeTimers.push(id);
          return id;
        };
      }
    }

    var chain = Promise.resolve();
    descriptors.forEach(function (item) {
      chain = chain.then(function () {
        return new Promise(function (resolve) {
          var script = fdoc.createElement("script");
          script.setAttribute("data-lb-template-runtime", "");
          if (item.type) script.setAttribute("type", item.type);
          var done = false;
          var finish = function () {
            if (done) return;
            done = true;
            resolve();
          };
          if (item.src) {
            script.src = item.src;
            script.onload = finish;
            script.onerror = finish;
            // لا نسمح لملف خارجي واحد أن يعلق تحديث المحرر.
            setTimeout(finish, 4000);
          } else {
            script.text = item.code;
          }
          (fdoc.body || fdoc.documentElement).appendChild(script);
          if (!item.src) finish();
        });
      });
    });
    return chain;
  }

    function applyPreview(data, editorScroll, introOnly) {

    drag = null;

    clearGuides();
    var fdoc = frameDoc();
    if (!fdoc) return;
    var stage = fdoc.querySelector(".lb-stage");
    if (!stage) return;

    /* إعادة بناء الـclass تحت كانت بتشيل ‎lb-stage--runtime‎ وأخواتها.
       بدونها المسرح بيرجع لعرض كارت الدعوة (‎max-width‎) بدل عرض الشاشة
       الكامل، فحسابات شبكة Tilda بتتغيّر وكل العناصر بتتزحزح — يعني
       أول تحديث معاينة بعد أي تعديل كان بيخلّي المحرر يوري حاجة غير
       اللي هتطلع في المعاينة العامة. */
    var keptStageClasses = Array.prototype.filter.call(
      stage.classList,
      function (name) {
        return name === "lb-stage--runtime" || name.indexOf("t-records") === 0;
      }
    ).join(" ");

    /* إعادة بناء الـHTML كانت بترجع iframe لأول الصفحة بعد إضافة نص/صورة.
       نحفظ موضع المستند والـstage ونرجّعهم بعد التحديث، عشان المستخدم
       يفضل ثابت في نفس المكان اللي كان واقف فيه. */
    var frameWin = fdoc.defaultView;
    var savedScroll = {
      x: frameWin ? frameWin.scrollX : (fdoc.documentElement.scrollLeft || 0),
      y: frameWin ? frameWin.scrollY : (fdoc.documentElement.scrollTop || 0),
      stageX: stage.scrollLeft || 0,
      stageY: stage.scrollTop || 0
    };

    if (!introOnly) {
      // لا نفرّغ stage إلا في تحديث المستند الكامل؛ تغيير إعدادات intro
      // يستبدل عقدة الافتتاحية فقط حتى لا تظهر شاشة بيضاء.
      var footer = stage.querySelector(".lb-footer");
      /* «فاضي» حالة شرعية: لما تمسح آخر قسم، السيرفر بيرجّع ‎html‎ فاضية
         وده صح. شرط ‎.trim()‎ هنا كان بيتخطّى التحديث، فالقسم المحذوف
         يفضل باين في المعاينة لحد ما تعمل ريفريش. الحماية من رد ناقص
         موجودة فوق أصلاً: ‎applyPreview‎ مابتتنداش غير بعد ‎data.ok‎. */
      if (typeof data.html === "string") stage.innerHTML = data.html;
      if (footer && !stage.contains(footer)) stage.appendChild(footer);

      if (fdoc.body) fdoc.body.setAttribute("style", data.cssVars || "");
      fdoc.documentElement.setAttribute("dir", data.direction || "rtl");

      stage.className = "lb-stage" +
        (keptStageClasses ? " " + keptStageClasses : "") +
        (data.maxWidth >= 1100 ? " lb-stage--full" : "") +
        (data.pattern && data.pattern !== "none" ? " lb-pattern lb-pattern--" + data.pattern : "");
    }

    // الخط قد يتغير من إعدادات الافتتاحية، لذلك نطبقه في الحالتين.
    applyFontCss(fdoc, data.fontCss || "");
    applyLayoutCss(fdoc, data.layoutCss);
    /* مواضع عناصر Tilda وارتفاعات الأقسام بيتحسبوا على السيرفر مع كل
       رد معاينة، لكنهم كانوا بيتكتبوا مرة واحدة وقت تحميل الإطار بس.
       يعني بعد أي تعديل المحرر بيفضل بيوري مواضع **قديمة** والصفحة
       الحية بتوري الجديدة — وده بالظبط «شكل في المحرر وشكل في الدعوة».
       الستايل المشترك بين الأقسام المستوردة كمان بيتغيّر لما قسم
       يتشال أو يتضاف. */
    applyHeadCss(fdoc, "data-zero-block-css", data.zeroCss);
    applyHeadCss(fdoc, "data-imported-css", data.sharedCss);
    applyIntro(fdoc, data.intro);
    applyMusic(fdoc, data.music || {});
    runSectionScripts(fdoc);

    var runtimeReady = introOnly
      ? Promise.resolve()
      : restartTemplateRuntime(fdoc, data.runtimeCountdownDate || "");

    runtimeReady.then(function () {
      bindPreviewInteractions();
      if (refs.frame.contentWindow && refs.frame.contentWindow.__lbRefresh) {
        refs.frame.contentWindow.__lbRefresh();
      }
      if (refs.blockCount) refs.blockCount.textContent = data.blockCount + " قسم";
      if (state.selected) highlightInPreview(state.selected);
    });

    var restore = function () {
      var w = fdoc.defaultView;
      if (w) w.scrollTo(savedScroll.x, savedScroll.y);
      else {
        fdoc.documentElement.scrollLeft = savedScroll.x;
        fdoc.documentElement.scrollTop = savedScroll.y;
      }
      stage.scrollLeft = savedScroll.stageX;
      stage.scrollTop = savedScroll.stageY;
    };
    /* نحتاج محاولتين لأن إعادة تهيئة محتوى الفيديو/الخطوط قد تغيّر
       ارتفاع الصفحة في أول frame بعد استبدال الـHTML. */
    if (frameWin && frameWin.requestAnimationFrame) frameWin.requestAnimationFrame(restore);
    else setTimeout(restore, 0);
    setTimeout(restore, 40);
    restoreEditorScroll(editorScroll);
  }

  /** ربط النقر والتحرير المباشر داخل المعاينة. */

  // ==========================================================
  // سحب النصوص بالماوس داخل المعاينة
  // ==========================================================
  // النموذج "مقيَّد": العنصر بيتزحزح جوّه قسمه بإزاحة نسبية (cqw) مش
  // بإحداثيات مطلقة. يعني الموضع بيتقاس مع الشاشة تلقائياً، ومفيش حاجة
  // اسمها "ظبطه على الديسكتوب فطلع غلط على الموبايل".

  var MAX_X = (SCHEMA.layout_max && SCHEMA.layout_max.x) || 1000;
  var MAX_Y = (SCHEMA.layout_max && SCHEMA.layout_max.y) || 1000;
  var SNAP = 1.2;          // cqw — قرب كده يلزق على الصفر
  var SNAP_PX = 4;         // px — نفس الفكرة لعناصر القوالب المستوردة

  /* عناصر القوالب المستوردة (خانة ‎el-N‎) عايشة جوّه شبكة Tilda الثابتة
     بالبكسل، فإزاحتها لازم تتقاس بالبكسل. الإزاحة النسبية (cqw) بتتحسب
     من عرض المسرح، والمسرح في المحرر إطار جهاز ضيّق وفي المعاينة عرض
     الشاشة كله — فنفس الرقم كان بيطلع إزاحة مختلفة في الاتنين. الأقسام
     العادية بتفضل نسبية زي ما هي عشان تتقاس مع الشاشة. */
  // ‎el-N‎ = عنصر في قالب مستورد، ‎ce-N‎ = عنصر جوّه مربع «كود متقدّم»
  var EL_SLOT_RE = /^(?:el|ce)-\d{1,4}$/;

  /* مربع «كود متقدّم» إزاحته نسبية (cqw = ١٪ من عرض المسرح) زي باقي
     العناصر العادية، مش بالبكسل زي عناصر القوالب المستوردة.

     السبب: المربع بقى بمقاس محتواه ومتوسّط أفقياً، فموضعه الأساسي واحد
     على أي عرض. اللي فاضل هو الإزاحة، ولو اتخزّنت بالبكسل كانت نفس
     الإزاحة تبقى نص الشاشة على الموبايل وشوية على الديسكتوب — فالمربع
     ينزل بره القسم لما تبدّل الجهاز. النسبة بتخلي الموضع «موازي»:
     نفس المكان بالنسبة للقسم على أي مقاس. */
  /* مربع الكود بالبكسل زي عناصره: هو متوسّط وعلى مقاس الكود، فمرجعه
     نص القسم والبكسل بيتطابق بين إطار الموبايل والمعاينة. لو كان
     بالنسبة، السحب بيطلع بشكل لما تمسك المربع من حرفه وبشكل تاني لما
     تمسك الشكل اللي جوّاه — وده اللي المصمّم شافه. */
  function slotUnit(slot) {
    if (slot === "code") return "px";
    return EL_SLOT_RE.test(slot || "") ? "px" : "cqw";
  }

  function slotUnitY(slot) { return slotUnit(slot); }

  function slotIsPx(slot) { return slotUnit(slot) === "px"; }
  var THRESHOLD = 4;       // px — أقل من كده تبقى ضغطة مش سحب
  var drag = null;

  function layoutOf(block, slot) {
    if (!block.layout) block.layout = {};
    if (!block.layout[slot]) block.layout[slot] = { dx: 0, dy: 0 };
    return block.layout[slot];
  }

  function applySlotOffset(node, dx, dy) {
    var slot = node && node.getAttribute && node.getAttribute("data-move");
    node.style.setProperty("--dx", dx + slotUnit(slot));
    node.style.setProperty("--dy", dy + slotUnitY(slot));
  }

  function pruneLayout(block) {
    if (!block.layout) return;
    Object.keys(block.layout).forEach(function (k) {
      var p = block.layout[k];
      if (!p || (!p.dx && !p.dy)) delete block.layout[k];
    });
    if (!Object.keys(block.layout).length) delete block.layout;
  }

  function clearGuides() {
    var fdoc = frameDoc();
    if (!fdoc) return;
    fdoc.querySelectorAll(".lb-guide, .lb-drag-badge").forEach(function (n) { n.remove(); });
  }

  function showGuides(fdoc, node, snapX, snapY, dx, dy, unit, unitY) {
    clearGuides();
    var r = node.getBoundingClientRect();
    if (snapX) {
      var v = fdoc.createElement("div");
      v.className = "lb-guide lb-guide--v";
      v.style.left = Math.round(r.left + r.width / 2) + "px";
      fdoc.body.appendChild(v);
    }
    if (snapY) {
      var h = fdoc.createElement("div");
      h.className = "lb-guide lb-guide--h";
      h.style.top = Math.round(r.top + r.height / 2) + "px";
      fdoc.body.appendChild(h);
    }
    var badge = fdoc.createElement("div");
    badge.className = "lb-drag-badge";
    var suffix = unit === "cqw" ? "%" : unit;
    var suffixY = (unitY || unit) === "cqw" ? "%" : (unitY || unit);
    badge.textContent = dx.toFixed(1) + suffix + " , " + dy.toFixed(1) + suffixY;
    badge.style.left = Math.round(r.left + r.width / 2) + "px";
    badge.style.top = Math.max(6, Math.round(r.top - 30)) + "px";
    badge.style.transform = "translateX(-50%)";
    fdoc.body.appendChild(badge);
  }

  function stageWidth(fdoc) {
    var stage = fdoc.querySelector(".lb-stage");
    return (stage ? stage.getBoundingClientRect().width : fdoc.documentElement.clientWidth) || 1;
  }

  /* ---------------------------------------------------------------
     تبديل صورتين بالسحب

     السحب العادي بيزحزح العنصر بإزاحة صغيرة. لو سِبت صورة **فوق**
     صورة تانية في نفس القسم، النية واضحة إنك عايز تبدّلهم مش تزحزح.
     شرطين عشان ما يحصلش تبديل بالغلط والصور في شبكة جنب بعض:
       ١) الهدف لازم يكون ‎<img>‎ تاني في نفس القسم.
       ٢) الماوس لازم تكون جوّه الـ٦٠٪ الوسطانية منه، مش على حرفه.
     والهدف بيتعلّم بإطار مقطّع قبل ما تسيب، فمفيش مفاجآت. */
  var SWAP_INNER = 0.6;

  function swapCandidate(fdoc, node, x, y) {
    if (node.tagName !== "IMG" || !fdoc) return null;
    var stack = typeof fdoc.elementsFromPoint === "function"
      ? fdoc.elementsFromPoint(x, y) : [];
    var holder = node.closest("[data-block]");
    for (var i = 0; i < stack.length; i++) {
      var t = stack[i];
      if (t === node || t.tagName !== "IMG") continue;
      if (!t.getAttribute("data-move")) continue;
      if (t.closest("[data-block]") !== holder) continue;   // نفس القسم بس
      var r = t.getBoundingClientRect();
      var mx = r.width * (1 - SWAP_INNER) / 2;
      var my = r.height * (1 - SWAP_INNER) / 2;
      if (x < r.left + mx || x > r.right - mx) continue;
      if (y < r.top + my || y > r.bottom - my) continue;
      return t;
    }
    return null;
  }

  function clearSwapTarget(d) {
    if (d && d.swapTarget) d.swapTarget.classList.remove("lb-el-swap");
    if (d) d.swapTarget = null;
  }

  function markSwapTarget(d, x, y) {
    var found = swapCandidate(d.fdoc, d.node, x, y);
    if (found === d.swapTarget) return;
    clearSwapTarget(d);
    if (found) { found.classList.add("lb-el-swap"); d.swapTarget = found; }
  }

  function swapImages(a, b) {
    var keep = { src: a.getAttribute("src"), srcset: a.getAttribute("srcset") };
    var take = { src: b.getAttribute("src"), srcset: b.getAttribute("srcset") };
    var put = function (n, v) {
      if (v.src) n.setAttribute("src", v.src); else n.removeAttribute("src");
      // srcset بيكسب على src — لو سبناها القديمة تفضل ظاهرة
      if (v.srcset) n.setAttribute("srcset", v.srcset); else n.removeAttribute("srcset");
    };
    put(a, take);
    put(b, keep);
  }

  function bindSlotDrag(node, blockId, slot, onDone) {
    // كان العنصر قابل للكتابة قبل السحب؟ الأقسام المستوردة فيها
    // صور و<div> مش نصوص — مانفتحهاش للكتابة بعد السحب بالغلط.
    var wasEditable = function () {
      // الكتابة بقت بضغطتين، فمانرجّعهاش تلقائياً بعد السحب. بنرجّعها
      // بس لو كانت مفتوحة فعلاً قبل ما يبدأ السحب.
      return node.classList.contains("lb-el-typing");
    };
    node.addEventListener("pointerdown", function (e) {
      /* أحداث الماوس بتطلع من الابن للأب. من غير stopPropagation، لما
         تمسك كلمة جوّه فقرة الاتنين بياخدوا الحدث — والأب بيكسب لأنه
         بيتنفّذ بعد الابن، فالقسم كله بيتحرك بدل الكلمة. */
      e.stopPropagation();
      // التحرير الكتابي له الأولوية: لو العنصر متفتَّح للكتابة سيبه
      if (node.getAttribute("contenteditable") === "true") return;
      /* مربع الكود: السحب على الحاوية كلها، فلو الضغطة على كلام اتفتح
         للكتابة جوّاها لازم تعدّي — وإلا مايقدرش يحرّك المؤشر ولا يحدّد
         حرف. (باقي العناصر بتتربط على النص نفسه فالشرط اللي فوق كفاية،
         وكل ‎[data-slot]‎ عليه ‎contenteditable‎ دايماً فمانعمّمش الشرط.) */
      if (slot === "code" && e.target && e.target.closest &&
          e.target.closest("[contenteditable]")) return;
      /* الكانفس سطح رسم: الضغطة عليه شغل كود المصمّم نفسه (خدش،
         رسم بالإصبع، توقيع). من غير الشرط ده الضغطة الواحدة كانت
         بتعمل الاتنين مع بعض — الشكل بيتخربش وبيتحرك في نفس اللحظة.
         التحديد بالضغط لسه شغال، والتحريك من أسهم «الموضع» في اللوحة.
         ‎[data-no-drag]‎ عشان أي عنصر تفاعلي تاني في الكود (سلايدر،
         مقبض) يقدر يطلب نفس المعاملة. */
      if (e.target && e.target.closest &&
          e.target.closest("canvas, [data-no-drag]")) return;
      if (e.button !== 0) return;
      var block = findBlock(blockId);
      if (!block || block.locked) return;

      var fdoc = frameDoc();
      var pos = layoutOf(block, slot);
      drag = {
        node: node, block: block, slot: slot, fdoc: fdoc,
        x0: e.clientX, y0: e.clientY,
        dx0: pos.dx || 0, dy0: pos.dy || 0,
        px: slotIsPx(slot),
        unit: slotIsPx(slot) ? 1 : stageWidth(fdoc) / 100,
        moved: false, pointerId: e.pointerId
      };
      /* المربع بالبكسل زي باقي العناصر — القسم بيتقاس بس عشان الحد
         الأفقي (المربع مايخرجش بره قسمه). */
      var host = (slot === "code" || /^ce-\d/.test(slot || ""))
        ? node.closest("[data-block]") : null;
      var hostRect = host ? host.getBoundingClientRect() : null;
      drag.unitX = drag.unit;
      drag.unitY = drag.unit;
      /* ‎setPointerCapture‎ اتأخّر لحد ما السحب يبدأ فعلاً (تحت في
         ‎pointermove‎). لما كان بيتاخد هنا، المتصفح بيعيد توجيه حدث
         ‎click‎ للحاوية بدل العنصر اللي اتضغط جوّاها — يعني أي زرار أو
         عنصر تفاعلي في كود المصمّم مابيشتغلش في المحرر خالص. */
      // مربع الكود مايخرجش من قسمه أبداً. القسم ‎overflow:hidden‎ فاللي
      // بيخرج بيتقص ويبان ناقص — والمصمّم مش فاهم ليه. بنحسب المدى
      // المسموح من الموضع الأساسي (قبل أي إزاحة) مرة واحدة هنا.
      if (hostRect) {
        var nr = node.getBoundingClientRect();
        var baseL = nr.left - drag.dx0 * drag.unitX;
        var baseT = nr.top - drag.dy0 * drag.unitY;
        drag.limit = {
          minX: (hostRect.left - baseL) / drag.unitX,
          maxX: (hostRect.right - (baseL + nr.width)) / drag.unitX,
          minY: (hostRect.top - baseT) / drag.unitY,
          /* الإزاحة لتحت بقت ‎margin-top‎، يعني القسم بيطول معاها —
             فمفيش حد أقصى يخرج منه أصلاً. الحد القديم (قاع القسم وقت
             الضغط) كان بيمنع أي نزول لو الكود مالي القسم. */
          maxY: slot === "code"
            ? Infinity
            : (hostRect.bottom - (baseT + nr.height)) / drag.unitY
        };
      }
    });

    node.addEventListener("pointermove", function (e) {
      if (!drag || drag.node !== node) return;
      var mx = e.clientX - drag.x0, my = e.clientY - drag.y0;

      if (!drag.moved) {
        if (Math.abs(mx) < THRESHOLD && Math.abs(my) < THRESHOLD) return;
        drag.moved = true;
        // دلوقتي بس بناخد الـcapture — الضغطة العادية بتوصل لجوّه
        try { node.setPointerCapture(e.pointerId); } catch (err) {}
        node.classList.add("lb-dragging");
        node.removeAttribute("contenteditable");   // منع الكتابة أثناء السحب
        if (state.selected !== drag.block.id) selectBlock(drag.block.id);
      }
      e.preventDefault();

      // في RTL محور الصفحة مقلوب، لكن transform دايماً فيزيائي — فبنسيبه زي ما هو
      // Shift بيبطّأ الحركة للربع عشان الظبط الدقيق
      var fine = e.shiftKey ? 0.25 : 1;
      var dx = drag.dx0 + (mx / (drag.unitX || drag.unit)) * fine;
      var dy = drag.dy0 + (my / (drag.unitY || drag.unit)) * fine;

      var snap = drag.px ? SNAP_PX : SNAP;
      // مربع الكود: أفقياً نسبة ورأسياً بكسل — عتبة اللزق لكل محور بوحدته
      var snapYLimit = slotUnitY(drag.slot) === "px" ? SNAP_PX : snap;
      var snapX = Math.abs(dx) < snap, snapY = Math.abs(dy) < snapYLimit;
      if (snapX) dx = 0;
      if (snapY) dy = 0;
      dx = Math.max(-MAX_X, Math.min(MAX_X, dx));
      dy = Math.max(-MAX_Y, Math.min(MAX_Y, dy));
      if (drag.limit) {
        // المربع أعرض/أطول من القسم؟ ساعتها المدى بالسالب — بنلزقه
        // على الحافة بدل ما نطلّع رقم مقلوب.
        dx = Math.min(Math.max(dx, Math.min(drag.limit.minX, drag.limit.maxX)),
                      Math.max(drag.limit.minX, drag.limit.maxX));
        dy = Math.min(Math.max(dy, Math.min(drag.limit.minY, drag.limit.maxY)),
                      Math.max(drag.limit.minY, drag.limit.maxY));
      }

      drag.dx = Math.round(dx * 100) / 100;
      drag.dy = Math.round(dy * 100) / 100;
      applySlotOffset(node, drag.dx, drag.dy);
      showGuides(drag.fdoc, node, snapX, snapY, drag.dx, drag.dy,
                 slotUnit(drag.slot), slotUnitY(drag.slot));
      markSwapTarget(drag, e.clientX, e.clientY);
    });

    function finish(cancel) {
      if (!drag || drag.node !== node) return;
      var d = drag; drag = null;
      try { node.releasePointerCapture(d.pointerId); } catch (err) {}
      clearGuides();
      node.classList.remove("lb-dragging");

      var swapWith = d.swapTarget;
      clearSwapTarget(d);

      if (!d.moved) {                       // ضغطة عادية — رجّع التحرير الكتابي
        if (wasEditable()) node.setAttribute("contenteditable", "plaintext-only");
        return;
      }

      /* سِبت الصورة فوق صورة تانية = تبديل مش تحريك. بنرجّع الإزاحة
         لمكانها الأصلي عشان الاتنين يفضلوا في خاناتهم، والصور بس اللي
         بتتبدّل. */
      if (!cancel && swapWith) {
        applySlotOffset(node, d.dx0, d.dy0);
        layoutOf(d.block, d.slot).dx = d.dx0;
        layoutOf(d.block, d.slot).dy = d.dy0;
        snapshot();
        swapImages(node, swapWith);
        pruneLayout(d.block);
        markDirty();
        if (wasEditable()) node.setAttribute("contenteditable", "plaintext-only");
        if (typeof onDone === "function") onDone();
        requestPreview();
        if (state.selected === d.block.id) renderInspector();
        toast("اتبدّلت الصورتين — Ctrl+Z للتراجع", "ok");
        return;
      }

      if (cancel) {
        applySlotOffset(node, d.dx0, d.dy0);
        layoutOf(d.block, d.slot).dx = d.dx0;
        layoutOf(d.block, d.slot).dy = d.dy0;
      } else {
        var pos = layoutOf(d.block, d.slot);
        // القيمة اتغيّرت لحظياً أثناء السحب، فبنرجّعها ثانية واحدة عشان
        // snapshot يسجّل الحالة اللي قبل السحب — وإلا Ctrl+Z مايرجّعش حاجة.
        pos.dx = d.dx0; pos.dy = d.dy0;
        snapshot();
        pos.dx = d.dx != null ? d.dx : d.dx0;
        pos.dy = d.dy != null ? d.dy : d.dy0;
        markDirty();
      }
      pruneLayout(d.block);
      if (wasEditable()) node.setAttribute("contenteditable", "plaintext-only");
      if (typeof onDone === "function") onDone();
      if (state.selected === d.block.id) renderInspector();
    }

    node.addEventListener("pointerup", function () { finish(false); });
    node.addEventListener("pointercancel", function () { finish(true); });
    node.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drag) { e.preventDefault(); finish(true); }
    });
  }

  /* اختصارات العنصر المحدَّد جوّه قسم مستورد.

     بتتربط مرتين — مرة على مستند المحرر ومرة على مستند المعاينة —
     لأن الـiframe عالم لوحده وضغطة الكيبورد جوّاه مابتطلعش برّه. */
  function bindElementKeys(d) {
    if (d.__lbKeys) return;
    d.__lbKeys = true;

    d.addEventListener("keydown", function (e) {
      var t = e.target;
      var tag = ((t && t.tagName) || "").toLowerCase();
      var typing = tag === "input" || tag === "textarea" || tag === "select" ||
                   (t && t.isContentEditable);
      if (doc.querySelector(".ed-modal:not([hidden])")) return;

      // التراجع مالوش علاقة بالعنصر المحدَّد — بنتعامل معاه الأول
      if ((e.ctrlKey || e.metaKey) &&
          ("zZyY".indexOf(e.key) >= 0) && !typing) {
        e.preventDefault();
        if (e.key === "y" || e.key === "Y" || e.shiftKey) redo(); else undo();
        return;
      }

      var node = selectedElNode();
      var block = state.selected && findBlock(state.selected);
      if (!node || !block) return;

      // Escape بيلغي التحديد حتى وانت بتكتب (بيخرجك من الكتابة الأول)
      if (e.key === "Escape") {
        if (typing && t.blur) { t.blur(); return; }
        state.selEl = null; markSelectedEl(); renderInspector();
        return;
      }
      if (typing) return;               // بيكتب — سيبه

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); e.stopPropagation(); deleteElement(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
        e.preventDefault(); copyElement(); renderInspector(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
        e.preventDefault(); pasteElement(false); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault(); duplicateElement(); return;
      }

      // الأسهم: ربع خطوة، ومع Shift خطوة كاملة
      // (وللعناصر المستوردة: بكسل، ومع Shift أربع بكسل)
      var ARROWS = { ArrowRight: [-1, 0], ArrowLeft: [1, 0],
                     ArrowUp: [0, -1], ArrowDown: [0, 1] };
      var dir = ARROWS[e.key];
      if (dir) {
        e.preventDefault();
        var step = slotIsPx(state.selEl)
          ? (e.shiftKey ? 4 : 1)
          : (e.shiftKey ? 1 : 0.25);
        // مربع الكود رأسياً بالبكسل — ربع بكسل مش هيبان
        var stepY = slotUnitY(state.selEl) === "px"
          ? (e.shiftKey ? 4 : 1) : step;
        snapshot();
        var pos = layoutOf(block, state.selEl);
        pos.dx = Math.round(((pos.dx || 0) + dir[0] * step) * 100) / 100;
        pos.dy = Math.round(((pos.dy || 0) + dir[1] * stepY) * 100) / 100;
        applySlotOffset(node, pos.dx, pos.dy);
        markDirty();
        renderInspector();
        requestPreview();
      }
    });
  }

  function resetBlockLayout(blockId) {
    var block = findBlock(blockId);
    if (!block || !block.layout) return;
    snapshot();                          // قبل ما نمسح المواضع
    var fdoc = frameDoc();
    if (fdoc) {
      Object.keys(block.layout).forEach(function (slot) {
        var n = fdoc.querySelector('[data-block="' + blockId + '"] [data-slot="' + slot + '"]');
        if (n) applySlotOffset(n, 0, 0);
      });
    }
    delete block.layout;
    markDirty();
    renderInspector();
    toast("رجعت المواضع لأماكنها الأصلية");
  }

  function bindIntroDrag(fdoc) {
    var intro = fdoc.querySelector(".lb-intro[data-intro-editable]");
    if (!intro) return;

    var view = fdoc.defaultView || window;
    var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };
    var number = function (value) {
      var parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    };
    var positions = function () {
      var raw = (state.doc.settings || {}).intro_item_positions;
      if (!raw) return {};
      try {
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (e) { return {}; }
    };
    var savePositions = function (value) {
      state.doc.settings.intro_item_positions = JSON.stringify(value);
    };

    intro.querySelectorAll("[data-intro-item]").forEach(function (node) {
      if (node.dataset.lbIntroBound) return;
      node.dataset.lbIntroBound = "1";
      var key = node.getAttribute("data-intro-item");
      var drag = null;
      var suppressClick = false;

      node.addEventListener("pointerdown", function (e) {
        // ‎[contenteditable]‎: الكلام اللي اتفتح للكتابة جوّه كود المصمّم —
        // السحب هنا كان بيخطف الضغطة ويمنع تحريك المؤشر جوّه النص.
        if (e.button !== 0 || (e.target.closest &&
            e.target.closest("a, input, video, [contenteditable]"))) return;
        var settings = state.doc.settings || {};
        var saved = positions()[key] || {};
        drag = {
          x: e.clientX,
          y: e.clientY,
          startX: number(saved.x != null ? saved.x : settings.intro_text_x),
          startY: number(saved.y != null ? saved.y : settings.intro_text_y),
          moved: false,
          pointerId: e.pointerId
        };
        /* الـcapture بيتأخّر لحد ما السحب يبدأ فعلاً. لو اتاخد هنا،
           المتصفح بيعيد توجيه حدث ‎click‎ للعنصر الماسك بدل اللي
           اتضغط عليه — يعني زرار جوّه كود المصمّم مايشتغلش، ولا
           الضغطة تفتح الدعوة. (نفس اللي اتصلّح في ‎bindSlotDrag‎.) */
        e.stopPropagation();
      });

      node.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.x;
        var dy = e.clientY - drag.y;
        if (!drag.moved) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          drag.moved = true;
          try { node.setPointerCapture(e.pointerId); } catch (err) {}
          snapshot();
          node.classList.add("lb-intro-dragging");
        }
        e.preventDefault();
        e.stopPropagation();

        // كل عناصر الافتتاحية — بما فيها مربع الكود — إزاحتها نسبية
        // (vw/vh) عشان الموضع يفضل «موازي» على أي مقاس شاشة.
        var vw = Math.max(1, view.innerWidth || 1) / 100;
        var vh = Math.max(1, view.innerHeight || 1) / 100;
        var x = Math.round(clamp(drag.startX + dx / vw, -35, 35) * 100) / 100;
        var y = Math.round(clamp(drag.startY + dy / vh, -35, 35) * 100) / 100;
        var next = positions();
        next[key] = { x: x, y: y };
        savePositions(next);
        node.style.setProperty("--intro-item-x", x + "vw");
        node.style.setProperty("--intro-item-y", y + "vh");
      });

      var finish = function (e) {
        if (!drag) return;
        var didMove = drag.moved;
        try { node.releasePointerCapture(drag.pointerId); } catch (err) {}
        drag = null;
        node.classList.remove("lb-intro-dragging");
        if (!didMove) return;
        suppressClick = true;
        if (e) { e.preventDefault(); e.stopPropagation(); }
        markDirty();
      };
      node.addEventListener("pointerup", finish);
      node.addEventListener("pointercancel", finish);
      // زر الافتتاحية لديه مستمع click خاص به في invite.js. نستخدم
      // مرحلة الالتقاط حتى نمنع ذلك المستمع بعد السحب، قبل وصول الحدث للزر.
      node.addEventListener("click", function (e) {
        if (!suppressClick) return;
        suppressClick = false;
        e.preventDefault();
        e.stopPropagation();
      }, true);
    });
  }

  function bindSectionTextDrag(fdoc) {
    var view = fdoc.defaultView || window;
    var clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };
    var number = function (value) {
      var parsed = parseFloat(value);
      return isNaN(parsed) ? 0 : parsed;
    };

    fdoc.querySelectorAll("[data-section-text]").forEach(function (node) {
      if (node.dataset.lbSectionTextBound) return;
      var holder = node.closest(".lb-video-wrap") || node.closest("[data-block]");
      var blockHolder = node.closest("[data-block]");
      if (!holder || !blockHolder) return;
      var blockId = blockHolder.getAttribute("data-block");
      var block = findBlock(blockId);
      var index = parseInt(node.getAttribute("data-section-text-index"), 10);
      if (!block || !block.props || !Array.isArray(block.props.text_overlays) || isNaN(index)) return;

      node.dataset.lbSectionTextBound = "1";
      var drag = null;
      var suppressClick = false;

      function item() { return block.props.text_overlays[index]; }
      function paint(x, y) {
        node.style.setProperty("--video-text-x", x + "%");
        node.style.setProperty("--video-text-y", y + "%");
      }

      node.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        var current = item();
        if (!current) return;
        var rect = holder.getBoundingClientRect();
        drag = {
          startX: number(current.x),
          startY: number(current.y),
          pointerX: e.clientX,
          pointerY: e.clientY,
          width: Math.max(1, rect.width),
          height: Math.max(1, rect.height),
          pointerId: e.pointerId,
          moved: false
        };
        try { node.setPointerCapture(e.pointerId); } catch (err) {}
        e.stopPropagation();
      });

      node.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var dx = e.clientX - drag.pointerX;
        var dy = e.clientY - drag.pointerY;
        if (!drag.moved) {
          if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          drag.moved = true;
          snapshot();
          node.classList.add("is-dragging");
        }
        e.preventDefault();
        e.stopPropagation();
        // الإحداثيات نسبية لمركز الشاشة؛ النطاق الواسع يمنع توقف النص عند حافة مصطنعة.
        var x = Math.round(clamp(drag.startX + (dx / drag.width) * 100, -1000, 1000) * 100) / 100;
        var y = Math.round(clamp(drag.startY + (dy / drag.height) * 100, -1000, 1000) * 100) / 100;
        var current = item();
        if (!current) return;
        current.x = x;
        current.y = y;
        paint(x, y);
      });

      function finish(e) {
        if (!drag) return;
        var didMove = drag.moved;
        try { node.releasePointerCapture(drag.pointerId); } catch (err) {}
        drag = null;
        node.classList.remove("is-dragging");
        if (!didMove) return;
        suppressClick = true;
        if (e) { e.preventDefault(); e.stopPropagation(); }
        markDirty();
        /* خانات «الموضع» في اللوحة اتكتبت وقت البناء، فبعد السحب كانت
           بتفضل بالرقم القديم والمستخدم يشوف صفر وهو حرّك فعلاً.
           بنعيد بناء اللوحة للقسم المفتوح بس، ومرة واحدة عند نهاية
           السحب مش مع كل حركة. */
        if (state.selected === blockId) renderInspector();
      }
      node.addEventListener("pointerup", finish);
      node.addEventListener("pointercancel", finish);
      node.addEventListener("click", function (e) {
        /* زرار فوق القسم جوّاه ‎<a>‎ حقيقي عشان الضيف يقدر يدوس عليه.
           جوّه المحرر الضغطة معناها «اختار القسم ده»، فلو سبنا
           المتصفح يمشي على الرابط كان الإطار هيسيب المعاينة ويروح
           للصفحة اللي المستخدم لسه كاتبها. */
        var link = e.target.closest && e.target.closest("a[href]");
        if (link && node.contains(link)) e.preventDefault();
        if (suppressClick) {
          suppressClick = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        state.fromPreview = true;
        selectBlock(blockId);
        state.fromPreview = false;
      }, true);

      /* مقبضان على جنبي النص لتحديد عرضه — يعني فين السطر يقطع.
         الصندوق متمركز على نقطته بـ‎translate(-50%)‎، فسحب جنب واحد
         بيوسّع الجنبين، وعشان كده الفرق بيتضرب في ٢.
         الاتجاه بيتحسب من موضع المقبض الفعلي مش من اسمه، عشان يفضل
         مظبوط في RTL وLTR. */
      ["start", "end"].forEach(function (side) {
        var grip = fdoc.createElement("span");
        grip.className = "lb-section-text__grip lb-section-text__grip--" + side;
        grip.setAttribute("aria-hidden", "true");
        node.appendChild(grip);

        var resize = null;
        grip.addEventListener("pointerdown", function (e) {
          if (e.button !== 0) return;
          var current = item();
          if (!current) return;
          e.preventDefault();
          e.stopPropagation();
          var nodeRect = node.getBoundingClientRect();
          var gripRect = grip.getBoundingClientRect();
          resize = {
            pointerX: e.clientX,
            startWidth: nodeRect.width,
            holderWidth: Math.max(1, holder.getBoundingClientRect().width),
            dir: (gripRect.left + gripRect.width / 2) <
                 (nodeRect.left + nodeRect.width / 2) ? -1 : 1,
            pointerId: e.pointerId,
            moved: false
          };
          try { grip.setPointerCapture(e.pointerId); } catch (err) {}
        });

        grip.addEventListener("pointermove", function (e) {
          if (!resize) return;
          var dx = e.clientX - resize.pointerX;
          if (!resize.moved) {
            if (Math.abs(dx) < 3) return;
            resize.moved = true;
            snapshot();
          }
          e.preventDefault();
          e.stopPropagation();
          var current = item();
          if (!current) return;
          var next = resize.startWidth + 2 * dx * resize.dir;
          var percent = (next / resize.holderWidth) * 100;
          /* ١٠٠٪ هو نفس ‎max-width‎ في ‎invite.css‎ — لو عدّيناه القيمة
             المحفوظة هتقول رقم والشاشة تعرض رقم تاني. */
          percent = Math.round(clamp(percent, 8, 100) * 10) / 10;
          current.width = percent;
          node.style.setProperty("--section-text-w", percent + "%");
        });

        function endResize(e) {
          if (!resize) return;
          var didResize = resize.moved;
          try { grip.releasePointerCapture(resize.pointerId); } catch (err) {}
          resize = null;
          if (!didResize) return;
          if (e) { e.preventDefault(); e.stopPropagation(); }
          suppressClick = true;
          markDirty();
        }
        grip.addEventListener("pointerup", endResize);
        grip.addEventListener("pointercancel", endResize);
        grip.addEventListener("click", function (e) { e.stopPropagation(); });
      });
    });
  }

  function bindPreviewInteractions() {
    var fdoc = frameDoc();
    if (!fdoc) return;
    bindIntroDrag(fdoc);
    bindSectionTextDrag(fdoc);
    syncSectionHeights(fdoc);
    applySectionBounds();

    // اختيار القسم بالضغط عليه
    fdoc.querySelectorAll("[data-block]").forEach(function (node) {
            node.addEventListener("click", function (e) {
        var slot = e.target.closest("[data-slot]");
        if (slot && slot.isContentEditable) return;
        /* مربع «كود متقدّم»: المستمع ده في مرحلة **الالتقاط**، يعني
           ‎stopPropagation‎ هنا بيوقف الضغطة قبل ما تنزل لجوّه الكود
           أصلاً — فأي زرار أو نص جوّه كود المصمّم كان ميت في المحرر.
           بنسيب الضغطة تكمّل، والعنصر نفسه بيحدّد نفسه (‎bindCustomHtml‎
           بيربط ‎click‎ على كل عنصر مرقّم جوّه المربع). */
        var codeBox = e.target.closest && e.target.closest(".lb-extra-html");
        if (codeBox) {
          if (!e.target.closest("[data-move]")) {
            var codeBlockId = node.getAttribute("data-block");
            if (state.selected !== codeBlockId) {
              state.fromPreview = true;
              selectBlock(codeBlockId);
              state.fromPreview = false;
            }
          }
          return;
        }
                var movable = e.target.closest && e.target.closest(".lb-custom [data-move]");
        if (movable) state.selEl = movable.getAttribute("data-move");
        if (movable && (e.ctrlKey || e.metaKey)) {

          e.preventDefault();
          e.stopPropagation();
          state.selEl = movable.getAttribute("data-move");
          state.fromPreview = true;
          selectBlock(node.getAttribute("data-block"));
          state.fromPreview = false;
          if (refs.inspector) refs.inspector.scrollTop = 0;
          toast("تم تحديد العنصر — عدّل خصائصه من اللوحة.", "ok");
          return;
        }
        /* المستمع ده في مرحلة الالتقاط، يعني بيتنفّذ **قبل** عناصر
           القسم. من غير السطر ده كان بيوقف الضغطة قبل ما توصل لعنصر
           القالب المستورد، فاختيار العنصر كان مستحيل. */
        if (movable || (e.target.closest && e.target.closest("[data-section-text]"))) return;

        e.preventDefault();
        e.stopPropagation();
        state.fromPreview = true;
        selectBlock(node.getAttribute("data-block"));
        state.fromPreview = false;
      }, true);
    });

    // التحرير المباشر للنصوص — data-slot يساوي اسم الحقل في المستند
    fdoc.querySelectorAll("[data-slot]").forEach(function (node) {
      var holder = node.closest("[data-block]");
      if (!holder) return;
      var blockId = holder.getAttribute("data-block");
      var key = node.getAttribute("data-slot");
      var block = findBlock(blockId);
      if (!block || !(key in block.props)) return;

      node.setAttribute("contenteditable", "plaintext-only");
      node.setAttribute("data-lb-text", "1");
      node.style.outline = "none";
      node.addEventListener("focus", function () {
        node.style.boxShadow = "0 0 0 2px var(--accent)";
        if (state.selected !== blockId) selectBlock(blockId);
      });
      node.addEventListener("blur", function () {
        node.style.boxShadow = "";
      });
      node.addEventListener("input", function () {
        block.props[key] = node.textContent;
        markDirty();
        syncInspectorField(blockId, key, node.textContent);
      });
      node.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); node.blur(); }
      });

      bindSlotDrag(node, blockId, key);
    });

        bindElementKeys(fdoc);
    bindCustomHtml(fdoc);
    bindDelegatedCustomTextEditing(fdoc);

    // السحب مش للنصوص بس — أي جزء متعلّم بـdata-move يتحرك (الأزرار،

    // الصور، الخريطة، العدّاد، الفورم…). النصوص متعلّمة تلقائياً في القوالب.
    fdoc.querySelectorAll("[data-move]").forEach(function (node) {
      if (node.hasAttribute("data-slot")) return;      // اتربط فوق
      /* حاوية «كود متقدّم»: اللي بيتسحب هو الشكل اللي جوّاها (‎ce-1‎)
         مش هي. الاتنين كانوا بيتسحبوا، فلو مسكت من حرف المربع بتحرّك
         الحاوية ولو مسكت من نص الشكل بتحرّك الشكل — حركتين مختلفتين
         لنفس الحاجة. لو الكود مافيهوش عنصر مرقّم أصلاً، الحاوية
         بتفضل هي المقبض. */
      if (node.classList.contains("lb-extra-html") &&
          node.querySelector("[data-move]")) return;
      var holder = node.closest("[data-block]");
      if (!holder) return;
      bindSlotDrag(node, holder.getAttribute("data-block"),
                   node.getAttribute("data-move"));
    });
  }

  // ==========================================================
  // الأقسام المستوردة — تحرير بصري بدل الكود
  // ==========================================================
  /* القالب المستورد بيتخزن كـHTML خام، فمفيش حقول جاهزة زي "الاسم
     الأول". من غير الطبقة دي المستخدم مالوش وسيلة غير إنه يعدّل الكود
     بإيده — وده مش المفروض يكون شغله.

     الفكرة: نمشي على العناصر جوّه القسم، اللي فيه نص بس (مفيش عناصر
     جوّاه) نخلّيه قابل للكتابة، وأي عنصر نديله رقم ونخلّيه يتسحب.
     بعد أي تعديل بنعيد بناء props.html من الـDOM نفسه. */

  var TEXTY = { H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, P:1, SPAN:1, A:1, LI:1,
                TD:1, TH:1, STRONG:1, EM:1, B:1, I:1, SMALL:1, FIGCAPTION:1,
                BLOCKQUOTE:1, TIME:1, MARK:1 };

  // أبناء سطريين مابيمنعوش العنصر إنه يبقى «نص واحد». ده مهم جداً لأن
  // <h1>ليلى<span>&</span>كريم</h1> شكل شائع جداً في قوالب الدعوات —
  // ولو اعتبرناه مش نص، المستخدم بيقدر يكتب في الـspan لوحدها بس.
  var INLINE = { SPAN:1, EM:1, I:1, B:1, STRONG:1, SMALL:1, U:1, S:1,
                 MARK:1, SUP:1, SUB:1, BR:1, TIME:1, ABBR:1 };

    function isTildaTextUnit(n) {
    if (!n || !n.classList || !n.classList.contains("tn-atom")) return false;
    if (!(n.textContent || "").trim()) return false;
    if (n.querySelector("img, video, iframe, input, textarea, select")) return false;
    for (var i = 0; i < n.children.length; i++) {
      if (!INLINE[n.children[i].tagName]) return false;
    }
    return true;
  }

    function isImportedCountdownPart(n) {
    var root = n && n.closest ? n.closest(".lb-custom") : null;
    if (!root) return false;
    var current = n;
    while (current && current !== root) {
      var marker = ((current.id || "") + " " + (current.className || ""));
      if (/(countdown|time-block|number-wrap|section-countdown|\bcd-(?:num|days?|hours?|mins?|minutes?|secs?|seconds?)\b)/i.test(marker)) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

    function isTextUnit(n) {

    if (isImportedCountdownPart(n)) return false;
    if (!TEXTY[n.tagName]) return false;

    if (!(n.textContent || "").trim()) return false;
    for (var i = 0; i < n.children.length; i++) {
      if (!INLINE[n.children[i].tagName]) return false;
      // ابن سطري جوّاه عناصر تانية = تركيب مش نص بسيط
      if (n.children[i].children.length) return false;
    }
    return true;
  }

    function isCountdownLabel(n) {
    if (!n || !n.classList || !n.classList.contains("label")) return false;
    return isImportedCountdownPart(n) &&
      (!(n.textContent || "").trim() || !n.querySelector("img,video,iframe,input,textarea,select"));
  }

  /* عناصر مربع «كود متقدّم» — **مش** كل حاوية زي القالب المستورد.

     كود التصميم بيلف الشكل في تلات أو أربع حاويات (‎section > inner >
     arch > names‎)، وكل واحدة مرقّمة كانت بترسم إطار تحديد لوحدها —
     فالمصمّم بيشوف ٣ إطارات على كارت واحد، وأول ما يمسك يسحب بيمسك
     حاوية جوّانية فيتحرك جزء من الشكل بدل الشكل كله.

     اللي بيتّرقّم: الطبقة الخارجية (الشكل كله — سحبها بيحرّك كل اللي
     جوّاها)، والكلام، والصور. الحاويات اللي في النص بتتشال. */
  var CODE_MEDIA_RE = /^(?:IMG|VIDEO|IFRAME|SVG|CANVAS|PICTURE)$/;

  function codeMovables(root) {
    var out = [];
    var big = function (n) {
      var r = n.getBoundingClientRect();
      return r.width > 6 && r.height > 6;
    };
    Array.prototype.forEach.call(root.children, function (n) {
      if (big(n)) out.push(n);
    });
    root.querySelectorAll("*").forEach(function (n) {
      if (out.indexOf(n) > -1 || !big(n)) return;
      if (CODE_MEDIA_RE.test(n.tagName) || isCodeTextUnit(n, root)) out.push(n);
    });
    return out;
  }

  /** العناصر اللي نسمح بسحبها — أي حاجة ليها حجم حقيقي. */
  function movableIn(root) {

    return Array.prototype.filter.call(root.querySelectorAll("*"), function (n) {
      if (n.tagName === "BR" || n.tagName === "HR") return false;
      var r = n.getBoundingClientRect();
      return r.width > 6 && r.height > 6;
    });
  }

  /** يرجّع props.html من الـDOM بعد ما نشيل علاماتنا الوقتية. */
  function serializeCustom(root) {
    var clone = root.cloneNode(true);
    clone.querySelectorAll("[contenteditable]").forEach(function (n) {
      n.removeAttribute("contenteditable");
    });
    clone.querySelectorAll("[data-lb-edit]").forEach(function (n) {
      n.removeAttribute("data-lb-edit");
    });
    clone.querySelectorAll("[data-lb-text]").forEach(function (n) {
      n.removeAttribute("data-lb-text");
    });
    clone.querySelectorAll(".lb-el-picked, .lb-el-typing").forEach(function (n) {
      n.classList.remove("lb-el-picked");
      n.classList.remove("lb-el-typing");
      if (!n.getAttribute("class")) n.removeAttribute("class");
    });
    // الإزاحات محفوظة في block.layout مش في الستايل المضمّن
    clone.querySelectorAll("[style]").forEach(function (n) {
      n.style.removeProperty("--dx");
      n.style.removeProperty("--dy");
      n.style.removeProperty("box-shadow");
      n.style.removeProperty("outline");
      if (!n.getAttribute("style")) n.removeAttribute("style");
    });
    return clone.innerHTML;
  }

    function beginCustomTextEdit(node) {
    if (!node) return;
    node.setAttribute("contenteditable", "plaintext-only");
    node.classList.add("lb-el-typing");
    node.focus();
    var sel = node.ownerDocument.getSelection();
    if (sel && sel.rangeCount === 0) {
      var range = node.ownerDocument.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      sel.addRange(range);
    }
  }

  function openImportedCountdownSettings(blockId) {
    state.selEl = null;
    state.fromPreview = true;
    if (state.selected !== blockId) selectBlock(blockId);
    else renderInspector();
    state.fromPreview = false;
    var box = refs.inspector;
    if (!box) return;
    var group = Array.prototype.find.call(box.querySelectorAll("details.ed-group"), function (item) {
      var summary = item.querySelector("summary");
      return /إعدادات العداد|countdown/i.test(summary ? summary.textContent : "");
    });
    if (group) {
      group.open = true;
      var input = group.querySelector('[data-field-key="countdown_date"]');
      if (input) {
        input.focus();
        input.scrollIntoView({ block: "nearest" });
      }
    }
    toast("من «إعدادات العداد»: اختَر تاريخ ووقت العدّاد، أو اقلب اتجاه الخانات.", "ok");
  }

  function delegatedCustomTextWriteBack(node) {
    var section = node && node.closest('[data-block-type="custom_html"]');
    if (!section) return;
    var block = findBlock(section.getAttribute("data-block"));
    var root = section.querySelector(".lb-custom");
    if (!block || !root || !("html" in block.props)) return;
    block.props.html = serializeCustom(root);
    markDirty();
  }

  // ==========================================================
  // «كود متقدّم» — تعديل الكلام اللي جوّه من على المعاينة
  // ==========================================================
  /* الكود بيتحفظ كنص واحد فيه ‎<style>‎ وHTML و‎<script>‎. عشان يغيّر
     اسم العروسين جوّاه كان لازم يفتح الخانة ويدوّر على السطر بإيده.
     دلوقتي: ضغطتين على الكلام في المعاينة → يكتب → النص بيترجع مكانه
     في الخانة. الستايل والسكربت الأصليين بيتحفظوا زي ما هُمّ بالنص،
     واللي بيتبدّل هو جزء الـHTML بس. */
  var CODE_STYLE_RE = /<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi;
  var CODE_SCRIPT_RE = /<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi;

  function rebuildCode(original, html) {
    var raw = String(original || "");
    var parts = (raw.match(CODE_STYLE_RE) || [])
      .concat(String(html || "").trim())
      .concat(raw.match(CODE_SCRIPT_RE) || []);
    return parts.filter(function (part) {
      return String(part).trim();
    }).join("\n");
  }

  function codeBoxOf(target) {
    return target && target.closest
      ? target.closest(".lb-extra-html, .lb-intro-extra") : null;
  }

  /* أوسع من ‎isTextUnit‎ في حتة وأضيق في حتة، والاتنين مقصودين:
       • أوسع: كود المصمّم بيكتب الأسامي في ‎<div>‎ زي ما بيكتبها في
         ‎<h1>‎ — مافيش قايمة وسوم هنا، الشرط إن العنصر كله كلام.
       • أضيق: ‎<div class="names"><span>ليلى</span><span>كريم</span></div>‎
         شكل شائع جداً في كود التصميم، والمصمّم كاتب كل اسم في ‎span‎
         لوحده عشان يتحكّم فيه لوحده. فالأب اللي كل كلامه في أبنائه
         بيبقى **حاوية**، وكل ابن فيهم وحدة نص بنفسه. لو الأب نفسه فيه
         كلام مباشر (‎<h1>ليلى<span>&</span>كريم</h1>‎) يبقى هو الوحدة. */
  function hasOwnText(node) {
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 3 && (child.nodeValue || "").trim()) return true;
    }
    return false;
  }

  function isCodeTextUnit(node, box) {
    if (!node || node.nodeType !== 1 || node === box) return false;
    if (!(node.textContent || "").trim()) return false;
    if (node.querySelector(
      "img,video,iframe,input,textarea,select,button,svg,canvas")) return false;
    for (var i = 0; i < node.children.length; i++) {
      if (!INLINE[node.children[i].tagName]) return false;
      // ابن سطري فيه كلام والأب مالوش كلام خاص = الأب حاوية
      if (!hasOwnText(node) && (node.children[i].textContent || "").trim()) {
        return false;
      }
    }
    return true;
  }

  function codeTextUnitFrom(target) {
    var box = codeBoxOf(target);
    if (!box) return null;
    var node = target;
    while (node && node !== box) {
      if (isCodeTextUnit(node, box)) return node;
      node = node.parentElement;
    }
    return null;
  }

  /* مسار العنصر جوّه المربع بأرقام الأبناء — عشان نلاقيه في **النص
     الأصلي** بدل ما نكتب الـDOM كله فوق الكود.

     ليه: سكربت المصمّم بيغيّر الـDOM وهو شغال (عدّاد بيكتب أرقام،
     صندوق بيفتح فيتحط عليه ‎class‎…). لو حفظنا المربع كله بعد تعديل
     كلمة، حالة اللحظة دي كانت هتتخبّط في الكود المحفوظ للأبد. */
  function codeNodePath(node, box) {
    var path = [];
    var current = node;
    while (current && current !== box) {
      var parent = current.parentElement;
      if (!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.children, current));
      current = parent;
    }
    return current === box ? path : null;
  }

  /** نسخة نضيفة من العنصر — من غير علاماتنا الوقتية. */
  function cleanEditedNode(node) {
    var clone = node.cloneNode(true);
    var strip = function (n) {
      n.removeAttribute("contenteditable");
      n.removeAttribute("spellcheck");
      n.removeAttribute("data-lb-edit");
      n.removeAttribute("data-lb-text");
      n.classList.remove("lb-el-typing");
      n.classList.remove("lb-el-picked");
      n.classList.remove("lb-dragging");
      if (!n.getAttribute("class")) n.removeAttribute("class");
      if (n.style) {
        n.style.removeProperty("--dx");     // الإزاحة في ‎block.layout‎
        n.style.removeProperty("--dy");
        // ستايل بتاع المحرر نفسه — نفس اللي ‎serializeCustom‎ بتشيله
        n.style.removeProperty("outline");
        n.style.removeProperty("box-shadow");
        if (!n.getAttribute("style")) n.removeAttribute("style");
      }
    };
    strip(clone);
    clone.querySelectorAll("*").forEach(strip);
    return clone;
  }

  /** يمشي بالمسار جوّه شجرة مبنية من النص الأصلي. */
  function walkCodePath(holder, path, node) {
    var target = holder;
    for (var i = 0; i < path.length; i++) {
      target = target.children[path[i]];
      if (!target) return null;
    }
    if (target === holder || (node && target.tagName !== node.tagName)) return null;
    return target;
  }

  /* يزامن عنصر (أو أكتر) من المعاينة على النص الأصلي **بالمسار**.
     ‎items‎: [{path, node, html}] — ‎html:true‎ يعني ننقل محتواه كمان.
     بيرجّع ‎null‎ لو أي مسار ضاع، فالنداهة تقع على آخر حل بدل ما تكتب
     في المكان الغلط. */
  function syncCodeNodes(original, items) {
    var region = String(original || "")
      .replace(CODE_STYLE_RE, "").replace(CODE_SCRIPT_RE, "");
    var holder = document.createElement("div");
    holder.innerHTML = region;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var target = walkCodePath(holder, item.path, item.node);
      if (!target) return null;
      var clean = cleanEditedNode(item.node);
      // الخصائص: بنحط اللي في المعاينة ونشيل اللي اتشال
      Array.prototype.slice.call(target.attributes).forEach(function (attr) {
        if (!clean.hasAttribute(attr.name)) target.removeAttribute(attr.name);
      });
      Array.prototype.slice.call(clean.attributes).forEach(function (attr) {
        target.setAttribute(attr.name, attr.value);
      });
      if (item.html) target.innerHTML = clean.innerHTML;
    }
    return holder.innerHTML;
  }

  /** يرجّع {get,set} لخانة الكود اللي المربع ده متولّد منها. */
  function codeOwnerOf(box) {
    if (box.classList.contains("lb-intro-extra")) {
      var settings = state.doc && state.doc.settings;
      if (!settings) return null;
      return {
        get: function () { return settings.intro_code; },
        set: function (value) {
          settings.intro_code = value;
          syncFieldByKey("intro_code", value);
        }
      };
    }
    var section = box.closest("[data-block]");
    var block = section && findBlock(section.getAttribute("data-block"));
    if (!block || !block.props || typeof block.props.code !== "string") return null;
    return {
      get: function () { return block.props.code; },
      set: function (value) {
        block.props.code = value;
        syncInspectorField(block.id, "code", value);
      }
    };
  }

  function codeWriteBack(box, node) {
    if (!box) return;
    var owner = codeOwnerOf(box);
    if (!owner) return;
    var source = owner.get();
    var path = node && node !== box ? codeNodePath(node, box) : null;
    var html = path
      ? syncCodeNodes(source, [{ path: path, node: node, html: true }])
      : null;
    // آخر حل: نحفظ المربع كله (لو تركيب الـDOM اختلف عن النص الأصلي)
    if (html === null) html = serializeCustom(box);
    owner.set(rebuildCode(source, html));
    markDirty();
  }

  /* ترقيم العناصر (‎data-move="el-N"‎) لازم يترسّب في النص المحفوظ،
     وإلا الموضع بيضيع مع أول حفظ. بنكتبه **بالمسار على النص الأصلي**
     مش بحفظ المربع كله: سكربت المصمّم بيغيّر الـDOM وهو شغال، ولو
     حفظنا اللقطة دي كنّا هنخبّط حالة اللحظة في كوده للأبد. */
  function codeWriteMoveAttrs(box, nodes) {
    var owner = codeOwnerOf(box);
    if (!owner) return;
    var source = owner.get();
    var items = [];
    for (var i = 0; i < nodes.length; i++) {
      var path = codeNodePath(nodes[i], box);
      if (!path) return;                       // مسار ضايع — مانكتبش
      items.push({ path: path, node: nodes[i], html: false });
    }
    if (!items.length) return;
    var html = syncCodeNodes(source, items);
    if (html === null) return;
    var next = rebuildCode(source, html);
    if (next === source) return;
    owner.set(next);
    markDirty();
  }

  /** زي ‎syncInspectorField‎ لكن للحقول اللي مش تبع بلوك (إعدادات الدعوة). */
  function syncFieldByKey(key, value) {
    var pane = refs.inspector;
    if (!pane) return;
    var inputs = $$("input, textarea", pane);
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].dataset.fieldKey === key) { inputs[i].value = value; return; }
    }
  }

  function openCodeTextEdit(node) {
    beginCustomTextEdit(node);
    if (node.dataset.lbCodeEdit === "1") return;
    node.dataset.lbCodeEdit = "1";
    var box = codeBoxOf(node);
    node.addEventListener("input", function () { codeWriteBack(box, node); });
    node.addEventListener("blur", function () {
      node.removeAttribute("contenteditable");
      node.classList.remove("lb-el-typing");
      codeWriteBack(box, node);
    });
    node.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        node.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        node.blur();
      }
    });
  }

  function bindDelegatedCustomTextEditing(fdoc) {
    if (!fdoc || fdoc.__lbDelegatedTextEditing) return;
    fdoc.__lbDelegatedTextEditing = true;
    fdoc.addEventListener("dblclick", function (e) {
      /* مربع الكود في قسم: ‎bindCustomHtml‎ بيربطه بنفسه زي أي عنصر
         مرقّم. اللي فاضل هنا هو مربع كود **الافتتاحية** — مش جوّه
         ‎[data-block]‎ فمالوش ترقيم، والكتابة فيه بتتظبط من هنا. */
      var codeBox = codeBoxOf(e.target);
      if (codeBox && !codeBox.classList.contains("lb-intro-extra")) return;
      var codeText = codeBox ? codeTextUnitFrom(e.target) : null;
      if (codeText) {
        e.preventDefault();
        e.stopPropagation();
        openCodeTextEdit(codeText);
        return;
      }
      var countdownPart = e.target && e.target.closest && e.target.closest(".lb-custom [data-move]");
      if (countdownPart && isImportedCountdownPart(countdownPart)) {
        var countdownSection = countdownPart.closest('[data-block-type="custom_html"]');
        if (countdownSection) {
          openImportedCountdownSettings(countdownSection.getAttribute("data-block"));
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
            var node = e.target && e.target.closest && e.target.closest("[data-lb-text]");
      if (!node) {
        var atom = e.target && e.target.closest && e.target.closest(".lb-custom .tn-atom");
        if (atom && (isTextUnit(atom) || isTildaTextUnit(atom))) node = atom;
      }
      if (!node) return;
      var section = node.closest('[data-block-type="custom_html"]');
      if (!section) return;
      var blockId = section.getAttribute("data-block");
      var block = findBlock(blockId);
      if (!block || !("html" in block.props)) return;
      state.selEl = node.getAttribute("data-move") || state.selEl;
      state.fromPreview = true;
      if (state.selected !== blockId) selectBlock(blockId);
      state.fromPreview = false;
      e.preventDefault();

      e.stopPropagation();
      beginCustomTextEdit(node);
      if (node.dataset.lbDelegatedEdit !== "1") {
        node.dataset.lbDelegatedEdit = "1";
        node.addEventListener("input", function () { delegatedCustomTextWriteBack(node); });
        node.addEventListener("blur", function () {
          node.removeAttribute("contenteditable");
          node.classList.remove("lb-el-typing");
          delegatedCustomTextWriteBack(node);
        });
        node.addEventListener("keydown", function (event) {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            node.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            node.blur();
          }
        });
      }
    }, true);
  }

  function bindCustomHtml(fdoc) {
    var roots = [];
    fdoc.querySelectorAll('[data-block-type="custom_html"]').forEach(function (sec) {
      var root = sec.querySelector(".lb-custom");
      if (root) roots.push(root);
    });
    /* مربع «كود متقدّم» بياخد نفس المعاملة: العناصر جوّه كود المصمّم
       بتتحدّد وتتنسّق من «العنصر المحدَّد» زيها زي عناصر القالب
       المستورد — من غير ما المصمّم يفتح الكود ويدوّر على السطر. */
    fdoc.querySelectorAll(".lb-extra-html").forEach(function (root) {
      roots.push(root);
    });

    roots.forEach(function (root) {
      var sec = root.closest("[data-block]");
      if (!sec) return;
      var blockId = sec.getAttribute("data-block");
      var block = findBlock(blockId);
      if (!block || !block.props) return;
      var codeRoot = isCodeRoot(root);
      if (codeRoot ? typeof block.props.code !== "string"
                   : !("html" in block.props)) return;

      var writeBack = function (node) {
        if (codeRoot) {
          codeWriteBack(root, node && node.nodeType === 1 ? node : null);
          return;
        }
        block.props.html = serializeCustom(root);
        markDirty();
      };

      /* الترتيب مهم:
         ١) نعلّم وحدات النص الأول.
         ٢) اللي جوّه وحدة نص بيتشال من اللعبة خالص — لا اختيار ولا سحب.
            من غير الخطوة دي، <span> جوّه <h1> بتخطف الاختيار من العنوان
            وتخلّيك تحرّك علامة & لوحدها بدل الاسم.
         ٣) ترقيم وربط. */
      var all = codeRoot ? codeMovables(root) : movableIn(root);
      all.forEach(function (n) {
        /* في المربع بنستعمل شرط أوسع: كود المصمّم بيكتب الأسامي في
           ‎<div>‎ زي ما بيكتبها في ‎<h1>‎، والاتنين المفروض يتعدّلوا. */
        var texty = codeRoot
          ? isCodeTextUnit(n, root)
          : (isTextUnit(n) || isTildaTextUnit(n) || isCountdownLabel(n));
        if (texty && !(n.parentElement &&
            n.parentElement.closest("[data-lb-text]"))) {

          n.setAttribute("data-lb-text", "1");
        }
      });

      var nodes = all.filter(function (n) {
        return !(n.parentElement && n.parentElement.closest("[data-lb-text]"));
      });

      /* بادئة مختلفة لعناصر المربع (‎ce-N‎) — القسم المستورد ممكن يكون
         فيه الاتنين، و‎layout_css‎ بيكتب ‎#block [data-move="el-1"]‎،
         فترقيم واحد كان هيخلي عنصرين في مكانين مختلفين ياخدوا نفس
         الإزاحة. */
      var prefix = codeRoot ? "ce-" : "el-";
      /* ترقيم قديم لحاويات مابقتش تتحدّد (من نسخة أقدم من المحرر)
         بيفضل في النص المحفوظ ويكمّل يرسم إطارات — بنشيله وبنشيل
         موضعه المحفوظ معاه. */
      var dropped = [];
      if (codeRoot) {
        root.querySelectorAll("[data-move]").forEach(function (n) {
          if (nodes.indexOf(n) > -1) return;
          var slot = n.getAttribute("data-move");
          n.removeAttribute("data-move");
          n.removeAttribute("data-lb-text");
          if (block.layout && slot) delete block.layout[slot];
          dropped.push(n);
        });
      }
      var next = 1;
      nodes.forEach(function (n) {
        if (!n.getAttribute("data-move")) {
          while (root.querySelector('[data-move="' + prefix + next + '"]')) next++;
          n.setAttribute("data-move", prefix + next);
          next++;
        }
      });

      nodes.forEach(function (n) {
        if (n.dataset.lbEdit) return;
        n.dataset.lbEdit = "1";

        if (n.getAttribute("data-lb-text") === "1") {
          /* ضغطة واحدة = **اختيار**، ضغطتين = **كتابة**.

             قبل كده الضغطة الواحدة كانت بتفتح الكتابة على طول، وده كان
             بيبلع كل اختصارات العنصر: Delete بيمسح حرف مش العنصر،
             والأسهم بتحرّك المؤشّر مش العنصر، وCtrl+C بينسخ نص مش
             العنصر. ده نفس سلوك أدوات التصميم المحترفة. */
          n.style.outline = "none";
                    n.addEventListener("dblclick", function (e) {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            beginCustomTextEdit(n);

            var sel = n.ownerDocument.getSelection();
            if (sel && sel.rangeCount === 0) {
              var range = n.ownerDocument.createRange();
              range.selectNodeContents(n);
              range.collapse(false);
              sel.addRange(range);
            }
          });
          n.addEventListener("blur", function () {
            n.removeAttribute("contenteditable");
            n.classList.remove("lb-el-typing");
            writeBack(n);
          });
          n.addEventListener("input", function () { writeBack(n); });
          n.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); n.blur(); }
            // Esc بيخرج من الكتابة بس — العنصر يفضل محدَّد عشان تكمّل
            // شغل عليه (تحركه، تنسخه، تغيّر خطه). من غير stopPropagation
            // المستمع العام كان بيلغي التحديد كمان في نفس الضغطة.
            if (e.key === "Escape") {
              e.preventDefault(); e.stopPropagation(); n.blur();
            }
          });
        }

        var pick = function (e) {
          if (e) e.stopPropagation();
          state.selEl = n.getAttribute("data-move");
          if (isImportedCountdownPart(n)) {
            openImportedCountdownSettings(blockId);
            return;
          }
          state.fromPreview = true;
          if (state.selected !== blockId) selectBlock(blockId);
          else renderInspector();
          state.fromPreview = false;
          markSelectedEl();
        };
                n.addEventListener("pointerdown", function (e) {
          // لا تسمح لحاويات Tilda الأب أن تستبدل العنصر الأقرب تحت الماوس.
          if (e.target !== n) return;
          state.selEl = n.getAttribute("data-move");
          e.stopPropagation();
        });

        n.addEventListener("click", pick);

        bindSlotDrag(n, blockId, n.getAttribute("data-move"), function () {
          writeBack(n);
        });
      });

      // أول ما نضيف data-move لازم نحفظها، وإلا هتضيع مع أول حفظ
      if (!nodes.length && !dropped.length) return;
      if (codeRoot) codeWriteMoveAttrs(root, nodes.concat(dropped));
      else writeBack();
    });
    markSelectedEl();
  }

  /** العنصر المختار جوّه القسم — يرجّع العقدة الحيّة في المعاينة. */
  function selectedElNode() {
    var fdoc = frameDoc();
    if (!fdoc || !state.selected || !state.selEl) return null;
    return fdoc.querySelector('[data-block="' + state.selected + '"] ' +
                              '[data-move="' + state.selEl + '"]');
  }

  function markSelectedEl() {
    var fdoc = frameDoc();
    if (!fdoc) return;
    fdoc.querySelectorAll(".lb-el-picked").forEach(function (n) {
      n.classList.remove("lb-el-picked");
    });
    var n = selectedElNode();
    if (n) n.classList.add("lb-el-picked");
  }

  function syncInspectorField(blockId, key, value) {
    if (state.selected !== blockId) return;
    // نحدّث الحقل المقابل في اللوحة بدون إعادة بناء كاملة (كي لا يفقد التركيز)
    var pane = refs.inspector;
    if (!pane) return;
    var inputs = $$("input, textarea", pane);
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].dataset.fieldKey === key) { inputs[i].value = value; return; }
    }
  }

  function highlightInPreview(id) {
    var fdoc = frameDoc();
    if (!fdoc) return;
    fdoc.querySelectorAll("[data-block]").forEach(function (n) {
      n.classList.toggle("is-selected", n.getAttribute("data-block") === id);
    });
    var target = fdoc.querySelector('[data-block="' + id + '"]');
    if (!target || !target.scrollIntoView) return;

    /* ما نحرّكش التمرير لو المستخدم هو اللي ضغط جوّه المعاينة — كان
       بيدوس على نص فوق الكارت والصفحة تنطّ لتحت تحت رجليه.
       التمرير للقسم منطقي بس لما الاختيار ييجي من قايمة الأقسام. */
    if (state.fromPreview) return;

    // ولو القسم باين خلاص، مفيش داعي نحرّك حاجة أصلاً
    var r = target.getBoundingClientRect();
    var h = (fdoc.defaultView || {}).innerHeight || 0;
    if (r.top >= 0 && r.bottom <= h) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ==========================================================
  // إضافة قسم
  // ==========================================================
  function openBlockPicker() {
    var body = refs.pickerBody;
    body.replaceChildren();

    var cats = {};
    var order = [];
    Object.keys(SCHEMA.blocks).forEach(function (type) {
      var spec = SCHEMA.blocks[type];
      var c = spec.category || "عام";
      if (!cats[c]) { cats[c] = []; order.push(c); }
      cats[c].push(spec);
    });

    order.forEach(function (cat) {
      body.appendChild(el("p", "ed-kicker", cat));
      var grid = el("div", "ed-picker");
      cats[cat].forEach(function (spec) {
        var exists = spec.singleton && state.doc.blocks.some(function (b) {
          return b.type === spec.type;
        });
        var btn = el("button", "ed-pick");
        btn.type = "button";
        if (exists) btn.disabled = true;
        btn.appendChild(el("i", null, spec.icon));
        var txt = el("div");
        txt.appendChild(el("strong", null, spec.label));
        txt.appendChild(el("small", null,
          exists ? "مضاف بالفعل" :
            (!hasFeature(spec.feature) ? "تحذير: خارج الباقة — سيُضاف" : (spec.description || ""))));
        btn.appendChild(txt);
        btn.addEventListener("click", function () {
          addBlock(spec.type);
          closeModal(refs.pickerModal);
        });
        grid.appendChild(btn);
      });
      body.appendChild(grid);
    });
    openModal(refs.pickerModal);
  }

  function defaultsFor(specs) {
    var out = {};
    (specs || []).forEach(function (s) { out[s.key] = clone(s.default); });
    return out;
  }

  function addBlock(type) {
    var spec = blockSpec(type);
    if (!spec) return;
    snapshot();
    var block = {
      id: uid(type),
      type: type,
      visible: true,
      locked: false,
      props: defaultsFor(spec.props),
      style: defaultsFor(spec.style)
    };
    var at = state.selected ? blockIndex(state.selected) + 1 : state.doc.blocks.length;
    state.doc.blocks.splice(at, 0, block);
    state.selected = block.id;
    renderBlockList();
    renderInspector();
    switchTab("inspector");
    markDirty();
    requestPreview();
    toast("تمت إضافة قسم «" + spec.label + "».", "ok");
  }

  // ==========================================================
  // الملفات
  // ==========================================================
  var pickCallback = null;

  var pickKind = "image";
  var imageUsageFilter = "all";
  var selectedAssetIds = new Set();


  // ==========================================================
  // قص الصور
  // ==========================================================
  // القص بيتم على السيرفر من النسخة الأصلية، فمفيش فقد جودة متراكم،
  // والأصل بيفضل محفوظ فتقدر ترجع تقص من جديد أي وقت.
  var cropState = null;

  function openCropper(asset, onDone) {
    var url = asset.source || asset.url;
    var modal = $("[data-crop-modal]");
    if (!modal) return;

    var stage = $("[data-crop-stage]", modal);
    var img = $("[data-crop-img]", modal);
    var box = $("[data-crop-box]", modal);
    img.src = url;

    cropState = { asset: asset, onDone: onDone, ratio: 0 };

    img.onload = function () {
      // نبدأ بمربع في النص بـ80% من أصغر ضلع
      var r = img.getBoundingClientRect(), s = stage.getBoundingClientRect();
      var w = r.width * 0.8, h = r.height * 0.8;
      setBox((r.left - s.left) + (r.width - w) / 2, (r.top - s.top) + (r.height - h) / 2, w, h);
    };

    function setBox(x, y, w, h) {
      var r = img.getBoundingClientRect(), s = stage.getBoundingClientRect();
      var ox = r.left - s.left, oy = r.top - s.top;
      w = Math.max(24, Math.min(w, r.width));
      h = Math.max(24, Math.min(h, r.height));
      x = Math.max(ox, Math.min(x, ox + r.width - w));
      y = Math.max(oy, Math.min(y, oy + r.height - h));
      box.style.left = x + "px"; box.style.top = y + "px";
      box.style.width = w + "px"; box.style.height = h + "px";
      cropState.box = { x: x, y: y, w: w, h: h };
    }
    cropState.setBox = setBox;

    // السحب والتحجيم
    var drag = null;
    box.onpointerdown = function (e) {
      var handle = e.target.getAttribute("data-handle");
      drag = { x: e.clientX, y: e.clientY, start: Object.assign({}, cropState.box), handle: handle };
      box.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    };
    box.onpointermove = function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y, b = drag.start;
      if (!drag.handle) { setBox(b.x + dx, b.y + dy, b.w, b.h); return; }
      var nx = b.x, ny = b.y, nw = b.w, nh = b.h;
      if (drag.handle.indexOf("e") > -1) nw = b.w + dx;
      if (drag.handle.indexOf("s") > -1) nh = b.h + dy;
      if (drag.handle.indexOf("w") > -1) { nx = b.x + dx; nw = b.w - dx; }
      if (drag.handle.indexOf("n") > -1) { ny = b.y + dy; nh = b.h - dy; }
      if (cropState.ratio) nh = nw / cropState.ratio;
      setBox(nx, ny, nw, nh);
    };
    box.onpointerup = box.onpointercancel = function () { drag = null; };

    $$("[data-crop-ratio]", modal).forEach(function (btn) {
      btn.onclick = function () {
        $$("[data-crop-ratio]", modal).forEach(function (x) { x.classList.remove("is-active"); });
        btn.classList.add("is-active");
        var parts = btn.getAttribute("data-crop-ratio").split(":");
        cropState.ratio = parts.length === 2 ? (+parts[0] / +parts[1]) : 0;
        if (cropState.ratio) {
          var b = cropState.box;
          setBox(b.x, b.y, b.w, b.w / cropState.ratio);
        }
      };
    });

    $("[data-crop-apply]", modal).onclick = applyCrop;
    openModal(modal);
  }

  function applyCrop() {
    if (!cropState) return;
    var img = $("[data-crop-img]");
    var r = img.getBoundingClientRect();
    var s = $("[data-crop-stage]").getBoundingClientRect();
    var b = cropState.box;
    // نِسَب مش بكسل — عشان القص يفضل صح مهما كان مقاس العرض
    var payload = {
      asset: cropState.asset.id,
      box: {
        x: (b.x - (r.left - s.left)) / r.width,
        y: (b.y - (r.top - s.top)) / r.height,
        w: b.w / r.width,
        h: b.h / r.height
      }
    };
    var btn = $("[data-crop-apply]");
    /* مسار فاضي = المحرر مفتوح في وضع مالوش نقطة قص. من غير الشرط ده
       ‎fetch("")‎ بيروح لعنوان الصفحة نفسها ويرجّع HTML، والمستخدم
       بيشوف «تعذّر الاتصال بالخادم» وهو مفيش أي مشكلة اتصال. */
    if (!META.urls || !META.urls.crop) {
      toast("قص الصور مش متاح في المحرر ده.", "error");
      return;
    }
    btn.disabled = true;
    btn.textContent = "جارٍ القص…";

    fetch(META.urls.crop, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        /* رد مش JSON — صفحة خطأ، تحويل لصفحة الدخول، أو مسار غلط —
           كان بيقع في ‎catch‎ ويطلع رسالة انقطاع اتصال بتودّي في
           اتجاه غلط تماماً. نفصل الحالتين. */
        return res.json().catch(function () {
          var err = new Error("رد غير متوقع من الخادم (" + res.status + ").");
          err.lbShow = true;
          throw err;
        });
      })
      .then(function (d) {
        btn.disabled = false;
        btn.textContent = "اقصّ";
        if (!d.ok) { toast(d.error || "تعذّر القص.", "error"); return; }
        ASSETS.unshift(d.asset);
        if (cropState.onDone) cropState.onDone(d.asset.url);
        closeModal($("[data-crop-modal]"));
        toast("اتقصّت الصورة.", "ok");
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "اقصّ";
        toast(err && err.lbShow ? err.message : "تعذّر الاتصال بالخادم.", "error");
      });
  }

  var PICKER_TEXT = {
    image: { title: "مكتبة الصور",
             hint: "ارفع صوراً بصيغة JPG أو PNG أو WebP بحد أقصى ٨ ميجابايت للملف.",
             accept: "image/*", empty: "لم تُرفع أي صور بعد." },
    video: { title: "مكتبة الفيديو",
             hint: "ارفع فيديو MP4 أو WebM بحد أقصى ٤٠ ميجابايت — بينضغط تلقائياً "
                   + "لـ٧٢٠p بعد الرفع. فيديو الافتتاحية خلّيه قصير (٣-٧ ثواني).",
             accept: "video/mp4,video/webm,video/*", empty: "لم يُرفع أي فيديو بعد." },
    audio: { title: "مكتبة الموسيقى",
             hint: "ارفع MP3 أو M4A بحد أقصى ٨ ميجابايت.",
             accept: "audio/*", empty: "لم تُرفع أي مقطوعة بعد." }
  };

  function openAssetPicker(cb, kind) {
    pickCallback = cb;
    pickKind = kind || "image";
    selectedAssetIds.clear();
    var t = PICKER_TEXT[pickKind] || PICKER_TEXT.image;
    var title = $("[data-asset-title]"), hint = $("[data-asset-hint]");
    var input = $("[data-file-input]");
    if (title) title.textContent = t.title;
    if (hint) hint.textContent = t.hint;
    // من غير السطر ده نافذة اختيار الملف مش بتوري غير الصور
    if (input) input.setAttribute("accept", t.accept);
    renderAssets();
    openModal(refs.assetModal);
  }

  /* مكتبة الموسيقى المشتركة: بتترفع مرة واحدة من لوحة التحكم وتبقى متاحة
     لكل الدعوات، فبتظهر فوق الملفات المرفوعة للدعوة الحالية لوحدها. */
  function renderMusicLibrary() {
    var box = $("[data-music-lib]");
    if (!box) return;
    box.replaceChildren();

    var items = pickKind === "audio" ? MUSIC
              : pickKind === "video" ? INTROS : [];
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el("p", "ed-lib-label",
      // نفس المكتبة بتخدم الافتتاحية وقسم الفيديو، فالاسم عام
      (pickKind === "audio" ? "مكتبة الموسيقى" : "مكتبة الفيديوهات") +
      " — متاحة لكل الدعوات"));

    items.forEach(function (m) {
      var row = el("div", "ed-track");
      var btn = el("button", "ed-track-pick", m.name +
        (m.seconds ? " · " + Math.round(m.seconds) + "ث" : ""));
            btn.type = "button";
      btn.title = m.note || m.name;
      var media = doc.createElement(pickKind === "audio" ? "audio" : "video");
      var captureLibraryFrame = null;
      var pickLibraryItem = function () {
        var libraryPoster = m.poster || media.poster || "";
        if (pickKind === "video" && !libraryPoster && captureLibraryFrame) {
          try { captureLibraryFrame(); libraryPoster = media.poster || ""; } catch (ignore) {}
        }
        if (pickCallback) pickCallback(m.url, { poster: libraryPoster, thumb: libraryPoster });
        closeModal(refs.assetModal);
      };
      btn.addEventListener("click", function () {
        if (pickKind !== "video" || m.poster || media.poster || (media.videoWidth && media.videoHeight)) {
          pickLibraryItem();
          return;
        }
        // امنح الفيديو لحظة لقراءة أول فريم قبل حفظه كغلاف.
        btn.disabled = true;
        var settled = false;
        var finish = function () {
          if (settled) return;
          settled = true;
          try { captureLibraryFrame && captureLibraryFrame(); } catch (ignore) {}
          pickLibraryItem();
        };
        media.addEventListener("loadeddata", finish, { once: true });
        media.addEventListener("canplay", finish, { once: true });
        window.setTimeout(finish, 1800);
        try { media.load(); } catch (ignore) { finish(); }
      });

      media.src = m.url;
      if (pickKind === "audio") {
        media.controls = true;
        media.preload = "none";
      } else {
        // مكتبة الافتتاحيات تعرض صورة ثابتة من أول فريم بدلاً من مشغل أسود.
        media.controls = false;
        media.muted = true;
        media.defaultMuted = true;
        media.playsInline = true;
        media.preload = "auto";
        media.setAttribute("aria-hidden", "true");
        media.setAttribute("disablepictureinpicture", "true");
        if (m.poster) media.poster = m.poster;

        captureLibraryFrame = function () {
          if (!media.videoWidth || !media.videoHeight) return;
          try {
            var maxEdge = 640;
            var ratio = Math.min(1, maxEdge / Math.max(media.videoWidth, media.videoHeight));
            var canvas = doc.createElement("canvas");
            canvas.width = Math.max(1, Math.round(media.videoWidth * ratio));
            canvas.height = Math.max(1, Math.round(media.videoHeight * ratio));
            canvas.getContext("2d").drawImage(media, 0, 0, canvas.width, canvas.height);
            media.poster = canvas.toDataURL("image/jpeg", .82);
            media.classList.add("ed-video-poster-ready");
          } catch (ignore) {
            // الفيديوهات الخارجية قد تمنع canvas؛ poster المحفوظ يظل مستخدماً إن وُجد.
          }
        };
        media.addEventListener("loadedmetadata", function () {
          try { media.currentTime = 0.01; } catch (ignore) {}
        });
        media.addEventListener("loadeddata", captureLibraryFrame, { once: true });
        media.addEventListener("canplay", captureLibraryFrame, { once: true });
      }
      row.appendChild(btn);
      row.appendChild(media);
      box.appendChild(row);
    });
    box.appendChild(el("p", "ed-lib-label", "أو ارفع ملفاً لهذه الدعوة وحدها"));
  }

  function bulkDeleteSelectedAssets() {
    if (!META.urls.deleteAssets || !selectedAssetIds.size) return;
    var ids = Array.from(selectedAssetIds);
    var selectedLabel = pickKind === "video" ? "فيديو" : "صورة";
    if (!window.confirm("هل تريد حذف " + ids.length + " " + selectedLabel + " محددة؟")) return;

    fetch(META.urls.deleteAssets, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify({ assets: ids, kind: pickKind })
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { status: r.status, data: data };
        });
      })
      .then(function (result) {
        var data = result.data || {};
        if (!data.ok) {
          toast(data.error || "تعذّر حذف الملفات المحددة.", "error");
          return;
        }
        var deleted = new Set((data.deleted || []).map(Number));
        ASSETS = ASSETS.filter(function (asset) { return !deleted.has(Number(asset.id)); });
        selectedAssetIds.clear();
        renderAssets();
        toast("تم حذف الملفات المحددة من المكتبة.", "ok");
      })
            .catch(function () {
        toast("تعذّر الاتصال لحذف الملفات.", "error");
      });
  }

  function renderAssets() {
    var box = refs.assetGrid;
    box.replaceChildren();
    renderMusicLibrary();

    if (pickKind === "image") {
      var filter = el("select", "ed-asset-filter");
      filter.setAttribute("aria-label", "فلترة الصور");
      [["all", "كل الصور"], ["used", "المستخدمة في قالب أو دعوة"],
       ["unused", "غير المستخدمة"]].forEach(function (option) {
        var item = el("option", null, option[1]);
        item.value = option[0];
        item.selected = imageUsageFilter === option[0];
        filter.appendChild(item);
      });
      filter.addEventListener("change", function () {
        imageUsageFilter = filter.value;
        selectedAssetIds.clear();
        renderAssets();
      });
      box.appendChild(filter);
    }

    var images = ASSETS.filter(function (a) { return a.kind === (pickKind || "image"); });
    if (pickKind === "image" && imageUsageFilter !== "all") {
      images = images.filter(function (a) {
        return imageUsageFilter === "used" ? !!a.used : !a.used;
      });
    }
    var bulkBar = null;
    var selectedCount = null;
    var selectAllBtn = null;
    var bulkDeleteBtn = null;
    if (pickKind === "image" || pickKind === "video") {
      bulkBar = el("div", "ed-asset-bulk");
      selectedCount = el("span", "ed-asset-bulk-count", "لم يتم تحديد ملفات");
      bulkBar.appendChild(selectedCount);
      selectAllBtn = el("button", "ed-btn ed-btn--sm", "تحديد الكل");
      selectAllBtn.type = "button";
      selectAllBtn.hidden = pickKind === "image" && imageUsageFilter !== "unused";
      bulkBar.appendChild(selectAllBtn);
      bulkDeleteBtn = el("button", "ed-btn ed-btn--sm ed-btn--danger", "حذف المحدد");
      bulkDeleteBtn.type = "button";
      bulkDeleteBtn.disabled = !selectedAssetIds.size;
      bulkBar.appendChild(bulkDeleteBtn);
      box.appendChild(bulkBar);
    }

    function refreshBulkBar() {
      if (!bulkBar) return;
      var count = selectedAssetIds.size;
      var selectedLabel = pickKind === "video" ? "فيديو" : "صورة";
      selectedCount.textContent = count ? ("تم تحديد " + count + " " + selectedLabel) : "لم يتم تحديد ملفات";
      bulkDeleteBtn.disabled = !count;
      if (selectAllBtn && (pickKind === "video" || imageUsageFilter === "unused")) {
        var allSelected = images.length > 0 && images.every(function (a) {
          return selectedAssetIds.has(a.id);
        });
        selectAllBtn.textContent = allSelected ? "إلغاء تحديد الكل" : "تحديد الكل";
      }
    }

    if (selectAllBtn) {
      selectAllBtn.addEventListener("click", function () {
        var allSelected = images.length > 0 && images.every(function (a) {
          return selectedAssetIds.has(a.id);
        });
        images.forEach(function (a) {
          if (allSelected) selectedAssetIds.delete(a.id);
          else selectedAssetIds.add(a.id);
        });
        renderAssets();
      });
    }
    if (bulkDeleteBtn) {
      bulkDeleteBtn.addEventListener("click", bulkDeleteSelectedAssets);
    }

    if (!images.length) {
      box.appendChild(el("p", "ed-empty",
        (PICKER_TEXT[pickKind] || PICKER_TEXT.image).empty));
      refreshBulkBar();
      return;
    }
    images.forEach(function (a) {
      var btn = el("button", "ed-asset");
      btn.type = "button";
      btn.title = a.name;
      if (a.kind === "image" || (a.kind === "video" && a.thumb)) {
        btn.style.backgroundImage = 'url("' + (a.thumb || a.url) + '")';
        if (a.kind === "video") btn.classList.add("ed-asset--video-thumb");
        btn.appendChild(el("span", "ed-asset-name", a.name || ""));
      } else if (a.kind === "video") {
        // للفيديو القديم الذي لم يُنشأ له thumb: نحمّل أول فريم من المتصفح.
        btn.classList.add("ed-asset--file", "ed-asset--video-preview");
        var videoPreview = doc.createElement("video");
        videoPreview.muted = true;
        videoPreview.defaultMuted = true;
        videoPreview.playsInline = true;
        videoPreview.preload = "auto";
        videoPreview.src = a.url;
        videoPreview.setAttribute("aria-hidden", "true");
        videoPreview.setAttribute("disablepictureinpicture", "true");
        var captureVideoFrame = function () {
          if (!videoPreview.videoWidth || !videoPreview.videoHeight) return;
          try {
            var maxEdge = 640;
            var ratio = Math.min(1, maxEdge / Math.max(videoPreview.videoWidth, videoPreview.videoHeight));
            var canvas = doc.createElement("canvas");
            canvas.width = Math.max(1, Math.round(videoPreview.videoWidth * ratio));
            canvas.height = Math.max(1, Math.round(videoPreview.videoHeight * ratio));
            canvas.getContext("2d").drawImage(videoPreview, 0, 0, canvas.width, canvas.height);
            btn.style.backgroundImage = 'url("' + canvas.toDataURL("image/jpeg", .82) + '")';
            btn.classList.remove("ed-asset--file", "ed-asset--video-preview");
            btn.classList.add("ed-asset--video-thumb");
            videoPreview.remove();
          } catch (ignore) {
            // لو المتصفح منع canvas بسبب صيغة الفيديو، نترك عنصر video ظاهراً كـfallback.
          }
        };
        videoPreview.addEventListener("loadedmetadata", function () {
          try { videoPreview.currentTime = 0.01; } catch (ignore) {}
        });
        videoPreview.addEventListener("loadeddata", captureVideoFrame);
        videoPreview.addEventListener("canplay", captureVideoFrame);
        videoPreview.addEventListener("error", function () {
          btn.classList.add("ed-asset--video-unavailable");
        });
        btn.appendChild(videoPreview);
        btn.appendChild(el("span", "ed-asset-name", a.name || ""));
      } else {
        btn.classList.add("ed-asset--file");
        btn.appendChild(el("span", "ed-asset-ico", "♪"));
        btn.appendChild(el("span", "ed-asset-name", a.name || ""));
      }
      btn.addEventListener("click", function () {
                if (pickCallback) pickCallback(a.url, a);

        closeModal(refs.assetModal);
      });
      var tile = el("div", "ed-asset-wrap");
      var check = el("input", "ed-asset-check");
      check.type = "checkbox";
      check.checked = selectedAssetIds.has(a.id);
      check.title = "تحديد الملف للحذف الجماعي";
      check.setAttribute("aria-label", "تحديد " + (a.name || (a.kind === "video" ? "الفيديو" : "الصورة")));
      check.addEventListener("click", function (e) {
        e.stopPropagation();
      });
      check.addEventListener("change", function () {
        if (check.checked) selectedAssetIds.add(a.id);
        else selectedAssetIds.delete(a.id);
        tile.classList.toggle("is-selected", check.checked);
        refreshBulkBar();
      });
      tile.classList.toggle("is-selected", check.checked);
      tile.appendChild(btn);
      tile.appendChild(check);

      /* زر الحذف منفصل عن زر الاختيار حتى لا تختار الملف بالخطأ. */
      if ((a.kind === "image" || a.kind === "video") && META.urls.deleteAsset) {
        var del = el("button", "ed-asset-delete", "×");
        del.type = "button";
        del.title = a.kind === "video" ? "حذف الفيديو من المكتبة" : "حذف الصورة من المكتبة";
        del.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          if (!window.confirm(a.kind === "video" ? "هل تريد حذف هذا الفيديو من المكتبة؟" : "هل تريد حذف هذه الصورة من المكتبة؟")) return;
          del.disabled = true;
          fetch(META.urls.deleteAsset, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
            credentials: "same-origin",
            body: JSON.stringify({ asset: a.id, kind: a.kind })
          })
            .then(function (r) {
              return r.json().then(function (data) {
                return { status: r.status, data: data };
              });
            })
            .then(function (result) {
              del.disabled = false;
              var data = result.data || {};
              if (!data.ok) {
                toast(data.error || "تعذّر حذف الملف.", "error");
                return;
              }
              ASSETS = ASSETS.filter(function (item) { return item.id !== a.id; });
              renderAssets();
              toast("تم حذف الملف من المكتبة.", "ok");
            })
            .catch(function () {
              del.disabled = false;
              toast("تعذّر الاتصال لحذف الصورة.", "error");
            });
        });
        tile.appendChild(del);
      }
      box.appendChild(tile);
    });
    refreshBulkBar();
  }

  function makeClientVideoThumbnail(file) {
    if (!file || !/^video\//i.test(file.type || "")) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var preview = doc.createElement("video");
      var objectUrl = URL.createObjectURL(file);
      var settled = false;
      var timer = window.setTimeout(function () { finish(null); }, 8000);
      function finish(blob) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        try { URL.revokeObjectURL(objectUrl); } catch (ignore) {}
        resolve(blob || null);
      }
      function capture() {
        if (!preview.videoWidth || !preview.videoHeight) return;
        try {
          var maxEdge = 640;
          var ratio = Math.min(1, maxEdge / Math.max(preview.videoWidth, preview.videoHeight));
          var canvas = doc.createElement("canvas");
          canvas.width = Math.max(1, Math.round(preview.videoWidth * ratio));
          canvas.height = Math.max(1, Math.round(preview.videoHeight * ratio));
          canvas.getContext("2d").drawImage(preview, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) { finish(blob); }, "image/jpeg", .82);
        } catch (ignore) {
          finish(null);
        }
      }
      preview.muted = true;
      preview.defaultMuted = true;
      preview.playsInline = true;
      preview.preload = "auto";
      preview.src = objectUrl;
      preview.addEventListener("loadedmetadata", function () {
        try { preview.currentTime = 0.01; } catch (ignore) {}
      });
      preview.addEventListener("loadeddata", capture, { once: true });
      preview.addEventListener("canplay", capture, { once: true });
      preview.addEventListener("error", function () { finish(null); }, { once: true });
      preview.load();
    });
  }

  function uploadFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      makeClientVideoThumbnail(file).then(function (thumbBlob) {
        var fd = new FormData();
        fd.append("file", file);
        if (thumbBlob) {
          var thumbName = (file.name || "video").replace(/\.[^.]+$/, "") + "-thumb.jpg";
          fd.append("thumb", thumbBlob, thumbName);
        }
        return fetch(META.urls.upload, {
          method: "POST",
          headers: { "X-CSRFToken": csrf() },
          credentials: "same-origin",
          body: fd
        });
      })
        .then(function (r) {
          return r.text().then(function (raw) {
            var data = {};
            var contentType = (r.headers.get("content-type") || "").toLowerCase();
            try { data = raw ? JSON.parse(raw) : {}; } catch (ignore) {}
            if (!contentType.includes("application/json")) {
              if (r.redirected || /login/i.test(r.url || "")) {
                toast("انتهت جلسة الدخول. اعمل تسجيل دخول وافتح المحرر من جديد.", "error");
              } else {
                toast("السيرفر رجّع رد غير صالح أثناء رفع الفيديو. راجع Error log.", "error");
              }
              return null;
            }
            if (!r.ok) {
              if (r.status === 413) {
                toast("السيرفر رفض الفيديو لأن حجم طلب الرفع كبير. تأكد أن الفيديو أقل من 40 ميجابايت.", "error");
              } else {
                toast(data.error || ("تعذّر رفع الملف (" + r.status + ")."), "error");
              }
              return null;
            }
            return data;
          });
        })
        .then(function (data) {
          if (!data) return;
          if (!data.ok) { toast(data.error || "فشل رفع الملف.", "error"); return; }
          ASSETS.unshift(data.asset);
          renderAssets();
          toast("تم رفع «" + data.asset.name + "».", "ok");
          if (pickCallback) {
            pickCallback(data.asset.url, data.asset);
            closeModal(refs.assetModal);
          }
        })
        .catch(function () { toast("تعذّر الاتصال بالسيرفر أثناء رفع الملف.", "error"); });
    });
  }

  // ==========================================================
  // النوافذ والتبويبات
  // ==========================================================
  function openModal(m) { if (m) m.hidden = false; }
  function closeModal(m) { if (m) { m.hidden = true; pickCallback = null; } }

  function switchTab(name, reveal) {
    $$("[data-tab]").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.tab === name);
    });
    $$("[data-pane]").forEach(function (p) {
      p.classList.toggle("is-active", p.dataset.pane === name);
    });
    // جدول الترجمة بيتبني من نصوص الدعوة الحالية، فبيتعاد بناؤه مع كل
    // فتحة — أي نص جديد كتبته في تبويب تاني بيظهر هنا على طول.
    if (name === "i18n") renderI18nPane();
    syncCollapseTool();
    // على الموبايل اللوحة درج منزلق. نفتحه فقط لما المستخدم يطلب تبويب بنفسه،
    // مش عند التهيئة — وإلا بيغطي المعاينة من أول ثانية.
    if (reveal !== false && refs.panel) setPanel(true);
  }

  // ==========================================================
  // طيّ كل المجموعات
  // ==========================================================
  /* لوحة الخصائص فيها مجموعات كتير، ولما تفتح أربعة أو خمسة بتفضل
     تنزل وتطلع عشان توصل للي انت عايزه. الزر ده بيقفلهم كلهم مرة
     واحدة — وبيرجّع يفتحهم لو دُست عليه تاني. */
  function activePane() {
    return $(".ed-tabpane.is-active");
  }

  function paneGroups() {
    var pane = activePane();
    return pane ? Array.prototype.slice.call(pane.querySelectorAll("details.ed-group")) : [];
  }

  function syncCollapseTool() {
    var tools = $("[data-panel-tools]");
    if (!tools) return;
    var groups = paneGroups();
    tools.hidden = groups.length < 2;        // مجموعة واحدة مش محتاجة زرار
    if (tools.hidden) return;

    var anyOpen = groups.some(function (g) { return g.open; });
    var btn = $("[data-collapse-all]");
    var label = $("[data-collapse-label]");
    if (btn) btn.setAttribute("aria-expanded", anyOpen ? "true" : "false");
    if (label) label.textContent = anyOpen ? "اقفل الكل" : "افتح الكل";
  }

  function toggleAllGroups() {
    var groups = paneGroups();
    if (!groups.length) return;
    var anyOpen = groups.some(function (g) { return g.open; });
    groups.forEach(function (g) { g.open = !anyOpen; });
    syncCollapseTool();
  }

  function setPanel(open) {
    if (!refs.panel) return;
    refs.panel.classList.toggle("is-open", !!open);
    var scrim = $("[data-panel-scrim]");
    if (scrim) scrim.hidden = !open;
    var t = $("[data-panel-toggle]");
    if (t) t.setAttribute("aria-expanded", open ? "true" : "false");
  }

  // ==========================================================
  // الحفظ
  // ==========================================================
  function collectFields() {
    var out = {};
    $$("[data-inv-field]").forEach(function (node) {
      out[node.dataset.invField] = node.type === "checkbox" ? (node.checked ? "on" : "") : node.value;
    });
    return out;
  }

  function save(silent) {
    if (state.saving) return Promise.resolve(false);
    state.saving = true;
    setSaveState("saving", "جارٍ الحفظ…");

    return fetch(META.urls.save, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify({ document: state.doc, fields: collectFields() })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        state.saving = false;
        if (!res.ok || !res.data.ok) {
          setSaveState("error", "فشل الحفظ");
          var errs = res.data && res.data.errors;
          var first = errs && Object.keys(errs)[0];
          toast(first ? (first + ": " + errs[first][0]) : "تعذّر الحفظ.", "error");
          return false;
        }
        state.dirty = false;
        setSaveState("saved", "محفوظ " + res.data.savedAt);
        if (refs.publicLink) refs.publicLink.href = res.data.publicUrl;
        if (!silent) toast("تم حفظ التعديلات.", "ok");
        return true;
      })
      .catch(function () {
        state.saving = false;
        setSaveState("error", "تعذّر الاتصال");
        toast("تعذّر الاتصال بالخادم.", "error");
        return false;
      });
  }

  // الحفظ تلقائي بعد سكوت قصير (شوف scheduleAutosave فوق)، وزر «حفظ»
  // وCtrl+S فاضلين للحفظ الفوري. تحديث المعاينة تلقائي زي ما هو.

  // ==========================================================
  // حفظ كقالب
  // ==========================================================
  function saveAsTemplate() {
    var form = refs.templateForm;
    var name = $("[name=tpl_name]", form).value.trim();
    if (name.length < 2) { toast("اكتب اسماً للقالب.", "error"); return; }

    var payload = {
      document: state.doc,
      name: name,
      slug: $("[name=tpl_slug]", form).value.trim(),
      category: $("[name=tpl_category]", form).value,
      collection: $("[name=tpl_collection]", form).value.trim(),
      description: $("[name=tpl_description]", form).value.trim(),
      is_active: $("[name=tpl_active]", form).checked
    };

    fetch(META.urls.saveTemplate, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) { toast(data.error || "تعذّر حفظ القالب.", "error"); return; }
        closeModal(refs.templateModal);
        toast(data.message, "ok");
      })
      .catch(function () { toast("تعذّر الاتصال بالخادم.", "error"); });
  }

  // ==========================================================
  // الإقلاع
  // ==========================================================
  function boot() {
    refs = {
      panel: $(".ed-panel"),
      blockList: $("[data-block-list]"),
      inspector: $("[data-inspector]"),
      themePane: $("[data-theme-pane]"),
      settingsPane: $("[data-pane='settings']"),
      frame: $("[data-preview-frame]"),
      device: $("[data-device-shell]"),
      loading: $("[data-loading]"),
      saveState: $("[data-save-state]"),
      toasts: $(".ed-toasts"),
      blockCount: $("[data-block-count]"),
      publicLink: $("[data-public-link]"),
      undo: $("[data-undo]"),
      redo: $("[data-redo]"),
      pickerModal: $("[data-picker-modal]"),
      pickerBody: $("[data-picker-body]"),
      assetModal: $("[data-asset-modal]"),
            assetGrid: $("[data-asset-grid]"),
      favoritesModal: $("[data-favorites-modal]"),
      favoritesBody: $("[data-favorites-body]"),
      templateModal: $("[data-template-modal]"),

      templateForm: $("[data-template-form]")
    };

    // التبويبات
    $$("[data-tab]").forEach(function (btn) {
      btn.addEventListener("click", function () { switchTab(btn.dataset.tab); });
    });

    // الأجهزة
    $$("[data-set-device]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.device = btn.dataset.setDevice;
        $$("[data-set-device]").forEach(function (b) {
          b.classList.toggle("is-active", b === btn);
        });
        if (refs.device) refs.device.dataset.device = state.device;
        /* الارتفاع محفوظ لكل مقاس على حدة، فالإطار لازم يعيد يبني
           نفسه على مفتاح المقاس الجديد بدل ما يفضل على القديم. */
        if (state.sectionBoundsBlock) applySectionBounds();
      });
    });

    // الأزرار
    var addBtn = $("[data-add-block]");
    if (addBtn) addBtn.addEventListener("click", openBlockPicker);

    var saveBtn = $("[data-save]");
    if (saveBtn) saveBtn.addEventListener("click", function () { save(false); });

    var collapseBtn = $("[data-collapse-all]");
    if (collapseBtn) collapseBtn.addEventListener("click", toggleAllGroups);
    // حدث toggle بتاع <details> مابيصعدش، فبنسمع للضغط على الملخّص
    // ونعيد المزامنة بعد ما المتصفح يقلب الحالة
    if (refs.panel) {
      refs.panel.addEventListener("click", function (e) {
        if (e.target.closest("details.ed-group > summary")) {
          setTimeout(syncCollapseTool, 0);
        }
      });
    }

    if (refs.undo) refs.undo.addEventListener("click", undo);
    if (refs.redo) refs.redo.addEventListener("click", redo);

    var tplBtn = $("[data-open-template]");
    if (tplBtn) tplBtn.addEventListener("click", function () { openModal(refs.templateModal); });
    var tplSave = $("[data-save-template]");
    if (tplSave) tplSave.addEventListener("click", saveAsTemplate);

        var assetBtn = $("[data-open-assets]");
    if (assetBtn) assetBtn.addEventListener("click", function () { openAssetPicker(null); });

    var favoritesBtn = $("[data-open-favorites]");
    if (favoritesBtn) favoritesBtn.addEventListener("click", openFavoriteLibrary);

    var fileInput = $("[data-file-input]");

    if (fileInput) {
      fileInput.addEventListener("change", function () {
        if (fileInput.files.length) uploadFiles(fileInput.files);
        fileInput.value = "";
      });
    }
    var uploadBtn = $("[data-upload-trigger]");
    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener("click", function () { fileInput.click(); });
    }

    $$("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeModal(btn.closest(".ed-modal"));
      });
    });
    $$(".ed-modal").forEach(function (m) {
      m.addEventListener("click", function (e) { if (e.target === m) closeModal(m); });
    });

    var scrim = $("[data-panel-scrim]");
    if (scrim) scrim.addEventListener("click", function () { setPanel(false); });

    var moreBtn = $("[data-more]");
    if (moreBtn) {
      moreBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var open = moreBtn.getAttribute("aria-expanded") === "true";
        moreBtn.setAttribute("aria-expanded", open ? "false" : "true");
      });
      document.addEventListener("click", function () {
        moreBtn.setAttribute("aria-expanded", "false");
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (moreBtn) moreBtn.setAttribute("aria-expanded", "false");
      if (refs.panel && refs.panel.classList.contains("is-open") && window.innerWidth <= 900) setPanel(false);
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 900) setPanel(false);
    });

    /* تبديل المظهر — نفس مفتاح التخزين بتاع الموقع عشان الاختيار يتبع المستخدم */
    var themeBtn = $("[data-theme-toggle]");
    if (themeBtn) {
      themeBtn.addEventListener("click", function () {
        var now = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", now);
        try { localStorage.setItem("leila-theme", now); } catch (e) {}
      });
    }

    /* «الافتتاحية» — بترجّع الشاشة الافتتاحية في المعاينة عشان تعاينها
       وتعدّلها. زر «التالي» جوّاها بيدخّلك الدعوة. */
    var introBtn = $("[data-show-intro]");
    if (introBtn) {
      introBtn.addEventListener("click", function () {
        var win = refs.frame && refs.frame.contentWindow;
        if (win && win.__lbIntro) {
          win.__lbIntro.reopen();
        } else {
          toast("فعّل «شاشة افتتاحية» من تبويب الإعدادات الأول.", "error");
        }
      });
    }

    var panelToggle = $("[data-panel-toggle]");
    if (panelToggle) {
      panelToggle.addEventListener("click", function () {
        setPanel(!refs.panel.classList.contains("is-open"));
      });
    }

    // حقول بيانات المناسبة
    $$("[data-inv-field]").forEach(function (node) {
      node.addEventListener("input", function () { markDirty(); requestPreview(); });
      node.addEventListener("change", function () { markDirty(); requestPreview(); });
    });

    // الإطار
    if (refs.frame) {
      refs.frame.addEventListener("load", function () {
        previewReady = true;
        bindPreviewInteractions();
        requestPreview();
      });
    }

    // اختصارات لوحة المفاتيح
    doc.addEventListener("keydown", function (e) {
      var meta = e.ctrlKey || e.metaKey;
      if (!meta) {
        if (e.key === "Escape") {
          $$(".ed-modal").forEach(function (m) { if (!m.hidden) closeModal(m); });
        }
        return;
      }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); save(false); }
      else if ((e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === "y" || e.key === "Y") || ((e.key === "z" || e.key === "Z") && e.shiftKey)) {
        e.preventDefault(); redo();
      }
    });

    /* اختصارات العناصر — بتتربط على مستند المحرر ومستند المعاينة مع
       بعض، لأن الضغطة اللي جوّه الـiframe مابتوصلش للصفحة الأم. */
    bindElementKeys(doc);
    if (refs.frame) {
      refs.frame.addEventListener("load", function () {
        var fdoc = frameDoc();
        if (fdoc) bindElementKeys(fdoc);
      });
      var fd0 = frameDoc();
      if (fd0) bindElementKeys(fd0);
    }

    /* Delete / Backspace يحذف القسم المحدد — بس لما التركيز مش في خانة كتابة،
       وإلا هنمسح أقسام والمستخدم بيمسح حروف. التراجع بـCtrl+Z شغال. */
    doc.addEventListener("keydown", function (e) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      var t = e.target;
      if (!t) return;
      var tag = (t.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (t.isContentEditable) return;
      if (doc.querySelector(".ed-modal.is-open")) return;
      // عنصر محدَّد جوّه قسم مستورد؟ يبقى الحذف ليه هو مش للقسم كله
      if (state.selEl && selectedElNode()) return;
      if (!state.selected) return;

      var block = findBlock(state.selected);
      if (!block || block.locked) return;
      var spec = blockSpec(block.type);
      e.preventDefault();

      snapshot();                      // قبل التعديل — دي الحالة اللي Ctrl+Z هيرجّعها
      var i = blockIndex(block.id);
      state.doc.blocks.splice(i, 1);
      state.selected = null;
      markDirty();
      renderBlockList();
      renderInspector();
      requestPreview();
      toast("اتحذف «" + ((spec && spec.label) || "القسم") + "» — Ctrl+Z للتراجع", "ok");
    });

    window.addEventListener("beforeunload", function (e) {
      if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
    });

    // العرض الأول
    renderBlockList();
    renderInspector();
    renderThemePane();
    renderSettingsPane();
    updateHistoryButtons();
    setSaveState("saved", "محفوظ");
    switchTab("blocks", false);
  }

  if (doc.readyState === "loading") {
    doc.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
