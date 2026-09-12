"""فهرس الوسائط + ملؤه من المستندات الموجودة.

الملء داخل الهجرة عن قصد: من غيره أول فتحة للمحرر بعد النشر هتلاقي
الفهرس فاضي فكل الصور تبان «مش مستخدمة»، والحذف يبقى خطر. ``migrate``
بينفّذه لوحده فمافيش خطوة يدوية على السيرفر.
"""

import django.db.models.deletion
from django.db import migrations, models

from system import mediakeys


def fill(apps, schema_editor):
    mediakeys.rebuild_all(
        template_model=apps.get_model("system", "Template"),
        invitation_model=apps.get_model("system", "Invitation"),
        media_key_model=apps.get_model("system", "DocumentMediaKey"),
    )


def clear(apps, schema_editor):
    apps.get_model("system", "DocumentMediaKey").objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0008_invitation_client_token"),
    ]

    operations = [
        migrations.CreateModel(
            name="DocumentMediaKey",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True,
                                           serialize=False, verbose_name="ID")),
                ("key", models.CharField(db_index=True, max_length=12,
                                         verbose_name="مفتاح الأصل")),
                ("invitation", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="media_keys", to="system.invitation")),
                ("template", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="media_keys", to="system.template")),
            ],
            options={
                "verbose_name": "مفتاح وسائط",
                "verbose_name_plural": "مفاتيح الوسائط",
            },
        ),
        migrations.AddIndex(
            model_name="documentmediakey",
            index=models.Index(fields=["template", "key"],
                               name="system_docu_templat_9c1a3f_idx"),
        ),
        migrations.AddIndex(
            model_name="documentmediakey",
            index=models.Index(fields=["invitation", "key"],
                               name="system_docu_invitat_4b7e2d_idx"),
        ),
        migrations.RunPython(fill, clear),
    ]
