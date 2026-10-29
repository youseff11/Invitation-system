"""أدوات مشتركة بين مسارات الضيوف (فريق العمل) ومسارات الرموز (القاعة والعميل والتصريح).

صاحب الملف: B2. هنا شكل بيانات الضيف والتأكيدات كما بتوصل للواجهة، وتنسيق
التواريخ بنفس فورمات القوالب القديمة (بلغة الطلب الحالية) عشان الصفحة الجديدة
تطلع بنفس النص بالظبط.
"""

from __future__ import annotations

from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import formats, timezone

from ..models import Guest, Invitation, RSVPResponse
from ..services import _scan_entry
from .http import ApiError


# ---------------------------------------------------------------- التواريخ
def fmt_datetime(value, pattern: str) -> str:
    """نفس فلتر ‎date‎ في القوالب: توقيت الخادم المحلي + لغة الطلب الحالية."""
    if not value:
        return ""
    return formats.date_format(timezone.localtime(value), pattern)


def iso(value) -> str | None:
    return timezone.localtime(value).isoformat() if value else None


# ---------------------------------------------------------------- الدعوة
def invitation_or_404(pk: int) -> Invitation:
    return get_object_or_404(Invitation, pk=pk)


def invitation_basic(invitation: Invitation) -> dict:
    return {
        "id": invitation.pk,
        "slug": invitation.slug,
        "title": invitation.title,
        "nameOne": invitation.name_one,
        "nameTwo": invitation.name_two,
    }


# ---------------------------------------------------------------- الضيف
def latest_rsvp_map(invitation: Invitation) -> dict:
    """‎{رقم الضيف: آخر تأكيد}‎ باستعلام واحد بدل استعلام لكل ضيف."""
    out: dict = {}
    for response in invitation.rsvps.order_by("-created_at"):
        if response.guest_id and response.guest_id not in out:
            out[response.guest_id] = response
    return out


def guest_row(guest: Guest, rsvp=None) -> dict:
    """صف الضيف في جدول اللوحة — بيشمل الرمز الفردي (فريق العمل بس)."""
    return {
        "id": guest.pk,
        "name": guest.name,
        "phone": guest.phone,
        "groupName": guest.group_name,
        "plusOnesAllowed": guest.plus_ones_allowed,
        "note": guest.note,
        "token": guest.token,
        "passCode": guest.pass_code,
        "source": guest.source,
        "entriesAllowed": guest.entries_allowed,
        "entriesUsed": guest.entries_used,
        "entriesLeft": guest.entries_left,
        "passStatus": guest.pass_status,
        "checkedIn": bool(guest.checked_in),
        "rsvpStatus": rsvp.status if rsvp else "",
    }


def rsvp_answers(response) -> list[dict]:
    """الإجابات الصالحة بس: ‎{q, a}‎ بنص السؤال (الباقي بيتشال)."""
    rows = response.answers
    if not isinstance(rows, list):
        return []
    return [{"q": str(row.get("q")), "a": str(row.get("a") or "")}
            for row in rows if isinstance(row, dict) and row.get("q")]


def rsvp_row(response) -> dict:
    return {
        "id": response.pk,
        "name": response.name,
        "status": response.status,
        "companions": response.companions,
        "message": response.message,
        "answers": rsvp_answers(response),
        "createdAt": fmt_datetime(response.created_at, "Y/m/d H:i"),
    }


# ---------------------------------------------------------------- الرموز
def token_guest_or_404(invitation: Invitation, token: str) -> Guest:
    token = (token or "").strip()
    if not token:
        raise Http404("رابط غير صالح.")
    return get_object_or_404(Guest, invitation=invitation, token=token)


def scan_response(invitation: Invitation, raw: str) -> dict:
    """يسجّل دخلة بالمنطق القديم نفسه (‎_scan_entry‎) ويحوّل الفشل لخطأ JSON.

    مشتركة بين شاشة الاستقبال وبوابة القاعة — زي ما هي مشتركة في الـview القديم.
    """
    payload, status = _scan_entry(invitation, raw)
    if status != 200:
        code = "guest_not_found" if status == 404 else "invalid_token"
        raise ApiError(status, code, payload.get("error", ""))
    payload.pop("ok", None)
    # الواجهة بتترجم الحالة بنفسها — الاسم العربي من السيرفر مش بيتبعت
    payload.pop("rsvp", None)
    payload["rsvpStatus"] = (RSVPResponse.objects.filter(guest_id=payload["id"])
                             .order_by("-created_at")
                             .values_list("status", flat=True).first() or "")
    return payload
