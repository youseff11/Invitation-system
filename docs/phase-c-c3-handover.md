# C3 — مكتبة الأصول والمفضلة والخطوط (handover)

الفرع: `claude/goofy-gauss-64e26f` (متفرّع من `REACT` بعد C1). الخطة العامة في `docs/phase-c-editor.md`.
القديم (`editor.js`، `editor.html`، `views.py`) اتقرا كمرجع بس ومااتلمسش.

## اللي اتعمل

**الباك إند** — `system/api/editor_assets.py` (متسجّل بسطر في `system/api/urls.py`)، staff بس، كل المسارات
تحت `/api/v1/editor/`. بيستورد الدوال القديمة (`_upload_asset_for_editor`, `_crop_asset_for_editor`,
`_delete_asset_for_editor`, `_bulk_delete_assets_for_editor`, `_favorites_json`, `_font_payload`) ويحوّل
ردودها من `{ok:false,error}` لـ`{error:{code,message,fields}}` بنفس كود الحالة (400 `validation_error`،
403 `forbidden`، 404 `not_found`، 409 `asset_in_use`).

| المسار | الرد |
|---|---|
| `GET editor/{invitations\|templates}/<id>/assets/` | `{assets:[{id,url,thumb,source,name,kind,used}]}` آخر ٣٠٠ (نفس `editor._assets`) |
| `POST …/assets/upload/` (multipart `file` + `thumb` اختياري) | 201 `{asset:{…,used:false,width,height,seconds}}` |
| `POST …/assets/crop/` `{asset, box:{x,y,w,h}}` نِسَب ٠..١ | 201 `{asset}` (أصل جديد، الأصل الأول يفضل) |
| `POST …/assets/delete/` `{asset, kind}` | 200 `{deleted:id}` — 409 لو مستخدم |
| `POST …/assets/bulk-delete/` `{assets:[…], kind}` | 200 `{deleted:[…]}` — الكل أو لا شيء، 409 لو واحد مستخدم |
| `GET editor/favorites/` | `{favorites:[{id,name,blockType,block}]}` |
| `POST editor/favorites/` `{name, block}` | 201 `{favorite}` (`block` بيعدّي على `normalize_document`) |
| `DELETE editor/favorites/<id>/` | `{deleted:id}` |
| `POST editor/fonts/` (multipart: `file`, `name`, `family`, …) | 201 `{font}` — `weight/style/order/is_active` ليهم افتراضي |

- `kind` في الحذف `image` أو `video` بس (الدالة القديمة بتقيّده)؛ أصول الصوت **مفيش حذف ليها** — زي القديم.
- الأصل «مستخدم» = مذكور في مستند قالب أو دعوة (الفهرس `DocumentMediaKey`، بيتحدّث وقت الحفظ).
- الملكية: أصل دعوة تانية → 403، وقالب مايقصّش/مايمسحش أصل دعوة.

**الفرونت إند** — `features/editor/assets/` + `fields/media.tsx`:

| الملف | الدور |
|---|---|
| `api.ts` | استدعاءات الـAPI؛ `uploadAsset` بـXHR عشان تقدّم الرفع (الفيديو لحد ٤٠ ميجا) |
| `AssetLibrary.tsx` | نافذة المكتبة: شبكة، فلتر استخدام (صور)، علامة «مستخدم»، رفع بتقدّم + سحب وإفلات، تحديد متعدد وحذف جماعي، مكتبة الموسيقى (`lib.music`) ومعرض الافتتاحيات (`lib.intros`) |
| `CropDialog.tsx` + `cropMath.ts` | القص من `asset.source`، نِسَب 1:1 و4:5 و3:2 و16:9، الحساب كله دوال نقية |
| `FavoritesDialog.tsx` + `favorites.ts` | `★ المفضلة` (تبويب الأقسام) و`☆ حفظ كمفضلة` (رأس الـinspector) + `addFavoriteToDocument` |
| `FontUpload.tsx` | «رفع خط جديد» تحت حقل الخط (متوصّل في `FontBody`) |
| `video.ts` | `makeClientVideoThumbnail` (أول فريم JPEG لما السيرفر معندوش ffmpeg) + التقاط غلاف الافتتاحية |
| `Modal.tsx`, `errors.ts`, `util.ts` | نافذة مشتركة (Portal جوّه `.ed-root`)، نص الخطأ للمستخدم، أدوات صغيرة |
| `fields/media.tsx` | `registerField('image'\|'media')`: معاينة + رابط + «اختر أو ارفع» + «قصّ الصورة» |
| `styles/assets.css` | إضافات صغيرة (علامة مستخدم، تقدّم الرفع، مقابض القص). الباقي في `editor.css` المنقول |

تعديلات صغيرة على ملفات C1 (إضافات فقط): `store.ts` (`setAssets/addAsset/removeAssets/addFont`)، `types.ts`
(`AssetKind`, `FavoriteRow`, حقول اختيارية في `AssetRow`)، `fields/index.ts` (تسجيل `MediaField`)،
`fields/basic.tsx` (`FontBody` + `<FontUpload>` بس)، `panels/BlocksPanel.tsx` (`FavoritesButton`)،
`panels/InspectorPanel.tsx` (`SaveFavoriteButton`). الترجمة في `i18n/locales/{ar,en}/editorAssets.json`.

## قرارات تستاهل تتعرف

- **النوافذ بتترسم بـPortal جوّه `.ed-root`**: متغيّرات `--e-*` متعرّفة عليه، وعلى الموبايل لوحة الجنب `transform`
  فأي `position: fixed` جواها بيتحسب منها (اتجرّبت على ٣٧٥px).
