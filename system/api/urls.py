from django.urls import path

from . import dashboard, dataadmin, editor, editor_assets, guests, invite, public, views

# الأساس المشترك (الجلسة، اللغة، الموقع) هنا؛ كل ميزة في ملفها وبتتجمّع تحت.
# مفيش حد بيعدّل الملف ده غير لما ميزة جديدة بتتضاف — راجع docs/react-migration.md.
urlpatterns = [
    path("csrf/", views.csrf, name="api_csrf"),
    path("me/", views.me, name="api_me"),
    path("auth/login/", views.auth_login, name="api_login"),
    path("auth/logout/", views.auth_logout, name="api_logout"),
    path("language/", views.set_language, name="api_language"),
    path("site/", views.site, name="api_site"),
    path("templates/", views.templates_list, name="api_templates"),
]
urlpatterns += public.urlpatterns
urlpatterns += dashboard.urlpatterns
urlpatterns += guests.urlpatterns
urlpatterns += invite.urlpatterns
urlpatterns += editor.urlpatterns
urlpatterns += editor_assets.urlpatterns
urlpatterns += dataadmin.urlpatterns
