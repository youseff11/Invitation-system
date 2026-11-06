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
import re
import shutil
import subprocess
import tempfile

from django.core.files.uploadedfile import InMemoryUploadedFile

MAX_HEIGHT = 720          # الدعوة بتتشاف على تليفون
CRF = 30                  # ٢٨-٣٢ نطاق كويس للمقاطع القصيرة
AUDIO_KBPS = 64           # مونو ٦٤k — كفاية لسماعة تليفون
TIMEOUT = 180
THUMB_SHORT_SIDE = 1080   # غلاف ملء الشاشة على تليفون

# حد الرفع للفيديو **قبل** الضغط. الصور حدها ٨ ميجا وده كفاية جداً، لكن
# مقطع ٢٠ ثانية متصوّر بالموبايل بيطلع ٢٥-٣٥ ميجا — فالـ٨ ميجا كانت
# بترفض أي مقطع حقيقي. المكان واحد هنا عشان الرفع من المحرر ومن مكتبة
# الافتتاحيات مايختلفوش في الحد.
MAX_UPLOAD_BYTES = 40 * 1024 * 1024


def ffmpeg_bin() -> str:
    """مسار ffmpeg: المتثبّت على السيستم، وإلا النسخة اللي جاية مع ``imageio-ffmpeg``.

    الاستضافة (PythonAnywhere) مافيهاش ffmpeg في الـPATH، فكل الضغط وصور
    الغلاف كانوا بيتخطّوا من غير ما حد ياخد باله — وفيديو 4K بـ14Mbps كان
    بيتخزّن زي ما هو ويقف على الموبايل. ``pip install imageio-ffmpeg``
    بيجيب ffmpeg ثابت جاهز من غير صلاحيات سيستم.
    """
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return ""


def available() -> bool:
    return bool(ffmpeg_bin())


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


