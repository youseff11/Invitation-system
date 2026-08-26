"""ضغط الفيديو المرفوع.

الضغط الحقيقي محتاج ffmpeg. لو مش متثبّت على الاستضافة، الملف بيتخزن زي
ما هو (وحد الـ٨ ميجا لسه شغّال) — المشروع مابيقعش، بس الملف بيبقى أتقل.

فلسفة الضغط هنا: **مانخسرش حاجة المستخدم ممكن يلاحظها**.
- بننزّل الارتفاع لـ٧٢٠p: الدعوة بتتشاف على تليفون، و١٠٨٠p مالوش لزوم.
- بنعيد الترميز بـCRF ٣٠: الفرق مش بيتشاف على شاشة ٦ بوصة.
- بنسيب الصوت (بجودة أقل): قسم الفيديو ممكن يكون مقطع فرح ليه صوت،
  وفيديو الافتتاحية بيتشغّل صامت من طرف المتصفح مش من طرف الملف.
- **مابنقصّش المدة**: القص الصامت بيبوّظ مقطع طويل من غير ما المستخدم يعرف.
  التحكم في مدة الافتتاحية موجود في إعداد ``intro_video_seconds``.
"""

from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile

from django.core.files.uploadedfile import InMemoryUploadedFile

MAX_HEIGHT = 720          # الدعوة بتتشاف على تليفون
CRF = 30                  # ٢٨-٣٢ نطاق كويس للمقاطع القصيرة
AUDIO_KBPS = 64           # مونو ٦٤k — كفاية لسماعة تليفون
TIMEOUT = 180

# حد الرفع للفيديو **قبل** الضغط. الصور حدها ٨ ميجا وده كفاية جداً، لكن
# مقطع ٢٠ ثانية متصوّر بالموبايل بيطلع ٢٥-٣٥ ميجا — فالـ٨ ميجا كانت
# بترفض أي مقطع حقيقي. المكان واحد هنا عشان الرفع من المحرر ومن مكتبة
# الافتتاحيات مايختلفوش في الحد.
MAX_UPLOAD_BYTES = 40 * 1024 * 1024


def available() -> bool:
    return bool(shutil.which("ffmpeg"))


# --------------------------------------------------------------------------
# نقل الـmoov للأول من غير ffmpeg
# --------------------------------------------------------------------------
# ملف MP4 فيه صندوقين مهمين: ‎mdat‎ (الفيديو نفسه) و‎moov‎ (الفهرس —
# مواضع الفريمات والمدة والأبعاد). المتصفح **مايقدرش يبدأ العرض قبل ما
# يقرا الـmoov**. أغلب برامج التصدير بتكتبه في آخر الملف، فالمتصفح
# بينزّل الملف كله الأول وبعدين يشغّل. على اللوكال ده ملحوظش لأن
# التنزيل من نفس الجهاز، وعلى استضافة بطيئة بيبقى ثواني سودا.
#
# ffmpeg بيحل ده بـ‎-movflags +faststart‎، لكن لو مش متثبّت كنا بنسيب
# الملف زي ما هو **من غير أي رسالة**. النقل نفسه مش محتاج إعادة ترميز:
# بناخد الـmoov ونحطه بعد ‎ftyp‎ ونزوّد كل أوفستات الشُنك بمقداره.
# الملف بيفضل بنفس الحجم والجودة بالظبط — بس بيبدأ فوراً.

_CONTAINERS = {b"moov", b"trak", b"mdia", b"minf", b"stbl", b"edts", b"udta"}


def _atoms(data, start, end):
    """يمشي على الصناديق في مستوى واحد: ``(النوع, الموضع, الحجم, الترويسة)``."""
    pos = start
    while pos + 8 <= end:
        size = int.from_bytes(data[pos:pos + 4], "big")
        typ = bytes(data[pos + 4:pos + 8])
        head = 8
        if size == 1:                      # حجم ٦٤-بت للملفات الكبيرة
            if pos + 16 > end:
                return
            size = int.from_bytes(data[pos + 8:pos + 16], "big")
            head = 16
        elif size == 0:                    # لآخر الملف
            size = end - pos
        if size < head or pos + size > end:
            return                         # ملف مقصوص أو مكسور
        yield typ, pos, size, head
        pos += size


def _shift_offsets(buf, start, end, delta):
    """يزوّد كل أوفستات الشُنك جوّه الـmoov.

    الأوفستات دي مطلقة من بداية الملف، فلما الـmoov يتقدّم لازم كلها
    تتزحزح بنفس المقدار — وإلا الفيديو بيبقى موجود ومش بيتفك.
    """
    for typ, pos, size, head in _atoms(buf, start, end):
        if typ in _CONTAINERS:
            _shift_offsets(buf, pos + head, pos + size, delta)
        elif typ in (b"stco", b"co64"):
            wide = typ == b"co64"
            step = 8 if wide else 4
            count = int.from_bytes(buf[pos + head + 4:pos + head + 8], "big")
            base = pos + head + 8
            for i in range(count):
                at = base + i * step
                if at + step > pos + size:
                    break
                value = int.from_bytes(buf[at:at + step], "big") + delta
                if not wide:
                    value &= 0xFFFFFFFF
                buf[at:at + step] = value.to_bytes(step, "big")


