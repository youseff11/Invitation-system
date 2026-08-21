"""ميدل‑وير خاص بالمشروع."""

from django.conf import settings


class DefaultLanguageMiddleware:
    """يخلي العربية هي الافتراضي مهما كانت لغة المتصفح.

    LocaleMiddleware بتاعة Django بترتّب المصادر كده:
        الجلسة ← الكوكي ← Accept-Language ← LANGUAGE_CODE
    يعني زبون مصري متصفحه إنجليزي كان هيفتح الموقع إنجليزي وهو عايز عربي.
    الميدل‑وير دي بتشيل Accept-Language من الطلب طالما المستخدم *ما اختارش*
    لغة بنفسه، فتفضل العربية هي الافتراضي وينزل الاختيار اليدوي فوق كل حاجة.

    لازم تتحط قبل django.middleware.locale.LocaleMiddleware في MIDDLEWARE.
    عايز تحترم لغة المتصفح بدل كده؟ شيلها من MIDDLEWARE وخلاص.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        session_key = getattr(settings, "LANGUAGE_SESSION_KEY", "_language")
        chosen = (
            (request.session.get(session_key) if hasattr(request, "session") else None)
            or request.COOKIES.get(settings.LANGUAGE_COOKIE_NAME)
        )
        if not chosen:
            request.META.pop("HTTP_ACCEPT_LANGUAGE", None)
        return self.get_response(request)