def make_thumbnail(upload, *, max_width: int = 1920):
    """استخراج أول فريم كصورة JPEG.

    الصورة دي مش بطاقة مكتبة بس — هي كمان ``poster`` الافتتاحية اللي
    بيتعرض **ملء الشاشة** قبل ما الفيديو يشتغل، فلازم تبقى بمقاس
    الفيديو نفسه مش مصغّرة.

    ``scale='min(max_width,iw)':-2`` بتعمل حاجتين: مابتكبّرش فيديو
    أصغر من الحد (تكبير = تهويش من غير أي فايدة)، وبتقصّ الفيديوهات
    الكبيرة عند الحد.

    **مقيس** (نفس حالة فيديو الواتساب اللي اتشكى منه): الملف مخزَّن
    ``1024×576`` ومعاه ``rotate=90``، والفلتر القديم ``scale=640:-2``
    كان بيطلّع ``640×360`` — يعني ``360×640`` بعد الدوران، وبيتعرض
    على شاشة عرضها ``790px`` (تكبير ٢.٢ مرة) فيبان مهزوز. الفلتر
    الجديد بيطلّع ``1024×576`` = ``576×1024`` بعد الدوران، مقاس
    الفيديو الأصلي بالظبط (٢.٨ ضعف البكسل).

    ``max_width`` = ``1920`` عشان الفيديو الأفقي ``1920×1080`` ياخد
    غلافه بمقاسه الأصلي هو كمان. الفيديو الرأسي (وده الغالب في
    الدعوات) عرضه ``1080`` أصلاً فالفلتر مابيلمسهوش.

    **مهم**: ابعت لها الملف **الأصلي** مش الناتج من ``compress`` —
    الضغط بينزّل الارتفاع لـ٧٢٠p وبيرمّز بـCRF ٣٠، والغلاف بيورّث
    التهويش ده وهو بيتعرض ملء الشاشة.

    لا نلمس ملف الفيديو نفسه ولا نعيد ترميزه؛ يتم إنشاء صورة منفصلة.
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
        # أصغر ضلع لحد ‎THUMB_SHORT_SIDE‎ وJPEG بأعلى جودة تقريباً: الغلاف بيتعرض
        # ملء الشاشة فلازم يفضل حاد، بس PNG بمقاس فيديو 4K كان هيطلع ١٠ ميجا
        # ويتحمّل قبل الفيديو نفسه.
        side = THUMB_SHORT_SIDE
        subprocess.run(
            [ffmpeg_bin(), "-y", "-loglevel", "error", "-i", src_path,
             "-vf", (f"scale='if(gte(iw,ih),-2,min({side},iw))':"
                     f"'if(gte(iw,ih),min({side},ih),-2)'"),
             "-frames:v", "1", "-q:v", "2", thumb_path],
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
            [ffmpeg_bin(), "-y", "-loglevel", "error", "-i", src_path,
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
        cmd = [ffmpeg_bin(), "-y", "-loglevel", "error", "-i", src_path]
        if max_seconds:
            cmd += ["-t", str(max_seconds)]
        cmd += [
            # أصغر ضلع مش الارتفاع: الرأسي كان بيطلع ‎405×720‎ ويتمطّ على الشاشة
            "-vf", (f"scale='if(gte(iw,ih),-2,min({MAX_HEIGHT},iw))':"
                    f"'if(gte(iw,ih),min({MAX_HEIGHT},ih),-2)'"),
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
    info = probe(path)
    return round(info.get("duration", 0.0), 2)


_DUR_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_VID_RE = re.compile(r"Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b[^\n]*")
_FPS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*fps")
_ROT_RE = re.compile(r"(?:rotate\s*:\s*|rotation of\s*)(-?\d+)")


def probe(path: str) -> dict:
    """مدة/مقاس/fps الفيديو من ‎ffmpeg -i‎ (مفيش ffprobe مع ‎imageio-ffmpeg‎).

    المقاس بعد الدوران: فيديو الموبايل بيتخزّن أفقي ومعاه ‎rotate=90‎.
    """
    binary = ffmpeg_bin()
    if not binary:
        return {}
    try:
        out = subprocess.run([binary, "-hide_banner", "-i", path],
                             capture_output=True, text=True, timeout=30,
                             encoding="utf-8", errors="replace")
    except Exception:
        return {}
    text = out.stderr or ""
    info: dict = {}
    m = _DUR_RE.search(text)
    if m:
        h, mnt, sec = m.groups()
        info["duration"] = int(h) * 3600 + int(mnt) * 60 + float(sec)
    v = _VID_RE.search(text)
    if v:
        w, h = int(v.group(1)), int(v.group(2))
        rot = _ROT_RE.search(text)
        if rot and abs(int(rot.group(1))) % 180 == 90:
            w, h = h, w
        info["width"], info["height"] = w, h
        f = _FPS_RE.search(v.group(0))
        if f:
            info["fps"] = float(f.group(1))
    return info


# --------------------------------------------------------------------------
# نسخة الموبايل (‎.web.mp4‎)
# --------------------------------------------------------------------------
# الأصل بيفضل زي ما هو (صاحب الدعوة عايز جودته)، وجنبه نسخة خفيفة هي اللي
# بتتعرض في الدعوة. مقيس على دعوة حقيقية: فيديو ‎2160×3840‎ بـ60fps و14.5Mbps
# (17 ميجا لـ9 ثواني) — على 4G الموبايل كان بيستنى ثواني قدام مربّع بني،
# والآيفون كان بيوقف الافتتاحية نفسها لأنها بتتحمّل بالتوازي معاه.
WEB_SUFFIX = ".web.mp4"
WEB_SHORT_SIDE = 720       # أصغر ضلع: ‎720×1280‎ للرأسي — شاشة التليفون
WEB_FPS = 30
WEB_CRF = 26
WEB_MAXRATE_K = 1500       # سقف المعدل: البث يفضل ماشي على 4G ضعيف
WEB_AUDIO_K = 96
WEB_TIMEOUT = 300
VIDEO_EXTS = {".mp4", ".m4v", ".mov", ".webm"}


def web_path(path: str) -> str:
    return os.path.splitext(path)[0] + WEB_SUFFIX


def is_web_rendition(path: str) -> bool:
    return str(path).lower().endswith(WEB_SUFFIX)


def needs_web_rendition(path: str, info: dict | None = None) -> bool:
    """الأصل تقيل على الموبايل؟ (مقاس أكبر من 720، fps فوق 30، أو معدل عالي)."""
    info = probe(path) if info is None else info
    if not info.get("width") or not info.get("duration"):
        return False
    short = min(info["width"], info["height"])
    kbps = os.path.getsize(path) * 8 / 1000 / max(info["duration"], 0.1)
    return (short > WEB_SHORT_SIDE + 8
            or info.get("fps", 0) > WEB_FPS + 1
            or kbps > WEB_MAXRATE_K * 1.6)


def make_web_rendition(path: str, *, force: bool = False) -> str:
    """يعمل ‎<اسم>.web.mp4‎ جنب الأصل ويرجّع مساره، أو "" لو مش محتاج/فشل.

    ‎scale‎ على **أصغر ضلع** مش الارتفاع: الرأسي ‎2160×3840‎ يبقى ‎720×1280‎
    (مش ‎405×720‎). ‎-fpsmax‎ بينزّل الـ60 لـ30 ومابيرفعش الـ24.
    """
    if is_web_rendition(path) or os.path.splitext(path)[1].lower() not in VIDEO_EXTS:
        return ""
    binary = ffmpeg_bin()
    if not binary or not os.path.exists(path):
        return ""
    target = web_path(path)
    if not force and os.path.exists(target) and os.path.getmtime(target) >= os.path.getmtime(path):
        return target
    if not needs_web_rendition(path):
        return ""
    tmp = target + ".part.mp4"
    side = WEB_SHORT_SIDE
    scale = (f"scale='if(gte(iw,ih),-2,min({side},iw))':"
             f"'if(gte(iw,ih),min({side},ih),-2)'")
    try:
        subprocess.run(
            [binary, "-y", "-loglevel", "error", "-i", path,
             "-vf", scale, "-fpsmax", str(WEB_FPS),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", str(WEB_CRF),
             "-maxrate", f"{WEB_MAXRATE_K}k", "-bufsize", f"{WEB_MAXRATE_K * 2}k",
             "-profile:v", "main", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", f"{WEB_AUDIO_K}k",
             "-movflags", "+faststart", tmp],
            check=True, timeout=WEB_TIMEOUT,
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        if not os.path.getsize(tmp) or os.path.getsize(tmp) >= os.path.getsize(path):
            os.unlink(tmp)
            return ""
        os.replace(tmp, target)
        return target
    except Exception:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass
        return ""
