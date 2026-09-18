"""يعيد توليد أغلفة الفيديو المبكسلة (poster / thumb).

الأغلفة القديمة اتولّدت في المتصفح على canvas بحد ٦٤٠px، فالفيديو
‎1080×1920‎ غلافه اتخزّن ‎360×640‎ وبيتمطّ تلات أضعاف على شاشة التليفون.
التعديل في ``video.py`` و``views.py`` بيشتغل على **الرفع الجديد** بس —
الأمر ده بيصلّح اللي اترفع خلاص.

    python manage.py fix_posters                # تقرير بس، مايلمسش حاجة
    python manage.py fix_posters --apply        # يعيد التوليد فعلاً
    python manage.py fix_posters --apply --all  # حتى الأغلفة السليمة

الغلاف بيتاخد من **ملف الفيديو المخزّن** بـffmpeg وبمقاسه الأصلي. لو
الفيديو نفسه اتضغط وقت الرفع، الغلاف هيبقى بجودة الفيديو المضغوط — مش
أحسن منه. الأصل مش محفوظ فمفيش طريقة نرجع أبعد من كده.
"""

from __future__ import annotations

import os

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from system import video
from system.models import Asset, IntroVideo

# الغلاف اللي أقصر ضلع فيه أصغر من كده = مولّد من canvas القديم
SUSPECT_MAX_EDGE = 1000


class Command(BaseCommand):
    help = "يعيد توليد أغلفة الفيديو المبكسلة بـffmpeg"

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="نفّذ فعلاً. من غيره تقرير بس.")
        parser.add_argument("--all", action="store_true",
                            help="أعِد توليد كل الأغلفة مش المبكسلة بس.")

    # ------------------------------------------------------------------
    def handle(self, *args, **opts):
        if not video.available():
            self.stderr.write(self.style.ERROR(
                "ffmpeg مش متثبّت — الأمر ده مش هيشتغل من غيره."))
            return

        apply_it = opts["apply"]
        force = opts["all"]
        done = skipped = failed = 0

        rows = [("Asset", a, "thumb") for a in
                Asset.objects.filter(kind="video").order_by("id")]
        rows += [("IntroVideo", c, "poster") for c in
                 IntroVideo.objects.order_by("id")]

        if not rows:
            self.stdout.write("مفيش فيديوهات مخزّنة.")
            return

        for label, obj, field in rows:
            path = self._path(obj.file)
            if not path:
                continue

            current = getattr(obj, field, None)
            size = self._image_size(current)
            name = (getattr(obj, "original_name", "") or getattr(obj, "name", "")
                    or os.path.basename(path))[:40]

            if size and max(size) >= SUSPECT_MAX_EDGE and not force:
                self.stdout.write(f"[{label} {obj.pk:>5}] {name:<40} "
                                  f"سليم ({size[0]}×{size[1]})")
                skipped += 1
                continue

            state = f"{size[0]}×{size[1]}" if size else "من غير غلاف"
            self.stdout.write(self.style.WARNING(
                f"[{label} {obj.pk:>5}] {name:<40} {state} ← إعادة توليد"))

            if not apply_it:
                continue

            data = self._frame(path)
            if not data:
                failed += 1
                continue

            stem = os.path.splitext(os.path.basename(path))[0][:60]
            # ‎save‎ بـ‎save=False‎ بتحط الملف وتسمّيه بس، والحفظ بعديها
            # مرة واحدة — عشان ماندّيش ضربتين للداتابيز لكل صف.
            getattr(obj, field).save(f"{stem}-poster.jpg",
                                     ContentFile(data), save=False)
            obj.save(update_fields=[field, "updated_at"])
            done += 1

        self.stdout.write("")
        self.stdout.write(f"الإجمالي: {len(rows)} · سليم: {skipped}"
                          + (f" · فشل: {failed}" if failed else ""))
        if apply_it:
            self.stdout.write(self.style.SUCCESS(f"اتولّد من جديد: {done}"))
        else:
            self.stdout.write(self.style.WARNING(
                "ده تقرير بس. ضيف --apply عشان يتنفّذ."))

    # ------------------------------------------------------------------
    def _path(self, field_file) -> str:
        try:
            path = field_file.path
        except Exception:
            return ""
        return path if path and os.path.exists(path) else ""

    def _image_size(self, field_file):
        """‎(عرض, ارتفاع)‎ للغلاف الحالي، أو ``None`` لو مفيش/مش مقروء."""
        path = self._path(field_file) if field_file else ""
        if not path:
            return None
        try:
            from PIL import Image
            with Image.open(path) as img:
                return img.size
        except Exception:
            return None

    def _frame(self, path: str):
        """أول فريم من ملف الفيديو المخزّن بمقاسه الأصلي."""
        try:
            with open(path, "rb") as fh:
                thumb = video.make_thumbnail(fh)
        except Exception as exc:
            self.stderr.write(self.style.ERROR(f"  فشل: {exc}"))
            return None
        if thumb is None:
            self.stderr.write(self.style.ERROR("  ffmpeg ما قدرش يقرا الفيديو"))
            return None
        return thumb.read()
