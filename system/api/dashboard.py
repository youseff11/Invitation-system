"""مسارات لوحة التحكم (الدعوات، القوالب، الطلبات، الباقات، الخطوط، الموسيقى، الافتتاحيات، الإعدادات، الإحصائيات).

صاحب الملف: B4. كل مسارات الميزة (views + serializers + urlpatterns) هنا
أو في ملفات جنبه بنفس البادئة — مابتلمسش ‎views.py‎ و‎serializers.py‎ (الأساس
المشترك) ولا ملفات الميزات التانية. شكل الرد والأخطاء في ‎http.py‎.
كلها بتبدأ بـ ‎require_staff(request)‎ عن طريق ‎staff_api‎.

الملف ده: النظرة العامة والإحصائيات والطلبات + تجميع مسارات باقي الملفات:
‎dashboard_invitations.py‎ · ‎dashboard_templates.py‎ · ‎dashboard_library.py‎ (الخطوط/الموسيقى/الافتتاحيات)
· ‎dashboard_plans.py‎ (الباقات والإضافات وإعدادات الموقع).
"""

from __future__ import annotations

from django.db.models import Sum
from django.urls import path, reverse

from ..models import Customer, Guest, Invitation, Order, RSVPResponse, Template
from . import (
    dashboard_invitations,
    dashboard_library,
    dashboard_music_dedupe,
    dashboard_plans,
    dashboard_templates,
)
from .dashboard_common import (
    editor_url,
    TEMPLATE_HEAVY_FIELDS,
    fmt_dt,
    money,
    staff_api,
    with_guest_rsvp_counts,
)


# ---------------------------------------------------------------- النظرة العامة
@staff_api("GET")
def overview(request):
    invitations = Invitation.objects.all()
    stats = {
        "invitations": invitations.count(),
        "published": invitations.filter(status="published").count(),
        "ordersNew": Order.objects.filter(status="new").count(),
        "customers": Customer.objects.count(),
        "templates": Template.objects.count(),
        "guests": Guest.objects.count(),
        "attending": RSVPResponse.objects.filter(status="attending").count(),
        "views": invitations.aggregate(v=Sum("public_views"))["v"] or 0,
    }
    # الجداول بتعرض أسماء بس: من غير مستندات الدعوات والقوالب (نفس تحسين الـview القديم)
    recent_invitations = (
        Invitation.objects.select_related("customer", "template")
        .defer("document", *(f"template__{field}" for field in TEMPLATE_HEAVY_FIELDS))[:6]
    )
    recent_rsvps = RSVPResponse.objects.select_related("invitation").defer(
        "invitation__document")[:8]
    return {
        "stats": stats,
        "recentInvitations": [
            {
                "id": inv.pk,
                "title": inv.title,
                "customerName": inv.customer.name,
                "templateName": inv.template.name,
                "status": inv.status,
                "editorUrl": editor_url("invitations", inv.pk),
            }
            for inv in recent_invitations
        ],
        "recentRsvps": [
            {
                "id": rsvp.pk,
                "name": rsvp.name,
                "invitationTitle": rsvp.invitation.title,
                "status": rsvp.status,
                "companions": rsvp.companions,
                "createdLabel": fmt_dt(rsvp.created_at, "Y/m/d H:i"),
            }
            for rsvp in recent_rsvps
        ],
    }


# ---------------------------------------------------------------- الإحصائيات
@staff_api("GET")
def analytics(request):
    top = list(
        with_guest_rsvp_counts(Invitation.objects.defer("document")).order_by("-public_views")[:12]
    )
    return {
        "totals": {
            "views": Invitation.objects.aggregate(v=Sum("public_views"))["v"] or 0,
            "attending": RSVPResponse.objects.filter(status="attending").count(),
            "declined": RSVPResponse.objects.filter(status="declined").count(),
        },
        "invitations": [
            {
                "id": inv.pk,
                "title": inv.title,
                "status": inv.status,
                "views": inv.public_views,
                "rsvps": inv.rsvp_total,
                "guests": inv.guest_total,
            }
            for inv in top
        ],
        # الرسم البياني بيستخدم أول ٢٤ حرف من العنوان زي القديم
        "chart": [
            {"label": inv.title[:24], "views": inv.public_views, "rsvps": inv.rsvp_total}
            for inv in top
        ],
    }


# ---------------------------------------------------------------- الطلبات
@staff_api("GET")
def orders(request):
    status = request.GET.get("status", "")
    qs = (Order.objects.select_related("customer", "plan", "template")
          .prefetch_related("order_addons__addon"))
    if status:
        qs = qs.filter(status=status)
    return {
        "status": status,
        "statusChoices": [{"value": value, "label": label}
                          for value, label in Order.STATUS_CHOICES],
        "results": [
            {
                "id": order.pk,
                "customerName": order.customer.name,
                "customerPhone": order.customer.phone,
                "planName": order.plan.name,
                "addons": [
                    {"name": oa.name or oa.addon.name, "price": money(oa.price)}
                    for oa in order.order_addons.all()
                ],
                # الإجمالي بأسعار وقت الشراء — لو الإضافة غليت بعد كده الطلب بيفضل بسعره الأصلي
                "total": money(order.total_price),
                "templateName": order.template.name if order.template else "",
                "eventType": order.event_type,
                "eventDate": fmt_dt(order.event_date, "Y/m/d") if order.event_date else "",
                "status": order.status,
                "adminUrl": reverse("admin:system_order_change", args=[order.pk]),
            }
            for order in qs
        ],
    }


urlpatterns = [
    path("dashboard/overview/", overview, name="api_dashboard_overview"),
    path("dashboard/analytics/", analytics, name="api_dashboard_analytics"),
    path("dashboard/orders/", orders, name="api_dashboard_orders"),
]
urlpatterns += dashboard_invitations.urlpatterns
urlpatterns += dashboard_templates.urlpatterns
urlpatterns += dashboard_library.urlpatterns
urlpatterns += dashboard_music_dedupe.urlpatterns
urlpatterns += dashboard_plans.urlpatterns
