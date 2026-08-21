"""توليد رموز QR كـSVG مضمّن — بدون ملفات ولا طلبات خارجية."""

from __future__ import annotations

import io


def svg_for(data: str, *, box_size: int = 10, border: int = 2) -> str:
    """يعيد نص SVG لرمز QR. يعيد SVG فارغاً لو الحزمة غير مثبّتة."""
    if not data:
        return ""
    try:
        import qrcode
        import qrcode.image.svg
    except ImportError:  # pragma: no cover
        return (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
            '<text x="50" y="52" text-anchor="middle" font-size="7" fill="#999">'
            "QR غير متاح</text></svg>"
        )

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode("utf-8")
    # نزيل ترويسة XML لأن الرمز يُدرَج داخل صفحة HTML
    if svg.startswith("<?xml"):
        svg = svg.split("?>", 1)[-1].lstrip()
    return svg


def png_for(data: str, *, label: str = "", caption: str = "",
            box_size: int = 10, border: int = 3) -> bytes | None:
    """رمز QR كصورة PNG مع الكود والاسم تحته.

    الـSVG أنضف للعرض في الصفحة، بس واتساب والاستديو مابيعرضوش SVG —
    والضيف محتاج صورة يحفظها ويوريها على الباب، والقاعة محتاجة صور
    تتحط في ملف إكسل. فالنسخة دي بالـPNG.

    يرجّع ``None`` لو Pillow أو qrcode مش متثبّتين.
    """
    if not data:
        return None
    try:
        import qrcode
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:            # pragma: no cover
        return None

    qr = qrcode.QRCode(
        version=None,
        # H بتتحمّل تلف ربع الرمز — الورق بيتكرمش والشاشة بتلمع
        error_correction=qrcode.constants.ERROR_CORRECT_H,
        box_size=box_size, border=border,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white").convert("RGB")

    if not label and not caption:
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        return buf.getvalue()

    pad = max(28, img.height // 12)
    canvas = Image.new("RGB", (img.width, img.height + pad * 2), "white")
    canvas.paste(img, (0, 0))
    draw = ImageDraw.Draw(canvas)

    def _font(size):
        for path in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                     "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
        return ImageFont.load_default()

    # تشكيل العربي وربط حروفه محتاج Raqm. لو مش موجود، الاسم العربي
    # هيطلع حروف مقطّعة ومقلوبة — أحسن ما نكتبه أصلاً.
    try:
        from PIL import features
        has_raqm = features.check("raqm")
    except Exception:               # pragma: no cover
        has_raqm = False

    def _is_arabic(t):
        return any("\u0600" <= ch <= "\u06ff" for ch in t)

    y = img.height - pad // 2
    for text, size in ((label, max(16, img.width // 16)),
                       (caption, max(13, img.width // 22))):
        if not text:
            continue
        rtl = _is_arabic(text)
        if rtl and not has_raqm:
            continue
        f = _font(size)
        kw = {"direction": "rtl", "language": "ar"} if rtl else {}
        try:
            w = draw.textbbox((0, 0), text, font=f, **kw)[2]
            draw.text(((img.width - w) // 2, y), text, font=f,
                      fill="#111111", **kw)
        except Exception:           # pragma: no cover
            continue
        y += size + 6

    buf = io.BytesIO()
    canvas.save(buf, "PNG", optimize=True)
    return buf.getvalue()
