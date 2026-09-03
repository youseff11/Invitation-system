import hashlib
import os

from django.conf import settings
from django.utils.translation import get_language

_ASSET_V = None


def _asset_version():
    """بصمة بتتغيّر مع أي تعديل في ملفات static.

    من غيرها المتصفح بيفضل ماسك نسخة قديمة من ملفات CSS وJavaScript بعد أي تحديث،
    فتلاقي التصميم اتغيّر والسلوك لأ (أو العكس). البصمة هنا مبنية على محتوى
    الملفات نفسها، لذلك لا تعتمد على توقيت Git أو توقيت نسخ static إلى staticfiles.
    في DEBUG بتتحسب كل طلب عشان التعديل يبان فوراً، وفي الإنتاج بتتحسب مرة واحدة.

    """
    global _ASSET_V
    if _ASSET_V and not settings.DEBUG:
        return _ASSET_V
    digest = hashlib.sha256()
    found = False
    for root in getattr(settings, "STATICFILES_DIRS", []):
        for base, _dirs, files in os.walk(root):
            for name in sorted(files):
                if not name.endswith((".css", ".js")):
                    continue
                path = os.path.join(base, name)
                try:
                    digest.update(os.path.relpath(path, root).encode("utf-8", "surrogateescape"))
                    with open(path, "rb") as asset:
                        for chunk in iter(lambda: asset.read(1024 * 1024), b""):
                            digest.update(chunk)
                    found = True
                except (OSError, UnicodeError):
                    pass
    _ASSET_V = digest.hexdigest()[:16] if found else "1"

    return _ASSET_V


def _cta():
    """إعدادات التواصل اللي كل صفحة محتاجاها — الطلبات وزر الواتساب.

    الاستيراد جوّه الدالة عن قصد: معالجات السياق بتتحمّل بدري، وأي
    استيراد للموديلات على مستوى الملف بيضرب AppRegistryNotReady.

    سطر واحد في الجدول، فالاستعلام رخيص — لكنه بيتنفّذ مع كل صفحة.
    """
    from .models import SiteSetting
    cfg = SiteSetting.load()
    return {
        "orders_enabled": cfg.orders_enabled,
        "whatsapp_url": cfg.whatsapp_url,
        "whatsapp_float": cfg.whatsapp_float_ready,
    }


def site_settings(request):
    en = (get_language() or "").startswith("en")
    # النسختين مع بعض كمان: الصفحات ثنائية اللغة بتطبع الاتنين في نفس
    # الـHTML عشان التبديل يبقى فوري من غير رحلة للسيرفر.
    name_ar = settings.SITE_NAME
    name_en = getattr(settings, "SITE_NAME_EN", "") or name_ar
    tag_ar = settings.SITE_TAGLINE
    tag_en = getattr(settings, "SITE_TAGLINE_EN", "") or tag_ar
    return {
        "SITE_NAME": name_en if en else name_ar,
        "SITE_TAGLINE": tag_en if en else tag_ar,
        "SITE_NAME_AR": name_ar,
        "SITE_NAME_EN": name_en,
        "SITE_TAGLINE_AR": tag_ar,
        "SITE_TAGLINE_EN": tag_en,
        "SITE_WHATSAPP": settings.SITE_WHATSAPP,
        "SITE_EMAIL": settings.SITE_EMAIL,
        "SITE_CURRENCY": settings.SITE_CURRENCY,
        "SITE_CTA": _cta(),
        "ASSET_V": _asset_version(),
    }
