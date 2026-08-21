"""العروض (views) — الموقع العام، الدعوة، لوحة التحكم، وواجهة المحرر."""

from __future__ import annotations

import hashlib
import io
import json
import mimetypes

from django.conf import settings
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Count, F, Q, Sum
from django.http import (
    Http404, HttpResponse, HttpResponseBadRequest, JsonResponse,
)
from django.shortcuts import get_object_or_404, redirect, render
from django.template.loader import render_to_string
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from . import blocks as blocks_engine
from . import qrcodes
from .forms import (
    GuestForm, InvitationSettingsForm, MusicTrackForm, OrderForm,
)
from .models import (
    Asset, Customer, Guest, Invitation, MusicTrack, Order, Plan, RSVPResponse,
    Template,
)
from django.utils.safestring import mark_safe
from .renderer import render_document
from django.core.files.base import ContentFile

from . import guestimport, images, templateimport, video

MAX_ASSET_BYTES = 8 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}
ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav"}
ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm"}


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


def _render_invitation_page(request, invitation, *, editable=False, noindex=False, guest=None):
    """يبني صفحة الدعوة كاملة من المستند."""
    result = render_document(
        invitation.document,
        invitation=invitation,
        request=request,
        allowed_features=invitation.allowed_features,
        editable=editable,
        guest=guest,
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
    if "music" in invitation.allowed_features and doc_settings.get("music_url"):
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
        "guest": guest,
        "site_name": settings.SITE_NAME,
        "site_url": request.build_absolute_uri("/"),
    })


# ==========================================================================
# الموقع العام
# ==========================================================================
def home(request):
    templates = Template.objects.filter(is_active=True)[:12]
    plans = Plan.objects.filter(is_active=True)
    form = OrderForm(request.POST or None)
    if request.method == "POST":
        if form.is_valid():
            form.save()
            messages.success(request, "تم استلام طلبك. سنتواصل معك قريباً لتأكيد التفاصيل.")
            return redirect("home")
        messages.error(request, "يرجى مراجعة البيانات المدخلة.")
    return render(request, "public/home.html", {
        "templates": templates, "plans": plans, "form": form,
    })


@require_GET
def template_gallery(request):
    qs = Template.objects.filter(is_active=True)
    category = request.GET.get("category", "")
    if category:
        qs = qs.filter(category=category)
    return render(request, "public/gallery.html", {
        "templates": qs,
        "categories": Template.CATEGORY_CHOICES,
        "active_category": category,
    })


@require_GET
def template_demo(request, slug):
    """معاينة قالب كدعوة تجريبية — بدون إنشاء أي سجل."""
    template = get_object_or_404(Template, slug=slug, is_active=True)
    result = render_document(template.document, invitation=None, request=request,
                             allowed_features=None, editable=False)
    return render(request, "invitations/render.html", {
        "render": result,
        "invitation": None,
        "editable": False,
        "noindex": True,
        "page_title": f"معاينة قالب {template.name}",
        "page_description": template.description,
        "share_image": "",
        "canonical_url": "",
        "music_config": {},
        "site_name": settings.SITE_NAME,
        "site_url": request.build_absolute_uri("/"),
    })


