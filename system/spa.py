"""صفحة الـshell اللي بيتحمّل فيها تطبيق React.

Django بيقدّم HTML واحد صغير: الـ``<head>`` (العنوان، OG، canonical) بيتبني
هنا على السيرفر — زواحف واتساب وفيسبوك مابتشغّلش جافاسكربت — وبعدها React
بياخد الصفحة. بيانات البداية (المستخدم وإعدادات الموقع) بتتحط في
``<script type="application/json" id="boot-data">`` فمفيش طلب إضافي قبل الرسم.
"""

from __future__ import annotations

import re

from django.conf import settings
from django.shortcuts import render
from django.templatetags.static import static
from django.utils.translation import get_language, get_language_bidi
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_safe

from .api.serializers import site_payload, user_payload


# صفحة متابعة العروسين (/i/<slug>/client/<token>/، وتحت /app/ أثناء الترحيل).
_FOLLOWUP_PATH = re.compile(r"^(?:/[^/]+)?/i/[^/]+/client/[^/]+/?$")

FOLLOWUP_TITLE = "متابعة تأكيدات الحضور ورسائل التهنئة"
FOLLOWUP_DESC = (
    "رابط خاص بالعريس والعروسة لمتابعة ردود المدعوين على دعوة الفرح، "
    "ومعرفة مين أكد حضوره ومين اعتذر، والاطلاع على رسائل التهنئة من الأهل والأصدقاء."
)


def _share_overrides(request) -> dict:
    """عنوان/وصف/صورة معاينة الصفحات اللي ليها معاينة خاصة.

    زواحف واتساب وميتا مابتشغّلش جافاسكربت، فالمعاينة لازم تتبني هنا
    على السيرفر مش من React. الصورة برابط مطلق ومعاها مقاسها.
    """
    if _FOLLOWUP_PATH.match(request.path):
        return {
            "share_title": FOLLOWUP_TITLE,
            "share_description": FOLLOWUP_DESC,
            "share_image": settings.SITE_URL + static("images/followup-share.jpg"),
            "share_image_width": 1600,
            "share_image_height": 900,
        }
    return {}


def boot_payload(request) -> dict:
    return {
        "basename": settings.SPA_BASENAME,
        "lang": (get_language() or settings.LANGUAGE_CODE).split("-")[0],
        "dir": "rtl" if get_language_bidi() else "ltr",
        "user": user_payload(request.user),
        "site": site_payload(request),
        "debug": settings.DEBUG,
    }


# ‎ensure_csrf_cookie‎: أول POST (تسجيل الدخول) محتاج كوكي ‎csrftoken‎ موجود.
# ‎never_cache‎: الـboot فيه المستخدم الحالي — مايتخزّنش في كاش مشترك.
@ensure_csrf_cookie
@never_cache
@require_safe
def spa_shell(request, *args, **kwargs):
    # أثناء الترحيل التطبيق على /app/ جنب الموقع القديم — noindex عشان جوجل
    # مايفهرسش نسختين من نفس الصفحات. بيتفتح لما SPA_BASENAME يتفضّى.
    # صفحة المتابعة دايماً noindex: مش مقفولة في robots.txt عشان زاحف ميتا
    # يقرا معاينتها، فده اللي مخلّيها برّه جوجل.
    noindex = bool(settings.SPA_BASENAME) or bool(_FOLLOWUP_PATH.match(request.path))
    response = render(request, "spa/shell.html", {
        "boot": boot_payload(request),
        "noindex": noindex,
        **_share_overrides(request),
    })
    if noindex:
        response["X-Robots-Tag"] = "noindex, nofollow"
    return response
