"""رمز رابط بوابة القاعة.

الحقل فريد، فمينفعش نضيفه بقيمة واحدة على كل الصفوف الموجودة — الإضافة
بتتم على تلات خطوات: عمود فاضي، ملء بقيم عشوائية، وبعدين القيد الفريد.
"""

from django.db import migrations, models

import system.models


def fill_venue_tokens(apps, schema_editor):
    Invitation = apps.get_model("system", "Invitation")
    for pk in list(
        Invitation.objects.filter(venue_token="").values_list("pk", flat=True)
    ):
        Invitation.objects.filter(pk=pk).update(
            venue_token=system.models._new_venue_token()
        )


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0009_documentmediakey"),
    ]

    operations = [
        migrations.AddField(
            model_name="invitation",
            name="venue_token",
            field=models.CharField(
                default="", editable=False, max_length=40,
                verbose_name="رمز رابط القاعة",
            ),
        ),
        migrations.RunPython(fill_venue_tokens, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="invitation",
            name="venue_token",
            field=models.CharField(
                db_index=True, default=system.models._new_venue_token,
                editable=False, max_length=40, unique=True,
                verbose_name="رمز رابط القاعة",
            ),
        ),
    ]
