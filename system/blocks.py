"""سجل البلوكات — قلب المحرر البصري.

كل قالب ودعوة عبارة عن مستند (document) بالشكل التالي::

    {
      "version": 1,
      "theme":  { ... },          # الهوية البصرية العامة
      "blocks": [ {block}, ... ], # أقسام الدعوة بالترتيب
      "settings": { ... }         # إعدادات عامة (موسيقى، حركة، لغة)
    }

وكل بلوك::

    {
      "id":      "hero-a1b2c3",   # معرّف فريد داخل المستند
      "type":    "hero",
      "visible": true,
      "locked":  false,
      "props":   { ... },         # الحقول الخاصة بنوع البلوك
      "style":   { ... }          # حقول التنسيق المشتركة
    }

الفكرة الأساسية: **لا يوجد أي شيء مكتوب بالكود داخل الدعوة**. كل نص ولون
وخط ومسافة وصورة وحركة هو حقل معرّف هنا، والمحرر يبني واجهته تلقائياً من
هذه التعريفات. إضافة حقل جديد للمحرر = إضافة سطر واحد هنا فقط.
"""

from __future__ import annotations

import copy
import re
import uuid
from typing import Any

from . import customtext

DOCUMENT_VERSION = 1

# --------------------------------------------------------------------------
# أنواع الحقول التي يفهمها المحرر
# --------------------------------------------------------------------------
FIELD_TYPES = {
    "text",       # سطر نص واحد
    "textarea",   # نص متعدد الأسطر
    "html",       # نص منسّق (يمر عبر منقّي HTML)
    "number",
    "range",      # شريط تمرير
    "color",
    "select",
    "toggle",
    "image",      # معرّف أصل مرفوع أو رابط
    "media",      # زي image بس بيقبل صوت/فيديو حسب media_kind
    "url",
    "date",
    "datetime",
    "font",       # اختيار من قائمة الخطوط
    "align",      # يمين / وسط / يسار
    "list",       # مجموعة متكررة من الحقول الفرعية
    "gradient",
    "icon",
}


def field(
    key: str,
    label: str,
    ftype: str = "text",
    default: Any = "",
    *,
    group: str = "المحتوى",
    help_text: str = "",
    options: list | None = None,
    fields: list | None = None,
    minimum: float | None = None,
    maximum: float | None = None,
    step: float | None = None,
    unit: str = "",
    placeholder: str = "",
    feature: str = "",
    add_label: str = "إضافة عنصر",
    media_kind: str = "image",
    translate: bool = True,
    editor_hidden: bool = False,
) -> dict:
    """تعريف حقل واحد داخل المحرر.

    ``translate=False`` بيشيل الحقل من جدول الترجمة. بيتحط على الحقول
    اللي محتواها كود مش كلام يشوفه الضيف — CSS مثلاً. كلام القسم
    المستورد نفسه بيتسحب من جوّه الـHTML، مش من الحقل ده.
    """
    if ftype not in FIELD_TYPES:
        raise ValueError(f"نوع حقل غير معروف: {ftype}")
    spec = {
        "key": key,
        "media_kind": media_kind,
        "label": label,
        "type": ftype,
        "default": default,
        "group": group,
    }
    if not translate:
        spec["translate"] = False
    if editor_hidden:
        spec["editor_hidden"] = True
    if help_text:
        spec["help"] = help_text
    if options:
        spec["options"] = options
    if fields:
        spec["fields"] = fields
        spec["add_label"] = add_label
    if minimum is not None:
        spec["min"] = minimum
    if maximum is not None:
        spec["max"] = maximum
    if step is not None:
        spec["step"] = step
    if unit:
        spec["unit"] = unit
    if placeholder:
        spec["placeholder"] = placeholder
    if feature:
        # الحقل يعمل فقط إذا كانت الميزة مفعّلة في باقة العميل
        spec["feature"] = feature
    return spec


def opt(value: str, label: str) -> dict:
    return {"value": value, "label": label}


# --------------------------------------------------------------------------
# الخطوط المتاحة
# --------------------------------------------------------------------------
FONT_CHOICES = [
    opt("'Amiri', serif", "أميري — عربي كلاسيكي"),
    opt("'Cairo', sans-serif", "القاهرة — عربي حديث"),
    opt("'Tajawal', sans-serif", "تجوال — عربي ناعم"),
    opt("'Reem Kufi', sans-serif", "ريم كوفي — عربي زخرفي"),
    opt("'Aref Ruqaa', serif", "عارف رقعة — خط الرقعة"),
    opt("'Playfair Display', serif", "Playfair Display"),
    opt("'Cormorant Garamond', serif", "Cormorant Garamond"),
    opt("'Marcellus', serif", "Marcellus"),
    opt("'Great Vibes', cursive", "Great Vibes — خط يد"),
    opt("'Montserrat', sans-serif", "Montserrat"),
    opt("Georgia, serif", "Georgia"),
]

ANIMATION_CHOICES = [
    opt("none", "بدون حركة"),
    opt("fade", "ظهور ناعم"),
    opt("rise", "صعود تدريجي"),
    opt("slide-right", "انزلاق من اليمين"),
    opt("slide-left", "انزلاق من اليسار"),
    opt("zoom", "تكبير سينمائي"),
    opt("blur", "خروج من الضباب"),
    opt("flip", "انقلاب"),
]

ALIGN_CHOICES = [opt("right", "يمين"), opt("center", "وسط"), opt("left", "يسار")]

WIDTH_CHOICES = [
    opt("narrow", "ضيق"),
    opt("normal", "عادي"),
    opt("wide", "عريض"),
    opt("full", "كامل العرض"),
    # «كامل العرض» بيملأ عرض كارت الدعوة، و«ملء الشاشة» بيكسر حدود الكارت
    # ويمتد لعرض الشاشة كلها — على أي جهاز. الفرق بيبان على الديسك توب
    # لأن الكارت هناك ٧٢٠px والشاشة ممكن تبقى ١٤٤٠px.
    opt("screen", "ملء الشاشة"),
]

DIVIDER_CHOICES = [
    opt("none", "بدون"),
    opt("line", "خط بسيط"),
    opt("diamond", "معيّن ذهبي"),
    opt("floral", "زخرفة نباتية"),
    opt("arabesque", "أرابيسك"),
    opt("dots", "نقاط"),
]


# --------------------------------------------------------------------------
# حقول التنسيق المشتركة لكل بلوك
# --------------------------------------------------------------------------
def style_fields() -> list[dict]:
    g = "التنسيق"
    return [
        field("bg_color", "لون الخلفية", "color", "", group=g,
              help_text="اتركه فارغاً ليرث لون خلفية القالب"),
        field("bg_image", "صورة الخلفية", "image", "", group=g),
        field("bg_overlay", "تعتيم الخلفية", "range", 0, group=g,
              minimum=0, maximum=100, step=5, unit="%"),
        field("bg_fixed", "تثبيت الخلفية عند التمرير", "toggle", False, group=g),
        field("text_color", "لون النص", "color", "", group=g),
        field("accent_color", "لون الإبراز", "color", "", group=g),
        field("align", "محاذاة المحتوى", "align", "center", group=g),
        field("width", "عرض المحتوى", "select", "normal", group=g, options=WIDTH_CHOICES),
        field("padding_top", "مسافة علوية", "range", 80, group=g,
              minimum=0, maximum=240, step=4, unit="px"),
        field("padding_bottom", "مسافة سفلية", "range", 80, group=g,
              minimum=0, maximum=240, step=4, unit="px"),
        field("radius", "استدارة الحواف", "range", 0, group=g,
              minimum=0, maximum=60, step=2, unit="px"),
        field("divider_top", "زخرفة علوية", "select", "none", group=g, options=DIVIDER_CHOICES),
        field("divider_bottom", "زخرفة سفلية", "select", "none", group=g, options=DIVIDER_CHOICES),
        field("animation", "الحركة", "select", "fade", group="الحركة", options=ANIMATION_CHOICES),
        field("animation_delay", "تأخير الحركة", "range", 0, group="الحركة",
              minimum=0, maximum=2000, step=100, unit="ms"),
        field("custom_class", "كلاس CSS إضافي", "text", "", group=g,
              help_text="للاستخدام المتقدم فقط"),
        # قيم داخلية يغيّرها مقبض حدود القسم في المحرر فقط.
        # واحدة لكل مقاس شاشة لأن قوالب Tilda بتكتب ارتفاع مختلف لكل
        # مقاس؛ رقم واحد كان هيظبط مقاس ويكسر التانيين.
        # صفر = سيب ارتفاع القالب الأصلي زي ما هو.
        field("section_height_mobile", "ارتفاع القسم (موبايل)", "range", 0,
              group=g, minimum=0, maximum=2400, step=10, unit="px",
              editor_hidden=True),
        field("section_height_tablet", "ارتفاع القسم (تابلت)", "range", 0,
              group=g, minimum=0, maximum=2400, step=10, unit="px",
              editor_hidden=True),
        field("section_height_desktop", "ارتفاع القسم (ديسكتوب)", "range", 0,
              group=g, minimum=0, maximum=2400, step=10, unit="px",
              editor_hidden=True),
        # الحقل القديم — كان بيتكتب ومحدش بيقراه. سايبينه عشان القيم
        # المحفوظة ما تضيعش، والمولّد بيستعمله كقيمة احتياطية.
        field("section_height", "ارتفاع القسم", "range", 0, group=g,
              minimum=0, maximum=2400, step=10, unit="px", editor_hidden=True),
    ]


BUTTON_SUBFIELDS = [
    field("label", "نص الزر", "text", "اضغط هنا"),
    field("action", "نوع الإجراء", "select", "scroll", options=[
        opt("scroll", "التمرير لقسم"),
        opt("link", "فتح رابط"),
        opt("whatsapp", "مراسلة واتساب"),
        opt("calendar", "إضافة للتقويم"),
        opt("map", "فتح الخريطة"),
        opt("share", "مشاركة الدعوة"),
        opt("rsvp", "الانتقال لتأكيد الحضور"),
    ]),
    field("target", "الهدف / الرابط", "text", "", placeholder="#rsvp أو https://..."),
    field("style", "شكل الزر", "select", "solid", options=[
        opt("solid", "ممتلئ"), opt("outline", "محدّد"), opt("ghost", "شفاف"),
        opt("link", "نص فقط"),
    ]),
    field("icon", "أيقونة", "icon", ""),
]


# --------------------------------------------------------------------------
# نصوص فوق أي قسم — نفس البنية بتتخزن في props عشان تفضل متوافقة
# مع نصوص الفيديو القديمة، لكنها بتظهر في المحرر لكل أنواع الأقسام.
# --------------------------------------------------------------------------
def _overlay_style(spec: dict, role: str, owner: str = "text") -> dict:
    """حقل من حقول ترس عنصر الأوفرلاي.

    عناصر الـ‎list‎ مالهاش ``style_of`` بالمعنى العادي — كل عنصر بيتخزن
    لوحده، فالترس بيتبني من نفس حقول العنصر. ``owner`` هنا اسم حقل
    النص جوّه العنصر (``text`` للنص، ``label`` للزرار) مش مفتاح في
    ``props``.
    """
    spec["style_of"] = owner
    spec["style_role"] = role
    spec["editor_hidden"] = True
    return spec


