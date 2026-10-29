"""أدوات مشتركة بين ملفات واجهة لوحة التحكم (‎dashboard_*.py‎).

صاحب الملف: B4. الأساس المشترك (‎http.py‎ …) مابيتعدّلش — هنا بس اللي بتحتاجه اللوحة:
حارس فريق العمل، تحويل أخطاء النماذج لشكل ‎fields‎، تنسيق التواريخ والأرقام بنفس
فلاتر القوالب القديمة (فالنتيجة مطابقة للصفحات القديمة حرفياً، حتى الأرقام واللغة).
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from functools import wraps

from django.conf import settings
from django.db.models import Count, IntegerField, OuterRef, Subquery, Value
from django.db.models.functions import Coalesce
from django.template.defaultfilters import floatformat
from django.utils import dateformat, timezone
from django.views.decorators.cache import never_cache

from ..models import Guest, RSVPResponse
from .http import ApiError, api_view, require_staff

# نفس الحقول التقيلة اللي الصفحات القديمة بتتفاداها — صفحات اللوحة بتعرض أسماء بس
TEMPLATE_HEAVY_FIELDS = ("document", "preview_render", "runtime_scripts")

# حدود الرفع: ‎MAX_ASSET_BYTES‎ في الـviews القديمة (٨ ميجا للصور والخطوط والصوت)
MAX_UPLOAD_BYTES = 8 * 1024 * 1024

GENERIC_INVALID = "راجع البيانات — فيه حقل ناقص أو غلط."


def staff_api(*methods: str):
    """‎@api_view‎ + ‎require_staff‎ + عدم التخزين في الكاش.

    كل مسارات اللوحة بتعدّي من هنا، فمفيش مسار ممكن ينسى الحماية. الرد مش بيتخزّن
    عشان فيه بيانات عملاء.
    """

    def decorator(view):
        @wraps(view)
        def guarded(request, *args, **kwargs):
            require_staff(request)
            return view(request, *args, **kwargs)

        return never_cache(api_view(*methods)(guarded))

    return decorator


# ---------------------------------------------------------------- الأسماء
_SNAKE_RE = re.compile(r"(?<!^)(?=[A-Z])")


def _count_per_invitation(model):
    rows = (model.objects.filter(invitation=OuterRef("pk")).order_by()
            .values("invitation").annotate(n=Count("pk")).values("n")[:1])
    return Coalesce(Subquery(rows, output_field=IntegerField()), Value(0))


def with_guest_rsvp_counts(queryset):
    """‎guest_total‎ و‎rsvp_total‎ لكل دعوة بعدّ منفصل.

    ‎Count("guests", distinct=True)‎ + ‎Count("rsvps", distinct=True)‎ في استعلام واحد كانت بتعمل
    join مزدوج (ضيوف × ردود لكل دعوة): ٤٫٦ ثانية على ٢٢٦ دعوة و٥٤٦٨ ضيف، والنتيجة نفسها.
    """
    return queryset.annotate(
        guest_total=_count_per_invitation(Guest),
        rsvp_total=_count_per_invitation(RSVPResponse),
    )


def editor_url(kind: str, pk: int) -> str:
    """رابط المحرر البصري (React): ``kind`` = ``invitations`` أو ``templates``.

    المحرر القديم (``/dashboard/…/editor/``) لسه موجود على الموقع القديم لحد التحويل النهائي،
    لكن لوحة التحكم الجديدة بتفتح الجديد.
    """
    return f"{settings.SPA_BASENAME}/dashboard/{kind}/{pk}/editor"


def to_snake(name: str) -> str:
    return _SNAKE_RE.sub("_", name).lower()


def to_camel(name: str) -> str:
    head, *rest = name.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in rest)


def snake_keys(data) -> dict:
    """مفاتيح ‎camelCase‎ القادمة من الواجهة → أسماء حقول النماذج."""
    return {to_snake(key): value for key, value in data.items()}


# ---------------------------------------------------------------- النماذج
def raise_invalid(form, message: str = "") -> None:
    """يحوّل أخطاء ‎ModelForm‎ لرد 400 بشكل ‎fields‎.

    أخطاء الحقول بتتحط تحت اسم الحقل (‎camelCase‎)، وأخطاء النموذج نفسه (مثل «ارفع ملفاً
    أو ضع رابطاً») تحت ‎__all__‎ وفي ‎message‎.
    """
    fields: dict[str, str] = {}
    for name, items in form.errors.get_json_data().items():
        key = "__all__" if name == "__all__" else to_camel(name)
        fields[key] = " ".join(item["message"] for item in items)
    raise ApiError(400, "validation_error",
                   message or fields.get("__all__") or GENERIC_INVALID,
                   fields=fields)


def check_upload(upload, *, label: str, limit: int = MAX_UPLOAD_BYTES) -> None:
    """حد حجم الملف قبل ما أي معالجة تقرأه."""
    if upload is not None and upload.size > limit:
        mb = limit // (1024 * 1024)
        raise ApiError(400, "file_too_large", f"حجم {label} أكبر من {mb} ميجابايت.")


# ---------------------------------------------------------------- التنسيق
def fmt_dt(value, pattern: str) -> str:
    """نفس فلتر ‎|date:‎ بتاع القوالب (اللغة الفعّالة والمنطقة الزمنية للقاهرة)."""
    if not value:
        return ""
    if isinstance(value, datetime) and timezone.is_aware(value):
        value = timezone.localtime(value)
    return dateformat.format(value, pattern)


def iso(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime) and timezone.is_aware(value):
        value = timezone.localtime(value)
    return value.isoformat()


def money(value) -> str:
    """‎|floatformat:0‎ — الأسعار بالجنيه من غير كسور، بنفس تقريب القالب القديم."""
    return str(floatformat(value, 0))


def number_input_value(value) -> str:
    """قيمة حقل ‎type=number‎ بخطوة ١: صحيح مقرّب (نص خام من غير فواصل لغة)."""
    return str(int(Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP)))
