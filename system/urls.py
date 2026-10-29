"""مسارات التحويل النهائي (Phase D): React على الجذر والموقع القديم مش مسجّل.

بتتفعّل لما ‎SPA_BASENAME‎ يكون فاضي (‎SPA_BASENAME=‎ في البيئة). الفكرة:

* الصفحات كلها بتتقدّم من React (‎spa_shell‎ / ‎invite_page‎) على نفس المسارات القديمة بالظبط —
  فروابط الدعوات اللي اتبعتت (الضيف، العميل، القاعة، التصريح) وروابط QR المطبوعة بتفضل شغّالة.
* اللي مش صفحات (QR، الصور، ‎robots‎، ‎sitemap‎، فيديو المشاركة) بيفضل بيتقدّم من Django.
* الأسماء القديمة (‎invitation_public‎، ‎template_demo‎ …) بتفضل موجودة عشان ‎reverse()‎ في الـmodels
  والـAPI يرجّع نفس الروابط من غير تغيير.
* أي رابط قديم تحت ‎/app/‎ بيتحوّل (301) للمسار الجذري (مفعّل بس لو ‎SPA_BASENAME‎ فاضي).
"""

from django.conf import settings
from django.http import HttpResponsePermanentRedirect
from django.urls import path, re_path

from . import files
from .api import invite_page
from .spa import spa_shell


def app_prefix_redirect(request, rest=""):
    """‎/app/i/x/‎ → ‎/i/x/‎ (روابط اتحفظت أو اتشاركت أثناء الترحيل)."""
    query = request.META.get("QUERY_STRING")
    return HttpResponsePermanentRedirect("/" + rest + (f"?{query}" if query else ""))


urlpatterns = [

    # ---- ملفات مش صفحات: Django بيقدّمها زي ما هي
    path("robots.txt", files.robots_txt, name="robots_txt"),
    path("sitemap.xml", files.sitemap_xml, name="sitemap_xml"),
    path("site-icon.png", files.site_icon, name="site_icon"),
    path("site-logo/<str:slot>.png", files.site_logo, name="site_logo"),
    path("favicon.ico", files.site_icon, name="favicon"),
    path("media-video/<path:path>", files.media_video, name="media_video"),
    path("share-image/<path:path>", files.share_image, name="share_image"),
    path("i/<slug:slug>/qr.svg", files.invitation_qr, name="invitation_qr"),
    path("i/<slug:slug>/g/<str:token>/qr.svg", files.guest_qr, name="guest_qr"),
    path("i/<slug:slug>/g/<str:token>/qr.png", files.guest_qr_png, name="guest_qr_png"),
    # الاسم بيتعمله ‎reverse‎ في ‎renderer‎؛ الإرسال الفعلي بقى ‎POST /api/v1/invitations/<slug>/rsvp/‎
    path("i/<slug:slug>/rsvp/", spa_shell, name="invitation_rsvp"),

    # ---- صفحات: نفس الأسماء والمسارات القديمة، والمحتوى من React
    path("i/<slug:slug>/", invite_page.invitation_page, name="invitation_public"),
    path("i/<slug:slug>/g/<str:token>/", invite_page.invitation_page, name="invitation_guest"),
    path("templates/<slug:slug>/preview/", invite_page.template_page, name="template_demo"),
    path("i/<slug:slug>/client/<str:token>/", spa_shell, name="invitation_client_followup"),
    path("i/<slug:slug>/venue/<str:token>/", spa_shell, name="invitation_venue"),
    path("i/<slug:slug>/g/<str:token>/pass/", spa_shell, name="guest_pass"),
    path("templates/", spa_shell, name="template_gallery"),
    path("login/", spa_shell, name="login"),
    path("dashboard/", spa_shell, name="dashboard"),
    path("", spa_shell, name="home"),
]

if not settings.SPA_BASENAME:
    urlpatterns[:0] = [
        re_path(r"^app/(?P<rest>.*)$", app_prefix_redirect),
        re_path(r"^app$", app_prefix_redirect),
    ]
