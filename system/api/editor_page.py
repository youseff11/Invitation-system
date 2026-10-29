"""صفحة إطار المعاينة (‎/editor-frame/‎) — shell فاضي بيتحمّل جوّاه iframe المحرر.

مسار ثابت على الجذر (مش تحت ‎SPA_BASENAME‎) عشان يفضل صالح بعد التحويل النهائي.
فريق العمل بس: الحمولة نفسها جاية من ‎/api/v1/editor/…/preview/‎ المحمي، لكن الإطار
مالوش لازمة لغير المحرر.
"""

from __future__ import annotations

from django.core.exceptions import PermissionDenied
from django.shortcuts import render
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


@require_safe
@never_cache
def editor_frame(request):
    if not request.user.is_authenticated or not request.user.is_staff:
        raise PermissionDenied("المعاينة متاحة لفريق العمل فقط.")
    response = render(request, "spa/editor_frame.html")
    response["X-Robots-Tag"] = "noindex, nofollow"
    # نفس الأصل بس: الإطار بيتحمّل جوّه صفحة المحرر
    response["X-Frame-Options"] = "SAMEORIGIN"
    return response
