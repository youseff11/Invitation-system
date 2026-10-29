"""صفحات الدعوة (الـshell) — ‎/app/i/<slug>/‎ و‎/app/i/<slug>/g/<token>/‎ و‎/app/templates/<slug>/preview/‎.

الـ‎<head>‎ بيتبني على السيرفر بنفس منطق ‎views._render_invitation_page‎
و‎template_demo‎ (العنوان، ‎og:*‎، ‎twitter:*‎، الصورة المطلقة بمقاسها، canonical،
‎noindex‎ + ‎X-Robots-Tag‎، الـfavicon، تحميل الخطوط مسبقاً) — زواحف واتساب وفيسبوك
مابتشغّلش جافاسكربت. والمحتوى نفسه بيوصل كـJSON جوّه الصفحة فمفيش طلب إضافي قبل الرسم.

القواعد (404 لو مش منشورة، كلمة السر، رمز الضيف، العدّاد) في ‎invite.py‎.
"""

from __future__ import annotations

from django.conf import settings
from django.db.models import F
from django.http import Http404
from django.shortcuts import get_object_or_404, render
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_safe

from .. import services
from ..models import Invitation, Template
from . import invite


def _boot(payload: dict) -> dict:
    """الحمولة بدون ‎css‎: الستايل بيتطبع في الـ‎<head>‎ مباشرة."""
    return {"mode": "view", **{k: v for k, v in payload.items() if k != "css"}}


def _response(request, payload: dict) -> "HttpResponse":
    head = payload["head"]
    response = render(request, "spa/invite.html", {
        "lang": payload["lang"],
        "dir": payload["dir"],
        "page_title": head["title"],
        "page_description": head["description"],
        "canonical_url": head["canonical"],
        "share_image": head["image"],
        "favicon": head["favicon"],
        "site_name": settings.SITE_NAME,
        "css": payload["css"],
        "body_style": payload["bodyStyle"],
        "font_preloads": payload["fontPreloads"],
        "runtime_scripts": payload["runtimeScripts"],
        "pixel": True,
        "boot": _boot(payload),
    })
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response


def _locked_response(request, invitation: Invitation) -> "HttpResponse":
    """كلمة السر لسه مادخلتش: صفحة عامة من غير أي بيانات من الدعوة."""
    response = render(request, "spa/invite.html", {
        "lang": "ar",
        "dir": "rtl",
        "page_title": "دعوة محمية",
        "page_description": "",
        "canonical_url": "",
        "share_image": {"url": "", "width": 0, "height": 0},
        "favicon": "",
        "site_name": settings.SITE_NAME,
        "css": {"font": "", "layout": "", "shared": "", "zero": ""},
        "body_style": "",
        "font_preloads": [],
        "runtime_scripts": [],
        "pixel": False,
        "boot": {"mode": "locked", "slug": invitation.slug,
                 "siteName": settings.SITE_NAME},
    })
    response["X-Robots-Tag"] = "noindex, nofollow"
    return response


def _count_view(request, invitation: Invitation) -> None:
    # عدّاد آمن ضد التسابق. HEAD (كراولر بيجرّب الرابط) مايتعدّش.
    if request.method == "GET":
        Invitation.objects.filter(pk=invitation.pk).update(
            public_views=F("public_views") + 1)


@require_safe
@ensure_csrf_cookie        # أول POST (التأكيد/كلمة السر) محتاج كوكي csrftoken
@never_cache
def invitation_page(request, slug, token=None):
    invitation = invite.get_live_invitation(slug)

    guest = None
    if token is not None:
        guest = invite.get_guest(invitation, token)
    elif not invite.is_unlocked(request, invitation):
        return _locked_response(request, invitation)

    _count_view(request, invitation)
    payload = invite.invitation_response(
        request, invitation, guest=guest, lang=services._lang(request))  # noqa: SLF001
    return _response(request, payload)


@require_safe
@ensure_csrf_cookie
@never_cache
def template_page(request, slug):
    template = get_object_or_404(Template, slug=slug, is_active=True)
    payload = invite.template_response(
        request, template, lang=services._lang(request))  # noqa: SLF001
    return _response(request, payload)
