"""يضغط صور وفيديوهات القوالب المستوردة ويصلّح الروابط اللي بتشاور عليها.

ليه الأمر ده موجود
-------------------
الرفع العادي بيمر على ``images.compress`` (WebP + تصغير) و``video.compress``.
لكن استيراد القوالب بينده ``_store_media(preserve_original=True)`` اللي
بيخزّن الملف الخام زي ما هو — القرار كان مقصود عشان الخلفيات ما تطلعش
مبكسلة، بس تمنه طلع كبير: قياس على قالب حقيقي، ٨.٩ ميجا صور و٨.٥ ميجا
فيديو من إجمالي ١٨.٨ — يعني ٩٣٪ من وزن الدعوة. وفيه صورة ٥٠٧×٥٠٧
بتتحمّل عشان تتعرض في مربع ٣٦ بكسل.

اللي بيعمله
-----------
* الصور: WebP بضلع أقصى ``MAX_EDGE`` وجودة ``QUALITY``. بيجرّب lossy و
  lossless وياخد الأصغر — الشعارات والزخارف بتطلع lossless (صفر فقد جودة
  وحجم أقل)، والصور الفوتوغرافية lossy.
* الفيديو: ``video.compress`` (H.264 + faststart). محتاج ffmpeg؛ من غيره
  بيتخطّى الفيديو ويكمّل على الصور.
* الأصل بيتحفظ في ``Asset.source`` — الرجوع ممكن من غير إعادة استيراد.
* **الروابط بتتصلّح**: اسم الملف بيتغيّر لـ‎.webp‎/‎.mp4‎، والـHTML المخزّن
  بيشاور على الرابط القديم. الأمر بيمشي على مستندات القوالب والدعوات
  ويبدّل الرابط القديم بالجديد، وبيمسح المعاينة المخزّنة عشان تتولّد.

الاستعمال
---------
    python manage.py compress_assets                     # عرض بس
    python manage.py compress_assets --apply --limit 20  # دفعة صغيرة
    python manage.py compress_assets --apply --kind image

الاستضافة بتحسب ثواني معالج، وضغط الفيديو تقيل — امشي بدفعات بـ‎--limit‎.
"""

import io
import json
import os
import re

from django.core.files.uploadedfile import InMemoryUploadedFile
from django.core.management.base import BaseCommand
from django.db import transaction

from system import video as video_tools
from system.models import Asset, Invitation, Template

# أعلى من الـ1800 بتاعة الرفع العادي: خلفيات القوالب بتتعرض بعرض الشاشة
MAX_EDGE = 2400
QUALITY = 88
# أقل من كده مش مستاهل نلمس الملف
MIN_SAVING = 20 * 1024
SKIP_EXT = {".svg", ".gif", ".webp"}


def _mb(n) -> str:
    return f"{n / 1_000_000:.2f}MB"


def _shrink_image(data: bytes, name: str):
    """يرجّع ``(bytes, w, h)`` لأصغر نسخة WebP، أو ``None`` لو مفيش فايدة."""
    from PIL import Image, ImageOps

    with Image.open(io.BytesIO(data)) as opened:
        img = ImageOps.exif_transpose(opened)
        if img.mode in ("RGBA", "LA") or (
                img.mode == "P" and "transparency" in img.info):
            img = img.convert("RGBA")
        elif img.mode != "RGB":
            img = img.convert("RGB")

        width, height = img.size
        longest = max(width, height)
        if longest > MAX_EDGE:
            scale = MAX_EDGE / longest
            img = img.resize((max(1, round(width * scale)),
                              max(1, round(height * scale))), Image.LANCZOS)
            width, height = img.size

        best = None
        # الزخارف والشعارات بتطلع أصغر lossless، والصور الفوتوغرافية lossy
        for options in ({"quality": QUALITY, "method": 5},
                        {"lossless": True, "method": 5}):
            buf = io.BytesIO()
            try:
                img.save(buf, "WEBP", **options)
            except Exception:
                continue
            if best is None or buf.tell() < len(best):
                best = buf.getvalue()

    if best is None or len(best) >= len(data) - MIN_SAVING:
        return None
    return best, width, height


