"""يعيد توليد أغلفة الفيديو المبكسلة (poster / thumb).

الأغلفة القديمة اتولّدت في المتصفح على canvas بحد ٦٤٠px، فالفيديو
‎1080×1920‎ غلافه اتخزّن ‎360×640‎ وبيتمطّ تلات أضعاف على شاشة التليفون.
التعديل في ``video.py`` و``views.py`` بيشتغل على **الرفع الجديد** بس —
الأمر ده بيصلّح اللي اترفع خلاص.

    python manage.py fix_posters                # تقرير بس، مايلمسش حاجة
    python manage.py fix_posters --apply        # يعيد التوليد فعلاً
    python manage.py fix_posters --apply --all  # حتى الأغلفة السليمة

**بيكتب فوق نفس الملف بنفس الاسم.** ده مقصود: رابط الغلاف متخزّن كنص
جوّه مستندات القوالب والدعوات (``settings.intro_poster``)، فلو حفظنا
باسم جديد المستندات هتفضل بتشاور على الملف القديم والصفحة ماتتغيّرش —
وده اللي حصل فعلاً في أول نسخة من الأمر ده.

الغلاف بيتاخد من **ملف الفيديو المخزّن** بـffmpeg وبمقاسه الأصلي. لو
الفيديو نفسه اتضغط وقت الرفع، الغلاف هيبقى بجودة الفيديو المضغوط — مش
أحسن منه. الأصل مش محفوظ لملفات الفيديو فمفيش طريقة نرجع أبعد من كده.

بعد التنفيذ: الرابط ما اتغيّرش، فمتصفح شاف الصفحة قبل كده ممكن يفضل
مخبّي الصورة القديمة. جرّب في تبويب خاص أو بمسح الكاش.
"""

from __future__ import annotations

import os

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand

from system import video
from system.models import Asset, IntroVideo, Invitation, Template

# الغلاف اللي أطول ضلع فيه أصغر من كده = مولّد من canvas القديم
SUSPECT_MAX_EDGE = 1000

# لاحقة الغلاف المولّد تلقائياً. أي غلاف باسم تاني = صورة اختارها
# صاحب الدعوة بنفسه، وماينفعش نلمسها.
AUTO_SUFFIXES = ("-thumb.jpg", "-poster.jpg")


class Command(BaseCommand):
    help = "يعيد توليد أغلفة الفيديو المبكسلة بـffmpeg (بيكتب فوق نفس الملف)"

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

            target = getattr(obj, field, None)
            before = self._image_size(target)
            name = (getattr(obj, "original_name", "") or getattr(obj, "name", "")
                    or os.path.basename(path))[:40]

            if before and max(before) >= SUSPECT_MAX_EDGE and not force:
                self.stdout.write(f"[{label} {obj.pk:>5}] {name:<40} "
                                  f"سليم ({before[0]}×{before[1]})")
                skipped += 1
                continue

            state = f"{before[0]}×{before[1]}" if before else "من غير غلاف"
            line = f"[{label} {obj.pk:>5}] {name:<40} {state}"

            if not apply_it:
                self.stdout.write(self.style.WARNING(line + " ← إعادة توليد"))
                continue

            data = self._frame(path)
            if not data:
                self.stdout.write(self.style.ERROR(line + " ← فشل"))
                failed += 1
                continue

            existing = self._path(target) if target else ""
            if existing:
                # الكتابة في ملف مؤقت جنبه ثم الاستبدال — لو حصل خطأ في
                # النص مايفضلش الغلاف الأصلي مقصوص
                tmp = existing + ".new"
                with open(tmp, "wb") as fh:
                    fh.write(data)
                os.replace(tmp, existing)
            else:
                stem = os.path.splitext(os.path.basename(path))[0][:60]
                target.save(f"{stem}-poster.jpg", ContentFile(data), save=False)
                obj.save(update_fields=[field, "updated_at"])

            after = self._image_size(getattr(obj, field, None))
            done += 1
            self.stdout.write(self.style.SUCCESS(
                line + " ← " + (f"{after[0]}×{after[1]}" if after else "اتولّد")))

        self.stdout.write("")
        self.stdout.write(f"الإجمالي: {len(rows)} · سليم: {skipped}"
                          + (f" · فشل: {failed}" if failed else ""))
        if apply_it:
            self.stdout.write(self.style.SUCCESS(f"اتولّد من جديد: {done}"))
        else:
            self.stdout.write(self.style.WARNING(
                "ده تقرير بس. ضيف --apply عشان يتنفّذ."))

        self._relink(apply_it)

    # ------------------------------------------------------------------
    def _relink(self, apply_it: bool):
        """يظبّط ``settings.intro_poster`` في المستندات على الغلاف الحالي.

        رابط الغلاف متخزّن **كنص** جوّه مستند القالب/الدعوة. لو نسخة
        قديمة من الأمر ده حفظت الغلاف باسم جديد، المستند بيفضل بيشاور
        على الملف القديم المبكسل والصفحة ماتتغيّرش مهما أعدنا التوليد.

        بنربط بالفيديو مش بالغلاف: ``settings.intro_video`` رابط
        الفيديو، ومنه بنعرف الأصل وغلافه الحالي بالظبط.

        **مابنلمسش غلاف اختاره صاحب الدعوة**: بنستبدل بس لو اسم الغلاف
        الحالي هو الاسم المولّد تلقائياً لنفس الفيديو.
        """
        posters = {}                       # رابط الفيديو → رابط غلافه الحالي
        for asset in Asset.objects.filter(kind="video"):
            if asset.file and asset.thumb:
                posters[asset.file.url] = asset.thumb.url
        for clip in IntroVideo.objects.all():
            if clip.file and clip.poster:
                posters[clip.file.url] = clip.poster.url
        if not posters:
            return

        changed = 0
        for model, label in ((Template, "Template"), (Invitation, "Invitation")):
            # من غير ‎only()‎ عن قصد: ‎Invitation.save()‎ بيلمس حقول تانية
            # (slug، العنوان، التوكنات)، والحقل المؤجّل بيتسحب من
            # الداتابيز لوحده وقت الحفظ
            for obj in model.objects.all():
                doc = obj.document if isinstance(obj.document, dict) else {}
                settings = doc.get("settings")
                if not isinstance(settings, dict):
                    continue
                video_url = str(settings.get("intro_video") or "")
                fresh = posters.get(video_url)
                if not fresh:
                    continue
                current = str(settings.get("intro_poster") or "")
                if current == fresh:
                    continue
                if current and not self._is_auto_poster(current, video_url):
                    continue               # غلاف مختار بالإيد — سيبه
                self.stdout.write(self.style.WARNING(
                    f"[{label} {obj.pk:>5}] غلاف قديم في المستند ← "
                    + os.path.basename(fresh)))
                changed += 1
                if not apply_it:
                    continue
                settings["intro_poster"] = fresh
                obj.document = doc
                obj.save(update_fields=["document", "updated_at"])

        if changed:
            self.stdout.write(self.style.SUCCESS(
                f"مستندات اتظبطت: {changed}") if apply_it else self.style.WARNING(
                f"مستندات محتاجة تظبيط: {changed}"))

    @staticmethod
    def _is_auto_poster(poster_url: str, video_url: str) -> bool:
        """هل الغلاف ده مولّد تلقائياً لنفس الفيديو ده؟"""
        stem = os.path.splitext(os.path.basename(video_url))[0]
        base = os.path.basename(poster_url)
        return bool(stem) and any(
            base == f"{stem}{suffix}" for suffix in AUTO_SUFFIXES)

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
