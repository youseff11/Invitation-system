"""النماذج."""

from __future__ import annotations

import re

from django import forms
from django.utils.text import slugify

from . import blocks as blocks_engine

from . import video
from .models import (
        CustomFont, Customer, Guest, Invitation, IntroVideo, MusicTrack, Order,
    OrderAddon, Plan, PlanAddon, SiteSetting, Template,

)


class OrderForm(forms.ModelForm):
    customer_name = forms.CharField(label="الاسم الكامل", max_length=120)
    customer_phone = forms.CharField(label="رقم واتساب", max_length=40)
    customer_email = forms.EmailField(label="البريد الإلكتروني", required=False)

    class Meta:
        model = Order
        fields = ["template", "plan", "event_type", "event_date", "names", "message"]
        widgets = {
            "event_date": forms.DateInput(attrs={"type": "date"}),
            "message": forms.Textarea(attrs={"rows": 3}),
        }

    addons = forms.ModelMultipleChoiceField(
        label="إضافات اختيارية", required=False,
        queryset=PlanAddon.objects.none(),
        widget=forms.CheckboxSelectMultiple,
    )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["template"].queryset = Template.objects.filter(is_active=True)
        self.fields["template"].required = False
        self.fields["plan"].queryset = Plan.objects.filter(is_active=True)
        # الحقلين دول مالهمش verbose_name في الموديل، فكانوا بيطلعوا
        # «Template» و«Plan» بالإنجليزي وسط فورم كله عربي
        self.fields["template"].label = "القالب"
        self.fields["plan"].label = "الباقة"
        self.fields["addons"].queryset = (
            PlanAddon.objects.filter(is_active=True).prefetch_related("plans")
        )

    def clean(self):
        """الإضافة المربوطة بباقات معيّنة ماتنفعش مع باقة تانية.

        الفلترة في المتصفح مش كفاية — الفورم بيتبعت من غير جافاسكربت
        كمان، وده أول مكان حد يجرّب يلعب فيه.
        """
        data = super().clean()
        plan = data.get("plan")
        chosen = data.get("addons")
        if plan and chosen:
            bad = [a.name for a in chosen if not a.available_for(plan)]
            if bad:
                self.add_error(
                    "addons",
                    "الإضافات دي مش متاحة مع الباقة المختارة: " + "، ".join(bad),
                )
        return data

    def save(self, commit=True):
        order = super().save(commit=False)
        phone = self.cleaned_data["customer_phone"]
        customer = Customer.objects.filter(phone=phone).first() if phone else None
        if not customer:
            customer = Customer.objects.create(
                name=self.cleaned_data["customer_name"],
                phone=phone,
                email=self.cleaned_data.get("customer_email", ""),
            )
        order.customer = customer
        if commit:
            order.save()
            # السعر والاسم بيتصوّروا هنا: تغيير سعر الإضافة بعدين
            # مايعيدش كتابة الطلب ده
            for addon in self.cleaned_data.get("addons") or []:
                OrderAddon.objects.create(
                    order=order, addon=addon, name=addon.name, price=addon.price,
                )
        return order