_MEDIA_URL_RE = re.compile(r'/media/[^\s"\'\\)<>]+')
# الـHTML المخزّن بيقفل الرابط بـ&quot; مش بعلامة تنصيص عادية، والـregex
# بيبلعها. لازم نشيلها وإلا الرابط يبان مكسور وهو سليم.
_URL_TAIL_RE = re.compile(r'(?:&(?:quot|apos|amp|lt|gt|#\d+);|[),.;])+$')


def _media_urls(raw: str) -> set[str]:
    """كل روابط الميديا في نص JSON، منضّفة من ذيول الـHTML."""
    found = set()
    for url in _MEDIA_URL_RE.findall(raw):
        cleaned = _URL_TAIL_RE.sub("", url)
        if cleaned.startswith("/media/") and len(cleaned) > 7:
            found.add(cleaned)
    return found


def _referenced_urls() -> set[str]:
    """كل روابط الميديا اللي فيه مستند بيشاور عليها فعلاً.

    الأصول اللي محدش بيستعملها (بقايا استيرادات قديمة أو نسخ مكررة)
    مالهاش أي أثر على وزن الدعوة، وضغطها بياكل من ثواني المعالج على
    الفاضي — خصوصاً على استضافة بتحسبها.
    """
    urls: set[str] = set()
    for model in (Template, Invitation):
        for row in model.objects.only("document").iterator():
            document = row.document
            if isinstance(document, dict):
                urls.update(_media_urls(
                    json.dumps(document, ensure_ascii=False)))
    return urls


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
                if old_url in new:
                    new = new.replace(old_url, new_url)
            if new == raw:
                continue
            fields = ["document"]
            row.document = json.loads(new)
            # المعاينة المخزّنة اتبنت بالروابط القديمة
            if hasattr(row, "preview_render"):
                row.preview_render = {}
                fields.append("preview_render")
            row.save(update_fields=fields)
            touched += 1
    return touched


