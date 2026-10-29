"""أدوات مشتركة لواجهة JSON — شكل موحّد للنجاح والخطأ.

النجاح: الجسم هو البيانات نفسها (كائن أو قائمة) بكود 200/201.
الخطأ:  ``{"error": {"code": "...", "message": "...", "fields": {...}}}``
        بكود 4xx — ``fields`` اختياري وبيحمل أخطاء كل حقل لوحده.

الحماية من CSRF بتيجي من ‎CsrfViewMiddleware‎ زي أي POST في Django؛ الواجهة
بتبعت الرمز في هيدر ‎X-CSRFToken‎ من كوكي ‎csrftoken‎.
"""

from __future__ import annotations

import hashlib
import json
from functools import wraps

from django.conf import settings
from django.core.exceptions import PermissionDenied
from django.http import Http404, HttpResponse, JsonResponse


class ApiError(Exception):
    """خطأ متوقّع بيتحوّل لرد JSON بكود HTTP مناسب."""

    def __init__(self, status: int, code: str, message: str = "",
                 fields: dict | None = None):
        super().__init__(message or code)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields


def json_response(data, status: int = 200) -> JsonResponse:
    # ensure_ascii=False: العربي يفضل مقروء في الشبكة وأصغر حجماً
    return JsonResponse(data, status=status, safe=False,
                        json_dumps_params={"ensure_ascii": False})


def error_response(status: int, code: str, message: str = "",
                   fields: dict | None = None) -> JsonResponse:
    body: dict = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    return json_response({"error": body}, status=status)


def api_view(*methods: str):
    """يغلّف الـview: يقيّد الـmethods ويحوّل الاستثناءات المتوقعة لـJSON.

    من غيره ‎Http404‎ و‎PermissionDenied‎ كانوا هيرجّعوا صفحة HTML والواجهة
    مش هتعرف تقراها.
    """
    allowed = tuple(m.upper() for m in methods)

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            if allowed and request.method not in allowed:
                response = error_response(405, "method_not_allowed",
                                          "الطريقة غير مسموحة.")
                response["Allow"] = ", ".join(allowed)
                return response
            try:
                result = view(request, *args, **kwargs)
            except ApiError as exc:
                return error_response(exc.status, exc.code, exc.message, exc.fields)
            except PermissionDenied as exc:
                if not request.user.is_authenticated:
                    return error_response(401, "unauthenticated", "سجّل الدخول أولاً.")
                return error_response(403, "forbidden", str(exc) or "غير مسموح.")
            except Http404 as exc:
                return error_response(404, "not_found", str(exc) or "غير موجود.")
            if isinstance(result, HttpResponse):
                return result
            return json_response(result)

        return wrapper

    return decorator


def json_body(request) -> dict:
    """جسم الطلب كـdict — أي شيء غير كائن JSON مرفوض بـ400."""
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        raise ApiError(400, "invalid_json", "الطلب ليس JSON صالحاً.")
    if not isinstance(data, dict):
        raise ApiError(400, "invalid_json", "المتوقع كائن JSON.")
    return data


def require_staff(request) -> None:
    """لوحة التحكم لفريق العمل فقط — 401 لو مش داخل، 403 لو داخل وليس منهم."""
    if not request.user.is_authenticated:
        raise ApiError(401, "unauthenticated", "سجّل الدخول أولاً.")
    if not request.user.is_staff:
        raise ApiError(403, "forbidden", "لوحة التحكم متاحة لفريق العمل فقط.")


def client_hash(request) -> str:
    """بصمة العميل (IP مُجزَّأ) لمعدّلات الحد — من غير تخزين العنوان نفسه."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = (forwarded.split(",")[0].strip() if forwarded
          else request.META.get("REMOTE_ADDR", ""))
    return hashlib.sha256(f"{ip}|{settings.SECRET_KEY}".encode()).hexdigest()[:32]
