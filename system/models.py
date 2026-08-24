"""نماذج البيانات لمنصة "فرحة"."""

from __future__ import annotations

import secrets
import uuid
from decimal import Decimal
from urllib.parse import quote

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.urls import reverse
from django.utils import timezone
from django.utils.text import slugify
from django.utils.translation import get_language

from . import blocks as blocks_engine


def _pick(ar: str, en: str) -> str:
    """يرجّع النص الإنجليزي وقت تفعيل الإنجليزية لو كان متوفّراً، وإلا العربي."""
    if (get_language() or "").startswith("en") and (en or "").strip():
        return en
    return ar


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# --------------------------------------------------------------------------
class Customer(TimeStampedModel):
    name = models.CharField("الاسم", max_length=120)
    email = models.EmailField("البريد الإلكتروني", blank=True)
    phone = models.CharField("رقم الهاتف", max_length=40, blank=True, db_index=True)
    notes = models.TextField("ملاحظات", blank=True)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="customer_profile",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "عميل"
        verbose_name_plural = "العملاء"

    def __str__(self) -> str:
        return self.name


# --------------------------------------------------------------------------
class Plan(TimeStampedModel):
    name = models.CharField("الاسم", max_length=80)
    slug = models.SlugField("المعرّف", unique=True)
    price = models.DecimalField("السعر", max_digits=10, decimal_places=2, default=0)
    old_price = models.DecimalField(
        "السعر قبل الخصم", max_digits=10, decimal_places=2, null=True, blank=True
    )
    accent = models.CharField("لون الباقة", max_length=20, default="#b8914f")
    tagline = models.CharField("سطر تعريفي", max_length=160, blank=True)
    description = models.TextField("الوصف", blank=True)
    bullets = models.JSONField("النقاط المعروضة", default=list, blank=True)

    # نسخة إنجليزية اختيارية — لو فاضية بيرجع للعربي تلقائياً
    name_en = models.CharField("الاسم (EN)", max_length=80, blank=True)
    tagline_en = models.CharField("سطر تعريفي (EN)", max_length=160, blank=True)
    description_en = models.TextField("الوصف (EN)", blank=True)
    bullets_en = models.JSONField("النقاط المعروضة (EN)", default=list, blank=True)
    features = models.JSONField(
        "المزايا المفعّلة", default=list, blank=True,
        help_text="مفاتيح المزايا التي تتيحها الباقة (rsvp, countdown, gallery ...)",
    )
    max_guests = models.PositiveIntegerField("أقصى عدد ضيوف", default=0,
                                             help_text="صفر = بلا حد")
    max_images = models.PositiveIntegerField("أقصى عدد صور", default=0)
    is_featured = models.BooleanField("باقة مميّزة", default=False)
    is_active = models.BooleanField("مفعّلة", default=True)
    sort_order = models.PositiveIntegerField("الترتيب", default=0)

    class Meta:
        ordering = ["sort_order", "price"]
        verbose_name = "باقة"
        verbose_name_plural = "الباقات والأسعار"

    def __str__(self) -> str:
        return self.name

    @property
    def feature_set(self) -> set[str]:
        return {str(f) for f in (self.features or [])}

    # ---- العرض ثنائي اللغة ----
    @property
    def display_name(self) -> str:
        return _pick(self.name, self.name_en)

    @property
    def display_tagline(self) -> str:
        return _pick(self.tagline, self.tagline_en)

    @property
    def display_description(self) -> str:
        return _pick(self.description, self.description_en)

    @property
    def display_bullets(self) -> list:
        en = self.bullets_en or []
        if (get_language() or "").startswith("en") and en:
            return en
        return self.bullets or []


