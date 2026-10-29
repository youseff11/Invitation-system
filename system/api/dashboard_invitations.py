"""الدعوات في لوحة التحكم: القائمة، النسخ، الحذف، والإنشاء.

السلوك مطابق لـ‎dashboard_invitations‎ و‎invitation_create‎ في ‎views.py‎ القديم —
وبنعيد استخدام ‎_duplicate_invitation‎ و‎_delete_invitation‎ بدل نسخهم (فيهم منطق
الأصول والملفات المشتركة).
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import F, Q
from django.http import Http404
from django.urls import path

from ..models import Customer, Invitation, Plan, Template
from ..services import _delete_invitation, _duplicate_invitation
from .dashboard_common import (
    editor_url,
    TEMPLATE_HEAVY_FIELDS,
    fmt_dt,
    iso,
    money,
    staff_api,
    with_guest_rsvp_counts,
)
from .http import ApiError, json_body

EVENT_TYPES = ["زفاف", "خطوبة", "كتب كتاب", "حنة", "عيد ميلاد", "تخرّج", "عقيقة"]


def _invitation_row(inv) -> dict:
    return {
        "id": inv.pk,
        "title": inv.title,
        "slug": inv.slug,
        "customerId": inv.customer_id,
        "customerName": inv.customer.name,
        "templateName": inv.template.name,
        "status": inv.status,
        "guests": inv.guest_total,
        "rsvps": inv.rsvp_total,
        "views": inv.public_views,
        "createdAt": iso(inv.created_at),
        "createdLabel": fmt_dt(inv.created_at, "j M Y"),
        "createdTitle": fmt_dt(inv.created_at, "j F Y — g:i A"),
        "url": inv.get_absolute_url(),
        "clientUrl": inv.get_client_followup_url(),
        "venueUrl": inv.get_venue_url(),
        "editorUrl": editor_url("invitations", inv.pk),
    }


@staff_api("GET", "POST")
def invitations(request):
    if request.method == "POST":
        return _create_invitation(request)

    q = (request.GET.get("q") or "").strip()
    status = request.GET.get("status", "")
    template_id = (request.GET.get("template") or "").strip()
    # الصفحة بتعرض أسماء وأرقام بس — من غير مستند الدعوة ولا مستند قالبها (كان ٢٥ ثانية)
    qs = with_guest_rsvp_counts(
        Invitation.objects.select_related("customer", "template", "plan").defer(
            "document",
            *(f"template__{field}" for field in TEMPLATE_HEAVY_FIELDS),
        )
    ).order_by("-created_at", "-id")
    if q:
        qs = qs.filter(
            Q(title__icontains=q) | Q(customer__name__icontains=q)
            | Q(slug__icontains=q) | Q(name_one__icontains=q) | Q(name_two__icontains=q)
        )
    if status:
        qs = qs.filter(status=status)
    if template_id.isdigit():
        qs = qs.filter(template_id=int(template_id))
    else:
        template_id = ""
    # القوالب اللي عليها دعوات بس، وأسماء بس
    template_choices = (
        Template.objects.filter(invitations__isnull=False)
        .values_list("pk", "name").distinct().order_by("name")
    )
    return {
        "filters": {"q": q, "status": status, "template": template_id},
        "statusChoices": [{"value": value, "label": label}
                          for value, label in Invitation.STATUS_CHOICES],
        "templateChoices": [{"id": pk, "name": name} for pk, name in template_choices],
        "results": [_invitation_row(inv) for inv in qs],
    }


@staff_api("DELETE")
def invitation_detail(request, pk):
    inv = _get_or_404(pk)
    title = inv.title
    _delete_invitation(inv)
    return {"deleted": True, "title": title}


@staff_api("POST")
def invitation_duplicate(request, pk):
    src = _get_or_404(
        pk, Invitation.objects.select_related("customer", "template", "plan"))
    dup = _duplicate_invitation(src)
    return {"id": dup.pk, "title": dup.title, "sourceTitle": src.title}


@staff_api("POST")
def invitation_customer(request, pk):
    """تغيير عميل دعوة: عميل موجود (‎customerId‎) أو اسم تاني (‎customerName‎).

    الاسم بيعدّل سجل العميل الحالي لو الدعوة دي هي الوحيدة اللي بتستخدمه
    (من غير طلبات)، وإلا بيتعمل عميل جديد — من غير ما اسم دعوة تانية يتغير.
    """
    inv = _get_or_404(pk, Invitation.objects.select_related("customer"))
    data = json_body(request)

    def text(key: str) -> str:
        return str(data.get(key) or "").strip()

    customer_id = text("customerId")
    if customer_id:
        customer = Customer.objects.filter(pk=customer_id).first() if customer_id.isdigit() else None
        if customer is None:
            raise ApiError(400, "validation_error", "العميل غير موجود.",
                           fields={"customerId": "العميل غير موجود."})
    else:
        name = text("customerName")
        if not name:
            message = "اكتب اسم العميل أو اختر عميلاً موجوداً."
            raise ApiError(400, "validation_error", message, fields={"customerName": message})
        current = inv.customer
        exclusive = (not Invitation.objects.filter(customer=current).exclude(pk=inv.pk).exists()
                     and not current.orders.exists())
        if exclusive:
            customer = current
            customer.name = name[:120]
            if text("customerPhone"):
                customer.phone = text("customerPhone")[:40]
            if text("customerEmail"):
                customer.email = text("customerEmail")[:200]
            customer.save()
        else:
            customer = Customer.objects.create(
                name=name[:120],
                phone=text("customerPhone")[:40],
                email=text("customerEmail")[:200],
            )
    if inv.customer_id != customer.pk:
        inv.customer = customer
        inv.save(update_fields=["customer", "updated_at"])
    return {"id": inv.pk, "customerId": customer.pk, "customerName": customer.name}


def _get_or_404(pk, queryset=None):
    try:
        return (queryset or Invitation.objects.all()).get(pk=pk)
    except Invitation.DoesNotExist:
        raise Http404("الدعوة غير موجودة.")


# ---------------------------------------------------------------- الإنشاء
@staff_api("GET")
def invitation_options(request):
    """خيارات نموذج «دعوة جديدة»: كل القوالب (حتى المخفية) والباقات والعملاء."""
    # كل القوالب — حتى المخفية: «الإخفاء» بيشيل القالب من المعرض العام بس. الظاهرة الأول.
    templates = (Template.objects.order_by("-is_active", "sort_order", "-created_at")
                 .defer(*TEMPLATE_HEAVY_FIELDS))
    return {
        "templates": [
            {"id": t.pk, "name": t.name, "cover": t.cover_src or None, "isActive": t.is_active}
            for t in templates
        ],
        "plans": [
            {"id": p.pk, "name": p.name, "price": money(p.price)}
            for p in Plan.objects.filter(is_active=True)
        ],
        "customers": [
            {"id": c.pk, "name": c.name, "phone": c.phone}
            for c in Customer.objects.all()[:200]
        ],
        "eventTypes": EVENT_TYPES,
    }


def _create_invitation(request) -> dict:
    data = json_body(request)

    def text(key: str) -> str:
        return str(data.get(key) or "").strip()

    template_id = str(data.get("templateId") or "").strip()
    template = Template.objects.filter(pk=template_id).first() if template_id.isdigit() else None
    if template is None:
        raise ApiError(400, "validation_error", "اختر قالباً.",
                       fields={"templateId": "اختر قالباً."})

    # الباقة اختيارية — «بدون باقة» = كل المزايا مفتوحة
    plan = None
    plan_id = str(data.get("planId") or "").strip()
    if plan_id:
        plan = Plan.objects.filter(pk=plan_id).first() if plan_id.isdigit() else None
        if plan is None:
            raise ApiError(400, "validation_error", "الباقة غير موجودة.",
                           fields={"planId": "الباقة غير موجودة."})

    customer_id = str(data.get("customerId") or "").strip()
    customer = Customer.objects.filter(pk=customer_id).first() if customer_id.isdigit() else None
    if not customer:
        name = text("customerName")
        if not name:
            message = "اكتب اسم العميل أو اختر عميلاً موجوداً."
            raise ApiError(400, "validation_error", message,
                           fields={"customerName": message})
        customer = Customer.objects.create(
            name=name[:120],
            phone=text("customerPhone")[:40],
            email=text("customerEmail")[:200],
        )

    with transaction.atomic():
        invitation = Invitation.objects.create(
            customer=customer, template=template, plan=plan,
            name_one=text("nameOne")[:120],
            name_two=text("nameTwo")[:120],
            event_type=(text("eventType") or "زفاف")[:40],
            document=template.get_document(),   # نسخة مستقلة من القالب
            status="draft",
        )
        Template.objects.filter(pk=template.pk).update(usage_count=F("usage_count") + 1)
    return {
        "id": invitation.pk,
        "editorUrl": editor_url("invitations", invitation.pk),
    }


urlpatterns = [
    path("dashboard/invitations/", invitations, name="api_dashboard_invitations"),
    path("dashboard/invitations/options/", invitation_options,
         name="api_dashboard_invitation_options"),
    path("dashboard/invitations/<int:pk>/", invitation_detail,
         name="api_dashboard_invitation"),
    path("dashboard/invitations/<int:pk>/duplicate/", invitation_duplicate,
         name="api_dashboard_invitation_duplicate"),
    path("dashboard/invitations/<int:pk>/customer/", invitation_customer,
         name="api_dashboard_invitation_customer"),
]
