"""إشارات الحفظ — بتخلّي فهرس الوسائط متزامن لوحده.

اتعملت بإشارة مش بنداء صريح في كل view عن قصد: المستند بيتحفظ من أماكن
كتير (المحرر، لوحة الأدمن، الاستيراد، أوامر الإدارة، الشِل)، وأي مسار
يتنسي بيخلّي الفهرس ناقص — والصورة تبان «مش مستخدمة» وهي مستخدمة،
فتتحذف. الإشارة بتغطّي كل المسارات مرة واحدة.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from . import mediakeys
from .models import Invitation, Template


def _should_skip(kwargs) -> bool:
    # ``raw=True`` معناها ``loaddata`` — الموديلات لسه مش متسقة، والفهرس
    # بيتبني بعدها بأمر ``rebuild_media_keys``.
    if kwargs.get("raw"):
        return True
    # حفظ بحقول محدّدة مش فيها المستند (تغيير حالة، عدّاد مشاهدات…)
    fields = kwargs.get("update_fields")
    return fields is not None and "document" not in fields


@receiver(post_save, sender=Template, dispatch_uid="system.mediakeys.template")
def _template_saved(sender, instance, **kwargs):
    if _should_skip(kwargs):
        return
    mediakeys.rebuild_for(template=instance)


@receiver(post_save, sender=Invitation, dispatch_uid="system.mediakeys.invitation")
def _invitation_saved(sender, instance, **kwargs):
    if _should_skip(kwargs):
        return
    mediakeys.rebuild_for(invitation=instance)
