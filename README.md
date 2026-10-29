# ليلة — منصة الدعوات الرقمية

منصة Django لدعوات الزفاف والمناسبات الرقمية. المشروع `Core`، والتطبيق `system`.

---

## أهم فكرة في المشروع

**لا يوجد شكل دعوة مكتوب بالكود.** كل دعوة وكل قالب عبارة عن مستند JSON:

```jsonc
{
  "version": 1,
  "theme":    { /* ألوان، خطوط، استدارة، نقشة، اتجاه… */ },
  "settings": { /* موسيقى، شاشة افتتاحية، بيانات المشاركة */ },
  "blocks": [
    {
      "id": "hero-a1b2c3",
      "type": "hero",
      "visible": true,
      "props": { /* الحقول الخاصة بالغلاف */ },
      "style": { /* خلفية، مسافات، محاذاة، حركة… */ }
    }
  ]
}
```

يترتب على ذلك ثلاثة أشياء:

1. **المحرر يبني واجهته تلقائياً** من `system/blocks.py`. إضافة حقل جديد للمحرر =
   سطر واحد هناك، بدون لمس أي HTML أو JavaScript.
2. **كل شيء قابل للتعديل** — كل نص، لون، خط، صورة، مسافة، وحركة، لكل قسم على حدة.
3. **إضافة قالب بدون كود**: صمّم الدعوة في المحرر ثم اضغط **«احفظ كقالب»**.

---

## التشغيل

### Windows

```bat
cd /d "D:\Progects\invitation system\Core"
python -m venv venv
venv\Scripts\activate
python -m pip install -r requirements.txt
set DJANGO_DEBUG=1
py manage.py migrate
py manage.py seed_demo
py manage.py runserver
```

### Linux / macOS

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export DJANGO_DEBUG=1
python manage.py migrate
python manage.py seed_demo
python manage.py runserver
```

ثم افتح `http://127.0.0.1:8000/`.

بيانات الدخول بعد `seed_demo`: **admin / Leila!Admin2026** — غيّرها فوراً بـ
`python manage.py changepassword admin`.

---

## المسارات

| المسار | الوظيفة |
|---|---|
| `/` | الموقع العام: القوالب، الباقات، نموذج الطلب |
| `/templates/` | معرض القوالب مع فلاتر ومعاينة حية |
| `/templates/<slug>/preview/` | معاينة قالب كدعوة تجريبية |
| `/login/` | تسجيل دخول فريق العمل |
| `/dashboard/` | لوحة الإحصائيات |
| `/dashboard/invitations/` | مكتبة الدعوات |
| `/dashboard/invitations/new/` | إنشاء دعوة |
| `/dashboard/invitations/<id>/editor/` | **المحرر البصري** |
| `/dashboard/invitations/<id>/guests/` | الضيوف وتأكيدات الحضور |
| `/dashboard/templates/` | مكتبة القوالب |
| `/dashboard/orders/` | الطلبات |
| `/i/<slug>/` | الرابط العام المستقل للدعوة |
| `/i/<slug>/qr.svg` | رمز QR للدعوة |
| `/admin/` | إدارة البيانات |

---

## المحرر

| اللوحة | ماذا تفعل |
|---|---|
| **الأقسام** | ترتيب بالسحب، إخفاء ◉، تكرار ⧉، حذف ✕، إضافة قسم |
| **الخصائص** | كل حقول القسم المحدَّد — تُبنى تلقائياً من الـschema |
| **التصميم** | الثيم العام: ألوان، خطوط، استدارة، نقشة، عرض الدعوة |
| **البيانات** | بيانات المناسبة التي تملأ الأقسام تلقائياً |
| **الإعدادات** | الموسيقى، الشاشة الافتتاحية، بيانات المشاركة |

- **معاينة حية** تعرض ما سيراه الضيف بالضبط — لأنها ناتجة عن نفس الـrenderer.
- **الضغط على أي قسم داخل المعاينة** يحدّده في اللوحة.
- **النصوص قابلة للكتابة مباشرة** داخل المعاينة.
- **Ctrl+S** حفظ، **Ctrl+Z / Ctrl+Y** تراجع وإعادة، وحفظ تلقائي بعد ٢.٦ ثانية.
- **موبايل / تابلت / ديسكتوب** للمعاينة.