class Command(BaseCommand):
    help = "يضغط صور وفيديوهات القوالب المستوردة ويصلّح روابطها."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="نفّذ فعلاً. من غيره بيعرض الأرقام بس.")
        parser.add_argument("--limit", type=int, default=0,
                            help="اشتغل على العدد ده من الملفات وقف.")
        parser.add_argument("--kind", choices=["image", "video"], default="",
                            help="نوع واحد بس.")
        parser.add_argument("--all", action="store_true",
                            help="اشتغل على الأصول غير المستخدمة كمان.")
        parser.add_argument("--prune-missing", action="store_true",
                            help="امسح صفوف الأصول اللي ملفاتها مش موجودة "
                                 "على القرص ومحدش بيستعملها.")

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        limit = options["limit"]
        kinds = [options["kind"]] if options["kind"] else ["image", "video"]

        has_ffmpeg = video_tools.available()
        if "video" in kinds and not has_ffmpeg:
            self.stdout.write(self.style.WARNING(
                "ffmpeg مش موجود — الفيديوهات هتتخطّى."))

        used = _referenced_urls()
        self.stdout.write(f"روابط مستعملة في المستندات: {len(used)}")

        before_total = after_total = 0
        done = skipped_unused = missing = 0
        missing_ids: list[int] = []
        url_map: dict[str, str] = {}
        seen_sizes: dict[tuple, int] = {}

        queryset = Asset.objects.filter(kind__in=kinds).order_by("-size_bytes")
        for asset in queryset.iterator():
            if limit and done >= limit:
                break
            if not asset.file:
                continue
            name = asset.file.name or ""
            ext = os.path.splitext(name)[1].lower()
            if ext in SKIP_EXT:
                continue
            if not options["all"] and asset.url not in used:
                skipped_unused += 1
                continue

            try:
                asset.file.open("rb")
                data = asset.file.read()
                asset.file.close()
            except FileNotFoundError:
                # صف في قاعدة البيانات وملفه مش على القرص — بقايا
                # استيراد قديم. بنعدّه ونكمّل بدل ما نغرق الشاشة.
                missing += 1
                missing_ids.append(asset.pk)
                continue
            except Exception as exc:
                self.stdout.write(self.style.ERROR(
                    f"تعذّرت قراءة {name}: {type(exc).__name__}"))
                continue
            if not data:
                continue

            old_url = asset.url
            stem = os.path.splitext(os.path.basename(name))[0][:60]
            new_file = None
            width = height = 0

            if asset.kind == "image":
                try:
                    result = _shrink_image(data, name)
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(
                        f"تعذّر ضغط {name}: {type(exc).__name__}"))
                    continue
                if not result:
                    continue
                payload, width, height = result
                new_file = InMemoryUploadedFile(
                    io.BytesIO(payload), "ImageField", f"{stem}.webp",
                    "image/webp", len(payload), None)
                new_size = len(payload)

            elif asset.kind == "video":
                if not has_ffmpeg:
                    continue
                if not apply_changes:
                    # قياس الفيديو معناه ضغطه فعلاً، وده بياكل معالج.
                    # في وضع العرض بنكتفي بإظهار الحجم الحالي.
                    self.stdout.write(
                        f"فيديو {os.path.basename(name):38.38} "
                        f"{_mb(len(data)):>9}  ← يتقاس وقت التنفيذ")
                    before_total += len(data)
                    after_total += len(data)
                    done += 1
                    continue
                upload = InMemoryUploadedFile(
                    io.BytesIO(data), "FileField", os.path.basename(name),
                    "video/mp4", len(data), None)
                new_file, _seconds = video_tools.compress(upload)
                new_size = getattr(new_file, "size", len(data))
                if new_size >= len(data) - MIN_SAVING:
                    continue
            else:
                continue

            before_total += len(data)
            after_total += new_size
            done += 1
            saving = 100 - (new_size * 100 // max(1, len(data)))
            self.stdout.write(
                f"{asset.kind:5} {os.path.basename(name):38.38} "
                f"{_mb(len(data)):>9} ← {_mb(new_size):>9}  (-{saving}%)")

            if not apply_changes:
                continue

            with transaction.atomic():
                # الأصل يتحفظ مرة واحدة بس — لو الأمر اتشغّل تاني ما نضيّعش
                # النسخة الخام الحقيقية
                if not asset.source:
                    asset.source.save(os.path.basename(name),
                                      InMemoryUploadedFile(
                                          io.BytesIO(data), "FileField",
                                          os.path.basename(name),
                                          "application/octet-stream",
                                          len(data), None),
                                      save=False)
                asset.file.save(new_file.name, new_file, save=False)
                if width and height:
                    asset.width, asset.height = width, height
                asset.size_bytes = new_size
                asset.save()

            if asset.url and old_url and asset.url != old_url:
                url_map[old_url] = asset.url

        if skipped_unused:
            self.stdout.write(self.style.WARNING(
                f"اتخطّينا {skipped_unused} أصل محدش بيستعمله "
                "(ضيف ‎--all‎ لو عايزهم)."))
        if missing:
            prune_now = options["prune_missing"] and apply_changes
            if prune_now:
                note = " — اتمسحوا."
            elif options["prune_missing"]:
                note = " — هيتمسحوا مع ‎--apply‎."
            else:
                note = " (ضيف ‎--prune-missing --apply‎ لمسحهم)."
            self.stdout.write(self.style.WARNING(
                f"{missing} صف ملفه مش موجود على القرص" + note))
            if prune_now:
                Asset.objects.filter(pk__in=missing_ids).delete()

        if not done:
            self.stdout.write(self.style.SUCCESS(
                "مفيش ملفات محتاجة ضغط."))
            return

        saved = before_total - after_total
        summary = (f"{done} ملف · {_mb(before_total)} ← {_mb(after_total)} "
                   f"· وفّرنا {_mb(saved)}")

        if not apply_changes:
            self.stdout.write(self.style.WARNING(
                "\nعرض بس: " + summary +
                "\nضيف ‎--apply‎ عشان يتنفّذ (والفيديو يتقاس ساعتها)."))
            return

        touched = _rewrite_urls(url_map) if url_map else 0
        self.stdout.write(self.style.SUCCESS(
            f"\nاتنفّذ: {summary}\n"
            f"اتصلّحت الروابط في {touched} مستند، والمعاينات المخزّنة اتمسحت."))
