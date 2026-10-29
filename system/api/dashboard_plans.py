"""الباقات والإضافات وإعدادات الموقع.

مطابقة لـ‎dashboard_plans‎ و‎dashboard_site‎ في ‎views.py‎ القديم: نفس ‎PlanAddonForm‎
و‎SiteSettingForm‎ ونفس رسائل التحقق في تعديل الباقة السريع. الجسم JSON بمفاتيح
‎camelCase‎ والأخطاء بشكل ‎fields‎.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.http import Http404
from django.urls import path, reverse

from .. import blocks as blocks_engine
from ..forms import PlanAddonForm, SiteSettingForm
from ..models import Plan, PlanAddon, SiteSetting, Template
from .dashboard_common import (
    money,
    number_input_value,
    raise_invalid,
    snake_keys,
    staff_api,
    to_camel,
)
from .http import ApiError, json_body

# أعلى سعر بيدخل في ‎max_digits=10, decimal_places=2‎
MAX_PRICE = Decimal("99999999.99")


# ---------------------------------------------------------------- الباقات
def _plan_row(plan) -> dict:
    return {
        "id": plan.pk,
        "name": plan.name,
        "price": number_input_value(plan.price),
        "oldPrice": number_input_value(plan.old_price) if plan.old_price else "",
        "features": list(plan.features or []),
        "isFeatured": plan.is_featured,
        "isActive": plan.is_active,
        "adminUrl": reverse("admin:system_plan_change", args=[plan.pk]),
    }


def _addon_row(addon) -> dict:
    plans = list(addon.plans.all())
    return {
        "id": addon.pk,
        "name": addon.name,
        "nameEn": addon.name_en,
        "code": addon.code,
        "price": money(addon.price),
        "priceValue": str(addon.price),
        "description": addon.description,
        "plans": [{"id": p.pk, "name": p.name} for p in plans],
        "planIds": [p.pk for p in plans],
        "isActive": addon.is_active,
        "sortOrder": addon.sort_order,
    }


@staff_api("GET")
def plans(request):
    return {
        "addons": [_addon_row(addon)
                   for addon in PlanAddon.objects.prefetch_related("plans")],
        "plans": [_plan_row(plan) for plan in Plan.objects.all()],
        # الباقات اللي بتظهر كاختيارات في نموذج الإضافة (المفعّلة بس — زي ‎PlanAddonForm‎)
        "planChoices": [{"id": p.pk, "name": p.name}
                        for p in Plan.objects.filter(is_active=True)],
        "featureKeys": sorted(blocks_engine.feature_keys()),
    }


@staff_api("PATCH")
def plan_detail(request, pk):
    """تعديل سريع للاسم والسعر من الجدول — الباقي في إدارة البيانات."""
    try:
        plan = Plan.objects.get(pk=pk)
    except Plan.DoesNotExist:
        raise Http404("الباقة غير موجودة.")
    data = json_body(request)
    name = str(data.get("name") or "").strip() or plan.name
    plan.name = name[:80]
    try:
        raw_price = data.get("price")
        plan.price = plan.price if raw_price in (None, "") else Decimal(str(raw_price).strip())
        raw_old = str(data.get("oldPrice") if data.get("oldPrice") is not None else "").strip()
        plan.old_price = Decimal(raw_old) if raw_old else None
    except (InvalidOperation, TypeError, ValueError):
        raise ApiError(400, "invalid_price", "السعر لازم يكون رقم.")
    prices = [plan.price] + ([plan.old_price] if plan.old_price is not None else [])
    if any(not p.is_finite() for p in prices):
        raise ApiError(400, "invalid_price", "السعر لازم يكون رقم.")
    if any(p < 0 for p in prices):
        raise ApiError(400, "invalid_price", "السعر ماينفعش يكون بالسالب.")
    if any(p > MAX_PRICE for p in prices):
        raise ApiError(400, "invalid_price", "السعر أكبر من الحد المسموح.")
    plan.is_active = bool(data.get("isActive"))
    plan.save(update_fields=["name", "price", "old_price", "is_active", "updated_at"])
    return _plan_row(plan)


# ---------------------------------------------------------------- الإضافات
def _get_addon(pk) -> PlanAddon:
    try:
        return PlanAddon.objects.prefetch_related("plans").get(pk=pk)
    except PlanAddon.DoesNotExist:
        raise Http404("الإضافة غير موجودة.")


def _save_addon(request, instance=None) -> dict:
    form = PlanAddonForm(snake_keys(json_body(request)), instance=instance)
    if not form.is_valid():
        raise_invalid(form)
    return _addon_row(_get_addon(form.save().pk))


@staff_api("POST")
def addons(request):
    return _save_addon(request)


@staff_api("PATCH", "DELETE")
def addon_detail(request, pk):
    addon = _get_addon(pk)
    if request.method == "PATCH":
        return _save_addon(request, addon)
    # الإضافة اللي اتباعت في طلب مابتتشالش — الطلب بيشاور عليها، ومسحها بيمسح تاريخ
    # الطلب معاها
    if addon.order_addons.exists():
        addon.is_active = False
        addon.save(update_fields=["is_active", "updated_at"])
        return {"deleted": False, "deactivated": True, "name": addon.name}
    name = addon.name
    addon.delete()
    return {"deleted": True, "deactivated": False, "name": name}


@staff_api("POST")
def addon_toggle(request, pk):
    addon = _get_addon(pk)
    addon.is_active = not addon.is_active
    addon.save(update_fields=["is_active", "updated_at"])
    return _addon_row(addon)


# ---------------------------------------------------------------- إعدادات الموقع
def _site_payload(cfg) -> dict:
    values = {to_camel(name): getattr(cfg, name) for name in SiteSettingForm.Meta.fields}
    sample = Template.objects.filter(is_active=True).defer(
        "document", "preview_render", "runtime_scripts").first()
    return {
        "values": values,
        "state": {
            "previewCtaEnabled": cfg.preview_cta_enabled,
            "previewCtaReady": cfg.preview_cta_ready,
            "whatsappNumber": cfg.whatsapp_number if (
                cfg.whatsapp_enabled and cfg.whatsapp_digits) else "",
            "facebookLinked": bool(cfg.facebook_enabled and cfg.facebook_url),
            "instagramLinked": bool(cfg.instagram_enabled and cfg.instagram_url),
            "ordersEnabled": cfg.orders_enabled,
            "whatsappFloatEnabled": cfg.whatsapp_float_enabled,
            "whatsappFloatReady": cfg.whatsapp_float_ready,
        },
        "sample": ({"name": sample.name, "previewUrl": reverse("template_demo", args=[sample.slug])}
                   if sample else None),
    }


@staff_api("GET", "PUT")
def site(request):
    cfg = SiteSetting.load()
    if request.method == "PUT":
        form = SiteSettingForm(snake_keys(json_body(request)), instance=cfg)
        if not form.is_valid():
            raise_invalid(form)
        cfg = form.save()
    return _site_payload(cfg)


urlpatterns = [
    path("dashboard/plans/", plans, name="api_dashboard_plans"),
    path("dashboard/plans/<int:pk>/", plan_detail, name="api_dashboard_plan"),
    path("dashboard/addons/", addons, name="api_dashboard_addons"),
    path("dashboard/addons/<int:pk>/", addon_detail, name="api_dashboard_addon"),
    path("dashboard/addons/<int:pk>/toggle/", addon_toggle, name="api_dashboard_addon_toggle"),
    path("dashboard/site/", site, name="api_dashboard_site"),
]
