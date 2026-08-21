import os

from django.conf import settings
from django.utils.translation import get_language

_ASSET_V = None


def _asset_version():
    """بصمة بتتغيّر مع أي تعديل في ملفات static.

    من غيرها المتصفح بيفضل ماسك نسخة قديمة من site.css / site.js بعد أي تحديث،
    فتلاقي التصميم اتغيّر والسلوك لأ (أو العكس). في DEBUG بتتحسب كل طلب عشان
    التعديل يبان فوراً، وفي الإنتاج بتتحسب مرة واحدة.
    """
    global _ASSET_V
    if _ASSET_V and not settings.DEBUG:
        return _ASSET_V
    newest = 0
    for root in getattr(settings, "STATICFILES_DIRS", []):
        for base, _dirs, files in os.walk(root):
            for name in files:
                if name.endswith((".css", ".js")):
                    try:
                        newest = max(newest, int(os.path.getmtime(os.path.join(base, name))))
                    except OSError:
                        pass
    _ASSET_V = str(newest or 1)
    return _ASSET_V


def site_settings(request):
    en = (get_language() or "").startswith("en")
    return {
        "SITE_NAME": getattr(settings, "SITE_NAME_EN", "") if en else settings.SITE_NAME,
        "SITE_TAGLINE": getattr(settings, "SITE_TAGLINE_EN", "") if en else settings.SITE_TAGLINE,
        "SITE_WHATSAPP": settings.SITE_WHATSAPP,
        "SITE_EMAIL": settings.SITE_EMAIL,
        "SITE_CURRENCY": settings.SITE_CURRENCY,
        "ASSET_V": _asset_version(),
    }
