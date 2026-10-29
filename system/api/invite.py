"""مسارات عرض الدعوة: مستند الدعوة بعد الترجمة وتعويض البيانات والـCSS الجاهز، وRSVP، وكلمة السر.

صاحب الملف: B3. كل مسارات الميزة (views + serializers + urlpatterns) هنا
أو في ملفات جنبه بنفس البادئة — مابتلمسش ‎views.py‎ و‎serializers.py‎ (الأساس
المشترك) ولا ملفات الميزات التانية. شكل الرد والأخطاء في ‎http.py‎.

* ‎GET  /api/v1/invitations/<slug>/render/?lang=&guest=<token>‎
* ‎GET  /api/v1/templates/<slug>/preview/?lang=‎
* ‎POST /api/v1/invitations/<slug>/rsvp/‎
* ‎POST /api/v1/invitations/<slug>/unlock/‎

القواعد (النشر، طول الرمز وتبعيته للدعوة، كلمة السر، حد المعدّل) نسخة من
‎views.invitation_public/invitation_guest/invitation_rsvp‎ — الموقع القديم هو
المرجع ومتضعّفش أي شرط. صفحة الـshell (‎invite_page.py‎) بتستخدم نفس الدوال.
"""

from __future__ import annotations

import hmac

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.urls import path
from django.utils import timezone
from django.views.decorators.cache import never_cache

from .. import blocks as blocks_engine
from .. import services
from ..models import Guest, Invitation, RSVPResponse, Template
from . import invite_render
from .http import ApiError, api_view, client_hash, json_body

GUEST_TOKEN_MIN, GUEST_TOKEN_MAX = 8, 64
UNLOCK_ATTEMPTS = 20          # محاولات كلمة سر فاشلة في الساعة لكل عميل


# ---------------------------------------------------------------- تحميل الدعوة
def get_live_invitation(slug: str) -> Invitation:
    invitation = get_object_or_404(
        Invitation.objects.select_related("template", "plan", "customer"), slug=slug)
    if not invitation.is_live:
        raise Http404("الدعوة غير متاحة.")
    return invitation


def get_guest(invitation: Invitation, token: str) -> Guest:
    """ضيف بالرمز: طول الرمز وتبعيته للدعوة نفس شروط ‎invitation_guest‎."""
    token = (token or "").strip()
    if not (GUEST_TOKEN_MIN <= len(token) <= GUEST_TOKEN_MAX):
        raise Http404("رابط غير صالح.")
    return get_object_or_404(Guest, invitation=invitation, token=token)


def session_key(invitation: Invitation) -> str:
    return f"inv_ok_{invitation.pk}"


def is_unlocked(request, invitation: Invitation) -> bool:
    return (not invitation.password
            or request.session.get(session_key(invitation)) is True)


# ---------------------------------------------------------------- الحمولة الكاملة
def _music(settings_doc: dict) -> dict | None:
    if not settings_doc.get("music_url"):
        return None
    return {
        "url": settings_doc["music_url"],
        "autoplay": bool(settings_doc.get("music_autoplay")),
        "loop": bool(settings_doc.get("music_loop")),
        "player": settings_doc.get("music_player") or "floating",
    }


def invitation_response(request, invitation: Invitation, *, guest=None,
                        lang: str = "") -> dict:
    payload, private = invite_render.build_payload(
        invitation.document,
        invitation=invitation,
        request=request,
        allowed_features=invitation.allowed_features,
        runtime_scripts=getattr(invitation.template, "runtime_scripts", []),
        runtime_root_attrs=getattr(invitation.template, "runtime_root_attrs", {}),
        guest=guest,
        lang=lang,
    )
    s = private["settings"]
    title = (
        s.get("share_title")
        or " و ".join(n for n in [invitation.name_one, invitation.name_two] if n)
        or invitation.title
    )
    description = s.get("share_description") or (
        f"{invitation.event_type} — {private['data'].get('date_text', '')}"
    ).strip(" —")
    image = services._share_image(  # noqa: SLF001
        request, s.get("share_image"),
        getattr(getattr(invitation, "template", None), "cover_image", None),
        getattr(getattr(invitation, "template", None), "cover_url", ""),
    )
    payload.update({
        "kind": "invitation",
        "slug": invitation.slug,
        "head": {
            "title": title,
            "description": description,
            "image": image,
            "favicon": s.get("favicon") or "",
            "canonical": request.build_absolute_uri(invitation.get_absolute_url()),
        },
        "music": _music(s),
        "scroll": services._scroll_config(s),  # noqa: SLF001
        "cta": None,
        "demo": False,
        "siteName": settings.SITE_NAME,
        "siteUrl": request.build_absolute_uri("/"),
    })
    return payload


