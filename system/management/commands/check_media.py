"""يفحص كل رابط ميديا جوّه المستندات ويقول أنهي ملف مش موجود على القرص.

مابيغيّرش أي حاجة — قراءة بس. الفايدة إنه بيرد على سؤال واحد:
هل فيه قالب أو دعوة بتشاور على ملف مش موجود؟

    python manage.py check_media
    python manage.py check_media --show 50    # يعرض ٥٠ رابط مكسور
"""

import json
import os
import re
from collections import defaultdict

from django.conf import settings
from django.core.management.base import BaseCommand

from system.models import Asset, Invitation, Template

_MEDIA_URL_RE = re.compile(r'/media/[^\s"\'\\)]+')


class Command(BaseCommand):
    help = "يتأكد إن كل ملف بتشاور عليه المستندات موجود فعلاً."

    def add_arguments(self, parser):
        parser.add_argument("--show", type=int, default=20,
                            help="كام رابط مكسور يتعرض بالتفصيل.")

    def handle(self, *args, **options):
        media_root = str(settings.MEDIA_ROOT)
        media_url = settings.MEDIA_URL or "/media/"

        # مين بيشاور على إيه
        refs: dict[str, list[str]] = defaultdict(list)
        for model, label in ((Template, "قالب"), (Invitation, "دعوة")):
            for row in model.objects.all().iterator():
                document = row.document
                if not isinstance(document, dict):
                    continue
                raw = json.dumps(document, ensure_ascii=False)
                for url in set(_MEDIA_URL_RE.findall(raw)):
                    refs[url].append(
                        f"{label} #{row.pk} {getattr(row, 'name', '')[:30]}")

        if not refs:
            self.stdout.write(self.style.SUCCESS(
                "مفيش أي رابط ميديا في المستندات."))
            return

        broken: list[str] = []
        for url in refs:
            relative = url[len(media_url):] if url.startswith(media_url) \
                else url.lstrip("/")
            path = os.path.join(media_root, relative.replace("/", os.sep))
            if not os.path.exists(path):
                broken.append(url)

        self.stdout.write(
            f"روابط ميديا في المستندات: {len(refs)}\n"
            f"موجودة على القرص: {len(refs) - len(broken)}")

        if not broken:
            self.stdout.write(self.style.SUCCESS(
                "\nكل ملف بتشاور عليه المستندات موجود. مفيش صورة مكسورة."))
        else:
            self.stdout.write(self.style.ERROR(
                f"مكسورة: {len(broken)}"))
            for url in sorted(broken)[:options["show"]]:
                users = ", ".join(sorted(set(refs[url]))[:3])
                self.stdout.write(f"  {url}\n      ← {users}")
            if len(broken) > options["show"]:
                self.stdout.write(
                    f"  ... و{len(broken) - options['show']} كمان "
                    f"(‎--show‎ لعرض أكتر).")

        # صفوف Asset اللي ملفاتها مش موجودة — مشكلة تانية منفصلة
        ghosts = 0
        for asset in Asset.objects.only("id", "file").iterator():
            if not asset.file:
                continue
            try:
                if not asset.file.storage.exists(asset.file.name):
                    ghosts += 1
            except Exception:
                ghosts += 1
        if ghosts:
            self.stdout.write(self.style.WARNING(
                f"\nكمان: {ghosts} صف في قاعدة البيانات ملفه مش موجود. "
                "دول مايأثروش على العرض؛ نضّفهم بـ"
                "‎compress_assets --prune-missing --apply‎."))
