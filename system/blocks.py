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
) -> dict:
    """تعريف حقل واحد داخل المحرر."""
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
# سجل أنواع البلوكات
# --------------------------------------------------------------------------
BLOCK_REGISTRY: dict[str, dict] = {}

# ---------------------------------------------------------------- المواضع
# كل عنصر نص جوّه القسم ليه data-slot. المحرر بيسمح بإزاحته بالماوس،
# والإزاحة بتتخزن بوحدة cqw = ١٪ من عرض مسرح الدعوة — يعني نسبة مش بكسل،
# فبتفضل مظبوطة على أي مقاس شاشة من غير ما نخزّن موضع لكل جهاز.
LAYOUT_MAX_X = 45.0    # cqw
LAYOUT_MAX_Y = 40.0    # cqw
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
    BLOCK_REGISTRY[btype] = {
        "type": btype,
        "label": label,
        "icon": icon,
        "description": description,
        "category": category,
        "props": props,
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
        field("url", "رابط الفيديو", "url", ""),
        field("poster", "صورة الغلاف", "image", ""),
        field("heading", "العنوان", "text", ""),
        field("autoplay", "تشغيل تلقائي (صامت)", "toggle", False),
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
        field("phone_label", "عنوان حقل الهاتف", "text", "رقم الهاتف"),
        field("phone_required", "الهاتف مطلوب", "toggle", False),
        field("ask_companions", "السؤال عن المرافقين", "toggle", True, feature="companions"),
        field("companions_label", "عنوان حقل المرافقين", "text", "عدد المرافقين"),
        field("max_companions", "أقصى عدد مرافقين", "number", 5, minimum=0, maximum=20),
        field("ask_message", "السؤال عن رسالة", "toggle", True),
        field("message_label", "عنوان حقل الرسالة", "text", "كلمة للعروسين"),
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
        field("css", "ستايل القسم", "textarea", "", group="كود متقدّم",
              help_text="يُحصر داخل هذا القسم فقط — لن يؤثر على باقي الدعوة"),
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
    field("intro_text", "نص الافتتاحية", "text", "اضغط لفتح الدعوة", group="الافتتاحية"),
    field("intro_button", "نص الزر", "text", "التالي ←", group="الافتتاحية"),
    field("intro_video", "فيديو الافتتاحية", "media", "", group="الافتتاحية",
          media_kind="video",
          help_text="فيديو قصير (٣-٧ ثواني). بيبدأ صامت إجبارياً — كل "
               "المتصفحات بتمنع الصوت التلقائي. حط صورة غلاف عشان تظهر "
               "فوراً قبل ما يحمّل."),
    field("intro_poster", "صورة غلاف الفيديو", "image", "", group="الافتتاحية"),
    field("intro_video_start", "بداية الفيديو", "select", "auto",
          group="الافتتاحية", options=[
              opt("auto", "يبدأ لوحده (صامت)"),
              opt("button", "يبدأ لما الضيف يدوس زر"),
          ],
          help_text="زر التشغيل ليه ميزة: لمسة الضيف بتسمح بالصوت من "
               "أول ثانية — التشغيل التلقائي لازم يبدأ صامت."),
    field("intro_video_sound", "زر صوت على الفيديو", "toggle", True,
          group="الافتتاحية",
          help_text="لو الفيديو فيه صوت، الزر ده بيخلي الضيف يشغّله بلمسة. "
               "من غيره الفيديو بيفضل صامت — مفيش طريقة تانية مسموحة."),
    field("intro_video_seconds", "يقفل تلقائياً بعد (ثانية)", "range", 0,
          minimum=0, maximum=15, step=1, group="الافتتاحية",
          help_text="صفر = يستنى الضيف يضغط. أي رقم = الدعوة تفتح لوحدها بعده."),
    field("intro_image", "صورة خلفية الافتتاحية", "image", "", group="الافتتاحية"),
    field("favicon", "أيقونة الصفحة", "image", "", group="مشاركة"),
    field("share_image", "صورة المعاينة عند المشاركة", "image", "", group="مشاركة"),
    field("share_title", "عنوان المشاركة", "text", "", group="مشاركة"),
    field("share_description", "وصف المشاركة", "text", "", group="مشاركة"),
    field("show_branding", "إظهار توقيع المنصة", "toggle", True, group="مشاركة"),
]


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
        if value in allowed or value == "":
            return value
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
        return clean_html(value if isinstance(value, str) else "")

    # text / textarea / image / date / datetime / icon / gradient
    if value is None:
        return default
    return str(value)[:5000]


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
    out["settings"] = {s["key"]: _coerce(set_raw.get(s["key"]), s) for s in SETTINGS_FIELDS}

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
    return out


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
