"""مكتبات اللوحة: الخطوط والموسيقى وفيديوهات الافتتاحية.

مطابقة لـ‎dashboard_fonts‎ و‎dashboard_music‎ و‎dashboard_intros‎ في ‎views.py‎ القديم:
نفس النماذج (‎CustomFontForm‎ …) ونفس حدود الحجم، وفيديو الافتتاحية بيعدّي على
‎video.compress‎ و‎video.make_thumbnail‎ زي ما كان. الرفع multipart (‎FormData‎)
بمفاتيح ‎camelCase‎ (‎externalUrl‎، ‎isActive‎).
"""

from __future__ import annotations

import os

from django.http import Http404
from django.template.defaultfilters import floatformat
from django.urls import path

from .. import video
from ..forms import CustomFontForm, IntroVideoForm, MusicTrackForm
from ..models import CustomFont, IntroVideo, MusicTrack
from .dashboard_common import (
    MAX_UPLOAD_BYTES,
    check_upload,
    raise_invalid,
    snake_keys,
    staff_api,
    to_snake,
)
from .dashboard_music_dedupe import duplicate_extra
from .http import ApiError, json_body

AUDIO_EXTENSIONS = {".mp3", ".m4a", ".mp4", ".aac", ".ogg", ".oga", ".opus", ".wav", ".webm", ".flac"}
VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm"}


def _get_or_404(model, pk):
    try:
        return model.objects.get(pk=pk)
    except model.DoesNotExist:
        raise Http404("غير موجود.")


def _form_input(request, *file_fields: str) -> tuple[dict, dict]:
    """بيانات النموذج + الملفات من طلب multipart، بأسماء حقول النموذج الأصلية."""
    files = {to_snake(name): request.FILES.get(name) for name in file_fields}
    return snake_keys(request.POST), files


def _require_type(upload, *, extensions: set[str], prefix: str, field: str, message: str) -> None:
    """يرفض الملف لو نوعه مش من المسموح — بالامتداد أو بنوع المحتوى اللي بعته المتصفح."""
    if upload is None:
        return
    extension = os.path.splitext(upload.name or "")[1].lower()
    content_type = (getattr(upload, "content_type", "") or "").lower()
    if extension in extensions or content_type.startswith(prefix):
        return
    raise ApiError(400, "validation_error", message, fields={field: message})


def _toggle(model, pk) -> object:
    obj = _get_or_404(model, pk)
    obj.is_active = not obj.is_active
    obj.save(update_fields=["is_active", "updated_at"])
    return obj


# ---------------------------------------------------------------- الخطوط
def _font_row(font) -> dict:
    return {
        "id": font.pk,
        "name": font.name,
        "nameEn": font.name_en,
        "family": font.family,
        "weight": font.weight,
        "style": font.style,
        "styleLabel": font.get_style_display(),
        "url": font.url,
        "isActive": font.is_active,
    }


@staff_api("GET", "POST")
def fonts(request):
    if request.method == "POST":
        data, files = _form_input(request, "file")
        form = CustomFontForm(data, files)
        if not form.is_valid():
            raise_invalid(form)
        font = form.save(commit=False)
        font.uploaded_by = request.user
        font.save()
        return _font_row(font)
    return {"results": [_font_row(font) for font in CustomFont.objects.all()]}


@staff_api("DELETE")
def font_detail(request, pk):
    font = _get_or_404(CustomFont, pk)
    name = font.name
    font.delete()
    return {"deleted": True, "name": name}


@staff_api("POST")
def font_toggle(request, pk):
    return _font_row(_toggle(CustomFont, pk))


# ---------------------------------------------------------------- الموسيقى
def _track_row(track) -> dict:
    return {
        "id": track.pk,
        "name": track.name,
        "note": track.note,
        "url": track.url,
        "order": track.order,
        "isActive": track.is_active,
    }


@staff_api("GET", "POST")
def music(request):
    if request.method == "POST":
        data, files = _form_input(request, "file")
        _require_type(files["file"], extensions=AUDIO_EXTENSIONS, prefix="audio/",
                      field="file", message="الملف لازم يكون صوتي (MP3 أو M4A أو OGG أو WAV).")
        form = MusicTrackForm(data, files)
        if not form.is_valid():
            raise_invalid(form)
        return _track_row(form.save())
    return {
        "results": [_track_row(track) for track in MusicTrack.objects.all()],
        # تلميح رخيص (بالاسم بس) لإظهار زرار «مسح المكرر»؛ الخطة الدقيقة من ‎music/dedupe/‎
        "duplicateExtra": duplicate_extra(),
    }


@staff_api("DELETE")
def track_detail(request, pk):
    track = _get_or_404(MusicTrack, pk)
    name = track.name
    track.delete()
    return {"deleted": True, "name": name}


@staff_api("POST")
def track_toggle(request, pk):
    return _track_row(_toggle(MusicTrack, pk))


# ---------------------------------------------------------------- الافتتاحيات
def _clip_row(clip) -> dict:
    return {
        "id": clip.pk,
        "name": clip.name,
        "note": clip.note,
        "url": clip.url,
        "posterUrl": clip.poster_url,
        # ‎|floatformat:1‎ بنفس الفاصلة العشرية بتاعة لغة الصفحة
        "secondsLabel": str(floatformat(clip.seconds, 1)) if clip.seconds else "",
        "order": clip.order,
        "isActive": clip.is_active,
    }


