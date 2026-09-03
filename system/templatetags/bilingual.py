"""وسوم ثنائية اللغة — بتخلّي تبديل اللغة فوري في المتصفح.

الفكرة: بدل ما السيرفر يبعت لغة واحدة ونستنى رحلة كاملة عشان نجيب
التانية، بنطبع النصّين مرة واحدة في نفس الصفحة، والـCSS بيوري واحد
حسب ‎<html lang>‎. التبديل ساعتها بيبقى تغيير صفة واحدة على ‎<html>‎ —
زي الوضع الليلي بالظبط، من غير أي رحلة للسيرفر.

الاستعمال:
    {% load bilingual %}
    {% bi "المعرض" %}                     ← نص من ملفات الترجمة
    {% bidb t.name t.name_en %}            ← عمودين في قاعدة البيانات
    {% bidb f.answer_ar|linebreaksbr f.answer_en|linebreaksbr wrap="div" %}
    {% bi_fmt "اختر %(plan)s" p.name p.name_en %}   ← نص فيه قيمة
    <div {% bi_attr "aria-label" "روابط التواصل" %}>  ← سمة مش عنصر

ملحوظات:
* لو النصّين متطابقين (أو الإنجليزي فاضي) بنطبع النص مرة واحدة من غير
  أي غلاف — نفس احتياطي ‎_pick‎ في models.py، وبيوفّر في حجم الصفحة.
* بنستخدم ‎conditional_escape‎، فالقيم اللي جاية من فلتر بيرجّع HTML
  آمن (زي ‎linebreaksbr‎) مابتتهربش تاني.
* الصفحة اللي بتستخدم الوسوم دي لازم تحط ‎data-bilingual‎ على ‎<html>‎
  (عن طريق ‎{% block html_attrs %}‎)، وإلا الجافاسكربت هيفضل يبدّل
  اللغة بالطريقة القديمة عن طريق السيرفر.
"""

from django import template
from django.utils import translation
from django.utils.html import conditional_escape, escape
from django.utils.safestring import mark_safe

register = template.Library()

# غلاف مسموح بيه — بنقصره على وسوم آمنة عشان القيمة تفضل من الكود مش
# من بيانات المستخدم.
_ALLOWED_WRAP = {"span", "div", "p", "li", "b", "strong", "small", "h3"}


def _translations(msgid):
    """نفس النص بالعربي والإنجليزي من ملفات الترجمة."""
    with translation.override("ar"):
        ar = translation.gettext(msgid)
    with translation.override("en"):
        en = translation.gettext(msgid)
    return ar, en


def _render_pair(ar, en, wrap="span"):
    ar_s = conditional_escape(ar) if ar is not None else ""
    en_s = conditional_escape(en) if en is not None else ""

    # إنجليزي فاضي = ارجع للعربي (نفس سلوك ‎_pick‎ في الموديلات)
    if not str(en_s).strip():
        en_s = ar_s
    if str(ar_s) == str(en_s):
        return mark_safe(ar_s)

    tag = wrap if wrap in _ALLOWED_WRAP else "span"
    return mark_safe(
        '<{t} data-lang="ar">{a}</{t}><{t} data-lang="en">{e}</{t}>'.format(
            t=tag, a=ar_s, e=en_s
        )
    )


@register.simple_tag
def bi(msgid, wrap="span"):
    """نص من ملفات الترجمة، مطبوع بالعربي والإنجليزي مع بعض."""
    ar, en = _translations(msgid)
    return _render_pair(ar, en, wrap)


@register.simple_tag
def bidb(ar, en, wrap="span"):
    """قيمتان من قاعدة البيانات (العمود العربي والعمود الإنجليزي)."""
    return _render_pair(ar, en, wrap)


@register.simple_tag
def bi_fmt(msgid, ar_value, en_value="", key="plan", wrap="span"):
    """نص مترجم جوّاه قيمة من قاعدة البيانات، زي «اختر <اسم الباقة>»."""
    ar_v = ar_value or ""
    en_v = (en_value or "").strip() or ar_v
    ar_t, en_t = _translations(msgid)
    try:
        ar = ar_t % {key: ar_v}
        en = en_t % {key: en_v}
    except (KeyError, TypeError, ValueError):
        # مفتاح غلط في ملف الترجمة — أحسن نعرض النص من غير تنسيق
        # على ما نضرب الصفحة كلها
        ar, en = ar_t, en_t
    return _render_pair(ar, en, wrap)


@register.simple_tag
def bi_attr(attr, msgid):
    """سمة ثنائية اللغة (title / aria-label / placeholder).

    بتطبع السمة بقيمتها في اللغة الشغّالة دلوقتي (عشان تفضل صح من غير
    جافاسكربت ولمحرّكات البحث)، وجنبها بيانات تخلّي ‎site.js‎ يبدّلها
    فوراً ساعة التبديل.
    """
    ar, en = _translations(msgid)
    active_en = (translation.get_language() or "").startswith("en")
    current = en if active_en else ar
    if ar == en:
        return mark_safe('{a}="{v}"'.format(a=escape(attr), v=escape(ar)))
    return mark_safe(
        '{a}="{v}" data-bi-attr="{a}" data-bi-ar="{ar}" data-bi-en="{en}"'.format(
            a=escape(attr), v=escape(current), ar=escape(ar), en=escape(en)
        )
    )
