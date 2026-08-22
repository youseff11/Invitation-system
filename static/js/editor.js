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
    future: []
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
  function buildField(spec, getValue, setValue) {
    var wrap = el("div", "ed-field");
    var disabled = !hasFeature(spec.feature);

    var label = el("label");
    label.appendChild(el("span", null, spec.label));
    if (disabled) {
      var lock = el("b", null, "غير متاح في الباقة");
      lock.style.fontSize = "10px";
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
        wrap.appendChild(input);
        break;

      case "textarea":
      case "html":
        input = el("textarea");
        input.rows = spec.type === "html" ? 5 : 3;
        input.value = value == null ? "" : value;
        input.addEventListener("input", function () { setValue(input.value); });
        wrap.appendChild(label);
        wrap.appendChild(input);
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
        var cbox = el("div", "ed-color");
        cbox.appendChild(picker);
        cbox.appendChild(hex);
        wrap.appendChild(label);
        wrap.appendChild(cbox);
        break;
      }

      // ---------------------------------------------------- اختيار
      case "select":
      case "font": {
        input = doc.createElement("select");
        var opts = spec.options || SCHEMA.fonts || [];
        if (spec.type === "font") {
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
        input.addEventListener("change", function () { setValue(input.value); });
        wrap.appendChild(label);
        wrap.appendChild(input);
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
          setValue(urlInput.value);
        });
        var pickBtn = el("button", "ed-btn ed-btn--sm",
          isImage ? "اختر أو ارفع صورة" : (mediaKind === "video" ? "اختر أو ارفع فيديو" : "اختر أو ارفع ملف"));
        pickBtn.type = "button";
        function open() {
          openAssetPicker(function (url) {
            urlInput.value = url;
            paint(url);
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
            var titleText = item[(spec.fields[0] || {}).key] || item.label || item.name ||
              ("عنصر " + (index + 1));
            head.appendChild(el("span", null, String(titleText).slice(0, 40)));

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
            (spec.fields || []).forEach(function (sub) {
              body.appendChild(buildField(
                sub,
                function () { return item[sub.key]; },
                function (v) {
                  item[sub.key] = v;
                  setValue(items);
                  head.firstChild.textContent = String(
                    item[(spec.fields[0] || {}).key] || ("عنصر " + (index + 1))
                  ).slice(0, 40);
                }
              ));
            });
            card.appendChild(body);
            listBox.appendChild(card);
          });
        }
        redraw();

        var addBtn = el("button", "ed-btn ed-btn--sm ed-btn--block", "＋ " + (spec.add_label || "إضافة عنصر"));
        addBtn.type = "button";
        addBtn.addEventListener("click", function () {
          snapshot();
          var row = {};
          (spec.fields || []).forEach(function (sub) { row[sub.key] = clone(sub.default); });
          items.push(row);
          setValue(items);
          redraw();
          requestPreview();
        });

        wrap.appendChild(label);
        wrap.appendChild(listBox);
        wrap.appendChild(addBtn);
        break;
      }

      default:
        input = el("input", "ed-input");
        input.value = value == null ? "" : value;
        input.addEventListener("input", function () { setValue(input.value); });
        wrap.appendChild(label);
        wrap.appendChild(input);
    }

    // نسم الحقل بمفتاحه حتى يمكن مزامنته مع التحرير المباشر داخل المعاينة
    $$("input, textarea", wrap).forEach(function (n) {
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
      var g = spec.group || "المحتوى";
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(spec);
    });
    order.forEach(function (name, i) {
      var details = el("details", "ed-group");
      if (i === 0 && openFirst !== false) details.open = true;
      var sum = el("summary");
      sum.appendChild(el("span", null, name));
      details.appendChild(sum);
      var body = el("div", "ed-group-body");
      groups[name].forEach(function (spec) {
        body.appendChild(buildField(
          spec,
          function () { return getValue(spec); },
          function (v) { setValue(spec, v); }
        ));
      });
      details.appendChild(body);
      frag.appendChild(details);
    });
    return frag;
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
      if (!block.visible || gated) row.classList.add("is-hidden");

      row.appendChild(el("span", "ed-block-grip", "⠿"));
      row.appendChild(el("span", "ed-block-icon", spec.icon));
      // الاسم اللي كتبه المستخدم بيسبق اسم النوع — بيفرق جداً مع
      // القوالب المستوردة اللي كل أقسامها من نفس النوع
      var nameEl = el("span", "ed-block-name", block.label || spec.label);
      if (block.label) nameEl.title = block.label + " — " + spec.label;
      row.appendChild(nameEl);
      if (gated) row.appendChild(el("span", "ed-block-tag", "الباقة"));

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
    state.selected = id;
    renderBlockList();
    renderInspector();
    switchTab("inspector");
    highlightInPreview(id);
  }

  // ==========================================================
  // لوحة خصائص القسم
  // ==========================================================
  function renderInspector() {
    var box = refs.inspector;
    if (!box) return;
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
        function (s, v) { block.props[s.key] = v; markDirty(); requestPreview(); }
      ));
    }

    // في القسم المستورد لوحة العنصر هي الأداة الأساسية — تيجي الأول
    if (codeLast) {
      box.appendChild(buildElementGroup(block));
      box.appendChild(buildColorGroup(block));
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
      box.appendChild(buildGroups(
        spec.props,
        function (s) { return block.props[s.key]; },
        function (s, v) { block.props[s.key] = v; markDirty(); requestPreview(); },
        false
      ));
    }
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
  function customRoot(node) {
    return node && node.closest ? node.closest(".lb-custom") : null;
  }

  /** يحفظ الـHTML ويعيد بناء المعاينة (عشان الترقيم يتظبط). */
  function commitStructure(block, root) {
    block.props.html = serializeCustom(root);
    markDirty();
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
    if (node.getAttribute("data-lb-text")) node.insertAdjacentElement("afterend", elem);
    else node.appendChild(elem);
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
    wrap.open = true;

    var commit = function () {
      block.props.html = serializeCustom(
        node.closest("[data-block]").querySelector(".lb-custom"));
      markDirty();
    };
    var setStyle = function (prop, value) {
      if (value) node.style.setProperty(prop, value);
      else node.style.removeProperty(prop);
      commit();
    };

    var tag = node.tagName;
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

    /* الصورة مش نص. الخط والحجم والسُمك والمحاذاة وتباعد الحروف
       وارتفاع السطر ولون النص مالهمش أي تأثير على ‎<img>‎ — عرضها
       كان بيخلي اللوحة تبان زي ما هي مهما حرّكت فيها، وده أسوأ من
       إنها ناقصة. بنعرض أدوات الصورة بدالها. */
    var isImg = tag === "IMG";
    if (isImg) {
      body.appendChild(el("p", "ed-hint",
        "دي صورة — أدوات الخط والنص مش بتأثر عليها فمخفية."));
    }

    // ---- الخط
    if (!isImg) {
    var fontSel = el("select", "ed-input");
    fontSel.appendChild(new Option("زي ما هو", ""));
    (SCHEMA.fonts || []).forEach(function (f) {
      fontSel.appendChild(new Option(f.label, f.value));
    });
    /* المتصفح بيعيد كتابة font-family بعلامات تنصيص مزدوجة، فمقارنة
       نصية مباشرة مع قيمة الخيار بتفشل والقايمة بتبان فاضية. */
    var fontKey = function (v) {
      return String(v || "").replace(/["']/g, "").replace(/\s+/g, " ")
             .trim().toLowerCase();
    };
    var cur = fontKey(styleOf(node, "font-family"));
    for (var fi = 0; fi < fontSel.options.length; fi++) {
      if (fontKey(fontSel.options[fi].value) === cur) {
        fontSel.selectedIndex = fi;
        break;
      }
    }
    fontSel.addEventListener("change", function () {
      snapshot(); setStyle("font-family", fontSel.value);
    });
    body.appendChild(ctrlRow("الخط", fontSel));

    // ---- حجم الخط
    var sizeVal = parseFloat(styleOf(node, "font-size")) || computedPx(node, "fontSize");
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
    body.appendChild(ctrlRow("حجم الخط", size, sizeOut));

    // ---- السُمك والمحاذاة
    [["font-weight", "سُمك الخط", WEIGHTS],
     ["text-align", "المحاذاة", ALIGNS]].forEach(function (spec) {
      var sel = el("select", "ed-input");
      spec[2].forEach(function (o) { sel.appendChild(new Option(o[1], o[0])); });
      sel.value = styleOf(node, spec[0]);
      sel.addEventListener("change", function () {
        snapshot(); setStyle(spec[0], sel.value);
      });
      body.appendChild(ctrlRow(spec[1], sel));
    });
    }

    /* لون الخلفية بيفضل مفيد على الصورة — بيبان ورا PNG شفاف ووقت
       التحميل. لون النص لأ. */
    // ---- الألوان
    (isImg ? [["background-color", "لون الخلفية"]]
           : [["color", "لون النص"], ["background-color", "لون الخلفية"]]
    ).forEach(function (spec) {
      var input = el("input");
      input.type = "color";
      input.className = "ed-color";
      var cur = styleOf(node, spec[0]);
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
      body.appendChild(ctrlRow(spec[1], input, clear));
    });

    // ---- المسافات
    if (!isImg) {
    [["letter-spacing", "تباعد الحروف", -3, 16, .5, "px"],
     ["line-height", "ارتفاع السطر", .8, 3.2, .05, ""]].forEach(function (spec) {
      var cur = parseFloat(styleOf(node, spec[0]));
      if (isNaN(cur)) {
        cur = spec[0] === "line-height"
          ? Math.round((computedPx(node, "lineHeight") /
              (computedPx(node, "fontSize") || 16)) * 100) / 100
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
      body.appendChild(ctrlRow(spec[1], r, out));
    });
    }

    // ---- الصور: تبديل وقص
    if (isImg) {
      var setSrc = function (url) {
        node.setAttribute("src", url);
        /* srcset بيكسب على src — لو سبناها الصورة القديمة تفضل ظاهرة
           والمستخدم يفتكر إن التبديل مااشتغلش. */
        node.removeAttribute("srcset");
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
        var src = node.getAttribute("src") || "";
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
        var cur = parseFloat(styleOf(node, spec[0]));
        if (isNaN(cur)) {
          cur = spec[0] === "width" ? 100 : computedPx(node, "borderTopLeftRadius") || 0;
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
        body.appendChild(ctrlRow(spec[1], r2, out2));
      });
    }

    // ---- الموضع الدقيق
    var pos = (block.layout && block.layout[state.selEl]) || { dx: 0, dy: 0 };
    var nudge = el("div", "ed-nudge");
    [["→", -1, 0], ["←", 1, 0], ["↑", 0, -1], ["↓", 0, 1]].forEach(function (d) {
      var btn = el("button", "ed-btn ed-btn--sm", d[0]);
      btn.type = "button";
      btn.title = "تحريك ربع خطوة";
      btn.addEventListener("click", function () {
        snapshot();
        var p2 = layoutOf(block, state.selEl);
        p2.dx = Math.round(((p2.dx || 0) + d[1] * 0.25) * 100) / 100;
        p2.dy = Math.round(((p2.dy || 0) + d[2] * 0.25) * 100) / 100;
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
    body.appendChild(ctrlRow(
      "الموضع (" + (pos.dx || 0) + "٪ / " + (pos.dy || 0) + "٪)", nudge));

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
    body.appendChild(ctrlRow("أضف", addRow));

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
    wrap.open = true;
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
    wrap.open = true;

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
        btn.addEventListener("click", function () {
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

  function renderSettingsPane() {
    var box = refs.settingsPane;
    if (!box) return;
    var host = $("[data-settings-fields]", box);
    if (!host) return;
    host.replaceChildren();
    host.appendChild(buildGroups(
      SCHEMA.settings_fields,
      function (s) { return state.doc.settings[s.key]; },
      function (s, v) { state.doc.settings[s.key] = v; markDirty(); requestPreview(); }
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

  function setLoading(on) {
    if (refs.loading) refs.loading.classList.toggle("is-on", !!on);
  }

  var requestPreview = debounce(function () {
    if (!previewReady) return;
    var fdoc = frameDoc();
    if (!fdoc) return;

    setLoading(true);
    fetch(META.urls.preview, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify({ document: state.doc })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setLoading(false);
        if (!data || !data.ok) { toast("تعذّر تحديث المعاينة.", "error"); return; }
        applyPreview(data);
      })
      .catch(function () {
        setLoading(false);
        toast("تعذّر الاتصال بالخادم لتحديث المعاينة.", "error");
      });
  }, 280);

  /* تحديث الشاشة الافتتاحية داخل المعاينة.

     الافتتاحية أخت لـ.lb-stage مش جواه، فتبديل الـstage لوحده كان
     بيسيبها زي ما هي — يعني تغيّر نص الافتتاحية أو صورتها وماتشوفش
     أي فرق غير لما تقفل المحرر وتفتحه تاني. */
  function applyIntro(fdoc, html) {
    if (html === undefined) return;          // نسخة سيرفر قديمة — ما نلمسش حاجة
    var current = fdoc.querySelector(".lb-intro");
    // الافتتاحية اتقفلت من الإعدادات
    if (!html) { if (current) current.remove(); return; }

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

  function applyPreview(data) {
    drag = null;
    clearGuides();
    var fdoc = frameDoc();
    if (!fdoc) return;
    var stage = fdoc.querySelector(".lb-stage");
    if (!stage) return;

    var footer = stage.querySelector(".lb-footer");
    stage.innerHTML = data.html;
    if (footer) stage.appendChild(footer);

    if (fdoc.body) fdoc.body.setAttribute("style", data.cssVars || "");
    fdoc.documentElement.setAttribute("dir", data.direction || "rtl");

    stage.className = "lb-stage" +
      (data.maxWidth >= 1100 ? " lb-stage--full" : "") +
      (data.pattern && data.pattern !== "none" ? " lb-pattern lb-pattern--" + data.pattern : "");

    applyIntro(fdoc, data.intro);

    bindPreviewInteractions();
    if (refs.frame.contentWindow && refs.frame.contentWindow.__lbRefresh) {
      refs.frame.contentWindow.__lbRefresh();
    }
    if (refs.blockCount) refs.blockCount.textContent = data.blockCount + " قسم";
    if (state.selected) highlightInPreview(state.selected);
  }

  /** ربط النقر والتحرير المباشر داخل المعاينة. */

  // ==========================================================
  // سحب النصوص بالماوس داخل المعاينة
  // ==========================================================
  // النموذج "مقيَّد": العنصر بيتزحزح جوّه قسمه بإزاحة نسبية (cqw) مش
  // بإحداثيات مطلقة. يعني الموضع بيتقاس مع الشاشة تلقائياً، ومفيش حاجة
  // اسمها "ظبطه على الديسكتوب فطلع غلط على الموبايل".

  var MAX_X = (SCHEMA.layout_max && SCHEMA.layout_max.x) || 45;
  var MAX_Y = (SCHEMA.layout_max && SCHEMA.layout_max.y) || 40;
  var SNAP = 1.2;          // cqw — قرب كده يلزق على الصفر
  var THRESHOLD = 4;       // px — أقل من كده تبقى ضغطة مش سحب
  var drag = null;

  function layoutOf(block, slot) {
    if (!block.layout) block.layout = {};
    if (!block.layout[slot]) block.layout[slot] = { dx: 0, dy: 0 };
    return block.layout[slot];
  }

  function applySlotOffset(node, dx, dy) {
    node.style.setProperty("--dx", dx + "cqw");
    node.style.setProperty("--dy", dy + "cqw");
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

  function showGuides(fdoc, node, snapX, snapY, dx, dy) {
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
    badge.textContent = dx.toFixed(1) + "% , " + dy.toFixed(1) + "%";
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
      if (e.button !== 0) return;
      var block = findBlock(blockId);
      if (!block || block.locked) return;

      var fdoc = frameDoc();
      var pos = layoutOf(block, slot);
      drag = {
        node: node, block: block, slot: slot, fdoc: fdoc,
        x0: e.clientX, y0: e.clientY,
        dx0: pos.dx || 0, dy0: pos.dy || 0,
        unit: stageWidth(fdoc) / 100,
        moved: false, pointerId: e.pointerId
      };
      try { node.setPointerCapture(e.pointerId); } catch (err) {}
    });

    node.addEventListener("pointermove", function (e) {
      if (!drag || drag.node !== node) return;
      var mx = e.clientX - drag.x0, my = e.clientY - drag.y0;

      if (!drag.moved) {
        if (Math.abs(mx) < THRESHOLD && Math.abs(my) < THRESHOLD) return;
        drag.moved = true;
        node.classList.add("lb-dragging");
        node.removeAttribute("contenteditable");   // منع الكتابة أثناء السحب
        if (state.selected !== drag.block.id) selectBlock(drag.block.id);
      }
      e.preventDefault();

      // في RTL محور الصفحة مقلوب، لكن transform دايماً فيزيائي — فبنسيبه زي ما هو
      // Shift بيبطّأ الحركة للربع عشان الظبط الدقيق
      var fine = e.shiftKey ? 0.25 : 1;
      var dx = drag.dx0 + (mx / drag.unit) * fine;
      var dy = drag.dy0 + (my / drag.unit) * fine;

      var snapX = Math.abs(dx) < SNAP, snapY = Math.abs(dy) < SNAP;
      if (snapX) dx = 0;
      if (snapY) dy = 0;
      dx = Math.max(-MAX_X, Math.min(MAX_X, dx));
      dy = Math.max(-MAX_Y, Math.min(MAX_Y, dy));

      drag.dx = Math.round(dx * 100) / 100;
      drag.dy = Math.round(dy * 100) / 100;
      applySlotOffset(node, drag.dx, drag.dy);
      showGuides(drag.fdoc, node, snapX, snapY, drag.dx, drag.dy);
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
      var ARROWS = { ArrowRight: [-1, 0], ArrowLeft: [1, 0],
                     ArrowUp: [0, -1], ArrowDown: [0, 1] };
      var dir = ARROWS[e.key];
      if (dir) {
        e.preventDefault();
        var step = e.shiftKey ? 1 : 0.25;
        snapshot();
        var pos = layoutOf(block, state.selEl);
        pos.dx = Math.round(((pos.dx || 0) + dir[0] * step) * 100) / 100;
        pos.dy = Math.round(((pos.dy || 0) + dir[1] * step) * 100) / 100;
        applySlotOffset(node, pos.dx, pos.dy);
        markDirty();
        renderInspector();
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

  function bindPreviewInteractions() {
    var fdoc = frameDoc();
    if (!fdoc) return;

    // اختيار القسم بالضغط عليه
    fdoc.querySelectorAll("[data-block]").forEach(function (node) {
      node.addEventListener("click", function (e) {
        var slot = e.target.closest("[data-slot]");
        if (slot && slot.isContentEditable) return;
        /* المستمع ده في مرحلة الالتقاط، يعني بيتنفّذ **قبل** عناصر
           القسم. من غير السطر ده كان بيوقف الضغطة قبل ما توصل لعنصر
           القالب المستورد، فاختيار العنصر كان مستحيل. */
        if (e.target.closest && e.target.closest(".lb-custom [data-move]")) return;
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

    // السحب مش للنصوص بس — أي جزء متعلّم بـdata-move يتحرك (الأزرار،
    // الصور، الخريطة، العدّاد، الفورم…). النصوص متعلّمة تلقائياً في القوالب.
    fdoc.querySelectorAll("[data-move]").forEach(function (node) {
      if (node.hasAttribute("data-slot")) return;      // اتربط فوق
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

  function isTextUnit(n) {
    if (!TEXTY[n.tagName]) return false;
    if (!(n.textContent || "").trim()) return false;
    for (var i = 0; i < n.children.length; i++) {
      if (!INLINE[n.children[i].tagName]) return false;
      // ابن سطري جوّاه عناصر تانية = تركيب مش نص بسيط
      if (n.children[i].children.length) return false;
    }
    return true;
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

  function bindCustomHtml(fdoc) {
    fdoc.querySelectorAll('[data-block-type="custom_html"]').forEach(function (sec) {
      var root = sec.querySelector(".lb-custom");
      if (!root) return;
      var blockId = sec.getAttribute("data-block");
      var block = findBlock(blockId);
      if (!block || !("html" in block.props)) return;

      var writeBack = function () {
        block.props.html = serializeCustom(root);
        markDirty();
      };

      /* الترتيب مهم:
         ١) نعلّم وحدات النص الأول.
         ٢) اللي جوّه وحدة نص بيتشال من اللعبة خالص — لا اختيار ولا سحب.
            من غير الخطوة دي، <span> جوّه <h1> بتخطف الاختيار من العنوان
            وتخلّيك تحرّك علامة & لوحدها بدل الاسم.
         ٣) ترقيم وربط. */
      var all = movableIn(root);
      all.forEach(function (n) {
        if (isTextUnit(n) && !(n.parentElement &&
            n.parentElement.closest("[data-lb-text]"))) {
          n.setAttribute("data-lb-text", "1");
        }
      });

      var nodes = all.filter(function (n) {
        return !(n.parentElement && n.parentElement.closest("[data-lb-text]"));
      });

      var next = 1;
      nodes.forEach(function (n) {
        if (!n.getAttribute("data-move")) {
          while (root.querySelector('[data-move="el-' + next + '"]')) next++;
          n.setAttribute("data-move", "el-" + next);
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
          n.addEventListener("dblclick", function () {
            n.setAttribute("contenteditable", "plaintext-only");
            n.classList.add("lb-el-typing");
            n.focus();
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
            writeBack();
          });
          n.addEventListener("input", writeBack);
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
          state.fromPreview = true;
          if (state.selected !== blockId) selectBlock(blockId);
          else renderInspector();
          state.fromPreview = false;
          markSelectedEl();
        };
        n.addEventListener("pointerdown", function () {
          state.selEl = n.getAttribute("data-move");
        });
        n.addEventListener("click", pick);

        bindSlotDrag(n, blockId, n.getAttribute("data-move"), writeBack);
      });

      // أول ما نضيف data-move لازم نحفظها، وإلا هتضيع مع أول حفظ
      if (nodes.length) writeBack();
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
            (!hasFeature(spec.feature) ? "غير متاح في الباقة" : (spec.description || ""))));
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
    btn.disabled = true;
    btn.textContent = "جارٍ القص…";

    fetch(META.urls.crop, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      credentials: "same-origin",
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        btn.disabled = false;
        btn.textContent = "اقصّ";
        if (!d.ok) { toast(d.error || "تعذّر القص.", "error"); return; }
        ASSETS.unshift(d.asset);
        if (cropState.onDone) cropState.onDone(d.asset.url);
        closeModal($("[data-crop-modal]"));
        toast("اتقصّت الصورة.", "ok");
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "اقصّ";
        toast("تعذّر الاتصال بالخادم.", "error");
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
      btn.addEventListener("click", function () {
        if (pickCallback) pickCallback(m.url);
        closeModal(refs.assetModal);
      });
      // preload=none: ما ننزّلش كل الملفات لمجرد إن النافذة اتفتحت
      var media = doc.createElement(pickKind === "audio" ? "audio" : "video");
      media.controls = true;
      media.preload = "none";
      media.src = m.url;
      if (m.poster) media.poster = m.poster;
      row.appendChild(btn);
      row.appendChild(media);
      box.appendChild(row);
    });
    box.appendChild(el("p", "ed-lib-label", "أو ارفع ملفاً لهذه الدعوة وحدها"));
  }

  function renderAssets() {
    var box = refs.assetGrid;
    box.replaceChildren();
    renderMusicLibrary();
    var images = ASSETS.filter(function (a) { return a.kind === (pickKind || "image"); });
    if (!images.length) {
      box.appendChild(el("p", "ed-empty",
        (PICKER_TEXT[pickKind] || PICKER_TEXT.image).empty));
      return;
    }
    images.forEach(function (a) {
      var btn = el("button", "ed-asset");
      btn.type = "button";
      btn.title = a.name;
      if (a.kind === "image") {
        btn.style.backgroundImage = 'url("' + (a.thumb || a.url) + '")';
      } else {
        // الفيديو والصوت مالهمش صورة مصغّرة — نوري أيقونة والاسم
        btn.classList.add("ed-asset--file");
        btn.appendChild(el("span", "ed-asset-ico", a.kind === "video" ? "▶" : "♪"));
        btn.appendChild(el("span", "ed-asset-name", a.name || ""));
      }
      btn.addEventListener("click", function () {
        if (pickCallback) pickCallback(a.url);
        closeModal(refs.assetModal);
      });
      box.appendChild(btn);
    });
  }

  function uploadFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      var fd = new FormData();
      fd.append("file", file);
      fetch(META.urls.upload, {
        method: "POST",
        headers: { "X-CSRFToken": csrf() },
        credentials: "same-origin",
        body: fd
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.ok) { toast(data.error || "فشل رفع الملف.", "error"); return; }
          ASSETS.unshift(data.asset);
          renderAssets();
          toast("تم رفع «" + data.asset.name + "».", "ok");
          if (pickCallback) {
            pickCallback(data.asset.url);
            closeModal(refs.assetModal);
          }
        })
        .catch(function () { toast("تعذّر رفع الملف.", "error"); });
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

  var scheduleAutosave = debounce(function () {
    if (state.dirty && !state.saving) save(true);
  }, 2600);

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
