import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("system", "0011_rsvpresponse_answers"),
    ]

    operations = [
        # الباقة بقت اختيارية للدعوة — «بدون باقة» = كل المزايا مفتوحة
        migrations.AlterField(
            model_name="invitation",
            name="plan",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="invitations", to="system.plan",
                verbose_name="الباقة",
            ),
        ),
        migrations.AddField(
            model_name="sitesetting",
            name="plans_public",
            field=models.BooleanField(
                default=True,
                help_text="اقفله لو مش عايز تعلن أسعارك. قسم الباقات بيختفي من "
                          "الصفحة الرئيسية ومعاه زرار «شوف الباقات» ولينك "
                          "«الباقات» في القايمة. الباقات نفسها مابتتمسحش.",
                verbose_name="إظهار الباقات والأسعار في الموقع",
            ),
        ),
    ]