def moov_is_late(data: bytes) -> bool:
    """الفهرس في آخر الملف؟ يعني المتصفح هيستنى التنزيل كله."""
    kinds = [t for t, _p, _s, _h in _atoms(data, 0, len(data))]
    if b"moov" not in kinds or b"mdat" not in kinds:
        return False
    return kinds.index(b"moov") > kinds.index(b"mdat")


def faststart_bytes(data: bytes):
    """يرجّع نفس الملف والـmoov في أوله — أو ``None`` لو مفيش داعي.

    مفيش إعادة ترميز: نفس البايتات بترتيب مختلف، فالجودة والحجم زي ما هم.
    """
    try:
        top = list(_atoms(data, 0, len(data)))
        if not top:
            return None
        kinds = [t for t, _p, _s, _h in top]
        if b"moov" not in kinds or b"mdat" not in kinds:
            return None
        if kinds.index(b"moov") < kinds.index(b"mdat"):
            return None                    # جاهز أصلاً

        _typ, mpos, msize, mhead = next(a for a in top if a[0] == b"moov")
        moov = bytearray(data[mpos:mpos + msize])
        # كل حاجة كانت بين ftyp والـmoov هتتزحزح بمقدار حجم الـmoov
        _shift_offsets(moov, mhead, len(moov), msize)

        out = bytearray()
        for typ, pos, size, _h in top:
            if typ == b"ftyp":
                out += data[pos:pos + size]
        out += moov
        for typ, pos, size, _h in top:
            if typ not in (b"ftyp", b"moov"):
                out += data[pos:pos + size]
        return bytes(out)
    except Exception:
        return None                        # أي شك = مانلمسش الملف


def _browserize_quicktime(data: bytes) -> bytes:
    """يحوّل علامة QuickTime إلى ISO MP4 بدون إعادة ترميز.

    ملفات MOV التي تحتوي H.264 تستخدم نفس صناديق MP4 تقريباً، لكن بعض
    المتصفحات ترفضها عندما تكون علامة الحاوية ``qt  `` فقط. نحافظ على
    نفس الفريمات والبايتات ونغيّر علامة الحاوية ذات الطول الثابت فقط.
    """
    try:
        for typ, pos, size, head in _atoms(data, 0, len(data)):
            if typ == b"ftyp" and size >= head + 12:
                major = data[pos + head:pos + head + 4]
                if major != b"qt  ":
                    return data
                out = bytearray(data)
                out[pos + head:pos + head + 4] = b"isom"
                if size >= head + 12:
                    out[pos + head + 8:pos + head + 12] = b"isom"
                return bytes(out)
            if typ != b"ftyp":
                break
    except Exception:
        pass
    return data


def _faststart_upload(upload):

    """يطبّق النقل على ملف مرفوع ويرجّع نسخة جاهزة — أو الأصل."""
    try:
        upload.seek(0)
        data = upload.read()
        moved = faststart_bytes(data)
        upload.seek(0)

        source_name = getattr(upload, "name", "video") or "video"
        source_ext = os.path.splitext(source_name)[1].lower()
        if not moved and source_ext == ".mp4":
            return upload
        payload = moved or data
        if source_ext in {".mov", ".m4v"}:
            payload = _browserize_quicktime(payload)
        stem = source_name.rsplit(".", 1)[0][:60]
        return InMemoryUploadedFile(
            io.BytesIO(payload), "FileField", f"{stem}.mp4", "video/mp4",
            len(payload), None,
        )
    except Exception:

        try:
            upload.seek(0)
        except Exception:
            pass
        return upload


def make_thumbnail(upload, *, max_width: int = 640):
    """استخراج أول فريم كصورة JPEG لاستخدامه في بطاقة مكتبة الفيديو.

    لا نلمس ملف الفيديو نفسه ولا نعيد ترميزه؛ يتم إنشاء صورة صغيرة منفصلة.
    لو لم يكن ffmpeg متاحاً أو تعذّر قراءة الفيديو، نرجع ``None`` ويظل
    الفيديو صالحاً للرفع بدون تعطيل العملية.
    """
    if not available():
        return None

    src_path = thumb_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".video", delete=False) as src:
            upload.seek(0)
            for chunk in getattr(upload, "chunks", lambda: [upload.read()])():
                src.write(chunk)
            src_path = src.name

        thumb_path = src_path + ".thumb.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path,
             "-frames:v", "1", "-vf", f"scale={max_width}:-2",
             "-q:v", "4", thumb_path],
            check=True, timeout=TIMEOUT, stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        with open(thumb_path, "rb") as fh:
            data = fh.read()
        if not data:
            return None
        stem = (getattr(upload, "name", "video") or "video").rsplit(".", 1)[0][:60]
        return InMemoryUploadedFile(
            io.BytesIO(data), "ImageField", f"{stem}-thumb.jpg", "image/jpeg",
            len(data), None,
        )
    except Exception:
        return None
    finally:
        try:
            upload.seek(0)
        except Exception:
            pass
        for path in (src_path, thumb_path):
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except OSError:
                    pass


