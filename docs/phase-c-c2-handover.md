# C2 — تبويبات التصميم/البيانات/الإعدادات + ترس النص + الافتتاحية (handover)

اتنفّذ 2026-10-24 على فرع `claude/gracious-bun-3a7ce6` (مبني على `REACT` بعد C1). commits محلية، **ما اتعملش push**.
الملف ده مستقل عن `phase-c-editor.md` (C3 له handover لوحده).

## اللي اتعمل

| # | الميزة | فين |
|---|---|---|
| 1 | تبويب **التصميم** = `schema.theme_fields` → `useEditor.setTheme` | `panels/ThemePanel.tsx` (بيستخدم `FieldGroups`) |
| 2 | تبويب **الإعدادات** = `schema.settings_fields` → `setSetting` (موسيقى، افتتاحية، تمرير، مشاركة) | `panels/SettingsPanel.tsx` |
| 3 | تبويب **البيانات** (دعوة بس): title, eventType, nameOne/Two, eventDate, venue, address, mapUrl, whatsapp, status, password, expiresAt, slug + الرابط العام ورابط المتابعة | `panels/DataPanel.tsx`، `panels/slug.ts` (`cleanSlug`, `copyText`) |
| 4 | **المعاينة تعكس بيانات المناسبة غير المحفوظة**: `POST …/invitations/<id>/preview/` بيقبل `fields` اختياري | `system/api/editor.py` (`_overlay_unsaved_fields`)، `api.ts` (`fetchPreview(…, signal, fields)`)، `frame/PreviewPane.tsx` |
| 5 | **ترس تنسيق النص**: حقول `ts_*`/`style_of` المخفية بتظهر كترس جنب text/url/date/datetime/textarea/html، في `FieldGroups` وجوّه عناصر القوائم (`ListBody`) | `fields/textStyle.tsx` + `fields/textStyleIndex.ts`، و`gear` prop في `FieldRenderer` (`fields/registry.tsx`) |
| 6 | **الافتتاحية في الإطار**: `FrameApp` بيرسم `payload.intro` بـ`features/invite/Intro.tsx`، وزر «الافتتاحية» في `.ed-canvas-bar` يعيد فتحها | `frame/FrameApp.tsx`، `frame/IntroButton.tsx`، `frame/introBus.ts` |
| 7 | `LaterNotice` اتشال من التصميم/البيانات/الإعدادات (فضل للترجمة = C4a) | `EditorShell.tsx` |

نصوص الواجهة في `i18n/locales/{ar,en}/editorSettings.json` (`t('editorSettings.…')`)، والـCSS في `styles/settings.css` (استيراد من `EditorShell.tsx`).

### تفاصيل تستاهل تتعرف
- **`statusChoices`**: الـbootstrap بيرجّع `statusChoices: [{value,label}]` من `Invitation.STATUS_CHOICES` (محرر الدعوة بس)؛ `Bootstrap.statusChoices?` في `types.ts`، ومخزّنة في `store.statusChoices`.
- **معاينة بـ`fields`**: السيرفر بيشغّل `InvitationSettingsForm` على نسخة الذاكرة وبيتجاهل الأخطاء (الحقل الغلط بيفضل بقيمته المحفوظة)، ومفيش `save()` أبداً. القيم المفاتيح camelCase زي الحفظ. محرر القالب مابيبعتش `fields`.
- **الترس**: `buildStyleIndex(specs)` بيجمّع حقول `style_of` بترتيب `style_role` (font، color، size، weight، align، ls، lh، … `zz_extra` آخر شيء — نفس `TEXT_STYLE_ORDER` في القديم). اللوحة بتتبني عند الفتح بس (قايمة الخطوط تقيلة). `get/set` بيشتغلوا على حقل التنسيق نفسه، فترس عنصر في قايمة بيكتب في العنصر مش القسم.
- **الافتتاحية**: `Intro` بيقرا إعداداته مرة عند التركيب، فالإطار بيعيد تركيبه (`key`) مع كل تعديل في محتواه — **إلا بعد ما المستخدم يفتحها** (لمسة/زر/عدّاد/نهاية فيديو): ساعتها بتفضل مقفولة مهما اتعدّل، والزر يرجّعها بآخر محتوى. لو اتقفلت من الإعدادات وفُعّلت تاني بتظهر من جديد. الزر لو الافتتاحية مقفولة بيطلّع تنبيه «فعّل شاشة افتتاحية…» (قبل ما يبعت للإطار).
- **رابط الدعوة (slug)**: نفس `bindSlugField` — الخانة الظاهرة مسودة، `cleanSlug` عند الخروج من الحقل، «تغيير الرابط» (أو Enter) → تحقق ≥٣ → نفس الرابط؟ → `window.confirm` → `setEventField('slug')` + حفظ فوري. لو الحفظ فشل (محجوز/مكرر…) بنرجّع الرابط القديم في الستور (عشان الحفظات الجاية ماتفشلش بسببه) ونعرض الخطأ تحت الحقل، ولو مكانش فيه تعديلات تانية بنرجّع الحالة «محفوظ» (عشان تحذير الخروج ما يطلعش من غير سبب). لو فيه حفظة تلقائية شغالة، بنستناها وبعدين نحفظ.
- **إصلاح صغير في `store.ts` (C1)**: `save()` كانت بتكتب `res.slug` فوق `fields.slug` حتى لو المستخدم غيّر الرابط **أثناء** الحفظ — دلوقتي بتكتبه بس لو لسه نفس قيمة بداية الحفظ.
- `types.ts`: رسالة جديدة `ToFrame` = `{type:'lb-editor:intro'}`. `fetchPreview` بقى ليه معامل سادس اختياري (`fields`).

