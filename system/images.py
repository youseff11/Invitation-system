"""معالجة الصور المرفوعة — تصغير وضغط وقص.

صورة تليفون عادية بتطلع 4032×3024 وحوالي ٤ ميجا. لو اتخزنت زي ما هي،
معرض ٢٠ صورة في دعوة = ٨٠ ميجا بيتحمّلوا على بيانات موبايل، والضيف
بيقفل الصفحة قبل ما تخلص. فبنصغّرها ونحوّلها WebP قبل التخزين.
"""

from __future__ import annotations

import io

from django.core.files.uploadedfile import InMemoryUploadedFile

MAX_EDGE = 1800          # أطول ضلع بعد التصغير — كفاية لأي شاشة
THUMB_EDGE = 480
QUALITY = 82
THUMB_QUALITY = 72

# دي مابنلمسهاش: SVG متجهة أصلاً، والـGIF المتحرك بيفقد حركته لو حوّلناه
SKIP_TYPES = {"image/svg+xml", "image/gif"}


def _open_upright(fh):
    """يفتح الصورة ويصلّح دورانها من بيانات EXIF.

    من غير الخطوة دي، صور الموبايل المصوّرة بالطول بتظهر مقلوبة على جنب
    لأن الكاميرا بتخزنها أفقية وتسيب زاوية الدوران في EXIF.
    """
    from PIL import Image, ImageOps

    fh.seek(0)
    img = Image.open(fh)
    img = ImageOps.exif_transpose(img)      # بيشيل EXIF كمان = خصوصية + حجم
    return img


def _to_rgb(img):
    """WebP بيدعم الشفافية، فبنحافظ عليها لو موجودة."""
    if img.mode in ("RGBA", "LA"):
        return img.convert("RGBA")
    if img.mode == "P" and "transparency" in img.info:
        return img.convert("RGBA")
    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def _fit(img, max_edge: int):
    w, h = img.size
    longest = max(w, h)
    if longest <= max_edge:
        return img
    scale = max_edge / longest
    from PIL import Image
    return img.resize((max(1, round(w * scale)), max(1, round(h * scale))),
                      Image.LANCZOS)


def _as_upload(img, name: str, quality: int) -> InMemoryUploadedFile:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=5)
    size = buf.tell()
    buf.seek(0)
    return InMemoryUploadedFile(buf, "ImageField", name, "image/webp", size, None)


def compress(upload, content_type: str):
    """يرجّع ``(ملف_مضغوط, مصغّرة, العرض, الارتفاع)``.

    لو النوع مش مناسب للتحويل بيرجّع الملف الأصلي ومعاه مقاسه.
    """
    if content_type in SKIP_TYPES:
        try:
            img = _open_upright(upload)
            size = img.size
        except Exception:
            size = (0, 0)
        upload.seek(0)
        return upload, None, size[0], size[1]

    img = _to_rgb(_open_upright(upload))
    img = _fit(img, MAX_EDGE)
    width, height = img.size

    stem = (getattr(upload, "name", "image") or "image").rsplit(".", 1)[0][:60]
    main = _as_upload(img, f"{stem}.webp", QUALITY)
    thumb = _as_upload(_fit(img.copy(), THUMB_EDGE), f"{stem}-thumb.webp", THUMB_QUALITY)
    return main, thumb, width, height


def crop(source_path_or_file, box: dict, *, max_edge: int = MAX_EDGE):
    """يقص من الصورة الأصلية بنِسَب (0..1) ويرجّع ملف WebP جاهز للحفظ.

    النِسَب مش بكسل عشان القص يفضل صحيح مهما كان مقاس الصورة المعروضة
    في المحرر مختلف عن مقاس الأصل.
    """
    img = _to_rgb(_open_upright(source_path_or_file))
    w, h = img.size

    def clamp(v, lo=0.0, hi=1.0):
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = lo
        return max(lo, min(hi, v))

    x = clamp(box.get("x"))
    y = clamp(box.get("y"))
    cw = clamp(box.get("w"), 0.02, 1.0)
    ch = clamp(box.get("h"), 0.02, 1.0)
    # ما نخرجش بره حدود الصورة
    cw = min(cw, 1.0 - x)
    ch = min(ch, 1.0 - y)

    left, top = round(x * w), round(y * h)
    right, bottom = round((x + cw) * w), round((y + ch) * h)
    right = max(right, left + 1)
    bottom = max(bottom, top + 1)

    img = img.crop((left, top, right, bottom))
    img = _fit(img, max_edge)
    return img, img.size
