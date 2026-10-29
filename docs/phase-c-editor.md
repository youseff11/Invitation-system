# المرحلة C — المحرر البصري على React

الهدف: نقل محرر الدعوات والقوالب (`static/js/editor.js` ~6,900 سطر + `editor.css` + `editor.html`)
لـReact بنفس السلوك، ومن غير ما نلمس القديم (يفضل شغال كاحتياطي لحد ما نوصل للتكافؤ).
قواعد العمل العامة في `docs/react-migration.md`؛ الملف ده بيخص المحرر بس.

## ازاي المحرر القديم شغال (من القراءة، مش افتراض)

- صفحة واحدة بتاخد كل حاجة كـJSON blobs: `editor-schema` (من `blocks.editor_schema()`)، `editor-document`،
  `editor-meta` (فيه `urls`)، `editor-features`، `editor-assets` (≤300)، `editor-fonts`، `editor-intros`،
  `editor-music`، `editor-favorites`.
- المعاينة = `<iframe>` بيحمّل صفحة الدعوة بـ`editable=True`. كل تعديل → `POST preview` بالمستند الحالي
  (غير المحفوظ) → السيرفر يرجّع HTML للمسرح + `cssVars/fontCss/layoutCss/zeroCss/sharedCss/...` والمحرر
  بيبدّل `.lb-stage` جوّه الـiframe (`swapStage`). ده السبب إن المعاينة دايماً مطابقة للنشر.
- الحفظ: `POST save` بـ`{document, fields}`؛ `fields` بتعدّي على `InvitationSettingsForm` (الأخطاء بترجع
  `{ok:false, errors}`)، والمستند بيعدّي على `blocks.normalize_document`. محرر القالب بيحفظ المستند بس
  ويمسح `preview_render`.
- حالة المحرر: `doc` + `selected` + `history/future` (حد ٦٠) + `dirty`؛ حفظ تلقائي ~2.6 ث (مش وقت الكتابة)؛
  Ctrl+S / Ctrl+Z / Ctrl+Y؛ Delete يحذف القسم المحدد.
- حوالي **٤٠٪ من `editor.js` (سطور ~1777–2927 و~4065–5684)** هي تعديل العناصر جوّه الأقسام المستوردة
  (custom_html/Tilda): تحديد عنصر، سحب بإزاحات `layout`، نسخ/لصق، طبقات، كتابة النص رجوعاً للكود
  (`codeWriteBack`). ده أصعب جزء ومحتاج مراجعة مرجعية قبل ما يتكتب.

## قرارات المعمارية

1. **مسار المحرر داخل نفس الـSPA، برّه `DashboardLayout`:** `/app/dashboard/invitations/:id/editor` و
   `/app/dashboard/templates/:id/editor` تحت `RequireStaff` بس، `lazy()` من `features/editor/` عشان
   حزمة اللوحة ما تكبرش. (تعديل صغير واحد في `app/routes.tsx`: `...editorRoutes`.)
2. **المعاينة = `<iframe>` على entry تالت في Vite (`editor-frame-main.tsx`)** مش داخل صفحة المحرر:
   عزل CSS الدعوة عن CSS المحرر، وبدون ما نكبّر حزمة الضيف (فيها ٨٢.٩ KB gz أصلاً). الـframe بيستورد
   `BlockView` و`Intro` و`invite.css` الموجودين. الصفحة الأم بتبعت للـframe بـ`postMessage` والـframe
   بيرد بأحداث. shell جديد بسيط + مسار في `Core/urls.py` (نفس نمط `spa_invite`).
3. **الحمولة:** `build_payload(..., editable=True)` في `system/api/invite_render.py` (ده كود Phase B
   مش قديم، فنعدّله): الأقسام المخفية تفضل (بكلاس `lb--hidden`)، علامة `gated` للأقسام خارج الباقة،
   `data-editable`، وعناصر الـoverlay الفاضية تبان كصناديق. `BlockData` يزيد عليها `hidden/gated`،
   و`Frame` يرسم `.lb-gate`. الـRSVP يفضل demo. **مفيش تعديل في `renderer.py`.**
4. **API جديد تحت `/api/v1/editor/` (`system/api/editor*.py`، `require_staff`)،** بيستورد الـhelpers
   القديمة بدل ما يكرّرها (`_upload_asset_for_editor`, `_crop_asset_for_editor`, `_asset_usage_map`,
   `_delete_asset_for_editor`, `_bulk_delete_assets_for_editor`, `_font_library_json`, `_favorites_json`)
   ويحوّل ردودها لشكل `{error:{code,message,fields}}`. أضيفوا الـhelpers دي لقايمة الحاجات اللي تتنقل قبل
   حذف القديم (Phase D).
