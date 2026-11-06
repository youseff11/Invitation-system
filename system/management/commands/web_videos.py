"""يعمل نسخة الموبايل (‎<اسم>.web.mp4‎) لكل فيديو اترفع قبل كده.

الرفع الجديد بيعملها لوحده (‎services.upload_asset‎ ومكتبة الافتتاحيات).
الأمر ده للفيديوهات القديمة: بيمشي على كل فيديو تحت ‎MEDIA_ROOT‎، ولو
تقيل على الموبايل (أكبر من 720p، أو فوق 30fps، أو معدل عالي) بيعمل جنبه
نسخة ‎720p/30fps‎ — الأصل مابيتلمسش، والدعوة بتعرض النسخة الخفيفة تلقائياً.

    python manage.py web_videos                 # تقرير بس
    python manage.py web_videos --apply         # نفّذ
    python manage.py web_videos --apply --limit 5

الاستضافة بتحسب ثواني معالج: فيديو 4K لـ٩ ثواني بياخد حوالي ٦ ثواني ترميز.
"""

from __future__ import annotations

import os

from django.conf import settings
from django.core.cache import cache
from django.core.management.base import BaseCommand

from system import video


def _mb(n: int) -> str:
    return f"{n / 1_000_000:.1f}MB"


class Command(BaseCommand):
    help = "يعمل نسخة موبايل خفيفة (‎.web.mp4‎) للفيديوهات التقيلة"

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="نفّذ فعلاً. من غيره تقرير بس.")
        parser.add_argument("--limit", type=int, default=0, help="أقصى عدد فيديوهات يترمّز في المرة.")
        parser.add_argument("--force", action="store_true", help="أعِد عمل النسخ الموجودة.")

    def handle(self, *args, **opts):
        if not video.available():
            self.stderr.write(self.style.ERROR(
                "ffmpeg مش موجود. نصّب: pip install --user imageio-ffmpeg"))
            return
        self.stdout.write(f"ffmpeg: {video.ffmpeg_bin()}")

        root = str(settings.MEDIA_ROOT)
        files = []
        for folder, _dirs, names in os.walk(root):
            for name in names:
                path = os.path.join(folder, name)
                ext = os.path.splitext(name)[1].lower()
                if ext in video.VIDEO_EXTS and not video.is_web_rendition(path) \
                        and ".part" not in name:
                    files.append(path)
        files.sort()

        done = skipped = failed = heavy = 0
        before_total = after_total = 0
        for path in files:
            rel = os.path.relpath(path, root)
            info = video.probe(path)
            size = os.path.getsize(path)
            target = video.web_path(path)
            exists = os.path.exists(target)
            needs = video.needs_web_rendition(path, info)
            desc = (f"{info.get('width', '?')}x{info.get('height', '?')} "
                    f"{info.get('fps', 0):.0f}fps {_mb(size)}")
            if not needs and not exists:
                skipped += 1
                self.stdout.write(f"  ok    {rel}  ({desc})")
                continue
            heavy += 1
            if exists and not opts["force"]:
                self.stdout.write(f"  done  {rel}  ({desc} → {_mb(os.path.getsize(target))})")
                continue
            if not opts["apply"]:
                self.stdout.write(self.style.WARNING(f"  heavy {rel}  ({desc})"))
                continue
            if opts["limit"] and done >= opts["limit"]:
                continue
            out = video.make_web_rendition(path, force=opts["force"])
            if out:
                done += 1
                before_total += size
                after_total += os.path.getsize(out)
                self.stdout.write(self.style.SUCCESS(
                    f"  made  {rel}  ({desc} → {_mb(os.path.getsize(out))})"))
            else:
                failed += 1
                self.stdout.write(self.style.ERROR(f"  fail  {rel}  ({desc})"))

        self.stdout.write("")
        self.stdout.write(f"فيديوهات: {len(files)} · تقيلة: {heavy} · خفيفة أصلاً: {skipped}")
        if opts["apply"]:
            if done:
                # معاينات القوالب المخزّنة فيها الروابط القديمة
                cache.clear()
            self.stdout.write(self.style.SUCCESS(
                f"اتعمل: {done} ({_mb(before_total)} → {_mb(after_total)}) · فشل: {failed}"))
        else:
            self.stdout.write(self.style.WARNING("ده تقرير بس. ضيف --apply عشان يتنفّذ."))
