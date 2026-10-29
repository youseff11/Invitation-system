"""أيقونة الموقع (الـfavicon) — ملف واحد بيتغيّر من لوحة «إدارة البيانات».

متخزّنة كملف عادي في ‎MEDIA_ROOT/site/‎ مش حقل في الداتابيز: مفيش ‎migration‎ ولا حاجة تتغيّر في
شكل الجداول، وأي نسخة احتياطية من ‎media/‎ بتشيلها معاها. بتتعاد تحجيمها لمربع ‎PNG‎ شفاف (٢٥٦×٢٥٦)
عشان أي صورة يرفعها المصمّم (مستطيلة، ‎JPEG‎، ‎WebP‎…) تطلع أيقونة سليمة في تبويب المتصفح.
"""

from __future__ import annotations

import io
from pathlib import Path

from django.conf import settings
from PIL import Image, ImageOps, UnidentifiedImageError

SIZE = 256
MAX_BYTES = 5 * 1024 * 1024
# ما يتفتحش إلا الصيغ دي (SVG مرفوض عن قصد: ممكن يشيل سكربت)
ALLOWED_FORMATS = {"PNG", "JPEG", "WEBP", "GIF", "ICO", "BMP"}
Image.MAX_IMAGE_PIXELS = 40_000_000


class IconError(ValueError):
    """رسالة جاهزة للعرض للمستخدم."""


def icon_path() -> Path:
    return Path(settings.MEDIA_ROOT) / "site" / "icon.png"


def is_custom() -> bool:
    return icon_path().is_file()


def version() -> int:
    """وقت آخر تعديل — بيتحط في الرابط عشان المتصفح يجيب الأيقونة الجديدة بدل المخزّنة."""
    try:
        return int(icon_path().stat().st_mtime)
    except OSError:
        return 0


def icon_url() -> str:
    """رابط الأيقونة المخصّصة، أو فاضي لو المصمّم ماغيّرهاش (الصفحة بتستعمل أيقونتها الافتراضية)."""
    return f"/site-icon.png?v={version()}" if is_custom() else ""


def save_icon(data: bytes) -> None:
    image = _decode(data)

    # مربع شفاف: الصورة بتتحط في النص بنسبتها من غير ما تتمطّ
    image.thumbnail((SIZE, SIZE), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2), image)

    target = icon_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp")
    canvas.save(temp, format="PNG", optimize=True)
    temp.replace(target)  # استبدال ذرّي: مفيش طلب يشوف ملف نصف مكتوب


def reset_icon() -> bool:
    try:
        icon_path().unlink()
        return True
    except FileNotFoundError:
        return False


# ---------------------------------------------------------------- لوجو الموقع (النافبار وقسم الدعاية)
# فاتح (على خلفية فاتحة) وغامق (على الداكنة). لو اترفع الفاتح بس، الغامق بيستعمله بدل ما يرجع للوجو القديم.
LOGO_SLOTS = ("light", "dark")
LOGO_MAX = (1200, 400)
# المسار الثابت اللي بيتكتب في قسم «الدعاية» — بيتقدّم ديناميكي، فتغيير اللوجو بعدها مايحتاجش لمس المستندات تاني
LOGO_URL = "/site-logo/light.png"


def logo_path(slot: str) -> Path:
    return Path(settings.MEDIA_ROOT) / "site" / f"logo-{slot}.png"


def logo_file(slot: str) -> Path | None:
    """الملف الفعّال للوجو (الغامق بيرجع للفاتح لو مفيش غامق مرفوع)، أو ‎None‎ لو مفيش لوجو مخصّص."""
    for candidate in ([slot, "light"] if slot == "dark" else [slot]):
        path = logo_path(candidate)
        if path.is_file():
            return path
    return None


def logo_state() -> dict:
    """أي لوجو مرفوع (‎light‎/‎dark‎) + ‎version‎ (وقت آخر تعديل) عشان الواجهة تحدّث المعاينة."""
    state: dict = {slot: logo_path(slot).is_file() for slot in LOGO_SLOTS}
    state["version"] = int(
        max((logo_path(s).stat().st_mtime for s in LOGO_SLOTS if logo_path(s).is_file()), default=0)
    )
    return state


def _decode(data: bytes) -> Image.Image:
    if not data:
        raise IconError("الملف فاضي.")
    if len(data) > MAX_BYTES:
        raise IconError("الصورة أكبر من 5 ميجا.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise IconError("الصيغة مش مدعومة — ارفع PNG أو JPG أو WebP.")
            probe.verify()
        with Image.open(io.BytesIO(data)) as image:
            return ImageOps.exif_transpose(image).convert("RGBA")
    except IconError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise IconError("الملف مش صورة سليمة.") from exc


def save_logo(slot: str, data: bytes) -> None:
    if slot not in LOGO_SLOTS:
        raise IconError("نوع اللوجو غير معروف.")
    image = _decode(data)
    # بنسيب النسبة زي ما هي (لوجو مستطيل) ونصغّره بس لو كبير
    image.thumbnail(LOGO_MAX, Image.LANCZOS)
    target = logo_path(slot)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp")
    image.save(temp, format="PNG", optimize=True)
    temp.replace(target)


def reset_logo(slot: str) -> bool:
    try:
        logo_path(slot).unlink()
        return True
    except FileNotFoundError:
        return False


def apply_logo_to_branding() -> dict:
    """يخلّي قسم «الدعاية» في كل القوالب والدعوات يعرض لوجو الموقع (‎LOGO_URL‎).

    بيمسّ بس خانة ‎logo‎ في أقسام ‎branding‎ — وبـ‎update‎ زي باقي عمليات الصيانة (من غير ما يلمس
    وقت التعديل ولا يحرّك الدعوات). معاينة القالب المخزّنة بتتصفّر عشان تتولّد من جديد.
    """
    from .models import Invitation, Template

    result = {"templates": 0, "invitations": 0, "blocks": 0}
    for model, key in ((Template, "templates"), (Invitation, "invitations")):
        for pk, document in list(model.objects.values_list("pk", "document")):
            blocks = document.get("blocks") if isinstance(document, dict) else None
            touched = 0
            for block in blocks or []:
                if isinstance(block, dict) and block.get("type") == "branding":
                    props = block.setdefault("props", {})
                    if props.get("logo") != LOGO_URL:
                        props["logo"] = LOGO_URL
                        touched += 1
            if not touched:
                continue
            fields = {"document": document}
            if model is Template:
                fields["preview_render"] = {}
            model.objects.filter(pk=pk).update(**fields)
            result[key] += 1
            result["blocks"] += touched
    return result
