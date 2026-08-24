"""يصلّح الفيديوهات المرفوعة قبل كده — نقل الفهرس للأول، وضغط اختياري.

التعديل في ``video.py`` بيشتغل على **الرفع الجديد** بس. أي فيديو اترفع
قبله لسه فهرسه في آخر الملف، يعني المتصفح بينزّله كله قبل ما يشغّل.
الأمر ده بيمرّ على اللي اترفع خلاص ويصلّحه في مكانه.

    python manage.py fix_videos                 # تقرير بس، مايلمسش حاجة
    python manage.py fix_videos --apply         # نقل الفهرس (بدون فقد جودة)
    python manage.py fix_videos --apply --compress   # + إعادة ترميز (محتاج ffmpeg)

نقل الفهرس **مافيهوش فقد جودة ولا بيغيّر الحجم** — نفس البايتات بترتيب
مختلف. الضغط بيعيد الترميز فعلاً، عشان كده محتاج علم صريح.
"""

from __future__ import annotations

import os

from django.core.management.base import BaseCommand

from system import video
from system.models import Asset


class Command(BaseCommand):
    help = "يصلّح بداية تشغيل الفيديوهات المرفوعة (moov + ضغط اختياري)"

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true",
                            help="نفّذ فعلاً. من غيره تقرير بس.")
        parser.add_argument("--compress", action="store_true",
                            help="أعِد الترميز كمان (محتاج ffmpeg، بيقلل الجودة قليلاً).")
        parser.add_argument("--max-height", type=int, default=1280,
                            help="أقصى ارتفاع عند الضغط (افتراضي ١٢٨٠).")
        parser.add_argument("--crf", type=int, default=26,
                            help="جودة الضغط، الأقل أوضح (افتراضي ٢٦).")

    # ------------------------------------------------------------------
    def handle(self, *args, **opts):
        apply_it = opts["apply"]
        do_compress = opts["compress"]

        if do_compress and not video.available():
            self.stderr.write(self.style.ERROR(
                "ffmpeg مش متثبّت — الضغط مش هيشتغل. نصّبه الأول، أو شغّل "
                "الأمر من غير --compress عشان تنقل الفهرس على الأقل."))
            return

        rows = list(Asset.objects.filter(kind="video").order_by("id"))
        if not rows:
            self.stdout.write("مفيش فيديوهات مرفوعة.")
            return

        late = fixed = shrunk = missing = 0
        saved = 0

        for asset in rows:
            path = self._path(asset)
            if not path or not os.path.exists(path):
                missing += 1
                continue

            with open(path, "rb") as fh:
                data = fh.read()
            before = len(data)
            is_late = video.moov_is_late(data)
            if is_late:
                late += 1

            note = []
            if is_late:
                note.append("الفهرس في الآخر")
            if before > 2 * 1024 * 1024:
                note.append(f"{round(before / 1024 / 1024, 2)} ميجا")
            self.stdout.write(
                f"[{asset.pk:>5}] {asset.original_name[:40]:<40} "
                + (" · ".join(note) if note else "سليم")
            )

            if not apply_it:
                continue

            new = None
            if do_compress:
                new = self._compress(path, opts["max_height"], opts["crf"])
                if new and len(new) >= before:
                    new = None            # الضغط طلع أكبر — نسيب الأصل
            if new is None and is_late:
                new = video.faststart_bytes(data)
            if not new:
                continue

            # الكتابة في ملف مؤقت جنبه ثم الاستبدال — عشان لو حصل خطأ
            # في النص مايفضلش الملف الأصلي مقصوص.
            tmp = path + ".fix"
            with open(tmp, "wb") as fh:
                fh.write(new)
            os.replace(tmp, path)

            asset.size_bytes = len(new)
            asset.save(update_fields=["size_bytes"])
            fixed += 1
            if len(new) < before:
                shrunk += 1
                saved += before - len(new)

        self.stdout.write("")
        self.stdout.write(f"فيديوهات: {len(rows)} · فهرسها في الآخر: {late}"
                          + (f" · ملفات ناقصة: {missing}" if missing else ""))
        if apply_it:
            self.stdout.write(self.style.SUCCESS(
                f"اتصلّح: {fixed} · اتصغّر: {shrunk} · "
                f"وفّرنا {round(saved / 1024 / 1024, 2)} ميجا"))
        else:
            self.stdout.write(self.style.WARNING(
                "ده تقرير بس. ضيف --apply عشان يتنفّذ."))

    # ------------------------------------------------------------------
    def _path(self, asset):
        try:
            return asset.file.path
        except Exception:
            return ""

    def _compress(self, path, max_height, crf):
        import subprocess, tempfile
        out = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as fh:
                out = fh.name
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", path,
                 "-vf", f"scale=-2:'min({max_height},ih)'",
                 "-c:v", "libx264", "-preset", "slow", "-crf", str(crf),
                 "-pix_fmt", "yuv420p", "-profile:v", "main",
                 "-movflags", "+faststart",
                 "-c:a", "aac", "-b:a", "64k", "-ac", "1", out],
                check=True, timeout=600,
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            with open(out, "rb") as fh:
                return fh.read()
        except Exception as exc:
            self.stderr.write(self.style.WARNING(f"  فشل الضغط: {exc}"))
            return None
        finally:
            if out and os.path.exists(out):
                try:
                    os.unlink(out)
                except OSError:
                    pass
