"""مسارات الأساس: CSRF، الدخول والخروج، اللغة، إعدادات الموقع، قائمة القوالب."""

from __future__ import annotations

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.cache import cache
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from django.middleware.csrf import get_token

from ..models import Template
from .http import ApiError, api_view, client_hash, json_body, json_response
from .serializers import site_payload, template_card, user_payload

# نفس الحقول التقيلة اللي الموقع القديم بيتفاداها في صفحات العرض
_TEMPLATE_HEAVY_FIELDS = ("document", "preview_render", "runtime_scripts")

LOGIN_ATTEMPTS = 8            # محاولات فاشلة مسموحة
LOGIN_WINDOW = 15 * 60        # خلال الفترة دي (ثواني)


# ---------------------------------------------------------------- الجلسة
@ensure_csrf_cookie
@never_cache
@api_view("GET")
def csrf(request):
    """يزرع كوكي ‎csrftoken‎ ويرجّع الرمز — الواجهة بتناديه قبل أول POST."""
    return {"csrfToken": get_token(request)}


@never_cache
@api_view("GET")
def me(request):
    return {"user": user_payload(request.user)}


def _throttle_key(request, username: str) -> str:
    return f"api-login:{client_hash(request)}:{username.strip().lower()[:150]}"


@never_cache
@api_view("POST")
def auth_login(request):
    data = json_body(request)
    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")
    if not username or not password:
        raise ApiError(400, "missing_credentials", "اكتب اسم المستخدم وكلمة المرور.",
                       fields={"username": "مطلوب" if not username else "",
                               "password": "مطلوب" if not password else ""})

    key = _throttle_key(request, username)
    if cache.get(key, 0) >= LOGIN_ATTEMPTS:
        raise ApiError(429, "too_many_attempts",
                       "محاولات كتير. استنى شوية وحاول تاني.")

    user = authenticate(request, username=username, password=password)
    if user is None or not user.is_active:
        # add + incr عشان العدّاد يبدأ بمهلته أول مرة بس
        cache.add(key, 0, LOGIN_WINDOW)
        try:
            cache.incr(key)
        except ValueError:
            cache.set(key, 1, LOGIN_WINDOW)
        raise ApiError(400, "invalid_credentials",
                       "اسم المستخدم أو كلمة المرور غير صحيحة.")

    cache.delete(key)
    login(request, user)
    return {"user": user_payload(user)}


@never_cache
@api_view("POST")
def auth_logout(request):
    logout(request)
    return {"user": None}


# ---------------------------------------------------------------- اللغة
@api_view("POST")
def set_language(request):
    """يحفظ اللغة المختارة في كوكي Django — نفس اللي بيقراه LocaleMiddleware."""
    code = str(json_body(request).get("language") or "").lower()
    allowed = {c for c, _ in settings.LANGUAGES}
    if code not in allowed:
        raise ApiError(400, "invalid_language", "لغة غير مدعومة.")
    response = json_response({"language": code})
    response.set_cookie(
        settings.LANGUAGE_COOKIE_NAME, code,
        max_age=settings.LANGUAGE_COOKIE_AGE,
        path=settings.LANGUAGE_COOKIE_PATH,
        domain=settings.LANGUAGE_COOKIE_DOMAIN,
        secure=settings.LANGUAGE_COOKIE_SECURE,
        httponly=settings.LANGUAGE_COOKIE_HTTPONLY,
        samesite=settings.LANGUAGE_COOKIE_SAMESITE,
    )
    return response


# ---------------------------------------------------------------- عام
@api_view("GET")
def site(request):
    return site_payload(request)


@api_view("GET")
def templates_list(request):
    """القوالب المعروضة للعملاء، مع فلتر التصنيف الاختياري."""
    qs = Template.objects.filter(is_active=True).defer(*_TEMPLATE_HEAVY_FIELDS)
    category = request.GET.get("category", "")
    if category:
        qs = qs.filter(category=category)
    return {
        "results": [template_card(t) for t in qs],
        # «بدون» مش تصنيف يتفلتر بيه في المعرض العام
        "categories": [{"value": value, "label": label}
                       for value, label in Template.CATEGORY_CHOICES
                       if value != "none"],
    }
