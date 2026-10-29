"""خدمات مشتركة بين واجهة JSON (‎/api/v1/‎) وأوامر الإدارة — اتنقلت من ‎views.py‎ القديم لما اتحذف الموقع الكلاسيك.

* الأصول: رفع وقص وحذف ملفات المحرر وحساب الاستخدام (‎_upload_asset_for_editor‎ …).
* الدعوات: نسخ وحذف دعوة، لغة الطلب، إعدادات التمرير والمعاينة، صور المشاركة.
* الضيوف: مسح الدخول وإعدادات التصريح وإجابات RSVP.
الدوال بتفضل بنفس أسمائها وسلوكها بالظبط.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import mimetypes
import re
from pathlib import Path
from urllib.parse import quote
from django.conf import settings
from django.db import transaction
from django.db.models import F, Q, Sum
from django.http import JsonResponse
from django.urls import reverse
from django.utils import timezone
from . import blocks as blocks_engine
from .models import Asset, CustomFont, Customer, FavoriteBlock, Invitation, SiteSetting, Template
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db.models.fields.files import FieldFile
from . import images, mediakeys, video


logger = logging.getLogger(__name__)


MAX_ASSET_BYTES = 8 * 1024 * 1024


# الفيديو ليه حد أعلى لوحده: صورة بتنضغط لـ٩٨ كيلو، لكن مقطع فرح متصوّر
# بالموبايل ٢٠ ثانية بيطلع ٢٥-٣٥ ميجا قبل الضغط. الحد الأصلي ٨ ميجا كان
# بيرفض أي مقطع حقيقي. الملف بينضغط عندنا لـ٧٢٠p بعد الرفع، والحد ده
# على الأصل قبل الضغط مش بعده.
MAX_VIDEO_BYTES = video.MAX_UPLOAD_BYTES


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}


ALLOWED_AUDIO_TYPES = {"audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav"}


ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime", "video/x-m4v"}


_VIDEO_EXTENSION_TYPES = {
    ".mp4": "video/mp4", ".m4v": "video/mp4",
    ".mov": "video/quicktime", ".webm": "video/webm",
}


_GENERIC_UPLOAD_TYPES = {"", "application/octet-stream", "binary/octet-stream"}


# باقي رسايل المشروع بتستخدم الأرقام العربية، فالرقم المولَّد لازم يمشي
# على نفس النسق — رسالة فيها «40» وسط كلام عربي بتبان غريبة.
_AR_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def _ar_num(n: int) -> str:
    return str(n).translate(_AR_DIGITS)


def _scroll_config(doc_settings: dict, *, editable: bool = False) -> dict:
    """إعدادات التمرير التلقائي اللي بتوصل للمتصفح.

    ``editable`` بيطفّيه: الصفحة ماينفعش تفضل نازلة لوحدها والمستخدم
    بيعدّل فيها من المحرر.
    """
    if editable or not doc_settings.get("auto_scroll"):
        return {"enabled": False}
    return {
        "enabled": True,
        "speed": doc_settings.get("auto_scroll_speed") or "normal",
        "delay": doc_settings.get("auto_scroll_delay") or 0,
        "loop": bool(doc_settings.get("auto_scroll_loop")),
    }


def _lang(request) -> str:
    """اللغة اللي الضيف طلبها من الرابط.

    باراميتر في الرابط مش كوكي: كده الرابط اللي الضيف يبعته لحد تاني
    يفتح بنفس اللغة، والميتا والعنوان بيتبنوا على السيرفر صح.
    """
    asked = (request.GET.get("lang") or "").lower()
    if asked.startswith("en"):
        return "en"
    if asked.startswith("ar"):
        return "ar"
    # مفيش طلب صريح: سيبها فاضية والعارض يرجّع لغة الدعوة الأساسية،
    # سواء كانت عربي أو إنجليزي.
    return ""


def _share_image(request, *candidates) -> dict:
    """صورة معاينة الرابط (``og:image``) كرابط **مطلق** ومعاها مقاسها.

    فيسبوك وماسنجر وميتا بيزنس بيسيبوا الصفحة اللي مالهاش ``og:image``
    من غير صورة خالص — مابيدوّروش على صورة جوّه الصفحة زي ما بيعمل
    واتساب. وده اللي كان بيخلّي **نفس اللينك** يطلّع صورة على واتساب
    ومايطلّعش على ميتا: معاينة القالب ماكانتش بتبعت ``og:image`` أصلاً.

    والرابط لازم يكون مطلق: ``/media/…`` النسبي بيتقبل على واتساب
    وبيتترمي على فيسبوك.

    بياخد أول مصدر فيه قيمة — حقل صورة (``ImageFieldFile``) أو نص.
    المقاس بيتبعت لأن ميتا بيرسم إطار المعاينة قبل ما ينزّل الصورة،
    ومن غير ``og:image:width/height`` بيطلع بإطار غلط في أول مشاركة.
    """
    for source in candidates:
        url, width, height = "", 0, 0
        # ‎isinstance‎ مش ‎hasattr(source, "url")‎: ‎FieldFile.url‎ خاصية
        # بترمي ‎ValueError‎ لو الحقل فاضي، و‎hasattr‎ بيمسك
        # ‎AttributeError‎ بس — فالاستثناء كان بيطلع لبرّه ويكسر الصفحة
        # لأي قالب من غير غلاف.
        if isinstance(source, FieldFile):
            if not source:                          # حقل فاضي
                continue
            try:
                url = source.url
            except ValueError:
                continue
            try:
                width, height = int(source.width), int(source.height)
            except Exception:
                # ملف ناقص أو تخزين بعيد: الصورة تمشي من غير مقاس
                width = height = 0
        else:
            url = (source or "").strip()
        if not url:
            continue
        converted = _share_jpeg_url(request, url)
        if converted:
            return converted
        return {
            "url": request.build_absolute_uri(url),
            "width": width,
            "height": height,
        }
    return {"url": "", "width": 0, "height": 0}


# jpeg وpng بيتخدموا من ‎/media/‎ مباشرة ورد السيرفر فيه نوعهم صح.
_SHARE_DIRECT_EXT = {".jpg", ".jpeg", ".png"}


def _share_source(rel: str):
    """ملف الصورة تحت ``MEDIA_ROOT`` أو None لو المسار بره أو مش صورة."""
    root = Path(settings.MEDIA_ROOT).resolve()
    try:
        src = (root / rel).resolve()
    except (OSError, ValueError):
        return None
    if root not in src.parents or not src.is_file():
        return None
    return root, src


def _share_jpeg(rel: str):
    """نسخة JPEG مخزّنة من الصورة: ``(مسار, عرض, ارتفاع, بصمة)`` أو None.

    البصمة من المسار ووقت التعديل: لو الصورة اتغيّرت الرابط بيتغيّر
    وميتا مابتفضلش ماسكة القديمة.
    """
    found = _share_source(rel)
    if not found:
        return None
    root, src = found
    key = hashlib.sha1(f"{rel}|{src.stat().st_mtime_ns}".encode()).hexdigest()[:16]
    dest = root / "_share" / f"{key}.jpg"
    try:
        if dest.is_file():
            from PIL import Image
            with Image.open(dest) as im:
                width, height = im.size
        else:
            width, height = images.share_jpeg(src, dest)
    except Exception:
        logger.warning("share image conversion failed: %s", rel, exc_info=True)
        return None
    return dest, width, height, key


def _share_jpeg_url(request, url: str):
    """رابط نسخة JPEG لصورة محلية مش jpeg/png، أو None لو مش لازم."""
    from urllib.parse import unquote, urlsplit

    parts = urlsplit(url)
    if parts.netloc and parts.netloc != request.get_host():
        return None                                  # صورة من موقع تاني
    path = unquote(parts.path)
    media = settings.MEDIA_URL
    if not path.startswith(media):
        return None
    rel = path[len(media):]
    if Path(rel).suffix.lower() in _SHARE_DIRECT_EXT:
        return None
    made = _share_jpeg(rel)
    if not made:
        return None
    _dest, width, height, key = made
    # الرابط بينتهي بـ ‎.jpg‎ عشان الكراولر اللي بيحكم بالامتداد يلاقيه
    # صورة، وكمان بيبقى رابط جديد فميتا مابتفضلش ماسكة نتيجة فشل قديمة.
    link = reverse("share_image", args=[rel + ".jpg"]) + f"?v={key[:8]}"
    return {"url": request.build_absolute_uri(link), "width": width, "height": height}


# ==========================================================================
# الموقع العام
# ==========================================================================
# الحقول التقيلة اللي صفحات العرض مابتلمسهاش: مستند القالب ممكن يوصل
# ٣ ميجا، والمعاينة المخزّنة والسكربتات كمان. Django بيحمّل كل الحقول
# افتراضياً، فصفحة بتعرض الاسم والغلاف بس كانت بتقرا وتفكّ عشرات
# الميجات من JSON. قياس على الموقع المباشر: الرئيسية ٤٤٥١ms و«القوالب»
# ٣٠٩٠ms، بينما صفحة مابتلمسش القوالب خالص ١٧٦ms — والناتج ١٢–٢٦ كيلوبايت.
_TEMPLATE_HEAVY_FIELDS = ("document", "preview_render", "runtime_scripts")


def _preview_cta(template) -> dict | None:
    """شريط «عجبك القالب؟» في معاينة القالب.

    بيرجّع ``None`` لو الشريط مطفي — فالقالب ما بيتعرضش أصلاً.
    اسم القالب بيتحط جوّه رسالة الواتساب عشان اللي يوصلك يبقى معروف
    هو شايف إيه من غير ما الزائر يكتب حاجة.
    """
    cfg = SiteSetting.load()
    # شرط الظهور عايش في الموديل عشان اللوحة والمعاينة يقروا نفس الحكم —
    # لما كان مكرر هنا، اللوحة كانت بتقول «ظاهر» والصفحة مابتعرضش حاجة.
    if not cfg.preview_cta_ready:
        return None

    name = template.display_name
    wa = ""
    if cfg.whatsapp_enabled and cfg.whatsapp_digits:
        text = (cfg.whatsapp_message or "").replace("{template}", name)
        wa = f"https://wa.me/{cfg.whatsapp_digits}?text={quote(text)}"

    fb = cfg.facebook_url if cfg.facebook_enabled else ""
    return {"text": cfg.preview_cta_text, "template_name": name,
            "whatsapp": wa, "facebook": fb}


MAX_RSVP_ANSWERS = 30


# نفس الفاصل المستخدم في ‎renderer.RSVP_MULTI_SEP‎ — الاتنين لازم
# يتغيّروا مع بعض، وإلا الاختيارات المحفوظة مش هتترجع متعلّمة تاني.
RSVP_MULTI_SEP = "، "


def _rsvp_answers(request, rsvp_props: dict) -> list[dict]:
    """إجابات الأسئلة الإضافية من الفورم.

    الأسئلة نفسها بتتقرا من **مستند الدعوة** مش من المدخلات: اللي
    بيتبعت من المتصفح هو الإجابة بس، وأي اختيار مش من اختيارات السؤال
    بيتشال. طلب متلاعب فيه مايقدرش يخترع سؤال ولا يحشر نص مكانه.

    نص السؤال بيتخزّن مع الإجابة (مش رقمه بس) عشان الرد يفضل مفهوم لو
    السؤال اتشال أو اتغيّر بعدها.
    """
    out: list[dict] = []
    for index, question in enumerate(rsvp_props.get("questions") or []):
        if not isinstance(question, dict):
            continue
        label = str(question.get("label") or "").strip()
        if not label:
            continue
        kind = question.get("kind") or "choice"
        name = f"q{index}"

        if kind == "choice":
            allowed = [
                str(o.get("label") or "").strip()
                for o in (question.get("options") or [])
                if isinstance(o, dict) and str(o.get("label") or "").strip()
            ]
            if not allowed:
                continue
            if question.get("multiple"):
                picked = [v for v in request.POST.getlist(name) if v in allowed]
                value = RSVP_MULTI_SEP.join(picked[:20])
            else:
                raw = (request.POST.get(name) or "").strip()
                value = raw if raw in allowed else ""
        else:
            limit = 600 if kind == "textarea" else 200
            value = (request.POST.get(name) or "").strip()[:limit]

        if value:
            out.append({"i": index, "q": label[:200], "a": value})
        if len(out) >= MAX_RSVP_ANSWERS:
            break
    return out


def _duplicate_invitation(src):
    """نسخة **دعوة** من دعوة موجودة (مش قالب).

    بتاخد نفس القالب والباقة وبيانات المناسبة والمستند، وبتبدأ مسودة برابط
    ورموز جديدة ومن غير ضيوف ولا ردود ولا مشاهدات.

    العميل بيتنسخ **سجل جديد** بنفس البيانات (مش نفس السجل): لو النسخة
    شاورت على نفس العميل، تغيير اسمه كان بيغيّره في الدعوة الأصلية كمان
    ومحدش يقدر يفصل اسم النسخة عن الأصل. حساب الدخول (‎user‎) مابيتنسخش
    لأنه ‎OneToOne‎.

    مكتبة الصور/الفيديو بتاعة الدعوة (‎Asset.invitation‎) بتتنسخ صفوف
    جديدة بتشاور على **نفس الملفات** — من غيرها النسخة كانت هتعرض
    الصور عادي بس مكتبة المحرر بتاعتها تبان فاضية، ولو الأصل اتحذف
    صفوف الأصول بتتمسح معاه. ‎_delete_asset_files‎ مابيمسحش ملف لسه
    صف تاني بيشاور عليه، فالنسختين آمنين من بعض.
    """
    import copy

    with transaction.atomic():
        customer = Customer.objects.create(
            name=src.customer.name, email=src.customer.email,
            phone=src.customer.phone, notes=src.customer.notes,
        )
        dup = Invitation.objects.create(
            customer=customer, template=src.template, plan=src.plan,
            title=f"{src.title} (نسخة)"[:180],
            status="draft",
            event_type=src.event_type, name_one=src.name_one, name_two=src.name_two,
            event_date=src.event_date, venue=src.venue, address=src.address,
            map_url=src.map_url, whatsapp=src.whatsapp,
            document=copy.deepcopy(src.document),
            expires_at=src.expires_at, password=src.password,
        )
        Asset.objects.bulk_create([
            Asset(
                file=a.file.name, thumb=a.thumb.name or None, source=a.source.name or None,
                kind=a.kind, original_name=a.original_name,
                width=a.width, height=a.height, size_bytes=a.size_bytes,
                invitation=dup, uploaded_by_id=a.uploaded_by_id,
            )
            for a in src.assets.all()
        ])
        Template.objects.filter(pk=src.template_id).update(usage_count=F("usage_count") + 1)
    return dup


def _delete_invitation(inv):
    """حذف دعوة بكل ضيوفها وردودها + ملفاتها اللي مابقتش مستخدمة.

    ‎CASCADE‎ بيمسح صفوف الأصول بس مش الملفات نفسها، فبنجمعها قبل الحذف
    ونمسح الملف بعده **لو** مفيش مستند تاني بيستخدمه ولا صف تاني
    بيشاور عليه (زي نسخة من نفس الدعوة).
    """
    assets = list(inv.assets.all())
    with transaction.atomic():
        inv.delete()
    if assets:
        usage = _asset_usage_map(assets)
        for asset in assets:
            if not usage.get(asset.pk):
                _delete_asset_files(asset)


def _rsvp_pass_enabled(invitation) -> bool:
    """مفتاح «إظهار تصريح الدخول (QR)» في بلوك RSVP بتاع الدعوة.

    ‎True‎ لو مفيش بلوك RSVP أصلاً أو المفتاح ناقص — المستندات المحفوظة
    قبل الحقل ده لازم تفضل شغالة زي ما هي.
    """
    for block in invitation.get_document().get("blocks", []):
        if block.get("type") == "rsvp" and block.get("visible", True):
            return (block.get("props") or {}).get("show_pass") is not False
    return True


def _favorite_payload(favorite):
    block = favorite.block_data if isinstance(favorite.block_data, dict) else {}
    return {
        "id": favorite.pk,
        "name": favorite.name,
        "blockType": favorite.block_type,
        "block": block,
    }


def _favorites_json():
    return [_favorite_payload(item) for item in FavoriteBlock.objects.all()]


_EDITOR_BLOB_CACHE: dict = {}


def _editor_schema_blob() -> tuple[str, str]:
    """(البصمة، الحمولة) للسكيما. بتتحسب مرة واحدة لكل عملية تشغيل.

    السكيما مشتقّة من الكود نفسه، فمابتتغيّرش غير مع نشر جديد — والبصمة
    من محتواها فبتتغيّر لوحدها ساعتها.
    """
    cached = _EDITOR_BLOB_CACHE.get("schema")
    if cached:
        return cached
    payload = json.dumps(blocks_engine.editor_schema(), ensure_ascii=False, default=str)
    stamp = hashlib.sha1(payload.encode("utf-8")).hexdigest()[:12]
    cached = (stamp, payload)
    _EDITOR_BLOB_CACHE["schema"] = cached
    return cached


def _font_payload(font):
    return {
        "id": font.pk,
        "name": font.name,
        "nameEn": font.name_en,
        "label": font.name,
        "value": font.css_family + ", sans-serif",
        "family": font.family,
        "url": font.url,
        "weight": font.weight,
        "style": font.style,
    }


def _font_library_json():
    """بيانات الخطوط التي يحتاجها المحرر وقواعد @font-face في المعاينة."""
    return [
        _font_payload(font)
        for font in CustomFont.objects.filter(is_active=True).order_by("order", "name")
        if font.url
    ]


def _upload_asset_for_editor(request, *, invitation=None, template=None):
    """يرفع أصلاً للمحرر مع ربطه بالدعوة أو القالب صاحب المكتبة."""
    upload = request.FILES.get("file")
    if not upload:
        return JsonResponse({"ok": False, "error": "لم يصل أي ملف."}, status=400)
    guessed = mimetypes.guess_type(upload.name)[0] or ""
    content_type = (getattr(upload, "content_type", "") or guessed).lower()
    # بعض المتصفحات/الاستضافات ترسل m4v أو الملف كـ octet-stream؛
    # نستخدم امتداداً معروفاً فقط كـ fallback، ولا نقبل امتدادات عشوائية.
    extension_type = _VIDEO_EXTENSION_TYPES.get(Path(upload.name).suffix.lower())
    if content_type in _GENERIC_UPLOAD_TYPES and extension_type:
        content_type = extension_type
    elif content_type == "video/x-m4v":
        content_type = "video/mp4"

    if content_type in ALLOWED_IMAGE_TYPES:
        kind = "image"
    elif content_type in ALLOWED_AUDIO_TYPES:
        kind = "audio"
    elif content_type in ALLOWED_VIDEO_TYPES:
        kind = "video"
    else:
        return JsonResponse(
            {"ok": False, "error": "نوع الملف غير مسموح. ارفع صورة أو فيديو أو ملف صوت."},
            status=400,
        )

    # فحص الحجم بعد ما نعرف النوع — الفيديو حده أعلى من الصورة
    cap = MAX_VIDEO_BYTES if kind == "video" else MAX_ASSET_BYTES
    if upload.size > cap:
        return JsonResponse(
            {"ok": False,
             "error": f"حجم الملف أكبر من {_ar_num(cap // (1024 * 1024))} ميجابايت."},
            status=400,
        )

    width = height = 0
    stored, thumb, source = upload, None, None
    # المتصفح يرسل أول فريم كصورة JPEG عندما لا يتوفر ffmpeg على السيرفر.
    if kind == "video":
        client_thumb = request.FILES.get("thumb")
        # الحد ٢٤ ميجا: نسخة المتصفح PNG بمقاس الفيديو الأصلي من غير ضغط عشان
        # الغلاف يطلع بالجودة الأصلية، وفريم 4K ممكن يعدّي ١٠ ميجا.
        if client_thumb and client_thumb.size <= 24 * 1024 * 1024:
            thumb_type = (getattr(client_thumb, "content_type", "") or "").lower()
            if thumb_type in {"image/jpeg", "image/png", "image/webp"}:
                try:
                    from PIL import Image
                    with Image.open(client_thumb) as thumb_img:
                        thumb_img.verify()
                    client_thumb.seek(0)
                    thumb = client_thumb
                except Exception:
                    thumb = None

    if kind == "image" and content_type != "image/svg+xml":
        try:
            from PIL import Image
            with Image.open(upload) as img:
                img.verify()            # يرفض الملفات المزيّفة
            upload.seek(0)
        except Exception:
            return JsonResponse(
                {"ok": False, "error": "الصورة تالفة أو غير صالحة."}, status=400
            )

        try:
            stored, thumb, width, height = images.compress(upload, content_type)
        except Exception:
            upload.seek(0)
            stored, thumb = upload, None
        else:
            # نحتفظ بالأصل عشان القص لاحقاً يبقى من غير فقد جودة
            if stored is not upload and upload.size <= MAX_ASSET_BYTES:
                upload.seek(0)
                source = upload

    seconds = 0.0
    if kind == "video":

        # نجهّز MP4 للبدء السريع من غير إعادة ترميز أو تغيير جودة/مدة الفيديو.
        try:
            stored, seconds = video.prepare_for_stream(upload)

        except Exception:
            upload.seek(0)
            stored, seconds = upload, 0.0

        # صورة أول فريم مستقلة — فشلها لا يمنع رفع الفيديو.
        #
        # ffmpeg **الأول** مش الآخر: الصورة دي مش بطاقة مكتبة بس، هي
        # كمان غلاف (poster) الافتتاحية اللي بيتعرض ملء الشاشة. نسخة
        # المتصفح مرسومة على canvas بحد ٦٤٠px، يعني فيديو ١٠٨٠×١٩٢٠
        # بيطلع غلافه ٣٦٠×٦٤٠ وبيتمطّ تلات أضعاف على شاشة التليفون —
        # وده اللي كان باين مبكسل. ffmpeg بياخد الفريم من الفيديو نفسه
        # بمقاسه الأصلي، ونسخة المتصفح بتفضل fallback لو ffmpeg مش
        # متثبّت على الاستضافة.
        #
        # والفريم بيتاخد من ‎upload‎ (الملف الأصلي) مش من ‎stored‎:
        # ‎prepare_for_stream‎ مابتعيدش الترميز دلوقتي، بس لو اتغيّرت
        # بعدين الغلاف يفضل من غير فقد جودة.
        try:
            source_thumb = video.make_thumbnail(upload) or video.make_thumbnail(stored)
        except Exception:
            source_thumb = None
        if source_thumb is not None:
            thumb = source_thumb

    try:
        asset = Asset.objects.create(
            file=stored, thumb=thumb, source=source,
            kind=kind, original_name=upload.name[:200],
            width=width, height=height, size_bytes=getattr(stored, "size", upload.size),
            invitation=invitation, template=template, uploaded_by=request.user,
        )
    except Exception:
        owner_type = "invitation" if invitation is not None else "template"
        owner_id = getattr(invitation or template, "pk", None)
        logger.exception("Asset upload save failed for %s=%s", owner_type, owner_id)
        return JsonResponse({
            "ok": False,
            "error": "تعذّر حفظ الملف على السيرفر. راجع صلاحيات مجلد media وسجل أخطاء التطبيق.",
        }, status=500)
    return JsonResponse({
        "ok": True,
        "asset": {"id": asset.pk, "url": asset.url, "thumb": asset.thumb_url,
                  "source": asset.source_url,
                  "name": asset.original_name, "kind": asset.kind,
                  "width": width, "height": height, "seconds": seconds},
    })


def _crop_asset_for_editor(request, *, invitation=None, template=None):
    """يقص صورة من الأصل ويحفظ الناتج كأصل جديد في مكتبة الدعوة أو القالب.

    القص بيتم من النسخة الأصلية مش المعروضة، فمفيش فقد جودة متراكم لو
    قصيت أكتر من مرة. والأصل بيفضل محفوظ فتقدر ترجع تقص من جديد.
    """
    try:
        payload = json.loads(request.body.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"ok": False, "error": "طلب غير صالح."}, status=400)

    box = payload.get("box") or {}
    if not isinstance(box, dict):
        return JsonResponse({"ok": False, "error": "حدود القص غير صالحة."}, status=400)

    asset = Asset.objects.filter(pk=payload.get("asset"), kind="image").first()
    if asset is None:
        return JsonResponse({"ok": False, "error": "الصورة غير موجودة."}, status=404)
    # مكتبة القالب هي الأصول غير المربوطة بدعوة — نفس اللي بيعرضه
    # ‎template_api_assets‎ بالظبط.
    if invitation is not None:
        if asset.invitation_id not in (None, invitation.pk):
            return JsonResponse({"ok": False, "error": "الصورة مش من مكتبة الدعوة دي."},
                                status=403)
    elif asset.invitation_id is not None:
        return JsonResponse({"ok": False, "error": "الصورة مش من مكتبة القوالب."},
                            status=403)

    source = asset.source if asset.source else asset.file
    try:
        source.open("rb")
        img, (width, height) = images.crop(source, box)
    except Exception:
        return JsonResponse({"ok": False, "error": "تعذّر قص الصورة."}, status=400)
    finally:
        try:
            source.close()
        except Exception:
            pass

    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=images.QUALITY, method=5)
    size = buf.tell()
    buf.seek(0)

    stem = (asset.original_name or "image").rsplit(".", 1)[0][:60]
    thumb_io = io.BytesIO()
    small = img.copy()
    small.thumbnail((images.THUMB_EDGE, images.THUMB_EDGE))
    small.save(thumb_io, "WEBP", quality=images.THUMB_QUALITY, method=5)
    thumb_io.seek(0)

    new = Asset.objects.create(
        file=ContentFile(buf.read(), name=f"{stem}-crop.webp"),
        thumb=ContentFile(thumb_io.read(), name=f"{stem}-crop-thumb.webp"),
        source=asset.source or asset.file,     # الأصل نفسه عشان إعادة القص
        kind="image", original_name=asset.original_name,
        width=width, height=height, size_bytes=size,
        invitation=invitation, template=template, uploaded_by=request.user,
    )
    return JsonResponse({"ok": True, "asset": {
        "id": new.pk, "url": new.url, "thumb": new.thumb_url,
        "source": new.source_url,
        "name": new.original_name, "kind": "image",
        "width": width, "height": height,
    }})


def _asset_needles(asset):
    names = {
        str(asset.file.name or ""),
        str(asset.thumb.name or ""),
        str(asset.source.name or ""),
        str(asset.url or ""),
        str(asset.thumb_url or ""),
        str(asset.source_url or ""),
    }
    names.discard("")
    return names


def _asset_usage_map(assets):
    """هل كل أصل من دول مستخدم في أي مستند؟ — من الفهرس المقلوب.

    قبل كده كانت الدالة دي بتمسح **كل** مستندات القوالب والدعوات على كل
    فتحة للمحرر: **١٦.٤ ثانية مقيسة على السيرفر** (بينما رسم المستند كله
    ١.١ ثانية). دلوقتي بقى استعلام ``IN`` مفهرس على جدول بيتحدّث وقت
    الحفظ — شوف ``system/mediakeys.py``.

    الأصول القديمة اللي مسارها مش على شكل ``assets/YYYY/MM/<hex>/``
    مالهاش مفتاح، فبترجع للمسحة القديمة. دي حالة نادرة وعددها صغير،
    وسيبناها عن قصد: الإجابة الغلط هنا معناها صورة مستخدمة تتحذف.
    """
    usage = {asset.pk: False for asset in assets}
    if not usage:
        return usage

    key_to_assets: dict[str, set] = {}
    keyless = []
    for asset in assets:
        keys = mediakeys.keys_of_asset(asset)
        if not keys:
            keyless.append(asset)
            continue
        for key in keys:
            key_to_assets.setdefault(key, set()).add(asset.pk)

    for key in mediakeys.used_keys(key_to_assets):
        for asset_pk in key_to_assets.get(key, ()):
            usage[asset_pk] = True

    if keyless:
        usage.update(_asset_usage_scan(keyless))
    return usage


def _asset_usage_scan(assets):
    """المسحة القديمة: تقرا كل المستندات وتدوّر على مسارات الأصول جوّاها.

    غالية جداً (ثواني) فمابتتندهش من رسم صفحة — بس للأصول اللي مالهاش
    مفتاح في الفهرس.
    """
    usage = {asset.pk: False for asset in assets}
    if not usage:
        return usage

    needle_to_assets = {}
    for asset in assets:
        for needle in _asset_needles(asset):
            needle_to_assets.setdefault(needle, set()).add(asset.pk)
    if not needle_to_assets:
        return usage

    pattern = re.compile("|".join(
        re.escape(needle)
        for needle in sorted(needle_to_assets, key=len, reverse=True)
    ))
    documents = list(Template.objects.values_list("document", flat=True))
    documents += list(Invitation.objects.values_list("document", flat=True))
    remaining = set(usage)
    for document in documents:
        text = json.dumps(document, ensure_ascii=False, default=str)
        for match in pattern.finditer(text):
            for asset_id in needle_to_assets[match.group(0)]:
                usage[asset_id] = True
                remaining.discard(asset_id)
        if not remaining:
            break
    return usage


def _asset_is_used(asset):
    """Do not remove a media file while a template or invitation still points to it."""
    return _asset_usage_map([asset]).get(asset.pk, False)


def _delete_asset_files(asset):
    """Delete physical files only when no other Asset row shares them."""
    names = {asset.file.name, asset.thumb.name, asset.source.name}
    names.discard("")
    for name in names:
        shared = Asset.objects.exclude(pk=asset.pk).filter(
            Q(file=name) | Q(thumb=name) | Q(source=name)
        ).exists()
        if not shared:
            try:
                default_storage.delete(name)
            except Exception:
                pass


def _delete_asset_for_editor(request, asset_id, *, invitation=None, template=None, kind="image"):
    kind = kind if kind in {"image", "video"} else "image"
    label = "الفيديو" if kind == "video" else "الصورة"
    try:
        asset_id = int(asset_id)
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": f"{label} غير صالح."}, status=400)
    asset = Asset.objects.filter(pk=asset_id, kind=kind).first()
    if asset is None:
        return JsonResponse({"ok": False, "error": f"{label} غير موجود."}, status=404)
    if invitation is not None:
        if asset.invitation_id not in (None, invitation.pk):
            return JsonResponse({"ok": False, "error": f"{label} مش من مكتبة الدعوة دي."}, status=403)
    if template is not None:
        if asset.invitation_id is not None or asset.template_id not in (None, template.pk):
            return JsonResponse({"ok": False, "error": f"{label} مش من مكتبة القالب ده."}, status=403)
    if _asset_is_used(asset):
        return JsonResponse({
            "ok": False,
            "used": True,
            "error": f"مينفعش تمسح {label} مستخدم داخل قالب أو دعوة.",
        }, status=409)
    _delete_asset_files(asset)
    asset.delete()
    return JsonResponse({"ok": True, "deleted": asset_id})


def _bulk_delete_assets_for_editor(asset_ids, *, invitation=None, template=None, kind="image"):
    kind = kind if kind in {"image", "video"} else "image"
    label = "الفيديوهات" if kind == "video" else "الصور"
    singular_label = "فيديو" if kind == "video" else "صورة"
    try:
        ids = {int(value) for value in (asset_ids or [])}
    except (TypeError, ValueError):
        return JsonResponse({"ok": False, "error": f"اختيار {label} غير صالح."}, status=400)
    if not ids or len(ids) > 300:
        return JsonResponse({"ok": False, "error": f"اختار {singular_label} واحدة على الأقل."}, status=400)

    assets = list(Asset.objects.filter(pk__in=ids, kind=kind))
    if len(assets) != len(ids):
        return JsonResponse({"ok": False, "error": f"بعض {label} لم تعد موجودة."}, status=404)
    for asset in assets:
        if invitation is not None and asset.invitation_id not in (None, invitation.pk):
            return JsonResponse({"ok": False, "error": f"فيه أصل مش من مكتبة الدعوة دي."}, status=403)
        if template is not None and (asset.invitation_id is not None or asset.template_id not in (None, template.pk)):
            return JsonResponse({"ok": False, "error": f"فيه أصل مش من مكتبة القالب ده."}, status=403)

    usage = _asset_usage_map(assets)
    blocked = [asset.original_name or str(asset.pk) for asset in assets if usage.get(asset.pk)]
    if blocked:
        return JsonResponse({
            "ok": False,
            "used": True,
            "blocked": blocked,
            "error": f"لم يتم حذف {label}; بعض الملفات المحددة مستخدمة داخل قالب أو دعوة.",
        }, status=409)

    with transaction.atomic():
        for asset in assets:
            _delete_asset_files(asset)
            asset.delete()
    return JsonResponse({"ok": True, "deleted": sorted(ids)})


def _scan_entry(invitation, raw: str) -> tuple[dict, int]:
    """يسجّل دخلة بالرمز الممسوح. يرجّع (الحمولة، كود الحالة).

    مشتركة بين شاشة الاستقبال في لوحة التحكم وبوابة القاعة العامة —
    المنطق واحد، اللي بيفرق هو مين مسموح له يوصل للنقطة.

    إعادة المسح مش بتنجح بصمت — بترجّع تحذير إن الرمز اتسجّل قبل كده،
    عشان الاستقبال ياخد باله لو حد بيمرّر نفس الدعوة لأكتر من شخص.
    """
    token = (raw or "").strip()
    # الماسح بيرجّع الرابط كامل — نطلّع منه الرمز
    if "/g/" in token:
        token = token.rstrip("/").rsplit("/g/", 1)[-1].split("/")[0].split("?")[0]
    if not (8 <= len(token) <= 64):
        return {"ok": False, "error": "رمز غير صالح."}, 400

    # الكود القصير بيتقبل كمان — الاستقبال بيكتبه بالإيد لو الـQR
    # مارضيش يتمسح (شاشة مكسورة، إضاءة وحشة، ورق مكرمش)
    guest = invitation.guests.filter(token=token).first()
    if guest is None:
        guest = invitation.guests.filter(pass_code__iexact=token).first()
    if guest is None:
        return {"ok": False, "error": "الرمز ده مش من ضيوف الدعوة دي."}, 404

    # التصريح بيتعدّ بالدخلات مش بمرة واحدة. الضيف اللي معاه ٣ دخلات
    # بيدخل هو واتنين معاه، وكل مسحة بتستهلك واحدة. لما تخلص الحالة
    # بتبقى «مستخدم» والمسحة الجاية بترجّع تحذير بدل ما تعدّي حد زيادة
    # بصمت.
    allowed = guest.entries_allowed
    consumed = guest.consume_entry()
    when = timezone.localtime(guest.checked_in_at) if guest.checked_in_at else None

    if allowed <= 0:
        error = "الضيف ده مالوش تصريح دخول — ما أكّدش حضوره."
    elif not consumed:
        error = f"التصريح خلص — اتمسح {guest.entries_used} من {allowed}."
    else:
        error = ""

    rsvp = guest.latest_rsvp
    totals = invitation.guests.aggregate(
        used=Sum("entries_used"), total=Sum("entries_allowed"))
    return {
        "ok": True,
        # already = مسحة زيادة بعد ما التصريح خلص
        "already": not consumed,
        "error": error,
        "id": guest.pk,
        "name": guest.name,
        "code": guest.pass_code,
        "group": guest.group_name,
        "companions": guest.plus_ones_allowed,
        "used": guest.entries_used,
        "allowed": allowed,
        "left": guest.entries_left,
        "status": guest.pass_status,
        "rsvp": rsvp.get_status_display() if rsvp else "",
        "at": when.strftime("%H:%M") if when else "",
        "arrived": totals["used"] or 0,
        "total": totals["total"] or 0,
    }, 200
