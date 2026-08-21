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