# --------------------------------------------------------------------------
class Template(TimeStampedModel):
    """قالب دعوة — مستند blocks كامل قابل للتعديل في المحرر."""

    CATEGORY_CHOICES = [
        ("wedding", "زفاف"),
        ("engagement", "خطوبة"),
        ("henna", "حنة"),
        ("katb_ketab", "كتب كتاب"),
        ("birthday", "عيد ميلاد"),
        ("graduation", "تخرّج"),
        ("aqiqah", "عقيقة"),
        ("corporate", "مناسبة عمل"),
        ("other", "أخرى"),
    ]
    SOURCE_CHOICES = [
        ("builtin", "مدمج"),
        ("editor", "محفوظ من المحرر"),
        ("import", "مستورد"),
    ]

    name = models.CharField("الاسم", max_length=120)
    slug = models.SlugField("المعرّف", unique=True, max_length=140)
    category = models.CharField("التصنيف", max_length=30,
                                choices=CATEGORY_CHOICES, default="wedding")
    collection = models.CharField("المجموعة", max_length=40, default="Premium")
    description = models.TextField("الوصف", blank=True)

    # نسخة إنجليزية اختيارية — لو فاضية بيرجع للعربي تلقائياً
    name_en = models.CharField("الاسم (EN)", max_length=120, blank=True)
    description_en = models.TextField("الوصف (EN)", blank=True)

    cover_image = models.ImageField("صورة الغلاف", upload_to="template_covers/%Y/%m/",
                                    blank=True, null=True)
    cover_url = models.URLField("رابط صورة الغلاف", blank=True)

    document = models.JSONField("مستند القالب", default=blocks_engine.empty_document,
                                blank=True)
    # ناتج الرندر الجاهز للمعاينة، يُعاد بناؤه تلقائياً لو تغيّر المستند.
    preview_render = models.JSONField("نسخة المعاينة الجاهزة", default=dict,
                                      blank=True, editable=False)

    source = models.CharField("المصدر", max_length=20,

                              choices=SOURCE_CHOICES, default="editor")
    source_file = models.FileField("الملف الأصلي", upload_to="template_sources/%Y/%m/",
                                   blank=True, null=True)

    required_features = models.JSONField("المزايا التي يحتاجها", default=list, blank=True)
    is_active = models.BooleanField("معروض للعملاء", default=True)
    sort_order = models.PositiveIntegerField("الترتيب", default=0)
    usage_count = models.PositiveIntegerField("عدد مرات الاستخدام", default=0)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name="templates_created")

    class Meta:
        ordering = ["sort_order", "-created_at"]
        verbose_name = "قالب"
        verbose_name_plural = "القوالب"

    def __str__(self) -> str:
        return self.name

    # ---- العرض ثنائي اللغة ----
    @property
    def display_name(self) -> str:
        return _pick(self.name, self.name_en)

    @property
    def display_description(self) -> str:
        return _pick(self.description, self.description_en)

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name, allow_unicode=False) or "template"
            slug = base
            i = 2
            while Template.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base}-{i}"
                i += 1
            self.slug = slug[:140]
        super().save(*args, **kwargs)

    @property
    def cover_src(self) -> str:
        if self.cover_image:
            return self.cover_image.url
        return self.cover_url or ""

    def get_document(self) -> dict:
        return blocks_engine.normalize_document(self.document)


# --------------------------------------------------------------------------
def _asset_path(instance, filename: str) -> str:
    return f"assets/{timezone.now():%Y/%m}/{uuid.uuid4().hex[:12]}/{filename}"


