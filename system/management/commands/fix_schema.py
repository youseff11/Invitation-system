"""يكشف ويشيل الأعمدة اليتيمة من قاعدة البيانات.

عمود يتيم = موجود في الجدول لكن مفيش حقل مقابل له في الموديل ولا في أي
migration. بيحصل لما حد يعدّل ملف قاعدة البيانات ببرنامج خارجي، أو لما
migration يقف في نصّه.

الضرر: لو العمود ‎NOT NULL‎ ومن غير قيمة افتراضية، Django مابيعرفش
بوجوده فمابيبعتش له قيمة، وأي إضافة صف جديد بترمي:

    IntegrityError: NOT NULL constraint failed: system_template.cover_url_2

والنتيجة إن حاجة زي استيراد قالب تقف تماماً من غير سبب ظاهر.

    python manage.py fix_schema            # يعرض بس
    python manage.py fix_schema --apply    # ياخد نسخة احتياطية ويشيل
"""

import shutil
import time
from pathlib import Path

from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db import connection


class Command(BaseCommand):
    help = "يكشف الأعمدة اليتيمة في قاعدة البيانات ويشيلها."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="نفّذ الحذف فعلاً. من غيره بيعرض اللي هيتعمل بس.",
        )

    def handle(self, *args, **options):
        if connection.vendor != "sqlite":
            raise CommandError(
                "الأمر ده مكتوب لـSQLite بس. مع قاعدة بيانات تانية "
                "استعمل migration عادي."
            )

        orphans: list[tuple[str, str, bool]] = []

        with connection.cursor() as cursor:
            for model in apps.get_models():
                table = model._meta.db_table
                cursor.execute(
                    "SELECT name FROM sqlite_master "
                    "WHERE type='table' AND name=%s", [table]
                )
                if not cursor.fetchone():
                    continue

                # أسماء الأعمدة اللي الموديل يعرفها
                known = set()
                for field in model._meta.local_fields:
                    known.add(field.column)

                cursor.execute(f'PRAGMA table_info("{table}")')
                for _cid, name, _type, notnull, default, _pk in cursor.fetchall():
                    if name in known:
                        continue
                    blocking = bool(notnull) and default is None
                    orphans.append((table, name, blocking))

        if not orphans:
            self.stdout.write(self.style.SUCCESS(
                "مفيش أعمدة يتيمة — الجداول متطابقة مع الموديلز."))
            return

        for table, name, blocking in orphans:
            mark = self.style.ERROR(" ← بيمنع أي إضافة صف") if blocking else ""
            self.stdout.write(f"عمود يتيم: {table}.{name}{mark}")

        if not options["apply"]:
            self.stdout.write(self.style.WARNING(
                f"\nعرض بس: {len(orphans)} عمود. "
                "ضيف ‎--apply‎ عشان يتشالوا (مع نسخة احتياطية)."))
            return

        db_path = Path(connection.settings_dict["NAME"])
        if db_path.exists():
            backup = db_path.with_name(
                f"{db_path.name}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
            shutil.copy2(db_path, backup)
            self.stdout.write(f"نسخة احتياطية: {backup}")

        # SQLite 3.35+ بيدعم DROP COLUMN مباشرة
        with connection.cursor() as cursor:
            for table, name, _blocking in orphans:
                try:
                    cursor.execute(f'ALTER TABLE "{table}" DROP COLUMN "{name}"')
                    self.stdout.write(self.style.SUCCESS(
                        f"اتشال: {table}.{name}"))
                except Exception as exc:
                    self.stdout.write(self.style.ERROR(
                        f"فشل شيل {table}.{name}: {type(exc).__name__}: {exc}"))

        self.stdout.write(self.style.SUCCESS("خلص. جرّب الاستيراد تاني."))
