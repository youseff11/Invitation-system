import re

from django.contrib import admin
from django.urls import include, path, re_path
from django.conf import settings

from system import files
from system.api import invite_page
from system.api.editor_page import editor_frame
from system.spa import spa_shell

urlpatterns = [
    path('admin/', admin.site.urls),
    # مبدّل اللغة (set_language) — يحفظ الاختيار في الجلسة والكوكي
    path('i18n/', include('django.conf.urls.i18n')),
    # واجهة JSON لتطبيق React
    path('api/v1/', include('system.api.urls')),
    # إطار معاينة محرر React (iframe) — مسار ثابت على الجذر
    path('editor-frame/', editor_frame, name='editor_frame'),
    path('', include('system.urls')),
]

# تطبيق React: كل ما تحت SPA_BASENAME بيرجّع الـshell والـrouter بيكمّل.
# BASENAME فاضي = الجذر نفسه (‎_prefix‎ فاضي والمسارات من غير ‎app/‎).
_prefix = re.escape(settings.SPA_BASENAME.strip("/"))
_root = f"{_prefix}/" if _prefix else ""
# صفحات الدعوة ليها entry خفيف خاص بيها (من غير لوحة التحكم) و<head> بيتبني
# على السيرفر للمعاينة (OG). لازم تتسجّل **قبل** الـcatch-all تحت.
urlpatterns += [
    re_path(rf"^{_root}i/(?P<slug>[-\w]+)/?$",
            invite_page.invitation_page, name="spa_invite"),
    re_path(rf"^{_root}i/(?P<slug>[-\w]+)/g/(?P<token>[^/]+)/?$",
            invite_page.invitation_page, name="spa_invite_guest"),
    re_path(rf"^{_root}templates/(?P<slug>[-\w]+)/preview/?$",
            invite_page.template_page, name="spa_template_preview"),
]

# ملفات الوسائط لازم قبل الـcatch-all (وإلا ‎/media/…‎ يرجّع الـshell). في الإنتاج الاستضافة
# المفروض تقدّمها هي (Static files mapping)؛ ده شبكة أمان لو المسار ناقص أو غلط عندها.
urlpatterns.append(re_path(rf"^{re.escape(settings.MEDIA_URL.strip('/'))}/(?P<path>.*)$", files.media_file))

urlpatterns.append(re_path(rf"^{_prefix}(?:/.*)?$" if _prefix else r"^.*$", spa_shell, name="spa"))
