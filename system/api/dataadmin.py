"""إدارة البيانات — بديل ‎/admin/‎ داخل لوحة التحكم، فوق نفس ‎ModelAdmin‎ المسجّلة.

مفيش إعدادات مكررة: الأعمدة والبحث والفلاتر والحقول المقروءة فقط وترتيب الحقول (‎fieldsets‎) والصلاحيات
بتتقرا من ‎system/admin.py‎ (وأدمن ‎User‎ و‎Group‎). التحقق والحفظ بيعدّوا على نفس ‎ModelForm‎ اللي بيستخدمها
الأدمن، وكل إضافة/تعديل/حذف بيتسجّل في سجل الأدمن (‎LogEntry‎) زي الأصل.

* ‎GET  data/‎                          فهرس الجداول (العدد والصلاحيات)
* ‎GET  data/<key>/‎                    قائمة: ‎q‎ بحث، ‎f_<حقل>‎ فلتر، ‎o‎ ترتيب، ‎page‎
* ‎POST data/<key>/‎                    إضافة (JSON، أو multipart فيه ‎payload‎ + ملفات)
* ‎GET  data/<key>/schema/‎             شكل النموذج (الحقول، النوع، الاختيارات، الأقسام)
* ‎GET  data/<key>/lookup/<field>/‎     بحث الحقول المرتبطة (‎FK‎/‎M2M‎)
* ‎GET  data/<key>/<pk>/‎               سجل واحد (القيم + الحقول المقروءة فقط + الجداول المرتبطة)
* ‎POST data/<key>/<pk>/‎               تعديل (الحقول اللي مابتتبعتش بتفضل زي ما هي)
* ‎POST data/<key>/delete-preview/‎     إيه اللي هيتحذف معاه (‎ids‎)
* ‎POST data/<key>/delete/‎             حذف (‎ids‎) — بيرفض لو فيه سجلات محمية
* ‎POST data/auth.user/<pk>/password/‎  كلمة سر جديدة لمستخدم

‎<key>‎ = ‎app_label.model_name‎ (مثلاً ‎system.invitation‎).
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from decimal import Decimal

from django import forms
from django.contrib import admin
from django.contrib.admin.utils import (
    display_for_value,
    label_for_field,
    lookup_field,
)
from django.contrib.auth.forms import AdminPasswordChangeForm
from django.core.exceptions import FieldDoesNotExist, PermissionDenied
from django.core.paginator import Paginator
from django.db import DatabaseError, models, transaction
from django.db.models import ProtectedError, RestrictedError
from django.http import Http404, QueryDict
from django.urls import path
from django.utils import timezone
from django.utils.html import strip_tags
from django.utils.text import capfirst

from .. import siteicon
from ..models import Invitation, Template
from .dashboard_common import staff_api
from .http import ApiError, json_body

# حقول الربط ماليهاش ‎verbose_name‎ في الموديل فبتظهر بالإنجليزي؛ بنعرّبها هنا من غير ‎migration‎
LABELS = {
    "customer": "العميل", "template": "القالب", "plan": "الباقة", "invitation": "الدعوة", "guest": "الضيف",
    "order": "الطلب", "addon": "الإضافة", "plans": "الباقات", "created_by": "أنشأه", "uploaded_by": "رفعه",
    "user": "المستخدم", "title": "العنوان",
}
PAGE_SIZE = 25
MAX_PAGE_SIZE = 100
LOOKUP_LIMIT = 30
HREF = re.compile(r'href="([^"]+)"')


# ---------------------------------------------------------------- الوصول للجداول
def _entry(request, key: str):
    """‎(model, model_admin)‎ للمفتاح — 404 لو مش مسجّل أو الصلاحية مش موجودة."""
    for model, model_admin in admin.site._registry.items():
        if f"{model._meta.app_label}.{model._meta.model_name}" == key:
            if not model_admin.has_module_permission(request):
                raise PermissionDenied("مفيش صلاحية على الجدول ده.")
            return model, model_admin
    raise Http404("الجدول غير موجود.")


def _key(model) -> str:
    return f"{model._meta.app_label}.{model._meta.model_name}"


def _perms(request, model_admin, obj=None) -> dict:
    return {
        "view": model_admin.has_view_permission(request, obj),
        "add": model_admin.has_add_permission(request),
        "change": model_admin.has_change_permission(request, obj),
        "delete": model_admin.has_delete_permission(request, obj),
    }


def _need(request, model_admin, action: str, obj=None) -> None:
    allowed = getattr(model_admin, f"has_{action}_permission")
    ok = allowed(request) if action == "add" else allowed(request, obj)
    if not ok:
        raise ApiError(403, "forbidden", "مفيش صلاحية للعملية دي.")


def _get_object(request, model_admin, pk):
    obj = model_admin.get_queryset(request).filter(pk=pk).first()
    if obj is None:
        raise Http404("السجل غير موجود.")
    return obj


# ---------------------------------------------------------------- تحويل القيم
def _plain(value):
    """قيمة جاهزة للـJSON (تواريخ ISO، ‎Decimal‎ نص)."""
    if isinstance(value, datetime):
        value = timezone.localtime(value) if timezone.is_aware(value) else value
        return value.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    return value


def _html_cell(value) -> dict:
    """ناتج دالة أدمن بيرجّع HTML: نطلّع اللينك لو فيه، وإلا النص بس."""
    html = str(value)
    text = strip_tags(html).strip()
    link = HREF.search(html)
    if link:
        return {"k": "link", "v": text, "url": link.group(1)}
    return {"k": "text", "v": text}


def _cell(model_admin, obj, name: str) -> dict:
    try:
        field, attr, value = lookup_field(name, obj, model_admin)
    except Exception:  # noqa: BLE001 — عمود بايظ مايوقعش القائمة كلها
        return {"k": "text", "v": ""}
    if value is None:
        return {"k": "text", "v": ""}
    if isinstance(value, bool):
        return {"k": "bool", "v": value}
    if field is None and isinstance(value, str) and "<" in value:
        return _html_cell(value)
    if isinstance(value, (datetime, date)):
        return {"k": "date", "v": _plain(value)}
    if field is not None and getattr(field, "choices", None):
        return {"k": "text", "v": _choice_label(field, value)}
    return {"k": "text", "v": str(display_for_value(value, "", False))}


def _choice_label(field, value) -> str:
    return str(dict(field.flatchoices).get(value, value))


def _file_value(file) -> dict | None:
    if not file:
        return None
    try:
        url = file.url
    except ValueError:
        url = ""
    return {"url": url, "name": str(file.name).rsplit("/", 1)[-1]}


# ---------------------------------------------------------------- أنواع الحقول
def _kind(field: forms.Field) -> str:
    if isinstance(field, forms.ModelMultipleChoiceField):
        return "m2m"
    if isinstance(field, forms.ModelChoiceField):
        return "fk"
    if isinstance(field, forms.MultipleChoiceField):
        return "multichoice"
    if isinstance(field, forms.ChoiceField):
        return "choice"
    if isinstance(field, forms.BooleanField):
        return "bool"
    if isinstance(field, (forms.DateTimeField, forms.SplitDateTimeField)):
        return "datetime"
    if isinstance(field, forms.DateField):
        return "date"
    if isinstance(field, forms.IntegerField):
        return "int"
    if isinstance(field, (forms.DecimalField, forms.FloatField)):
        return "decimal"
    if isinstance(field, forms.JSONField):
        return "json"
    if isinstance(field, forms.ImageField):
        return "image"
    if isinstance(field, forms.FileField):
        return "file"
    if isinstance(field, forms.EmailField):
        return "email"
    if isinstance(field, forms.URLField):
        return "url"
    if isinstance(field.widget, forms.PasswordInput):
        return "password"
    if isinstance(field.widget, forms.Textarea):
        return "textarea"
    return "text"


def _label(name: str, label) -> str:
    """التسمية الافتراضية (اسم الحقل بحروف إنجليزي) → عربي لو عندنا ترجمة."""
    text = str(label or "")
    plain = name.replace("_", " ")
    return LABELS.get(name, text) if text.lower() in (plain, plain.capitalize(), capfirst(plain)) or not text else text


def _describe(request, model_admin, name: str, field: forms.Field, model) -> dict:
    kind = _kind(field)
    info = {
        "name": name,
        "label": _label(name, field.label or capfirst(name.replace("_", " "))),
        "kind": kind,
        "required": bool(field.required) and kind != "bool",
        "help": str(field.help_text or ""),
        "readonly": False,
    }
    max_length = getattr(field, "max_length", None)
    if max_length:
        info["maxLength"] = max_length
    if kind in ("choice", "multichoice"):
        info["choices"] = [{"value": str(v), "label": str(label)} for v, label in field.choices if v != ""]
        info["blank"] = any(v == "" for v, _ in field.choices)
    if kind in ("fk", "m2m"):
        target = field.queryset.model
        info["related"] = _key(target)
        info["blank"] = not field.required
    if kind == "decimal" and getattr(field, "decimal_places", None) is not None:
        info["decimalPlaces"] = field.decimal_places
    try:
        info["auto"] = bool(model._meta.get_field(name).auto_created)
    except FieldDoesNotExist:
        pass
    return info


def _form_class(request, model_admin, obj, change: bool):
    return model_admin.get_form(request, obj, change=change)


def _fieldsets(request, model_admin, obj):
    sets = []
    for title, options in model_admin.get_fieldsets(request, obj):
        names: list[str] = []
        for entry in options.get("fields", ()):
            names.extend(entry if isinstance(entry, (list, tuple)) else [entry])
        sets.append({"title": str(title or ""), "fields": names, "description": str(options.get("description") or "")})
    return sets


def _readonly_info(model_admin, model, name: str, obj=None) -> dict:
    try:
        label = label_for_field(name, model, model_admin)
    except Exception:  # noqa: BLE001
        label = name
    return {"name": name, "label": str(capfirst(label)), "kind": "readonly", "readonly": True, "required": False, "help": ""}


# ---------------------------------------------------------------- قيم النموذج
def _form_value(field: forms.Field, bound, kind: str):
    value = bound.value()
    if kind == "fk":
        if value in (None, ""):
            return None
        target = field.queryset.filter(pk=value).first()
        return {"id": value, "label": str(target) if target else str(value)}
    if kind == "m2m":
        ids = [item.pk if hasattr(item, "pk") else item for item in (value or [])]
        by_id = {str(o.pk): str(o) for o in field.queryset.filter(pk__in=ids)}
        return [{"id": i, "label": by_id.get(str(i), str(i))} for i in ids]
    if kind in ("file", "image"):
        return _file_value(value)
    if kind == "json":
        if value is None or value == "":
            return ""
        return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2)
    if kind == "password":
        return ""
    if kind in ("datetime", "date"):
        if isinstance(value, str):
            return value
        return _plain(value) if value is not None else ""
    if isinstance(value, Decimal):
        return str(value)
    if value is None:
        return ""
    return value


def _schema(request, model_admin, model, obj=None, change: bool = False) -> dict:
    form_cls = _form_class(request, model_admin, obj, change)
    form = form_cls(instance=obj) if obj is not None else form_cls()
    readonly = set(model_admin.get_readonly_fields(request, obj))
    fields = []
    seen = set()
    for fieldset in _fieldsets(request, model_admin, obj):
        for name in fieldset["fields"]:
            if name in seen:
                continue
            seen.add(name)
            if name in form.fields and not form.fields[name].disabled:
                fields.append(_describe(request, model_admin, name, form.fields[name], model))
            elif name in readonly or name in form.fields:
                info = _readonly_info(model_admin, model, name)
                if name in form.fields:
                    info["label"] = str(form.fields[name].label or info["label"])
                fields.append(info)
    sets = [
        {**fieldset, "fields": [n for n in fieldset["fields"] if n in seen]}
        for fieldset in _fieldsets(request, model_admin, obj)
    ]
    return {"fields": fields, "fieldsets": [s for s in sets if s["fields"]]}


def _values(request, model_admin, model, obj) -> dict:
    form_cls = _form_class(request, model_admin, obj, True)
    form = form_cls(instance=obj)
    out = {}
    readonly = {}
    for name, field in form.fields.items():
        if field.disabled:
            # حقل مقفول (زي هاش كلمة السر): بيتعرض كنص من غير ما قيمته تتسرّب
            readonly[name] = {"k": "text", "v": "••••••••" if name == "password" else str(form[name].value() or "")}
        else:
            out[name] = _form_value(field, form[name], _kind(field))
    for name in model_admin.get_readonly_fields(request, obj):
        readonly[name] = _cell(model_admin, obj, name)
    return {"values": out, "readonly": readonly}


def _defaults(request, model_admin) -> dict:
    """القيم الابتدائية لنموذج الإضافة (الافتراضيات اللي في الموديل)."""
    form = _form_class(request, model_admin, None, False)()
    return {
        name: _form_value(field, form[name], _kind(field))
        for name, field in form.fields.items()
        if not field.disabled
    }


def _inlines(request, model_admin, obj) -> list[dict]:
    """الجداول المرتبطة (زي أسطر الطلب): عرض بس."""
    result = []
    for inline_cls in model_admin.get_inlines(request, obj):
        inline = inline_cls(model_admin.model, admin.site)
        if not inline.has_view_permission(request, obj):
            continue
        rows = inline.get_queryset(request).filter(**{inline.fk_name or _fk_name(inline, model_admin.model): obj})
        names = list(inline.get_fields(request, obj))
        result.append({
            "title": str(inline.model._meta.verbose_name_plural),
            "columns": [str(capfirst(label_for_field(n, inline.model, inline))) for n in names],
            "rows": [[_cell(inline, row, n) for n in names] for row in rows[:200]],
        })
    return result


def _fk_name(inline, parent) -> str:
    from django.forms.models import _get_foreign_key

    return _get_foreign_key(parent, inline.model).name


# ---------------------------------------------------------------- الطلب → بيانات النموذج
def _payload(request) -> dict:
    if (request.content_type or "").startswith("multipart/"):
        try:
            data = json.loads(request.POST.get("payload") or "{}")
        except ValueError:
            raise ApiError(400, "invalid_json", "الطلب ليس JSON صالحاً.")
        if not isinstance(data, dict):
            raise ApiError(400, "invalid_json", "المتوقع كائن JSON.")
        return data
    return json_body(request)


def _as_id(value):
    if isinstance(value, dict):
        value = value.get("id")
    return "" if value is None else str(value)


def _form_data(form_cls, instance, payload: dict) -> QueryDict:
    """يبني ‎QueryDict‎ زي اللي المتصفح كان هيبعته: اللي مابيتبعتش بياخد قيمته الحالية (تعديل جزئي)."""
    current = form_cls(instance=instance) if instance is not None else None
    data = QueryDict(mutable=True)
    for name, field in form_cls().fields.items():
        kind = _kind(field)
        if field.disabled:
            continue
        if kind in ("file", "image"):
            if name in payload and payload[name] is None and instance is not None:
                data[f"{name}-clear"] = "on"
            continue
        if name in payload:
            raw = payload[name]
        elif current is not None:
            raw = _form_value(field, current[name], kind)
            if kind == "password":
                continue
        else:
            continue
        if kind == "bool":
            if raw:
                data[name] = "on"
        elif kind == "m2m":
            data.setlist(name, [_as_id(item) for item in (raw or [])])
        elif kind == "multichoice":
            data.setlist(name, [str(item) for item in (raw or [])])
        elif kind == "fk":
            data[name] = _as_id(raw)
        elif kind == "json":
            data[name] = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
        elif isinstance(field, forms.SplitDateTimeField):
            # الأدمن بيرسم التاريخ والوقت في خانتين (‎name_0‎ و‎name_1‎)
            day, _, clock = ("" if raw is None else str(raw)).partition("T")
            data[f"{name}_0"] = day
            data[f"{name}_1"] = clock
        else:
            data[name] = "" if raw is None else str(raw)
    return data


def _form_errors(form) -> dict:
    fields = {}
    for name, errors in form.errors.items():
        fields[name] = " — ".join(str(e) for e in errors)
    return fields


def _save(request, model_admin, model, obj, change: bool) -> dict:
    form_cls = _form_class(request, model_admin, obj, change)
    data = _form_data(form_cls, obj if change else None, _payload(request))
    form = form_cls(data, request.FILES, instance=obj) if change else form_cls(data, request.FILES)
    if not form.is_valid():
        raise ApiError(400, "invalid", "راجع البيانات — فيه حقل ناقص أو غلط.", _form_errors(form))
    with transaction.atomic():
        saved = model_admin.save_form(request, form, change)
        model_admin.save_model(request, saved, form, change)
        model_admin.save_related(request, form, [], change)
        if change:
            model_admin.log_change(request, saved, [{"changed": {"fields": list(form.changed_data)}}])
        else:
            model_admin.log_addition(request, saved, [{"added": {}}])
    return {"id": saved.pk, "title": str(saved)}


# ---------------------------------------------------------------- نقاط النهاية
@staff_api("GET")
def catalog(request):
    apps: dict[str, dict] = {}
    for model, model_admin in admin.site._registry.items():
        if not model_admin.has_module_permission(request):
            continue
        perms = _perms(request, model_admin)
        if not perms["view"] and not perms["change"]:
            continue
        label = model._meta.app_config.verbose_name
        group = apps.setdefault(model._meta.app_label, {"app": model._meta.app_label, "label": str(label), "models": []})
        try:
            count = model_admin.get_queryset(request).count()
        except DatabaseError:
            continue  # جدول لسه ماتعملوش ‎migrate‎ — مايوقعش الفهرس كله
        group["models"].append({
            "key": _key(model),
            "name": str(capfirst(model._meta.verbose_name_plural)),
            "singular": str(capfirst(model._meta.verbose_name)),
            "count": count,
            "perms": perms,
            # جدول بسجل واحد ما فيهوش إضافة (إعدادات الموقع): بنفتحه على التعديل على طول
            "single": (not perms["add"]) and count == 1,
        })
    return {"apps": sorted(apps.values(), key=lambda a: (a["app"] != "system", a["label"]))}


def _filters(request, model_admin, model) -> list[dict]:
    result = []
    for name in model_admin.get_list_filter(request):
        if not isinstance(name, str):
            continue
        try:
            field = model._meta.get_field(name)
        except FieldDoesNotExist:
            continue
        info = {"name": name, "label": str(capfirst(getattr(field, "verbose_name", name)))}
        if isinstance(field, models.BooleanField):
            info.update(kind="bool", options=[{"value": "true", "label": "نعم"}, {"value": "false", "label": "لا"}])
        elif field.choices:
            info.update(kind="choice", options=[{"value": str(v), "label": str(label)} for v, label in field.flatchoices])
        elif field.is_relation and field.related_model is not None:
            rows = field.related_model.objects.all()[:200]
            info.update(kind="choice", options=[{"value": str(o.pk), "label": str(o)} for o in rows])
        else:
            continue
        result.append(info)
    return result


def _apply_filters(request, model, qs, model_admin):
    for name in model_admin.get_list_filter(request):
        if not isinstance(name, str):
            continue
        raw = request.GET.get(f"f_{name}")
        if raw in (None, ""):
            continue
        try:
            field = model._meta.get_field(name)
        except FieldDoesNotExist:
            continue
        value: object = raw
        if isinstance(field, models.BooleanField):
            value = raw == "true"
        try:
            qs = qs.filter(**{name: value})
        except (ValueError, TypeError):
            raise ApiError(400, "invalid_filter", "قيمة الفلتر غير صالحة.")
    return qs


def _sort(request, model, model_admin, qs, columns: list[str]):
    raw = (request.GET.get("o") or "").strip()
    name = raw.lstrip("-")
    if name and name in columns:
        field_name = getattr(getattr(model_admin, name, None), "admin_order_field", None) or name
        try:
            model._meta.get_field(field_name.split("__")[0])
        except FieldDoesNotExist:
            return qs.order_by("-pk")
        return qs.order_by(("-" if raw.startswith("-") else "") + field_name, "-pk")
    ordering = model_admin.get_ordering(request) or ("-pk",)
    return qs.order_by(*ordering)


@staff_api("GET", "POST")
def model_root(request, key):
    model, model_admin = _entry(request, key)
    if request.method == "POST":
        _need(request, model_admin, "add")
        return _save(request, model_admin, model, None, change=False)
    _need(request, model_admin, "view")

    qs = model_admin.get_queryset(request)
    query = (request.GET.get("q") or "").strip()
    distinct = False
    if query:
        qs, distinct = model_admin.get_search_results(request, qs, query)
    qs = _apply_filters(request, model, qs, model_admin)
    if distinct:
        qs = qs.distinct()
    columns = list(model_admin.get_list_display(request))
    qs = _sort(request, model, model_admin, qs, columns)

    try:
        size = min(MAX_PAGE_SIZE, max(1, int(request.GET.get("size", PAGE_SIZE))))
        number = max(1, int(request.GET.get("page", 1)))
    except ValueError:
        raise ApiError(400, "invalid_page", "رقم الصفحة غير صالح.")
    page = Paginator(qs, size).get_page(number)

    heads = []
    for name in columns:
        try:
            label = label_for_field(name, model, model_admin)
        except Exception:  # noqa: BLE001
            label = name
        sortable = name != "__str__" and (
            name in {f.name for f in model._meta.concrete_fields}
            or bool(getattr(getattr(model_admin, name, None), "admin_order_field", None))
        )
        heads.append({"name": name, "label": _label(name, capfirst(label)), "sortable": sortable})
    return {
        "model": {"key": key, "name": str(capfirst(model._meta.verbose_name_plural)), "singular": str(capfirst(model._meta.verbose_name))},
        "perms": _perms(request, model_admin),
        "columns": heads,
        "filters": _filters(request, model_admin, model),
        "searchable": bool(model_admin.get_search_fields(request)),
        "rows": [
            {"id": obj.pk, "title": str(obj), "cells": [_cell(model_admin, obj, name) for name in columns]}
            for obj in page.object_list
        ],
        "total": page.paginator.count,
        "page": page.number,
        "pages": page.paginator.num_pages,
        "size": size,
    }


@staff_api("GET")
def model_schema(request, key):
    model, model_admin = _entry(request, key)
    _need(request, model_admin, "view")
    perms = _perms(request, model_admin)
    return {
        "model": {"key": key, "name": str(capfirst(model._meta.verbose_name_plural)), "singular": str(capfirst(model._meta.verbose_name))},
        "perms": perms,
        **_schema(request, model_admin, model, None, change=False),
        "defaults": _defaults(request, model_admin),
    }


@staff_api("GET", "POST")
def model_object(request, key, pk):
    model, model_admin = _entry(request, key)
    obj = _get_object(request, model_admin, pk)
    if request.method == "POST":
        _need(request, model_admin, "change", obj)
        return _save(request, model_admin, model, obj, change=True)
    _need(request, model_admin, "view", obj)
    return {
        "model": {"key": key, "name": str(capfirst(model._meta.verbose_name_plural)), "singular": str(capfirst(model._meta.verbose_name))},
        "id": obj.pk,
        "title": str(obj),
        "perms": _perms(request, model_admin, obj),
        **_schema(request, model_admin, model, obj, change=True),
        **_values(request, model_admin, model, obj),
        "inlines": _inlines(request, model_admin, obj),
    }


@staff_api("GET")
def model_lookup(request, key, field):
    """اختيارات حقل مرتبط (بحث بالاسم) — من نفس ‎queryset‎ النموذج، فالقيود بتتطبّق."""
    model, model_admin = _entry(request, key)
    _need(request, model_admin, "view")
    form = _form_class(request, model_admin, None, False)()
    target = form.fields.get(field)
    if not isinstance(target, forms.ModelChoiceField):
        raise Http404("الحقل غير موجود.")
    qs = target.queryset
    query = (request.GET.get("q") or "").strip()
    related_admin = admin.site._registry.get(qs.model)
    if query and related_admin is not None and related_admin.get_search_fields(request):
        qs, _ = related_admin.get_search_results(request, qs, query)
    elif query:
        text_fields = [f.name for f in qs.model._meta.concrete_fields if isinstance(f, (models.CharField, models.TextField))][:3]
        cond = models.Q()
        for name in text_fields:
            cond |= models.Q(**{f"{name}__icontains": query})
        if cond:
            qs = qs.filter(cond)
    return {"results": [{"id": o.pk, "label": str(o)} for o in qs.distinct()[:LOOKUP_LIMIT]]}


def _ids(request) -> list[int]:
    raw = _payload(request).get("ids")
    if not isinstance(raw, list) or not raw:
        raise ApiError(400, "invalid", "اختار سجل واحد على الأقل.")
    try:
        return [int(v) for v in raw][:500]
    except (TypeError, ValueError):
        raise ApiError(400, "invalid", "المعرّفات غير صالحة.")


def _flat(nested) -> list[dict]:
    out: list[dict] = []

    def walk(items, depth):
        for item in items:
            if isinstance(item, (list, tuple)):
                walk(item, depth + 1)
            else:
                out.append({"text": strip_tags(str(item)), "depth": depth})

    walk(nested, 0)
    return out


@staff_api("POST")
def delete_preview(request, key):
    model, model_admin = _entry(request, key)
    qs = model_admin.get_queryset(request).filter(pk__in=_ids(request))
    for obj in qs:
        _need(request, model_admin, "delete", obj)
    to_delete, counts, perms_needed, protected = model_admin.get_deleted_objects(qs, request)
    return {
        "items": _flat(to_delete)[:300],
        "counts": {str(name): n for name, n in counts.items()},
        "protected": [item["text"] for item in _flat(protected)],
        "permsNeeded": [str(p) for p in perms_needed],
    }


@staff_api("POST")
def delete_objects(request, key):
    model, model_admin = _entry(request, key)
    qs = model_admin.get_queryset(request).filter(pk__in=_ids(request))
    objs = list(qs)
    if not objs:
        raise Http404("السجلات غير موجودة.")
    for obj in objs:
        _need(request, model_admin, "delete", obj)
    _, _, perms_needed, protected = model_admin.get_deleted_objects(qs, request)
    if perms_needed or protected:
        raise ApiError(409, "protected", "فيه سجلات مرتبطة محمية — مش هينفع الحذف.")
    try:
        with transaction.atomic():
            model_admin.log_deletions(request, qs)
            model_admin.delete_queryset(request, qs)
    except (ProtectedError, RestrictedError):
        raise ApiError(409, "protected", "فيه سجلات مرتبطة محمية — مش هينفع الحذف.")
    return {"deleted": len(objs)}


@staff_api("POST")
def user_password(request, pk):
    model, model_admin = _entry(request, "auth.user")
    obj = _get_object(request, model_admin, pk)
    _need(request, model_admin, "change", obj)
    body = _payload(request)
    form = AdminPasswordChangeForm(obj, {"password1": body.get("password1", ""), "password2": body.get("password2", "")})
    if not form.is_valid():
        raise ApiError(400, "invalid", "كلمة السر غير صالحة.", _form_errors(form))
    form.save()
    model_admin.log_change(request, obj, [{"changed": {"fields": ["password"]}}])
    return {"ok": True}


@staff_api("GET", "POST", "DELETE")
def site_icon(request):
    """أيقونة الموقع (الـfavicon): ‎GET‎ الحالية، ‎POST file‎ لرفع أيقونة جديدة، ‎DELETE‎ لاستعادة الافتراضية."""
    if request.method != "GET":
        _need_site_settings(request)
    if request.method == "POST":
        upload = request.FILES.get("file")
        if upload is None:
            raise ApiError(400, "file_required", "اختار صورة الأيقونة.")
        try:
            siteicon.save_icon(upload.read(siteicon.MAX_BYTES + 1))
        except siteicon.IconError as exc:
            raise ApiError(400, "bad_image", str(exc)) from exc
    elif request.method == "DELETE":
        siteicon.reset_icon()
    return {"custom": siteicon.is_custom(), "url": siteicon.icon_url()}


def _need_site_settings(request) -> None:
    user = request.user
    if not (user.is_superuser or user.has_perm("system.change_sitesetting")):
        raise PermissionDenied("مفيش صلاحية على إعدادات الموقع.")


@staff_api("GET", "POST", "DELETE")
def site_logo(request):
    """لوجو الموقع (النافبار وقسم الدعاية): ‎GET‎ الحالة، ‎POST slot+file‎ رفع (‎light‎/‎dark‎)، ‎DELETE ?slot=‎ استعادة."""
    slot = request.POST.get("slot") if request.method == "POST" else request.GET.get("slot")
    if request.method != "GET":
        _need_site_settings(request)
        if slot not in siteicon.LOGO_SLOTS:
            raise ApiError(400, "bad_slot", "اختار لوجو فاتح أو غامق.")
    if request.method == "POST":
        upload = request.FILES.get("file")
        if upload is None:
            raise ApiError(400, "file_required", "اختار صورة اللوجو.")
        try:
            siteicon.save_logo(slot, upload.read(siteicon.MAX_BYTES + 1))
        except siteicon.IconError as exc:
            raise ApiError(400, "bad_image", str(exc)) from exc
    elif request.method == "DELETE":
        siteicon.reset_logo(slot)
    return siteicon.logo_state()


@staff_api("POST")
def site_logo_apply(request):
    """يطبّق لوجو الموقع على قسم «الدعاية» في كل القوالب والدعوات."""
    _need_site_settings(request)
    for model in (Template, Invitation):
        model_admin = admin.site._registry.get(model)
        if model_admin is None or not model_admin.has_change_permission(request):
            raise PermissionDenied("مفيش صلاحية تعديل القوالب والدعوات.")
    return siteicon.apply_logo_to_branding()


urlpatterns = [
    path("data/site-logo/", site_logo, name="api_data_site_logo"),
    path("data/site-logo/apply/", site_logo_apply, name="api_data_site_logo_apply"),
    path("data/site-icon/", site_icon, name="api_data_site_icon"),
    path("data/", catalog, name="api_data_catalog"),
    path("data/auth.user/<int:pk>/password/", user_password, name="api_data_user_password"),
    path("data/<str:key>/", model_root, name="api_data_model"),
    path("data/<str:key>/schema/", model_schema, name="api_data_schema"),
    path("data/<str:key>/lookup/<str:field>/", model_lookup, name="api_data_lookup"),
    path("data/<str:key>/delete-preview/", delete_preview, name="api_data_delete_preview"),
    path("data/<str:key>/delete/", delete_objects, name="api_data_delete"),
    path("data/<str:key>/<int:pk>/", model_object, name="api_data_object"),
]
