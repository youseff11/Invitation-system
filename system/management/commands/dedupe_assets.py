"""يلمّ الأصول المكررة: نسخة واحدة على القرص، وباقي الروابط بتتحوّل عليها.

المشكلة
-------
كل استيراد لقالب بيعمل صفوف ``Asset`` جديدة حتى لو الملفات نفسها اتخزّنت
قبل كده. قياس على قاعدة حقيقية: نفس الصورة ٢.٤٢ ميجا متخزّنة ٩ مرات،
و``original.png`` ٥ مرات. يعني ٢٠+ ميجا على القرص من غير أي فايدة،
وضغطها بياكل ثواني معالج ٩ مرات بدل مرة.

الطريقة
-------
١. تجميع مبدئي بـ(النوع، الحجم) — رخيص، بيستبعد الأغلبية من غير قراءة.
٢. بصمة ‎sha256‎ للمجموعات المتشابهة في الحجم — التطابق بايت ببايت.
٣. في كل مجموعة بنختار الصف اللي **أكتر مستند بيشاور عليه** (وعند
   التساوي الأقدم)، عشان أقل عدد روابط محتاجة تعديل.
٤. الروابط في مستندات القوالب والدعوات بتتبدّل للنسخة المختارة،
   والمعاينة المخزّنة بتتمسح عشان تتولّد من جديد.
٥. صفوف المكرر بتتشال، وملفاتها بتتمسح من القرص — بس بعد ما نتأكد إن
   مفيش صف تاني فاضل بيستعمل نفس الملف.

الأمان
------
* افتراضياً عرض بس. مفيش حاجة بتتغيّر من غير ‎--apply‎.
* الحذف بيتم جوّه ‎transaction‎ بعد ما الروابط تتصلّح.
* حذف الملف من القرص بيتخطّى لو لسه فيه صف بيشاور عليه.
* مسح صف ``Asset`` مالوش ``post_delete`` بيمسح ملفات، فمفيش حذف مفاجئ.

    python manage.py dedupe_assets                  # عرض بس
    python manage.py dedupe_assets --apply
    python manage.py dedupe_assets --apply --keep-files   # سيب الملفات
"""

import hashlib
import json
import os
import re
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from system.models import Asset, Invitation, Template

_MEDIA_URL_RE = re.compile(r'/media/[^\s"\'\\)]+')
_CHUNK = 1024 * 1024


def _mb(n) -> str:
    return f"{n / 1_000_000:.2f}MB"


def _url_usage() -> dict[str, int]:
    """كام مستند بيشاور على كل رابط ميديا."""
    usage: dict[str, int] = defaultdict(int)
    for model in (Template, Invitation):
        for row in model.objects.only("document").iterator():
            document = row.document
            if not isinstance(document, dict):
                continue
            raw = json.dumps(document, ensure_ascii=False)
            for url in set(_MEDIA_URL_RE.findall(raw)):
                usage[url] += 1
    return usage


def _digest(asset) -> str:
    """بصمة محتوى الملف، أو '' لو الملف مش موجود/مش مقروء."""
    hasher = hashlib.sha256()
    try:
        with asset.file.open("rb") as handle:
            for chunk in iter(lambda: handle.read(_CHUNK), b""):
                hasher.update(chunk)
    except FileNotFoundError:
        return ""
    except Exception:
        return ""
    return hasher.hexdigest()


def _rewrite_urls(mapping: dict[str, str]) -> int:
    """يبدّل الروابط القديمة بالجديدة جوّه كل المستندات المخزّنة."""
    touched = 0
    for model in (Template, Invitation):
        for row in model.objects.all().iterator():
            document = row.document
            if not isinstance(document, dict):
                continue
            raw = json.dumps(document, ensure_ascii=False)
            new = raw
            for old_url, new_url in mapping.items():
                if old_url and old_url in new:
                    new = new.replace(old_url, new_url)
            if new == raw:
                continue
            fields = ["document"]
            row.document = json.loads(new)
            if hasattr(row, "preview_render"):
                row.preview_render = {}
                fields.append("preview_render")
            row.save(update_fields=fields)
            touched += 1
    return touched


