"""يدوّر على بديل لكل ملف ميديا مكسور في المستندات ويصلّح الرابط.

إمتى يلزم
---------
``check_media`` بيقولك إن قالب بيشاور على ملف مش موجود. الأمر ده بيحاول
يلاقي نفس الملف بمكان تاني — لأن الملف الأصلي غالباً لسه موجود تحت مسار
مختلف (استيراد اتعاد، أو نسخة مكررة اتشالت والرابط ما اتبدّلش لاختلاف
ترميز الاسم).

الطريقة
-------
١. فهرس بكل الملفات الموجودة فعلاً تحت ``MEDIA_ROOT`` مفهرسة باسم الملف
   بعد فكّ ترميز النسبة (‎%C3%A0‎ ← ‎à‎) وبحروف صغيرة.
٢. لكل رابط مكسور: نجيب اسم ملفه، نفكّ ترميزه، وندوّر في الفهرس.
٣. لو لقينا واحد بس → نبدّل الرابط. لو أكتر من واحد → نسيبه ونبلّغ،
   عشان مانختارش الغلط.

اللي مالوش بديل بيتعرض بالاسم — دول محتاجين إعادة رفع، مفيش حل تاني.

    python manage.py repair_media            # عرض بس
    python manage.py repair_media --apply
"""

import json
import os
import re
from collections import defaultdict
from urllib.parse import unquote

from django.conf import settings
from django.core.management.base import BaseCommand

from system.models import Invitation, Template

_MEDIA_URL_RE = re.compile(r'/media/[^\s"\'\\)<>]+')
_URL_TAIL_RE = re.compile(r'(?:&(?:quot|apos|amp|lt|gt|#\d+);|[),.;])+$')


def _media_urls(raw: str) -> set[str]:
    """كل روابط الميديا في نص JSON، منضّفة من ذيول الـHTML."""
    found = set()
    for url in _MEDIA_URL_RE.findall(raw):
        cleaned = _URL_TAIL_RE.sub("", url)
        if cleaned.startswith("/media/") and len(cleaned) > 7:
            found.add(cleaned)
    return found


def _key(name: str) -> str:
    """مفتاح مقارنة: اسم الملف بعد فكّ الترميز وبحروف صغيرة."""
    return unquote(os.path.basename(name)).lower()


class Command(BaseCommand):
    help = "يصلّح روابط الميديا المكسورة في المستندات لو فيه بديل موجود."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="نفّذ فعلاً. من غيره بيعرض اللي هيحصل بس.")

    def handle(self, *args, **options):
        media_root = str(settings.MEDIA_ROOT)
        media_url = settings.MEDIA_URL or "/media/"

        def to_path(url: str) -> str:
            relative = url[len(media_url):] if url.startswith(media_url) \
                else url.lstrip("/")
            return os.path.join(media_root,
                                unquote(relative).replace("/", os.sep))

        # ١) فهرس الملفات الموجودة فعلاً
        index: dict[str, list[str]] = defaultdict(list)
        for folder, _dirs, files in os.walk(media_root):
            for name in files:
                full = os.path.join(folder, name)
                relative = os.path.relpath(full, media_root)
                index[_key(name)].append(relative.replace(os.sep, "/"))

        self.stdout.write(f"ملفات موجودة تحت الميديا: "
                          f"{sum(len(v) for v in index.values())}")

        fixed: dict[str, str] = {}
        ambiguous: list[str] = []
        hopeless: list[str] = []
        seen: set[str] = set()

        rows = []
        for model, label in ((Template, "قالب"), (Invitation, "دعوة")):
            for row in model.objects.all().iterator():
                if isinstance(row.document, dict):
                    rows.append((model, label, row))

        for _model, label, row in rows:
            raw = json.dumps(row.document, ensure_ascii=False)
            for url in _media_urls(raw):
                if url in seen:
                    continue
                seen.add(url)
                if os.path.exists(to_path(url)):
                    continue
                matches = index.get(_key(url), [])
                if len(matches) == 1:
                    fixed[url] = media_url.rstrip("/") + "/" + matches[0]
                elif matches:
                    ambiguous.append(
                        f"{url}  ({len(matches)} احتمال) ← {label} #{row.pk}")
                else:
                    hopeless.append(f"{url}  ← {label} #{row.pk}")

        if not fixed and not ambiguous and not hopeless:
            self.stdout.write(self.style.SUCCESS(
                "مفيش رابط مكسور. مافيش حاجة تتصلّح."))
            return

        for old, new in fixed.items():
            self.stdout.write(f"يتصلّح: {os.path.basename(old)[:50]}\n"
                              f"        ← {new}")
        for line in ambiguous:
            self.stdout.write(self.style.WARNING(
                f"أكتر من بديل، سيبناه: {line}"))
        for line in hopeless:
            self.stdout.write(self.style.ERROR(f"مفيش بديل: {line}"))

        if not fixed:
            self.stdout.write(self.style.ERROR(
                "\nمفيش أي رابط ينفع يتصلّح تلقائياً."))
            return

        if not options["apply"]:
            self.stdout.write(self.style.WARNING(
                f"\nعرض بس: {len(fixed)} رابط ينفع يتصلّح. "
                "ضيف ‎--apply‎ عشان يتنفّذ."))
            return

        touched = 0
        for _model, _label, row in rows:
            raw = json.dumps(row.document, ensure_ascii=False)
            new_raw = raw
            for old, new in fixed.items():
                if old in new_raw:
                    new_raw = new_raw.replace(old, new)
            if new_raw == raw:
                continue
            fields = ["document"]
            row.document = json.loads(new_raw)
            if hasattr(row, "preview_render"):
                row.preview_render = {}
                fields.append("preview_render")
            row.save(update_fields=fields)
            touched += 1

        self.stdout.write(self.style.SUCCESS(
            f"\nاتنفّذ: {len(fixed)} رابط اتصلّح في {touched} مستند. "
            "شغّل ‎check_media‎ تاني للتأكيد."))
