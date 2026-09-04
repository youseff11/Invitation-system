"""العروض (views) — الموقع العام، الدعوة، لوحة التحكم، وواجهة المحرر."""

from __future__ import annotations

import hashlib
import io
import json
import logging
import mimetypes
import os
import re
from pathlib import Path
from types import SimpleNamespace

from decimal import Decimal, InvalidOperation
from urllib.parse import quote

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.http import (
    Http404, HttpResponse, HttpResponseBadRequest, JsonResponse,
    StreamingHttpResponse,
)

from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.csrf import ensure_csrf_cookie

from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_POST

from . import blocks as blocks_engine
from . import qrcodes
from .forms import (
        CustomFontForm, GuestForm, IntroVideoForm, InvitationSettingsForm,
    MusicTrackForm, OrderForm, PlanAddonForm, SiteSettingForm, TemplateForm,

)
from .models import (
        Asset, CustomFont, Customer, FavoriteBlock, Guest, Invitation, IntroVideo, MusicTrack, Order,
    OrderAddon, Plan, PlanAddon, RSVPResponse, SiteSetting, Template, FAQ,

)
from django.utils.safestring import mark_safe
from .renderer import get_template_preview, render_document

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from . import guestexport, guestimport, images, templateimport, video

logger = logging.getLogger(__name__)

MAX_ASSET_BYTES = 8 * 1024 * 1024
# الفيديو ليه حد أعلى لوحده: صورة بتنضغط لـ٩٨ كيلو، لكن مقطع فرح متصوّر
# بالموبايل ٢٠ ثانية بيطلع ٢٥-٣٥ ميجا قبل الضغط. الحد الأصلي ٨ ميجا كان
# بيرفض أي مقطع حقيقي. الملف بينضغط عندنا لـ٧٢٠p بعد الرفع، والحد ده
# على الأصل قبل الضغط مش بعده.
MAX_VIDEO_BYTES = video.MAX_UPLOAD_BYTES
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime", "video/x-m4v"}
_VIDEO_EXTENSION_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4",
    ".mov": "video/quicktime", ".webm": "video/webm",
}
_GENERIC_UPLOAD_TYPES = {"", "application/octet-stream", "binary/octet-stream"}

# باقي رسايل المشروع بتستخدم الأرقام العربية، فالرقم المولَّد لازم يمشي
# على نفس النسق — رسالة فيها «40» وسط كلام عربي بتبان غريبة.
_AR_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def _ar_num(n: int) -> str:
    return str(n).translate(_AR_DIGITS)