- **فيديو الافتتاحية**: اختيار `intro_video` بيكتب `settings.intro_poster` (غلاف المكتبة، أو أول فريم) في **نفس خطوة
  التراجع** (نفس مفتاح الدمج `setting:intro_video`)، واللصق اليدوي لرابط بيمسح الغلاف. الربط في `media.tsx`
  (`INTRO_VIDEO_KEY`) — تبويب الإعدادات (C2) مايحتاجش غير `FieldRenderer`.
- **«مستخدم» ممكن يكون قديم**: الأصل اللي اتحفظ في مستند بعد ما القايمة اتحمّلت. الحذف بيرجع 409، والواجهة
  بتعرض رسالة السيرفر وتعمل `fetchAssets` لتحديث العلامات. أي أصل `used` مفيش ليه زر حذف ولا تحديد.
- **مقابض القص بتتحرك بالاتجاه الفعلي (يمين/شمال)**: أسماء `nw/ne/…` في `editor.css` مبنية على `inset-inline-*`
  فبتتقلب في RTL (المقبض اللي على اليمين كان بيتصرّف كأنه الشمال). `assets.css` بيثبّتها فيزيائياً.
- **مصغّرة الفيديو**: السيرفر بيرجّع رابط الملف نفسه لو مفيش مصغّرة، فالواجهة بتعتبرها «مفيش» (`realThumb`)
  وتعرض `<video>` بدل صورة مكسورة.
- **الاسم بنافذة مش `window.prompt`** في «حفظ كمفضلة». الحذف لسه بـ`window.confirm` زي باقي المحرر.
- **رسائل الخطأ**: لو السيرفر بعت `fields` (خط بامتداد غلط…) بنعرضها بدل «راجع البيانات».
- **المفضلة** حمولتها تقيلة (مئات الكيلوبايت) فبتتجاب وقت فتح النافذة بس (react-query).

## الاختبارات

- Django: `system/tests/test_api_editor_assets.py` — ٤٨ اختبار: الحماية (401/403/CSRF/405/404) لكل المسارات،
  القايمة (سقف ٣٠٠، `used`، عزل الدعوات)، الرفع (صورة/فيديو+فريم/صوت، نوع غلط، صورة تالفة، حدّ الحجم للصورة
  والفيديو، octet-stream بامتداد فيديو)، القص (ملكية، 404، أصل غير مقروء)، الحذف الفردي والجماعي (409،
  الكل أو لا شيء، ملكية)، المفضلة والخطوط. بتكتب في `MEDIA_ROOT` مؤقت.
- vitest: `assets/*.test.ts(x)` و`fields/media.test.tsx` (مجموع المشروع ٢٤٨).

## اللي اتجرّب في المتصفح (نسخة قاعدة تجريبية + `MEDIA_ROOT` مؤقت، منفذ ٨٢٠٣)

رفع صورة واختيارها تلقائياً في حقل صورة القسم (والمعاينة اتحدّثت) · قصّها بسحب مقبض (الناتج ٦٩٩×٤٦٥ من أصل
١٢٠٠×٨٠٠) · رفض حذف أصل مستخدم (409 + رسالة + ظهور علامة «مستخدم») · حذف أصل غير مستخدم · رفع ٣ ملفات مرة
واحدة (الأول يتختار) وحذف اتنين بالتحديد الجماعي · رفع فيديو WebM (اتولّد في المتصفح) بفريمه المرسل كمصغّرة ·
Escape · حفظ قسم فيديو كمفضلة ثم إضافته بمعرّف جديد ثم حذف المفضلة · رفع خط TTF من حقل الخط (ظهر في القايمة
واتطبّق وطلع `@font-face` في المعاينة) ورفض ملف بامتداد غلط برسالة السيرفر · نافذة المكتبة على ٣٧٥px.
(حقل الخط اتجرّب بإظهار حقول `editor_hidden` مؤقتاً — التعديل اتشال ومش في الـcommit.)

**ما اتجرّبش في المتصفح:**
- **اختيار الموسيقى** وغلاف **فيديو الافتتاحية** (`music_url`/`intro_video` في تبويب الإعدادات اللي لسه C2) —
  مغطّيين بـvitest بس (`media.test.tsx`، `AssetLibrary.test.tsx`).
- رفع ملف أكبر من حد السيرفر فعلياً (٨ ميجا للصورة/٤٠ للفيديو) — بالاختبارات فقط، مع `mock.patch` للحدود.
- الرفع بالسحب والإفلات على النافذة، والقص باللمس (اتكتب بنفس المنطق ومااتجرّبش على جهاز لمس).
- مكتبة الأصول لمحرر **القالب** (`/templates/<id>/editor`) — الـAPI متغطّي بالاختبارات والواجهة بتستعمل
  نفس الكود بـ`mode` مختلف.

## متابعات (مش عيوب في C3)

- `MediaBody` في `fields/basic.tsx` بقى مش متسجّل (محله `MediaField`) — يتشال في تنضيف C5.
- الحذف الجماعي/الفردي للصوت مش موجود (الدالة القديمة مابتدعمهوش).
- المفضلة من غير بحث أو ترقيم صفحات (٣ عناصر في القاعدة التجريبية).
- القديم عنده خلل: `uploadFontFile` مابيبعتش `order` فالنموذج بيرفض — الـAPI الجديد بيكمّله. مااتلمسش القديم.