5. **الحالة:** Zustand store واحد (`features/editor/store.ts`) + دوال نقية للمستند (`doc.ts`:
   إضافة/نسخ/حذف/ترتيب/تعديل prop) بـvitest. التاريخ بـ`structuredClone`. المعاينة بتتأجّل (debounce)
   وبتتلغى لو وصل طلب أحدث.
6. **السكيما:** `GET /api/v1/editor/schema/` (ثابتة لكل نشر، `Cache-Control: private` + ETag). الـinspector
   بيتبني منها: `group` → قسم قابل للطي، `feature` → قفل، `editor_hidden` → مخفي، نوع الحقل → مكوّن من
   **سجل مكوّنات** (`fields/registry.ts`) — ده نقطة التوسعة اللي بتخلّي C2/C3/C4 يشتغلوا متوازي.
7. **أي نص ظاهر** في `locales/{ar,en}/editor.json` بنفس المفاتيح. RTL وخصائص منطقية. ألوان من `tokens.css`.

## الخطوات

| # | المحتوى | يعتمد على | الملكية |
|---|---|---|---|
| **C1** | API أساسي (`schema`, `bootstrap`, `preview`, `save`) + `editable` في الحمولة + entry الـframe + store/تاريخ/حفظ تلقائي/اختصارات + قايمة الأقسام (dnd-kit: ترتيب، إخفاء، تكرار، حذف، إضافة) + inspector بالحقول العامة (text/textarea/number/range/color/select/toggle/url/date/align/list) + تحديد من المعاينة + تبديل الجهاز | — | `features/editor/` (core), `system/api/editor.py` |
| **C2** | تبويبات التصميم/البيانات/الإعدادات، حقول متخصصة (font, gradient, icon, html منسّق، text-style gear)، الافتتاحية والموسيقى | C1 | `features/editor/panels/` |
| **C3** | مكتبة الأصول: رفع، قص، حذف جماعي، مُنتقي الصور/الصوت/الفيديو، المفضلة، الخطوط المخصصة | C1 | `features/editor/assets/`, `system/api/editor_assets.py` |
| **C4a** | تعديل النص جوّه المعاينة، سحب `layout` للنصوص/الافتتاحية، تبويب الترجمة | C1 | `features/editor/inline/`, `features/editor/translate/` |
| **C4b** | تعديل عناصر الأقسام المستوردة (طبقات، نسخ/لصق، write-back للكود) — **أكبر مخاطرة** | C4a | `features/editor/imported/` |
| **C5** | وضع محرر القالب (`template_mode`)، حفظ كقالب، كود متقدّم/استيراد، تحويل روابط اللوحة للمحرر الجديد، تكافؤ Playwright (`editor-invitation`, `editor-template` ديسكتوب)، تنضيف | C2–C4 | الباقي |

C1 بجلسة واحدة (المسار الحرج). بعد ما يندمج: C2 + C3 متوازيين (٢ جلسة بالكتير — راجع قيد الاستخدام)، ثم C4a،
ثم C4b، ثم C5. كل جلسة تعمل commit متكرر وملف handover في آخر الشغل.

## تعريف «خلصت» لكل خطوة

- `npm run typecheck && npm run lint && npm test && npm run build` ✅ واختبارات Django للمسارات الجديدة
  (نجاح، خطأ تحقق، غير staff، CSRF) ✅.
- للمحرر نفسه: فتح دعوة حقيقية (نسخة قاعدة تجريبية)، تعديل → المعاينة تتحدّث، حفظ، إعادة تحميل، المستند
  هو نفسه. مقارنة عدد الأقسام/الـHTML المتوقع مع `api_preview` القديم لنفس المستند.
- المتصفح الداخلي: تحقق بالعين ولقطة؛ ما يتقالش «اشتغل» من غير تجربة فعلية.

## المخاطر المعروفة

- `requestAnimationFrame` مش بيشتغل في المتصفح الداخلي لو مفيش تركيز — الاختبار البصري للسحب يحتاج Playwright.
- المعاينة بتنفّذ runtime القوالب المستوردة (Tilda) — لازم تتعاد تهيئته عند كل تبديل للمسرح (`restartTemplateRuntime`
  في القديم) ومفيش قالب مستورد في القاعدة التجريبية: نحتاج مستند اختبار صناعي.