def _template_canonical(request, template: Template) -> str:
    """رابط معاينة القالب على المسار القديم (‎/templates/<slug>/preview/‎) مع اللغة."""
    from django.urls import reverse

    url = request.build_absolute_uri(
        reverse("template_demo", kwargs={"slug": template.slug}))
    asked = services._lang(request)  # noqa: SLF001
    return f"{url}?lang={asked}" if asked else url


def template_response(request, template: Template, *, lang: str = "") -> dict:
    payload, private = invite_render.template_payload(template, lang=lang)
    payload = dict(payload)           # النسخة المخزّنة ماتتعدّلش
    s = private["settings"]
    payload.update({
        "kind": "template",
        "slug": template.slug,
        "head": {
            "title": f"معاينة قالب {template.display_name}",
            "description": (
                template.display_description
                or f"شوف قالب {template.display_name} من {settings.SITE_NAME}"
            ),
            "image": services._share_image(  # noqa: SLF001
                request, template.cover_image, template.cover_url),
            "favicon": s.get("favicon") or "",
            "canonical": _template_canonical(request, template),
        },
        "music": _music(s),
        "scroll": services._scroll_config(s),  # noqa: SLF001
        "cta": services._preview_cta(template),  # noqa: SLF001
        "demo": True,
        "siteName": settings.SITE_NAME,
        "siteUrl": request.build_absolute_uri("/"),
    })
    return payload


# ---------------------------------------------------------------- GET render / preview
@never_cache
@api_view("GET")
def invitation_render(request, slug):
    invitation = get_live_invitation(slug)
    guest = None
    token = request.GET.get("guest", "")
    if token:
        # رمز الضيف هو بيانات الاعتماد: بيتخطّى كلمة السر (زي ‎invitation_guest‎)
        guest = get_guest(invitation, token)
    elif not is_unlocked(request, invitation):
        raise ApiError(401, "locked", "هذه الدعوة محمية بكلمة سر.")
    return invitation_response(
        request, invitation, guest=guest, lang=services._lang(request))  # noqa: SLF001


@never_cache
@api_view("GET")
def template_preview(request, slug):
    template = get_object_or_404(Template, slug=slug, is_active=True)
    return template_response(request, template, lang=services._lang(request))  # noqa: SLF001


# ---------------------------------------------------------------- كلمة السر
@never_cache
@api_view("POST")
def invitation_unlock(request, slug):
    invitation = get_live_invitation(slug)
    key = f"inv-unlock:{invitation.pk}:{client_hash(request)}"
    if cache.get(key, 0) >= UNLOCK_ATTEMPTS:
        raise ApiError(429, "too_many_attempts", "محاولات كتير. حاول بعد قليل.")
    given = str(json_body(request).get("password") or "")
    if invitation.password and not hmac.compare_digest(
            given.encode("utf-8"), invitation.password.encode("utf-8")):
        if not cache.add(key, 1, 3600):
            try:
                cache.incr(key)
            except ValueError:
                cache.set(key, 1, 3600)
        raise ApiError(401, "wrong_password", "كلمة السر غير صحيحة.")
    request.session[session_key(invitation)] = True
    return {"ok": True}


