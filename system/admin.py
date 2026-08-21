from django.contrib import admin
from django.utils.html import format_html

from .models import (
    Asset, Customer, Guest, Invitation, MusicTrack, Order, Plan, RSVPResponse,
    Template,
)


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "phone", "email", "created_at")
    search_fields = ("name", "phone", "email")


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "name_en", "price", "is_featured", "is_active", "sort_order")
    list_editable = ("is_featured", "is_active", "sort_order")
    prepopulated_fields = {"slug": ("name",)}
    fieldsets = (
        (None, {"fields": ("name", "slug", "price", "old_price", "accent",
                           "tagline", "description", "bullets")}),
        ("English", {"fields": ("name_en", "tagline_en", "description_en", "bullets_en"),
                     "description": "اتركها فارغة ليعود الموقع للنص العربي تلقائياً."}),
        ("المزايا والحدود", {"fields": ("features", "max_guests", "max_images")}),
        ("العرض", {"fields": ("is_featured", "is_active", "sort_order")}),
    )


@admin.register(Template)
class TemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "name_en", "category", "collection", "source", "is_active", "usage_count")
    list_filter = ("category", "source", "is_active")
    search_fields = ("name", "name_en", "slug")
    readonly_fields = ("usage_count",)


@admin.register(Invitation)
class InvitationAdmin(admin.ModelAdmin):
    list_display = ("title", "customer", "plan", "status", "public_views", "link")
    list_filter = ("status", "plan", "template")
    search_fields = ("title", "slug", "customer__name", "name_one", "name_two")
    raw_id_fields = ("customer",)

    @admin.display(description="الرابط")
    def link(self, obj):
        return format_html('<a href="{}" target="_blank">فتح</a>', obj.get_absolute_url())


@admin.register(Guest)
class GuestAdmin(admin.ModelAdmin):
    list_display = ("name", "invitation", "phone", "checked_in")
    list_filter = ("checked_in",)
    search_fields = ("name", "phone")


@admin.register(RSVPResponse)
class RSVPAdmin(admin.ModelAdmin):
    list_display = ("name", "invitation", "status", "companions", "created_at")
    list_filter = ("status",)
    search_fields = ("name", "phone")


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("id", "customer", "plan", "status", "event_date", "created_at")
    list_filter = ("status",)


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("original_name", "kind", "invitation", "created_at")
    list_filter = ("kind",)


@admin.register(MusicTrack)
class MusicTrackAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "order", "created_at")
    list_editable = ("is_active", "order")
    search_fields = ("name", "note")
