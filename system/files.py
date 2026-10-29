"""مسارات بتقدّم ملفات مش صفحات: ‎robots.txt‎ و‎sitemap.xml‎ وفيديو/صورة المشاركة وصور QR.

اتنقلت من ‎views.py‎ القديم لما اتحذف الموقع الكلاسيك — نفس السلوك بالظبط.
"""

from __future__ import annotations

from .services import _share_jpeg, _share_source

import mimetypes
import re
from pathlib import Path
from django.conf import settings
from django.http import Http404, HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.templatetags.static import static
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.views.decorators.http import require_GET, require_safe
from django.views.static import serve as static_serve
from . import qrcodes, siteicon
from .models import Guest, Invitation


def media_video(request, path):
    """يخدم فيديوهات media مع دعم Range Requests للبدء السريع."""
    if Path(path).suffix.lower() not in {".mp4", ".m4v", ".mov", ".webm", ".ogv"}:

        raise Http404
    root = Path(settings.MEDIA_ROOT).resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        raise Http404
    size = target.stat().st_size
    content_type = mimetypes.guess_type(target.name)[0] or "video/mp4"
    range_value = request.headers.get("Range", "").strip()
    start, end = 0, size - 1
    status = 200
    if range_value:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_value)
        if not match:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        first, last = match.groups()
        if first:
            start = int(first)
            end = int(last) if last else size - 1
        elif last:
            count = int(last)
            start = max(0, size - count)
            end = size - 1
        if start >= size or start > end:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
            return response
        end = min(end, size - 1)
        status = 206

    length = end - start + 1

    def chunks():
        with target.open("rb") as fh:
            fh.seek(start)
            remaining = length
            while remaining:
                data = fh.read(min(1024 * 1024, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    response = StreamingHttpResponse(chunks(), status=status, content_type=content_type)
    response["Accept-Ranges"] = "bytes"
    response["Content-Length"] = str(length)
    response["Cache-Control"] = "public, max-age=31536000, immutable"
    if status == 206:
        response["Content-Range"] = f"bytes {start}-{end}/{size}"
    return response


def media_file(request, path):
    """‎/media/…‎ من Django — شبكة أمان لو الاستضافة مش مظبوطة تقدّم المجلد (وإلا الـcatch-all يرجّع الـshell).

    الفيديو بيروح لـ‎media_video‎ (Range)، والباقي لـ‎serve‎ بتاع Django (بيمنع الخروج من المجلد).
    لو الاستضافة بتقدّم ‎/media/‎ لوحدها الطلب مابيوصلش هنا أصلاً.
    """
    if Path(path).suffix.lower() in {".mp4", ".m4v", ".mov", ".webm", ".ogv"}:
        return media_video(request, path)
    return static_serve(request, path, document_root=settings.MEDIA_ROOT)


@require_safe        # كراولر ميتا ساعات بيبعت HEAD قبل GET
def share_image(request, path):
    """يخدم صورة المشاركة JPEG بنوع محتوى صريح.

    ملفات ‎.webp‎ على الاستضافة بتتردّ من غير ‎Content-Type‎ فميتا
    بترفضها وتبعت اللينك من غير صورة.
    """
    from django.http import FileResponse

    # الرابط الجديد بيضيف ‎.jpg‎ في الآخر؛ والقديم (من غيرها) يفضل شغال.
    # ملفات jpg/png الأصلية ماتعديش من هنا أصلاً (_SHARE_DIRECT_EXT).
    if path.lower().endswith(".jpg") and not _share_source(path):
        path = path[:-4]
    made = _share_jpeg(path)
    if not made:
        raise Http404
    response = FileResponse(open(made[0], "rb"), content_type="image/jpeg")
    response["Cache-Control"] = "public, max-age=86400"
    return response


@require_GET
def robots_txt(request):
    """robots.txt — مجموعة واحدة لكل الزواحف.

    ‎/i/‎ **مش** مقفول هنا: زاحف ميتا (فيسبوك وماسنجر وميتا بيزنس) بيلتزم
    بـ robots.txt، ولما ‎/i/‎ اتقفل لـ ‎*‎ الدعوات بقت تتبعت من غير صورة.
    ومجموعة باسم كل زاحف ماكانتش كفاية — كذا ‎User-agent‎ ورا بعض قبل
    القواعد تنسيق قياسي بس ميتا ماكانتش بتفهمه وفضلت ترجّع 403.
    الدعوات بتفضل برّه محركات البحث بـ ‎noindex‎ جوّه الصفحة نفسها
    (``_render_invitation_page``)، وده كمان الأصح: جوجل لازم يفتح الصفحة
    عشان يشوف ‎noindex‎. لوحة العميل ولوحة القاعة (رموز سرية في الرابط)
    فضلت مقفولة.
    """
    lines = [
        "User-agent: *",
        "Disallow: /i/*/client/",
        "Disallow: /i/*/venue/",
        "Disallow: /dashboard/",
        "Disallow: /admin/",
        "Disallow: /login/",
        "Disallow: /logout/",
        "Disallow: /i18n/",
        "Disallow: /media-video/",
        "",
        f"Sitemap: {settings.SITE_URL}/sitemap.xml",
        "",
    ]
    return HttpResponse("\n".join(lines), content_type="text/plain; charset=utf-8")


@require_GET
def sitemap_xml(request):
    """sitemap.xml — الرئيسية والمعرض بس؛ معاينات القوالب noindex فمش بتتحط هنا."""
    base = settings.SITE_URL
    urls = [(base + "/", None, "1.0"),
            (base + reverse("template_gallery"), None, "0.8")]
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, _updated, prio in urls:
        out.append("<url><loc>%s</loc>%s<priority>%s</priority></url>" % (
            loc, "", prio))
    out.append("</urlset>")
    return HttpResponse("\n".join(out), content_type="application/xml; charset=utf-8")


# ==========================================================================
# QR
# ==========================================================================
@require_GET
def invitation_qr(request, slug):
    invitation = get_object_or_404(Invitation, slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404
    url = request.build_absolute_uri(invitation.get_absolute_url())
    svg = qrcodes.svg_for(url)
    return HttpResponse(svg, content_type="image/svg+xml")


def guest_qr_png(request, slug, token):
    """نفس رمز الضيف بس PNG — عشان يتحمّل ويتبعت في واتساب.

    الـSVG أنضف للعرض، بس تطبيقات المحادثة مابتعرضهوش، والضيف بيحتاج
    صورة يحفظها في الاستديو ويوريها على الباب.
    """
    invitation = get_object_or_404(Invitation, slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404
    guest = get_object_or_404(Guest, invitation=invitation, token=(token or "").strip())
    url = request.build_absolute_uri(guest.get_absolute_url())
    png = qrcodes.png_for(url, label=guest.pass_code, caption=guest.name)
    if png is None:
        raise Http404("توليد الصور غير متاح على الخادم.")
    res = HttpResponse(png, content_type="image/png")
    res["Content-Disposition"] = (
        f'attachment; filename="{guest.pass_code or "pass"}.png"')
    return res


def guest_qr(request, slug, token):
    """رمز الضيف. بيشفّر رابطه الشخصي، فنفس الرمز بيخدم غرضين:
    الضيف يمسحه بكاميرا تليفونه فتفتحله دعوته، والاستقبال يمسحه على الباب
    فيتسجّل دخوله."""
    invitation = get_object_or_404(Invitation, slug=slug)
    if not invitation.is_live and not request.user.is_staff:
        raise Http404
    guest = get_object_or_404(Guest, invitation=invitation, token=(token or "").strip())
    url = request.build_absolute_uri(guest.get_absolute_url())
    return HttpResponse(qrcodes.svg_for(url), content_type="image/svg+xml")


@require_safe
def site_icon(request):
    """أيقونة الموقع المرفوعة من لوحة «إدارة البيانات» — ‎/site-icon.png?v=…‎ و‎/favicon.ico‎.

    لو ماترفعتش أيقونة بنحوّل للافتراضية. الرابط اللي فيه ‎v‎ بيتخزّن يوم كامل (بيتغيّر مع كل أيقونة جديدة)،
    وغيره (‎/favicon.ico‎ اللي المتصفح بيطلبه لوحده) مابيتخزّنش عشان التغيير يبان فوراً.
    """
    path = siteicon.icon_path()
    if not path.is_file():
        return HttpResponseRedirect(static("images/logo.jpeg"))
    response = HttpResponse(path.read_bytes(), content_type="image/png")  # ملف صغير: نقراه كله (مفيش مقبض مفتوح يمنع الاستبدال على ويندوز)
    response["Cache-Control"] = "public, max-age=86400" if request.GET.get("v") else "no-cache"
    return response


@require_safe
def site_logo(request, slot):
    """لوجو الموقع — ‎/site-logo/light.png‎ و‎/site-logo/dark.png‎. من غير لوجو مرفوع بنحوّل للافتراضي.

    الرابط ثابت (الـCSS وأقسام الدعاية بتكتبه)، فالرد ‎no-cache‎ مع ‎ETag‎: المتصفح بيسأل السيرفر كل مرة ويلاقي
    ‎304‎ طول ما اللوجو ماتغيّرش، ولما يتغيّر يبان فوراً.
    """
    if slot not in siteicon.LOGO_SLOTS:
        raise Http404
    path = siteicon.logo_file(slot)
    if path is None:
        return HttpResponseRedirect(static(f"images/brand-{slot}.png"))
    stat = path.stat()
    etag = f'"{int(stat.st_mtime)}-{stat.st_size}"'
    if request.headers.get("If-None-Match") == etag:
        response = HttpResponse(status=304)
    else:
        response = HttpResponse(path.read_bytes(), content_type="image/png")  # ملف صغير: نقراه كله (مفيش مقبض مفتوح يمنع الاستبدال على ويندوز)
    response["ETag"] = etag
    response["Cache-Control"] = "no-cache"
    return response