def _only(spec: dict, *kinds: str) -> dict:
    """الحقل ده يظهر لأنواع معيّنة من العناصر بس.

    النوع بيتحدد وقت الإضافة ومابيتغيّرش بعدها، فالمحرر مش محتاج
    يعيد بناء الكارت — بيتخطّى الحقل وخلاص.
    """
    spec["show_kind"] = list(kinds)
    return spec


OVERLAY_KINDS = [
    opt("text", "نص"), opt("image", "صورة"), opt("button", "زرار"),
]

# --------------------------------------------------------------------------
# عناصر فوق أي قسم — نص أو صورة أو زرار، وكلهم بيتسحبوا بالماوس
# --------------------------------------------------------------------------
# المفتاح فضل ``text_overlays`` عن قصد: ده اسم متخزّن في مستندات
# شغّالة، وتغييره معناه إن كل نص فوق قسم في كل دعوة قديمة يختفي.
# العناصر التلاتة في **قايمة واحدة** عشان السحب والموضع والمقابض
# يشتغلوا لهم بنفس الكود بدل تلات نسخ من نفس المنطق.
SECTION_TEXT_OVERLAY_FIELD = field(
    "text_overlays", "عناصر فوق القسم", "list", [],
    group="عناصر فوق القسم",
    add_label="إضافة نص", fields=[
        # النوع بيتكتب من زرار الإضافة. القديم من غير مفتاح = نص.
        field("kind", "النوع", "select", "text", options=OVERLAY_KINDS,
              editor_hidden=True, translate=False),

        # ---- نص
        # الافتراضي فاضي عن قصد: زرار الإضافة هو اللي بيزرع الكلام
        # المبدئي. لو الافتراضي كان مكتوب، كل عنصر صورة أو زرار كان
        # هيتخزّن ومعاه نص وهمي ويطلع في جدول الترجمة.
        _only(field("text", "النص", "textarea", ""), "text"),
        # التنسيق بيتلم ورا ترس جنب النص زي أي حقل نص تاني في المحرر.
        # المفاتيح زي ما هي (‎color‎/‎font‎) عشان النصوص المحفوظة
        # ماتتغيّرش، و‎video_text_style‎ لسه بتقراهم بنفس الأسماء.
        _overlay_style(
            field("color", "اللون", "color", "#ffffff"), "color"),
        _overlay_style(
            field("font", "الخط", "font", ""), "font"),
        _overlay_style(
            field("size", "الحجم", "range", 0, minimum=0, maximum=160, step=1,
                  unit="px", help_text="صفر = حجم القالب زي ما هو"), "size"),

        # ---- صورة
        _only(field("src", "الصورة", "image", ""), "image"),
        _only(field("radius", "استدارة الحواف", "range", 0,
                    minimum=0, maximum=200, step=2, unit="px"), "image"),

        # ---- زرار
        _only(field("label", "نص الزرار", "text", ""), "button"),
        _only(field("href", "الرابط", "url", "",
                    placeholder="https://... أو ‎#rsvp‎",
                    help_text="سيبه فاضي = الزرار شكلي مش بيروح لحتة."),
              "button"),
        _overlay_style(
            field("btn_font", "الخط", "font", ""), "font", owner="label"),
        _overlay_style(
            field("btn_color", "لون الكلام", "color", "#ffffff"),
            "color", owner="label"),
        _overlay_style(
            field("btn_size", "الحجم", "range", 0, minimum=0, maximum=120,
                  step=1, unit="px", help_text="صفر = حجم القالب زي ما هو"),
            "size", owner="label"),
        _overlay_style(
            field("btn_bg", "لون الخلفية", "color", "#b8914f"),
            "bg", owner="label"),
        _overlay_style(
            field("btn_radius", "استدارة الحواف", "range", 999,
                  minimum=0, maximum=999, step=1, unit="px"),
            "radius", owner="label"),

        # ---- مشترك: العرض والموضع (ليهم مقابض في المعاينة)
        field("width", "العرض", "range", 0, minimum=0, maximum=100, step=1, unit="%",
              help_text="للنص: بيحدّد فين السطر بيقطع. للصورة والزرار: "
                        "عرضهم. صفر = تلقائي، و١٠٠٪ = عرض القسم كله. "
                        "تقدر تسحبه من المقبضين على الجنبين في المعاينة."),
        field("x", "الموضع أفقياً", "range", 0, minimum=-1000, maximum=1000, step=1, unit="%"),
        field("y", "الموضع رأسياً", "range", 0, minimum=-1000, maximum=1000, step=1, unit="%"),
    ],
)
# التلات أزرار اللي بتظهر **فوق** القايمة في المحرر. ``seed`` هو
# الكلام المبدئي للعنصر الجديد — الافتراضيات في المخطط فاضية عشان
# العنصر ما يتخزّنش ومعاه كلام نوع تاني.
SECTION_TEXT_OVERLAY_FIELD["group_open"] = True
SECTION_TEXT_OVERLAY_FIELD["add_variants"] = [
    {"key": "kind", "value": "text", "label": "＋ نص",
     "seed": {"text": "اكتب النص هنا"}},
    {"key": "kind", "value": "image", "label": "＋ صورة", "seed": {}},
    {"key": "kind", "value": "button", "label": "＋ زرار",
     "seed": {"label": "اضغط هنا"}},
]


# --------------------------------------------------------------------------
# ترس النص — تنسيق كل نص جوّه ترسه
# --------------------------------------------------------------------------
"""كل حقل نص في المحرر بياخد ترس (⚙) جنبه فيه تنسيقه هو لوحده.

الحقول دي **مخفية من القائمة المسطحة** (``editor_hidden``) وبتظهر جوّه
الترس بس — المحرر بيلمّها بـ``style_of`` اللي بيقول الترس ده بتاع أنهي
حقل نص، و``style_role`` اللي بيرتّبها جوّه اللوحة.

الحقول القديمة (``heading_font``، ``quote_size``، ``name_font``…) اتربطت
بأصحابها بنفس المفتاحين بدل ما تتكرر: قيمها المحفوظة وطريقة عرضها في
القوالب زي ما هي بالظبط، اللي اتغيّر هو مكانها في الواجهة.

المفاتيح المولّدة كلها بتبدأ بـ``ts_`` عشان ماتصطدمش بأي مفتاح موجود
(``text_color`` في التنسيق مثلاً)، والريندرر بيطبّقها من
``renderer.text_style_css`` على العنصر اللي عليه ``data-ts`` في القالب.
"""

TEXT_STYLE_PREFIX = "ts_"

# الترتيب ده هو ترتيب ظهورهم جوّه الترس
TEXT_STYLE_ROLES = ("font", "color", "size", "weight", "align", "ls", "lh")

TEXT_WEIGHT_CHOICES = [
    opt("", "زي ما هو"), opt("300", "خفيف"), opt("400", "عادي"),
    opt("500", "متوسط"), opt("600", "نص عريض"), opt("700", "عريض"),
    opt("800", "عريض جداً"),
]

TEXT_ALIGN_CHOICES = [
    opt("", "زي ما هو"), opt("right", "يمين"),
    opt("center", "وسط"), opt("left", "يسار"),
]

# أنواع الحقول اللي بتاخد ترس
TEXT_STYLE_OWNER_TYPES = {"text", "textarea", "html"}

# نصوص مالهاش عنصر ثابت في الصفحة تتحط عليه القاعدة، فمالهاش ترس:
#   • countdown.finished_text بيتكتب من الجافاسكربت بعد ما الموعد يعدّي
#   • custom_html.html/css كود مش كلام — تنسيقه من «العنصر المحدَّد»
NO_TEXT_STYLE = {
    ("countdown", "finished_text"),
    ("custom_html", "html"),
    ("custom_html", "css"),
}

# الحقول القديمة: {نوع البلوك: {حقل النص: {الدور: مفتاح الحقل القديم}}}
# الدور ``extra`` معناه حقل زيادة بيتعرض في آخر الترس زي ما هو.
LEGACY_TEXT_STYLE = {
    "hero": {
        "name_one": {
            "font": "name_font", "size": "name_size",
            "ls": "name_spacing", "extra": ["name_size_mobile"],
        },
    },
    "text": {
        "heading": {"font": "heading_font", "size": "heading_size"},
        "body": {"size": "body_size", "lh": "body_line_height"},
    },
    "quote": {
        "text": {"font": "quote_font", "size": "quote_size"},
    },
}


def _text_style_field(owner: str, role: str, group: str) -> dict:
    key = f"{TEXT_STYLE_PREFIX}{owner}_{role}"
    if role == "font":
        # من غير ‎options‎ عن قصد: المحرر بيقع على ‎SCHEMA.fonts‎ (نفس
        # ‎FONT_CHOICES‎) لما الحقل مايجيبش قايمته. لو كل حقل جاب نسخته،
        # المخطط اللي بيروح للمتصفح كان بيزيد ~٤٠ كيلوبايت من نفس الكلام.
        spec = field(key, "الخط", "font", "", group=group, editor_hidden=True)
    elif role == "color":
        spec = field(key, "اللون", "color", "", group=group, editor_hidden=True)
    elif role == "size":
        spec = field(key, "الحجم", "range", 0, group=group,
                     minimum=0, maximum=160, step=1, unit="px",
                     editor_hidden=True,
                     help_text="صفر = حجم القالب زي ما هو")
    elif role == "weight":
        spec = field(key, "سُمك الخط", "select", "", group=group,
                     options=TEXT_WEIGHT_CHOICES, editor_hidden=True)
    elif role == "align":
        spec = field(key, "المحاذاة", "select", "", group=group,
                     options=TEXT_ALIGN_CHOICES, editor_hidden=True)
    elif role == "ls":
        spec = field(key, "تباعد الحروف", "range", 0, group=group,
                     minimum=-5, maximum=30, step=0.5, unit="px",
                     editor_hidden=True)
    else:  # lh
        spec = field(key, "ارتفاع السطر", "range", 0, group=group,
                     minimum=0, maximum=3.2, step=0.05, editor_hidden=True,
                     help_text="صفر = تلقائي")
    spec["style_of"] = owner
    spec["style_role"] = role
    return spec