### إضافة قالب جديد بدون كتابة كود

افتح أي دعوة في المحرر → صمّمها كما تريد → **«احفظ كقالب»** → يظهر في
`/dashboard/templates/` ويصبح متاحاً لكل دعوة جديدة. البيانات الشخصية لا تُنقل معه.

---

## البلوكات المتاحة

`hero` · `text` · `quote` · `hosts` · `countdown` · `details` · `agenda` ·
`location` · `gallery` · `image` · `video` · `rsvp` · `wishes` · `qr` ·
`share` · `divider` · `spacer` · `buttons` · `custom_html`

### إضافة نوع بلوك جديد

ملفان فقط:

1. `system/blocks.py` — استدعِ `register("my_block", "اسمه", icon="✦", props=[...])`
2. `templates/blocks/my_block.html` — قالب العرض

المحرر سيعرف البلوك الجديد وحقوله تلقائياً، بدون أي تعديل في JavaScript.

---

## الأمان

- `SECRET_KEY` و `DEBUG` و `ALLOWED_HOSTS` من متغيرات البيئة. المشروع
  **يرفض الإقلاع** في الإنتاج بدون `DJANGO_SECRET_KEY`.
- كل مستند قادم من المتصفح يمر عبر `blocks.normalize_document()` — أي بلوك
  أو قيمة غير معروفة تُحذف أو تُستبدل بالافتراضي.
- حقول `html` تمر عبر `system/sanitize.py` (قائمة سماح صريحة).
- روابط `javascript:` و `data:` مرفوضة.
- كل صفحات اللوحة والـAPI محمية بـ `is_staff`.
- RSVP: تحديد معدّل، مصيدة روبوتات، منع تكرار، وحد المرافقين يُقرأ من البلوك لا من المدخلات.
- رفع الملفات: نوع المحتوى مقيّد، والصور تُفتح بـ Pillow للتحقق من صحتها.
- عدّاد المشاهدات يستخدم `F()` لتجنّب التسابق.

---

## الاختبارات

```bash
DJANGO_DEBUG=1 python manage.py test system
```

اختبارات الـAPI والمحرر وإدارة البيانات والتحويل، بالإضافة لاختبارات الـrenderer والتنقية واستيراد القوالب.
(٣ اختبارات قديمة في `test_core.py` بتفشل من قبل حذف الموقع القديم — CSS scope وsanitize وتخزين CSS المستورد.)

للفحص البصري في متصفح حقيقي (يتطلب Playwright وسيرفر يعمل على المنفذ 8010):

```bash
python _verify.py
```

---

## ملاحظة مهمة للصيانة

الواجهة كلها React (`frontend/`) والموقع الكلاسيك (قوالب Django + `static/js` و`static/css`) اتحذف.
قوالب `templates/blocks/` بس لسه موجودة لأن ‎`renderer.py`‎ و‎`api/invite_render.py`‎ بيستخدموها
في رسم أقسام الدعوة. في قوالب البلوكات: كلها ملفوفة بـ `{% localize off %}` لأن اللغة العربية
تحوّل الفاصلة العشرية (`1.9` → `1,9`) وتكسر قيم CSS، وتعليقات `{# #}` تعمل على سطر واحد فقط
(لأي تعليق متعدد الأسطر استخدم `{% comment %}...{% endcomment %}`).

---

## ما لم يُنفَّذ بعد

- مستورد قوالب ZIP/HTML يحوّل الملف المرفوع إلى blocks قابلة للتعديل
- مسح QR عند مدخل القاعة وتسجيل الدخول
- بوابة عميل يدخل منها ويتابع دعوته بنفسه
- الدفع الإلكتروني
- تبديل اللغة عربي/إنجليزي في واجهة الضيف

---

## البنية

