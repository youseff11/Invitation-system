"""مسارات الرموز العامة: بوابة القاعة، متابعة العميل، تصريح الضيف.

صاحب الملف: B2. من غير تسجيل دخول — **الرمز هو بيانات الاعتماد**، فكل شرط
في الـviews القديمة (‎system/views.py‎) منقول هنا بالظبط: طول الرمز، تبعية
الرمز للدعوة، حالة النشر. أي رمز غلط أو من دعوة تانية = 404 من غير تفاصيل.
"""

from __future__ import annotations

from functools import wraps

from django.conf import settings
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils import timezone
from django.views.decorators.cache import never_cache

from .. import qrcodes
from ..models import Guest, Invitation
from .guests_common import fmt_datetime, scan_response, token_guest_or_404
from .http import ApiError, api_view, json_body

NO_INDEX = "noindex, nofollow"


def noindex(view):
    """صفحات الرموز مش للفهرسة (‎X-Robots-Tag‎ زي الصفحات القديمة) — حتى في الأخطاء.

    ‎Cache-Control‎ بيجي من ‎never_cache‎ فوقيه.
    """
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        response = view(request, *args, **kwargs)
        response["X-Robots-Tag"] = NO_INDEX
        return response

    return wrapper


# ================================================================ بوابة القاعة
def _venue_or_404(slug, token) -> Invitation:
    """يرجّع الدعوة لو رمز القاعة مظبوط. الرمز هو بيانات الاعتماد الوحيدة."""
    token = (token or "").strip()
    if not (20 <= len(token) <= 64):
        raise Http404("رابط القاعة غير صالح.")
    return get_object_or_404(
        Invitation.objects.select_related("plan"),
        slug=slug, venue_token=token,
    )


def _venue_row(guest) -> dict:
    """صف الضيف زي ما القاعة بتشوفه — من غير أي بيانات مش محتاجينها."""
    when = timezone.localtime(guest.checked_in_at) if guest.checked_in_at else None
    return {
        "id": guest.pk,
        "name": guest.name,
        "code": guest.pass_code,
        "group": guest.group_name,
        "allowed": guest.entries_allowed,
        "used": guest.entries_used,
        "left": guest.entries_left,
        "status": guest.pass_status,
        "checkedIn": bool(guest.checked_in),
        "at": when.strftime("%H:%M") if when else "",
    }


def _venue_stats(guests) -> dict:
    """بيتحسب من القايمة اللي في الإيد — مش استعلام تاني على الداتابيز."""
    arrived = sum(1 for g in guests if g.checked_in)
    return {
        "guests": len(guests),
        "arrived": arrived,
        "waiting": len(guests) - arrived,
        "allowed": sum(g.entries_allowed for g in guests),
        "used": sum(g.entries_used for g in guests),
    }


def _venue_state(guests) -> dict:
    return {"rows": [_venue_row(g) for g in guests], "stats": _venue_stats(guests)}


@never_cache
@noindex
@api_view("GET")
def venue_state(request, slug, token):
    """بوابة القاعة: بيانات الدعوة + الكشف الحيّ. الصفحة بتسحبه كل شوية.

    لأن الباب ممكن يكون عليه أكتر من تليفون بيمسحوا في نفس الوقت،
    والكشف لازم يبقى واحد عند الكل — السيرفر هو مصدر الحقيقة الوحيد.
    """
    invitation = _venue_or_404(slug, token)
    guests = list(invitation.guests.all())
    return {
        "invitation": {
            "slug": invitation.slug,
            "title": invitation.title,
            "nameOne": invitation.name_one,
            "nameTwo": invitation.name_two,
            "venue": invitation.venue,
            "eventAtLabel": fmt_datetime(invitation.event_date, "l j F Y — g:i a"),
        },
        **_venue_state(guests),
    }


@never_cache
@noindex
@api_view("POST")
def venue_scan(request, slug, token):
    """نفس مسح الاستقبال — بس الصلاحية من رمز الرابط مش من حساب."""
    invitation = _venue_or_404(slug, token)
    return scan_response(invitation, str(json_body(request).get("token") or ""))