class Asset(TimeStampedModel):
    """صورة أو ملف مرفوع يُستخدم داخل الدعوات والقوالب."""

    KIND_CHOICES = [("image", "صورة"), ("audio", "صوت"),
                    ("video", "فيديو"), ("other", "أخرى")]

    file = models.FileField("الملف", upload_to=_asset_path)
    thumb = models.FileField("مصغّرة", upload_to=_asset_path, blank=True, null=True)
    # النسخة الأصلية بتتحفظ عشان القص يفضل غير هدّام — تقدر تعيد القص
    # من الأصل أي وقت من غير ما تفقد جودة.
    source = models.FileField("الأصل", upload_to=_asset_path, blank=True, null=True)
    kind = models.CharField("النوع", max_length=10, choices=KIND_CHOICES, default="image")
    original_name = models.CharField("الاسم الأصلي", max_length=200, blank=True)
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    size_bytes = models.PositiveBigIntegerField(default=0)
    invitation = models.ForeignKey("Invitation", on_delete=models.CASCADE,
                                   null=True, blank=True, related_name="assets")
    template = models.ForeignKey(Template, on_delete=models.CASCADE,
                                 null=True, blank=True, related_name="assets")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name="assets")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "ملف"
        verbose_name_plural = "الملفات"

    def __str__(self) -> str:
        return self.original_name or self.file.name

    @property
    def url(self) -> str:
        return self.file.url if self.file else ""

    @property
    def thumb_url(self) -> str:
        return self.thumb.url if self.thumb else self.url

    @property
    def source_url(self) -> str:
        """الأصل لو محفوظ، وإلا الملف المعروض — بيستخدمه القص."""
        return self.source.url if self.source else self.url


# --------------------------------------------------------------------------
class Invitation(TimeStampedModel):
    STATUS_CHOICES = [
        ("draft", "مسودة"),
        ("review", "بانتظار المراجعة"),
        ("published", "منشورة"),
        ("archived", "مؤرشفة"),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE,
                                 related_name="invitations")
    template = models.ForeignKey(Template, on_delete=models.PROTECT,
                                 related_name="invitations")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="invitations")

    title = models.CharField("عنوان داخلي", max_length=180, blank=True)
    slug = models.SlugField("الرابط", unique=True, blank=True, max_length=60)

    status = models.CharField("الحالة", max_length=20,
                              choices=STATUS_CHOICES, default="draft", db_index=True)

    # بيانات المناسبة — مصدر الحقيقة الذي تتغذى منه البلوكات تلقائياً
    event_type = models.CharField("نوع المناسبة", max_length=40, default="زفاف")
    name_one = models.CharField("الاسم الأول", max_length=120, default="")
    name_two = models.CharField("الاسم الثاني", max_length=120, blank=True, default="")
    event_date = models.DateTimeField("تاريخ ووقت المناسبة", null=True, blank=True)
    venue = models.CharField("اسم القاعة", max_length=180, blank=True)
    address = models.CharField("العنوان", max_length=250, blank=True)
    map_url = models.URLField("رابط الخريطة", blank=True)
    whatsapp = models.CharField("رقم واتساب", max_length=40, blank=True)

    document = models.JSONField("مستند الدعوة", default=blocks_engine.empty_document,
                                blank=True)

    expires_at = models.DateTimeField("ينتهي في", null=True, blank=True)
    password = models.CharField("كلمة سر الدعوة", max_length=64, blank=True,
                                help_text="اتركها فارغة لدعوة مفتوحة")

    public_views = models.PositiveIntegerField("عدد المشاهدات", default=0)
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "دعوة"
        verbose_name_plural = "الدعوات"
        indexes = [models.Index(fields=["status", "-created_at"])]

    def __str__(self) -> str:
        return self.title or self.slug

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:12].lower()
        if not self.title:
            names = " و ".join(n for n in [self.name_one, self.name_two] if n)
            self.title = names or f"دعوة {self.slug}"
        if self.status == "published" and not self.published_at:
            self.published_at = timezone.now()
        super().save(*args, **kwargs)

    def get_absolute_url(self) -> str:
        return reverse("invitation_public", kwargs={"slug": self.slug})

    def get_document(self) -> dict:
        return blocks_engine.normalize_document(self.document)

    @property
    def is_live(self) -> bool:
        if self.status != "published":
            return False
        if self.expires_at and self.expires_at < timezone.now():
            return False
        return True

    @property
    def allowed_features(self) -> set[str]:
        """مزايا الباقة + أي مزايا اتشترت كإضافات في الطلب.

        من غير الجزء التاني، حد يدفع في إضافة «موسيقى» فوق باقة
        مافيهاش موسيقى ما كانش هياخد حاجة — ولا حد كان هيلاحظ.
        """
        features = set(self.plan.feature_set)
        order = getattr(self, "order", None)
        if order is not None:
            features |= order.addon_features
        return features

    @property
    def attending_count(self) -> int:
        return self.rsvps.filter(status="attending").count()

    @property
    def total_attending_people(self) -> int:
        agg = self.rsvps.filter(status="attending").aggregate(
            total=models.Sum("companions")
        )
        return self.attending_count + (agg["total"] or 0)


