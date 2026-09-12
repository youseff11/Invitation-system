"""فهرس الوسائط — أنهي أصل مستخدم في أنهي مستند.

السؤال ده كان بيتجاوب عليه بمسح **كل** مستندات القوالب والدعوات على كل
فتحة للمحرر (``_asset_usage_map`` في ``views.py``): قراءة كل مستند من
قاعدة البيانات، ``json.dumps`` ليه، ومرور regex عليه.

**مقيس على السيرفر الحقيقي (١٢ سبتمبر ٢٠٢٦):** النقطة اللي مابتعملش غير
المسحة دي (``/api/assets/``) أخدت **١٦.٤ ثانية** لترجّع ٩٦ كيلوبايت،
بينما ``preview-frame`` اللي بيرسم المستند كله بياخد **١.١ ثانية**. يعني
المسحة لوحدها ~٨٠٪ من زمن فتح المحرر.

الحل: **نقلب اتجاه الحساب**. كل مستند لما *يتحفظ* بنستخرج منه مفاتيح
الوسائط ونسجّلها في جدول مفهرس، وفتح المحرر بقى استعلام ``IN`` رخيص.
مفيش كاش ولا بصمة ولا نتيجة قديمة: الفهرس بيتحدّث في نفس معاملة الحفظ.

## ليه المفتاح هو المجلد السداسي مش اسم الملف

مسار أي أصل شكله ``assets/YYYY/MM/<12 hex>/<اسم الملف>`` (شوف
``_asset_path`` في ``models.py``)، والـ١٢ خانة دي ``uuid4`` فريدة لكل
رفعة. اخترناها لأنها **ASCII دايماً**، فبتظهر بنفس الشكل بالظبط في:

- المسار الخام المحفوظ في ``asset.file.name``
- الرابط المكوّد اللي بيتكتب في المستند لما اسم الملف عربي
  (``/media/assets/2026/08/9c92922b3227/%D8%A7%D9%84%D9%81...``)

اسم الملف نفسه مكنش هيتطابق في الحالتين — ده مقيس على قالب منشور فعلاً.
"""

from __future__ import annotations

import json
import re

# مجلد الرفعة السداسي. ``finditer`` على نص المستند بيجيب كل الأصول
# المذكورة فيه في مرور واحد — الخام والمكوّد سواء.
MEDIA_KEY_RE = re.compile(r"assets/\d{4}/\d{2}/([0-9a-f]{12})/")

# SQLite بيحدّ عدد متغيّرات الاستعلام (٩٩٩ في البناءات القديمة). ٣٠٠ أصل
# × ٣ ملفات = ٩٠٠ مفتاح، على الحافة — فبنقسّم على دفعات.
_CHUNK = 300


def keys_in_text(text: str) -> set[str]:
    """كل مفاتيح الوسائط المذكورة في نص."""
    return {match.group(1) for match in MEDIA_KEY_RE.finditer(text or "")}


def keys_in_document(document) -> set[str]:
    """كل مفاتيح الوسائط المذكورة في مستند (أي شكل JSON).

    بنسلسل المستند لنص بدل ما نمشي على الشجرة: كود المصمّم في «كود متقدّم»
    بيبقى نص HTML فيه ``src="/media/..."`` جوّه قيمة واحدة، فالمرور على
    المفاتيح والقيم مكانش هيشوفه.
    """
    if not document:
        return set()
    if isinstance(document, str):
        return keys_in_text(document)
    try:
        text = json.dumps(document, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return set()
    return keys_in_text(text)


def keys_of_asset(asset) -> set[str]:
    """مفاتيح الأصل الواحد — الملف والمصغّرة والأصل، لكل واحد مجلده."""
    names = [
        getattr(asset.file, "name", "") or "",
        getattr(asset.thumb, "name", "") or "",
        getattr(asset.source, "name", "") or "",
    ]
    keys: set[str] = set()
    for name in names:
        keys |= keys_in_text(name)
    return keys


def document_of(instance):
    """مستند القالب/الدعوة، حتى لو الحقل مؤجّل (``defer``).

    من غير ده الوصول لـ``instance.document`` على كائن جاي من استعلام
    مؤجّل بيعمل رحلة زيادة لقاعدة البيانات — وده بالظبط اللي بنحاول
    نتجنّبه في قوايم اللوحة.
    """
    if "document" not in instance.get_deferred_fields():
        return instance.document
    return (type(instance).objects
            .filter(pk=instance.pk)
            .values_list("document", flat=True)
            .first())


def rebuild_for(*, template=None, invitation=None) -> int:
    """يعيد بناء صف الفهرس لمستند واحد. بيتنده من إشارة ``post_save``.

    بيرجّع عدد المفاتيح المسجّلة. الحذف + الإدراج مقصود إنه بسيط: عدد
    المفاتيح في المستند الواحد عشرات مش آلاف.
    """
    from .models import DocumentMediaKey

    owner = template if template is not None else invitation
    if owner is None or owner.pk is None:
        return 0

    if template is not None:
        rows = DocumentMediaKey.objects.filter(template=template)
    else:
        rows = DocumentMediaKey.objects.filter(invitation=invitation)

    keys = keys_in_document(document_of(owner))
    rows.delete()
    if keys:
        DocumentMediaKey.objects.bulk_create([
            DocumentMediaKey(key=key, template=template, invitation=invitation)
            for key in sorted(keys)
        ])
    return len(keys)


def used_keys(keys) -> set[str]:
    """اللي مذكور فعلاً في أي مستند، من المفاتيح المطلوبة."""
    from .models import DocumentMediaKey

    wanted = sorted(set(keys))
    if not wanted:
        return set()
    found: set[str] = set()
    for start in range(0, len(wanted), _CHUNK):
        batch = wanted[start:start + _CHUNK]
        found.update(
            DocumentMediaKey.objects
            .filter(key__in=batch)
            .values_list("key", flat=True)
            .distinct()
        )
    return found


def rebuild_all(*, template_model=None, invitation_model=None, media_key_model=None) -> dict:
    """يملا الفهرس من الصفر لكل القوالب والدعوات.

    الموديلات بتتبعت كوسائط عشان الهجرة (migration) تقدر تنده الدالة دي
    بموديلاتها التاريخية.
    """
    from django.db import transaction

    if template_model is None or invitation_model is None or media_key_model is None:
        from .models import DocumentMediaKey, Invitation, Template
        template_model = template_model or Template
        invitation_model = invitation_model or Invitation
        media_key_model = media_key_model or DocumentMediaKey

    counts = {"templates": 0, "invitations": 0, "keys": 0}
    with transaction.atomic():
        media_key_model.objects.all().delete()
        rows = []
        for pk, document in template_model.objects.values_list("pk", "document"):
            counts["templates"] += 1
            for key in sorted(keys_in_document(document)):
                rows.append(media_key_model(key=key, template_id=pk))
        for pk, document in invitation_model.objects.values_list("pk", "document"):
            counts["invitations"] += 1
            for key in sorted(keys_in_document(document)):
                rows.append(media_key_model(key=key, invitation_id=pk))
        media_key_model.objects.bulk_create(rows, batch_size=500)
        counts["keys"] = len(rows)
    return counts
