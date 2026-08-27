"""يفحص عدّاد قالب مستورد: الماركب والسكربت والموعد المخزّن.

قراءة بس. الهدف الرد على تلات أسئلة قبل أي تعديل:

١. أنهي كلاسات/معرّفات حوالين العدّاد — عشان المحرر يعرف يلاقيه.
٢. هل سكربت القالب فيه تاريخ مكتوب بالإيد يطابق ``_COUNTDOWN_DATE_RE``
   — لو لأ، تغيير الموعد من المحرر مش هيعمل حاجة مهما ظهرت الخانة.
٣. هل فيه ``countdown_date`` متخزّن في المستند خلاص.

    python manage.py inspect_countdown 9
"""

import json
import re

from django.core.management.base import BaseCommand

from system.models import Template

# نفس الـregex بتاع renderer.py — لو اتغيّر هناك غيّره هنا
_DATE_RE = re.compile(
    r"\b(var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*new\s+Date\(\s*"
    r"(?:\d{4}\s*,[^)]*|['\"][^'\"]{4,}['\"]\s*|\d{9,}\s*)\)"
)
_ANY_DATE_RE = re.compile(r"new\s+Date\s*\([^)]*\)")
_CLASS_RE = re.compile(r'class="([^"]{1,200})"')
_ID_RE = re.compile(r'id="([^"]{1,80})"')
_HINT_RE = re.compile(r"countdown|timer|cd-|time-block|number-wrap|"
                      r"days|hours|minutes|seconds", re.I)


class Command(BaseCommand):
    help = "يعرض تفاصيل عدّاد قالب مستورد من غير أي تعديل."

    def add_arguments(self, parser):
        parser.add_argument("template_id", type=int)

    def handle(self, *args, **options):
        try:
            template = Template.objects.get(pk=options["template_id"])
        except Template.DoesNotExist:
            self.stdout.write(self.style.ERROR("مفيش قالب بالرقم ده."))
            return

        document = template.document or {}
        self.stdout.write(f"قالب #{template.pk}: {template.name}\n")

        blocks = document.get("blocks") or []
        for index, block in enumerate(blocks):
            if block.get("type") != "custom_html":
                continue
            props = block.get("props") or {}
            html = str(props.get("html") or "")
            if not _HINT_RE.search(html):
                continue

            self.stdout.write(self.style.SUCCESS(
                f"\n— قسم #{index} ({block.get('id') or '?'}) —"))
            stored = props.get("countdown_date")
            self.stdout.write(f"countdown_date المخزّن: {stored!r}")

            # ١) الكلاسات والمعرّفات المرشّحة
            classes = set()
            for value in _CLASS_RE.findall(html):
                for token in value.split():
                    if _HINT_RE.search(token):
                        classes.add(token)
            ids = {v for v in _ID_RE.findall(html) if _HINT_RE.search(v)}
            self.stdout.write(f"كلاسات مرشّحة ({len(classes)}): "
                              f"{sorted(classes)[:25]}")
            self.stdout.write(f"معرّفات مرشّحة: {sorted(ids)[:15]}")

            # ٢) هل المحرر الحالي هيلاقيه؟
            current_ui = re.search(
                r"countdowncontainer|countdown[-_ ]?(?:grid|wrapper|container|heading|sub)|"
                r"section-countdown|time-block|number-wrap|"
                r"(?:^|[\s\"'_-])cd-(?:days?|hours?|mins?|minutes?|secs?|seconds?)"
                r"(?:$|[\s\"'_-])",
                html,
                re.I,
            )
            self.stdout.write(
                ("المحرر الحالي بيلاقيه: نعم" if current_ui else
                 self.style.ERROR("المحرر الحالي بيلاقيه: لأ ← الخانة "
                                  "مابتظهرش، وده سبب «مش راضى يتغيّر»")))

        # ٣) السكربت
        # متخزّنة في حقل JSON على القالب نفسه (models.py سطر 171)
        runtime = getattr(template, "runtime_scripts", None) or []
        self.stdout.write(self.style.SUCCESS(
            f"\n— السكربتات ({len(runtime)}) —"))
        matched = False
        for item in runtime:
            if not isinstance(item, dict):
                continue
            code = str(item.get("code") or "")
            if item.get("src"):
                self.stdout.write(f"  ملف خارجي: {item['src'][:70]}")
                continue
            if not code:
                continue
            hit = _DATE_RE.search(code)
            if hit:
                matched = True
                self.stdout.write(self.style.SUCCESS(
                    f"  ✔ يطابق: {hit.group(0)[:90]}"))
            else:
                others = _ANY_DATE_RE.findall(code)
                if others:
                    self.stdout.write(self.style.WARNING(
                        f"  ✖ فيه تواريخ بس مش مطابقة للـregex: "
                        f"{[o[:60] for o in others[:4]]}"))

        if matched:
            self.stdout.write(self.style.SUCCESS(
                "\nالخلاصة: تبديل الموعد هيشتغل — المشكلة في الواجهة بس."))
        else:
            self.stdout.write(self.style.ERROR(
                "\nالخلاصة: مفيش تاريخ مكتوب بالإيد يطابق الـregex. "
                "إصلاح الواجهة لوحده مش هيكفي — ابعتلي المخرجات."))