def prepare_for_stream(upload):
    """ينقل بيانات MP4 إلى البداية من غير إعادة ترميز أو فقد جودة.

    ``-movflags +faststart`` يجعل المتصفح يقرأ metadata ويفك أول فريم
    قبل اكتمال تنزيل الملف. لو كان الملف غير MP4 أو ffmpeg غير متاح،
    نرجع الملف الأصلي بأمان.
    """
    if not str(getattr(upload, "name", "")).lower().endswith((".mp4", ".mov", ".m4v")):
        upload.seek(0)
        return upload, 0.0

    if not available():
        # من غير ffmpeg لسه نقدر ننقل الفهرس بنفسنا — ده اللي بيخلي
        # الفيديو يبدأ فوراً، ومش محتاج إعادة ترميز.
        return _faststart_upload(upload), 0.0

    src_path = dst_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as src:
            upload.seek(0)
            for chunk in getattr(upload, "chunks", lambda: [upload.read()])():
                src.write(chunk)
            src_path = src.name
        dst_path = src_path + ".faststart.mp4"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path,
             "-map", "0", "-c", "copy", "-movflags", "+faststart", dst_path],
            check=True, timeout=TIMEOUT, stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        size = os.path.getsize(dst_path)
        if not size:
            raise RuntimeError("ناتج فاضي")
        with open(dst_path, "rb") as fh:
            data = fh.read()
        stem = (getattr(upload, "name", "video") or "video").rsplit(".", 1)[0][:60]
        return InMemoryUploadedFile(
            io.BytesIO(data), "FileField", f"{stem}.mp4", "video/mp4", len(data), None
        ), _duration(dst_path)
    except Exception:
        return _faststart_upload(upload), 0.0
    finally:
        for path in (src_path, dst_path):
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except OSError:
                    pass


def compress(upload, *, max_seconds: int = 0, keep_audio: bool = True):
    """يرجّع ``(ملف, ثواني)``. لو ffmpeg مش موجود بيرجّع الأصل زي ما هو.

    ``max_seconds`` بصفر يعني «ماتقصّش» — وده الافتراضي عن قصد.
    """
    if not available():
        # الضغط محتاج ffmpeg، لكن نقل الفهرس لأ — وده أهم حاجة للسرعة
        if str(getattr(upload, "name", "")).lower().endswith(".mp4"):
            return _faststart_upload(upload), 0.0
        upload.seek(0)
        return upload, 0.0

    src_path = dst_path = None
    src_suffix = (os.path.splitext(getattr(upload, "name", "") or "")[1][:8] or ".mp4")

    try:
        with tempfile.NamedTemporaryFile(suffix=src_suffix, delete=False) as src:
            upload.seek(0)
            for chunk in getattr(upload, "chunks", lambda: [upload.read()])():
                src.write(chunk)
            src_path = src.name

        dst_path = src_path + ".out.mp4"
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path]
        if max_seconds:
            cmd += ["-t", str(max_seconds)]
        cmd += [
            "-vf", f"scale=-2:'min({MAX_HEIGHT},ih)'",   # -2 يخلي العرض زوجي
            "-c:v", "libx264", "-preset", "veryfast", "-crf", str(CRF),
            "-pix_fmt", "yuv420p",                       # يشتغل على كل الأجهزة
            "-movflags", "+faststart",                   # يبدأ العرض قبل ما يكمّل تحميل
        ]
        cmd += ["-an"] if not keep_audio else [
            "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ac", "1",
        ]
        cmd.append(dst_path)

        subprocess.run(cmd, check=True, timeout=TIMEOUT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

        size = os.path.getsize(dst_path)
        if not size:
            raise RuntimeError("ناتج فاضي")

        # لو الضغط طلع أكبر من الأصل (فيديو مضغوط كويس أصلاً) نسيب الأصل
        if size >= getattr(upload, "size", size + 1):
            upload.seek(0)
            return upload, _duration(src_path)

        with open(dst_path, "rb") as fh:
            data = fh.read()
        stem = (getattr(upload, "name", "video") or "video").rsplit(".", 1)[0][:60]
        return InMemoryUploadedFile(
            io.BytesIO(data), "FileField", f"{stem}.mp4", "video/mp4", len(data), None
        ), _duration(dst_path)

    except Exception:
        # أي فشل = نرجّع الأصل. الرفع مايفشلش عشان الضغط فشل.
        upload.seek(0)
        return upload, 0.0
    finally:
        for path in (src_path, dst_path):
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except OSError:
                    pass


def _duration(path: str) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", path],
            capture_output=True, text=True, timeout=20, check=True,
        )
        return round(float(out.stdout.strip() or 0), 2)
    except Exception:
        return 0.0
