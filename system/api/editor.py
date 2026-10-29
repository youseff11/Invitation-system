"""واجهة المحرر البصري (Phase C) — ‎/api/v1/editor/‎.

مسارات فريق العمل بس (‎require_staff‎). منطق المستند كله (السكيما، ‎normalize_document‎،
الأصول، نموذج بيانات الدعوة) بيتعمل بالدوال القديمة نفسها — بنستوردها بدل ما نكرّرها:
الموقع القديم هو المرجع للسلوك ومابنعدّلش فيه. اللي بيتغيّر هو الشكل بس: أخطاء
‎{"error": …}‎، ومفاتيح ‎camelCase‎ للأغلفة (**مستند الدعوة والسكيما بيفضلوا بمفاتيح
المحرك ‎snake_case‎ زي ما هم** — دي بيانات المحرك مش واجهة).

* ‎GET  editor/schema/‎                         السكيما (ثابتة لكل نشر، ETag)
* ‎GET  editor/invitations/<id>/‎               كل اللي المحرر محتاجه ليفتح دعوة
* ‎POST editor/invitations/<id>/preview/‎       ‎{document, lang, fields?}‎ → حمولة العرض (‎editable‎)
  ‎fields‎ اختيارية: بيانات المناسبة غير المحفوظة بتتطبّق على نسخة ذاكرة بس
* ‎POST editor/invitations/<id>/save/‎          ‎{document, fields}‎
* ‎POST editor/invitations/<id>/translations/‎  ‎{document, fields?}‎ → صفوف تبويب الترجمة
* ‎POST editor/invitations/<id>/save-template/‎  ‎{document, name, slug?, category?, collection?, description?, isActive?}‎
  يحوّل الدعوة الحالية لقالب جديد في المكتبة (من غير بياناتها الشخصية)
* ‎GET/POST editor/templates/<id>/[preview|save]/‎   نفس الشيء لمحرر القالب (‎{document}‎ بس)

الأصول والمفضلة والخطوط (C3) في ‎editor_assets.py‎.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.utils import timezone
from django.utils.text import slugify

from .. import blocks as blocks_engine
from .. import renderer as R
from .. import services
from ..forms import InvitationSettingsForm
from ..models import Asset, IntroVideo, Invitation, MusicTrack, Template
from . import invite_render
from .dashboard_common import raise_invalid, snake_keys, staff_api, to_camel
from .http import ApiError, api_view, json_body, require_staff

logger = logging.getLogger(__name__)

# حقول بيانات المناسبة اللي المحرر بيحفظها مع المستند (نفس ‎InvitationSettingsForm.Meta.fields‎)
FORM_FIELDS = (
    "title", "event_type", "name_one", "name_two", "event_date", "venue",
    "address", "map_url", "whatsapp", "status", "expires_at", "password", "slug",
)
_DATETIME_FIELDS = {"event_date", "expires_at"}
ASSET_LIMIT = 300


# ---------------------------------------------------------------- السكيما
@api_view("GET")
def schema(request):
    """سكيما المحرر (~٦٠٠ كيلو). مشتقّة من الكود فمابتتغيّرش غير مع نشر جديد:
    ‎ETag‎ بالبصمة، والمتصفح بيسأل ويستلم ‎304‎ بدل ما ينزّلها كل فتحة."""
    require_staff(request)
    stamp, payload = services._editor_schema_blob()  # noqa: SLF001
    etag = f'"{stamp}"'
    if request.headers.get("If-None-Match") == etag:
        response = HttpResponse(status=304)
    else:
        response = HttpResponse(payload, content_type="application/json; charset=utf-8")
    response["ETag"] = etag
    # private: الرد خلف تسجيل دخول، ماينفعش يتخزّن في وسيط مشترك
    response["Cache-Control"] = "private, max-age=0, must-revalidate"
    return response


# ---------------------------------------------------------------- أدوات
def _assets(invitation: Invitation | None) -> list[dict]:
    """مكتبة الصور: أصول الدعوة + المشتركة (أو المشتركة بس لمحرر القالب) — آخر ٣٠٠."""
    if invitation is not None:
        from django.db.models import Q
        rows = Asset.objects.filter(Q(invitation=invitation) | Q(invitation__isnull=True))
    else:
        rows = Asset.objects.filter(invitation__isnull=True)
    assets = list(rows.order_by("-id")[:ASSET_LIMIT])
    usage = services._asset_usage_map(assets)  # noqa: SLF001
    return [
        {"id": a.pk, "url": a.url, "thumb": a.thumb_url, "source": a.source_url,
         "name": a.original_name, "kind": a.kind, "used": usage.get(a.pk, False)}
        for a in assets
    ]


def _clip_library(library: str) -> list[dict]:
    return [
        {"id": v.pk, "name": v.name, "url": v.url, "poster": v.poster_url,
         "seconds": v.seconds, "note": v.note}
        for v in IntroVideo.objects.filter(is_active=True, library=library) if v.url
    ]


def _libraries() -> dict:
    return {
        "fonts": services._font_library_json(),  # noqa: SLF001
        "intros": _clip_library("intros"),
        "videos": _clip_library("videos"),
        "music": [
            {"id": m.pk, "name": m.name, "url": m.url, "note": m.note}
            for m in MusicTrack.objects.filter(is_active=True) if m.url
        ],
        "categories": [{"value": v, "label": str(label)}
                       for v, label in Template.CATEGORY_CHOICES],
    }


def _form_values(invitation: Invitation) -> dict:
    """القيم الحالية بصيغة ‎datetime-local‎ (توقيت القاهرة) زي ما بيعرضها النموذج."""
    values = {}
    for name in FORM_FIELDS:
        value = getattr(invitation, name)
        if name in _DATETIME_FIELDS:
            value = timezone.localtime(value).strftime("%Y-%m-%dT%H:%M") if value else ""
        values[name] = "" if value is None else value
    return values


def _status_choices() -> list[dict]:
    return [{"value": value, "label": str(label)}
            for value, label in Invitation.STATUS_CHOICES]


def _overlay_unsaved_fields(invitation: Invitation, sent) -> None:
    """يطبّق بيانات المناسبة غير المحفوظة على نسخة الذاكرة من الدعوة (من غير حفظ)
    عشان المعاينة تعكس اللي بيتكتب في تبويب «البيانات» قبل الحفظ.

    التحقق بنفس ‎InvitationSettingsForm‎ بس الأخطاء هنا بتتجاهل: ‎ModelForm‎ بيكتب
    القيم الصالحة بس على النسخة (‎construct_instance‎)، والحقل الغلط بيفضل بقيمته
    المحفوظة — المعاينة ماتفضلش فاضية لمجرد إن تاريخ لسه بيتكتب."""
    if not isinstance(sent, dict):
        return
    data = _form_values(invitation)
    data.update({k: v for k, v in snake_keys(sent).items() if k in FORM_FIELDS})
    InvitationSettingsForm(data, instance=invitation).is_valid()


def _document_in(body: dict) -> dict:
    document = body.get("document")
    if not isinstance(document, dict):
        raise ApiError(400, "invalid_document", "المستند غير موجود في الطلب.")
    return document


def _saved_at() -> str:
    return timezone.localtime().strftime("%H:%M:%S")


def _preview(request, body: dict, *, invitation=None, template=None) -> dict:
    owner = invitation.template if invitation is not None else template
    payload, _private = invite_render.build_payload(
        _document_in(body),
        invitation=invitation,
        request=request,
        allowed_features=invitation.allowed_features if invitation is not None else None,
        lang=str(body.get("lang") or ""),
        runtime_scripts=getattr(owner, "runtime_scripts", []),
        runtime_root_attrs=getattr(owner, "runtime_root_attrs", {}),
        editable=True,
    )
    payload["kind"] = "invitation" if invitation is not None else "template"
    payload["editable"] = True
    payload["siteName"] = settings.SITE_NAME
    return payload


def _translations(body: dict, *, invitation=None) -> dict:
    """صفوف تبويب الترجمة: نفس ‎translatable_entries‎ اللي العارض بيقرا مفاتيحها
    (فمفيش مفتاح مكتوب ومش ظاهر)، على المستند الحالي وبيانات المناسبة غير المحفوظة.
    محرر القالب مالوش بيانات مناسبة (القالب بيعرض أسماء تجريبية) فمفيش صفوف ‎data.*‎."""
    document = blocks_engine.normalize_document(_document_in(body))
    data: dict = {}
    if invitation is not None:
        _overlay_unsaved_fields(invitation, body.get("fields"))
        data = R.build_data_context(invitation)
    return {
        "baseLang": blocks_engine.base_language(document),
        "altLang": blocks_engine.alt_language(document),
        "entries": blocks_engine.translatable_entries(document, data),
    }


# ---------------------------------------------------------------- الدعوة
def _invitation(pk) -> Invitation:
    return get_object_or_404(
        Invitation.objects.select_related("template", "customer", "plan"), pk=pk)


@staff_api("GET")
def invitation_editor(request, pk):
    invitation = _invitation(pk)
    document = invitation.get_document()
    if not document["blocks"]:
        # دعوة جديدة لسه ما اتعدّلتش: نبدأ من مستند القالب
        document = invitation.template.get_document()
    public_url = request.build_absolute_uri(invitation.get_absolute_url())
    return {
        "mode": "invitation",
        "id": invitation.pk,
        "title": invitation.title,
        "document": document,
        "fields": {to_camel(k): v for k, v in _form_values(invitation).items()},
        "statusChoices": _status_choices(),
        "features": sorted(invitation.allowed_features),
        "assets": _assets(invitation),
        **_libraries(),
        "meta": {
            "slug": invitation.slug,
            "status": invitation.status,
            "planName": invitation.plan.name if invitation.plan else "",
            "templateName": invitation.template.name,
            "publicUrl": public_url,
            "clientFollowupUrl": request.build_absolute_uri(
                invitation.get_client_followup_url()),
            "backUrl": "/dashboard/invitations",
        },
    }


@staff_api("POST")
def invitation_preview(request, pk):
    body = json_body(request)
    invitation = _invitation(pk)
    # نسخة الذاكرة بس — ماحدش بيستدعي ‎save()‎ على الدعوة في المعاينة
    _overlay_unsaved_fields(invitation, body.get("fields"))
    return _preview(request, body, invitation=invitation)


@staff_api("POST")
def invitation_translations(request, pk):
    return _translations(json_body(request), invitation=_invitation(pk))


@staff_api("POST")
def invitation_save(request, pk):
    invitation = get_object_or_404(Invitation, pk=pk)
    body = json_body(request)
    document = blocks_engine.normalize_document(_document_in(body))

    sent = body.get("fields")
    sent = snake_keys(sent) if isinstance(sent, dict) else {}
    # نبدأ من القيم الحالية: طلب ناقص حقول (حفظ المستند بس) ماينفعش يفضّي بيانات المناسبة
    data = _form_values(invitation)
    data.update({k: v for k, v in sent.items() if k in FORM_FIELDS})

    form = InvitationSettingsForm(data, instance=invitation)
    if not form.is_valid():
        raise_invalid(form)

    with transaction.atomic():
        invitation = form.save(commit=False)
        invitation.document = document
        invitation.save()

    return {
        "savedAt": _saved_at(),
        "slug": invitation.slug,
        "status": invitation.status,
        "publicUrl": request.build_absolute_uri(invitation.get_absolute_url()),
        # مبنية على الـslug — لو اتغيّر لازم الواجهة تعرض الجديدة من غير ريفريش
        "clientFollowupUrl": request.build_absolute_uri(
            invitation.get_client_followup_url()),
    }


@staff_api("POST")
def invitation_save_template(request, pk):
    """يحوّل تصميم الدعوة الحالية (المستند اللي في المحرر، حتى غير المحفوظ) لقالب جديد في المكتبة — بدون كتابة كود.

    نفس ‎api_save_as_template‎ القديمة: اسم لازم يتكتب، البيانات الشخصية (تاريخ الغلاف) بتتفرّغ، والميزات المطلوبة
    بتتحسب من الأقسام، والتصنيف الغلط بيرجع ‎wedding‎.
    """
    get_object_or_404(Invitation, pk=pk)
    body = json_body(request)
    name = str(body.get("name") or "").strip()[:120]
    if len(name) < 2:
        raise ApiError(400, "invalid", "اكتب اسماً للقالب.", fields={"name": "اكتب اسماً للقالب."})
    document = blocks_engine.normalize_document(_document_in(body))

    # نفرّغ البيانات الشخصية حتى يبدأ القالب نظيفاً
    for block in document["blocks"]:
        if block["type"] == "hero":
            block["props"]["date_text"] = ""

    required = sorted({
        blocks_engine.BLOCK_REGISTRY[b["type"]]["feature"]
        for b in document["blocks"]
        if blocks_engine.BLOCK_REGISTRY.get(b["type"], {}).get("feature")
    })
    category = body.get("category")
    template = Template.objects.create(
        name=name,
        slug=slugify(str(body.get("slug") or name), allow_unicode=False) or "",
        category=category if category in dict(Template.CATEGORY_CHOICES) else "wedding",
        collection=str(body.get("collection") or "Premium")[:40],
        description=str(body.get("description") or "")[:2000],
        document=document,
        required_features=required,
        source="editor",
        is_active=bool(body.get("isActive", True)),
        created_by=request.user,
    )
    try:
        R.get_template_preview(template)
    except Exception:  # noqa: BLE001 — المعاينة المخزّنة تحسين، فشلها ما يمنعش الحفظ
        logger.exception("template preview failed for new template %s", template.pk)
    return {"templateId": template.pk, "slug": template.slug, "name": template.name}


# ---------------------------------------------------------------- القالب
def _template(pk) -> Template:
    return get_object_or_404(Template, pk=pk)


@staff_api("GET")
def template_editor(request, pk):
    template = _template(pk)
    public_url = request.build_absolute_uri(
        reverse("template_demo", kwargs={"slug": template.slug}))
    return {
        "mode": "template",
        "id": template.pk,
        "title": template.name,
        "document": template.get_document(),
        "fields": None,
        "features": sorted(blocks_engine.feature_keys()),
        "assets": _assets(None),
        **_libraries(),
        "meta": {
            "slug": template.slug,
            "status": "",
            "planName": "",
            "templateName": template.name,
            "publicUrl": public_url,
            "clientFollowupUrl": "",
            "backUrl": "/dashboard/templates",
        },
    }


@staff_api("POST")
def template_preview(request, pk):
    return _preview(request, json_body(request), template=_template(pk))


@staff_api("POST")
def template_translations(request, pk):
    _template(pk)
    return _translations(json_body(request))


@staff_api("POST")
def template_save(request, pk):
    template = _template(pk)
    document = blocks_engine.normalize_document(_document_in(json_body(request)))
    template.document = document
    # كاش المعاينة القديم مربوط ببصمة المحتوى فمش هيبقى قديم، بس بنفضّيه زي الموقع القديم
    template.preview_render = {}
    template.save(update_fields=["document", "preview_render", "updated_at"])
    return {
        "savedAt": _saved_at(),
        "slug": template.slug,
        "status": "",
        "publicUrl": request.build_absolute_uri(
            reverse("template_demo", kwargs={"slug": template.slug})),
        "clientFollowupUrl": "",
    }


urlpatterns = [
    path("editor/schema/", schema, name="api_editor_schema"),
    path("editor/invitations/<int:pk>/", invitation_editor, name="api_editor_invitation"),
    path("editor/invitations/<int:pk>/preview/", invitation_preview,
         name="api_editor_invitation_preview"),
    path("editor/invitations/<int:pk>/save/", invitation_save,
         name="api_editor_invitation_save"),
    path("editor/invitations/<int:pk>/save-template/", invitation_save_template,
         name="api_editor_invitation_save_template"),
    path("editor/invitations/<int:pk>/translations/", invitation_translations,
         name="api_editor_invitation_translations"),
    path("editor/templates/<int:pk>/", template_editor, name="api_editor_template"),
    path("editor/templates/<int:pk>/preview/", template_preview,
         name="api_editor_template_preview"),
    path("editor/templates/<int:pk>/save/", template_save,
         name="api_editor_template_save"),
    path("editor/templates/<int:pk>/translations/", template_translations,
         name="api_editor_template_translations"),
]