def attach_text_styles(btype: str, specs: list[dict]) -> list[dict]:
    """يرجّع نفس قائمة الحقول + حقول تنسيق لكل حقل نص فيها.

    بيشتغل مرة واحدة وقت التسجيل، فمفيش أي حساب وقت العرض.
    """
    by_key = {f["key"]: f for f in specs}
    legacy_all = LEGACY_TEXT_STYLE.get(btype, {})
    extra: list[dict] = []

    for spec in list(specs):
        owner = spec["key"]
        if spec["type"] not in TEXT_STYLE_OWNER_TYPES:
            continue
        if spec.get("editor_hidden") or spec.get("translate") is False:
            continue
        if (btype, owner) in NO_TEXT_STYLE:
            continue

        group = spec.get("group") or "المحتوى"
        legacy = legacy_all.get(owner) or {}
        taken = set()

        # الحقول القديمة بتتنقل جوّه الترس بمفتاحها وقيمتها زي ما هي
        for role, old_key in legacy.items():
            if role == "extra":
                continue
            old = by_key.get(old_key)
            if not old:
                continue
            old["style_of"] = owner
            old["style_role"] = role
            old["editor_hidden"] = True
            taken.add(role)
        for old_key in legacy.get("extra") or []:
            old = by_key.get(old_key)
            if not old:
                continue
            old["style_of"] = owner
            old["style_role"] = "zz_extra"
            old["editor_hidden"] = True

        for role in TEXT_STYLE_ROLES:
            if role in taken:
                continue
            new_key = f"{TEXT_STYLE_PREFIX}{owner}_{role}"
            if new_key in by_key:
                continue
            child = _text_style_field(owner, role, group)
            by_key[new_key] = child
            extra.append(child)

    return specs + extra


def text_style_map(specs: list[dict]) -> dict[str, dict[str, str]]:
    """{حقل النص: {الدور: مفتاح}} — للمفاتيح المولّدة بس.

    الحقول القديمة مستثناة عن قصد: القوالب بترسمها inline خلاص
    (``font-size:{{ props.heading_size|fluid }}``)، فلو الريندرر طبّعها
    تاني كنا هنكتب نفس الحاجة مرتين بقيمتين ممكن يختلفوا.
    """
    out: dict[str, dict[str, str]] = {}
    for spec in specs:
        owner = spec.get("style_of")
        role = spec.get("style_role")
        if not owner or not role or role == "zz_extra":
            continue
        if not str(spec.get("key", "")).startswith(TEXT_STYLE_PREFIX):
            continue
        out.setdefault(owner, {})[role] = spec["key"]
    return out


# --------------------------------------------------------------------------
# سجل أنواع البلوكات
# --------------------------------------------------------------------------
BLOCK_REGISTRY: dict[str, dict] = {}

# ---------------------------------------------------------------- المواضع
# كل عنصر نص جوّه القسم ليه data-slot. المحرر بيسمح بإزاحته بالماوس،
# والإزاحة بتتخزن بوحدة cqw = ١٪ من عرض مسرح الدعوة — يعني نسبة مش بكسل،
# فبتفضل مظبوطة على أي مقاس شاشة من غير ما نخزّن موضع لكل جهاز.
# لا نضع حدّاً مرئياً عملياً لحركة عناصر القوالب المستوردة؛
# القيم الكبيرة تمنع خروج أرقام غير منطقية مع إبقاء السحب حراً داخل المحرر.
LAYOUT_MAX_X = 1000.0  # cqw
LAYOUT_MAX_Y = 1000.0  # cqw
_EL_SLOT = re.compile(r"^el-\d{1,4}$")
_SLOT_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


# أجزاء غير نصية بيتسمح بتحريكها كمان (مش مفاتيح props)
MOVABLE_PARTS = {
    "buttons", "ornament_top", "ornament_bottom", "image", "gallery", "map",
    "countdown", "qr", "form", "details", "video", "hosts", "agenda", "share",
    "scroll_hint", "card", "media",
}