class InvitationSettingsForm(forms.ModelForm):
    """بيانات المناسبة التي يحرّرها المحرر — تُحفظ عبر واجهة JSON."""

    class Meta:
        model = Invitation
        fields = [
            "title", "event_type", "name_one", "name_two", "event_date",
            "venue", "address", "map_url", "whatsapp", "status",
            "expires_at", "password",
        ]
        widgets = {
            "event_date": forms.DateTimeInput(attrs={"type": "datetime-local"},
                                              format="%Y-%m-%dT%H:%M"),
            "expires_at": forms.DateTimeInput(attrs={"type": "datetime-local"},
                                              format="%Y-%m-%dT%H:%M"),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        for name in ("title", "name_one", "name_two", "venue", "address", "map_url",
                     "whatsapp", "password", "expires_at", "event_date"):
            self.fields[name].required = False


class GuestForm(forms.ModelForm):
    class Meta:
        model = Guest
        fields = ["name", "phone", "group_name", "plus_ones_allowed", "note"]
        widgets = {"plus_ones_allowed": forms.NumberInput(attrs={"min": 0, "max": 20})}


class TemplateForm(forms.ModelForm):
    # مسار Django من نوع slug يقبل الحروف اللاتينية فقط، بينما أسماء
    # القوالب عندنا غالباً عربية. نخلي الحقل نصياً ونحوّله إلى slug صالح
    # تلقائياً؛ ولو كانت القيمة عربية بالكامل نرجعها فارغة ليولّد Template.save()
    # رابطاً افتراضياً بدلاً من رفض نموذج الإنشاء بصمت.
    slug = forms.CharField(label="الرابط المختصر", required=False, max_length=140)

    class Meta:

        model = Template
        fields = ["name", "slug", "category", "collection", "description",
                  "cover_image", "cover_url", "is_active", "sort_order"]
        widgets = {"description": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["slug"].required = False
        # صفحة إنشاء القالب لا تعرض إعدادات الإدارة؛ نضع قيمها الافتراضية
        # في الـview بدلاً من رفض POST ناقص بسبب حقول غير ظاهرة للمستخدم.
        self.fields["is_active"].required = False
        self.fields["sort_order"].required = False

    def clean_slug(self):
        value = (self.cleaned_data.get("slug") or "").strip()
        return slugify(value, allow_unicode=False)[:140]




class CustomFontForm(forms.ModelForm):
    """رفع خط صالح للاستخدام داخل CSS والمعاينة."""

    ALLOWED_EXTENSIONS = {"ttf", "otf", "woff", "woff2"}
    MAX_BYTES = 8 * 1024 * 1024

    class Meta:
        model = CustomFont
        fields = [
            "name", "name_en", "family", "file", "external_url",
            "weight", "style", "is_active", "order",
        ]
        widgets = {
            "file": forms.ClearableFileInput(
                attrs={"accept": ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"}
            ),
            "external_url": forms.URLInput(attrs={"placeholder": "https://.../font.woff2"}),
            "weight": forms.NumberInput(attrs={"min": 100, "max": 900, "step": 100}),
        }

    def clean(self):
        data = super().clean()
        if not data.get("file") and not data.get("external_url"):
            raise forms.ValidationError("ارفع ملف خط أو ضع رابطاً مباشراً.")
        return data

    def clean_family(self):
        family = (self.cleaned_data.get("family") or "").strip()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9 _-]{0,119}", family):
            raise forms.ValidationError(
                "اسم العائلة لازم يبدأ بحرف إنجليزي ويحتوي حروفاً أو أرقاماً أو مسافات أو - فقط."
            )
        return family

    def clean_weight(self):
        weight = self.cleaned_data.get("weight")
        if weight is None or not 100 <= weight <= 900 or weight % 100:
            raise forms.ValidationError("الوزن لازم يكون من 100 إلى 900 بمضاعفات 100.")
        return weight

    def clean_file(self):
        f = self.cleaned_data.get("file")
        if not f:
            return f
        suffix = str(f.name).lower().rsplit(".", 1)[-1] if "." in str(f.name) else ""
        if suffix not in self.ALLOWED_EXTENSIONS:
            raise forms.ValidationError("امتداد الخط المسموح: TTF أو OTF أو WOFF أو WOFF2.")
        if f.size > self.MAX_BYTES:
            raise forms.ValidationError("حجم ملف الخط أكبر من ٨ ميجابايت.")
        return f


class MusicTrackForm(forms.ModelForm):

    """رفع مقطوعة للمكتبة المشتركة.

    الملف أو الرابط — واحد منهم كفاية، بس لازم واحد على الأقل، وإلا هتبقى
    مقطوعة بلا صوت في القائمة.
    """

    class Meta:
        model = MusicTrack
        fields = ["name", "file", "external_url", "note", "is_active", "order"]
        widgets = {
            "file": forms.ClearableFileInput(attrs={"accept": "audio/*"}),
            "external_url": forms.URLInput(attrs={"placeholder": "https://.../song.mp3"}),
        }

    def clean(self):
        data = super().clean()
        if not data.get("file") and not data.get("external_url"):
            raise forms.ValidationError("ارفع ملفاً صوتياً أو ضع رابطاً مباشراً.")
        return data

    def clean_file(self):
        f = self.cleaned_data.get("file")
        if f and f.size > 8 * 1024 * 1024:
            raise forms.ValidationError("حجم الملف أكبر من ٨ ميجابايت.")
        return f


class IntroVideoForm(forms.ModelForm):
    """رفع فيديو افتتاحية للمكتبة المشتركة."""

    class Meta:
        model = IntroVideo
        fields = ["name", "file", "poster", "external_url", "note",
                  "is_active", "order"]
        widgets = {
            "file": forms.ClearableFileInput(attrs={"accept": "video/mp4,video/webm"}),
            "poster": forms.ClearableFileInput(attrs={"accept": "image/*"}),
            "external_url": forms.URLInput(attrs={"placeholder": "https://.../intro.mp4"}),
        }

    def clean(self):
        data = super().clean()
        if not data.get("file") and not data.get("external_url"):
            raise forms.ValidationError("ارفع ملف فيديو أو ضع رابطاً مباشراً.")
        return data

    def clean_file(self):
        f = self.cleaned_data.get("file")
        cap = video.MAX_UPLOAD_BYTES
        if f and f.size > cap:
            mb = str(cap // (1024 * 1024)).translate(
                str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩"))
            raise forms.ValidationError(f"حجم الفيديو أكبر من {mb} ميجابايت.")
        return f


class PlanAddonForm(forms.ModelForm):
    """إضافة بسعر زيادة فوق الباقة."""

    class Meta:
        model = PlanAddon
        fields = ["name", "name_en", "code", "price", "description",
                  "plans", "is_active", "sort_order"]
        widgets = {
            "plans": forms.CheckboxSelectMultiple,
            "description": forms.TextInput(attrs={"placeholder": "سطر يشرح الإضافة للعميل"}),
            "code": forms.TextInput(attrs={"placeholder": "music / rsvp / gallery …"}),
        }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["plans"].queryset = Plan.objects.filter(is_active=True)
        self.fields["plans"].required = False

    def clean_code(self):
        """مفتاح ميزة غلط بيبقى إضافة بتتباع ومابتفتحش حاجة.

        بنرفضه هنا بدل ما العميل يدفع ويكتشف إن مفيش فرق.
        """
        code = (self.cleaned_data.get("code") or "").strip().lower()
        if not code:
            return ""
        known = blocks_engine.feature_keys()
        if code not in known:
            raise forms.ValidationError(
                "مفتاح ميزة مش معروف. المتاح: " + "، ".join(sorted(known))
            )
        return code


class SiteSettingForm(forms.ModelForm):
    class Meta:
        model = SiteSetting
        # الترتيب مقصود: الطلبات ورقم الواتساب فوق — دول اللي بيتغيّروا،
        # ونصوص شريط المعاينة تحت.
        fields = [
            "orders_enabled",
            "whatsapp_enabled", "whatsapp_number",
            "whatsapp_float_enabled", "whatsapp_cta_message",
            "preview_cta_enabled", "preview_cta_text", "whatsapp_message",
            "facebook_enabled", "facebook_url",
            "instagram_enabled", "instagram_url",
        ]
        widgets = {
            "whatsapp_number": forms.TextInput(attrs={"placeholder": "+201559403203",
                                                      "dir": "ltr"}),
            "facebook_url": forms.URLInput(attrs={"placeholder": "https://facebook.com/…",
                                                  "dir": "ltr"}),
            "instagram_url": forms.URLInput(attrs={"placeholder": "https://instagram.com/…",
                                                    "dir": "ltr"}),
        }
