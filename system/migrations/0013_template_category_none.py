from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0012_invitation_plan_optional_sitesetting_plans_public"),
    ]

    operations = [
        # «بدون» في التصنيف + المعرّف والمجموعة بقوا اختياريين في لوحة الأدمن
        migrations.AlterField(
            model_name="template",
            name="category",
            field=models.CharField(
                choices=[
                    ("none", "بدون"),
                    ("wedding", "زفاف"),
                    ("engagement", "خطوبة"),
                    ("henna", "حنة"),
                    ("katb_ketab", "كتب كتاب"),
                    ("birthday", "عيد ميلاد"),
                    ("graduation", "تخرّج"),
                    ("aqiqah", "عقيقة"),
                    ("corporate", "مناسبة عمل"),
                    ("other", "أخرى"),
                ],
                default="wedding", max_length=30, verbose_name="التصنيف",
            ),
        ),
        migrations.AlterField(
            model_name="template",
            name="slug",
            field=models.SlugField(blank=True, max_length=140, unique=True,
                                   verbose_name="المعرّف"),
        ),
        migrations.AlterField(
            model_name="template",
            name="collection",
            field=models.CharField(blank=True, default="Premium", max_length=40,
                                   verbose_name="المجموعة"),
        ),
    ]