# --------------------------------------------------------------------------
class MusicTrack(TimeStampedModel):
    """مكتبة الموسيقى — تُرفع مرة وتُختار في أي دعوة جديدة.

    منفصلة عن Asset عن قصد: دي مكتبة منسّقة بأسماء عربية وترتيب عرض،
    مش ملفات مرفوعة لدعوة بعينها.
    """

    name = models.CharField("الاسم", max_length=120)
    file = models.FileField("الملف", upload_to="music/%Y/%m/", blank=True)
    external_url = models.URLField("رابط خارجي", blank=True,
                                   help_text="بديل للرفع — رابط مباشر لملف صوتي.")
    note = models.CharField("ملاحظة", max_length=200, blank=True)
    is_active = models.BooleanField("متاحة للاختيار", default=True)
    order = models.PositiveIntegerField("الترتيب", default=0)

    class Meta:
        ordering = ["order", "name"]
        verbose_name = "مقطوعة موسيقية"
        verbose_name_plural = "مكتبة الموسيقى"

    def __str__(self) -> str:
        return self.name

    @property
    def url(self) -> str:
        if self.file:
            return self.file.url
        return self.external_url or ""




# --------------------------------------------------------------------------
class CustomFont(TimeStampedModel):
    """خط مرفوع أو مرتبط برابط مباشر لاستخدامه في الدعوات والقوالب."""

    STYLE_CHOICES = [
        ("normal", "عادي"),
        ("italic", "مائل"),
    ]

    name = models.CharField("اسم الخط", max_length=120)
    name_en = models.CharField("الاسم الإنجليزي", max_length=120, blank=True)
    family = models.CharField(
        "اسم العائلة في CSS", max_length=120,
        help_text="اكتب اسم العائلة كما سيظهر في CSS، مثل MyFont.",
    )
    file = models.FileField("ملف الخط", upload_to="fonts/%Y/%m/", blank=True)
    external_url = models.URLField(
        "رابط مباشر للخط", blank=True,
        help_text="اختياري — استخدمه بدلاً من رفع الملف.",
    )
    weight = models.PositiveIntegerField("الوزن", default=400)
    style = models.CharField("النمط", max_length=10, choices=STYLE_CHOICES, default="normal")
    is_active = models.BooleanField("متاح للاستخدام", default=True)
    order = models.PositiveIntegerField("الترتيب", default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="fonts_uploaded",
    )

    class Meta:
        ordering = ["order", "name"]
        verbose_name = "خط مرفوع"
        verbose_name_plural = "مكتبة الخطوط"

    def __str__(self):
        return self.name

    @property
    def url(self) -> str:
        if self.file:
            return self.file.url
        return self.external_url or ""

    @property
    def css_family(self) -> str:
        # اسم العائلة يدخل كقيمة CSS؛ الاقتباس يحمي الأسماء التي تحتوي مسافات.
        return "'" + self.family.replace("'", "\\'") + "'"