def media_video(request, path):
    """يخدم فيديوهات media مع دعم Range Requests للبدء السريع."""
    if Path(path).suffix.lower() not in {".mp4", ".m4v", ".mov", ".webm", ".ogv"}:

        raise Http404
    root = Path(settings.MEDIA_ROOT).resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        raise Http404
    size = target.stat().st_size
    content_type = mimetypes.guess_type(target.name)[0] or "video/mp4"
    range_value = request.headers.get("Range", "").strip()
    start, end = 0, size - 1
    status = 200
    if range_value:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_value)
        if not match:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        first, last = match.groups()
        if first:
            start = int(first)
            end = int(last) if last else size - 1
        elif last:
            count = int(last)
            start = max(0, size - count)
            end = size - 1
        if start >= size or start > end:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        end = min(end, size - 1)
        status = 206

    length = end - start + 1

    def chunks():
        with target.open("rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining:
                data = fh.read(min(1024 * 1024, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    response = StreamingHttpResponse(chunks(), status=status, content_type=content_type)
    response["Accept-Ranges"] = "bytes"
    response["Content-Length"] = str(length)
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    if status == 206:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response


# ========================================================================== 

# أدوات مشتركة
# ==========================================================================
def _client_hash(request) -> str:
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = fwd.split(",")[0].strip() if fwd else request.META.get("REMOTE_ADDR", "")
    return hashlib.sha256(f"{ip}|{settings.SECRET_KEY}".encode()).hexdigest()[:32]


def _json_body(request) -> dict:
    try:
        return json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return {}


def _staff_required(request):
    """لوحة التحكم مخصّصة لفريق العمل فقط."""
    if not request.user.is_staff:
        raise PermissionDenied("لوحة التحكم متاحة لفريق العمل فقط.")


def _scroll_config(doc_settings: dict, *, editable: bool = False) -> dict:
    """إعدادات التمرير التلقائي اللي بتوصل للمتصفح.

    ``editable`` بيطفّيه: الصفحة ماينفعش تفضل نازلة لوحدها والمستخدم
    بيعدّل فيها من المحرر.
    """
    if editable or not doc_settings.get("auto_scroll"):
        return {"enabled": False}
    return {
        "enabled": True,
        "speed": doc_settings.get("auto_scroll_speed") or "normal",
        "delay": doc_settings.get("auto_scroll_delay") or 0,
        "loop": bool(doc_settings.get("auto_scroll_loop")),
    }


def _lang(request) -> str:
    """اللغة اللي الضيف طلبها من الرابط.

    باراميتر في الرابط مش كوكي: كده الرابط اللي الضيف يبعته لحد تاني
    يفتح بنفس اللغة، والميتا والعنوان بيتبنوا على السيرفر صح.
    """
    asked = (request.GET.get("lang") or "").lower()
    if asked.startswith("en"):
        return "en"
    if asked.startswith("ar"):
        return "ar"
    # مفيش طلب صريح: سيبها فاضية والعارض يرجّع لغة الدعوة الأساسية،
    # سواء كانت عربي أو إنجليزي.
    return ""


def _render_invitation_page(request, invitation, *, editable=False, noindex=False, guest=None):
    """يبني صفحة الدعوة كاملة من المستند."""
    result = render_document(
        invitation.document,
        invitation=invitation,
        request=request,
        allowed_features=invitation.allowed_features,
        editable=editable,
        runtime_scripts=getattr(invitation.template, "runtime_scripts", []),
        runtime_root_attrs=getattr(invitation.template, "runtime_root_attrs", {}),

        guest=guest,
        lang=_lang(request),
    )
    doc_settings = result["settings"]
    title = (
        doc_settings.get("share_title")
        or " و ".join(n for n in [invitation.name_one, invitation.name_two] if n)
        or invitation.title
    )
    description = doc_settings.get("share_description") or (
        f"{invitation.event_type} — {result['data'].get('date_text', '')}"
    ).strip(" —")

    music = {}
    if doc_settings.get("music_url"):
        music = {

            "url": doc_settings["music_url"],
            "autoplay": bool(doc_settings.get("music_autoplay")),
            "loop": bool(doc_settings.get("music_loop")),
            "player": doc_settings.get("music_player") or "floating",
        }

    return render(request, "invitations/render.html", {
        "render": result,
        "invitation": invitation,
        "editable": editable,
        "noindex": noindex or invitation.status != "published",
        "page_title": title,
        "page_description": description,
        "share_image": doc_settings.get("share_image") or "",
        "canonical_url": request.build_absolute_uri(invitation.get_absolute_url()),
        "music_config": music,
                "scroll_config": _scroll_config(doc_settings, editable=editable),
        "run_template_runtime": bool(editable and getattr(invitation.template, "runtime_scripts", [])),
        "defer_template_runtime": bool(not editable and result.get("runtime_scripts")),
        "guest": guest,

        "site_name": settings.SITE_NAME,
        "site_url": request.build_absolute_uri("/"),
    })


# ==========================================================================
# الموقع العام
# ==========================================================================
# الحقول التقيلة اللي صفحات العرض مابتلمسهاش: مستند القالب ممكن يوصل
# ٣ ميجا، والمعاينة المخزّنة والسكربتات كمان. Django بيحمّل كل الحقول
# افتراضياً، فصفحة بتعرض الاسم والغلاف بس كانت بتقرا وتفكّ عشرات
# الميجات من JSON. قياس على الموقع المباشر: الرئيسية ٤٤٥١ms و«القوالب»
# ٣٠٩٠ms، بينما صفحة مابتلمسش القوالب خالص ١٧٦ms — والناتج ١٢–٢٦ كيلوبايت.
_TEMPLATE_HEAVY_FIELDS = ("document", "preview_render", "runtime_scripts")


def home(request):
    templates = (Template.objects.filter(is_active=True)
                 .defer(*_TEMPLATE_HEAVY_FIELDS)[:12])
    plans = list(Plan.objects.filter(is_active=True))
    addons = list(PlanAddon.objects.filter(is_active=True).prefetch_related("plans"))
    cfg = SiteSetting.load()

    # الإضافات بتتعرض تحت كل باقة كسعر استرشادي. إضافة من غير باقات
    # محددة معناها «متاحة مع الكل» — نفس القاعدة اللي في نموذج الطلب.
    for p in plans:
        p.shown_addons = [a for a in addons
                          if not a.plans.all() or p in a.plans.all()]

    form = OrderForm(request.POST or None) if cfg.orders_enabled else None
    if request.method == "POST":
        # القسم مخفي من الصفحة لما الطلبات مقفولة — لكن الإخفاء مش قفل.
        # المسار لسه موجود وأي حد يقدر يبعتله POST، فالرفض هنا مش هناك.
        if not cfg.orders_enabled:
            raise PermissionDenied("استقبال الطلبات من الموقع مقفول حالياً.")
        if form.is_valid():
            form.save()
            messages.success(request, "تم استلام طلبك. سنتواصل معك قريباً لتأكيد التفاصيل.")
            return redirect("home")
        messages.error(request, "يرجى مراجعة البيانات المدخلة.")
    faqs = FAQ.objects.filter(is_active=True)
    return render(request, "public/home.html", {
        "templates": templates, "plans": plans, "form": form,
        "addons": addons, "faqs": faqs, "site_config": cfg,
    })


@require_GET
def template_gallery(request):
    qs = Template.objects.filter(is_active=True).defer(*_TEMPLATE_HEAVY_FIELDS)
    category = request.GET.get("category", "")
    if category:
        qs = qs.filter(category=category)
    return render(request, "public/gallery.html", {
        "templates": qs,
        "categories": Template.CATEGORY_CHOICES,
        "active_category": category,
    })


def _preview_cta(template) -> dict | None:
    """شريط «عجبك القالب؟» في معاينة القالب.

    بيرجّع ``None`` لو الشريط مطفي — فالقالب ما بيتعرضش أصلاً.
    اسم القالب بيتحط جوّه رسالة الواتساب عشان اللي يوصلك يبقى معروف
    هو شايف إيه من غير ما الزائر يكتب حاجة.
    """
    cfg = SiteSetting.load()
    # شرط الظهور عايش في الموديل عشان اللوحة والمعاينة يقروا نفس الحكم —
    # لما كان مكرر هنا، اللوحة كانت بتقول «ظاهر» والصفحة مابتعرضش حاجة.
    if not cfg.preview_cta_ready:
        return None

    name = template.display_name
    wa = ""
    if cfg.whatsapp_enabled and cfg.whatsapp_digits:
        text = (cfg.whatsapp_message or "").replace("{template}", name)
        wa = f"https://wa.me/{cfg.whatsapp_digits}?text={quote(text)}"

    fb = cfg.facebook_url if cfg.facebook_enabled else ""
    return {"text": cfg.preview_cta_text, "template_name": name,
            "whatsapp": wa, "facebook": fb}


@require_GET
@never_cache
def template_demo(request, slug):

    """معاينة قالب كدعوة تجريبية — بدون إنشاء أي سجل."""
    template = get_object_or_404(Template, slug=slug, is_active=True)
    result = get_template_preview(template, lang=_lang(request))

    return render(request, "invitations/render.html", {
        "render": result,
        "invitation": None,
                "editable": False,
        "defer_template_runtime": bool(result.get("runtime_scripts")),
        "noindex": True,

        "page_title": f"معاينة قالب {template.name}",
        "page_description": template.description,
        "share_image": "",
        "canonical_url": "",
        "music_config": {
            "url": result["settings"].get("music_url") or "",
            "autoplay": bool(result["settings"].get("music_autoplay")),
            "loop": bool(result["settings"].get("music_loop")),
            "player": result["settings"].get("music_player") or "floating",
        },
        "scroll_config": _scroll_config(result["settings"]),

        "cta": _preview_cta(template),
        "site_name": settings.SITE_NAME,
        "site_url": request.build_absolute_uri("/"),
    })


# ==========================================================================
# الدعوة العامة
# ==========================================================================
@never_cache
def invitation_public(request, slug):
    invitation = get_object_or_404(
        Invitation.objects.select_related("template", "plan", "customer"), slug=slug
    )
    if not invitation.is_live:
        raise Http404("الدعوة غير متاحة.")

    if invitation.password:
        if request.session.get(f"inv_ok_{invitation.pk}") is not True:
            if request.method == "POST" and request.POST.get("password") == invitation.password:
                request.session[f"inv_ok_{invitation.pk}"] = True
                return redirect("invitation_public", slug=slug)
            return render(request, "invitations/locked.html", {
                "invitation": invitation,
                "error": request.method == "POST",
            }, status=401 if request.method == "POST" else 200)

    # عدّاد آمن ضد التسابق
    Invitation.objects.filter(pk=invitation.pk).update(public_views=F("public_views") + 1)
    return _render_invitation_page(request, invitation)


@never_cache
def invitation_guest(request, slug, token):
    """الرابط الشخصي للضيف: /i/<slug>/g/<token>/

    الرمز نفسه هو بيانات الاعتماد، فبيتخطّى كلمة سر الدعوة عن قصد —
    اللي معاه الرابط معاه إذن الدخول. لكنه لا يتخطّى حالة النشر.
    """
    invitation = get_object_or_404(
        Invitation.objects.select_related("template", "plan", "customer"), slug=slug
    )
    if not invitation.is_live:
        raise Http404("الدعوة غير متاحة.")

    token = (token or "").strip()
    if not (8 <= len(token) <= 64):
        raise Http404("رابط غير صالح.")
    # الرمز لازم يكون تبع الدعوة دي — رمز من دعوة تانية بيفشل
    guest = get_object_or_404(Guest, invitation=invitation, token=token)

    Invitation.objects.filter(pk=invitation.pk).update(public_views=F("public_views") + 1)
    return _render_invitation_page(request, invitation, guest=guest)


@require_GET
def invitation_client_followup(request, slug, token):
    """لوحة متابعة خاصة بصاحب الدعوة عبر رمز سري غير قابل للتخمين.

    الصفحة للقراءة فقط، وتعرض الوحدة التي أضيفت فعلاً إلى مستند الدعوة:
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
    # اتجمعت فعلاً** مش وجود بلوك معيّن في المستند. قبل كده كانت رسائل
    # التهنئة مربوطة ببلوك «سجل التهاني»: اللي بيجمّع الرسائل من فورم
    # التأكيد من غير ما يضيف البلوك ده كان بيلاقي الصفحة فاضية.
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

    rsvp_rows = [{
        "name": response.name,
        "status": response.get_status_display(),
        "status_code": response.status,
        "companions": response.companions,
        "message": response.message.strip(),
        "created_at": response.created_at,
    } for response in rsvps] if has_rsvp else []

    message_rows = [{
        "name": response.name,
        "message": response.message.strip(),
        "status": response.get_status_display(),
        "created_at": response.created_at,
    } for response in rsvps if response.message.strip()] if has_guestbook else []

    qr_rows = []
    if has_qr:
        for guest in guests:
            qr_rows.append({
                "guest": guest,
                "qr_url": request.build_absolute_uri(reverse(
                    "guest_qr", kwargs={"slug": invitation.slug, "token": guest.token}
                )),
                "download_url": reverse(
                    "guest_qr_png", kwargs={"slug": invitation.slug, "token": guest.token}
                ),
                "pass_url": reverse(
                    "guest_pass", kwargs={"slug": invitation.slug, "token": guest.token}
                ),
            })

    attending = sum(1 for response in rsvps if response.status == "attending")
    declined = sum(1 for response in rsvps if response.status == "declined")
    maybe = sum(1 for response in rsvps if response.status == "maybe")
    companions = sum(int(response.companions or 0) for response in rsvps)
    checked_in = sum(1 for guest in guests if guest.checked_in)

    response = render(request, "public/client_followup.html", {
        "invitation": invitation,
        "followup_url": request.build_absolute_uri(invitation.get_client_followup_url()),
        "has_rsvp": has_rsvp,
        "has_qr": has_qr,
        "has_guestbook": has_guestbook,
        "rsvp_rows": rsvp_rows,
        "message_rows": message_rows,
        "qr_rows": qr_rows,
        "stats": {
            "rsvp_total": len(rsvps) if has_rsvp else 0,
            "attending": attending if has_rsvp else 0,
            "declined": declined if has_rsvp else 0,
            "maybe": maybe if has_rsvp else 0,
            "companions": companions if has_rsvp else 0,
            "guests": len(guests) if has_qr else 0,
            "checked_in": checked_in if has_qr else 0,
            "messages": len(message_rows) if has_guestbook else 0,
        },
    })
    response["X-Robots-Tag"] = "noindex, nofollow"
    response["Cache-Control"] = "private, no-store"
    return response


@require_POST
def invitation_rsvp(request, slug):

    invitation = get_object_or_404(Invitation, slug=slug)
    is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"

    def fail(msg, status=400):
        if is_ajax:
            return JsonResponse({"ok": False, "error": msg}, status=status)
        messages.error(request, msg)
        return redirect("invitation_public", slug=slug)

    if not invitation.is_live:
        return fail("الدعوة غير متاحة حالياً.", 404)
    # الباقة تحذير فقط؛ إذا أضاف صاحب الدعوة RSVP يظل النموذج يعمل.



    # مصيدة الروبوتات — حقل مخفي يجب أن يبقى فارغاً
    if request.POST.get("website"):
        return JsonResponse({"ok": True, "message": "تم التسجيل."}) if is_ajax else redirect(
            "invitation_public", slug=slug
        )

    # تحديد المعدّل لكل عميل لكل دعوة
    key = f"rsvp:{invitation.pk}:{_client_hash(request)}"
    count = cache.get(key, 0)
    if count >= settings.RSVP_RATE_LIMIT_PER_HOUR:
        return fail("عدد كبير من المحاولات. حاول بعد قليل.", 429)
    cache.set(key, count + 1, 3600)

    name = (request.POST.get("name") or "").strip()[:120]
    if len(name) < 2:
        return fail("يرجى كتابة الاسم.")

    phone = (request.POST.get("phone") or "").strip()[:40]
    status = request.POST.get("status", "attending")
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
    # الهاتف متقفل من المحرر: رقم جاي في طلب متلاعب فيه ما يتسجّلش.
    # المقارنة بـ‎is False‎ مقصودة — المفتاح الناقص في مستند قديم
    # معناه «الحقل ظاهر» مش «مقفول».
    if rsvp_props.get("ask_phone") is False:
        phone = ""
    try:
        companions = max(0, min(max_companions, int(request.POST.get("companions") or 0)))
    except (TypeError, ValueError):
        companions = 0

    message_text = (request.POST.get("message") or "").strip()[:600]
    ip_hash = _client_hash(request)

    # التعرّف على الضيف الأول: لازم يتحدد قبل فحص التكرار، لأن الضيف
    # صاحب الرمز مسموح له يغيّر رأيه في أي وقت.
    guest = None
    token = (request.POST.get("guest_token") or "").strip()
    if 8 <= len(token) <= 64:
        guest = invitation.guests.filter(token=token).first()
    if guest is None and phone:
        guest = invitation.guests.filter(phone=phone).first()
    if guest is not None:
        companions = min(companions, int(guest.plus_ones_allowed or 0))

    # منع التكرار للمجهولين فقط: نفس الاسم لنفس الدعوة خلال ١٠ دقائق.
    # صاحب الرمز مستثنى — رده بيتحدّث مش بيتمنع.
    recent = guest is None and invitation.rsvps.filter(
        name=name, created_at__gte=timezone.now() - timezone.timedelta(minutes=10)
    ).exists()
    if recent:
        msg = "تم تسجيل ردك بالفعل."
        return JsonResponse({"ok": True, "message": msg}) if is_ajax else redirect(
            "invitation_public", slug=slug
        )

    previous = guest.latest_rsvp if guest is not None else None
    if previous is not None:
        # الضيف بيغيّر رأيه — نحدّث رده بدل ما نعمل صف جديد ونعدّ مرتين
        previous.name = name or previous.name
        previous.phone = phone or previous.phone
        previous.status = status
        previous.companions = companions
        if message_text:
            previous.message = message_text
        previous.ip_hash = ip_hash
        previous.save(update_fields=["name", "phone", "status", "companions",
                                     "message", "ip_hash", "updated_at"])
    else:
        RSVPResponse.objects.create(
            invitation=invitation, guest=guest, name=name, phone=phone,
            status=status, companions=companions, message=message_text, ip_hash=ip_hash,
        )

    success = rsvp_props.get("success_message") or "شكراً لكم — تم تسجيل ردكم."

    # ---- تصريح الدخول
    # اللي أكّد حضوره لازم يطلع بتصريح ومعاه QR. لو مالوش سجل ضيف
    # (سجّل بنفسه من الفورم) بنعمله واحد — من غيره مفيش حاجة تتمسح
    # على الباب ولا تتحط في كشف القاعة.
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
            # الضيف غيّر عدد مرافقينه — التصريح يتحدّث معاه، بس
            # مانقلّلوش تحت عدد اللي دخلوا فعلاً
            guest.grant_entries(max(1 + companions, guest.entries_used))
        # المصمّم قافل تصريح الدخول من المحرر؟ سجل الضيف بيتعمل زي ما هو
        # (الكشف والعدّ محتاجينه)، بس مفيش QR بيتعرض للضيف.
        # ‎is not False‎ مقصودة: المفتاح الناقص في مستند قديم = مفعّل.
        if rsvp_props.get("show_pass") is not False:
            pass_info = _guest_pass_payload(request, guest)
    elif guest is not None and guest.entries_used == 0:
        # اعتذر قبل ما يدخل — نلغي التصريح
        guest.grant_entries(0)

    if is_ajax:
        payload = {"ok": True, "message": success}
        if pass_info:
            payload["pass"] = pass_info
        return JsonResponse(payload)
    messages.success(request, success)
    if pass_info:
        return redirect("guest_pass", slug=slug, token=guest.token)
    return redirect("invitation_public", slug=slug)


# ==========================================================================
# لوحة التحكم
# ==========================================================================
@login_required
def dashboard(request):
    _staff_required(request)
    invitations = Invitation.objects.all()
    stats = {
        "orders_new": Order.objects.filter(status="new").count(),
        "orders": Order.objects.count(),
        "customers": Customer.objects.count(),
        "invitations": invitations.count(),
        "published": invitations.filter(status="published").count(),
        "templates": Template.objects.count(),
        "guests": Guest.objects.count(),
        "attending": RSVPResponse.objects.filter(status="attending").count(),
        "views": invitations.aggregate(v=Sum("public_views"))["v"] or 0,
    }
    return render(request, "dashboard/index.html", {
        "nav": "home",
        "stats": stats,
        "recent_orders": Order.objects.select_related("customer", "plan")[:6],
        "recent_rsvps": RSVPResponse.objects.select_related("invitation")[:8],
        "recent_invitations": Invitation.objects.select_related("customer", "template")[:6],
    })


@login_required
def dashboard_invitations(request):
    _staff_required(request)
    q = (request.GET.get("q") or "").strip()
    status = request.GET.get("status", "")
    # الأحدث فوق. الترتيب مكتوب هنا صراحةً مش متسايب لـ‎Meta.ordering‎:
    # مع ‎annotate‎ بيتحوّل الاستعلام لتجميع (‎GROUP BY‎)، والترتيب
    # الافتراضي بيضيع فالقايمة كانت بتطلع من الأقدم للأحدث. ‎-id‎
    # كسّار تعادل: دعوتين اتعملوا في نفس الثانية يفضل ترتيبهم ثابت
    # بدل ما يتبدّل مع كل فتحة للصفحة.
    qs = Invitation.objects.select_related("customer", "template", "plan").annotate(
        rsvp_total=Count("rsvps", distinct=True),
        guest_total=Count("guests", distinct=True),
    ).order_by("-created_at", "-id")
    if q:
        qs = qs.filter(
            Q(title__icontains=q) | Q(customer__name__icontains=q)
            | Q(slug__icontains=q) | Q(name_one__icontains=q) | Q(name_two__icontains=q)
        )
    if status:
        qs = qs.filter(status=status)
    return render(request, "dashboard/invitations.html", {
        "nav": "invitations",
        "invitations": qs, "q": q, "status": status,
        "status_choices": Invitation.STATUS_CHOICES,
    })


@login_required
def invitation_create(request):
    _staff_required(request)
    templates = Template.objects.filter(is_active=True)
    plans = Plan.objects.filter(is_active=True)

    if request.method == "POST":
        template = get_object_or_404(Template, pk=request.POST.get("template_id"))
        plan = get_object_or_404(Plan, pk=request.POST.get("plan_id"))

        customer_id = request.POST.get("customer_id")
        customer = Customer.objects.filter(pk=customer_id).first() if customer_id else None
        if not customer:
            cname = (request.POST.get("customer_name") or "").strip()
            if not cname:
                messages.error(request, "اكتب اسم العميل أو اختر عميلاً موجوداً.")
                return redirect("invitation_create")
            customer = Customer.objects.create(
                name=cname[:120],
                phone=(request.POST.get("customer_phone") or "")[:40],
                email=(request.POST.get("customer_email") or "")[:200],
            )

        invitation = Invitation.objects.create(
            customer=customer, template=template, plan=plan,
            name_one=(request.POST.get("name_one") or "")[:120],
            name_two=(request.POST.get("name_two") or "")[:120],
            event_type=(request.POST.get("event_type") or "زفاف")[:40],
            document=template.get_document(),   # نسخة مستقلة من القالب
            status="draft",
        )
        Template.objects.filter(pk=template.pk).update(usage_count=F("usage_count") + 1)
        messages.success(request, "تم إنشاء الدعوة — يمكنك تخصيصها الآن من المحرر.")
        return redirect("invitation_editor", pk=invitation.pk)

    return render(request, "dashboard/invitation_create.html", {
        "nav": "invitations",
        "templates": templates, "plans": plans,
        "customers": Customer.objects.all()[:200],
        "event_types": ["زفاف", "خطوبة", "كتب كتاب", "حنة", "عيد ميلاد", "تخرّج", "عقيقة"],
    })


@login_required
def template_create(request):
    """ينشئ قالباً فارغاً ويحوّل فريق العمل مباشرة إلى المحرر."""
    _staff_required(request)
    form = TemplateForm(request.POST or None, request.FILES or None)
    if request.method == "POST" and form.is_valid():
        template = form.save(commit=False)
        template.document = blocks_engine.empty_document()
        template.preview_render = {}
        template.source = "editor"
        template.created_by = request.user
        template.is_active = True
        template.sort_order = 0
        template.runtime_scripts = []
        template.runtime_root_attrs = {}
        template.required_features = []
        # Template.save() يولّد slug فريداً تلقائياً لو تركه المستخدم فارغاً.
        template.save()
        messages.success(
            request,
            f"اتعمل القالب «{template.name}». ضيف الأقسام من المحرر واضغط حفظ.",
        )
        return redirect("template_editor", pk=template.pk)

    if request.method == "POST" and form.errors:
        messages.error(request, "راجع البيانات الظاهرة تحت الحقول ثم جرّب مرة أخرى.")

    return render(request, "dashboard/template_create.html", {
        "nav": "templates",
        "form": form,
    })


@login_required
def dashboard_templates(request):

    _staff_required(request)

    if request.method == "POST" and request.POST.get("action") == "delete":
        tpl = get_object_or_404(Template, pk=request.POST.get("template") or 0)
        # الدعوات بتاخد نسخة مستقلة من المستند وقت الإنشاء، فحذف القالب
        # مابيأثرش عليها — بس اللي اتستخدم بنسيبه عشان الإحصائيات تفضل صح
        if tpl.invitations.exists():
            messages.error(
                request,
                f"«{tpl.name}» متستخدم في {tpl.invitations.count()} دعوة — "
                "اخفيه بدل ما تحذفه.")
        else:
            name = tpl.name
            tpl.delete()
            messages.success(request, f"اتحذف «{name}».")
        return redirect("dashboard_templates")

    if request.method == "POST" and request.POST.get("action") == "toggle":
        tpl = get_object_or_404(Template, pk=request.POST.get("template") or 0)
        tpl.is_active = not tpl.is_active
        tpl.save(update_fields=["is_active", "updated_at"])
        messages.success(
            request,
            ("رجّعت" if tpl.is_active else "خبّيت") + f" «{tpl.name}».")
        return redirect("dashboard_templates")

    if request.method == "POST" and request.FILES.get("template_file"):
        try:
            tpl = templateimport.import_template(
                request.FILES["template_file"],
                name=(request.POST.get("template_name") or "").strip(),
                category=request.POST.get("template_category") or "classic",
            )
        except templateimport.ImportError_ as exc:
            messages.error(request, str(exc))
        except Exception as exc:
            # الرسالة العامة كانت بتبلع الاستثناء الحقيقي، فأي عطل في
            # القرص أو الصلاحيات أو قاعدة البيانات كان بيتقرا على إنه
            # «ملف مش مقروء» — ومحدش يعرف يدوّر فين. دلوقتي بيتسجّل في
            # سجل السيرفر كامل، وبيتعرض ملخّصه للستاف عشان يوصفه.
            logger.exception("فشل استيراد قالب: %s", getattr(
                request.FILES.get("template_file"), "name", "?"))
            messages.error(
                request,
                "تعذّر قراءة الملف. جرّب أرشيف ZIP فيه index.html. "
                f"(السبب الفني: {type(exc).__name__}: {exc})"[:400],
            )
        else:
            chars = templateimport.document_text_length(tpl.document)
            tracks = getattr(tpl, "imported_tracks", 0)
            scripts = len(getattr(tpl, "runtime_scripts", []) or [])
            extra = f" ولقينا {tracks} ملف موسيقى ضفناهم للمكتبة." if tracks else ""
            script_extra = f" واتحفظ {scripts} ملف JavaScript للتشغيل." if scripts else ""
            messages.success(
                request,
                f"اتستورد «{tpl.name}» بـ{len(tpl.document.get('blocks', []))} قسم "
                f"و{chars} حرف نص.{extra}{script_extra} افتحه في المحرر وظبّطه.",
            )

            # ملف صغير بيعدّي، بس ننبّه المستخدم عشان يراجعه في المعاينة.
            if chars < templateimport.MIN_VISIBLE_CHARS:
                messages.warning(
                    request,
                    f"خد بالك: النص المحفوظ فيه {chars} حرف بس. راجع المعاينة؛ "
                    "لو محتوى الصفحة بيتكوّن من خدمة خارجية أو CDN، قد يحتاج إعداداً إضافياً.",
                )

            return redirect("dashboard_templates")

    return render(request, "dashboard/templates.html", {
        "nav": "templates",
        "templates": Template.objects.annotate(uses=Count("invitations")),
        "categories": Template.CATEGORY_CHOICES,
    })




@login_required
def dashboard_fonts(request):
    """مكتبة الخطوط — ترفع الخط مرة وتستخدمه في كل الدعوات والقوالب."""
    _staff_required(request)
    form = CustomFontForm()

    if request.method == "POST":
        action = request.POST.get("action", "")
        if action in {"delete", "toggle"}:
            font = get_object_or_404(CustomFont, pk=request.POST.get("font") or 0)
            if action == "delete":
                name = font.name
                font.delete()
                messages.success(request, f"اتشال الخط «{name}» من المكتبة.")
            else:
                font.is_active = not font.is_active
                font.save(update_fields=["is_active", "updated_at"])
                messages.success(
                    request,
                    ("رجّعت" if font.is_active else "خبّيت") + f" الخط «{font.name}»."
                )
            return redirect("dashboard_fonts")

        form = CustomFontForm(request.POST, request.FILES)
        if form.is_valid():
            font = form.save(commit=False)
            font.uploaded_by = request.user
            font.save()
            messages.success(request, f"اتضاف الخط «{font.name}» للمكتبة.")
            return redirect("dashboard_fonts")
        messages.error(request, "راجع البيانات — ارفع ملفاً صالحاً أو ضع رابطاً مباشراً.")

    return render(request, "dashboard/fonts.html", {
        "nav": "fonts",
        "form": form,
        "fonts": CustomFont.objects.all(),
    })


@login_required
@require_POST
def font_api_create(request):
    """إنشاء خط من داخل أي حقل font في المحرر."""
    _staff_required(request)
    form = CustomFontForm(request.POST, request.FILES)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": form.errors.get_json_data()}, status=400)
    font = form.save(commit=False)
    font.uploaded_by = request.user
    font.save()
    return JsonResponse({"ok": True, "font": _font_payload(font)})


@login_required
@require_POST
def favorite_api_create(request):
    """يحفظ نسخة من قسم المحرر في مكتبة مشتركة بين الدعوات والقوالب."""
    _staff_required(request)
    body = _json_body(request)
    name = str(body.get("name") or "").strip()
    source = body.get("block") if isinstance(body.get("block"), dict) else {}
    normalized = blocks_engine.normalize_document({"blocks": [source]})
    block = normalized.get("blocks", [None])[0]
    if not name:
        return JsonResponse({"ok": False, "error": "اكتب اسماً للعنصر المفضل."}, status=400)
    if not block or not block.get("type") or not blocks_engine.BLOCK_REGISTRY.get(block["type"]):
        return JsonResponse({"ok": False, "error": "العنصر المحدد غير صالح للحفظ."}, status=400)
    favorite = FavoriteBlock.objects.create(
        name=name[:120], block_type=block["type"], block_data=block, created_by=request.user
    )
    return JsonResponse({"ok": True, "favorite": _favorite_payload(favorite)})


@login_required
@require_POST
def favorite_api_delete(request, pk):
    _staff_required(request)
    favorite = get_object_or_404(FavoriteBlock, pk=pk)
    favorite.delete()
    return JsonResponse({"ok": True})


@login_required
def dashboard_music(request):

    """مكتبة الموسيقى — ترفع المقطوعة مرة وتختارها في أي دعوة."""
    _staff_required(request)
    form = MusicTrackForm()

    if request.method == "POST":
        action = request.POST.get("action", "")
        if action in {"delete", "toggle"}:
            track = get_object_or_404(MusicTrack, pk=request.POST.get("track") or 0)
            if action == "delete":
                name = track.name
                track.delete()
                messages.success(request, f"اتشالت «{name}» من المكتبة.")
            else:
                track.is_active = not track.is_active
                track.save(update_fields=["is_active", "updated_at"])
                messages.success(
                    request,
                    ("رجّعت" if track.is_active else "خبّيت") + f" «{track.name}».",
                )
            return redirect("dashboard_music")

        form = MusicTrackForm(request.POST, request.FILES)
        if form.is_valid():
            track = form.save()
            messages.success(request, f"اتضافت «{track.name}» للمكتبة.")
            return redirect("dashboard_music")
        messages.error(request, "راجع البيانات — فيه حقل ناقص.")

    return render(request, "dashboard/music.html", {
        "nav": "music",
        "form": form,
        "tracks": MusicTrack.objects.all(),
    })


@login_required
def dashboard_intros(request):
    """مكتبة فيديوهات الافتتاحية — نفس فكرة مكتبة الموسيقى."""
    _staff_required(request)
    form = IntroVideoForm()

    if request.method == "POST":
        action = request.POST.get("action", "")
        if action in {"delete", "toggle"}:
            clip = get_object_or_404(IntroVideo, pk=request.POST.get("clip") or 0)
            if action == "delete":
                name = clip.name
                clip.delete()
                messages.success(request, f"اتشال «{name}» من المكتبة.")
            else:
                clip.is_active = not clip.is_active
                clip.save(update_fields=["is_active", "updated_at"])
                messages.success(
                    request,
                    ("رجّعت" if clip.is_active else "خبّيت") + f" «{clip.name}».")
            return redirect("dashboard_intros")

        form = IntroVideoForm(request.POST, request.FILES)
        if form.is_valid():
            clip = form.save(commit=False)
            upload = form.cleaned_data.get("file")
            if upload:

                # نفس ضغط فيديو الافتتاحية بتاع الرفع من المحرر
                try:
                    stored, secs = video.compress(upload)
                    clip.file = stored
                    clip.seconds = secs or 0
                    # Poster ثابت للموبايل؛ لو ffmpeg غير متاح يظل
                    # fallback المتصفح يعمل عند اختيار الفيديو من المكتبة.
                    if not clip.poster:
                        generated_poster = video.make_thumbnail(stored)
                        if generated_poster:
                            clip.poster = generated_poster
                except Exception:
                    pass
            clip.save()

            messages.success(request, f"اتضاف «{clip.name}» للمكتبة.")
            return redirect("dashboard_intros")
        messages.error(request, "راجع البيانات — فيه حقل ناقص.")

    return render(request, "dashboard/intros.html", {
        "nav": "intros",
        "form": form,
        "clips": IntroVideo.objects.all(),
    })


@login_required
def dashboard_orders(request):
    _staff_required(request)
    status = request.GET.get("status", "")
    qs = (Order.objects.select_related("customer", "plan", "template")
            .prefetch_related("order_addons__addon"))
    if status:
        qs = qs.filter(status=status)
    return render(request, "dashboard/orders.html", {
        "nav": "orders",
        "orders": qs, "status": status, "status_choices": Order.STATUS_CHOICES,
    })


@login_required
def guests_sample_csv(request):
    """ملف نموذجي يحمّله المستخدم ويملأه — أسهل من شرح الأعمدة بالكلام."""
    res = HttpResponse(guestimport.SAMPLE_CSV.encode("utf-8"),
                       content_type="text/csv; charset=utf-8")
    res["Content-Disposition"] = 'attachment; filename="guests-sample.csv"'
    return res


def _rsvp_pass_enabled(invitation) -> bool:
    """مفتاح «إظهار تصريح الدخول (QR)» في بلوك RSVP بتاع الدعوة.

    ‎True‎ لو مفيش بلوك RSVP أصلاً أو المفتاح ناقص — المستندات المحفوظة
    قبل الحقل ده لازم تفضل شغالة زي ما هي.
    """
    for block in invitation.get_document().get("blocks", []):
        if block.get("type") == "rsvp" and block.get("visible", True):
            return (block.get("props") or {}).get("show_pass") is not False
    return True


@login_required
def guests_view(request, pk):
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)

    if request.method == "POST" and request.FILES.get("csv_file"):
        upload = request.FILES["csv_file"]
        if upload.size > guestimport.MAX_BYTES:
            messages.error(request, "الملف كبير جداً (الحد ٢ ميجا).")
        else:
            report = guestimport.import_guests(invitation, upload.read())
            if report.total:
                messages.success(
                    request,
                    f"تمت الإضافة: {report.created} ضيف جديد، "
                    f"وتحديث {report.updated}، وتخطّي {report.skipped}."
                )
            for err in report.errors[:6]:
                messages.error(request, err)
            if not report.total and not report.errors:
                messages.error(request, "مفيش أي صف اتقرا من الملف.")
        return redirect("guests", pk=pk)

    form = GuestForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        guest = form.save(commit=False)
        guest.invitation = invitation
        guest.save()
        messages.success(request, "تمت إضافة الضيف.")
        return redirect("guests", pk=pk)
    totals = invitation.guests.aggregate(
        allowed=Sum("entries_allowed"), used=Sum("entries_used"))
    return render(request, "dashboard/guests.html", {
        "nav": "invitations",
        "invitation": invitation,
        "guests": invitation.guests.all(),
        "rsvps": invitation.rsvps.all(),
        "entries_allowed": totals["allowed"] or 0,
        "entries_used": totals["used"] or 0,
        # تصريح الدخول مقفول من محرر الدعوة؟ يبقى مفيش أعمدة ولا أزرار
        # QR هنا كمان — الكشف نفسه بيفضل شغال عادي.
        "pass_enabled": _rsvp_pass_enabled(invitation),
        "form": form,
    })


@login_required
@require_POST
def guest_toggle_checkin(request, pk):
    _staff_required(request)
    guest = get_object_or_404(Guest.objects.select_related("invitation"), pk=pk)
    guest.checked_in = not guest.checked_in
    guest.checked_in_at = timezone.now() if guest.checked_in else None
    guest.save(update_fields=["checked_in", "checked_in_at", "updated_at"])
    return JsonResponse({"ok": True, "checked_in": guest.checked_in})


# ==========================================================================
# المحرر البصري
# ==========================================================================
class _TemplateEditorProxy:
    """أقل كائن تحتاجه صفحة المحرر عند تعديل Template مباشرة."""
    STATUS_CHOICES = Invitation.STATUS_CHOICES

    def __init__(self, template):
        self.pk = template.pk
        self.title = template.name
        self.template = template
        self.plan = SimpleNamespace(name="قالب")
        self.event_type = ""
        self.name_one = ""
        self.name_two = ""
        self.event_date = None
        self.venue = ""
        self.address = ""
        self.map_url = ""
        self.whatsapp = ""
        self.status = "draft"
        self.password = ""
        self.expires_at = None

    def get_absolute_url(self):
        return reverse("template_demo", kwargs={"slug": self.template.slug})


def _favorite_payload(favorite):
    block = favorite.block_data if isinstance(favorite.block_data, dict) else {}
    return {
        "id": favorite.pk,
        "name": favorite.name,
        "blockType": favorite.block_type,
        "block": block,
    }


def _favorites_json():
    return [_favorite_payload(item) for item in FavoriteBlock.objects.all()]


def _font_payload(font):
    return {
        "id": font.pk,
        "name": font.name,
        "nameEn": font.name_en,
        "label": font.name,
        "value": font.css_family + ", sans-serif",
        "family": font.family,
        "url": font.url,
        "weight": font.weight,
        "style": font.style,
    }


def _font_library_json():
    """بيانات الخطوط التي يحتاجها المحرر وقواعد @font-face في المعاينة."""
    return [
        _font_payload(font)
        for font in CustomFont.objects.filter(is_active=True).order_by("order", "name")
        if font.url
    ]


def _template_editor_result(template, document, request, *, editable=True, lang="ar"):
    return render_document(
        document,
        invitation=None,
        request=request,
        allowed_features=None,
        editable=editable,
        lang=lang,
        runtime_scripts=getattr(template, "runtime_scripts", []),
        runtime_root_attrs=getattr(template, "runtime_root_attrs", {}),
    )


def _template_editor_frame(request, template, document, *, editable=True):
    result = _template_editor_result(
        template, document, request, editable=editable, lang=_lang(request)
    )
    return render(request, "invitations/render.html", {
        "render": result,
        "invitation": None,
        "editable": editable,
        "noindex": True,
        "page_title": f"محرر قالب {template.name}",
        "page_description": template.description,
        "share_image": template.cover_src,
        "canonical_url": "",
        "music_config": {
            "url": result["settings"].get("music_url") or "",
            "autoplay": bool(result["settings"].get("music_autoplay")),
            "loop": bool(result["settings"].get("music_loop")),
            "player": result["settings"].get("music_player") or "floating",
        },
        "scroll_config": _scroll_config(result["settings"], editable=editable),
        "run_template_runtime": bool(editable and getattr(template, "runtime_scripts", [])),
        "cta": None,
        "site_name": settings.SITE_NAME,
        "site_url": request.build_absolute_uri("/"),
    })


@login_required
@ensure_csrf_cookie
@never_cache
def template_editor(request, pk):
    """محرر القالب نفسه — متاح لفريق العمل فقط."""
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    proxy = _TemplateEditorProxy(template)
    template_assets = list(Asset.objects.filter(
        invitation__isnull=True
    ).order_by("-id")[:300])
    template_usage = _asset_usage_map(template_assets)
    return render(request, "editor/editor.html", {
        "invitation": proxy,
        "form": None,
        "template_mode": True,
        "schema_json": blocks_engine.editor_schema(),
        "document_json": template.get_document(),
        "assets_json": [
            {"id": a.pk, "url": a.url, "thumb": a.thumb_url,
             "source": a.source_url, "name": a.original_name, "kind": a.kind,
             "used": template_usage.get(a.pk, False)}
            for a in template_assets
        ],
        "features_json": sorted(blocks_engine.feature_keys()),
        "fonts_json": _font_library_json(),
        "favorites_json": _favorites_json(),
        "intros_json": [
            {"id": v.pk, "name": v.name, "url": v.url,
             "poster": v.poster_url, "seconds": v.seconds, "note": v.note}
            for v in IntroVideo.objects.filter(is_active=True) if v.url
        ],
        "music_json": [
            {"id": m.pk, "name": m.name, "url": m.url, "note": m.note}
            for m in MusicTrack.objects.filter(is_active=True) if m.url
        ],
        "template_categories": Template.CATEGORY_CHOICES,
        "meta_json": {
            "mode": "template",
            "templateId": template.pk,
            "slug": template.slug,
            "templateName": template.name,
            "publicUrl": request.build_absolute_uri(
                reverse("template_demo", kwargs={"slug": template.slug})
            ),
            "urls": {
                "preview": reverse("template_api_preview", kwargs={"pk": template.pk}),
                "save": reverse("template_api_save", kwargs={"pk": template.pk}),
                "fontCreate": reverse("font_api_create"),
                "favoriteCreate": reverse("favorite_api_create"),
                "favoriteDeleteBase": "/dashboard/favorites/",
                "upload": reverse("template_api_upload", kwargs={"pk": template.pk}),
                "saveTemplate": "",
                "assets": reverse("template_api_assets", kwargs={"pk": template.pk}),
                "deleteAsset": reverse("template_api_delete_asset", kwargs={"pk": template.pk}),
                "deleteAssets": reverse("template_api_delete_assets", kwargs={"pk": template.pk}),
                "crop": reverse("template_api_crop", kwargs={"pk": template.pk}),
                "frame": reverse("template_editor_frame", kwargs={"pk": template.pk}),
                "back": reverse("dashboard_templates"),
                "public": reverse("template_demo", kwargs={"slug": template.slug}),
            },
        },
    })


@login_required
@never_cache
def template_editor_frame(request, pk):
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    return _template_editor_frame(request, template, template.get_document())


@login_required
@require_POST
def template_api_preview(request, pk):
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    body = _json_body(request)
    result = _template_editor_result(
        template, body.get("document") or {}, request,
        # اللغة بتتمرّر زي ما هي؛ ‎render_document‎ بيرجّع للغة الدعوة
        # الأساسية لو الطلب مش مفهوم أو مفيش ترجمة.
        editable=True, lang=(body.get("lang") or ""),
    )
    intro_html = render_to_string("invitations/_intro.html", {
        "render": result, "editable": True, "guest": None,
    }, request=request)
    return JsonResponse({
        "ok": True,
        "html": str(result["html"]),
        "intro": intro_html.strip(),
        "cssVars": result["css_vars"],
        "fontCss": result["font_css"],
        # إزاحات النصوص + تنسيق كل نص لوحده. المحرر بيكتبها في رأس
        # الإطار بعد كل تحديث، لأن applyPreview بتبدّل المسرح بس.
        "layoutCss": str(result.get("layout_css") or ""),
        # ومواضع عناصر Tilda وارتفاعات الأقسام والستايل المشترك —
        # دول كانوا بيتكتبوا مرة واحدة وقت تحميل الإطار، فالمحرر كان
        # بيفضل على مواضع أول تحميل والصفحة الحية على الجديدة.
        "zeroCss": str(result.get("zero_css") or ""),
        "sharedCss": str(result.get("shared_css") or ""),
        "pattern": result["theme"].get("pattern") or "none",
        "maxWidth": result["theme"].get("max_width"),
        "runtimeCountdownDate": result.get("runtime_countdown_date") or "",
        "direction": result["theme"].get("direction") or "rtl",
        "music": {
            "url": result["settings"].get("music_url") or "",
            "autoplay": bool(result["settings"].get("music_autoplay")),
            "loop": bool(result["settings"].get("music_loop")),
            "player": result["settings"].get("music_player") or "floating",
        },
        "blockCount": result["block_count"],
    })


@login_required
@require_POST
def template_api_save(request, pk):
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    body = _json_body(request)
    document = blocks_engine.normalize_document(body.get("document") or {})
    template.document = document
    template.preview_render = {}
    template.save(update_fields=["document", "preview_render", "updated_at"])
    try:
        get_template_preview(template)
    except Exception:
        pass
    return JsonResponse({
        "ok": True,
        "savedAt": timezone.localtime().strftime("%H:%M:%S"),
        "publicUrl": request.build_absolute_uri(
            reverse("template_demo", kwargs={"slug": template.slug})
        ),
    })


@login_required
@require_GET
def template_api_assets(request, pk):
    _staff_required(request)
    get_object_or_404(Template, pk=pk)
    assets = list(Asset.objects.filter(
        invitation__isnull=True
    ).order_by("-id")[:300])
    usage = _asset_usage_map(assets)
    return JsonResponse({
        "ok": True,
        "assets": [
            {"id": a.pk, "url": a.url, "thumb": a.thumb_url,
             "source": a.source_url, "name": a.original_name,
             "kind": a.kind, "used": usage.get(a.pk, False)}
            for a in assets
        ],
    })


@login_required
@ensure_csrf_cookie
def invitation_editor(request, pk):

    _staff_required(request)
    invitation = get_object_or_404(
        Invitation.objects.select_related("template", "customer", "plan"), pk=pk
    )
    document = invitation.get_document()
    if not document["blocks"]:
        document = invitation.template.get_document()

    settings_form = InvitationSettingsForm(instance=invitation)
    invitation_assets = list(Asset.objects.filter(
        Q(invitation=invitation) | Q(invitation__isnull=True)
    ).order_by("-id")[:300])
    invitation_usage = _asset_usage_map(invitation_assets)

    return render(request, "editor/editor.html", {

        "invitation": invitation,
        "client_followup_url": request.build_absolute_uri(invitation.get_client_followup_url()),
        "form": settings_form,
        "schema_json": blocks_engine.editor_schema(),
        "document_json": document,
        "assets_json": [
            # ‎source‎ = الأصل قبل أي قص. نافذة القص بتعرضه وبتقص منه —
            # لو ما بعتناهوش بتعرض النسخة المقصوصة وتقص من الأصل،
            # فالكادر اللي بتختاره مالوش أي علاقة باللي بيطلع.
            {"id": a.pk, "url": a.url, "thumb": a.thumb_url,
             "source": a.source_url, "name": a.original_name, "kind": a.kind,
             "used": invitation_usage.get(a.pk, False)}
            # الملفات العامة (invitation=None) مكتبة مشتركة بين كل الدعوات
            for a in invitation_assets

        ],
        "features_json": sorted(invitation.allowed_features),
        "fonts_json": _font_library_json(),
        "favorites_json": _favorites_json(),
        # معرض الافتتاحيات — بيظهر في مُنتقي الفيديو جوه المحرر

        "intros_json": [
            {"id": v.pk, "name": v.name, "url": v.url,
             "poster": v.poster_url, "seconds": v.seconds, "note": v.note}
            for v in IntroVideo.objects.filter(is_active=True)
            if v.url
        ],
        # مكتبة الموسيقى المشتركة — بتظهر في مُنتقي الصوت جوه المحرر
        "music_json": [
            {"id": m.pk, "name": m.name, "url": m.url, "note": m.note}
            for m in MusicTrack.objects.filter(is_active=True)
            if m.url
        ],
        "template_categories": Template.CATEGORY_CHOICES,
        "meta_json": {
            "invitationId": invitation.pk,
            "slug": invitation.slug,
            "status": invitation.status,
            "planName": invitation.plan.name,
            "templateName": invitation.template.name,
            "publicUrl": request.build_absolute_uri(invitation.get_absolute_url()),
            "clientFollowupUrl": request.build_absolute_uri(invitation.get_client_followup_url()),
            "urls": {
                "preview": f"/dashboard/invitations/{invitation.pk}/api/preview/",
                "save": f"/dashboard/invitations/{invitation.pk}/api/save/",
                "fontCreate": "/dashboard/fonts/api/create/",
                "favoriteCreate": "/dashboard/favorites/api/create/",
                "favoriteDeleteBase": "/dashboard/favorites/",
                "upload": f"/dashboard/invitations/{invitation.pk}/api/upload/",

                "saveTemplate": f"/dashboard/invitations/{invitation.pk}/api/save-template/",
                "assets": f"/dashboard/invitations/{invitation.pk}/api/assets/",
                "deleteAsset": f"/dashboard/invitations/{invitation.pk}/api/assets/delete/",
                "deleteAssets": f"/dashboard/invitations/{invitation.pk}/api/assets/bulk-delete/",
                "crop": f"/dashboard/invitations/{invitation.pk}/api/crop/",

                "frame": f"/dashboard/invitations/{invitation.pk}/preview-frame/",
                "back": "/dashboard/invitations/",
                "public": invitation.get_absolute_url(),
                "clientFollowup": invitation.get_client_followup_url(),
            },
        },
    })


@login_required
def invitation_preview_frame(request, pk):
    """الإطار الذي يُحمَّل داخل المحرر — يُحدَّث لاحقاً بالـHTML الجزئي."""
    _staff_required(request)
    invitation = get_object_or_404(
        Invitation.objects.select_related("template", "plan"), pk=pk
    )
    return _render_invitation_page(request, invitation, editable=True, noindex=True)


@login_required
@require_POST
def api_preview(request, pk):
    """يستقبل المستند الحالي من المحرر ويعيد HTML + متغيرات CSS."""
    _staff_required(request)
    invitation = get_object_or_404(
        Invitation.objects.select_related("template", "plan"), pk=pk
    )
    body = _json_body(request)
    result = render_document(
        body.get("document") or {},
        invitation=invitation,
        request=request,
        allowed_features=invitation.allowed_features,
        editable=True,
        runtime_scripts=getattr(invitation.template, "runtime_scripts", []),
        runtime_root_attrs=getattr(invitation.template, "runtime_root_attrs", {}),
        # المحرر بيعاين اللغة اللي المصمّم واقف عليها في تبويب الترجمة

        lang=(body.get("lang") or ""),
    )
    doc_settings = result["settings"]
    # الافتتاحية أخت لـ.lb-stage مش جواه، والمحرر بيبدّل الـstage بس.
    # فبنعرضها هنا لوحدها عشان تعديلاتها تبان لحظياً زي الأقسام.
    intro_html = render_to_string("invitations/_intro.html", {
        "render": result, "editable": True, "guest": None,
    }, request=request)
    return JsonResponse({
        "ok": True,
        "html": str(result["html"]),
        "intro": intro_html.strip(),
        "cssVars": result["css_vars"],
        "fontCss": result["font_css"],
        # إزاحات النصوص + تنسيق كل نص لوحده — تتكتب في رأس الإطار
        # بعد كل تحديث معاينة (applyPreview بتبدّل المسرح بس).
        "layoutCss": str(result.get("layout_css") or ""),
        # ومواضع عناصر Tilda وارتفاعات الأقسام والستايل المشترك.
        "zeroCss": str(result.get("zero_css") or ""),
        "sharedCss": str(result.get("shared_css") or ""),
        "pattern": result["theme"].get("pattern") or "none",

                "maxWidth": result["theme"].get("max_width"),
        "runtimeCountdownDate": result.get("runtime_countdown_date") or "",
        "direction": result["theme"].get("direction") or "rtl",
        "music": {

            "url": doc_settings.get("music_url") or "",
            "autoplay": bool(doc_settings.get("music_autoplay")),
            "loop": bool(doc_settings.get("music_loop")),
            "player": doc_settings.get("music_player") or "floating",
        } if "music" in invitation.allowed_features else {},
        "blockCount": result["block_count"],
    })


@login_required
@require_POST
def api_save(request, pk):
    """يحفظ المستند + بيانات المناسبة."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    body = _json_body(request)

    document = blocks_engine.normalize_document(body.get("document") or {})

    fields = body.get("fields") or {}
    form = InvitationSettingsForm(fields, instance=invitation)
    if not form.is_valid():
        return JsonResponse({"ok": False, "errors": form.errors}, status=400)

    with transaction.atomic():
        invitation = form.save(commit=False)
        invitation.document = document
        invitation.save()

    return JsonResponse({
        "ok": True,
        "savedAt": timezone.localtime().strftime("%H:%M:%S"),
        "slug": invitation.slug,
        "status": invitation.status,
        "publicUrl": request.build_absolute_uri(invitation.get_absolute_url()),
    })


def _upload_asset_for_editor(request, *, invitation=None, template=None):
    """يرفع أصلاً للمحرر مع ربطه بالدعوة أو القالب صاحب المكتبة."""
    upload = request.FILES.get("file")
    if not upload:
        return JsonResponse({"ok": False, "error": "لم يصل أي ملف."}, status=400)
    guessed = mimetypes.guess_type(upload.name)[0] or ""
    content_type = (getattr(upload, "content_type", "") or guessed).lower()
    # بعض المتصفحات/الاستضافات ترسل m4v أو الملف كـ octet-stream؛
    # نستخدم امتداداً معروفاً فقط كـ fallback، ولا نقبل امتدادات عشوائية.
    extension_type = _VIDEO_EXTENSION_TYPES.get(Path(upload.name).suffix.lower())
    if content_type in _GENERIC_UPLOAD_TYPES and extension_type:
        content_type = extension_type
    elif content_type == "video/x-m4v":
        content_type = "video/mp4"

    if content_type in ALLOWED_IMAGE_TYPES:
        kind = "image"
    elif content_type in ALLOWED_AUDIO_TYPES:
        kind = "audio"
    elif content_type in ALLOWED_VIDEO_TYPES:
        kind = "video"
    else:
        return JsonResponse(
            {"ok": False, "error": "نوع الملف غير مسموح. ارفع صورة أو فيديو أو ملف صوت."},
            status=400,
        )

    # فحص الحجم بعد ما نعرف النوع — الفيديو حده أعلى من الصورة
    cap = MAX_VIDEO_BYTES if kind == "video" else MAX_ASSET_BYTES
    if upload.size > cap:
        return JsonResponse(
            {"ok": False,
             "error": f"حجم الملف أكبر من {_ar_num(cap // (1024 * 1024))} ميجابايت."},
            status=400,
        )

    width = height = 0
    stored, thumb, source = upload, None, None
    # المتصفح يرسل أول فريم كصورة JPEG عندما لا يتوفر ffmpeg على السيرفر.
    if kind == "video":
        client_thumb = request.FILES.get("thumb")
        if client_thumb and client_thumb.size <= 2 * 1024 * 1024:
            thumb_type = (getattr(client_thumb, "content_type", "") or "").lower()
            if thumb_type in {"image/jpeg", "image/png", "image/webp"}:
                try:
                    from PIL import Image
                    with Image.open(client_thumb) as thumb_img:
                        thumb_img.verify()
                    client_thumb.seek(0)
                    thumb = client_thumb
                except Exception:
                    thumb = None

    if kind == "image" and content_type != "image/svg+xml":
        try:
            from PIL import Image
            with Image.open(upload) as img:
                img.verify()            # يرفض الملفات المزيّفة
            upload.seek(0)
        except Exception:
            return JsonResponse(
                {"ok": False, "error": "الصورة تالفة أو غير صالحة."}, status=400
            )

        try:
            stored, thumb, width, height = images.compress(upload, content_type)
        except Exception:
            upload.seek(0)
            stored, thumb = upload, None
        else:
            # نحتفظ بالأصل عشان القص لاحقاً يبقى من غير فقد جودة
            if stored is not upload and upload.size <= MAX_ASSET_BYTES:
                upload.seek(0)
                source = upload

    seconds = 0.0
    if kind == "video":

        # نجهّز MP4 للبدء السريع من غير إعادة ترميز أو تغيير جودة/مدة الفيديو.
        try:
            stored, seconds = video.prepare_for_stream(upload)

        except Exception:
            upload.seek(0)
            stored, seconds = upload, 0.0

        # صورة أول فريم مستقلة للبطاقة — فشلها لا يمنع رفع الفيديو.
        # نستخدم نسخة المتصفح أولاً؛ ونحاول ffmpeg فقط إذا لم تصل صورة.
        if thumb is None:
            try:
                thumb = video.make_thumbnail(stored)
            except Exception:
                thumb = None

    try:
        asset = Asset.objects.create(
            file=stored, thumb=thumb, source=source,
            kind=kind, original_name=upload.name[:200],
            width=width, height=height, size_bytes=getattr(stored, "size", upload.size),
            invitation=invitation, template=template, uploaded_by=request.user,
        )
    except Exception:
        owner_type = "invitation" if invitation is not None else "template"
        owner_id = getattr(invitation or template, "pk", None)
        logger.exception("Asset upload save failed for %s=%s", owner_type, owner_id)
        return JsonResponse({
            "ok": False,
            "error": "تعذّر حفظ الملف على السيرفر. راجع صلاحيات مجلد media وسجل أخطاء التطبيق.",
        }, status=500)
    return JsonResponse({
        "ok": True,
        "asset": {"id": asset.pk, "url": asset.url, "thumb": asset.thumb_url,
                  "source": asset.source_url,
                  "name": asset.original_name, "kind": asset.kind,
                  "width": width, "height": height, "seconds": seconds},
    })


@login_required
@require_POST
def api_upload(request, pk):
    """رفع أصل لمكتبة الدعوة."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    return _upload_asset_for_editor(request, invitation=invitation)


@login_required
@require_POST
def template_api_upload(request, pk):
    """رفع أصل لمكتبة القالب."""
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    return _upload_asset_for_editor(request, template=template)


def _crop_asset_for_editor(request, *, invitation=None, template=None):
    """يقص صورة من الأصل ويحفظ الناتج كأصل جديد في مكتبة الدعوة أو القالب.

    القص بيتم من النسخة الأصلية مش المعروضة، فمفيش فقد جودة متراكم لو
    قصيت أكتر من مرة. والأصل بيفضل محفوظ فتقدر ترجع تقص من جديد.
    """
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "طلب غير صالح."}, status=400)

    box = payload.get("box") or {}
    if not isinstance(box, dict):
        return JsonResponse({"ok": False, "error": "حدود القص غير صالحة."}, status=400)

    asset = Asset.objects.filter(pk=payload.get("asset"), kind="image").first()
    if asset is None:
        return JsonResponse({"ok": False, "error": "الصورة غير موجودة."}, status=404)
    # مكتبة القالب هي الأصول غير المربوطة بدعوة — نفس اللي بيعرضه
    # ‎template_api_assets‎ بالظبط.
    if invitation is not None:
        if asset.invitation_id not in (None, invitation.pk):
            return JsonResponse({"ok": False, "error": "الصورة مش من مكتبة الدعوة دي."},
                                status=403)
    elif asset.invitation_id is not None:
        return JsonResponse({"ok": False, "error": "الصورة مش من مكتبة القوالب."},
                            status=403)

    source = asset.source if asset.source else asset.file
    try:
        source.open("rb")
        img, (width, height) = images.crop(source, box)
    except Exception:
        return JsonResponse({"ok": False, "error": "تعذّر قص الصورة."}, status=400)
    finally:
        try:
            source.close()
        except Exception:
            pass

    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=images.QUALITY, method=5)
    size = buf.tell()
    buf.seek(0)

    stem = (asset.original_name or "image").rsplit(".", 1)[0][:60]
    thumb_io = io.BytesIO()
    small = img.copy()
    small.thumbnail((images.THUMB_EDGE, images.THUMB_EDGE))
    small.save(thumb_io, "WEBP", quality=images.THUMB_QUALITY, method=5)
    thumb_io.seek(0)

    new = Asset.objects.create(
        file=ContentFile(buf.read(), name=f"{stem}-crop.webp"),
        thumb=ContentFile(thumb_io.read(), name=f"{stem}-crop-thumb.webp"),
        source=asset.source or asset.file,     # الأصل نفسه عشان إعادة القص
        kind="image", original_name=asset.original_name,
        width=width, height=height, size_bytes=size,
        invitation=invitation, template=template, uploaded_by=request.user,
    )
    return JsonResponse({"ok": True, "asset": {
        "id": new.pk, "url": new.url, "thumb": new.thumb_url,
        "source": new.source_url,
        "name": new.original_name, "kind": "image",
        "width": width, "height": height,
    }})


@login_required
@require_POST
def api_crop(request, pk):
    """قص صورة من مكتبة دعوة."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    return _crop_asset_for_editor(request, invitation=invitation)


@login_required
@require_POST
def template_api_crop(request, pk):
    """قص صورة من مكتبة القوالب — نفس زر «قصّ الصورة» في محرر القالب."""
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    return _crop_asset_for_editor(request, template=template)


@login_required
@require_GET
def api_assets(request, pk):
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    assets = list(Asset.objects.filter(
        Q(invitation=invitation) | Q(invitation__isnull=True)
    ).order_by("-id")[:300])
    usage = _asset_usage_map(assets)
    return JsonResponse({
        "ok": True,
        "assets": [
            {"id": a.pk, "url": a.url, "thumb": a.thumb_url,
             "source": a.source_url, "name": a.original_name,
             "kind": a.kind, "used": usage.get(a.pk, False)}
            for a in assets
        ],
    })


def _value_contains_asset(value, needles):
    """Search JSON-like document data without assuming a fixed block schema."""
    if isinstance(value, dict):
        return any(_value_contains_asset(v, needles) for v in value.values())
    if isinstance(value, (list, tuple)):
        return any(_value_contains_asset(v, needles) for v in value)
    if isinstance(value, str):
        return any(needle and needle in value for needle in needles)
    return False


def _asset_needles(asset):
    names = {
        str(asset.file.name or ""),
        str(asset.thumb.name or ""),
        str(asset.source.name or ""),
        str(asset.url or ""),
        str(asset.thumb_url or ""),
        str(asset.source_url or ""),
    }
    names.discard("")
    return names


def _asset_usage_map(assets):
    """Return usage flags while scanning every saved document only once.

    The old implementation tested every asset needle against every document,
    which becomes extremely slow for imported templates with large bundles.
    A single compiled regex preserves the same substring semantics but reduces
    the work to one pass per document.
    """
    usage = {asset.pk: False for asset in assets}
    if not usage:
        return usage

    needle_to_assets = {}
    for asset in assets:
        for needle in _asset_needles(asset):
            needle_to_assets.setdefault(needle, set()).add(asset.pk)
    if not needle_to_assets:
        return usage

    pattern = re.compile("|".join(
        re.escape(needle)
        for needle in sorted(needle_to_assets, key=len, reverse=True)
    ))
    documents = list(Template.objects.values_list("document", flat=True))
    documents += list(Invitation.objects.values_list("document", flat=True))
    remaining = set(usage)
    for document in documents:
        text = json.dumps(document, ensure_ascii=False, default=str)
        for match in pattern.finditer(text):
            for asset_id in needle_to_assets[match.group(0)]:
                usage[asset_id] = True
                remaining.discard(asset_id)
        if not remaining:
            break
    return usage


def _asset_is_used(asset):
    """Do not remove a media file while a template or invitation still points to it."""
    return _asset_usage_map([asset]).get(asset.pk, False)


def _delete_asset_files(asset):
    """Delete physical files only when no other Asset row shares them."""
    names = {asset.file.name, asset.thumb.name, asset.source.name}
    names.discard("")
    for name in names:
        shared = Asset.objects.exclude(pk=asset.pk).filter(
            Q(file=name) | Q(thumb=name) | Q(source=name)
        ).exists()
        if not shared:
            try:
                default_storage.delete(name)
            except Exception:
                pass


def _delete_asset_for_editor(request, asset_id, *, invitation=None, template=None, kind="image"):
    kind = kind if kind in {"image", "video"} else "image"
    label = "الفيديو" if kind == "video" else "الصورة"
    try:
        asset_id = int(asset_id)
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": f"{label} غير صالح."}, status=400)
    asset = Asset.objects.filter(pk=asset_id, kind=kind).first()
    if asset is None:
        return JsonResponse({"ok": False, "error": f"{label} غير موجود."}, status=404)
    if invitation is not None:
        if asset.invitation_id not in (None, invitation.pk):
            return JsonResponse({"ok": False, "error": f"{label} مش من مكتبة الدعوة دي."}, status=403)
    if template is not None:
        if asset.invitation_id is not None or asset.template_id not in (None, template.pk):
            return JsonResponse({"ok": False, "error": f"{label} مش من مكتبة القالب ده."}, status=403)
    if _asset_is_used(asset):
        return JsonResponse({
            "ok": False,
            "used": True,
            "error": f"مينفعش تمسح {label} مستخدم داخل قالب أو دعوة.",
        }, status=409)
    _delete_asset_files(asset)
    asset.delete()
    return JsonResponse({"ok": True, "deleted": asset_id})


@login_required
@require_POST
def api_delete_asset(request, pk):
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    body = _json_body(request)
    kind = body.get("kind") if body.get("kind") in {"image", "video"} else "image"
    return _delete_asset_for_editor(request, body.get("asset"), invitation=invitation, kind=kind)


@login_required
@require_POST
def template_api_delete_asset(request, pk):
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    body = _json_body(request)
    kind = body.get("kind") if body.get("kind") in {"image", "video"} else "image"
    return _delete_asset_for_editor(request, body.get("asset"), template=template, kind=kind)


def _bulk_delete_assets_for_editor(asset_ids, *, invitation=None, template=None, kind="image"):
    kind = kind if kind in {"image", "video"} else "image"
    label = "الفيديوهات" if kind == "video" else "الصور"
    singular_label = "فيديو" if kind == "video" else "صورة"
    try:
        ids = {int(value) for value in (asset_ids or [])}
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": f"اختيار {label} غير صالح."}, status=400)
    if not ids or len(ids) > 300:
        return JsonResponse({"ok": False, "error": f"اختار {singular_label} واحدة على الأقل."}, status=400)

    assets = list(Asset.objects.filter(pk__in=ids, kind=kind))
    if len(assets) != len(ids):
        return JsonResponse({"ok": False, "error": f"بعض {label} لم تعد موجودة."}, status=404)
    for asset in assets:
        if invitation is not None and asset.invitation_id not in (None, invitation.pk):
            return JsonResponse({"ok": False, "error": f"فيه أصل مش من مكتبة الدعوة دي."}, status=403)
        if template is not None and (asset.invitation_id is not None or asset.template_id not in (None, template.pk)):
            return JsonResponse({"ok": False, "error": f"فيه أصل مش من مكتبة القالب ده."}, status=403)

    usage = _asset_usage_map(assets)
    blocked = [asset.original_name or str(asset.pk) for asset in assets if usage.get(asset.pk)]
    if blocked:
        return JsonResponse({
            "ok": False,
            "used": True,
            "blocked": blocked,
            "error": f"لم يتم حذف {label}; بعض الملفات المحددة مستخدمة داخل قالب أو دعوة.",
        }, status=409)

    with transaction.atomic():
        for asset in assets:
            _delete_asset_files(asset)
            asset.delete()
    return JsonResponse({"ok": True, "deleted": sorted(ids)})


@login_required
@require_POST
def api_delete_assets(request, pk):
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    body = _json_body(request)
    kind = body.get("kind") if body.get("kind") in {"image", "video"} else "image"
    return _bulk_delete_assets_for_editor(body.get("assets"), invitation=invitation, kind=kind)


@login_required
@require_POST
def template_api_delete_assets(request, pk):
    _staff_required(request)
    template = get_object_or_404(Template, pk=pk)
    body = _json_body(request)
    kind = body.get("kind") if body.get("kind") in {"image", "video"} else "image"
    return _bulk_delete_assets_for_editor(body.get("assets"), template=template, kind=kind)


@login_required
@require_POST
def api_save_as_template(request, pk):

    """يحوّل الدعوة الحالية إلى قالب جديد في المكتبة — بدون كتابة كود."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    body = _json_body(request)

    name = (body.get("name") or "").strip()[:120]
    if len(name) < 2:
        return JsonResponse({"ok": False, "error": "اكتب اسماً للقالب."}, status=400)

    document = blocks_engine.normalize_document(body.get("document") or {})

    # نفرّغ البيانات الشخصية حتى يبدأ القالب نظيفاً
    for block in document["blocks"]:
        if block["type"] == "hero":
            block["props"]["date_text"] = ""
        if block["type"] == "location":
            block["props"]["map_embed"] = block["props"].get("map_embed") or ""

    required = sorted({
        blocks_engine.BLOCK_REGISTRY[b["type"]]["feature"]
        for b in document["blocks"]
        if blocks_engine.BLOCK_REGISTRY.get(b["type"], {}).get("feature")
    })

    template = Template.objects.create(
        name=name,
        slug=slugify(body.get("slug") or name, allow_unicode=False) or "",
        category=body.get("category") if body.get("category") in dict(
            Template.CATEGORY_CHOICES
        ) else "wedding",
        collection=(body.get("collection") or "Premium")[:40],
        description=(body.get("description") or "")[:2000],
        document=document,
        required_features=required,
        source="editor",
        is_active=bool(body.get("is_active", True)),
        created_by=request.user,
    )
    try:
        get_template_preview(template)
    except Exception:
        pass
    return JsonResponse({

        "ok": True, "templateId": template.pk, "slug": template.slug,
        "message": f"تم حفظ القالب «{template.name}» في المكتبة.",
    })


# ==========================================================================
# QR
# ==========================================================================
@require_GET
def invitation_qr(request, slug):
    invitation = get_object_or_404(Invitation, slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404
    url = request.build_absolute_uri(invitation.get_absolute_url())
    svg = qrcodes.svg_for(url)
    return HttpResponse(svg, content_type="image/svg+xml")


def _guest_pass_payload(request, guest) -> dict:
    """بيانات التصريح اللي بتروح للمتصفح بعد تأكيد الحضور."""
    return {
        "code": guest.pass_code,
        "name": guest.name,
        "entries": guest.entries_allowed,
        "url": request.build_absolute_uri(
            reverse("guest_pass", kwargs={"slug": guest.invitation.slug,
                                          "token": guest.token})),
        "qr": request.build_absolute_uri(
            reverse("guest_qr", kwargs={"slug": guest.invitation.slug,
                                        "token": guest.token})),
        "download": request.build_absolute_uri(
            reverse("guest_qr_png", kwargs={"slug": guest.invitation.slug,
                                            "token": guest.token})),
    }


def guest_pass(request, slug, token):
    """صفحة تصريح الدخول — الضيف بيشوف الـQR ويحمّله من هنا.

    مفتوحة بالرمز زي الرابط الشخصي: اللي معاه الرابط معاه التصريح.
    """
    invitation = get_object_or_404(
        Invitation.objects.select_related("plan"), slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404("الدعوة غير متاحة.")
    guest = get_object_or_404(Guest, invitation=invitation,
                              token=(token or "").strip())
    url = request.build_absolute_uri(guest.get_absolute_url())
    return render(request, "invitations/pass.html", {
        "invitation": invitation,
        "guest": guest,
        "rsvp": guest.latest_rsvp,
        "qr_svg": mark_safe(qrcodes.svg_for(url, box_size=8, border=2)),
        "png_url": reverse("guest_qr_png", kwargs={"slug": slug, "token": guest.token}),
        "site_name": settings.SITE_NAME,
    })


def guest_qr_png(request, slug, token):
    """نفس رمز الضيف بس PNG — عشان يتحمّل ويتبعت في واتساب.

    الـSVG أنضف للعرض، بس تطبيقات المحادثة مابتعرضهوش، والضيف بيحتاج
    صورة يحفظها في الاستديو ويوريها على الباب.
    """
    invitation = get_object_or_404(Invitation, slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404
    guest = get_object_or_404(Guest, invitation=invitation, token=(token or "").strip())
    url = request.build_absolute_uri(guest.get_absolute_url())
    png = qrcodes.png_for(url, label=guest.pass_code, caption=guest.name)
    if png is None:
        raise Http404("توليد الصور غير متاح على الخادم.")
    res = HttpResponse(png, content_type="image/png")
    res["Content-Disposition"] = (
        f'attachment; filename="{guest.pass_code or "pass"}.png"')
    return res


def guest_qr(request, slug, token):
    """رمز الضيف. بيشفّر رابطه الشخصي، فنفس الرمز بيخدم غرضين:
    الضيف يمسحه بكاميرا تليفونه فتفتحله دعوته، والاستقبال يمسحه على الباب
    فيتسجّل دخوله."""
    invitation = get_object_or_404(Invitation, slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404
    guest = get_object_or_404(Guest, invitation=invitation, token=(token or "").strip())
    url = request.build_absolute_uri(guest.get_absolute_url())
    return HttpResponse(qrcodes.svg_for(url), content_type="image/svg+xml")


@login_required
def guests_export(request, pk):
    """كشف الضيوف كملف إكسل ومعاه رموز QR — للقاعة."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)

    guests = list(invitation.guests.all())
    only = request.GET.get("only", "")
    if only == "attending":
        guests = [g for g in guests if g.entries_allowed > 0]

    try:
        data = guestexport.build(
            invitation, guests,
            base_url=request.build_absolute_uri("/").rstrip("/"),
        )
    except ImportError:
        messages.error(request, "تصدير إكسل محتاج حزمة openpyxl على الخادم.")
        return redirect("guests", pk=pk)

    name = slugify(invitation.slug or "guests", allow_unicode=False) or "guests"
    res = HttpResponse(
        data,
        content_type="application/vnd.openxmlformats-officedocument."
                     "spreadsheetml.sheet",
    )
    res["Content-Disposition"] = f'attachment; filename="{name}-guests.xlsx"'
    return res


@login_required
def guest_qr_sheet(request, pk):
    """صفحة طباعة فيها كارت لكل ضيف — تتقص وتتوزع على الباب."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    guests = []
    for g in invitation.guests.all():
        url = request.build_absolute_uri(g.get_absolute_url())
        guests.append({
            "guest": g,
            "url": url,
            "svg": mark_safe(qrcodes.svg_for(url, box_size=6, border=1)),
        })
    return render(request, "dashboard/qr_sheet.html", {
        "invitation": invitation, "rows": guests, "nav": "invitations",
    })


@login_required
def checkin_scanner(request, pk):
    """شاشة الاستقبال — تمسح رمز الضيف وتسجّل دخوله."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    return render(request, "dashboard/checkin.html", {
        "invitation": invitation,
        "nav": "invitations",
        # بنعدّ الدخلات مش الصفوف — الضيف اللي معاه ٣ بيتحسب ٣
        "arrived": invitation.guests.aggregate(n=Sum("entries_used"))["n"] or 0,
        "total": invitation.guests.aggregate(n=Sum("entries_allowed"))["n"] or 0,
    })


@login_required
@require_POST
def checkin_scan(request, pk):
    """يستقبل الرمز من الماسح ويسجّل الوصول.

    إعادة المسح مش بتنجح بصمت — بترجّع تحذير إن الرمز اتسجّل قبل كده،
    عشان الاستقبال ياخد باله لو حد بيمرّر نفس الدعوة لأكتر من شخص.
    """
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)

    token = (request.POST.get("token") or "").strip()
    # الماسح بيرجّع الرابط كامل — نطلّع منه الرمز
    if "/g/" in token:
        token = token.rstrip("/").rsplit("/g/", 1)[-1].split("/")[0].split("?")[0]
    if not (8 <= len(token) <= 64):
        return JsonResponse({"ok": False, "error": "رمز غير صالح."}, status=400)

    # الكود القصير بيتقبل كمان — الاستقبال بيكتبه بالإيد لو الـQR
    # مارضيش يتمسح (شاشة مكسورة، إضاءة وحشة، ورق مكرمش)
    guest = invitation.guests.filter(token=token).first()
    if guest is None:
        guest = invitation.guests.filter(pass_code__iexact=token).first()
    if guest is None:
        return JsonResponse(
            {"ok": False, "error": "الرمز ده مش من ضيوف الدعوة دي."}, status=404)

    """التصريح بيتعدّ بالدخلات مش بمرة واحدة.

    الضيف اللي معاه ٣ دخلات بيدخل هو واتنين معاه، وكل مسحة بتستهلك
    واحدة. لما تخلص الحالة بتبقى «مستخدم» والمسحة الجاية بترجّع تحذير
    بدل ما تعدّي حد زيادة بصمت.
    """
    allowed = guest.entries_allowed
    consumed = guest.consume_entry()
    when = timezone.localtime(guest.checked_in_at) if guest.checked_in_at else None

    if allowed <= 0:
        error = "الضيف ده مالوش تصريح دخول — ما أكّدش حضوره."
    elif not consumed:
        error = f"التصريح خلص — اتمسح {guest.entries_used} من {allowed}."
    else:
        error = ""

    rsvp = guest.latest_rsvp
    return JsonResponse({
        "ok": True,
        # already = مسحة زيادة بعد ما التصريح خلص
        "already": not consumed,
        "error": error,
        "name": guest.name,
        "code": guest.pass_code,
        "group": guest.group_name,
        "companions": guest.plus_ones_allowed,
        "used": guest.entries_used,
        "allowed": allowed,
        "left": guest.entries_left,
        "status": guest.pass_status,
        "rsvp": rsvp.get_status_display() if rsvp else "",
        "at": when.strftime("%H:%M") if when else "",
        "arrived": invitation.guests.aggregate(n=Sum("entries_used"))["n"] or 0,
        "total": invitation.guests.aggregate(n=Sum("entries_allowed"))["n"] or 0,
    })


