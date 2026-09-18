"""إجابات الأسئلة الإضافية في رد تأكيد الحضور."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0010_invitation_venue_token"),
    ]

    operations = [
        migrations.AddField(
            model_name="rsvpresponse",
            name="answers",
            field=models.JSONField(
                blank=True, default=list, verbose_name="إجابات إضافية",
            ),
        ),
    ]
