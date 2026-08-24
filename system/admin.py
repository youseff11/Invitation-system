from django.contrib import admin
from django.utils.html import format_html

from .models import (
        Asset, CustomFont, Customer, FavoriteBlock, Guest, Invitation, IntroVideo, MusicTrack, Order,
    OrderAddon, Plan, PlanAddon, RSVPResponse, SiteSetting, Template,

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
    list_display = ("pass_code", "name", "invitation", "source",
                    "entries_used", "entries_allowed", "checked_in")
    list_filter = ("checked_in", "source")
    search_fields = ("name", "phone", "pass_code")
    readonly_fields = ("token", "pass_code")


@admin.register(RSVPResponse)
class RSVPAdmin(admin.ModelAdmin):
    list_display = ("name", "invitation", "status", "companions", "created_at")
    list_filter = ("status",)
    search_fields = ("name", "phone")


class OrderAddonInline(admin.TabularInline):
    """إضافات الطلب بأسعارها وقت الشراء — للاطّلاع، مش للتعديل."""
    model = OrderAddon
    extra = 0
    readonly_fields = ("addon", "name", "price")
    can_delete = False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("id", "customer", "plan", "total_price", "status",
                    "event_date", "created_at")
    list_filter = ("status",)
    inlines = [OrderAddonInline]


@admin.register(PlanAddon)
class PlanAddonAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "price", "is_active", "sort_order")
    list_editable = ("price", "is_active", "sort_order")
    list_filter = ("is_active",)
    search_fields = ("name", "code")
    filter_horizontal = ("plans",)


@admin.register(SiteSetting)
class SiteSettingAdmin(admin.ModelAdmin):
    list_display = ("__str__", "preview_cta_enabled", "whatsapp_number")

    def has_add_permission(self, request):
        # سجل واحد بس — الزرار «إضافة» بيلخبط
        return not SiteSetting.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Asset)
class AssetAdmin(admin.ModelAdmin):
    list_display = ("original_name", "kind", "invitation", "created_at")
    list_filter = ("kind",)


@admin.register(MusicTrack)
class MusicTrackAdmin(admin.ModelAdmin):
    list_display = ("name", "is_active", "order", "created_at")
    list_editable = ("is_active", "order")
    search_fields = ("name", "note")




@admin.register(CustomFont)
class CustomFontAdmin(admin.ModelAdmin):
    list_display = ("name", "family", "weight", "style", "is_active", "order", "created_at")
    list_editable = ("is_active", "order")
    list_filter = ("is_active", "style", "weight")
    search_fields = ("name", "name_en", "family")


@admin.register(FavoriteBlock)
class FavoriteBlockAdmin(admin.ModelAdmin):
    list_display = ("name", "block_type", "created_by", "updated_at")
    list_filter = ("block_type",)
    search_fields = ("name", "block_type")
    readonly_fields = ("created_by", "block_type")


@admin.register(IntroVideo)
class IntroVideoAdmin(admin.ModelAdmin):

    list_display = ("name", "seconds", "is_active", "order", "created_at")
    list_editable = ("is_active", "order")
    search_fields = ("name", "note")