```text
Core/
├── manage.py
├── Core/settings.py            # إعدادات مبنية على متغيرات البيئة
├── system/
│   ├── models.py  admin.py  forms.py  urls.py
│   ├── blocks.py               # سجل البلوكات — قلب المحرر
│   ├── renderer.py             # blocks -> HTML
│   ├── sanitize.py             # منقّي HTML
│   ├── services.py  files.py   # خدمات مشتركة (أصول، دعوات) + مسارات الملفات (QR، robots، sitemap)
│   ├── spa.py                  # صفحة الـshell اللي بيتحمّل فيها React
│   ├── api/                    # واجهة JSON تحت /api/v1/ (بما فيها إدارة البيانات)
│   ├── templatetags/invite.py  # الزخارف والأيقونات
│   ├── data/golden_classic.py  # القالب الأصلي
│   └── tests/
├── templates/
│   ├── blocks/                 # قالب عرض لكل نوع بلوك
│   └── spa/                    # shell التطبيق وصفحة الدعوة ومعاينة المحرر
├── frontend/                   # React + TypeScript (Vite)
└── static/images  img          # صور ثابتة (الناتج المبني في static/app)
```
python manage.py fix_posters --apply

---

## واجهة React (قيد الترحيل)

الموقع بيتحوّل تدريجياً من قوالب Django + جافاسكريبت يدوي إلى تطبيق React
(`frontend/` — Vite + TypeScript). Django بيفضل الباك إند: النماذج، الأدمن،
معالجة الصور والفيديو، التصدير، وواجهة JSON تحت `/api/v1/` (`system/api/`).

**التحويل النهائي اتعمل (Phase D):** الافتراضي دلوقتي إن React هو اللي على `/`
(`SPA_BASENAME` فاضي). وللرجوع مؤقتاً للموقع القديم على الجذر (وReact على `/app/`) حطّ في `.env`:

```
SPA_BASENAME=/app
```

في الوضع الافتراضي:

- نفس روابط الدعوات اللي اتبعتت بتفضل شغّالة: `/i/<slug>/` والرابط الشخصي `/i/<slug>/g/<token>/`
  والتصريح `…/pass/` والعميل `…/client/<token>/` والقاعة `…/venue/<token>/` وصور QR.
- أي رابط قديم تحت `/app/…` بيتحوّل (301) للمسار الجذري.
- `robots.txt` و`sitemap.xml` وصور QR وفيديو المشاركة والأدمن و`/api/v1/` بيفضلوا من Django.
- المسارات في `system/urls.py`، واختباراتها في `system/tests/test_cutover.py`.
- أمر `manage.py test` بيثبّت `SPA_BASENAME=/app` بغض النظر عن `.env` (الاختبارات القديمة محتاجاه).

### تشغيل التطوير (طرفيتين)

```bash
# 1) Django مع سيرفر Vite
VITE_DEV_SERVER=http://localhost:5173 DJANGO_DEBUG=1 python manage.py runserver

# 2) Vite (HMR)
cd frontend && npm install && npm run dev
```

افتح `http://localhost:8000/`. Django هو اللي بيقدّم الصفحة (الـ`<head>` وOG
بيتبنوا على السيرفر)، والسكربتات بتتحمّل من Vite.

### البناء والفحص

```bash
cd frontend
npm run build       # يطلّع static/app/ (بيقراه Django من manifest.json)
npm run typecheck && npm run lint && npm test
```

### اختبارات التطابق مع الموقع القديم (Playwright)

```bash
cd frontend && npx playwright install chromium
python e2e/dump_routes.py                                   # معرّفات حقيقية → e2e/routes.local.json
E2E_USER=… E2E_PASSWORD=… TARGET=react npx playwright test # بيقارن الصفحات المنقولة باللقطات
```

اللقطات المرجعية للموقع القديم محلية في `frontend/e2e/baseline/` (مش في Git: بتتصوّر من قاعدة بيانات حقيقية والـrepo عام). جلسة على worktree تقدر تقراها من الـcheckout الرئيسي بـ `BASELINE_DIR=<المسار>`. كل صفحة بتتنقل بتقلب
`ported` لـ `true` في `frontend/e2e/pages.ts`. لإعادة توليدها من الموقع القديم:
`TARGET=legacy npx playwright test --project=parity --update-snapshots`.
استخدم **قاعدة بيانات تجريبية** مش الحقيقية.


cd frontend
npm run ship

cd ..
git commit -am "..."
git push