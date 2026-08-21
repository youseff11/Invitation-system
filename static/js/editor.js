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

  var state = {
    doc: readJSON("editor-document", { theme: {}, settings: {}, blocks: [] }),
    selected: null,
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
      case "image": {
        var thumb = el("div", "ed-image-thumb");
        thumb.setAttribute("role", "button");
        thumb.tabIndex = 0;
        function paint(v) {
          if (v) {
            thumb.style.backgroundImage = 'url("' + String(v).replace(/"/g, "%22") + '")';
            thumb.textContent = "";
          } else {
            thumb.style.backgroundImage = "";
            thumb.textContent = "＋";
          }
        }
        paint(value);
        var urlInput = el("input", "ed-input");
        urlInput.type = "text";
        urlInput.placeholder = "أو الصق رابط صورة";
        urlInput.value = value == null ? "" : value;
        urlInput.addEventListener("input", function () {
          paint(urlInput.value);
          setValue(urlInput.value);
        });
        var pickBtn = el("button", "ed-btn ed-btn--sm", "اختر أو ارفع صورة");
        pickBtn.type = "button";
        function open() {
          openAssetPicker(function (url) {
            urlInput.value = url;
            paint(url);
            setValue(url);
          });
        }
        pickBtn.addEventListener("click", open);
        thumb.addEventListener("click", open);
        thumb.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        });

        var side = el("div", "ed-image-side");
        side.appendChild(urlInput);
        side.appendChild(pickBtn);
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
      row.appendChild(el("span", "ed-block-name", spec.label));
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
    title.appendChild(el("strong", null, spec.label));
    head.appendChild(title);

    var back = el("button", "ed-btn ed-btn--sm", "الأقسام ↩");
    back.type = "button";
    back.addEventListener("click", function () { switchTab("blocks"); });
    head.appendChild(back);
    box.appendChild(head);

    if (spec.description) box.appendChild(el("p", "ed-hint", spec.description));
    if (!hasFeature(spec.feature)) {
      var warn = el("p", "ed-hint", "هذا القسم غير متاح في باقة العميل الحالية ولن يظهر للضيوف.");
      warn.style.color = "var(--e-danger)";
      box.appendChild(warn);
    }

    box.appendChild(buildGroups(
      spec.props,
      function (s) { return block.props[s.key]; },
      function (s, v) { block.props[s.key] = v; markDirty(); requestPreview(); }
    ));

    if (spec.style && spec.style.length) {
      box.appendChild(buildGroups(
        spec.style,
        function (s) { return block.style[s.key]; },
        function (s, v) { block.style[s.key] = v; markDirty(); requestPreview(); },
        false
      ));
    }

    box.appendChild(buildLayoutGroup(block, spec));
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

    var labels = {};
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
        pos.dx = 0; pos.dy = 0;
        var n = frameDoc() && frameDoc().querySelector(
          '[data-block="' + block.id + '"] [data-slot="' + slot + '"]');
        if (n) applySlotOffset(n, 0, 0);
        pruneLayout(block);
        snapshot(); markDirty(); renderInspector();
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

  function bindSlotDrag(node, blockId, slot) {
    node.addEventListener("pointerdown", function (e) {
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
      var dx = drag.dx0 + mx / drag.unit;
      var dy = drag.dy0 + my / drag.unit;

      var snapX = Math.abs(dx) < SNAP, snapY = Math.abs(dy) < SNAP;
      if (snapX) dx = 0;
      if (snapY) dy = 0;
      dx = Math.max(-MAX_X, Math.min(MAX_X, dx));
      dy = Math.max(-MAX_Y, Math.min(MAX_Y, dy));

      drag.dx = Math.round(dx * 100) / 100;
      drag.dy = Math.round(dy * 100) / 100;
      applySlotOffset(node, drag.dx, drag.dy);
      showGuides(drag.fdoc, node, snapX, snapY, drag.dx, drag.dy);
    });

    function finish(cancel) {
      if (!drag || drag.node !== node) return;
      var d = drag; drag = null;
      try { node.releasePointerCapture(d.pointerId); } catch (err) {}
      clearGuides();
      node.classList.remove("lb-dragging");

      if (!d.moved) {                       // ضغطة عادية — رجّع التحرير الكتابي
        node.setAttribute("contenteditable", "plaintext-only");
        return;
      }
      if (cancel) {
        applySlotOffset(node, d.dx0, d.dy0);
        layoutOf(d.block, d.slot).dx = d.dx0;
        layoutOf(d.block, d.slot).dy = d.dy0;
      } else {
        var pos = layoutOf(d.block, d.slot);
        pos.dx = d.dx != null ? d.dx : d.dx0;
        pos.dy = d.dy != null ? d.dy : d.dy0;
        snapshot();
        markDirty();
      }
      pruneLayout(d.block);
      node.setAttribute("contenteditable", "plaintext-only");
      if (state.selected === d.block.id) renderInspector();
    }

    node.addEventListener("pointerup", function () { finish(false); });
    node.addEventListener("pointercancel", function () { finish(true); });
    node.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drag) { e.preventDefault(); finish(true); }
    });
  }

  function resetBlockLayout(blockId) {
    var block = findBlock(blockId);
    if (!block || !block.layout) return;
    var fdoc = frameDoc();
    if (fdoc) {
      Object.keys(block.layout).forEach(function (slot) {
        var n = fdoc.querySelector('[data-block="' + blockId + '"] [data-slot="' + slot + '"]');
        if (n) applySlotOffset(n, 0, 0);
      });
    }
    delete block.layout;
    snapshot();
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
        e.preventDefault();
        e.stopPropagation();
        selectBlock(node.getAttribute("data-block"));
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
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
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

  function openAssetPicker(cb) {
    pickCallback = cb;
    renderAssets();
    openModal(refs.assetModal);
  }

  function renderAssets() {
    var box = refs.assetGrid;
    box.replaceChildren();
    var images = ASSETS.filter(function (a) { return a.kind === "image"; });
    if (!images.length) {
      box.appendChild(el("p", "ed-empty", "لم تُرفع أي صور بعد."));
      return;
    }
    images.forEach(function (a) {
      var btn = el("button", "ed-asset");
      btn.type = "button";
      btn.title = a.name;
      btn.style.backgroundImage = 'url("' + a.url + '")';
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
    // على الموبايل اللوحة درج منزلق. نفتحه فقط لما المستخدم يطلب تبويب بنفسه،
    // مش عند التهيئة — وإلا بيغطي المعاينة من أول ثانية.
    if (reveal !== false && refs.panel) setPanel(true);
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
