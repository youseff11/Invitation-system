"""إعادة بناء فهرس الوسائط من الصفر.

الفهرس بيتحدّث لوحده وقت الحفظ (‎system/signals.py‎) والهجرة ٠٠٠٩ بتملاه
أول مرة، فالأمر ده مالوش لازمة في التشغيل العادي. بيفيد في حالتين:

- بعد ‎loaddata‎ أو استيراد بيكتب في قاعدة البيانات من غير ما يعدّي على
  ‎save()‎ (الإشارة مابتشتغلش ساعتها).
- للتأكد: ‎--check‎ بيقارن الفهرس بالمستندات ومابيكتبش حاجة.
"""

from django.core.management.base import BaseCommand

from system import mediakeys
from system.models import DocumentMediaKey, Invitation, Template


class Command(BaseCommand):
    help = "يعيد بناء فهرس الوسائط (DocumentMediaKey) من مستندات القوالب والدعوات."

    def add_arguments(self, parser):
        parser.add_argument(
            "--check", action="store_true",
            help="يقارن الفهرس بالمستندات ومابيكتبش — بيطبع الفروق لو فيه.",
        )
        parser.add_argument(
            "--compare", action="store_true",
            help="يقارن نتيجة الفهرس بنتيجة المسحة القديمة لكل الأصول "
                 "(بطيء — بس هو الإثبات إن الحل الجديد بيدّي نفس الإجابة).",
        )

    def handle(self, *args, **options):
        if options["compare"]:
            self._compare()
            return
        if options["check"]:
            self._check()
            return
        counts = mediakeys.rebuild_all()
        self.stdout.write(self.style.SUCCESS(
            f"تم: {counts['templates']} قالب و{counts['invitations']} دعوة "
            f"⇒ {counts['keys']} مفتاح."
        ))

    def _check(self):
        problems = 0
        for model, field in ((Template, "template"), (Invitation, "invitation")):
            for pk, document in model.objects.values_list("pk", "document"):
                expected = mediakeys.keys_in_document(document)
                stored = set(
                    DocumentMediaKey.objects
                    .filter(**{f"{field}_id": pk})
                    .values_list("key", flat=True)
                )
                if expected != stored:
                    problems += 1
                    self.stdout.write(self.style.WARNING(
                        f"{field} {pk}: ناقص {sorted(expected - stored)} / "
                        f"زيادة {sorted(stored - expected)}"
                    ))
        if problems:
            self.stdout.write(self.style.ERROR(
                f"{problems} مستند الفهرس بتاعه مش مظبوط — شغّل الأمر من غير --check."
            ))
        else:
            self.stdout.write(self.style.SUCCESS("الفهرس مطابق للمستندات."))

    def _compare(self):
        """الفهرس مقابل المسحة القديمة، أصل أصل.

        الاستيراد من ‎views‎ جوّه الدالة عن قصد: الأمر ده أداة تحقّق
        بتتشغّل باليد، مش جزء من مسار عادي.
        """
        from system.models import Asset
        from system.views import _asset_usage_map, _asset_usage_scan

        assets = list(Asset.objects.all())
        if not assets:
            self.stdout.write("مافيش أصول.")
            return

        fast = _asset_usage_map(assets)
        slow = _asset_usage_scan(assets)
        mismatches = [a for a in assets if fast.get(a.pk) != slow.get(a.pk)]

        used = sum(1 for a in assets if slow.get(a.pk))
        self.stdout.write(f"{len(assets)} أصل، منهم {used} مستخدم (بالمسحة القديمة).")
        for asset in mismatches:
            self.stdout.write(self.style.ERROR(
                f"اختلاف: أصل {asset.pk} ({asset.original_name or asset.file.name}) — "
                f"الفهرس {fast.get(asset.pk)} / المسحة {slow.get(asset.pk)}"
            ))
        if mismatches:
            self.stdout.write(self.style.ERROR(f"{len(mismatches)} اختلاف."))
        else:
            self.stdout.write(self.style.SUCCESS("مطابق ١٠٠٪ — نفس الإجابة لكل أصل."))
