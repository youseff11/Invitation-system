from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("system", "0001_initial")]

    operations = [
        migrations.AddField(
            model_name="template",
            name="preview_render",
            field=models.JSONField(
                blank=True,
                default=dict,
                editable=False,
                verbose_name="نسخة المعاينة الجاهزة",
            ),
        ),
    ]
