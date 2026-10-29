# ترحيل الموقع لـ React — دليل العمل

الهدف: الفرونت إند كله React (TypeScript). Django بيفضل الباك إند (النماذج، الأدمن،
الصور والفيديو، Excel، QR) وبيقدّم واجهة JSON تحت `/api/v1/`.

**الموقع القديم (قوالب Django + JS اليدوي) اتحذف (Phase D خلصت).** بقى في تاريخ Git بس
(آخر commit فيه الموقع القديم: `ef1bd9f`)؛ اقراه من هناك كمرجع للسلوك لو احتجت.

## البنية

```
frontend/src/
├── app/            routes.tsx (تجميع فقط) · App.tsx · boot.ts
├── api/            client.ts (fetch + CSRF + ApiError) · hooks.ts/types.ts (الأساس المشترك)
├── components/     مكونات مشتركة (Layout, Header, RequireStaff…)
├── features/
│   ├── public/     B1 — الموقع العام
│   ├── dashboard/  B4 — لوحة التحكم (DashboardLayout + صفحاتها)
│   ├── guests/     B2 — الضيوف، check-in، القاعة، العميل، التصريح
│   └── invite/     B3 — عارض الدعوة
├── i18n/locales/{ar,en}/   core.json + ملف لكل ميزة
├── pages/          صفحات الأساس (الرئيسية التجريبية، الدخول، 404)
└── styles/         tokens.css · base.css · app.css (أساس مشترك)
system/api/         views.py/serializers.py/http.py (أساس) + public.py dashboard.py guests.py invite.py
```

## قواعد التوازي (عشان الجلسات ما تتعارضش)

أربع جلسات (B1 … B4). كل جلسة بتملك مجلد ميزتها وملفاتها في الجدول، وتكتب ملفات **جديدة** جواه:

| الجلسة | الملكية |
|---|---|
| **B1** (الموقع العام) | `features/public/`, `components/Header.tsx`/`Layout.tsx`/`ThemeToggle.tsx`/`LanguageSwitch.tsx`, `pages/HomePage.tsx`/`LoginPage.tsx`/`NotFoundPage.tsx`, `system/api/public.py`, `locales/*/public.json`, `system/tests/test_api_public.py` |
| **B4** (لوحة التحكم) | `features/dashboard/`, `system/api/dashboard.py`, `locales/*/dashboard.json`, `system/tests/test_api_dashboard.py` |
| **B2** | `features/guests/`, `system/api/guests.py`, `locales/*/guests.json`, `system/tests/test_api_guests.py` |
| **B3** | `features/invite/`, `system/api/invite.py`, `locales/*/invite.json`, `system/tests/test_api_invite.py`، وكمان إعداد الـentry المنفصل (`vite.config.ts`, `templatetags/vite.py`, `system/spa.py`, `Core/urls.py`) |

- **ممنوع تعدّل:** ملفات جلسة تانية، `app/routes.tsx`، `api/client.ts`، `system/api/views.py`/`serializers.py`/`http.py`
  (الأساس). محتاج تغيير في الأساس؟ اعمله في أصغر شكل ممكن وانبّه في الـcommit message.
- **الملفات المشتركة المتوقعة** (تعارض صغير عند الدمج، بنحلّه): `package.json`/`package-lock.json`
  (مكتبات جديدة)، `e2e/ported.ts` (كل جلسة في بلوكها).
- **الـCSS:** كل ميزة ملف CSS خاص بيها بيتعمله import من مكوناتها. متحطّش في `app.css`.
  استخدم متغيّرات `tokens.css` (`var(--accent)` …) ومتحطّش ألوان ثابتة.
- **الـi18n:** أي نص ظاهر للمستخدم في `locales/ar/<ميزة>.json` و`locales/en/<ميزة>.json`
  بنفس المفاتيح (اختبار `locales.test.ts` بيفشل لو اختلفوا) وتستخدمه بـ`t('<ميزة>.…')`.
- **الاتجاه:** RTL افتراضي. استخدم خصائص منطقية (`margin-inline-start`, `inset-inline-end`…) مش `left/right`.
- **تقليل الحركة:** احترم `prefers-reduced-motion` (اللقطات المرجعية بتتصوّر بيه).