def _clip_list(request, library: str):
    if request.method == "POST":
        data, files = _form_input(request, "file", "poster")
        check_upload(files["poster"], label="صورة الغلاف", limit=MAX_UPLOAD_BYTES)
        _require_type(files["file"], extensions=VIDEO_EXTENSIONS, prefix="video/",
                      field="file", message="الفيديو لازم يكون MP4 أو WebM أو MOV.")
        form = IntroVideoForm(data, files)
        if not form.is_valid():
            raise_invalid(form)
        clip = form.save(commit=False)
        clip.library = library
        upload = form.cleaned_data.get("file")
        if upload:
            # نفس ضغط فيديو الافتتاحية بتاع الرفع من المحرر
            try:
                stored, secs = video.compress(upload)
                clip.file = stored
                clip.seconds = secs or 0
                # Poster ثابت للموبايل؛ لو ffmpeg غير متاح يظل fallback المتصفح يعمل.
                # الفريم بيتاخد من ‎upload‎ (قبل الضغط) مش من ‎stored‎: الضغط بينزّل
                # الارتفاع لـ٧٢٠p وبيرمّز بـCRF ٣٠، فالغلاف كان بيورّث تهويش الضغط.
                if not clip.poster:
                    generated_poster = (video.make_thumbnail(upload)
                                        or video.make_thumbnail(stored))
                    if generated_poster:
                        clip.poster = generated_poster
            except Exception:
                pass
        clip.save()
        return _clip_row(clip)
    return {"results": [_clip_row(clip) for clip in IntroVideo.objects.filter(library=library)]}


def _clip_detail(request, pk, library: str):
    try:
        clip = IntroVideo.objects.get(pk=pk, library=library)
    except IntroVideo.DoesNotExist:
        raise Http404("غير موجود.")
    if request.method == "PATCH":
        name = str(json_body(request).get("name") or "").strip()
        limit = IntroVideo._meta.get_field("name").max_length
        if not name or len(name) > limit:
            message = "اكتب اسم للفيديو (حتى ١٢٠ حرف)."
            raise ApiError(400, "validation_error", message, fields={"name": message})
        clip.name = name
        clip.save(update_fields=["name", "updated_at"])
        return _clip_row(clip)
    name = clip.name
    clip.delete()
    return {"deleted": True, "name": name}


def _clip_toggle(pk, library: str):
    try:
        clip = IntroVideo.objects.get(pk=pk, library=library)
    except IntroVideo.DoesNotExist:
        raise Http404("غير موجود.")
    clip.is_active = not clip.is_active
    clip.save(update_fields=["is_active", "updated_at"])
    return _clip_row(clip)


@staff_api("GET", "POST")
def intros(request):
    return _clip_list(request, "intros")


@staff_api("PATCH", "DELETE")
def clip_detail(request, pk):
    return _clip_detail(request, pk, "intros")


@staff_api("POST")
def clip_toggle(request, pk):
    return _clip_toggle(pk, "intros")


# ---------------------------------------------------------------- الفيديوهات العادية
@staff_api("GET", "POST")
def videos(request):
    return _clip_list(request, "videos")


@staff_api("PATCH", "DELETE")
def video_detail(request, pk):
    return _clip_detail(request, pk, "videos")


@staff_api("POST")
def video_toggle(request, pk):
    return _clip_toggle(pk, "videos")


@staff_api("POST")
def video_move_to_intros(request, pk):
    """ينقل الفيديو لمكتبة الافتتاحيات — بيختفي من الفيديوهات ويفضل في الافتتاحيات بس."""
    try:
        clip = IntroVideo.objects.get(pk=pk, library="videos")
    except IntroVideo.DoesNotExist:
        raise Http404("غير موجود.")
    clip.library = "intros"
    clip.save(update_fields=["library", "updated_at"])
    return _clip_row(clip)


urlpatterns = [
    path("dashboard/fonts/", fonts, name="api_dashboard_fonts"),
    path("dashboard/fonts/<int:pk>/", font_detail, name="api_dashboard_font"),
    path("dashboard/fonts/<int:pk>/toggle/", font_toggle, name="api_dashboard_font_toggle"),
    path("dashboard/music/", music, name="api_dashboard_music"),
    path("dashboard/music/<int:pk>/", track_detail, name="api_dashboard_track"),
    path("dashboard/music/<int:pk>/toggle/", track_toggle, name="api_dashboard_track_toggle"),
    path("dashboard/intros/", intros, name="api_dashboard_intros"),
    path("dashboard/intros/<int:pk>/", clip_detail, name="api_dashboard_clip"),
    path("dashboard/intros/<int:pk>/toggle/", clip_toggle, name="api_dashboard_clip_toggle"),
    path("dashboard/videos/", videos, name="api_dashboard_videos"),
    path("dashboard/videos/<int:pk>/", video_detail, name="api_dashboard_video"),
    path("dashboard/videos/<int:pk>/toggle/", video_toggle, name="api_dashboard_video_toggle"),
    path("dashboard/videos/<int:pk>/move/", video_move_to_intros, name="api_dashboard_video_move"),
]
