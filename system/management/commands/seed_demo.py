"""بيانات تجريبية للبدء السريع."""

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta

from system.data import golden_classic
from system.models import Customer, Guest, Invitation, Plan, RSVPResponse, Template

FEATURES_BASIC = ["rsvp", "countdown", "location", "calendar", "whatsapp"]
FEATURES_PLUS = FEATURES_BASIC + ["gallery", "qr", "music"]
FEATURES_MAX = FEATURES_PLUS + ["video", "guestbook", "companions"]


class Command(BaseCommand):
    help = "ينشئ بيانات تجريبية: باقات، قالب، ومستخدم إداري."

    def handle(self, *args, **options):
        # ---------------------------------------------------------- الباقات
        plans_data = [
            ("الأساسية", "basic", 750, FEATURES_BASIC, False,
             "دعوة رقمية أنيقة برابط خاص",
             ["رابط دعوة مستقل", "تأكيد حضور", "عدّاد تنازلي", "الموقع على الخريطة"],
             "Essential", "An elegant digital invitation with its own link",
             ["Private invitation link", "RSVP", "Countdown", "Map location"]),
            ("المميزة", "plus", 1450, FEATURES_PLUS, True,
             "كل ما تحتاجه مناسبتك",
             ["كل مزايا الأساسية", "معرض صور", "موسيقى", "رمز QR"],
             "Premium", "Everything your occasion needs",
             ["Everything in Essential", "Photo gallery", "Music", "QR code"]),
            ("الملكية", "royal", 2600, FEATURES_MAX, False,
             "تجربة كاملة بلا حدود",
             ["كل مزايا المميزة", "فيديو", "سجل تهانٍ", "عدد مرافقين"],
             "Royal", "The complete, unlimited experience",
             ["Everything in Premium", "Video", "Guestbook", "Plus-ones"]),
        ]
        for i, (name, slug, price, features, featured, tagline, bullets,
                name_en, tagline_en, bullets_en) in enumerate(plans_data):
            Plan.objects.update_or_create(slug=slug, defaults={
                "name": name, "price": price, "features": features,
                "is_featured": featured, "tagline": tagline, "bullets": bullets,
                "name_en": name_en, "tagline_en": tagline_en, "bullets_en": bullets_en,
                "sort_order": i, "is_active": True,
            })
        self.stdout.write(self.style.SUCCESS(f"الباقات: {Plan.objects.count()}"))

        # ---------------------------------------------------------- القالب
        template, _ = Template.objects.update_or_create(
            slug="golden-classic",
            defaults={
                "name": "ذهبي كلاسيكي",
                "name_en": "Golden Classic",
                "category": "wedding",
                "collection": "Premium",
                "description": "تصميم أصلي بلمسات ذهبية وخط أميري، مناسب للأفراح الكلاسيكية.",
                "description_en": "An original design with gold accents and Amiri type, made for classic weddings.",
                "document": golden_classic.build(),
                "required_features": ["rsvp", "countdown", "location", "qr"],
                "source": "builtin",
                "is_active": True,
                "sort_order": 0,
            },
        )
        self.stdout.write(self.style.SUCCESS(f"القالب: {template.name}"))

        # ---------------------------------------------------------- مستخدم
        user, created = User.objects.get_or_create(
            username="admin",
            defaults={"is_staff": True, "is_superuser": True, "email": ""},
        )
        if created:
            user.set_password("Leila!Admin2026")
            user.save()
            self.stdout.write(self.style.WARNING(
                "أُنشئ مستخدم admin بكلمة مرور Leila!Admin2026 — غيّرها فوراً."
            ))

        # ---------------------------------------------------------- دعوة تجريبية
        plan = Plan.objects.get(slug="plus")
        customer, _ = Customer.objects.get_or_create(
            phone="01000000000", defaults={"name": "عميل تجريبي"},
        )
        invitation, made = Invitation.objects.get_or_create(
            slug="demo1234",
            defaults={
                "customer": customer, "template": template, "plan": plan,
                "name_one": "ليلى", "name_two": "أحمد",
                "event_type": "زفاف",
                "event_date": timezone.now() + timedelta(days=45),
                "venue": "قاعة الياسمين",
                "address": "التجمع الخامس، القاهرة",
                "map_url": "https://maps.google.com/?q=cairo",
                "whatsapp": "201000000000",
                "document": template.get_document(),
                "status": "published",
            },
        )
        if made:
            for name in ["منى سالم", "كريم فؤاد", "هدى ناصر"]:
                Guest.objects.create(invitation=invitation, name=name, plus_ones_allowed=2)
            RSVPResponse.objects.create(
                invitation=invitation, name="منى سالم", status="attending",
                companions=2, message="ألف مبروك، فرحتنا بكم.",
            )
        self.stdout.write(self.style.SUCCESS(f"دعوة تجريبية: /i/{invitation.slug}/"))
        self.stdout.write(self.style.SUCCESS("تم."))
