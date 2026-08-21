"""النماذج."""

from __future__ import annotations

from django import forms

from .models import Customer, Guest, Invitation, MusicTrack, Order, Plan, Template


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

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["template"].queryset = Template.objects.filter(is_active=True)
        self.fields["template"].required = False
        self.fields["plan"].queryset = Plan.objects.filter(is_active=True)

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
    class Meta:
        model = Template
        fields = ["name", "slug", "category", "collection", "description",
                  "cover_image", "cover_url", "is_active", "sort_order"]
        widgets = {"description": forms.Textarea(attrs={"rows": 3})}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["slug"].required = False


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