# ---------------------------------------------------------------- RSVP
def _answers(answers_in, rsvp_props: dict) -> list[dict]:
    """إجابات الأسئلة الإضافية — نفس ‎views._rsvp_answers‎ بس من JSON.

    الأسئلة نفسها بتتقرا من **مستند الدعوة** مش من الطلب: اللي بيتبعت هو
    الإجابة بس، وأي اختيار مش من اختيارات السؤال بيتشال.
    """
    answers_in = answers_in if isinstance(answers_in, dict) else {}

    def many(name):
        value = answers_in.get(name)
        if isinstance(value, list):
            return [str(v) for v in value]
        return [str(value)] if value not in (None, "") else []

    def one(name):
        value = answers_in.get(name)
        return str(value).strip() if isinstance(value, (str, int, float)) else ""

    out: list[dict] = []
    for index, question in enumerate(rsvp_props.get("questions") or []):
        if not isinstance(question, dict):
            continue
        label = str(question.get("label") or "").strip()
        if not label:
            continue
        kind = question.get("kind") or "choice"
        name = f"q{index}"

        if kind == "choice":
            allowed = [
                str(o.get("label") or "").strip()
                for o in (question.get("options") or [])
                if isinstance(o, dict) and str(o.get("label") or "").strip()
            ]
            if not allowed:
                continue
            if question.get("multiple"):
                picked = [v for v in many(name) if v in allowed]
                value = services.RSVP_MULTI_SEP.join(picked[:20])
            else:
                raw = one(name)
                value = raw if raw in allowed else ""
        else:
            limit = 600 if kind == "textarea" else 200
            value = one(name)[:limit]

        if value:
            out.append({"i": index, "q": label[:200], "a": value})
        if len(out) >= services.MAX_RSVP_ANSWERS:
            break
    return out


def _pass_payload(guest) -> dict:
    """بيانات التصريح بعد التأكيد (روابط نسبية للأصل نفسه)."""
    from django.urls import reverse

    base = settings.SPA_BASENAME
    slug = guest.invitation.slug
    return {
        "code": guest.pass_code,
        "name": guest.name,
        "entries": guest.entries_allowed,
        "url": f"{base}/i/{slug}/g/{guest.token}/pass/",
        "qr": reverse("guest_qr", kwargs={"slug": slug, "token": guest.token}),
        "download": reverse("guest_qr_png", kwargs={"slug": slug, "token": guest.token}),
    }


