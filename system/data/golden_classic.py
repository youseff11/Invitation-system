"""القالب الأصلي «ذهبي كلاسيكي».

تصميم أصلي بالكامل — كل عنصر فيه بلوك قابل للتعديل من المحرر.
يُستخدم أيضاً كمرجع لبنية أي قالب جديد.
"""

from __future__ import annotations

from .. import blocks as B


def build() -> dict:
    doc = B.empty_document()

    doc["theme"].update({
        "bg": "#f8f4ec",
        "surface": "#ffffff",
        "text": "#2e2721",
        "muted": "#847767",
        "accent": "#b8914f",
        "accent_soft": "#e9dcc2",
        "border": "#e6dcc9",
        "hero_overlay": 45,
        "font_heading": "'Amiri', serif",
        "font_body": "'Tajawal', sans-serif",
        "font_scale": 1.0,
        "letter_spacing": 0,
        "radius": 14,
        "max_width": 760,
        "section_gap": 0,
        "shadow": "soft",
        "pattern": "paper",
        "pattern_opacity": 10,
        "direction": "rtl",
        "animations_enabled": True,
    })

    doc["settings"].update({
        "intro_enabled": True,
        "intro_text": "تشرّفنا بدعوتكم — اضغط لفتح الدعوة",
        "intro_button": "افتح الدعوة",
        "music_player": "floating",
        "music_autoplay": True,
        "music_loop": True,
        "show_branding": True,
    })

    blocks = [
        # ---------------------------------------------------------- الغلاف
        B.make_block("hero", props={
            "kicker": "دعوة زفاف",
            "name_one": "",
            "separator": "&",
            "name_two": "",
            "names_layout": "stacked",
            "subtitle": "يتشرفان بدعوتكم لمشاركتهما فرحة العمر",
            "date_text": "",
            "height": "full",
            "name_size": 82,
            "name_size_mobile": 48,
            "name_spacing": 1,
            "show_scroll_hint": True,
            "scroll_hint_text": "مرّر للأسفل",
            "buttons": [
                {"label": "تأكيد الحضور", "action": "rsvp", "target": "#rsvp",
                 "style": "solid", "icon": "heart"},
                {"label": "الموقع على الخريطة", "action": "map", "target": "",
                 "style": "ghost", "icon": "pin"},
            ],
        }, style={
            "bg_color": "#2e2721",
            "text_color": "#ffffff",
            "accent_color": "#d9b871",
            "bg_overlay": 45,
            "align": "center",
            "width": "normal",
            "padding_top": 90,
            "padding_bottom": 90,
            "divider_top": "diamond",
            "divider_bottom": "diamond",
            "animation": "fade",
        }),

        # ---------------------------------------------------------- الآية
        B.make_block("quote", props={
            "text": "وَمِنْ آيَاتِهِ أَنْ خَلَقَ لَكُم مِّنْ أَنفُسِكُمْ أَزْوَاجًا "
                    "لِّتَسْكُنُوا إِلَيْهَا وَجَعَلَ بَيْنَكُم مَّوَدَّةً وَرَحْمَةً",
            "source": "سورة الروم — الآية ٢١",
            "frame": "arabesque",
            "quote_font": "'Amiri', serif",
            "quote_size": 25,
        }, style={
            "align": "center", "width": "narrow",
            "padding_top": 70, "padding_bottom": 60,
            "animation": "rise",
        }),

        # ---------------------------------------------------------- أصحاب الدعوة
        B.make_block("hosts", props={
            "heading": "بدعوة من",
            "columns": 2,
            "entries": [
                {"label": "والد العروس", "name": "الأستاذ / …"},
                {"label": "والد العريس", "name": "الأستاذ / …"},
            ],
        }, style={
            "align": "center", "width": "normal",
            "padding_top": 50, "padding_bottom": 50,
            "bg_color": "#f2ebdd",
            "animation": "fade",
        }),

        # ---------------------------------------------------------- كلمة ترحيب
        B.make_block("text", props={
            "eyebrow": "كلمة من القلب",
            "heading": "وجودكم هو الهدية",
            "body": "<p>يسعدنا أن تشاركونا أجمل فصول حياتنا، "
                    "وننتظر أن تكتمل فرحتنا بحضوركم.</p>",
            "heading_size": 38,
            "body_size": 17,
            "body_line_height": 2.0,
        }, style={
            "align": "center", "width": "narrow",
            "padding_top": 70, "padding_bottom": 60,
            "divider_bottom": "floral",
            "animation": "rise",
        }),

        # ---------------------------------------------------------- العد التنازلي
        B.make_block("countdown", props={
            "eyebrow": "باقٍ على الفرح",
            "heading": "موعدنا يقترب",
            "variant": "boxes",
            "number_size": 42,
            "show_seconds": True,
            "finished_text": "بدأ الفرح — نراكم الآن",
        }, style={
            "align": "center", "width": "normal",
            "padding_top": 60, "padding_bottom": 70,
            "animation": "zoom",
        }),

        # ---------------------------------------------------------- التفاصيل
        B.make_block("details", props={
            "eyebrow": "الاحتفال",
            "heading": "تفاصيل اليوم",
            "layout": "cards",
            "columns": 3,
            "rows": [
                {"icon": "calendar", "label": "التاريخ", "value": "", "hint": "", "auto": "date"},
                {"icon": "clock", "label": "الوقت", "value": "", "hint": "", "auto": "time"},
                {"icon": "pin", "label": "المكان", "value": "", "hint": "", "auto": "venue"},
            ],
        }, style={
            "align": "center", "width": "wide",
            "padding_top": 60, "padding_bottom": 60,
            "bg_color": "#f2ebdd",
            "animation": "rise",
        }),

        # ---------------------------------------------------------- البرنامج
        B.make_block("agenda", props={
            "heading": "برنامج الحفل",
            "items": [
                {"time": "٧:٣٠ م", "title": "استقبال الضيوف", "note": "", "icon": "star"},
                {"time": "٨:٣٠ م", "title": "الزفة", "note": "", "icon": "music"},
                {"time": "٩:٣٠ م", "title": "العشاء", "note": "", "icon": "gift"},
            ],
        }, style={
            "align": "center", "width": "normal",
            "padding_top": 60, "padding_bottom": 60,
            "animation": "fade",
        }, visible=False),

        # ---------------------------------------------------------- الموقع
        B.make_block("location", props={
            "eyebrow": "الموقع",
            "heading": "مكان الاحتفال",
            "venue": "",
            "address": "",
            "show_map": True,
            "map_height": 320,
            "directions_label": "افتح الاتجاهات",
            "notes": "",
        }, style={
            "align": "center", "width": "normal",
            "padding_top": 60, "padding_bottom": 60,
            "divider_top": "diamond",
            "animation": "rise",
        }),

        # ---------------------------------------------------------- المعرض
        B.make_block("gallery", props={
            "heading": "لحظات من حكايتنا",
            "images": [],
            "layout": "grid",
            "columns": 3,
            "gap": 10,
            "image_radius": 6,
            "aspect": "4/5",
            "lightbox": True,
        }, style={
            "align": "center", "width": "wide",
            "padding_top": 60, "padding_bottom": 60,
            "animation": "fade",
        }, visible=False),

        # ---------------------------------------------------------- RSVP
        B.make_block("rsvp", props={
            "eyebrow": "تأكيد الحضور",
            "heading": "هل ستشرفوننا؟",
            "intro": "نرجو تأكيد الحضور حتى نجهّز مقعدكم.",
            "ask_companions": True,
            "max_companions": 5,
            "ask_message": True,
            "show_maybe": True,
            "submit_label": "إرسال التأكيد",
            "success_message": "شكراً لكم — تم تسجيل ردكم، ننتظركم.",
        }, style={
            "align": "center", "width": "normal",
            "padding_top": 70, "padding_bottom": 70,
            "bg_color": "#f2ebdd",
            "divider_top": "floral",
            "animation": "rise",
        }),

        # ---------------------------------------------------------- التهاني
        B.make_block("wishes", props={
            "heading": "كلمات وصلتنا منكم",
            "limit": 9,
            "layout": "cards",
        }, style={
            "align": "center", "width": "wide",
            "padding_top": 50, "padding_bottom": 60,
            "animation": "fade",
        }, visible=False),

        # ---------------------------------------------------------- QR
        B.make_block("qr", props={
            "heading": "احتفظوا بالدعوة",
            "note": "اعرضوا هذا الرمز عند مدخل القاعة.",
            "mode": "invite",
            "size": 180,
            "show_link": False,
        }, style={
            "align": "center", "width": "narrow",
            "padding_top": 50, "padding_bottom": 40,
            "animation": "zoom",
        }),

        # ---------------------------------------------------------- المشاركة
        B.make_block("share", props={
            "heading": "شاركوا الفرحة",
            "show_copy": True,
            "show_whatsapp": True,
            "show_native": True,
            "show_calendar": True,
        }, style={
            "align": "center", "width": "normal",
            "padding_top": 30, "padding_bottom": 70,
            "divider_bottom": "arabesque",
            "animation": "fade",
        }),
    ]

    doc["blocks"] = blocks
    return B.normalize_document(doc)
