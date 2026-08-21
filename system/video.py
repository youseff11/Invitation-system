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


def compress(upload, *, max_seconds: int = 0, keep_audio: bool = True):
    """يرجّع ``(ملف, ثواني)``. لو ffmpeg مش موجود بيرجّع الأصل زي ما هو.

    ``max_seconds`` بصفر يعني «ماتقصّش» — وده الافتراضي عن قصد.
    """
    if not available():
        upload.seek(0)
        return upload, 0.0

    src_suffix = os.path.splitext(getattr(upload, "name", "") or "")[1][:8] or ".mp4"
    src_path = dst_path = None
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