## واجهة الـAPI

- الأساس: `system/api/http.py` — `@api_view("GET")`، `json_body`, `ApiError`, `require_staff`.
- النجاح: الجسم هو البيانات نفسها. الخطأ: `{"error": {"code", "message", "fields"?}}` بكود 4xx.
- مفاتيح JSON بـcamelCase (`displayName`). الواجهة بتعتمد على أنواع TypeScript مكتوبة يدوي
  في `features/<ميزة>/types.ts` بتطابق الـserializer.
- أي مسار غير GET محمي بـCSRF تلقائياً (العميل بيبعت `X-CSRFToken`). مسارات اللوحة: `require_staff`.
- **صلاحيات بالرمز** (القاعة، العميل، الضيف): التحقق على السيرفر بنفس شروط الـview القديم بالظبط
  (طول الرمز، تبعيته للدعوة، حالة النشر). متضعفش أي شرط.
- أعد استخدام منطق الـmodels والـhelpers الموجود (`system/models.py`, `forms.py`, `guestexport.py`,
  `qrcodes.py`…) بدل ما تكتبه من جديد. الـview القديم هو المرجع للسلوك (التحقق، الرسائل، الحدود).
- اكتب اختبارات Django لكل مسار (نجاح، خطأ، صلاحيات، CSRF). أضف لكل مسار حماية غير مصرّح به.

## نقل صفحة — الخطوات

1. اقرا الـview والـtemplate القديمين (والـCSS/JS اللي بيستخدمهم) وافهم السلوك والحالات.
2. اكتب مسار الـAPI + اختباره.
3. اكتب الصفحة React + hook بيجيب البيانات (TanStack Query) + CSS الميزة + نصوص i18n.
4. سجّل المسار في `features/<ميزة>/routes.tsx`.
5. قارن بصرياً بالموقع القديم: اضف id الصفحة في `e2e/ported.ts` ثم شغّل:
   `TARGET=react npx playwright test --project=parity <filter>` — وصلّح الفروق.
6. اختبارات Vitest للمنطق والمكونات المهمة.

## التشغيل والفحص

```bash
# تطوير — منافذ مخصصة لكل جلسة: B1 8101/5201، B2 8102/5202، B3 8103/5203، B4 8104/5204
VITE_DEV_SERVER=http://localhost:5201 DJANGO_DEBUG=1 python manage.py runserver 8101   # Django
cd frontend && VITE_PORT=5201 DJANGO_ORIGIN=http://127.0.0.1:8101 npm run dev            # Vite
# أو من غير Vite: npm run build ثم Django لوحده (بيقرا static/app/manifest.json)
# فحص قبل أي commit
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
python manage.py test system.tests.test_api system.tests.<ملف-ميزتك>
```

**اختبارات القديم:** الحزمة الكاملة (`manage.py test system`) فيها فشل قديم مش من شغلنا
(~12 فشل و2 خطأ). متصلّحهومش. شغّل اختباراتك + `system.tests.test_api` وبس.

اللقطات المرجعية للموقع القديم في `frontend/e2e/baseline/`. تشغيل Playwright محتاج Django شغّال
وحساب فريق عمل تجريبي: `E2E_USER` و`E2E_PASSWORD` (اعمل نسخة من `db.sqlite3` لقاعدة تجريبية —
**ماتشغّلش الاختبارات على القاعدة الحقيقية ولا تدخل بياناتها في commit أو لقطة**). المعرّفات
والرموز الحقيقية بتتولّد في `e2e/routes.local.json` (مش في Git) بـ`python frontend/e2e/dump_routes.py`.

## تعريف «خلصت»

- كل الصفحات المطلوبة شغّالة على `/app/...` ومتطابقة بصرياً مع القديم (فرق بكسل ≤ 2% أو فرق مبرَّر
  ومكتوب) على موبايل وديسكتوب، عربي وإنجليزي، فاتح وداكن لو الصفحة عامة.
- `typecheck` و`lint` و`vitest` و`npm run build` ✅، واختبارات Django بتاعتك ✅.
- commits واضحة على فرع الجلسة (من غير push) — الدمج في `REACT` بيتم بعدين.