- الترجمة: السيرفر بيرجّع للغة الأساسية لو مفيش ترجمة، والحمولة لازم تقول اللغة اللي اتعرضت **فعلاً** (`lang`).
- حجم المستند (القوالب المستوردة لحد ٣ ميجا): الحفظ والمعاينة بيبعتوا المستند كله — نحتفظ بنفس السلوك ونقيس.

---

## حالة التنفيذ — C1 (اتنفّذ 2026-10-24)

**اللي اشتغل ومتجرّب في المتصفح** (دعوة وقالب حقيقيين على نسخة قاعدة تجريبية):
فتح المحرر · قايمة الأقسام بالسحب (dnd-kit) والإخفاء والتكرار والحذف والإضافة · الـinspector من السكيما
(text/textarea/number/range/color/select/font/icon/align/toggle/image-url/list) · المعاينة الحية (iframe) بالمستند
غير المحفوظ · التحديد من القايمة ومن المعاينة · الأقسام المخفية باهتة وخارج الباقة بتنبيه · تراجع/إعادة
(Ctrl+Z/Y) مع دمج الكتابة المتتالية · حفظ يدوي (Ctrl+S) وتلقائي بعد ٢٫٥ ث · إعادة التحميل ترجّع المحفوظ ·
تبديل الجهاز · درج اللوحة على الموبايل · وضع القالب (من غير تبويب البيانات).

**الروابط:** `/app/dashboard/invitations/<id>/editor` و`/app/dashboard/templates/<id>/editor`.
روابط اللوحة (`editorPath`، `editorUrl` من الـAPI) لسه بتفتح المحرر القديم — بتتحوّل في C5.

**الملفات:** `features/editor/` (`store.ts` الحالة+التاريخ، `doc.ts` عمليات المستند، `autosave.ts`،
`fields/` سجل الحقول، `panels/`، `frame/` الإطار والمعاينة، `styles/editor.css` منقول من القديم بنفس أسماء `ed-*`)،
`system/api/editor.py` + `editor_page.py`، `templates/spa/editor_frame.html`، entry `src/editor-frame-main.tsx`.
تعديلات على الأساس (بأقل شكل): `system/api/urls.py` و`Core/urls.py` (`/editor-frame/`)،
`app/routes.tsx` (`editorRoutes`)، `vite.config.ts` (entry تالت)، `invite_render.build_payload(editable=…)`،
`invite/blocks/Frame.tsx`+`Rsvp.tsx` (`Gate`) و`invite/types.ts` (`hidden`/`gated`).

**الاختبارات:** Django `system.tests.test_api_editor` (28) + `test_api_invite` (65، من غير تراجع)؛ vitest ٥٣ للمحرر
(المجموع ١٦٩)؛ typecheck/lint/build ✅.

**نقاط التوسعة لـC2–C4:** `registerField(type, Component)` في `fields/` (استبدال حقل صورة/خط/html)،
`useEditor.commit(change, {coalesce})` لأي تعديل جديد في المستند، رسائل الإطار في `types.ts` (`FromFrame`/`ToFrame`)
و`frame/FrameApp.tsx` لأي تفاعل داخل المعاينة، تبويبات اللوحة في `EditorShell.tsx` (`LaterNotice` مكان C2/C4a).

**فجوات معروفة (مش عيوب في C1 — مكانها الخطوات الجاية):**
- الافتتاحية والموسيقى وruntime القوالب المستوردة مش بتتعرض في الـframe (C2/C5).
- المعاينة بتبقى من قاعدة البيانات لبيانات المناسبة (الأسماء/التاريخ) زي القديم: التعديل بيبان بعد الحفظ التلقائي.
- الكتابة في حقل نص بتتحدّث بعد ~٠٫٣ ث + رد السيرفر (مفيش `livePatchText` لسه — C4a).
- `html` حقل textarea عادي، و`image`/`media` رابط بس (الاختيار/الرفع/القص = C3)، وحقول `ts_*` (ترس تنسيق النص) مخفية (C2).
- تبويبات التصميم/البيانات/الترجمة/إعدادات بتعرض رابط للمحرر القديم (`LaterNotice`).
- الحذف بـ`window.confirm` زي القديم.
- مفيش parity e2e للمحرر لسه (`editor-invitation`/`editor-template` في `e2e/pages.ts` جاهزين، ينضافوا في `ported.ts` مع C5).
- رد المعاينة بيتأخر على المستندات التقيلة (السيرفر بيرندر المستند كله) — لو بقت مشكلة نضيف تخزين مؤقت بالبصمة.