class Command(BaseCommand):
    help = "يشيل الأصول المكررة ويحوّل روابطها لنسخة واحدة."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="نفّذ فعلاً. من غيره بيعرض الأرقام بس.")
        parser.add_argument("--keep-files", action="store_true",
                            help="امسح الصفوف بس وسيب الملفات على القرص.")
        parser.add_argument("--kind", choices=["image", "video", "audio",
                                               "other"], default="",
                            help="نوع واحد بس.")

    def handle(self, *args, **options):
        apply_changes = options["apply"]

        queryset = Asset.objects.all()
        if options["kind"]:
            queryset = queryset.filter(kind=options["kind"])

        # ١) تجميع مبدئي بالحجم — من غير قراءة أي ملف
        buckets: dict[tuple, list] = defaultdict(list)
        total = 0
        for asset in queryset.only(
                "id", "kind", "size_bytes", "file", "original_name"
        ).iterator():
            if not asset.file or not asset.size_bytes:
                continue
            total += 1
            buckets[(asset.kind, asset.size_bytes)].append(asset)

        candidates = {key: rows for key, rows in buckets.items()
                      if len(rows) > 1}
        if not candidates:
            self.stdout.write(self.style.SUCCESS(
                f"فحصنا {total} أصل — مفيش مكرر."))
            return

        # ٢) البصمة للمجموعات المشتبه فيها بس
        groups: dict[str, list] = defaultdict(list)
        missing = 0
        for rows in candidates.values():
            for asset in rows:
                digest = _digest(asset)
                if not digest:
                    missing += 1
                    continue
                groups[digest].append(asset)

        usage = _url_usage()
        url_map: dict[str, str] = {}
        drop: list = []
        freed = 0

        for digest, rows in sorted(groups.items()):
            if len(rows) < 2:
                continue
            # ٣) الأكتر استعمالاً هو اللي يفضل — أقل روابط محتاجة تعديل
            rows.sort(key=lambda a: (-usage.get(a.url, 0), a.pk))
            keeper, dups = rows[0], rows[1:]
            keep_url = keeper.url
            self.stdout.write(
                f"{keeper.kind:5} {os.path.basename(keeper.file.name):38.38} "
                f"{_mb(keeper.size_bytes):>9} × {len(rows)} نسخة "
                f"← نفضّل #{keeper.pk}")
            for dup in dups:
                if dup.url and dup.url != keep_url:
                    url_map[dup.url] = keep_url
                drop.append(dup)
                freed += dup.size_bytes or 0

        if missing:
            self.stdout.write(self.style.WARNING(
                f"{missing} صف ملفه مش موجود على القرص — "
                "استعمل ‎compress_assets --prune-missing‎."))

        if not drop:
            self.stdout.write(self.style.SUCCESS(
                f"فحصنا {total} أصل — مفيش مكرر متطابق."))
            return

        summary = (f"{len(drop)} نسخة مكررة · هنوفّر {_mb(freed)} "
                   f"· {len(url_map)} رابط هيتحوّل")

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                "\nعرض بس: " + summary +
                "\nضيف ‎--apply‎ عشان يتنفّذ."))
            return

        # ٤) الروابط الأول — لو وقفنا هنا المستندات تبقى سليمة
        touched = _rewrite_urls(url_map) if url_map else 0

        keep_names = set(
            Asset.objects.exclude(
                pk__in=[a.pk for a in drop]
            ).values_list("file", flat=True))

        removed_files = 0
        with transaction.atomic():
            Asset.objects.filter(pk__in=[a.pk for a in drop]).delete()

        if not options["keep_files"]:
            for dup in drop:
                name = dup.file.name
                # ٥) ملف لسه فيه صف بيستعمله؟ سيبه
                if not name or name in keep_names:
                    continue
                try:
                    dup.file.storage.delete(name)
                    removed_files += 1
                except Exception:
                    pass

        self.stdout.write(self.style.SUCCESS(
            f"\nاتنفّذ: {summary}"
            f"\nاتصلّحت الروابط في {touched} مستند، "
            f"واتمسح {removed_files} ملف من القرص."))