# --------------------------------------------------------------------------
class IntroVideo(TimeStampedModel):

    """معرض فيديوهات الافتتاحية — يترفع مرة ويتختار في أي دعوة.

    نفس فكرة ``MusicTrack``: مكتبة منسّقة بأسماء عربية وترتيب عرض، مش
    ملفات مرفوعة لدعوة واحدة.
    """

    name = models.CharField("الاسم", max_length=120)
    file = models.FileField("الفيديو", upload_to="intro_videos/%Y/%m/", blank=True)
    poster = models.ImageField("صورة الغلاف", upload_to="intro_videos/%Y/%m/",
                               blank=True, null=True)
    external_url = models.URLField("رابط خارجي", blank=True,
                                   help_text="بديل للرفع — رابط مباشر لملف فيديو.")
    seconds = models.FloatField("المدة بالثواني", default=0)
    note = models.CharField("ملاحظة", max_length=200, blank=True)
    is_active = models.BooleanField("متاح للاختيار", default=True)
    order = models.PositiveIntegerField("الترتيب", default=0)

    class Meta:
        ordering = ["order", "name"]
        verbose_name = "فيديو افتتاحية"
        verbose_name_plural = "معرض الافتتاحيات"

    def __str__(self) -> str:
        return self.name

    @property
    def url(self) -> str:
        if self.file:
            return self.file.url
        return self.external_url or ""

    @property
    def poster_url(self) -> str:
        return self.poster.url if self.poster else ""