def _clean_layout(raw, allowed_slots: set[str]) -> dict:
    """يقبل {slot: {dx, dy}} فقط، بأسماء معروفة وقيم داخل الحدود."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict] = {}
    for slot, val in list(raw.items())[:60]:
        if not isinstance(slot, str):
            continue
        # el-N بتتولّد تلقائياً لعناصر القوالب المستوردة — مفيش قايمة
        # مسبقة ليها لأن محتوى القالب مش معروف قبل ما يترفع. لاحظ إن
        # _SLOT_RE مابيسمحش بالشرطة، فلازم الفحص ده يجي **قبله**.
        if _EL_SLOT.match(slot):
            pass
        elif not _SLOT_RE.match(slot):
            continue
        elif allowed_slots and slot not in allowed_slots and slot not in MOVABLE_PARTS:
            continue
        if not isinstance(val, dict):
            continue
        try:
            dx = round(float(val.get("dx") or 0), 2)
            dy = round(float(val.get("dy") or 0), 2)
        except (TypeError, ValueError):
            continue
        if dx != dx or dy != dy:          # NaN
            continue
        dx = max(-LAYOUT_MAX_X, min(LAYOUT_MAX_X, dx))
        dy = max(-LAYOUT_MAX_Y, min(LAYOUT_MAX_Y, dy))
        # 4.0 و4 نفس الحاجة — نخزّن الأنضف عشان الـCSS الناتج ما يبقاش
        # فيه أصفار عشرية مالهاش لزوم
        if dx == int(dx): dx = int(dx)
        if dy == int(dy): dy = int(dy)
        if dx or dy:                      # الصفر مالوش لزوم نخزنه
            out[slot] = {"dx": dx, "dy": dy}
    return out


def register(
    btype: str,
    label: str,
    *,
    icon: str,
    description: str = "",
    props: list[dict],
    feature: str = "",
    singleton: bool = False,
    category: str = "عام",
    supports_style: bool = True,
) -> None:
    block_props = list(props)
    if supports_style and not any(f.get("key") == "text_overlays" for f in block_props):
        block_props.append(SECTION_TEXT_OVERLAY_FIELD)
    # كل حقل نص بياخد حقول تنسيقه (ترسه). لازم تيجي قبل ما المخطط
    # يتخزّن عشان normalize_document تعرف المفاتيح الجديدة.
    block_props = attach_text_styles(btype, block_props)
    BLOCK_REGISTRY[btype] = {
        "type": btype,
        "label": label,
        "icon": icon,
        "description": description,
        "category": category,
        "props": block_props,
        "style": style_fields() if supports_style else [],
        "feature": feature,
        "singleton": singleton,
    }


# ---- الغلاف -------------------------------------------------------------
register(
    "hero", "الغلاف الرئيسي", icon="✦", category="أساسي", singleton=True,
    description="أول ما يراه الضيف — الأسماء والتاريخ وصورة الغلاف",
    props=[
        field("kicker", "النص التمهيدي", "text", "دعوة زفاف"),
        field("name_one", "الاسم الأول", "text", "ليلى"),
        field("separator", "الفاصل بين الاسمين", "text", "&"),
        field("name_two", "الاسم الثاني", "text", "أحمد"),
        field("names_layout", "ترتيب الاسمين", "select", "stacked", options=[
            opt("stacked", "فوق بعض"), opt("inline", "في سطر واحد"),
            opt("crossed", "متداخل"),
        ]),
        field("subtitle", "سطر فرعي", "text", "يتشرفان بدعوتكم لحضور حفل زفافهما"),
        field("date_text", "نص التاريخ", "text", "",
              help_text="اتركه فارغاً ليُملأ تلقائياً من تاريخ المناسبة"),
        field("show_scroll_hint", "إظهار مؤشر التمرير", "toggle", True),
        field("scroll_hint_text", "نص مؤشر التمرير", "text", "مرّر للأسفل"),
        field("height", "ارتفاع الغلاف", "select", "full", options=[
            opt("full", "ملء الشاشة"), opt("tall", "طويل"),
            opt("medium", "متوسط"), opt("short", "قصير"),
        ]),
        field("name_font", "خط الأسماء", "font", "", group="الخطوط", options=FONT_CHOICES),
        field("name_size", "حجم الأسماء", "range", 76, group="الخطوط",
              minimum=28, maximum=160, step=2, unit="px"),
        field("name_size_mobile", "أصغر حجم للأسماء (موبايل)", "range", 46, group="الخطوط",
              minimum=20, maximum=90, step=2, unit="px"),
        field("name_spacing", "تباعد حروف الأسماء", "range", 0, group="الخطوط",
              minimum=-4, maximum=24, step=1, unit="px"),
        field("buttons", "الأزرار", "list", [], group="الأزرار",
              fields=BUTTON_SUBFIELDS, add_label="إضافة زر"),
    ],
)

# ---- نص عام -------------------------------------------------------------
register(
    "text", "قسم نصي", icon="¶", category="أساسي",
    description="عنوان ونص حر — للترحيب أو أي كلمة",
    props=[
        field("eyebrow", "نص فوق العنوان", "text", "كلمة من القلب"),
        field("heading", "العنوان", "text", "وجودكم هو الهدية"),
        field("body", "النص", "html",
              "يسعدنا أن تشاركونا أجمل فصول حياتنا، وننتظر أن تكتمل فرحتنا بحضوركم."),
        field("heading_font", "خط العنوان", "font", "", group="الخطوط", options=FONT_CHOICES),
        field("heading_size", "حجم العنوان", "range", 38, group="الخطوط",
              minimum=16, maximum=90, step=1, unit="px"),
        field("body_size", "حجم النص", "range", 17, group="الخطوط",
              minimum=12, maximum=32, step=1, unit="px"),
        field("body_line_height", "تباعد الأسطر", "range", 1.9, group="الخطوط",
              minimum=1.0, maximum=3.0, step=0.1),
    ],
)

# ---- آية أو اقتباس ------------------------------------------------------
register(
    "quote", "آية أو اقتباس", icon="❝", category="أساسي",
    description="نص مميّز داخل إطار زخرفي",
    props=[
        field("text", "النص", "textarea",
              "وَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا لِّتَسْكُنُوا إِلَيْهَا"),
        field("source", "المصدر", "text", "سورة الروم — الآية ٢١"),
        field("frame", "إطار الاقتباس", "select", "arabesque", options=[
            opt("none", "بدون إطار"), opt("simple", "بسيط"),
            opt("arabesque", "أرابيسك"), opt("corners", "زوايا ذهبية"),
        ]),
        field("quote_font", "الخط", "font", "'Amiri', serif", group="الخطوط", options=FONT_CHOICES),
        field("quote_size", "حجم النص", "range", 26, group="الخطوط",
              minimum=14, maximum=60, step=1, unit="px"),
    ],
)

# ---- المضيفون -----------------------------------------------------------
register(
    "hosts", "أصحاب الدعوة", icon="⚭", category="أساسي",
    description="أسماء الأهل أو الجهة الداعية",
    props=[
        field("heading", "العنوان", "text", "بدعوة من"),
        field("entries", "الأسماء", "list", [], add_label="إضافة اسم", fields=[
            field("label", "الصفة", "text", "والد العروس"),
            field("name", "الاسم", "text", ""),
        ]),
        field("columns", "عدد الأعمدة", "range", 2, minimum=1, maximum=4, step=1),
    ],
)

# ---- العد التنازلي -------------------------------------------------------
register(
    "countdown", "العد التنازلي", icon="⏱", category="تفاعلي", feature="countdown",
    description="عدّاد يتناقص حتى موعد المناسبة",
    props=[
        field("heading", "العنوان", "text", "موعدنا يقترب"),
        field("eyebrow", "نص فوق العنوان", "text", "باقٍ على الفرح"),
        field("label_days", "كلمة الأيام", "text", "يوم"),
        field("label_hours", "كلمة الساعات", "text", "ساعة"),
        field("label_minutes", "كلمة الدقائق", "text", "دقيقة"),
        field("label_seconds", "كلمة الثواني", "text", "ثانية"),
        field("show_seconds", "إظهار الثواني", "toggle", True),
        field("finished_text", "النص بعد انتهاء الموعد", "text", "بدأ الفرح — نراكم الآن"),
        field("variant", "شكل العدّاد", "select", "boxes", options=[
            opt("boxes", "صناديق"), opt("circles", "دوائر"),
            opt("minimal", "أرقام فقط"), opt("flip", "بطاقات مقلوبة"),
        ]),
        field("number_size", "حجم الأرقام", "range", 40, group="الخطوط",
              minimum=18, maximum=96, step=2, unit="px"),
    ],
)

# ---- تفاصيل المناسبة -----------------------------------------------------
register(
    "details", "تفاصيل المناسبة", icon="☰", category="أساسي",
    description="صفوف التاريخ والوقت والمكان وأي تفاصيل أخرى",
    props=[
        field("heading", "العنوان", "text", "تفاصيل اليوم"),
        field("eyebrow", "نص فوق العنوان", "text", "الاحتفال"),
        field("rows", "الصفوف", "list", [], add_label="إضافة صف", fields=[
            field("icon", "أيقونة", "icon", "calendar"),
            field("label", "العنوان", "text", "التاريخ"),
            field("value", "القيمة", "text", ""),
            field("hint", "ملاحظة صغيرة", "text", ""),
            field("auto", "املأ تلقائياً من بيانات الدعوة", "select", "", options=[
                opt("", "يدوي"), opt("date", "تاريخ المناسبة"),
                opt("time", "وقت المناسبة"), opt("venue", "اسم القاعة"),
                opt("address", "العنوان"),
            ]),
        ]),
        field("layout", "التوزيع", "select", "cards", options=[
            opt("cards", "بطاقات"), opt("rows", "صفوف"), opt("timeline", "خط زمني"),
        ]),
        field("columns", "عدد الأعمدة", "range", 3, minimum=1, maximum=4, step=1),
    ],
)

# ---- برنامج اليوم --------------------------------------------------------
register(
    "agenda", "برنامج الحفل", icon="≡", category="أساسي",
    description="جدول زمني لفقرات المناسبة",
    props=[
        field("heading", "العنوان", "text", "برنامج الحفل"),
        field("items", "الفقرات", "list", [], add_label="إضافة فقرة", fields=[
            field("time", "الوقت", "text", "٨:٠٠ م"),
            field("title", "الفقرة", "text", "استقبال الضيوف"),
            field("note", "تفاصيل", "text", ""),
            field("icon", "أيقونة", "icon", ""),
        ]),
    ],
)

# ---- الموقع والخريطة -----------------------------------------------------
register(
    "location", "الموقع والخريطة", icon="⌖", category="تفاعلي", feature="location",
    description="اسم القاعة والعنوان وخريطة تفاعلية",
    props=[
        field("heading", "العنوان", "text", "مكان الاحتفال"),
        field("eyebrow", "نص فوق العنوان", "text", "الموقع"),
        field("venue", "اسم القاعة", "text", "",
              help_text="اتركه فارغاً ليُملأ من بيانات الدعوة"),
        field("address", "العنوان التفصيلي", "textarea", ""),
        field("map_embed", "رابط الخريطة المضمّنة", "url", "",
              help_text="رابط embed من خرائط جوجل — يعرض الخريطة داخل الدعوة"),
        field("map_link", "رابط فتح الخريطة", "url", ""),
        field("show_map", "إظهار الخريطة", "toggle", True),
        field("map_height", "ارتفاع الخريطة", "range", 320,
              minimum=160, maximum=640, step=10, unit="px"),
        field("directions_label", "نص زر الاتجاهات", "text", "افتح الاتجاهات"),
        field("notes", "إرشادات للضيوف", "textarea", ""),
    ],
)

# ---- معرض الصور ----------------------------------------------------------
register(
    "gallery", "معرض الصور", icon="▦", category="وسائط", feature="gallery",
    description="صور المناسبة بترتيب شبكي أو شريط متحرك",
    props=[
        field("heading", "العنوان", "text", "لحظات من حكايتنا"),
        field("images", "الصور", "list", [], add_label="إضافة صورة", fields=[
            field("src", "الصورة", "image", ""),
            field("caption", "تعليق", "text", ""),
        ]),
        field("layout", "التوزيع", "select", "grid", options=[
            opt("grid", "شبكة"), opt("masonry", "شبكة متدرجة"),
            opt("carousel", "شريط متحرك"), opt("stack", "صور متتالية"),
        ]),
        field("columns", "عدد الأعمدة", "range", 3, minimum=1, maximum=5, step=1),
        field("gap", "المسافة بين الصور", "range", 12, minimum=0, maximum=48, step=2, unit="px"),
        field("image_radius", "استدارة الصور", "range", 8, minimum=0, maximum=200, step=2, unit="px"),
        field("aspect", "نسبة الصورة", "select", "4/5", options=[
            opt("1/1", "مربع"), opt("4/5", "طولي"), opt("3/4", "طولي عريض"),
            opt("16/9", "عرضي"), opt("auto", "حسب الصورة"),
        ]),
        field("lightbox", "تكبير الصورة عند الضغط", "toggle", True),
    ],
)

# ---- صورة مفردة ----------------------------------------------------------
register(
    "image", "صورة", icon="▢", category="وسائط",
    description="صورة واحدة بعرض كامل أو داخل إطار",
    props=[
        field("src", "الصورة", "image", ""),
        field("caption", "تعليق", "text", ""),
        field("frame", "الإطار", "select", "none", options=[
            opt("none", "بدون"), opt("arch", "قوس"), opt("circle", "دائرة"),
            opt("gold", "إطار ذهبي"),
        ]),
        field("max_width", "أقصى عرض", "range", 520, minimum=160, maximum=1200, step=20, unit="px"),
    ],
)

# ---- فيديو ---------------------------------------------------------------
register(
    "video", "فيديو", icon="▷", category="وسائط", feature="video",
    description="فيديو من يوتيوب أو ملف مرفوع",
    props=[
        # كان حقل رابط بس. بقى media عشان يظهر معاه زر رفع ومكتبة
        # الفيديوهات — والخانة النصية جواه لسه بتقبل روابط يوتيوب/فيميو.
        field("url", "الفيديو", "media", "", media_kind="video",
              help_text="ارفع ملف من جهازك، أو اختار من المكتبة، أو الصق "
                   "رابط يوتيوب/فيميو في الخانة."),
        field("poster", "صورة الغلاف", "image", ""),
        field("heading", "العنوان", "text", ""),
        field("aspect", "نسبة العرض للارتفاع", "select", "16x9", options=[
            opt("16x9", "١٦:٩ عريض"),
            opt("4x3", "٤:٣"),
            opt("1x1", "مربّع"),
            opt("9x16", "٩:١٦ طولي (ريلز)"),
            opt("auto", "زي ما هو في الملف"),
        ], help_text="«زي ما هو» للملفات المرفوعة بس — يوتيوب وفيميو "
             "بيفضلوا ١٦:٩ لأن المتصفح مابيعرفش مقاسهم قبل التحميل."),
        field("autoplay", "تشغيل تلقائي", "toggle", False,
              help_text="بيشتغل لما القسم يوصل للشاشة ويقف لما يعدّي، "
                   "عشان ما ياكلش داتا الضيف على الفاضي. وبيبدأ صامت "
                   "إلا لو فتحت «يشتغل بصوت» تحت."),
        field("sound", "يشتغل بصوت", "toggle", False,
              help_text="محتاج «شاشة افتتاحية» مفتوحة من تبويب الإعدادات: "
                   "لمسة الضيف على زر فتح الدعوة هي إذن الصوت الوحيد اللي "
                   "المتصفح بيعترف بيه. من غير افتتاحية — أو لو الافتتاحية "
                   "بتتفتح بالعدّاد التلقائي مش بضغطة — الفيديو بيرجع صامت "
                   "لوحده. والموسيقى بتوطّى وقت الفيديو وترجع لما يقف."),
        field("controls", "إظهار شريط التحكم", "toggle", True,
              help_text="اقفله عشان الفيديو يبان زي خلفية متحركة من غير "
                   "شريط. لو المتصفح منع التشغيل التلقائي الشريط بيرجع "
                   "لوحده — وإلا الضيف هيبص على صورة ساكنة من غير أي "
                   "طريقة يشغّلها. بيشتغل على الملفات المرفوعة، ويوتيوب "
                   "وفيميو بيخفوا شريطهم بس شعارهم بيفضل."),
        field("loop", "تكرار", "toggle", False),
    ],
)

# ---- تأكيد الحضور --------------------------------------------------------
register(
    "rsvp", "تأكيد الحضور", icon="✓", category="تفاعلي", feature="rsvp", singleton=True,
    description="نموذج يملؤه الضيف لتأكيد حضوره",
    props=[
        field("heading", "العنوان", "text", "هل ستشرفوننا؟"),
        field("eyebrow", "نص فوق العنوان", "text", "تأكيد الحضور"),
        field("intro", "نص تمهيدي", "textarea", "نرجو تأكيد الحضور قبل الموعد بأسبوع."),
        field("name_label", "عنوان حقل الاسم", "text", "الاسم"),
        # الافتراضي «مفعّل» عشان الدعوات المحفوظة من قبل الحقل ده
        # يفضل الهاتف ظاهر فيها: التطبيع بيمشي على المخطط مش على
        # المخزّن، والمفتاح الناقص بياخد الافتراضي.
        field("ask_phone", "السؤال عن الهاتف", "toggle", True),
        field("phone_label", "عنوان حقل الهاتف", "text", "رقم الهاتف"),
        field("phone_required", "الهاتف مطلوب", "toggle", False),
        field("ask_companions", "السؤال عن المرافقين", "toggle", True, feature="companions"),
        field("companions_label", "عنوان حقل المرافقين", "text", "عدد المرافقين"),
        field("max_companions", "أقصى عدد مرافقين", "number", 5, minimum=0, maximum=20),
        field("ask_message", "السؤال عن رسالة", "toggle", True),
        field("message_label", "عنوان حقل الرسالة", "text", "كلمة للعروسين"),
        # كان مكتوب ثابت في القالب، فالقوالب الإنجليزية كانت بتطلع
        # بعنوان عربي وسط عناوين إنجليزية. الافتراضي نفس النص القديم.
        field("status_label", "عنوان خيارات الحضور", "text", "حالة الحضور"),
        field("attending_label", "خيار الحضور", "text", "سأحضر بكل سرور"),
        field("declined_label", "خيار الاعتذار", "text", "أعتذر عن الحضور"),
        field("maybe_label", "خيار غير متأكد", "text", "غير متأكد بعد"),
        field("show_maybe", "إظهار خيار «غير متأكد»", "toggle", True),
        field("submit_label", "نص زر الإرسال", "text", "إرسال التأكيد"),
        field("success_message", "رسالة النجاح", "textarea", "شكراً لكم — تم تسجيل ردكم."),
        field("deadline", "آخر موعد للتأكيد", "date", ""),
        field("closed_message", "رسالة بعد إغلاق التأكيد", "text", "انتهى موعد تأكيد الحضور."),
    ],
)

# ---- سجل التهاني ---------------------------------------------------------
register(
    "wishes", "رسائل التهنئة", icon="✉", category="تفاعلي", feature="guestbook",
    description="عرض رسائل الضيوف التي وصلت مع تأكيد الحضور",
    props=[
        field("heading", "العنوان", "text", "كلمات وصلتنا منكم"),
        field("limit", "عدد الرسائل المعروضة", "number", 12, minimum=1, maximum=100),
        field("layout", "التوزيع", "select", "cards", options=[
            opt("cards", "بطاقات"), opt("marquee", "شريط متحرك"), opt("list", "قائمة"),
        ]),
        field("empty_text", "النص عند عدم وجود رسائل", "text", "كونوا أول من يهنئنا."),
    ],
)

# ---- QR ------------------------------------------------------------------
register(
    "qr", "رمز QR", icon="▣", category="تفاعلي", feature="qr",
    description="رمز QR للدعوة أو لدخول القاعة",
    props=[
        field("heading", "العنوان", "text", "احتفظوا بالدعوة"),
        field("note", "ملاحظة", "textarea",
              "اعرضوا هذا الرمز عند مدخل القاعة."),
        field("mode", "نوع الرمز", "select", "invite", options=[
            opt("invite", "رابط الدعوة"), opt("checkin", "رمز دخول الضيف"),
        ]),
        field("size", "حجم الرمز", "range", 180, minimum=100, maximum=400, step=10, unit="px"),
        field("show_link", "إظهار الرابط كنص", "toggle", False),
    ],
)

# ---- المشاركة ------------------------------------------------------------
register(
    "share", "المشاركة والتقويم", icon="⇪", category="تفاعلي",
    description="أزرار نسخ الرابط والمشاركة وإضافة الموعد للتقويم",
    props=[
        field("heading", "العنوان", "text", "شاركوا الفرحة"),
        field("show_copy", "زر نسخ الرابط", "toggle", True),
        field("copy_label", "نص زر النسخ", "text", "نسخ الرابط"),
        field("show_whatsapp", "زر واتساب", "toggle", True, feature="whatsapp"),
        field("whatsapp_label", "نص زر واتساب", "text", "مشاركة عبر واتساب"),
        field("show_native", "زر المشاركة العامة", "toggle", True),
        field("show_calendar", "زر إضافة للتقويم", "toggle", True, feature="calendar"),
        field("calendar_label", "نص زر التقويم", "text", "أضف الموعد للتقويم"),
    ],
)

# ---- فاصل وزخرفة ---------------------------------------------------------
register(
    "divider", "فاصل زخرفي", icon="◈", category="عام", supports_style=True,
    description="خط أو زخرفة تفصل بين الأقسام",
    props=[
        field("variant", "الشكل", "select", "diamond", options=DIVIDER_CHOICES[1:]),
        field("size", "الحجم", "range", 40, minimum=10, maximum=200, step=5, unit="px"),
    ],
)

register(
    "spacer", "مسافة فارغة", icon="␣", category="عام", supports_style=False,
    description="فراغ بين قسمين",
    props=[field("height", "الارتفاع", "range", 60, minimum=8, maximum=400, step=4, unit="px")],
)

# ---- الأزرار المستقلة ----------------------------------------------------
register(
    "buttons", "صف أزرار", icon="▭", category="عام",
    description="مجموعة أزرار مستقلة",
    props=[
        field("items", "الأزرار", "list", [], add_label="إضافة زر", fields=BUTTON_SUBFIELDS),
        field("layout", "التوزيع", "select", "row", options=[
            opt("row", "بجانب بعض"), opt("column", "فوق بعض"),
        ]),
    ],
)

# ---- HTML مخصص (مخرج أمان للقوالب المستوردة) ----------------------------
register(
    "custom_html", "كود HTML مخصص", icon="</>", category="متقدم",
    description="قسم من قالب مستورد. اضغط على أي نص في المعاينة واكتب فوقه، واسحب أي عنصر بالماوس، وغيّر الألوان من «ألوان القسم». الكود تحت للحالات المتقدمة.",
    props=[
        # المجموعة دي مقفولة افتراضياً. التعديل العادي بيتم من المعاينة
        # مباشرة (اكتب فوق النص، اسحب العنصر) ومن مجموعة الألوان.
        field("html", "الكود", "html", "", group="كود متقدّم",
              help_text="يمر عبر منقّي أمان — الوسوم الخطرة تُزال تلقائياً"),
                field("css", "ستايل القسم", "textarea", "",      group="كود متقدّم",
              translate=False,
              help_text="يُحصر داخل هذا القسم فقط — لن يؤثر على باقي الدعوة"),
        field("countdown_date", "موعد العدّاد المستورد", "datetime", "",
              group="إعدادات العداد", translate=False,
              help_text="يظهر هذا الحقل للأقسام التي تحتوي على Countdown؛ اتركه فارغاً لاستخدام موعد القالب الأصلي."),

    ],
)


# --------------------------------------------------------------------------
# الثيم — الهوية البصرية العامة للقالب
# --------------------------------------------------------------------------
THEME_FIELDS = [
    field("bg", "لون الخلفية", "color", "#f7f2ea", group="الألوان"),
    field("surface", "لون البطاقات", "color", "#ffffff", group="الألوان"),
    field("text", "لون النص", "color", "#2c2620", group="الألوان"),
    field("muted", "لون النص الثانوي", "color", "#7b6f62", group="الألوان"),
    field("accent", "لون الإبراز", "color", "#b8914f", group="الألوان"),
    field("accent_soft", "لون الإبراز الفاتح", "color", "#e8d9be", group="الألوان"),
    field("border", "لون الحدود", "color", "#e3d9c9", group="الألوان"),
    field("hero_overlay", "تعتيم الغلاف", "range", 35, group="الألوان",
          minimum=0, maximum=90, step=5, unit="%"),

    field("font_heading", "خط العناوين", "font", "'Amiri', serif",
          group="الخطوط", options=FONT_CHOICES),
    field("font_body", "خط النصوص", "font", "'Tajawal', sans-serif",
          group="الخطوط", options=FONT_CHOICES),
    # الخطوط العربية (أميري، ريم كوفي، عارف رقعة) محارفها اللاتينية
    # ناقصة أو وحشة، فالنسخة الإنجليزية بتاخد خطوطها لو المصمّم حدّدها.
    field("font_heading_en", "خط العناوين — النسخة الإنجليزية", "font", "",
          group="الخطوط", options=FONT_CHOICES,
          help_text="سيبه فاضي عشان يفضل نفس الخط العربي."),
    field("font_body_en", "خط النصوص — النسخة الإنجليزية", "font", "",
          group="الخطوط", options=FONT_CHOICES,
          help_text="سيبه فاضي عشان يفضل نفس الخط العربي."),
    field("font_scale", "مقياس الخطوط", "range", 1.0, group="الخطوط",
          minimum=0.8, maximum=1.4, step=0.05),
    field("letter_spacing", "تباعد الحروف", "range", 0, group="الخطوط",
          minimum=-1, maximum=8, step=0.5, unit="px"),

    field("radius", "استدارة العناصر", "range", 14, group="الشكل",
          minimum=0, maximum=40, step=2, unit="px"),
    field("max_width", "عرض الدعوة", "range", 720, group="الشكل",
          minimum=420, maximum=1200, step=20, unit="px"),
    field("section_gap", "المسافة بين الأقسام", "range", 0, group="الشكل",
          minimum=0, maximum=120, step=4, unit="px"),
    field("shadow", "ظل البطاقات", "select", "soft", group="الشكل", options=[
        opt("none", "بدون"), opt("soft", "ناعم"), opt("strong", "قوي"),
    ]),
    field("pattern", "نقشة الخلفية", "select", "none", group="الشكل", options=[
        opt("none", "بدون"), opt("paper", "ورق"), opt("arabesque", "أرابيسك"),
        opt("marble", "رخام"), opt("linen", "كتان"), opt("stars", "نجوم"),
    ]),
    field("pattern_opacity", "شفافية النقشة", "range", 12, group="الشكل",
          minimum=0, maximum=100, step=2, unit="%"),

    # وول بيبر على الدعوة كلها. الخلفية لقسم واحد بس موجودة أصلاً في
    # «صورة الخلفية» جوّه تنسيق كل قسم — دي للمستوى الأعلى.
    field("bg_image", "صورة خلفية الدعوة", "image", "", group="الخلفية",
          help_text="وول بيبر ورا الدعوة كلها. الأقسام اللي مديها لون خلفية "
               "هتفضل مغطّياها — فضّي «لون الخلفية» من تنسيق القسم عشان "
               "الصورة تبان تحته. ولو عايز صورة لقسم واحد بس، استخدم "
               "«صورة الخلفية» جوّه تنسيق القسم نفسه."),
    field("bg_overlay", "تعتيم خلفية الدعوة", "range", 0, group="الخلفية",
          minimum=0, maximum=90, step=5, unit="%",
          help_text="طبقة سودا فوق الصورة عشان النص يفضل مقروء."),
    field("bg_fixed", "تثبيت الخلفية عند التمرير", "toggle", False,
          group="الخلفية",
          help_text="الصورة تفضل مكانها والدعوة تعدّي فوقها. بعض متصفحات "
               "الموبايل بتتجاهلها وبتعاملها كخلفية عادية."),

    field("direction", "اتجاه الكتابة", "select", "rtl", group="عام", options=[
        opt("rtl", "من اليمين لليسار"), opt("ltr", "من اليسار لليمين"),
    ]),
    field("animations_enabled", "تفعيل الحركات", "toggle", True, group="عام"),
]

SETTINGS_FIELDS = [
    field("music_url", "رابط الموسيقى", "media", "", media_kind="audio", group="الموسيقى", feature="music"),
    field("music_autoplay", "تشغيل تلقائي", "toggle", True, group="الموسيقى", feature="music",
          help_text="المتصفحات تمنع التشغيل التلقائي أحياناً — سيظهر زر تشغيل"),
    field("music_loop", "تكرار", "toggle", True, group="الموسيقى", feature="music"),
    field("music_player", "شكل المشغّل", "select", "floating", group="الموسيقى",
          feature="music", options=[
              opt("floating", "زر عائم"), opt("bar", "شريط سفلي"), opt("hidden", "مخفي"),
          ]),
    field("intro_enabled", "شاشة افتتاحية", "toggle", False, group="الافتتاحية"),
    field("intro_note", "نوت فوق النص", "text", "", group="الافتتاحية",
          placeholder="مثال: محمد & فرح",
          help_text="سطر صغير فوق نص الافتتاحية — أسماء العروسين أو أي "
               "كلمة. سيبها فاضية = مايظهرش أي حاجة. الافتتاحية مابقتش "
               "بتاخد الأسماء من تبويب البيانات لوحدها."),
        field("intro_note_color", "لون النوت", "color", "", group="الافتتاحية",
          editor_hidden=True,
          help_text="سيبه فاضي عشان يستخدم لون الافتتاحية العام."),
    field("intro_note_font", "خط النوت", "font", "", group="الافتتاحية",
          options=FONT_CHOICES, editor_hidden=True),
    field("intro_note_size", "حجم النوت", "range", 0, group="الافتتاحية",
          minimum=0, maximum=96, step=1, unit="px", editor_hidden=True),
    field("intro_text", "نص الافتتاحية", "text", "اضغط لفتح الدعوة", group="الافتتاحية"),
    field("intro_text_color", "لون نص الافتتاحية", "color", "", group="الافتتاحية",
          editor_hidden=True,
          help_text="لون الجملة الرئيسية فقط. سيبه فاضي عشان يستخدم اللون العام."),
    field("intro_text_font", "خط نص الافتتاحية", "font", "", group="الافتتاحية",
          options=FONT_CHOICES, editor_hidden=True),
    field("intro_text_size", "حجم نص الافتتاحية", "range", 0, group="الافتتاحية",
          minimum=0, maximum=96, step=1, unit="px", editor_hidden=True),
    field("intro_guest_name_color", "لون اسم الضيف", "color", "", group="الافتتاحية",
          editor_hidden=True,
          help_text="لون اسم الضيف فقط. سيبه فاضي عشان يستخدم اللون العام."),
    field("intro_guest_font", "خط اسم الضيف", "font", "", group="الافتتاحية",
          options=FONT_CHOICES, editor_hidden=True),
    field("intro_guest_size", "حجم اسم الضيف", "range", 0, group="الافتتاحية",
          minimum=0, maximum=96, step=1, unit="px", editor_hidden=True),

    field("intro_button", "نص الزر", "text", "التالي ←", group="الافتتاحية",
          help_text="سيبها فاضية = مفيش زر خالص. الضيف ساعتها بيدخل لما "
               "الفيديو يخلص، أو بلمسة في أي مكان على الشاشة. مع افتتاحية "
               "صورة من غير فيديو الأحسن تسيب الزر عشان يبقى واضح إن فيه "
               "حاجة تتضغط."),
        field("intro_button_color", "لون نص زر الافتتاحية", "color", "", group="الافتتاحية",
          editor_hidden=True,
          help_text="لون كتابة زر الدخول العام. سيبه فاضي عشان يستخدم لون الافتتاحية العام."),
    field("intro_button_font", "خط زر الدخول", "font", "", group="الافتتاحية",
          options=FONT_CHOICES, editor_hidden=True),
    field("intro_button_size", "حجم زر الدخول", "range", 0, group="الافتتاحية",
          minimum=0, maximum=96, step=1, unit="px", editor_hidden=True),

        field("intro_play_color", "لون نص زر تشغيل الفيديو", "color", "", group="الافتتاحية",
          editor_hidden=True,
          help_text="لون النص/الأيقونة في زر بدء الفيديو. سيبه فاضي لاستخدام لون زر الافتتاحية القديم."),
    field("intro_play_font", "خط نص تشغيل الفيديو", "font", "", group="الافتتاحية",
          options=FONT_CHOICES, editor_hidden=True),
    field("intro_play_size", "حجم نص تشغيل الفيديو", "range", 0, group="الافتتاحية",
          minimum=0, maximum=96, step=1, unit="px", editor_hidden=True),

    field("intro_play_bg_color", "لون خلفية زر تشغيل الفيديو", "color", "", group="الافتتاحية",
          editor_hidden=True,
          help_text="قيمة توافقية للزر القديم."),

        field("intro_video", "فيديو الافتتاحية", "media", "", group="الافتتاحية",
          media_kind="video",
          help_text="فيديو قصير (٣-٧ ثواني). اختار بعده يبدأ بصوت أو بدون صوت. "
               "التشغيل التلقائي قد يفرض الكتم حسب المتصفح."),
    field("intro_video_audio", "صوت فيديو الافتتاحية", "select", "silent",
          group="الافتتاحية", options=[
              opt("silent", "بدون صوت"),
              opt("sound", "بصوت"),
          ],
          help_text="اختار هل يبدأ الفيديو بصوت أو بدون صوت. للحصول على صوت "
               "مضمون من أول لحظة، استخدم أحد أوضاع البداية بالزر."),
    field("intro_poster", "صورة غلاف الفيديو", "image", "", group="الافتتاحية"),

    field("intro_play_mode", "بداية الفيديو", "select", "autoplay",
          group="الافتتاحية", options=[
              opt("autoplay", "يبدأ لوحده (تشغيل تلقائي)"),
              opt("button", "يبدأ بزر بدون تأثيرات"),
              opt("button_effects", "يبدأ بزر بتأثيرات"),
          ],
          help_text="اختار طريقة بداية فيديو الافتتاحية: التشغيل التلقائي يبدأ "
               "صامتاً، أو زر عادي، أو زر مع النبضة والتأثيرات البصرية."),

    field("intro_play_label", "نص على زر التشغيل", "text", "", group="الافتتاحية",
          placeholder="مثال: اضغط لتشغيل الفيديو",
          help_text="سيبها فاضية = الزر يفضل دايرة بعلامة تشغيل بس. لو "
               "كتبت كلام الزر بيتحوّل لكبسولة والكلام جنب العلامة."),

    field("intro_video_seconds", "يقفل تلقائياً بعد (ثانية)", "range", 0,
          minimum=0, maximum=15, step=1, group="الافتتاحية",
          help_text="صفر = يستنى الضيف يضغط. أي رقم = الدعوة تفتح لوحدها بعده."),
    field("intro_image", "صورة خلفية الافتتاحية", "image", "", group="الافتتاحية"),
    # حقلا الإزاحة القديمة مخفيان للتوافق مع الدعوات التي حُفظت قبل السحب المستقل.
    field("intro_text_x", "موضع نص الافتتاحية القديم أفقياً", "range", 0,
          group="الافتتاحية", minimum=-35, maximum=35, step=1, unit="vw",
          translate=False, editor_hidden=True),
    field("intro_text_y", "موضع نص الافتتاحية القديم رأسياً", "range", 0,
          group="الافتتاحية", minimum=-35, maximum=35, step=1, unit="vh",
          translate=False, editor_hidden=True),
        field("intro_font", "الخط الافتراضي للخطوط القديمة", "font", "", group="الافتتاحية",
          options=FONT_CHOICES, editor_hidden=True,
          help_text="قيمة توافقية للدعوات القديمة؛ استخدم ترس النص لتغيير الخط."),

    field("intro_item_positions", "مواضع عناصر الافتتاحية", "text", "", group="الافتتاحية",
          translate=False, editor_hidden=True),

    field("auto_scroll", "تمرير تلقائي", "toggle", False, group="التمرير",
          help_text="الدعوة بتنزل لوحدها بالراحة زي العرض. بتقف فوراً أول "
               "ما الضيف يلمس الشاشة أو يمرّر بنفسه، وفيه زر إيقاف ظاهر."),
    field("auto_scroll_speed", "سرعة التمرير", "select", "normal",
          group="التمرير", options=[
              opt("slow", "بطيء"), opt("normal", "عادي"), opt("fast", "سريع"),
          ]),
    field("auto_scroll_delay", "يبدأ بعد (ثانية)", "range", 3, group="التمرير",
          minimum=0, maximum=20, step=1,
          help_text="مهلة قبل ما يبدأ عشان الضيف يقرا أول قسم براحته."),
    field("auto_scroll_loop", "يرجع للأول لما يخلص", "toggle", False,
          group="التمرير"),

    field("favicon", "أيقونة الصفحة", "image", "", group="مشاركة"),
    field("share_image", "صورة المعاينة عند المشاركة", "image", "", group="مشاركة"),
    field("share_title", "عنوان المشاركة", "text", "", group="مشاركة"),
    field("share_description", "وصف المشاركة", "text", "", group="مشاركة"),
    field("show_branding", "إظهار توقيع المنصة", "toggle", True, group="مشاركة"),
]


# نصوص الافتتاحية: حقول الخط واللون والحجم موجودة من الأول وبيقراها
# ‎renderer.intro_item_css‎، فهنا بنقول للمحرر بس إن كل واحد منهم بتاع
# أنهي نص — عشان يطلعوا جوّه ترس النص ده بدل خريطة مكتوبة بالإيد في
# ‎editor.js‎ كانت لازم تتحدّث مع كل حقل جديد.
INTRO_TEXT_STYLE = {
    "intro_note": {
        "font": "intro_note_font", "color": "intro_note_color",
        "size": "intro_note_size",
    },
    "intro_text": {
        "font": "intro_text_font", "color": "intro_text_color",
        "size": "intro_text_size",
    },
    "intro_button": {
        "font": "intro_button_font", "color": "intro_button_color",
        "size": "intro_button_size",
    },
    "intro_play_label": {
        "font": "intro_play_font", "color": "intro_play_color",
        "size": "intro_play_size",
    },
}


def _mark_settings_text_styles() -> None:
    by_key = {f["key"]: f for f in SETTINGS_FIELDS}
    for owner, roles in INTRO_TEXT_STYLE.items():
        if owner not in by_key:
            continue
        for role, key in roles.items():
            spec = by_key.get(key)
            if not spec:
                continue
            spec["style_of"] = owner
            spec["style_role"] = role
            spec["editor_hidden"] = True


_mark_settings_text_styles()


# --------------------------------------------------------------------------
# أدوات بناء المستند والتحقق منه
# --------------------------------------------------------------------------
_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,63}$")


def new_block_id(btype: str) -> str:
    return f"{btype}-{uuid.uuid4().hex[:6]}"


def _defaults(specs: list[dict]) -> dict:
    out = {}
    for spec in specs:
        out[spec["key"]] = copy.deepcopy(spec.get("default"))
    return out


def default_theme() -> dict:
    return _defaults(THEME_FIELDS)


def default_settings() -> dict:
    return _defaults(SETTINGS_FIELDS)


def make_block(btype: str, props: dict | None = None, style: dict | None = None,
               visible: bool = True) -> dict:
    if btype not in BLOCK_REGISTRY:
        raise ValueError(f"نوع بلوك غير معروف: {btype}")
    spec = BLOCK_REGISTRY[btype]
    block = {
        "id": new_block_id(btype),
        "type": btype,
        "visible": visible,
        "locked": False,
        "props": _defaults(spec["props"]),
        "style": _defaults(spec["style"]),
    }
    if props:
        block["props"].update(props)
    if style:
        block["style"].update(style)
    return block


def empty_document() -> dict:
    return {
        "version": DOCUMENT_VERSION,
        "theme": default_theme(),
        "settings": default_settings(),
        "blocks": [],
    }


# تمثيل بايثون لـdict بمفتاح واحد — أثر باج قديم في ترس الخط، اتسرّب
# لخانات النص واتخزّن. مافيش نص حقيقي بيبقى بالشكل ده.
_PY_REPR_RE = re.compile(r"\{'[A-Za-z_][A-Za-z0-9_]*':\s*'[^']*'\}")


def _coerce(value: Any, spec: dict) -> Any:
    """يحوّل قيمة قادمة من المتصفح إلى النوع الصحيح، ويرجع الافتراضي عند الفشل."""
    ftype = spec["type"]
    default = copy.deepcopy(spec.get("default"))

    if ftype == "toggle":
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on"}
        return bool(default)

    if ftype in {"number", "range"}:
        try:
            num = float(value)
        except (TypeError, ValueError):
            return default
        if spec.get("min") is not None:
            num = max(float(spec["min"]), num)
        if spec.get("max") is not None:
            num = min(float(spec["max"]), num)
        return int(num) if float(num).is_integer() else round(num, 3)

    if ftype == "select":
        allowed = {o["value"] for o in spec.get("options", [])}
        return value if value in allowed else default

    if ftype == "align":
        return value if value in {"right", "center", "left"} else default

    if ftype == "font":
        allowed = {o["value"] for o in FONT_CHOICES}
        custom = isinstance(value, str) and re.fullmatch(
            r"'[A-Za-z][A-Za-z0-9 _-]{0,119}'(?:,\s*(?:sans-serif|serif|cursive))?",
            value.strip(),
        )
        if value in allowed or value == "" or custom:
            return value.strip() if isinstance(value, str) else value
        return default

    if ftype == "color":
        if isinstance(value, str) and re.fullmatch(
            r"(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent|)", value.strip()
        ):
            return value.strip()
        return default

    if ftype == "list":
        if not isinstance(value, list):
            return default if isinstance(default, list) else []
        sub_specs = spec.get("fields", [])
        cleaned = []
        for item in value[:80]:  # حد أعلى لعدد العناصر
            if not isinstance(item, dict):
                continue
            row = {}
            for sub in sub_specs:
                row[sub["key"]] = _coerce(item.get(sub["key"]), sub)
            cleaned.append(row)
        return cleaned

    if ftype == "url":
        if not isinstance(value, str):
            return default
        val = value.strip()
        if not val:
            return ""
        # منع javascript: وschemes الخطرة
        if re.match(r"^\s*(javascript|data|vbscript)\s*:", val, re.I):
            return ""
        return val[:1000]

    if ftype == "html":
        from .sanitize import clean_html
        # القوالب المستوردة قد تحتوي على صفحة كاملة؛ حد 5000 كان يقطع
        # أقساماً مهمة من HTML بعد الحفظ. التنقية نفسها ما زالت مطبقة.
        return clean_html(value if isinstance(value, str) else "", max_length=100000)

    if ftype == "textarea" and spec.get("key") == "css":
        # stylesheet كامل للقالب المستورد، مع إبقاء حد أعلى مستقل حتى لا
        # تتسرب قيمة ضخمة إلى قاعدة البيانات.
        return str(value or "")[:250000]

    if ftype in {"image", "media"}:
        # دول مسارات ملفات زي url بالظبط، فبيتصفّوا بنفس الطريقة. الحقل
        # كان type="url" وبقى "media" عشان يظهر معاه زر الرفع — من غير
        # السطر ده كان الفلتر بتاع javascript: بيتشال معاه من غير ما يبان.
        if not isinstance(value, str):
            return default
        val = value.strip()
        if not val:
            return ""
        if re.match(r"^\s*(javascript|vbscript)\s*:", val, re.I):
            return ""
        # data: مسموح للصور المضمّنة بس (المحرر بيولّدها عند القص)
        if re.match(r"^\s*data\s*:", val, re.I) and not re.match(
            r"^\s*data:image/(png|jpeg|webp|gif);base64,", val, re.I
        ):
            return ""
        return val[:5000]

    # text / textarea / date / datetime / icon / gradient
    if value is None:
        return default
    if isinstance(value, (dict, list, bool)):
        # قيمة مركّبة في خانة نص معناها باج في المحرر. ‎str()‎ كانت
        # بتخزّن تمثيل بايثون للـdict — ‎{'key': 'intro_play_font'}‎ —
        # ويتعرض للضيف على إنه نص الزر.
        return default
    if isinstance(value, str) and _PY_REPR_RE.fullmatch(value.strip()):
        # نص اتخزّن قبل الإصلاح ده وفضل متخرّب في قاعدة البيانات.
        # محدش بيكتب ده بإيده، فتنضيفه أأمن من عرضه للضيف.
        return default
    return str(value)[:5000]


INTRO_PLAY_MODES = {"autoplay", "button", "button_effects"}
INTRO_VIDEO_AUDIO_MODES = {"silent", "sound"}


def _legacy_intro_video_audio(settings: dict) -> str:
    """يحوّل إعداد زر الصوت القديم إلى اختيار صوت ثابت للفيديو."""
    explicit = settings.get("intro_video_audio")
    if explicit in INTRO_VIDEO_AUDIO_MODES:
        return explicit

    old_sound = settings.get("intro_video_sound")
    if isinstance(old_sound, str):
        old_sound = old_sound.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(old_sound, bool):
        return "sound" if old_sound else "silent"
    return "silent"


def _legacy_intro_play_mode(settings: dict) -> str:
    """يحوّل إعدادات بداية الفيديو القديمة للوضع الجديد بدون فقدها."""
    explicit = settings.get("intro_play_mode")
    if explicit in INTRO_PLAY_MODES:
        return explicit

    # لا توجد مفاتيح قديمة؟ هذا مستند جديد، فنلتزم بالقيمة الافتراضية
    # المعلنة في schema: تشغيل تلقائي.
    legacy_keys = {"intro_video_start", "intro_autoplay", "intro_play_effects"}
    if not any(key in settings for key in legacy_keys):
        return "autoplay"

    # intro_video_start هو الاسم القديم الظاهر في لوحة الإعدادات.
    old_start = settings.get("intro_video_start")
    if old_start in {"auto", "autoplay"}:
        return "autoplay"

    # بعض المستندات الأقدم خزّنت العلم باسم intro_autoplay فقط.
    if settings.get("intro_autoplay") is True:
        return "autoplay"

    # الوضع القديم ذي الزر يتحول إلى زر مؤثر افتراضياً، أو زر عادي إذا
    # كان المستخدم قد أغلق تأثيرات الزر قبل تحديث schema.
    effects = settings.get("intro_play_effects")
    if isinstance(effects, str):
        effects = effects.strip().lower() in {"1", "true", "yes", "on"}
    return "button" if effects is False else "button_effects"


def normalize_document(raw: Any, *, allowed_features: set[str] | None = None) -> dict:

    """ينظّف مستنداً قادماً من المستخدم ويعيده بشكل آمن ومكتمل.

    كل قيمة غير معروفة تُستبدل بالافتراضي، وكل بلوك غير مسجّل يُحذف.
    هذه الدالة هي الحاجز الوحيد بين مدخلات المتصفح وقاعدة البيانات.
    """
    doc = raw if isinstance(raw, dict) else {}
    out = {"version": DOCUMENT_VERSION}

    # ---- theme
    theme_raw = doc.get("theme") if isinstance(doc.get("theme"), dict) else {}
    out["theme"] = {s["key"]: _coerce(theme_raw.get(s["key"]), s) for s in THEME_FIELDS}

    # ---- settings
    set_raw = doc.get("settings") if isinstance(doc.get("settings"), dict) else {}
    settings_for_schema = dict(set_raw)
    settings_for_schema["intro_play_mode"] = _legacy_intro_play_mode(set_raw)
    settings_for_schema["intro_video_audio"] = _legacy_intro_video_audio(set_raw)
    out["settings"] = {
        s["key"]: _coerce(settings_for_schema.get(s["key"]), s)
        for s in SETTINGS_FIELDS
    }

    # نحتفظ بالمفاتيح القديمة داخل المستند للتوافق مع أي نسخة قديمة من
    # التطبيق أو أدوات التصدير، لكن لا نعرضها في schema ولا نستخدمها إذا
    # كان intro_play_mode موجوداً.
    for legacy_key in ("intro_video_start", "intro_autoplay", "intro_play_effects", "intro_video_sound"):
        if legacy_key not in set_raw:
            continue
        value = set_raw.get(legacy_key)
        if legacy_key == "intro_video_start":
            if isinstance(value, str) and value in {"auto", "autoplay", "button"}:
                out["settings"][legacy_key] = value
        elif legacy_key == "intro_autoplay":
            if isinstance(value, bool):
                out["settings"][legacy_key] = value
            elif isinstance(value, str):
                out["settings"][legacy_key] = value.strip().lower() in {"1", "true", "yes", "on"}
        else:
            if isinstance(value, bool):
                out["settings"][legacy_key] = value
            elif isinstance(value, str):
                out["settings"][legacy_key] = value.strip().lower() in {"1", "true", "yes", "on"}

    # ---- blocks

    blocks_raw = doc.get("blocks") if isinstance(doc.get("blocks"), list) else []
    seen_ids: set[str] = set()
    seen_singletons: set[str] = set()
    blocks = []
    for item in blocks_raw[:120]:  # حد أعلى لعدد الأقسام
        if not isinstance(item, dict):
            continue
        btype = item.get("type")
        spec = BLOCK_REGISTRY.get(btype)
        if not spec:
            continue
        if spec["singleton"]:
            if btype in seen_singletons:
                continue
            seen_singletons.add(btype)
        if allowed_features is not None and spec["feature"] and spec["feature"] not in allowed_features:
            # الميزة غير متاحة في الباقة — نحتفظ بالبلوك لكن مخفياً
            item = {**item, "visible": False, "_gated": True}

        bid = item.get("id")
        if not (isinstance(bid, str) and _ID_RE.match(bid)) or bid in seen_ids:
            bid = new_block_id(btype)
        seen_ids.add(bid)

        props_raw = item.get("props") if isinstance(item.get("props"), dict) else {}
        style_raw = item.get("style") if isinstance(item.get("style"), dict) else {}
        slots = {s["key"] for s in spec["props"]}

        # اسم يكتبه المستخدم للقسم. مهم جداً للقوالب المستوردة: من غيره
        # كل أقسامها بتظهر في القائمة باسم واحد «كود HTML مخصص» ومحدش
        # يعرف أنهي واحد فيهم.
        label = item.get("label")
        label = label.strip()[:60] if isinstance(label, str) else ""

        blocks.append({
            "id": bid,
            "type": btype,
            "label": label,
            "visible": bool(item.get("visible", True)),
            "locked": bool(item.get("locked", False)),
            "gated": bool(item.get("_gated", False)),
            "props": {s["key"]: _coerce(props_raw.get(s["key"]), s) for s in spec["props"]},
            "style": {s["key"]: _coerce(style_raw.get(s["key"]), s) for s in spec["style"]},
            "layout": _clean_layout(item.get("layout"), slots),
        })

    out["blocks"] = blocks
    out["i18n"] = _clean_i18n(doc.get("i18n"))
    return out


# --------------------------------------------------------------------------
# الترجمة اليدوية — نسخة تانية من نصوص الدعوة
# --------------------------------------------------------------------------
# القرار: مفيش ترجمة آلية. المصمّم بيكتب النسخة الإنجليزية بإيده من
# تبويب «الترجمة» في المحرر، والدعوة بتخزّنها جنب العربي بنفس المستند.
# لو ما كتبش حاجة، زرار اللغة مابيظهرش للضيف أصلاً.
#
# المفتاح نص بنقط عشان يعيش في JSON ويتقرا في اللوحة:
#   data.name_one          → بيانات الدعوة (عايشة في جدول الدعوة مش المستند)
#   settings.intro_text    → إعدادات المستند
#   hero-ab12cd.kicker     → حقل نصي جوّه بلوك
#   agenda-x.items.0.title → عنصر جوّه حقل قائمة
I18N_LANGS = ("en",)
TRANSLATABLE_TYPES = {"text", "textarea"}
MAX_I18N_ENTRIES = 600
MAX_I18N_VALUE = 2000

# بيانات الدعوة مش جزء من المستند (عايشة في جدول ‎Invitation‎)، لكنها
# بتظهر للضيف — فلازم تترجم زي أي نص تاني.
DATA_TRANSLATABLE = [
    ("name_one", "الاسم الأول"),
    ("name_two", "الاسم الثاني"),
    ("event_type", "نوع المناسبة"),
    ("venue", "اسم القاعة"),
    ("address", "العنوان"),
    ("date_text", "نص التاريخ"),
    ("time_text", "نص الوقت"),
]


def _clean_i18n(raw: Any) -> dict:
    """ينضّف خريطة الترجمة الجاية من المتصفح.

    مفاتيح وقيم نصية بس، بحد أقصى للطول وللعدد — الخريطة دي بتتحفظ
    في نفس عمود المستند فماينفعش تكبر بلا سقف.
    """
    out: dict[str, dict[str, str]] = {}
    src = raw if isinstance(raw, dict) else {}
    for lang in I18N_LANGS:
        table = src.get(lang) if isinstance(src.get(lang), dict) else {}
        clean: dict[str, str] = {}
        for key, value in list(table.items())[:MAX_I18N_ENTRIES]:
            if not isinstance(key, str) or not key.strip():
                continue
            if not isinstance(value, str):
                continue
            value = value.strip()
            if not value:
                continue                      # الفاضي = مترجمش، مش نص فاضي
            clean[key.strip()[:200]] = value[:MAX_I18N_VALUE]
        out[lang] = clean
    return out


def _entry(key: str, label: str, value: Any, group: str) -> dict | None:
    """صف واحد في جدول الترجمة — أو ``None`` لو النص فاضي."""
    if not isinstance(value, str) or not value.strip():
        return None
    return {"key": key, "label": label, "value": value, "group": group}


def translatable_entries(doc: dict, data: dict | None = None) -> list[dict]:
    """كل النصوص اللي ينفع تترجم في الدعوة، بالترتيب اللي بتظهر بيه.

    بيرجّع قايمة صفوف ``{key, label, value, group}`` — المحرر بيبني منها
    جدول «عربي ← إنجليزي»، والعارض بيستعمل نفس المفاتيح في القراءة.
    """
    rows: list[dict] = []

    for key, label in DATA_TRANSLATABLE:
        row = _entry(f"data.{key}", label, (data or {}).get(key), "بيانات المناسبة")
        if row:
            rows.append(row)

    settings = doc.get("settings") if isinstance(doc.get("settings"), dict) else {}
    for spec in SETTINGS_FIELDS:
        if spec["type"] not in TRANSLATABLE_TYPES:
            continue
        row = _entry(f"settings.{spec['key']}", spec["label"],
                     settings.get(spec["key"]), "إعدادات الدعوة")
        if row:
            rows.append(row)

    for block in doc.get("blocks") or []:
        if not isinstance(block, dict):
            continue
        spec = BLOCK_REGISTRY.get(block.get("type"))
        if not spec:
            continue
        bid = block.get("id") or ""
        group = block.get("label") or spec["label"]
        props = block.get("props") if isinstance(block.get("props"), dict) else {}

        for fspec in spec["props"]:
            if fspec.get("translate") is False:
                continue                      # كود مش كلام يشوفه الضيف
            value = props.get(fspec["key"])
            if fspec["type"] == "html":
                # القسم المستورد: الكلام جوّه الكود نفسه، فبنسحب وحدات
                # النص اللي المحرر معلّمها ونعرضها واحدة واحدة.
                for move, text in customtext.text_units(value or ""):
                    row = _entry(f"{bid}.{fspec['key']}#{move}", "نص", text, group)
                    if row:
                        rows.append(row)
                continue
            if fspec["type"] in TRANSLATABLE_TYPES:
                row = _entry(f"{bid}.{fspec['key']}", fspec["label"], value, group)
                if row:
                    rows.append(row)
            elif fspec["type"] == "list" and isinstance(value, list):
                # عناصر القوايم: برنامج الحفل، أصحاب الدعوة، الأزرار،
                # تعليقات المعرض — كلها نصوص بيشوفها الضيف.
                for i, item in enumerate(value[:60]):
                    if not isinstance(item, dict):
                        continue
                    for sub in fspec.get("fields") or []:
                        if sub["type"] not in TRANSLATABLE_TYPES:
                            continue
                        row = _entry(
                            f"{bid}.{fspec['key']}.{i}.{sub['key']}",
                            f"{fspec['label']} {i + 1} — {sub['label']}",
                            item.get(sub["key"]), group,
                        )
                        if row:
                            rows.append(row)
    return rows


def translation_table(doc: dict, lang: str = "en") -> dict:
    return (doc.get("i18n") or {}).get(lang) or {}


def has_translation(doc: dict, lang: str = "en") -> bool:
    """فيه نسخة مكتوبة فعلاً؟ ده اللي بيقرر ظهور زرار اللغة للضيف."""
    return bool(translation_table(doc, lang))


def apply_i18n(doc: dict, lang: str) -> dict:
    """نسخة من المستند بنصوص اللغة المطلوبة.

    أي مفتاح مش مترجم بيفضل بقيمته العربية — نص ناقص أحسن من فراغ.
    المستند الأصلي مابيتلمسش (المحرر والعرض بيشتغلوا على نفس الكائن).
    """
    table = translation_table(doc, lang)
    if not table:
        return doc

    out = copy.deepcopy(doc)
    settings = out.get("settings") or {}
    # الأقسام المستوردة: بنجمّع كل نصوص القسم الأول وبعدين نمرّ على
    # الكود مرة واحدة. تمريرة لكل نص كانت هتعيد تحليل الصفحة كلها
    # عشرات المرات على الفاضي.
    pending: dict[str, dict[str, dict[str, str]]] = {}
    for key, value in table.items():
        parts = key.split(".")
        if parts[0] == "settings" and len(parts) == 2:
            if parts[1] in settings:
                settings[parts[1]] = value
            continue
        if parts[0] == "data":
            continue                          # بتتطبّق على سياق البيانات مش المستند

        block = next((b for b in out.get("blocks") or []
                      if b.get("id") == parts[0]), None)
        if not block:
            continue
        props = block.get("props")
        if not isinstance(props, dict):
            continue
        if len(parts) == 2 and "#" in parts[1]:
            # ‎<block>.<prop>#<data-move>‎ — نص جوّه قسم مستورد
            prop, _, move = parts[1].partition("#")
            if isinstance(props.get(prop), str):
                pending.setdefault(parts[0], {}).setdefault(prop, {})[move] = value
            continue
        if len(parts) == 2 and parts[1] in props:
            props[parts[1]] = value
        elif len(parts) == 4 and isinstance(props.get(parts[1]), list):
            try:
                item = props[parts[1]][int(parts[2])]
            except (ValueError, IndexError):
                continue
            if isinstance(item, dict) and parts[3] in item:
                item[parts[3]] = value

    for bid, fields in pending.items():
        block = next((b for b in out.get("blocks") or []
                      if b.get("id") == bid), None)
        if not block:
            continue
        for prop, mapping in fields.items():
            block["props"][prop] = customtext.replace_texts(
                block["props"].get(prop) or "", mapping)
    return out


def apply_i18n_data(data: dict, doc: dict, lang: str) -> dict:
    """نفس الحكاية لبيانات المناسبة — الأسماء والقاعة والعنوان."""
    table = translation_table(doc, lang)
    if not table:
        return data
    out = dict(data)
    for key, _label in DATA_TRANSLATABLE:
        value = table.get(f"data.{key}")
        if value:
            out[key] = value
    return out


def feature_keys() -> set[str]:
    """كل مفاتيح المزايا اللي المحرك بيعرفها — من البلوكات والإعدادات.

    الباقات والإضافات بتتحقّق من المفاتيح دي، عشان مايتباعش لعميل
    مفتاح مش موجود أصلاً في المحرك فيدفع ومايتغيّرش عنده حاجة.
    """
    keys = {b["feature"] for b in BLOCK_REGISTRY.values() if b.get("feature")}
    keys |= {f["feature"] for f in SETTINGS_FIELDS if f.get("feature")}
    for b in BLOCK_REGISTRY.values():
        keys |= {p["feature"] for p in b.get("props", []) if p.get("feature")}
    return keys


def editor_schema() -> dict:
    """الوصف الكامل الذي يبني منه المحرر واجهته. يُمرَّر للمتصفح كـJSON."""
    return {
        "version": DOCUMENT_VERSION,
        "blocks": BLOCK_REGISTRY,
        "theme_fields": THEME_FIELDS,
        "settings_fields": SETTINGS_FIELDS,
        "fonts": FONT_CHOICES,
        "animations": ANIMATION_CHOICES,
        "dividers": DIVIDER_CHOICES,
        "layout_max": {"x": LAYOUT_MAX_X, "y": LAYOUT_MAX_Y},
    }