@never_cache
@noindex
@api_view("POST")
def venue_mark(request, slug, token):
    """تسجيل يدوي من الكشف — الـQR مارضيش يتمسح أو الضيف نسي تليفونه.

    ‎action=undo‎ بترجّع دخلة واحدة: غلطة على الباب لازم يكون ليها
    طريق رجوع، وإلا القاعة هتفضل تعدّي الناس من غير تسجيل عشان
    ماتلخبطش العدّاد.
    """
    invitation = _venue_or_404(slug, token)
    body = json_body(request)
    try:
        guest_pk = int(body.get("guest") or 0)
    except (TypeError, ValueError):
        raise Http404("ضيف غير معروف.")
    guest = get_object_or_404(Guest, invitation=invitation, pk=guest_pk)

    action = str(body.get("action") or "in").strip()
    if action == "undo":
        if guest.entries_used > 0:
            guest.entries_used -= 1
        if guest.entries_used == 0:
            guest.checked_in = False
            guest.checked_in_at = None
        guest.save(update_fields=["entries_used", "checked_in",
                                  "checked_in_at", "updated_at"])
        error = ""
    elif guest.entries_allowed <= 0:
        error = "الضيف ده مالوش تصريح دخول."
    elif not guest.consume_entry():
        error = f"التصريح خلص — اتسجّل {guest.entries_used} من {guest.entries_allowed}."
    else:
        error = ""

    return {
        **_venue_state(list(invitation.guests.all())),
        "error": error,
        "guest": _venue_row(guest),
    }


# ================================================================ متابعة العميل
@never_cache
@noindex
@api_view("GET")
def client_followup(request, slug, token):
    """لوحة متابعة خاصة بصاحب الدعوة عبر رمز سري غير قابل للتخمين.

    للقراءة فقط، وتعرض الوحدة التي أضيفت فعلاً إلى مستند الدعوة:
    الحضور، رموز QR، ورسائل التهنئة.
    """
    token = (token or "").strip()
    if not (20 <= len(token) <= 64):
        raise Http404("رابط المتابعة غير صالح.")
    invitation = get_object_or_404(
        Invitation.objects.select_related("customer", "template", "plan"),
        slug=slug, client_token=token,
    )

    document = invitation.get_document()
    visible_types = {
        block.get("type") for block in document.get("blocks", [])
        if block.get("visible", True)
    }
    rsvp_props = {}
    for block in document.get("blocks", []):
        if block.get("type") == "rsvp" and block.get("visible", True):
            rsvp_props = block.get("props") or {}
            break
    # ‎is not False‎ مقصودة: المفتاح الناقص في مستند قديم = مفعّل
    pass_enabled = (rsvp_props or {}).get("show_pass") is not False

    allowed = invitation.allowed_features
    has_rsvp = "rsvp" in visible_types and "rsvp" in allowed
    # الصفحة دي لوحة صاحب الدعوة نفسه، فالمقياس هو **البيانات اللي
    # اتجمعت فعلاً** مش وجود بلوك معيّن في المستند.
    rsvps = list(invitation.rsvps.select_related("guest").order_by("-created_at"))
    if rsvps:
        has_rsvp = True

    message_count = sum(1 for response in rsvps if response.message.strip())
    has_guestbook = bool(message_count) or (
        "wishes" in visible_types and "guestbook" in allowed
    )

    # تصريح الدخول مقفول من المحرر؟ يبقى مفيش عمود QR هنا خالص.
    has_qr = pass_enabled and (
        ("qr" in visible_types and "qr" in allowed)
        or invitation.guests.exists()
    )
    guests = list(invitation.guests.all()) if has_qr else []

    def _answers(response) -> list:
        rows = response.answers
        return [{"q": str(r.get("q")), "a": str(r.get("a") or "")}
                for r in rows if isinstance(r, dict) and r.get("q")] \
            if isinstance(rows, list) else []

    rsvp_rows = [{
        "id": response.pk,
        "name": response.name,
        "status": response.status,
        "companions": response.companions,
        "message": response.message.strip(),
        "answers": _answers(response),
        "createdAt": fmt_datetime(response.created_at, "Y/m/d — g:i a"),
    } for response in rsvps] if has_rsvp else []

    # عمود الأسئلة بيظهر بس لو في أسئلة فعلاً — مافيش داعي لعمود فاضي
    has_answers = any(row["answers"] for row in rsvp_rows)

    message_rows = [{
        "id": response.pk,
        "name": response.name,
        "message": response.message.strip(),
        "status": response.status,
        "createdAt": fmt_datetime(response.created_at, "Y/m/d — g:i a"),
    } for response in rsvps if response.message.strip()] if has_guestbook else []

    qr_rows = [{
        "id": guest.pk,
        "name": guest.name,
        "passCode": guest.pass_code,
        "token": guest.token,
        "entriesUsed": guest.entries_used,
        "entriesAllowed": guest.entries_allowed,
    } for guest in guests]

    attending = sum(1 for response in rsvps if response.status == "attending")
    declined = sum(1 for response in rsvps if response.status == "declined")
    maybe = sum(1 for response in rsvps if response.status == "maybe")
    companions = sum(int(response.companions or 0) for response in rsvps)
    checked_in = sum(1 for guest in guests if guest.checked_in)

    return {
        "invitation": {
            "slug": invitation.slug,
            "nameOne": invitation.name_one,
            "nameTwo": invitation.name_two,
        },
        "hasRsvp": has_rsvp,
        "hasQr": has_qr,
        "hasGuestbook": has_guestbook,
        "hasAnswers": has_answers,
        "rsvpRows": rsvp_rows,
        "messageRows": message_rows,
        "qrRows": qr_rows,
        "stats": {
            "rsvpTotal": len(rsvps) if has_rsvp else 0,
            "attending": attending if has_rsvp else 0,
            "declined": declined if has_rsvp else 0,
            "maybe": maybe if has_rsvp else 0,
            "companions": companions if has_rsvp else 0,
            "guests": len(guests) if has_qr else 0,
            "checkedIn": checked_in if has_qr else 0,
            "messages": len(message_rows) if has_guestbook else 0,
        },
    }


