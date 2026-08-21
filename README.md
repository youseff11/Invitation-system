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

٤٣ اختباراً تغطي التنقية، بنية المستند، الـrenderer، الصلاحيات، واجهة المحرر،
تفعيل الباقات، وحماية RSVP.

للفحص البصري في متصفح حقيقي (يتطلب Playwright وسيرفر يعمل على المنفذ 8010):

```bash
python _verify.py
```

---

## ملاحظة مهمة للصيانة

**لا تكتب أبداً متغيّر Django داخل كتلة `<script>`.**

كل JavaScript في ملفات ستاتيك مستقلة (`static/js/*.js`)، وكل البيانات تصل
للمتصفح عبر `{{ x|json_script:"id" }}`. السبب: النسخة السابقة من المشروع
كُسرت بالكامل لأن أداة تنسيق HTML أعادت ترتيب `{{ design_json|safe }}` على
عدة أسطر، وDjango لا يقرأ `{{ }}` متعدد الأسطر — فتحوّل المحرر إلى صفحة ميتة.

للسبب نفسه: **تعليقات `{# #}` تعمل على سطر واحد فقط**. لأي تعليق متعدد الأسطر
استخدم `{% comment %}...{% endcomment %}`.

وفي قوالب البلوكات: كلها ملفوفة بـ `{% localize off %}` لأن اللغة العربية
تحوّل الفاصلة العشرية (`1.9` → `1,9`) وتكسر قيم CSS.

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
│   ├── blocks.py               # سجل البلوكات — قلب المحرر
│   ├── renderer.py             # blocks -> HTML
│   ├── sanitize.py             # منقّي HTML
│   ├── qrcodes.py
│   ├── models.py  views.py  forms.py  urls.py  admin.py
│   ├── templatetags/invite.py  # الزخارف والأيقونات
│   ├── data/golden_classic.py  # القالب الأصلي
│   └── tests/test_core.py
├── templates/
│   ├── blocks/                 # قالب عرض لكل نوع بلوك
│   ├── editor/editor.html
│   ├── invitations/render.html
│   ├── dashboard/  public/  auth/
└── static/
    ├── css/  invite.css · editor.css · site.css
    └── js/   invite.js  · editor.js  · site.js
```
