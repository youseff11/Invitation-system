from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    # مبدّل اللغة (set_language) — يحفظ الاختيار في الجلسة والكوكي
    path('i18n/', include('django.conf.urls.i18n')),
    path('', include('system.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
