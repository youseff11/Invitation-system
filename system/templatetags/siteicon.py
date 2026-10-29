"""وسم أيقونة الموقع للـ‎<head>‎."""

from django import template
from django.templatetags.static import static

from .. import siteicon

register = template.Library()


@register.simple_tag
def site_icon_href(fallback: str) -> str:
    """أيقونة الموقع اللي رفعها المصمّم، وإلا ملف الـstatic الافتراضي ‎fallback‎."""
    return siteicon.icon_url() or static(fallback)
