"""مسارات الموقع العام: الرئيسية، معرض القوالب، نموذج الطلب.

صاحب الملف: B1. كل مسارات الميزة (views + serializers + urlpatterns) هنا
أو في ملفات جنبه بنفس البادئة — مابتلمسش ‎views.py‎ و‎serializers.py‎ (الأساس
المشترك) ولا ملفات الميزات التانية. شكل الرد والأخطاء في ‎http.py‎.

المحتوى (القوالب والباقات والأسئلة) بيرجع باللغتين مع بعض (‎name‎ و‎nameEn‎) —
نفس فكرة وسوم ‎bilingual‎ في الموقع القديم: الواجهة بتختار حسب لغتها فالتبديل
بيبقى فوري من غير طلب جديد.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.core.cache import cache
from django.urls import path
from django.utils.datastructures import MultiValueDict

from ..forms import OrderForm
from ..models import FAQ, Plan, PlanAddon, SiteSetting, Template
from .http import ApiError, api_view, client_hash, json_body, json_response
from .serializers import site_payload, template_card

# نفس الحقول التقيلة اللي صفحات العرض القديمة بتتفاداها (views._TEMPLATE_HEAVY_FIELDS)
_TEMPLATE_HEAVY_FIELDS = ("document", "preview_render", "runtime_scripts")
HOME_TEMPLATES = 12              # الرئيسية بتعرض أول ١٢ قالب بس

ORDER_RATE_LIMIT = 20            # طلبات ناجحة لكل عميل
ORDER_RATE_WINDOW = 60 * 60      # خلال الفترة دي (ثواني)

_CATEGORY_LABELS = dict(Template.CATEGORY_CHOICES)

# اسم الحقل في الـAPI → اسمه في OrderForm
_ORDER_FIELDS = {
    "customerName": "customer_name",
    "customerPhone": "customer_phone",
    "customerEmail": "customer_email",
    "template": "template",
    "plan": "plan",
    "eventType": "event_type",
    "eventDate": "event_date",
    "names": "names",
    "message": "message",
}
_FORM_TO_API = {form: api for api, form in _ORDER_FIELDS.items()}

ORDER_RECEIVED_MESSAGE = "تم استلام طلبك. سنتواصل معك قريباً لتأكيد التفاصيل."
ORDER_INVALID_MESSAGE = "يرجى مراجعة البيانات المدخلة."
ORDERS_CLOSED_MESSAGE = "استقبال الطلبات من الموقع مقفول حالياً."


# ---------------------------------------------------------------- المحوّلات
def _whole(price) -> int:
    """السعر بدون كسور — زي ‎floatformat:0‎ في القالب القديم (تقريب لأعلى عند النص)."""
    return int(Decimal(price or 0).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _gallery_card(template: Template) -> dict:
    card = template_card(template)
    # نفس ‎get_category_display‎ في القالب القديم: الاسم العربي للتصنيف بس
    card["categoryLabel"] = _CATEGORY_LABELS.get(template.category, template.category)
    return card


def _addon_payload(addon: PlanAddon) -> dict:
    return {
        "id": addon.pk,
        "name": addon.name,
        "nameEn": addon.name_en,
        "price": _whole(addon.price),
    }


def _plan_payload(plan: Plan, addons: list[PlanAddon]) -> dict:
    # الإضافة من غير باقات محددة معناها «متاحة مع الكل» — نفس القاعدة في
    # نموذج الطلب (‎PlanAddon.available_for‎) وفي ‎views.home‎ القديم.
    shown = [a for a in addons
             if not a.plans.all() or plan in a.plans.all()]
    return {
        "id": plan.pk,
        "slug": plan.slug,
        "name": plan.name,
        "nameEn": plan.name_en,
        "tagline": plan.tagline,
        "taglineEn": plan.tagline_en,
        "price": _whole(plan.price),
        "bullets": list(plan.bullets or []),
        "bulletsEn": list(plan.bullets_en or []),
        "isFeatured": plan.is_featured,
        "addons": [_addon_payload(a) for a in shown],
    }


def _faq_payload(faq: FAQ) -> dict:
    return {
        "id": faq.pk,
        "question": faq.question_ar,
        "questionEn": faq.question_en,
        "answer": faq.answer_ar,
        "answerEn": faq.answer_en,
    }


# ---------------------------------------------------------------- القراءة
@api_view("GET")
def home(request):
    """كل اللي الرئيسية محتاجاه في طلب واحد: القوالب والباقات والأسئلة والإعدادات."""
    templates = (Template.objects.filter(is_active=True)
                 .defer(*_TEMPLATE_HEAVY_FIELDS)[:HOME_TEMPLATES])
    plans = list(Plan.objects.filter(is_active=True))
    addons = list(PlanAddon.objects.filter(is_active=True).prefetch_related("plans"))
    return {
        "site": site_payload(request),
        "templates": [_gallery_card(t) for t in templates],
        "plans": [_plan_payload(p, addons) for p in plans],
        "faqs": [_faq_payload(f) for f in FAQ.objects.filter(is_active=True)],
    }


@api_view("GET")
def template_gallery(request):
    """معرض القوالب بالتصنيفات — ‎?category=‎ اختياري، وتصنيف مش موجود = قائمة فاضية."""
    qs = Template.objects.filter(is_active=True).defer(*_TEMPLATE_HEAVY_FIELDS)
    category = request.GET.get("category", "")
    if category:
        qs = qs.filter(category=category)
    return {
        "results": [_gallery_card(t) for t in qs],
        # «بدون» مش تصنيف يتفلتر بيه في المعرض العام
        "categories": [{"value": value, "label": label}
                       for value, label in Template.CATEGORY_CHOICES
                       if value != "none"],
        "category": category,
    }


def _require_orders_enabled() -> None:
    # الإخفاء من الصفحة مش قفل — المسار لسه موجود وأي حد يقدر يبعتله،
    # فالرفض لازم يكون هنا مش في الواجهة بس (نفس منطق ‎views.home‎ القديم).
    if not SiteSetting.load().orders_enabled:
        raise ApiError(403, "orders_disabled", ORDERS_CLOSED_MESSAGE)


@api_view("GET")
def order_form(request):
    """خيارات نموذج «اطلب دعوتك»: القوالب والباقات والإضافات المتاحة."""
    _require_orders_enabled()
    form = OrderForm()
    return {
        "templates": [{"id": t.pk, "name": t.name, "nameEn": t.name_en}
                      for t in form.fields["template"].queryset
                      .defer(*_TEMPLATE_HEAVY_FIELDS)],
        "plans": [{"id": p.pk, "name": p.name, "nameEn": p.name_en,
                   "price": _whole(p.price)}
                  for p in form.fields["plan"].queryset],
        "addons": [{**_addon_payload(a),
                    "description": a.description,
                    "planIds": [p.pk for p in a.plans.all()]}
                   for a in form.fields["addons"].queryset],
        "defaultEventType": form.fields["event_type"].initial or "زفاف",
    }


# ---------------------------------------------------------------- الكتابة
def _order_post_data(data: dict) -> MultiValueDict:
    """جسم JSON → نفس شكل POST اللي ‎OrderForm‎ متعوّد عليه."""
    post = MultiValueDict()
    for api_key, form_key in _ORDER_FIELDS.items():
        value = data.get(api_key)
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (str, int)):
            raise ApiError(400, "invalid_order", ORDER_INVALID_MESSAGE,
                           fields={api_key: "قيمة غير صالحة."})
        post[form_key] = str(value)

    addons = data.get("addons")
    if addons is not None:
        if not isinstance(addons, list) or not all(
                isinstance(a, (str, int)) and not isinstance(a, bool) for a in addons):
            raise ApiError(400, "invalid_order", ORDER_INVALID_MESSAGE,
                           fields={"addons": "قيمة غير صالحة."})
        post.setlist("addons", [str(a) for a in addons])
    return post


@api_view("POST")
def orders_create(request):
    """استقبال طلب من النموذج العام — نفس تحقق ورسائل ‎OrderForm‎ في الموقع القديم."""
    _require_orders_enabled()
    data = json_body(request)

    key = f"api-orders:{client_hash(request)}"
    if cache.get(key, 0) >= ORDER_RATE_LIMIT:
        raise ApiError(429, "too_many_orders",
                       "محاولات كتير. استنى شوية وحاول تاني.")

    form = OrderForm(_order_post_data(data))
    if not form.is_valid():
        fields = {_FORM_TO_API.get(name, name): errors[0]
                  for name, errors in form.errors.items() if errors}
        raise ApiError(400, "invalid_order", ORDER_INVALID_MESSAGE, fields=fields)

    form.save()
    cache.add(key, 0, ORDER_RATE_WINDOW)
    try:
        cache.incr(key)
    except ValueError:
        cache.set(key, 1, ORDER_RATE_WINDOW)
    return json_response({"received": True, "message": ORDER_RECEIVED_MESSAGE}, status=201)


urlpatterns = [
    path("public/home/", home, name="api_public_home"),
    path("public/templates/", template_gallery, name="api_public_templates"),
    path("public/order-form/", order_form, name="api_public_order_form"),
    path("orders/", orders_create, name="api_orders"),
]