# ==========================================================================
@login_required
def analytics(request):
    _staff_required(request)
    invitations = Invitation.objects.annotate(
        rsvp_total=Count("rsvps", distinct=True),
        guest_total=Count("guests", distinct=True),
    ).order_by("-public_views")[:12]
    chart = [
        {"label": inv.title[:24], "views": inv.public_views, "rsvps": inv.rsvp_total}
        for inv in invitations
    ]
    return render(request, "dashboard/analytics.html", {
        "nav": "analytics",
        "invitations": invitations,
        "chart_json": chart,
        "totals": {
            "views": Invitation.objects.aggregate(v=Sum("public_views"))["v"] or 0,
            "attending": RSVPResponse.objects.filter(status="attending").count(),
            "declined": RSVPResponse.objects.filter(status="declined").count(),
        },
    })


@login_required
def dashboard_plans(request):
    """الباقات والإضافات — تعديل الأسعار وإضافات بسعر زيادة."""
    _staff_required(request)
    editing = None
    form = PlanAddonForm()

    if request.method == "POST":
        action = request.POST.get("action", "")

        if action in {"delete", "toggle"}:
            addon = get_object_or_404(PlanAddon, pk=request.POST.get("addon") or 0)
            if action == "delete":
                # الإضافة اللي اتباعت في طلب مابتتشالش — الطلب بيشاور
                # عليها، ومسحها بيمسح تاريخ الطلب معاها
                if addon.order_addons.exists():
                    addon.is_active = False
                    addon.save(update_fields=["is_active", "updated_at"])
                    messages.warning(
                        request,
                        f"«{addon.name}» اتشترت في طلبات قبل كده، فاتخبّت بدل "
                        "ما تتمسح عشان الطلبات القديمة تفضل مقروءة.",
                    )
                else:
                    name = addon.name
                    addon.delete()
                    messages.success(request, f"اتمسحت «{name}».")
            else:
                addon.is_active = not addon.is_active
                addon.save(update_fields=["is_active", "updated_at"])
                messages.success(
                    request,
                    ("فعّلت" if addon.is_active else "وقّفت") + f" «{addon.name}».",
                )
            return redirect("dashboard_plans")

        if action == "plan":
            plan = get_object_or_404(Plan, pk=request.POST.get("plan") or 0)
            # تعديل سريع للاسم والسعر من الجدول — الباقي في إدارة البيانات
            plan.name = (request.POST.get("name") or plan.name).strip()[:80]
            try:
                plan.price = Decimal(request.POST.get("price") or plan.price)
                raw_old = (request.POST.get("old_price") or "").strip()
                plan.old_price = Decimal(raw_old) if raw_old else None
            except (InvalidOperation, TypeError):
                messages.error(request, "السعر لازم يكون رقم.")
                return redirect("dashboard_plans")
            if plan.price < 0 or (plan.old_price is not None and plan.old_price < 0):
                messages.error(request, "السعر ماينفعش يكون بالسالب.")
                return redirect("dashboard_plans")
            plan.is_active = request.POST.get("is_active") == "on"
            plan.save(update_fields=["name", "price", "old_price", "is_active",
                                     "updated_at"])
            messages.success(request, f"اتحفظت باقة «{plan.name}».")
            return redirect("dashboard_plans")

        else:
            pk = request.POST.get("addon") or ""
            instance = PlanAddon.objects.filter(pk=pk).first() if pk else None
            form = PlanAddonForm(request.POST, instance=instance)
            if form.is_valid():
                addon = form.save()
                messages.success(
                    request,
                    ("اتحفظت" if instance else "اتضافت") + f" «{addon.name}».",
                )
                return redirect("dashboard_plans")
            editing = instance
            messages.error(request, "راجع البيانات — فيه حقل ناقص أو غلط.")

    edit_pk = request.GET.get("edit")
    if edit_pk and request.method == "GET":
        editing = PlanAddon.objects.filter(pk=edit_pk).first()
        if editing:
            form = PlanAddonForm(instance=editing)

    return render(request, "dashboard/plans.html", {
        "nav": "plans",
        "form": form,
        "editing": editing,
        "addons": PlanAddon.objects.prefetch_related("plans"),
        "plans": Plan.objects.all(),
        "feature_keys": sorted(blocks_engine.feature_keys()),
    })


@login_required
def dashboard_site(request):
    """إعدادات الموقع — شريط المعاينة وروابط التواصل."""
    _staff_required(request)
    cfg = SiteSetting.load()
    form = SiteSettingForm(request.POST or None, instance=cfg)
    if request.method == "POST" and form.is_valid():
        form.save()
        messages.success(request, "اتحفظت الإعدادات.")
        return redirect("dashboard_site")
    return render(request, "dashboard/site.html", {
        "nav": "site",
        "form": form,
        "cfg": cfg,
        "sample": Template.objects.filter(is_active=True).first(),
    })
