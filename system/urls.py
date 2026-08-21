from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

urlpatterns = [
    # ------------------------------------------------------------ عام
    path("", views.home, name="home"),
    path("templates/", views.template_gallery, name="template_gallery"),
    path("templates/<slug:slug>/preview/", views.template_demo, name="template_demo"),

    # ------------------------------------------------------------ دخول
    path("login/", auth_views.LoginView.as_view(
        template_name="auth/login.html", redirect_authenticated_user=True,
    ), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),

    # ------------------------------------------------------------ لوحة التحكم
    path("dashboard/", views.dashboard, name="dashboard"),
    path("dashboard/orders/", views.dashboard_orders, name="dashboard_orders"),
    path("dashboard/templates/", views.dashboard_templates, name="dashboard_templates"),
    path("dashboard/music/", views.dashboard_music, name="dashboard_music"),
    path("dashboard/analytics/", views.analytics, name="analytics"),
    path("dashboard/invitations/", views.dashboard_invitations, name="dashboard_invitations"),
    path("dashboard/invitations/new/", views.invitation_create, name="invitation_create"),
    path("dashboard/invitations/<int:pk>/editor/", views.invitation_editor,
         name="invitation_editor"),
    path("dashboard/invitations/<int:pk>/preview-frame/", views.invitation_preview_frame,
         name="invitation_preview_frame"),
    path("dashboard/invitations/<int:pk>/guests/", views.guests_view, name="guests"),
    path("dashboard/invitations/<int:pk>/guests/qr-sheet/", views.guest_qr_sheet,
         name="guest_qr_sheet"),
    path("dashboard/invitations/<int:pk>/checkin/", views.checkin_scanner, name="checkin"),
    path("dashboard/invitations/<int:pk>/checkin/scan/", views.checkin_scan,
         name="checkin_scan"),
    path("dashboard/guests/sample.csv", views.guests_sample_csv, name="guests_sample_csv"),
    path("dashboard/guests/<int:pk>/toggle-checkin/", views.guest_toggle_checkin,
         name="guest_toggle_checkin"),

    # ------------------------------------------------------------ واجهة المحرر
    path("dashboard/invitations/<int:pk>/api/preview/", views.api_preview, name="api_preview"),
    path("dashboard/invitations/<int:pk>/api/save/", views.api_save, name="api_save"),
    path("dashboard/invitations/<int:pk>/api/upload/", views.api_upload, name="api_upload"),
    path("dashboard/invitations/<int:pk>/api/assets/", views.api_assets, name="api_assets"),
    path("dashboard/invitations/<int:pk>/api/crop/", views.api_crop, name="api_crop"),
    path("dashboard/invitations/<int:pk>/api/save-template/", views.api_save_as_template,
         name="api_save_as_template"),

    # ------------------------------------------------------------ الدعوة
    path("i/<slug:slug>/", views.invitation_public, name="invitation_public"),
    path("i/<slug:slug>/rsvp/", views.invitation_rsvp, name="invitation_rsvp"),
    # الرابط الشخصي للضيف — الرمز هو بيانات الاعتماد
    path("i/<slug:slug>/g/<str:token>/", views.invitation_guest, name="invitation_guest"),
    path("i/<slug:slug>/qr.svg", views.invitation_qr, name="invitation_qr"),
    path("i/<slug:slug>/g/<str:token>/qr.svg", views.guest_qr, name="guest_qr"),
]