## الاختبارات
- Django `system.tests.test_api_editor` (33، +5 جدد: `statusChoices`، المعاينة بالـfields من غير حفظ، التاريخ/القاعة، تجاهل الأخطاء، `fields` اختياري/مفاتيح مجهولة) + `test_api_invite` (65).
- vitest: `fields/textStyle.test.tsx`، `panels/settingsPanels.test.tsx` (Theme/Settings/Data + slug)، `panels/slug.test.ts`، `frame/FrameIntro.test.tsx`، `frame/PreviewPane.test.tsx` (fields في الطلب + زر الافتتاحية)، `api.test.ts`. المجموع 211 (كان 169).
- `npm run typecheck && npm run lint && npm test && npm run build` ✅ (lint: تحذيرات react فقط، نفس نمط C1).

## اتجرّب فعلاً في المتصفح (نسخة قاعدة تجريبية، دعوة وقالب)
- التصميم: تغيير لون الإبراز (`--accent` في الإطار + عناصر بتستخدمه اتغيّرت) وخط العناوين (`'Cairo'`) ظهروا في المعاينة؛ الحفظ التلقائي + إعادة التحميل رجّعوا القيم.
- البيانات: تغيير الاسم الأول → المعاينة اتحدّثت **والسيرفر لسه بالقيمة القديمة** (اتأكدت بـGET قبل الحفظ التلقائي)؛ تغيير التاريخ نفس الشيء («السبت — 15 مارس 2031»).
- الرابط: تنضيف عند الخروج، تأكيد، حفظ فوري، تحديث الرابط العام ورابط المتابعة؛ رابط محجوز (`admin`) → خطأ تحت الحقل + تنبيه + رجوع للقديم.
- الترس: في الإعدادات (نص الافتتاحية: لون أحمر ظهر في الافتتاحية)، وفي خصائص قسم نصي (حجم العنوان 38 → 60 اتغيّر في المعاينة)، وجوّه عنصر «نص فوق القسم» (خط/لون/حجم/ظل).
- الافتتاحية: بتظهر في الإطار، الزر يعيدها بعد فتحها بآخر ألوان/نصوص، وتختفي لما تتقفل من الإعدادات ويطلع تنبيه لو ضغطت الزر وهي مقفولة.
- محرر القالب: من غير تبويب البيانات، التصميم/الإعدادات شغالين، الترجمة لسه `LaterNotice`.
- موبايل (375): من غير أي overflow أفقي (قياس JS؛ لقطة الشاشة بتتقصّ في الـpane).

## ما اتجرّبش / فجوات
- Playwright parity (`editor-*` في `e2e/ported.ts`) — C5.
- الواجهة الإنجليزية (ملف `en/editorSettings.json` موجود وفيه نفس المفاتيح بس ما اتشافش في المتصفح)، والمظهر الفاتح، وبقية المتصفحات.
- أوضاع الافتتاحية التانية: فيديو، زر تشغيل، كود الافتتاحية (`code`)، عدّاد `seconds` — `Intro.tsx` نفسه عليه اختبارات Phase B (فتح بلمسة/عدّاد/فيديو يدوي) بس ما اتجرّبوش جوّه إطار المحرر، والقاعدة التجريبية افتتاحيتها نص + زر بس.
- الموسيقى (`music_url` والمشغّل) مش بتتعرض في الإطار (C5)؛ اختيار الملف نفسه = C3 (بيستبدل حقل `media` عبر `registerField`).
- من القديم ومش منقول: زرار «اقفل الكل» للمجموعات، `applyIntroOptionLocally` (تأثيرات الافتتاحية من غير رحلة للسيرفر — كل تعديل بياخد رحلة معاينة عادية ~٣٠٠ مللي)، حالة فتح/قفل المجموعات بتضيع عند التنقل بين التبويبات (نفس C1).
- حقول `intro_guest_*` و`intro_play_bg_color` مخفية (`editor_hidden`) من غير `style_of` في السكيما — فمش ظاهرة ولا ليها ترس هنا (نفس القديم: مفيش مكان ليها في اللوحة).
- خانة اللون النصية (`#rrggbb`) بتتعرض مقلوبة بصرياً في الواجهة العربية (bidi) — سلوك C1 الموروث، محتاج `dir="ltr"` في `ColorBody` (`fields/basic.tsx`).

## للدمج مع C3
ملفات مشتركة اتعدّلت عندي (كلها إضافات صغيرة): `EditorShell.tsx` (imports + الـpanes + `IntroButton`)، `fields/registry.tsx` (`gear` prop)، `fields/ListField.tsx` (ترس العناصر)، `panels/FieldGroups.tsx` (`useStyleScope`/`gearFor`)، `store.ts` (`statusChoices` + شرط الـslug في `save`)، `types.ts` (`statusChoices?`، رسالة `lb-editor:intro`)، `api.ts` (`fetchPreview` + `fields`)، `frame/FrameApp.tsx` و`frame/PreviewPane.tsx`، `system/api/editor.py`. لو C3 غيّر `fetchPreview` أو `Bootstrap` فالدمج بسيط (سطر أو اتنين). `registerField('media'|'image'|'font', …)` بتاع C3 مش بيتأثر: الترس بيلفّ الجسم من برّه عبر `FieldRenderer` ومابيلمسش السجل.
