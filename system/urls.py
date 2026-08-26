from django.contrib.auth import views as auth_views
from django.urls import path

from . import views

urlpatterns = [
    # ------------------------------------------------------------ عام
    path("", views.home, name="home"),
    path("templates/", views.template_gallery, name="template_gallery"),
    path("templates/<slug:slug>/preview/", views.template_demo, name="template_demo"),
    path("media-video/<path:path>", views.media_video, name="media_video"),

    # ------------------------------------------------------------ دخول
    path("login/", auth_views.LoginView.as_view(
        template_name="auth/login.html", redirect_authenticated_user=True,
    ), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),

    # ------------------------------------------------------------ لوحة التحكم
    path("dashboard/", views.dashboard, name="dashboard"),
    path("dashboard/orders/", views.dashboard_orders, name="dashboard_orders"),
        path("dashboard/templates/", views.dashboard_templates, name="dashboard_templates"),
    path("dashboard/templates/<int:pk>/editor/", views.template_editor,
         name="template_editor"),
    path("dashboard/templates/<int:pk>/preview-frame/", views.template_editor_frame,
         name="template_editor_frame"),

        path("dashboard/fonts/", views.dashboard_fonts, name="dashboard_fonts"),
    path("dashboard/fonts/api/create/", views.font_api_create, name="font_api_create"),
    path("dashboard/favorites/api/create/", views.favorite_api_create, name="favorite_api_create"),
    path("dashboard/favorites/<int:pk>/delete/", views.favorite_api_delete, name="favorite_api_delete"),
    path("dashboard/music/", views.dashboard_music, name="dashboard_music"),

    path("dashboard/intros/", views.dashboard_intros, name="dashboard_intros"),
    path("dashboard/plans/", views.dashboard_plans, name="dashboard_plans"),
    path("dashboard/site/", views.dashboard_site, name="dashboard_site"),
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
    path("dashboard/invitations/<int:pk>/guests/export.xlsx", views.guests_export,
         name="guests_export"),
    path("dashboard/invitations/<int:pk>/checkin/", views.checkin_scanner, name="checkin"),
    path("dashboard/invitations/<int:pk>/checkin/scan/", views.checkin_scan,
         name="checkin_scan"),
    path("dashboard/guests/sample.csv", views.guests_sample_csv, name="guests_sample_csv"),
    path("dashboard/guests/<int:pk>/toggle-checkin/", views.guest_toggle_checkin,
         name="guest_toggle_checkin"),

        # ------------------------------------------------------------ محرر القوالب للأدمن
    path("dashboard/templates/<int:pk>/api/preview/", views.template_api_preview,
         name="template_api_preview"),
    path("dashboard/templates/<int:pk>/api/save/", views.template_api_save,
         name="template_api_save"),
    path("dashboard/templates/<int:pk>/api/upload/", views.template_api_upload,
         name="template_api_upload"),
    path("dashboard/templates/<int:pk>/api/assets/", views.template_api_assets,
         name="template_api_assets"),
    path("dashboard/templates/<int:pk>/api/assets/delete/", views.template_api_delete_asset,
         name="template_api_delete_asset"),
    path("dashboard/templates/<int:pk>/api/assets/bulk-delete/", views.template_api_delete_assets,
         name="template_api_delete_assets"),

    # ------------------------------------------------------------ واجهة المحرر

    path("dashboard/invitations/<int:pk>/api/preview/", views.api_preview, name="api_preview"),
    path("dashboard/invitations/<int:pk>/api/save/", views.api_save, name="api_save"),
    path("dashboard/invitations/<int:pk>/api/upload/", views.api_upload, name="api_upload"),
        path("dashboard/invitations/<int:pk>/api/assets/", views.api_assets, name="api_assets"),
    path("dashboard/invitations/<int:pk>/api/assets/delete/", views.api_delete_asset,
         name="api_delete_asset"),
    path("dashboard/invitations/<int:pk>/api/assets/bulk-delete/", views.api_delete_assets,
         name="api_delete_assets"),

    path("dashboard/invitations/<int:pk>/api/crop/", views.api_crop, name="api_crop"),
    path("dashboard/invitations/<int:pk>/api/save-template/", views.api_save_as_template,
         name="api_save_as_template"),

    # ------------------------------------------------------------ الدعوة
    path("i/<slug:slug>/", views.invitation_public, name="invitation_public"),
    path("i/<slug:slug>/rsvp/", views.invitation_rsvp, name="invitation_rsvp"),
    path("i/<slug:slug>/client/<str:token>/", views.invitation_client_followup,
         name="invitation_client_followup"),
    # الرابط الشخصي للضيف — الرمز هو بيانات الاعتماد
    path("i/<slug:slug>/g/<str:token>/", views.invitation_guest, name="invitation_guest"),
    path("i/<slug:slug>/qr.svg", views.invitation_qr, name="invitation_qr"),
    path("i/<slug:slug>/g/<str:token>/qr.svg", views.guest_qr, name="guest_qr"),
    path("i/<slug:slug>/g/<str:token>/qr.png", views.guest_qr_png, name="guest_qr_png"),
    path("i/<slug:slug>/g/<str:token>/pass/", views.guest_pass, name="guest_pass"),
]