# --------------------------------------------------------------------------
class Guest(TimeStampedModel):
    invitation = models.ForeignKey(Invitation, on_delete=models.CASCADE,
                                   related_name="guests")
    name = models.CharField("الاسم", max_length=120)
    phone = models.CharField("رقم الهاتف", max_length=40, blank=True)
    group_name = models.CharField("المجموعة", max_length=80, blank=True)
    plus_ones_allowed = models.PositiveIntegerField("مرافقون مسموح بهم", default=0)
    token = models.CharField("رمز الضيف", max_length=32, unique=True, blank=True)

    # ---- تصريح الدخول
    # الكود ده هو اللي بيتقرا بالعين على الباب لو الـQR مارضيش يتمسح،
    # فلازم يبقى قصير وسهل النطق — مش الـtoken الطويل.
    pass_code = models.CharField("كود التصريح", max_length=16, unique=True, blank=True)
    entries_allowed = models.PositiveIntegerField("عدد الدخلات المسموحة", default=1)
    entries_used = models.PositiveIntegerField("عدد الدخلات المستخدمة", default=0)
    SOURCE_CHOICES = [("manual", "مسمى"), ("rsvp", "تسجيل ذاتي")]
    source = models.CharField("النوع", max_length=10,
                              choices=SOURCE_CHOICES, default="manual")

    checked_in = models.BooleanField("دخل القاعة", default=False)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField("ملاحظة", max_length=250, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "ضيف"
        verbose_name_plural = "الضيوف"

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        if not self.token:
            self.token = self.new_token()
        if not self.pass_code:
            self.pass_code = self.new_pass_code()
        super().save(*args, **kwargs)

    @staticmethod
    def new_pass_code() -> str:
        """كود قصير يتقرا بالعين. بنتجنّب الحروف اللي بتتلخبط (I/O/0/1)."""
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        for _ in range(20):
            code = "FRH-" + "".join(secrets.choice(alphabet) for _ in range(6))
            if not Guest.objects.filter(pass_code=code).exists():
                return code
        # احتمال بعيد جداً — بنطوّل الكود بدل ما نفشل
        return "FRH-" + secrets.token_hex(5).upper()

    @property
    def entries_left(self) -> int:
        return max(0, self.entries_allowed - self.entries_used)

    @property
    def pass_status(self) -> str:
        """``active`` لسه فيه دخلات · ``used`` خلصت · ``none`` مفيش تصريح."""
        if self.entries_allowed <= 0:
            return "none"
        return "used" if self.entries_left == 0 else "active"

    @property
    def pass_status_label(self) -> str:
        return {"active": "نشط", "used": "مستخدم", "none": "بدون"}[self.pass_status]

    def grant_entries(self, count: int) -> None:
        """يحدّد عدد الدخلات المسموحة (الضيف + مرافقينه)."""
        self.entries_allowed = max(0, int(count))
        self.save(update_fields=["entries_allowed", "updated_at"])

    def consume_entry(self) -> bool:
        """يستهلك دخلة واحدة. يرجّع False لو التصريح خلص."""
        if self.entries_left <= 0:
            return False
        self.entries_used += 1
        if not self.checked_in:
            self.checked_in = True
            self.checked_in_at = timezone.now()
        self.save(update_fields=["entries_used", "checked_in",
                                 "checked_in_at", "updated_at"])
        return True

    @staticmethod
    def new_token() -> str:
        """رمز الضيف = كلمة السر بتاعته. لازم يكون عشوائي بما يكفي إن حد
        مايقدرش يخمّنه ويشوف دعوة مش بتاعته أو يرد بدل ضيف تاني."""
        return secrets.token_urlsafe(24).replace("-", "").replace("_", "")[:24]

    def get_absolute_url(self) -> str:
        from django.urls import reverse
        return reverse("invitation_guest",
                       kwargs={"slug": self.invitation.slug, "token": self.token})

    @property
    def latest_rsvp(self):
        return self.rsvps.order_by("-created_at").first()

    @property
    def rsvp_status(self) -> str:
        r = self.latest_rsvp
        return r.status if r else ""


# --------------------------------------------------------------------------
class RSVPResponse(TimeStampedModel):
    STATUS_CHOICES = [("attending", "سيحضر"), ("declined", "اعتذر"),
                      ("maybe", "غير متأكد")]

    invitation = models.ForeignKey(Invitation, on_delete=models.CASCADE,
                                   related_name="rsvps")
    guest = models.ForeignKey(Guest, on_delete=models.SET_NULL, null=True, blank=True,
                              related_name="rsvps")
    name = models.CharField("الاسم", max_length=120)
    phone = models.CharField("رقم الهاتف", max_length=40, blank=True)
    status = models.CharField("الحالة", max_length=20,
                              choices=STATUS_CHOICES, default="attending")
    companions = models.PositiveIntegerField("عدد المرافقين", default=0,
                                             validators=[MinValueValidator(0)])
    message = models.TextField("رسالة", blank=True)
    is_approved = models.BooleanField("معتمدة للعرض", default=True)
    ip_hash = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "تأكيد حضور"
        verbose_name_plural = "تأكيدات الحضور"

    def __str__(self) -> str:
        return f"{self.name} — {self.get_status_display()}"


# --------------------------------------------------------------------------
class Order(TimeStampedModel):
    STATUS_CHOICES = [
        ("new", "جديد"), ("contacted", "تم التواصل"),
        ("in_progress", "قيد التنفيذ"), ("completed", "مكتمل"),
        ("cancelled", "ملغي"),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE,
                                 related_name="orders")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="orders")
    template = models.ForeignKey(Template, on_delete=models.SET_NULL, null=True,
                                 blank=True, related_name="orders")
    invitation = models.OneToOneField(Invitation, on_delete=models.SET_NULL, null=True,
                                      blank=True, related_name="order")

    event_type = models.CharField("نوع المناسبة", max_length=50, default="زفاف")
    event_date = models.DateField("تاريخ المناسبة", null=True, blank=True)
    names = models.CharField("أسماء أصحاب المناسبة", max_length=200, blank=True)
    message = models.TextField("ملاحظات", blank=True)
    status = models.CharField("الحالة", max_length=20,
                              choices=STATUS_CHOICES, default="new", db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "طلب"
        verbose_name_plural = "الطلبات"

    def __str__(self) -> str:
        return f"طلب #{self.pk} — {self.customer.name}"

    # -- الإضافات ----------------------------------------------------------
    @property
    def addons_total(self):
        """إجمالي الإضافات بأسعارها **وقت الشراء** مش أسعارها الحالية."""
        return sum((oa.price for oa in self.order_addons.all()), Decimal("0"))

    @property
    def total_price(self):
        return (self.plan.price or Decimal("0")) + self.addons_total

    @property
    def addon_features(self) -> set[str]:
        """المزايا اللي الإضافات المتشترية بتفتحها في الدعوة."""
        return {
            oa.addon.code.strip()
            for oa in self.order_addons.select_related("addon")
            if oa.addon.code.strip()
        }


# --------------------------------------------------------------------------
class PlanAddon(TimeStampedModel):
    """إضافة اختيارية بسعر زيادة فوق سعر الباقة.

    ``code`` بيربط الإضافة بميزة حقيقية في المحرك (music, rsvp, gallery…).
    لو اتحطّت، شراء الإضافة **بيفتح** الميزة دي في الدعوة اللي هتتعمل من
    الطلب — من غير ما حد يعدّل الباقة بالإيد. وسيبها فاضية لو الإضافة
    خدمة مش ميزة (زي «تسليم خلال ٢٤ ساعة»).

    الأسعار بتتغيّر مع الوقت، عشان كده الطلب بيصوّر السعر وقت الشراء في
    ``OrderAddon`` — تعديل السعر هنا مايعيدش كتابة الطلبات القديمة.
    """

    name = models.CharField("الاسم", max_length=120)
    name_en = models.CharField("الاسم (EN)", max_length=120, blank=True)
    code = models.CharField(
        "مفتاح الميزة", max_length=40, blank=True,
        help_text="اختياري — مفتاح ميزة في المحرك (music / rsvp / gallery …). "
                  "لو اتحط، شراء الإضافة بيفتح الميزة في الدعوة.",
    )
    price = models.DecimalField("السعر", max_digits=10, decimal_places=2, default=0,
                                validators=[MinValueValidator(0)])
    description = models.CharField("وصف مختصر", max_length=200, blank=True)
    plans = models.ManyToManyField(
        Plan, blank=True, related_name="addons", verbose_name="الباقات",
        help_text="سيبها فاضية عشان الإضافة تظهر مع كل الباقات.",
    )
    is_active = models.BooleanField("مفعّلة", default=True)
    sort_order = models.PositiveIntegerField("الترتيب", default=0)

    class Meta:
        ordering = ["sort_order", "price", "id"]
        verbose_name = "إضافة"
        verbose_name_plural = "الإضافات"

    def __str__(self) -> str:
        return f"{self.name} ({self.price})"

    @property
    def display_name(self) -> str:
        return _pick(self.name, self.name_en)

    def available_for(self, plan) -> bool:
        """الإضافة متاحة للباقة دي؟ مفيش باقات محدّدة = متاحة للكل."""
        if not self.pk:
            return False
        linked = self.plans.all()
        return not linked.exists() or (plan is not None and plan in linked)


# --------------------------------------------------------------------------
class OrderAddon(models.Model):
    """إضافة متشترية في طلب — بسعرها وقت الشراء مش سعرها الحالي."""

    order = models.ForeignKey("Order", on_delete=models.CASCADE,
                              related_name="order_addons")
    addon = models.ForeignKey(PlanAddon, on_delete=models.PROTECT,
                              related_name="order_addons")
    # صورة من وقت الشراء — الاسم كمان، عشان لو الإضافة اتغيّر اسمها
    # الطلب القديم يفضل مقروء زي ما اتعمل
    name = models.CharField("الاسم وقت الشراء", max_length=120, blank=True)
    price = models.DecimalField("السعر وقت الشراء", max_digits=10, decimal_places=2,
                                default=0)

    class Meta:
        unique_together = [("order", "addon")]
        verbose_name = "إضافة الطلب"
        verbose_name_plural = "إضافات الطلب"

    def __str__(self) -> str:
        return f"{self.name or self.addon.name} — {self.price}"


# --------------------------------------------------------------------------
class SiteSetting(models.Model):
    """إعدادات الموقع العامة — سجل واحد بس.

    مش في ``settings.py`` عشان المستخدم يقدر يغيّرها من اللوحة من غير
    نشر جديد، ومش في المستند عشان دي مش بتاعة دعوة بعينها.
    """

    preview_cta_enabled = models.BooleanField("شريط «عجبك القالب؟»", default=True)
    preview_cta_text = models.CharField("النص", max_length=120,
                                        default="عجبك القالب ده؟")
    whatsapp_enabled = models.BooleanField("إظهار واتساب", default=True)
    whatsapp_number = models.CharField(
        "رقم الواتساب", max_length=30, blank=True,
        help_text="بالكود الدولي، مثال: +201559403203",
    )
    whatsapp_message = models.CharField(
        "الرسالة الجاهزة", max_length=300,
        default="السلام عليكم، عايز أطلب دعوة بقالب: {template}",
        help_text="{template} بتتبدّل باسم القالب اللي الزائر شايفه.",
    )
    facebook_enabled = models.BooleanField("إظهار فيسبوك", default=True)
    facebook_url = models.URLField("رابط صفحة فيسبوك", max_length=300, blank=True)

    # ---- استقبال الطلبات
    orders_enabled = models.BooleanField(
        "نموذج «اطلب دعوتك» في الموقع", default=True,
        help_text="اقفله لو بتاخد الطلبات على واتساب. القسم بيختفي من "
                  "الصفحة، وأزرار «اطلب دعوتك» بتوجّه على واتساب، "
                  "والسيرفر بيرفض أي إرسال للنموذج — مش بيتخبّى بس.",
    )

    # ---- زر واتساب العائم
    whatsapp_float_enabled = models.BooleanField(
        "زر واتساب عائم في الموقع", default=True,
        help_text="أيقونة واتساب ثابتة في ركن كل صفحات الموقع. محتاجة "
                  "«رقم الواتساب» تحت.",
    )
    whatsapp_cta_message = models.CharField(
        "رسالة الزر العائم", max_length=300,
        default="السلام عليكم، حابب أستفسر عن الدعوات الرقمية",
        blank=True,
        help_text="الرسالة الجاهزة اللي هتتكتب للزائر لما يدوس الأيقونة. "
                  "دي غير رسالة شريط «عجبك القالب؟» اللي فيها {template}.",
    )

    class Meta:
        verbose_name = "إعدادات الموقع"
        verbose_name_plural = "إعدادات الموقع"

    def __str__(self) -> str:
        return "إعدادات الموقع"

    def save(self, *args, **kwargs):
        # سجل واحد بس مهما حصل. ‎objects.create()‎ بيبعت
        # ‎force_insert=True‎، ومع pk ثابت ده بيضرب ‎IntegrityError‎ لو
        # السجل موجود — فبنحوّلها لتحديث بدل ما تقع في وش اللي نده.
        self.pk = 1
        kwargs["force_insert"] = False
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "SiteSetting":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def whatsapp_digits(self) -> str:
        """wa.me عايز أرقام بس — من غير + ولا مسافات ولا شرط."""
        return "".join(ch for ch in self.whatsapp_number if ch.isdigit())

    @property
    def has_contact_link(self) -> bool:
        """فيه وسيلة تواصل واحدة على الأقل شغّالة؟"""
        return bool((self.whatsapp_enabled and self.whatsapp_digits)
                    or (self.facebook_enabled and self.facebook_url))

    @property
    def whatsapp_url(self) -> str:
        """رابط wa.me الجاهز للزر العائم — أو فاضي لو مفيش رقم."""
        if not (self.whatsapp_enabled and self.whatsapp_digits):
            return ""
        text = (self.whatsapp_cta_message or "").strip()
        base = f"https://wa.me/{self.whatsapp_digits}"
        return f"{base}?text={quote(text)}" if text else base

    @property
    def whatsapp_float_ready(self) -> bool:
        """الزر العائم هيظهر فعلاً؟ مفعّل + فيه رقم."""
        return bool(self.whatsapp_float_enabled and self.whatsapp_url)

    @property
    def preview_cta_ready(self) -> bool:
        """الشريط هيظهر فعلاً؟

        مفعّل **و** فيه لينك واحد على الأقل. شريط من غير أزرار ضوضاء،
        فبيتخفي بالكامل — وده كان بيحصل بالصمت: التوجل مفتوح والشريط
        مش باين ومحدش يعرف ليه. اللوحة بتحذّر من الحالة دي دلوقتي.
        """
        return bool(self.preview_cta_enabled and self.has_contact_link)
