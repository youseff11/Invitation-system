"""تحويل الـmodels لقواميس JSON — مكان واحد لشكل البيانات اللي بتوصل للواجهة."""

from __future__ import annotations

from django.conf import settings
from django.db import DatabaseError
from django.utils.translation import get_language

from ..models import HomeHero, SiteSetting, Template


def user_payload(user) -> dict | None:
    if not getattr(user, "is_authenticated", False):
        return None
    return {
        "id": user.pk,
        "username": user.get_username(),
        "displayName": user.get_full_name() or user.get_username(),
        "isStaff": user.is_staff,
        "isSuperuser": user.is_superuser,
    }


def hero_payload() -> dict:
    """خلفيات هيرو الرئيسية وكلامه (فاضي = الافتراضي المترجم في الواجهة)."""
    try:
        hero = HomeHero.load()
    except DatabaseError:
        # الـmigration لسه ماتشغّلتش (النشر قبل ‎migrate‎): الموقع يفتح بالافتراضي بدل ما يقع
        hero = HomeHero()

    def url(field) -> str:
        return field.url if field else ""

    def text(lang: str) -> dict:
        return {
            "top": getattr(hero, f"top_{lang}"),
            "main": getattr(hero, f"main_{lang}"),
            "sub": getattr(hero, f"sub_{lang}"),
            "cta": getattr(hero, f"cta_{lang}"),
            "plans": getattr(hero, f"plans_{lang}"),
            "trust": [
                {"value": getattr(hero, f"trust{n}_value_{lang}"), "label": getattr(hero, f"trust{n}_label_{lang}")}
                for n in (1, 2, 3)
            ],
        }

    return {
        "images": {
            "lightAr": url(hero.bg_light_ar), "lightEn": url(hero.bg_light_en),
            "darkAr": url(hero.bg_dark_ar), "darkEn": url(hero.bg_dark_en),
        },
        "text": {"ar": text("ar"), "en": text("en")},
    }


def site_payload(request) -> dict:
    """إعدادات الموقع العامة: الاسم والتواصل ومفاتيح الإظهار."""
    cfg = SiteSetting.load()
    en = (get_language() or "").startswith("en")
    name_ar = settings.SITE_NAME
    name_en = getattr(settings, "SITE_NAME_EN", "") or name_ar
    tag_ar = settings.SITE_TAGLINE
    tag_en = getattr(settings, "SITE_TAGLINE_EN", "") or tag_ar
    return {
        "name": {"ar": name_ar, "en": name_en},
        "tagline": {"ar": tag_ar, "en": tag_en},
        "displayName": name_en if en else name_ar,
        "displayTagline": tag_en if en else tag_ar,
        "currency": settings.SITE_CURRENCY,
        "email": settings.SITE_EMAIL,
        "ordersEnabled": cfg.orders_enabled,
        "plansPublic": cfg.plans_public,
        "templatesPerRow": cfg.home_templates_per_row,
        "whatsapp": {
            # الزر العائم: رابط جاهز + الأساس والرسالة لنافذة الشات
            "floatReady": cfg.whatsapp_float_ready,
            "url": cfg.whatsapp_url,
            "base": (f"https://wa.me/{cfg.whatsapp_digits}"
                     if cfg.whatsapp_float_ready else ""),
            "message": (cfg.whatsapp_cta_message or "").strip(),
        },
        "facebookUrl": cfg.facebook_url if cfg.facebook_enabled else "",
        "instagramUrl": cfg.instagram_url if cfg.instagram_enabled else "",
        "languages": [{"code": code, "label": label}
                      for code, label in settings.LANGUAGES],
        "hero": hero_payload(),
    }


def template_card(template: Template) -> dict:
    """بطاقة قالب لمعرض القوالب — من غير المستند التقيل."""
    return {
        "id": template.pk,
        "slug": template.slug,
        "name": template.name,
        "nameEn": template.name_en,
        "displayName": template.display_name,
        "description": template.description,
        "descriptionEn": template.description_en,
        "displayDescription": template.display_description,
        "category": template.category,
        "collection": template.collection,
        "cover": template.cover_src or None,
    }