# ==========================================================================
# الدعوة العامة
# ==========================================================================
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
    if "rsvp" not in invitation.allowed_features:
        return fail("تأكيد الحضور غير مفعّل لهذه الدعوة.", 403)

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

    # حدود المرافقين تؤخذ من بلوك RSVP نفسه لا من المدخلات
    doc = invitation.get_document()
    max_companions = 0
    for block in doc["blocks"]:
        if block["type"] == "rsvp":
            max_companions = int(block["props"].get("max_companions") or 0)
            break
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

    success = "شكراً لكم — تم تسجيل ردكم."
    for block in doc["blocks"]:
        if block["type"] == "rsvp":
            success = block["props"].get("success_message") or success
            break

    if is_ajax:
        return JsonResponse({"ok": True, "message": success})
    messages.success(request, success)
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
    qs = Invitation.objects.select_related("customer", "template", "plan").annotate(
        rsvp_total=Count("rsvps", distinct=True),
        guest_total=Count("guests", distinct=True),
    )
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
        except Exception:
            messages.error(request, "تعذّر قراءة الملف. جرّب أرشيف ZIP فيه index.html.")
        else:
            chars = templateimport.document_text_length(tpl.document)
            messages.success(
                request,
                f"اتستورد «{tpl.name}» بـ{len(tpl.document.get('blocks', []))} قسم. "
                "افتحه في المحرر وظبّطه.",
            )
            # ملف صغير بيعدّي، بس ما نسيبوش المستخدم يكتشف بنفسه إنه شبه فاضي
            if chars < templateimport.MIN_VISIBLE_CHARS:
                messages.error(
                    request,
                    f"بس خد بالك: النص الظاهر فيه {chars} حرف بس. لو المفروض "
                    "فيه كلام أكتر، غالباً الصفحة بتتبني بجافاسكربت — احفظها "
                    "من المتصفح بعد ما تحمّل (Ctrl+S ← «صفحة كاملة») وجرّب تاني.",
                )
            return redirect("dashboard_templates")

    return render(request, "dashboard/templates.html", {
        "nav": "templates",
        "templates": Template.objects.annotate(uses=Count("invitations")),
        "categories": Template.CATEGORY_CHOICES,
    })


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
def dashboard_orders(request):
    _staff_required(request)
    status = request.GET.get("status", "")
    qs = Order.objects.select_related("customer", "plan", "template")
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
    return render(request, "dashboard/guests.html", {
        "nav": "invitations",
        "invitation": invitation,
        "guests": invitation.guests.all(),
        "rsvps": invitation.rsvps.all(),
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

    return render(request, "editor/editor.html", {
        "invitation": invitation,
        "form": settings_form,
        "schema_json": blocks_engine.editor_schema(),
        "document_json": document,
        "assets_json": [
            {"id": a.pk, "url": a.url, "thumb": a.thumb_url,
             "name": a.original_name, "kind": a.kind}
            # الملفات العامة (invitation=None) مكتبة مشتركة بين كل الدعوات
            for a in Asset.objects.filter(
                Q(invitation=invitation) | Q(invitation__isnull=True)
            ).order_by("-id")[:300]
        ],
        "features_json": sorted(invitation.allowed_features),
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
            "urls": {
                "preview": f"/dashboard/invitations/{invitation.pk}/api/preview/",
                "save": f"/dashboard/invitations/{invitation.pk}/api/save/",
                "upload": f"/dashboard/invitations/{invitation.pk}/api/upload/",
                "saveTemplate": f"/dashboard/invitations/{invitation.pk}/api/save-template/",
                "assets": f"/dashboard/invitations/{invitation.pk}/api/assets/",
                "crop": f"/dashboard/invitations/{invitation.pk}/api/crop/",
                "frame": f"/dashboard/invitations/{invitation.pk}/preview-frame/",
                "back": "/dashboard/invitations/",
                "public": invitation.get_absolute_url(),
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
        "pattern": result["theme"].get("pattern") or "none",
        "maxWidth": result["theme"].get("max_width"),
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


@login_required
@require_POST
def api_upload(request, pk):
    """رفع صورة أو ملف صوتي لاستخدامه في الدعوة."""
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)

    upload = request.FILES.get("file")
    if not upload:
        return JsonResponse({"ok": False, "error": "لم يصل أي ملف."}, status=400)
    if upload.size > MAX_ASSET_BYTES:
        return JsonResponse(
            {"ok": False, "error": "حجم الملف أكبر من ٨ ميجابايت."}, status=400
        )

    guessed = mimetypes.guess_type(upload.name)[0] or ""
    content_type = (getattr(upload, "content_type", "") or guessed).lower()

    if content_type in ALLOWED_IMAGE_TYPES:
        kind = "image"
    elif content_type in ALLOWED_AUDIO_TYPES:
        kind = "audio"
    elif content_type in ALLOWED_VIDEO_TYPES:
        kind = "video"
    else:
        return JsonResponse(
            {"ok": False, "error": "نوع الملف غير مسموح. ارفع صورة أو ملف صوت."},
            status=400,
        )

    width = height = 0
    stored, thumb, source = upload, None, None

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
        # فيديو الافتتاحية بيتشاف على تليفون وبيشتغل صامت، فبنقصّه على ١٠ ثواني
        # ونشيل الصوت وننزّله ٧٢٠p. لو ffmpeg مش متثبّت بيرجع الأصل زي ما هو.
        try:
            stored, seconds = video.compress(upload)
        except Exception:
            upload.seek(0)
            stored, seconds = upload, 0.0

    asset = Asset.objects.create(
        file=stored, thumb=thumb, source=source,
        kind=kind, original_name=upload.name[:200],
        width=width, height=height, size_bytes=getattr(stored, "size", upload.size),
        invitation=invitation, uploaded_by=request.user,
    )
    return JsonResponse({
        "ok": True,
        "asset": {"id": asset.pk, "url": asset.url, "thumb": asset.thumb_url,
                  "name": asset.original_name, "kind": asset.kind,
                  "width": width, "height": height, "seconds": seconds},
    })


@login_required
@require_POST
def api_crop(request, pk):
    """يقص صورة من الأصل ويحفظ الناتج كأصل جديد.

    القص بيتم من النسخة الأصلية مش المعروضة، فمفيش فقد جودة متراكم لو
    قصيت أكتر من مرة. والأصل بيفضل محفوظ فتقدر ترجع تقص من جديد.
    """
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)

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
    if asset.invitation_id not in (None, invitation.pk):
        return JsonResponse({"ok": False, "error": "الصورة مش من مكتبة الدعوة دي."},
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
        invitation=invitation, uploaded_by=request.user,
    )
    return JsonResponse({"ok": True, "asset": {
        "id": new.pk, "url": new.url, "thumb": new.thumb_url,
        "name": new.original_name, "kind": "image",
        "width": width, "height": height,
    }})


@login_required
@require_GET
def api_assets(request, pk):
    _staff_required(request)
    invitation = get_object_or_404(Invitation, pk=pk)
    return JsonResponse({
        "ok": True,
        "assets": [
            {"id": a.pk, "url": a.url, "thumb": a.thumb_url,
             "name": a.original_name, "kind": a.kind}
            # الملفات العامة (invitation=None) مكتبة مشتركة بين كل الدعوات
            for a in Asset.objects.filter(
                Q(invitation=invitation) | Q(invitation__isnull=True)
            ).order_by("-id")[:300]
        ],
    })


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
        "arrived": invitation.guests.filter(checked_in=True).count(),
        "total": invitation.guests.count(),
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

    guest = invitation.guests.filter(token=token).first()
    if guest is None:
        return JsonResponse(
            {"ok": False, "error": "الرمز ده مش من ضيوف الدعوة دي."}, status=404)

    already = guest.checked_in
    when = timezone.localtime(guest.checked_in_at) if guest.checked_in_at else None
    if not already:
        guest.checked_in = True
        guest.checked_in_at = timezone.now()
        guest.save(update_fields=["checked_in", "checked_in_at", "updated_at"])
        when = timezone.localtime(guest.checked_in_at)

    rsvp = guest.latest_rsvp
    return JsonResponse({
        "ok": True,
        "already": already,
        "name": guest.name,
        "group": guest.group_name,
        "companions": guest.plus_ones_allowed,
        "rsvp": rsvp.get_status_display() if rsvp else "",
        "at": when.strftime("%H:%M") if when else "",
        "arrived": invitation.guests.filter(checked_in=True).count(),
        "total": invitation.guests.count(),
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