@never_cache
@api_view("POST")
def invitation_rsvp(request, slug):
    invitation = get_object_or_404(Invitation, slug=slug)
    body = json_body(request)
    lang = "en" if str(body.get("lang") or "").lower().startswith("en") else "ar"

    def _t(ar, en):
        return en if lang == "en" else ar

    if not invitation.is_live:
        raise ApiError(404, "unavailable", _t(
            "الدعوة غير متاحة حالياً.", "This invitation isn't available right now."))

    # مصيدة الروبوتات — حقل مخفي يجب أن يبقى فارغاً
    if body.get("website"):
        return {"ok": True, "message": _t("تم التسجيل.", "Received.")}

    # تحديد المعدّل لكل عميل لكل دعوة (نفس مفتاح الموقع القديم)
    key = f"rsvp:{invitation.pk}:{client_hash(request)}"
    count = cache.get(key, 0)
    if count >= settings.RSVP_RATE_LIMIT_PER_HOUR:
        raise ApiError(429, "rate_limited", _t(
            "عدد كبير من المحاولات. حاول بعد قليل.",
            "Too many attempts. Please try again shortly."))
    cache.set(key, count + 1, 3600)

    name = str(body.get("name") or "").strip()[:120]
    if len(name) < 2:
        raise ApiError(400, "invalid_name", _t("يرجى كتابة الاسم.", "Please enter your name."),
                       fields={"name": _t("مطلوب", "Required")})

    phone = str(body.get("phone") or "").strip()[:40]
    status = str(body.get("status") or "attending")
    if status not in {"attending", "declined", "maybe"}:
        status = "attending"

    # حدود المرافقين وإعدادات الحقول تؤخذ من بلوك RSVP نفسه لا من المدخلات
    doc = invitation.get_document()
    rsvp_props: dict = {}
    for block in doc["blocks"]:
        if block["type"] == "rsvp":
            rsvp_props = block.get("props") or {}
            break
    max_companions = int(rsvp_props.get("max_companions") or 0)
    if rsvp_props.get("ask_phone") is False:
        phone = ""
    if rsvp_props.get("ask_status") is False:
        status = "attending"
    try:
        companions = max(0, min(max_companions, int(body.get("companions") or 0)))
    except (TypeError, ValueError):
        companions = 0

    message_text = str(body.get("message") or "").strip()[:600]
    answers = _answers(body.get("answers"), rsvp_props)
    ip_hash = client_hash(request)

    with transaction.atomic():
        # الضيف صاحب الرمز مسموح له يغيّر رأيه — لازم يتحدد قبل فحص التكرار
        guest = None
        token = str(body.get("guestToken") or "").strip()
        if GUEST_TOKEN_MIN <= len(token) <= GUEST_TOKEN_MAX:
            guest = invitation.guests.filter(token=token).first()
        if guest is None and phone:
            guest = invitation.guests.filter(phone=phone).first()
        if guest is not None:
            companions = min(companions, int(guest.plus_ones_allowed or 0))

        recent = guest is None and invitation.rsvps.filter(
            name=name,
            created_at__gte=timezone.now() - timezone.timedelta(minutes=10),
        ).exists()
        if recent:
            return {"ok": True, "message": _t(
                "تم تسجيل ردك بالفعل.", "Your reply has already been received.")}

        previous = guest.latest_rsvp if guest is not None else None
        if previous is not None:
            previous.name = name or previous.name
            previous.phone = phone or previous.phone
            previous.status = status
            previous.companions = companions
            if message_text:
                previous.message = message_text
            if answers:
                previous.answers = answers
            previous.ip_hash = ip_hash
            previous.save(update_fields=["name", "phone", "status", "companions",
                                         "message", "answers", "ip_hash", "updated_at"])
        else:
            RSVPResponse.objects.create(
                invitation=invitation, guest=guest, name=name, phone=phone,
                status=status, companions=companions, message=message_text,
                answers=answers, ip_hash=ip_hash,
            )

        # رسالة النجاح من النسخة اللي الضيف شايفها
        success_props = rsvp_props
        if (lang == blocks_engine.alt_language(doc)
                and blocks_engine.has_translation(doc, lang)):
            for block in blocks_engine.apply_i18n(doc, lang)["blocks"]:
                if block["type"] == "rsvp":
                    success_props = block.get("props") or {}
                    break
        success = success_props.get("success_message") or _t(
            "شكراً لكم — تم تسجيل ردكم.", "Thank you — your reply has been received.")

        # تصريح الدخول: اللي أكّد حضوره لازم يطلع بتصريح ومعاه QR
        pass_info = None
        if status == "attending":
            if guest is None:
                guest = Guest.objects.create(
                    invitation=invitation, name=name, phone=phone,
                    plus_ones_allowed=companions, source="rsvp",
                    entries_allowed=1 + companions,
                )
                if previous is None:
                    invitation.rsvps.filter(
                        name=name, guest__isnull=True
                    ).order_by("-created_at").update(guest=guest)
            else:
                guest.grant_entries(max(1 + companions, guest.entries_used))
            if rsvp_props.get("show_pass") is not False:
                pass_info = _pass_payload(guest)
        elif guest is not None and guest.entries_used == 0:
            guest.grant_entries(0)

    result: dict = {"ok": True, "message": success}
    if pass_info:
        result["pass"] = pass_info
    return result


urlpatterns = [
    path("invitations/<slug:slug>/render/", invitation_render, name="api_invite_render"),
    path("invitations/<slug:slug>/unlock/", invitation_unlock, name="api_invite_unlock"),
    path("invitations/<slug:slug>/rsvp/", invitation_rsvp, name="api_rsvp"),
    path("templates/<slug:slug>/preview/", template_preview, name="api_template_preview"),
]
