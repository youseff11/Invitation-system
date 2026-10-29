"""وسم ``{% vite_assets %}`` — يحمّل تطبيق React في صفحة الـshell.

وضعين:

* **تطوير**: ‎``VITE_DEV_SERVER``‎ محدد (مثلاً http://localhost:5173) فالسكربتات
  بتتحمّل من سيرفر Vite بالـHMR.
* **إنتاج**: بيقرا ‎``static/app/manifest.json``‎ اللي ‎``npm run build``‎ بيطلّعه
  ويطبع ملفات الـentry بأسمائها المبصومة (hash) — فالمتصفح بيخزّنها للأبد.
"""

from __future__ import annotations

import json
from pathlib import Path

from django import template
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.templatetags.static import static
from django.utils.html import format_html, format_html_join
from django.utils.safestring import mark_safe

register = template.Library()

ENTRY = "src/main.tsx"            # التطبيق الكامل (الافتراضي)
INVITE_ENTRY = "src/invite-main.tsx"  # عارض الدعوة: entry خفيف منفصل
_cache: dict = {"mtime": None, "data": None}


def _manifest() -> dict:
    path = Path(settings.VITE_BUILD_DIR) / "manifest.json"
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        raise ImproperlyConfigured(
            "ملف الـbuild بتاع React مش موجود. شغّل «npm run build» جوّه "
            "frontend/، أو اضبط VITE_DEV_SERVER لسيرفر Vite وقت التطوير."
        )
    if _cache["mtime"] != mtime:
        _cache["data"] = json.loads(path.read_text(encoding="utf-8"))
        _cache["mtime"] = mtime
    return _cache["data"]


def _collect(manifest: dict, key: str, seen: set, css: list, preload: list) -> None:
    """يمشي على imports الـentry بالتكرار ويجمع الـcss والـchunks."""
    if key in seen or key not in manifest:
        return
    seen.add(key)
    chunk = manifest[key]
    css.extend(chunk.get("css", []))
    for child in chunk.get("imports", []):
        if child in manifest:
            preload.append(manifest[child]["file"])
        _collect(manifest, child, seen, css, preload)


def _dev_tags(server: str, entry: str = ENTRY):
    return format_html(
        '<script type="module">\n'
        'import RefreshRuntime from "{0}/@react-refresh"\n'
        "RefreshRuntime.injectIntoGlobalHook(window)\n"
        "window.$RefreshReg$ = () => {{}}\n"
        "window.$RefreshSig$ = () => (type) => type\n"
        "window.__vite_plugin_react_preamble_installed__ = true\n"
        "</script>\n"
        '<script type="module" src="{0}/@vite/client"></script>\n'
        '<script type="module" src="{0}/{1}"></script>',
        server, entry,
    )


@register.simple_tag
def vite_assets(entry: str = ENTRY):
    """يحمّل entry واحد من الـbuild (الافتراضي التطبيق الكامل)."""
    dev_server = getattr(settings, "VITE_DEV_SERVER", "")
    if settings.DEBUG and dev_server:
        return _dev_tags(dev_server, entry)

    manifest = _manifest()
    if entry not in manifest:
        raise ImproperlyConfigured(f"الـentry «{entry}» مش موجود في manifest.json.")
    css: list = []
    preload: list = []
    _collect(manifest, entry, set(), css, preload)

    def url(rel: str) -> str:
        return static(f"app/{rel}")

    parts = [
        format_html_join("\n", '<link rel="stylesheet" href="{}">',
                         ((url(f),) for f in dict.fromkeys(css))),
        format_html_join("\n", '<link rel="modulepreload" href="{}">',
                         ((url(f),) for f in dict.fromkeys(preload))),
        format_html('<script type="module" src="{}"></script>',
                    url(manifest[entry]["file"])),
    ]
    return mark_safe("\n".join(p for p in parts if p))
