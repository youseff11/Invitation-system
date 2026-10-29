"""مسح المقطوعات المكررة من مكتبة الموسيقى.

ليه بتتكرر: كل استيراد لقالب بيضيف مقطوعاته للمكتبة من جديد، فنفس الأغنية
بتتخزّن عشرات المرات بنفس الاسم وأسماء ملفات مختلفة.

المكرر = **نفس الاسم** (من غير اعتبار المسافات وحالة الحروف) **ونفس المحتوى**:
* ملف مرفوع: نفس الحجم ثم نفس بصمة ‎sha256‎ — لو الملف نفسه مش موجود على
  القرص (بيئة تطوير من غير مجلد media) بنعتبر المقطوعات المفقودة بنفس الاسم
  مكررة لأن مفيش حاجة تتفرّق بيها؛
* رابط خارجي: نفس الرابط.
نفس الاسم بمحتوى مختلف **مابيتمسحش**.

في كل مجموعة بتفضل مقطوعة واحدة: اللي **أكتر مستند بيشاور عليها** (عشان أقل
تعديل)، وعند التساوي المتاحة ثم الأقل ترتيباً ثم الأقدم. المستندات (القوالب
والدعوات) اللي كانت بتشاور على نسخة هتتمسح بتتحوّل للنسخة الباقية في نفس
المعاملة قبل المسح، وملف النسخة المحذوفة بيتمسح من القرص بعد نجاح المعاملة بس
لو مفيش مقطوعة تانية بتستخدمه.

‎POST /api/v1/dashboard/music/dedupe/‎ بجسم ‎{"dryRun": true}‎ بيرجّع الخطة من
غير ما يغيّر حاجة (الواجهة بتعرضها للتأكيد)، ومن غيره بينفّذ.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import defaultdict
from urllib.parse import quote, unquote

from django.core.files.storage import default_storage
from django.db import transaction
from django.urls import path

from ..models import Invitation, MusicTrack, Template
from .dashboard_common import staff_api
from .http import json_body

logger = logging.getLogger(__name__)

_CHUNK = 1024 * 1024
# أقصى عدد مجموعات بنرجّعها في الخطة (للعرض بس؛ التنفيذ بيشمل الكل)
_PREVIEW_GROUPS = 40


def _norm(name: str) -> str:
    return " ".join((name or "").split()).casefold()


def duplicate_extra() -> int:
    """عدد النسخ الزيادة بالاسم بس — تلميح رخيص (من غير قراءة ملفات) لإظهار الزرار."""
    counts: dict[str, int] = defaultdict(int)
    for name in MusicTrack.objects.values_list("name", flat=True):
        counts[_norm(name)] += 1
    return sum(n - 1 for n in counts.values() if n > 1)


# ---------------------------------------------------------------- المحتوى
def _size(track) -> int | None:
    try:
        return track.file.size
    except (OSError, ValueError):
        return None


def _digest(track) -> str | None:
    try:
        sha = hashlib.sha256()
        with track.file.storage.open(track.file.name, "rb") as handle:
            for chunk in iter(lambda: handle.read(_CHUNK), b""):
                sha.update(chunk)
        return sha.hexdigest()
    except (OSError, ValueError):
        return None


def _split_by_content(same_name: list) -> list[list]:
    """يقسّم المقطوعات اللي بنفس الاسم لمجموعات بنفس المحتوى."""
    sizes = {}
    for track in same_name:
        if track.file:
            sizes[track.pk] = _size(track)
    size_counts: dict[int, int] = defaultdict(int)
    for size in sizes.values():
        if size is not None:
            size_counts[size] += 1

    buckets: dict[tuple, list] = defaultdict(list)
    for track in same_name:
        if track.file:
            size = sizes[track.pk]
            if size is None:
                signature = ("missing",)
            elif size_counts[size] == 1:
                signature = ("size", size)  # حجم فريد: مستحيل يتطابق مع غيره
            else:
                digest = _digest(track)
                signature = ("sha", digest) if digest else ("missing",)
        elif track.external_url:
            signature = ("url", track.external_url.strip())
        else:
            signature = ("empty",)
        buckets[signature].append(track)
    return list(buckets.values())


def duplicate_groups() -> list[list]:
    by_name: dict[str, list] = defaultdict(list)
    for track in MusicTrack.objects.all():
        by_name[_norm(track.name)].append(track)
    groups = []
    for same_name in by_name.values():
        if len(same_name) < 2:
            continue
        groups.extend(members for members in _split_by_content(same_name) if len(members) > 1)
    return groups


# ---------------------------------------------------------------- المراجع في المستندات
def _variants(track) -> list[str]:
    """الرابط زي ما ممكن يتكتب في مستند: خام، أو مفكوك، أو مكوّد (أسماء عربية)."""
    base = track.url
    if not base:
        return []
    plain = unquote(base)
    return [base, plain, quote(plain, safe="/:?&=#@+,;~!*'()")]


def _pattern(variants: list[str]):
    ordered = sorted({v for v in variants if v}, key=len, reverse=True)
    if not ordered:
        return None
    # ما بعد الرابط مش حرف اسم ملف: عشان a.mp3 ماتتطابقش جوّه a.mp33
    return re.compile("(" + "|".join(re.escape(v) for v in ordered) + r")(?![\w%\-])")


def _documents():
    for model in (Template, Invitation):
        for pk, document in model.objects.values_list("pk", "document").iterator():
            yield model, pk, document


def _count_references(owner_of: dict[str, int]) -> dict[int, int]:
    """كام مرة كل مقطوعة (بالـid) مذكورة في مستندات القوالب والدعوات."""
    pattern = _pattern(list(owner_of))
    counts: dict[int, int] = defaultdict(int)
    if pattern is None:
        return counts
    for _model, _pk, document in _documents():
        text = json.dumps(document, ensure_ascii=False)
        for match in pattern.finditer(text):
            counts[owner_of[match.group(1)]] += 1
    return counts


def _rewrite_references(replacements: dict[str, str]) -> int:
    """يبدّل روابط المقطوعات المحذوفة بروابط الباقية في كل المستندات. يرجّع عدد المستندات."""
    pattern = _pattern(list(replacements))
    if pattern is None:
        return 0
    changed = 0
    for model, pk, document in _documents():
        text = json.dumps(document, ensure_ascii=False)
        if not pattern.search(text):
            continue
        new_document = json.loads(pattern.sub(lambda m: replacements[m.group(1)], text))
        fields = {"document": new_document}
        if model is Template:
            fields["preview_render"] = {}  # المعاينة المخزّنة بتتولّد من جديد
        model.objects.filter(pk=pk).update(**fields)
        changed += 1
    return changed


# ---------------------------------------------------------------- الخطة والتنفيذ
def _choose_keeper(members: list, references: dict[int, int]):
    return min(
        members,
        key=lambda t: (-references.get(t.pk, 0), not t.is_active, t.order, t.pk),
    )


def run(*, dry_run: bool) -> dict:
    groups = duplicate_groups()
    if not groups:
        return {"dryRun": dry_run, "removeCount": 0, "keepCount": 0, "repointedDocs": 0,
                "freedBytes": 0, "groups": []}

    owner_of: dict[str, int] = {}
    for members in groups:
        for track in members:
            for variant in _variants(track):
                owner_of.setdefault(variant, track.pk)
    references = _count_references(owner_of)

    plan = []
    for members in groups:
        keeper = _choose_keeper(members, references)
        plan.append((keeper, [t for t in members if t.pk != keeper.pk]))

    remove_count = sum(len(removed) for _keeper, removed in plan)
    summary = {
        "dryRun": dry_run,
        "removeCount": remove_count,
        "keepCount": len(plan),
        "repointedDocs": 0,
        "freedBytes": 0,
        "groups": [
            {"name": keeper.name, "keepId": keeper.pk, "removeCount": len(removed)}
            for keeper, removed in plan[:_PREVIEW_GROUPS]
        ],
    }
    if dry_run:
        return summary

    replacements: dict[str, str] = {}
    for keeper, removed in plan:
        kept = _variants(keeper)
        for track in removed:
            for old, new in zip(_variants(track), kept):
                if old != new:
                    replacements[old] = new

    removed_files: list[tuple[str, int]] = []
    with transaction.atomic():
        summary["repointedDocs"] = _rewrite_references(replacements)
        for keeper, removed in plan:
            if not keeper.is_active and any(t.is_active for t in removed):
                keeper.is_active = True
                keeper.save(update_fields=["is_active", "updated_at"])
            for track in removed:
                if track.file:
                    removed_files.append((track.file.name, _size(track) or 0))
                track.delete()

        def remove_files() -> None:
            for name, size in removed_files:
                # ملف مشترك مع مقطوعة لسه موجودة: ماينفعش يتمسح
                if MusicTrack.objects.filter(file=name).exists():
                    continue
                try:
                    default_storage.delete(name)
                except OSError:
                    logger.warning("couldn't delete music file %s", name, exc_info=True)

        transaction.on_commit(remove_files)

    summary["freedBytes"] = sum(
        size for name, size in removed_files if not MusicTrack.objects.filter(file=name).exists()
    )
    return summary


@staff_api("POST")
def music_dedupe(request):
    data = json_body(request)
    return run(dry_run=bool(data.get("dryRun")))


urlpatterns = [
    path("dashboard/music/dedupe/", music_dedupe, name="api_dashboard_music_dedupe"),
]