# ================================================================ تصريح الضيف
@never_cache
@noindex
@api_view("GET")
def guest_pass(request, slug, token):
    """بيانات صفحة تصريح الدخول — الضيف بيشوف الـQR ويحمّله من هنا.

    مفتوحة بالرمز زي الرابط الشخصي: اللي معاه الرابط معاه التصريح.
    """
    invitation = get_object_or_404(
        Invitation.objects.select_related("plan"), slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404("الدعوة غير متاحة.")
    guest = token_guest_or_404(invitation, token)
    url = request.build_absolute_uri(guest.get_absolute_url())
    return {
        "invitation": {
            "slug": invitation.slug,
            "title": invitation.title,
            "nameOne": invitation.name_one,
            "nameTwo": invitation.name_two,
        },
        "guest": {
            "name": guest.name,
            "token": guest.token,
            "passCode": guest.pass_code,
            "entriesAllowed": guest.entries_allowed,
            "entriesUsed": guest.entries_used,
            "entriesLeft": guest.entries_left,
            "passStatus": guest.pass_status,
        },
        "qrSvg": qrcodes.svg_for(url, box_size=8, border=2),
        "pngUrl": reverse("guest_qr_png", kwargs={"slug": slug, "token": guest.token}),
        "siteName": settings.SITE_NAME,
    }


urlpatterns = [
    path("venue/<slug:slug>/<str:token>/", venue_state, name="api_venue_state"),
    path("venue/<slug:slug>/<str:token>/scan/", venue_scan, name="api_venue_scan"),
    path("venue/<slug:slug>/<str:token>/mark/", venue_mark, name="api_venue_mark"),
    path("client/<slug:slug>/<str:token>/", client_followup, name="api_client_followup"),
    path("guest-pass/<slug:slug>/<str:token>/", guest_pass, name="api_guest_pass"),
]
