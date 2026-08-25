"""استيراد قالب من ملف HTML أو أرشيف ZIP.

بيحوّل القالب الجاهز لمستند بلوكات: كل عنصر رئيسي في ``<body>`` بيبقى
قسم ``custom_html`` تقدر ترتّبه وتخفيه وتعدّله من المحرر، والـCSS بيتحصر
جوّه القسم بتاعه (شوف ``cssscope``)، والصور بتتخزن كأصول وبتتربط بروابطها.

**حدود لازم تكون واضحة**: القالب المستورد مش هيبقى قابل للتعديل بنفس
سهولة القوالب الأصلية — مفيش حقول «اسم العروسة» و«التاريخ» لأننا
مانعرفش نستنتجها من HTML عشوائي. تقدر تعدّل النص مباشرة، بس مش هتلاقي
مُفتّش بحقول جاهزة. ده تنازل مقصود مقابل إنك ترفع أي قالب.

الأمان: الأرشيف جاي من بره، فالمستورد بيرفض المسارات الخارجة عن الفولدر
والروابط الرمزية والأرشيفات المنتفخة، وبينقّي HTML وCSS قبل التخزين.
"""

from __future__ import annotations

import hashlib
import io
import os
import posixpath
import re
import urllib.parse
import urllib.request
import zipfile

from html import unescape as _unescape
from html.parser import HTMLParser

from django.conf import settings
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.utils.text import slugify

from . import blocks as blocks_engine
from . import cssscope, images, video

from .models import Asset, Template
from .sanitize import clean_html
from .renderer import get_template_preview

MAX_ARCHIVE_BYTES = 50 * 1024 * 1024      # حجم الملف المرفوع نفسه
MAX_UNPACKED_BYTES = 150 * 1024 * 1024     # مجموع الحجم بعد فك الضغط
MAX_MEMBERS = 400
MAX_RATIO = 120                           # نسبة انتفاخ مشبوهة = zip bomb
MAX_BLOCKS = 40
MAX_BLOCK_HTML = 100000
MAX_RUNTIME_SCRIPTS = 80
MAX_RUNTIME_SCRIPT_BYTES = 8 * 1024 * 1024
MAX_INLINE_SCRIPT_BYTES = 256 * 1024
MAX_REMOTE_IMAGE_BYTES = 8 * 1024 * 1024

MIN_VISIBLE_CHARS = 60     # أقل من كده = صفحة بلا كلام
_ALLOWED_REMOTE_IMAGE_HOSTS = {"static.tildacdn.net", "optim.tildacdn.net",
                               "thb.tildacdn.net", "res.cloudinary.com"}

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"}
CSS_EXT = {".css"}
HTML_EXT = {".html", ".htm"}
JS_EXT = {".js"}
FONT_EXT = {".woff2", ".woff", ".ttf", ".otf"}

AUDIO_EXT = {".mp3", ".m4a", ".ogg", ".wav"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}


class ImportError_(Exception):
    """خطأ متوقّع نعرضه للمستخدم بالعربي."""


# ==========================================================================
# قراءة الأرشيف
# ==========================================================================
def _safe_member_name(name: str) -> str | None:
    """يرجّع اسماً آمناً أو ``None`` لو الاسم بيحاول يخرج بره الفولدر."""
    name = name.replace("\\", "/")
    if name.endswith("/"):
        return None                                  # مجلد
    if name.startswith("/") or re.match(r"^[a-zA-Z]:", name):
        return None                                  # مسار مطلق
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts):                # ../../etc/passwd
        return None
    if not parts:
        return None
    return posixpath.join(*parts)


def _read_zip(raw: bytes) -> dict[str, bytes]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ImportError_("الملف مش أرشيف ZIP سليم.")

    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_MEMBERS:
            raise ImportError_(f"الأرشيف فيه أكتر من {MAX_MEMBERS} ملف.")

        total = sum(i.file_size for i in infos)
        if total > MAX_UNPACKED_BYTES:
            raise ImportError_("حجم الأرشيف بعد فك الضغط أكبر من اللازم.")
        if len(raw) and total / max(len(raw), 1) > MAX_RATIO:
            raise ImportError_("الأرشيف مضغوط بشكل مشبوه — اترفض.")

        files: dict[str, bytes] = {}
        for info in infos:
            # الروابط الرمزية بتخلي الاستخراج يكتب بره الفولدر
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                continue
            name = _safe_member_name(info.filename)
            if not name:
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext not in IMAGE_EXT | CSS_EXT | HTML_EXT | JS_EXT | FONT_EXT | AUDIO_EXT | VIDEO_EXT:
                continue          # الأنواع الأخرى لا تدخل التخزين

            if info.file_size > 8 * 1024 * 1024:
                continue
            with zf.open(info) as fh:
                files[name] = fh.read(info.file_size + 1)
        return files


def _pick_main_html(files: dict[str, bytes]) -> str:
    html_files = [n for n in files if os.path.splitext(n)[1].lower() in HTML_EXT]
    if not html_files:
        raise ImportError_("مفيش ملف HTML جوّه الأرشيف.")
    # index.html الأقرب للجذر هو الصفحة الرئيسية عادةً
    html_files.sort(key=lambda n: (
        os.path.basename(n).lower() not in ("index.html", "index.htm"),
        n.count("/"), len(n),
    ))
    return html_files[0]


# ==========================================================================
# تفكيك الـHTML
# ==========================================================================
class _Splitter(HTMLParser):
    """بيجمع ``<style>`` و``<link>`` وأولاد ``<body>`` المباشرين."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.styles: list[str] = []
        self.css_links: list[str] = []
        self.parts: list[str] = []
        self.title = ""
        self._in_body = False
        self._seen_body = False
        self._in_style = False
        self._in_title = False
        self._in_head = False
        self._depth = 0
        self._buf: list[str] = []
        self._void = {"br", "img", "hr", "input", "meta", "link", "source",
                      "area", "base", "col", "embed", "param", "track", "wbr"}

    # ---- مساعدات
    def _attrs(self, attrs):
        return "".join(
            f' {k}="{(v or "").replace(chr(34), "&quot;")}"' for k, v in attrs
        )

    def _flush(self):
        chunk = "".join(self._buf).strip()
        self._buf = []
        if chunk:
            self.parts.append(chunk)

    # ---- الأحداث
    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        if t == "body":
            self._in_body = True
            self._seen_body = True
            return
        if t == "head":
            self._in_head = True
            return
        if t == "style":
            self._in_style = True
            return
        if t == "title":
            self._in_title = True
            return
        if t == "link":
            d = dict(attrs)
            rel = (d.get("rel") or "").lower()
            href = d.get("href") or ""
            if "stylesheet" in rel and href:
                self.css_links.append(href)
            return
        if not self._in_body:
            # مافيش <html>/<head>/<body> — قصاصة HTML خام. أول وسم
            # محتوى بيبدأ الجسم بدل ما نرجّع «فاضي».
            if self._seen_body or t in ("html", "head", "meta", "link",
                                        "title", "style", "script"):
                return
            self._in_body = True
        if t in self._void:
            self._buf.append(f"<{t}{self._attrs(attrs)}>")
            return
        self._depth += 1
        self._buf.append(f"<{t}{self._attrs(attrs)}>")

    def handle_startendtag(self, tag, attrs):
        if self._in_body:
            self._buf.append(f"<{tag.lower()}{self._attrs(attrs)}>")

    def handle_endtag(self, tag):
        t = tag.lower()
        if t == "html":
            return                       # وسم هيكلي — مش جزء من المحتوى
        if t == "style":
            self._in_style = False
            return
        if t == "title":
            self._in_title = False
            return
        if t == "head":
            self._in_head = False
            # قصاصات HTML كتير مالهاش <body> خالص. من غير السطر ده
            # المستورد كان بيرجّع «مفيش محتوى» على ملف محتواه سليم.
            self._in_body = True
            return
        if t == "body":
            self._flush()
            self._in_body = False
            return
        if not self._in_body or t in self._void:
            return
        self._buf.append(f"</{t}>")
        self._depth = max(0, self._depth - 1)
        if self._depth == 0:
            self._flush()               # قفلنا عنصر رئيسي = قسم كامل

    def handle_data(self, data):
        if self._in_style:
            self.styles.append(data)
        elif self._in_title:
            self.title += data
        elif self._in_body:
            self._buf.append(data)

    def handle_entityref(self, name):
        if self._in_title:
            self.title += _unescape(f"&{name};")
        elif self._in_body:
            self._buf.append(f"&{name};")

    def handle_charref(self, name):
        if self._in_title:
            self.title += _unescape(f"&#{name};")
        elif self._in_body:
            self._buf.append(f"&#{name};")

    def close(self):
        super().close()
        self._flush()

    @property
    def saw_body(self) -> bool:
        return self._seen_body


class _ScriptExtractor(HTMLParser):
    """يستخرج script بالترتيب من غير إدخاله داخل HTML المنقّى."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts: list[dict[str, str]] = []
        self.current: dict[str, str] | None = None
        self.buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script" and self.current is None:
            self.current = {str(k).lower(): str(v or "") for k, v in attrs}
            self.buf = []

    def handle_startendtag(self, tag, attrs):
        if tag.lower() == "script":
            self.scripts.append({
                "src": str(dict(attrs).get("src") or "").strip(),
                "code": "",
            })

    def handle_data(self, data):
        if self.current is not None:
            self.buf.append(data)

    def handle_entityref(self, name):
        if self.current is not None:
            self.buf.append(f"&{name};")

    def handle_charref(self, name):
        if self.current is not None:
            self.buf.append(f"&#{name};")

    def handle_endtag(self, tag):
        if tag.lower() != "script" or self.current is None:
            return
        item = dict(self.current)
        item["src"] = str(item.get("src") or "").strip()
        item["code"] = "".join(self.buf)
        self.scripts.append(item)
        self.current = None
        self.buf = []

    def close(self):
        super().close()
        if self.current is not None:
            item = dict(self.current)
            item["src"] = str(item.get("src") or "").strip()
            item["code"] = "".join(self.buf)
            self.scripts.append(item)
            self.current = None
            self.buf = []


_COUNTDOWN_EXPIRED_RE = re.compile(
    r"if\s*\(\s*dist\s*<\s*0\s*\)\s*\{.*?return\s*;\s*\}",
    re.I | re.S,
)


def _keep_expired_countdown_visible(code: str) -> str:
    """يُبقي عدّاد القالب ظاهراً ويحوّل القيمة المنتهية إلى أصفار."""
    if "countdowncontainer" not in (code or "").lower():
        return code
    return _COUNTDOWN_EXPIRED_RE.sub("if (dist < 0) { dist = 0; }", code, count=1)


_OPENING_SCRIPT_MARKERS = {
    "weioverlay", "weivideo", "weiaudio", "weitapwrap", "open your invitation",
}


def _is_javascript_type(value: str) -> bool:
    value = (value or "").strip().lower()
    return not value or value in {"text/javascript", "application/javascript", "module"}


def _looks_like_opening_script(item: dict[str, str]) -> bool:
    blob = (str(item.get("src") or "") + " " + str(item.get("code") or "")).lower()
    return any(marker in blob for marker in _OPENING_SCRIPT_MARKERS)


def _runtime_root_attrs(html: str) -> dict[str, str]:
    """يأخذ خصائص غلاف allrecords اللازمة لتشغيل مكتبات Tilda."""
    match = re.search(
        r"<div\b(?=[^>]*\bid\s*=\s*['\"]allrecords['\"])[^>]*>",
        html or "", re.I,
    )
    if not match:
        return {}
    attrs: dict[str, str] = {"id": "allrecords"}
    for key, _quote, value in re.findall(
        r"([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(['\"])(.*?)\2",
        match.group(0), re.S,
    ):
        key = key.lower()
        if key in {"id", "class"} or key.startswith("data-"):
            attrs[key] = value[:300]
    return attrs


def _unwrap_allrecords(part: str) -> str:
    """يشيل غلاف allrecords من البلوك؛ الصفحة النهائية تضيف غلافاً واحداً."""
    part = re.sub(
        r"^\s*<div\b(?=[^>]*\bid\s*=\s*['\"]allrecords['\"])[^>]*>",
        "", part, count=1, flags=re.I,
    )
    part = re.sub(r"</div>\s*</div>\s*$", "</div>", part, count=1, flags=re.S)
    return part


def _store_runtime_scripts(html: str, main: str, files: dict[str, bytes],
                           url_map: dict[str, str]) -> list[dict[str, str]]:
    """يخزن كل سكربتات القالب المشار إليها لتُشغّل في صفحة القالب فقط.

    لا نضع script داخل custom_html؛ لأن منقّي HTML يحذفه عمداً. بدلاً من ذلك
    نحفظه كبيانات runtime منفصلة، ونُحقنه في الصفحة العامة بعد HTML القالب.
    """
    from django.core.files.base import ContentFile
    from django.core.files.storage import default_storage

    parser = _ScriptExtractor()
    parser.feed(html or "")
    parser.close()
    scripts: list[dict[str, str]] = []
    stored_bytes = 0
    base_dir = posixpath.dirname(main)

    for item in parser.scripts[:MAX_RUNTIME_SCRIPTS]:
        if not _is_javascript_type(item.get("type", "")):
            continue
        src = (item.get("src") or "").strip()
        code = _keep_expired_countdown_visible(item.get("code") or "")
        if src:
            parsed = urllib.parse.urlparse(src)
            if parsed.scheme or parsed.netloc:
                # بعض القوالب تحتاج مكتبات Tilda/Google من CDN. نسمح
                # بروابط HTTPS فقط ونحافظ على ترتيبها داخل صفحة المعاينة.
                if parsed.scheme.lower() == "https" and parsed.netloc:
                    scripts.append({"src": src, "type": item.get("type") or ""})
                elif not parsed.scheme and parsed.netloc:
                    scripts.append({"src": "https:" + src, "type": item.get("type") or ""})
                continue
            key = posixpath.normpath(posixpath.join(base_dir, parsed.path.lstrip("./")))
            data = files.get(key) or files.get(os.path.basename(key))
            if not data or stored_bytes + len(data) > MAX_RUNTIME_SCRIPT_BYTES:
                continue
            safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(key)) or "script.js"
            digest = hashlib.sha256(data).hexdigest()[:16]
            path = default_storage.save(
                f"template_scripts/{digest}-{safe_name}", ContentFile(data)
            )
            url = default_storage.url(path)
            url_map[key] = url
            url_map.setdefault(os.path.basename(key), url)
            scripts.append({"src": url, "type": item.get("type") or ""})
            stored_bytes += len(data)
        elif code.strip() and len(code.encode("utf-8")) <= MAX_INLINE_SCRIPT_BYTES:
            scripts.append({"code": code, "type": item.get("type") or ""})

    return scripts


class _OpeningStripper(HTMLParser):

    """يزيل شاشة الافتتاحية الأصلية من غير لمس باقي محتوى الصفحة."""

    _VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
             "link", "meta", "param", "source", "track", "wbr"}
    _ID_RE = re.compile(
        r"^(?:wei(?:overlay|img|videowrap|video|audio|audiobtn)|"
        r"(?:preloader|loader|opening|intro|splash)(?:[-_].*)?)$", re.I)
    _CLASS_RE = re.compile(
        r"(?:preloader|loading-screen|opening-screen|opening-overlay|"
        r"intro-screen|intro-overlay|splash-screen)", re.I)
    _DATA_RE = re.compile(r"(?:opening|preloader|splash|intro)", re.I)

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out: list[str] = []
        self.skip_depth = 0
        self._skipped: list[str] = []

    @classmethod
    def _is_opening(cls, attrs):
        values = {str(k).lower(): str(v or "") for k, v in attrs}
        ident = values.get("id", "").strip()
        classes = values.get("class", "")
        data = " ".join(v for k, v in values.items() if k.startswith("data-"))
        return bool(
            (ident and cls._ID_RE.match(ident))
            or cls._CLASS_RE.search(classes)
            or (data and cls._DATA_RE.search(data))
        )

    def handle_starttag(self, tag, attrs):
        t = tag.lower()
        text = self.get_starttag_text() or ""
        if self.skip_depth:
            self._skipped.append(text)
            if t not in self._VOID:
                self.skip_depth += 1
            return
        if self._is_opening(attrs):
            self._skipped = [text]
            if t not in self._VOID:
                self.skip_depth = 1
            else:
                self._skipped = []
            return
        self.out.append(text)

    def handle_startendtag(self, tag, attrs):
        text = self.get_starttag_text() or ""
        if not self.skip_depth:
            self.out.append(text)

    def handle_endtag(self, tag):
        if self.skip_depth:
            if tag.lower() not in self._VOID:
                self.skip_depth -= 1
            return
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip_depth:
            self.out.append(data)

    def handle_entityref(self, name):
        if not self.skip_depth:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if not self.skip_depth:
            self.out.append(f"&#{name};")

    def handle_comment(self, data):
        if not self.skip_depth:
            self.out.append(f"<!--{data}-->")

    def handle_decl(self, decl):
        if not self.skip_depth:
            self.out.append(f"<!{decl}>")


def _strip_imported_openings(html: str) -> str:
    parser = _OpeningStripper()
    parser.feed(html or "")
    parser.close()
    return "".join(parser.out)


class _TildaRecordExtractor(HTMLParser):
    """يستخرج سجلات Tilda recNNN من داخل allrecords كسِجلات مستقلة."""

    _VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
             "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.current: list[str] = []
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        text = self.get_starttag_text() or ""
        t = tag.lower()
        if self.current:
            self.current.append(text)
            if t not in self._VOID:
                self.depth += 1
            return
        ident = dict(attrs).get("id", "")
        if t == "div" and re.match(r"^rec\d+$", ident or "", re.I):
            self.current = [text]
            self.depth = 1

    def handle_startendtag(self, tag, attrs):
        if self.current:
            self.current.append(self.get_starttag_text() or "")

    def handle_endtag(self, tag):
        if not self.current or tag.lower() in self._VOID:
            return
        self.current.append(f"</{tag}>")
        self.depth -= 1
        if self.depth <= 0:
            self.parts.append("".join(self.current))
            self.current = []
            self.depth = 0

    def handle_data(self, data):
        if self.current:
            self.current.append(data)

    def handle_entityref(self, name):
        if self.current:
            self.current.append(f"&{name};")

    def handle_charref(self, name):
        if self.current:
            self.current.append(f"&#{name};")

    def handle_comment(self, data):
        if self.current:
            self.current.append(f"<!--{data}-->")


def _split_tilda_records(html: str) -> list[str]:
    extractor = _TildaRecordExtractor()
    extractor.feed(html or "")
    extractor.close()
    if not extractor.parts:
        return []
    wrapper = '<div id="allrecords" class="t-records t-records_animated t-records_visible">'
    return [wrapper + part + "</div>" for part in extractor.parts]


_TAG_RE = re.compile(r"<[^>]+>")

_WS_RE = re.compile(r"\s+")
_SCRIPT_SRC_RE = re.compile(r"<script[^>]*\ssrc=", re.I)
_ROOT_DIV_RE = re.compile(
    r'<(div|main)[^>]*\sid=["\'](root|app|__next|__nuxt|___gatsby)["\']', re.I)


_HEADING_RE = re.compile(r"<h[1-6][^>]*>(.*?)</h[1-6]>", re.I | re.S)
_ROOT_TAG_RE = re.compile(r"^<(\w+)([^>]*)>", re.S)
_CLASS_RE = re.compile(r'\bclass="([^"]*)"', re.I)

# أسماء عربية للوسوم والكلاسات الشائعة في قوالب الدعوات
_TAG_LABELS = {"header": "الترويسة", "footer": "الخاتمة", "nav": "قائمة",
               "main": "المحتوى", "aside": "جانبي", "section": "قسم",
               "article": "مقال", "figure": "صورة", "audio": "صوت",
               "video": "فيديو", "button": "زر", "form": "نموذج"}
_CLASS_LABELS = {
    "hero": "الغلاف", "cover": "الغلاف", "intro": "المقدمة",
    "preloader": "شاشة التحميل", "loader": "شاشة التحميل",
    "envelope": "الظرف", "story": "قصتنا", "about": "عننا",
    "gallery": "المعرض", "photos": "الصور", "timeline": "البرنامج",
    "agenda": "البرنامج", "schedule": "البرنامج", "countdown": "العدّاد",
    "venue": "المكان", "location": "المكان", "map": "الخريطة",
    "place": "المكان", "rsvp": "تأكيد الحضور", "verse": "الآية",
    "quote": "اقتباس", "footer": "الخاتمة", "end": "الخاتمة",
    "contact": "التواصل", "gift": "الهدايا", "music": "الموسيقى",
}


def _guess_label(cleaned: str, raw_part: str, index: int) -> str:
    """اسم مفهوم للقسم المستورد.

    الترتيب: عنوان <h1-h6> جوّاه ← كلاس معروف ← اسم الوسم ← رقم.
    من غير ده كل الأقسام بتبقى «كود HTML مخصص» في القائمة.
    """
    m = _HEADING_RE.search(cleaned)
    if m:
        # الاسم بيتعرض كنص عادي، فلازم نفكّ الكيانات — وإلا بيبان
        # «ليلى &amp; كريم» في القائمة
        head = _unescape(_visible_text(m.group(1)))[:40].strip()
        if head:
            return head

    m = _ROOT_TAG_RE.match(raw_part.strip())
    if m:
        tag, attrs = m.group(1).lower(), m.group(2)
        cls = _CLASS_RE.search(attrs)
        for token in (cls.group(1).lower().split() if cls else []):
            for key, label in _CLASS_LABELS.items():
                if key in token:
                    return label
        if tag in _TAG_LABELS:
            return _TAG_LABELS[tag]

    text = _unescape(_visible_text(cleaned))[:36].strip()
    return text or f"قسم {index}"


def _visible_text(html: str) -> str:
    """النص اللي الضيف هيشوفه فعلاً — من غير وسوم ولا مسافات زيادة."""
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", html or "")).strip()


def _looks_scripted(html: str) -> bool:
    """هل الصفحة دي بتعتمد على جافاسكربت في بناء محتواها؟"""
    return bool(_ROOT_DIV_RE.search(html) or _SCRIPT_SRC_RE.search(html))


_STYLE_ATTR_RE = re.compile(r'(\sstyle=)(["\'])(.*?)\2', re.I | re.S)
_MEDIA_SRC_RE = re.compile(
    r'(<(?:img|video|audio|source|track)\b[^>]*?\s(?:src|poster)=)(["\'])(.*?)\2',
    re.I | re.S,
)
_IFRAME_SRC_RE = re.compile(
    r'(<iframe\b[^>]*?\ssrc=)(["\'])(.*?)\2', re.I | re.S,
)

_SRCSET_RE = re.compile(r'\ssrcset=(["\']).*?\1', re.I | re.S)
_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.I | re.S)
_ATTR_RE_TEMPLATE = r'({attr}\s*=\s*)(["\'])(.*?)\2'


def _remote_image_allowed(url: str) -> bool:
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False
    if parsed.scheme.lower() not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").lower().rstrip(".")
    return host in _ALLOWED_REMOTE_IMAGE_HOSTS


def _remote_image_bytes(url: str) -> tuple[bytes, str] | None:
    """يحاول جلب الصورة الأصلية من مصدر موثوق وبحد حجم صارم."""
    if not _remote_image_allowed(url):
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FarhaTemplateImporter/1.0"})
        with urllib.request.urlopen(req, timeout=8) as response:
            content_type = (response.headers.get("Content-Type") or "").lower()
            if not content_type.startswith("image/"):
                return None
            data = response.read(MAX_REMOTE_IMAGE_BYTES + 1)
        if not data or len(data) > MAX_REMOTE_IMAGE_BYTES:
            return None
        ext = posixpath.splitext(urllib.parse.urlparse(url).path)[1].lower()
        if ext not in IMAGE_EXT:
            mime = content_type.split(";", 1)[0].strip()
            ext = {
                "image/jpeg": ".jpg", "image/jpg": ".jpg",
                "image/png": ".png", "image/webp": ".webp",
                "image/gif": ".gif", "image/avif": ".avif",
                "image/svg+xml": ".svg",
            }.get(mime, "")
        if ext not in IMAGE_EXT:
            return None
        return data, ext
    except Exception:
        return None


def _upgrade_lazy_images(html: str, files: dict[str, bytes]) -> tuple[str, dict[str, bytes]]:
    """يستبدل thumbnail المحفوظ من SiteOne بصورة data-original الأصلية.

    SiteOne قد يحفظ ``src`` بحجم 20px بينما يضع الصورة الحقيقية في
    ``data-original``. نحمّل الأصل من نطاقات القالب المسموح بها فقط، ونترك
    النسخة المحلية كما هي لو فشل الاتصال.
    """
    if not html:
        return html, files
    expanded = dict(files)

    def replace_img(match):
        tag = match.group(0)
        original_match = re.search(_ATTR_RE_TEMPLATE.format(attr="data-original"), tag, re.I | re.S)
        if not original_match:
            return tag
        original_url = (original_match.group(3) or "").strip()
        downloaded = _remote_image_bytes(original_url)
        if not downloaded:
            return tag
        data, ext = downloaded
        key = "__remote__/{}/original{}".format(hashlib.sha256(original_url.encode()).hexdigest()[:20], ext)
        expanded[key] = data
        src_match = re.search(_ATTR_RE_TEMPLATE.format(attr="src"), tag, re.I | re.S)
        if not src_match:
            return tag
        start, end = src_match.span(3)
        return tag[:start] + key + tag[end:]

    return _IMG_TAG_RE.sub(replace_img, html), expanded


def _rewrite_inline_styles(html: str, url_map: dict[str, str]) -> str:
    """يحلّ ``url()`` جوّه style="" — من غير كده المنقّي بيرمي الخاصية كلها."""
    def repl(m):
        value = cssscope.resolve_urls(m.group(3), url_map)
        # resolve_urls بيلفّ الرابط بعلامتين تنصيص مزدوجة، ودي بتقفل
        # الخاصية نفسها. بنهرّبها — HTMLParser بيرجّعها تاني وقت القراءة.
        value = value.replace('"', "&quot;")
        return f"{m.group(1)}{m.group(2)}{value}{m.group(2)}"
    return _STYLE_ATTR_RE.sub(repl, html)


def _stream_video_url(url: str) -> str:
    """يوجّه فيديوهات media المحلية إلى endpoint يدعم Range Requests."""
    base = str(getattr(settings, "MEDIA_URL", "/media/") or "/media/")
    if not base.endswith("/"):
        base += "/"
    value = str(url or "")
    path, sep, query = value.partition("?")
    if path.startswith(base) and os.path.splitext(path)[1].lower() in VIDEO_EXT:
        value = "/media-video/" + path[len(base):].lstrip("/")
        if sep:

            value += "?" + query
    return value


_COORDINATE_PAIR_RE = re.compile(
    r"\[\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*\]"
)


def _google_maps_embed_fallback(page: str) -> str | None:
    """يستخرج إحداثيات embed المحفوظ ويستخدم رابط Google Maps عام بدلاً من API key قديم."""
    low = (page or "").lower()
    if not any(marker in low for marker in ("mapdiv", "initembed", "maps.googleapis.com")):
        return None
    pairs = []
    for match in _COORDINATE_PAIR_RE.finditer(page or ""):
        lat, lon = float(match.group(1)), float(match.group(2))
        if -90 <= lat <= 90 and -180 <= lon <= 180:
            pairs.append((lat, lon))
    if not pairs:
        return None
    lat, lon = pairs[-1]
    return "https://www.google.com/maps?q=" + urllib.parse.quote(
        f"{lat:.7f},{lon:.7f}", safe=","
    ) + "&output=embed"


_TN_ELEM_START_RE = re.compile(
    r"<div\b[^>]*\bclass=(['\"])[^'\"]*\btn-elem\b[^'\"]*\1[^>]*>",
    re.I | re.S,
)
_ATTR_RE = re.compile(r"\b([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(['\"])(.*?)\2", re.S)


def _tag_attr(tag: str, name: str) -> str:
    match = re.search(
        rf"\b{re.escape(name)}\s*=\s*(['\"])(.*?)\1", tag, re.I | re.S
    )
    return match.group(2) if match else ""


def _set_tag_attr(tag: str, name: str, value: str) -> str:
    pattern = rf"(\b{re.escape(name)}\s*=\s*)(['\"])(.*?)\2"
    if re.search(pattern, tag, re.I | re.S):
        return re.sub(
            pattern, lambda m: f'{m.group(1)}{m.group(2)}{value}{m.group(2)}',
            tag, count=1, flags=re.I | re.S,
        )
    return tag[:-1] + f' {name}="{value}"' + tag[-1:]


def _align_embedded_map_element(html: str) -> str:
    """يضع عنصر خريطة Tilda فوق الإطار الزخرفي بدلاً من إحداثيات window العامة."""
    low = (html or "").lower()
    if "<iframe" not in low or not any(
        marker in low for marker in ("google.com/maps", "maps.googleapis.com", "mapdiv")
    ):
        return html
    iframe_pos = low.find("<iframe")
    starts = list(_TN_ELEM_START_RE.finditer(html))
    html_candidates = [
        match for match in starts
        if match.start() < iframe_pos
        and _tag_attr(match.group(0), "data-elem-type").lower() == "html"
    ]
    if not html_candidates:
        return html
    html_match = html_candidates[-1]
    image_candidates = []
    for match in starts:
        if match.start() >= html_match.start():
            break
        tag = match.group(0)
        if _tag_attr(tag, "data-elem-type").lower() != "image":
            continue
        try:
            width = float(_tag_attr(tag, "data-field-width-value"))
            height = float(_tag_attr(tag, "data-field-height-value"))
        except (TypeError, ValueError):
            continue
        if 160 <= width <= 700 and 160 <= height <= 700 and abs(width - height) <= 24:
            image_candidates.append((abs(html_match.start() - match.start()), tag))
    if not image_candidates:
        return html
    frame_tag = min(image_candidates, key=lambda item: item[0])[1]
    map_tag = html_match.group(0)
    names = {
        "data-field-top-value", "data-field-left-value",
        "data-field-height-value", "data-field-width-value",
        "data-field-axisx-value", "data-field-axisy-value",
        "data-field-container-value", "data-field-topunits-value",
        "data-field-leftunits-value", "data-field-heightunits-value",
        "data-field-widthunits-value",
    }
    for match in _ATTR_RE.finditer(frame_tag):
        name, _quote, value = match.groups()
        if name.startswith("data-field-") and re.match(
            r"data-field-(?:top|left|height|width)(?:-res-[^-]+)?-value$", name, re.I
        ):
            names.add(name)
    for name in names:
        value = _tag_attr(frame_tag, name)
        if value:
            map_tag = _set_tag_attr(map_tag, name, value)
    start, end = html_match.span()
    return html[:start] + map_tag + html[end:]


def _rewrite_iframe_srcs(html: str, url_map: dict[str, str]) -> str:
    """يربط iframe محلياً بصفحة مخزنة، ويترك روابط Google الخارجية كما هي."""
    def repl(m):
        raw = (m.group(3) or "").strip()
        if raw.lower().startswith(("data:", "http://", "https://", "//")):
            return m.group(0)
        key = urllib.parse.unquote(raw.split("?", 1)[0].split("#", 1)[0]).lstrip("./")
        mapped = url_map.get(key) or url_map.get(os.path.basename(key))
        return f"{m.group(1)}{m.group(2)}{mapped or raw}{m.group(2)}"
    return _IFRAME_SRC_RE.sub(repl, html)


def _store_embedded_pages(files: dict[str, bytes], main: str,
                          url_map: dict[str, str]) -> None:
    """يحفظ صفحات iframe المحلية مع سكربتاتها التابعة ويعيد كتابة روابطها."""
    from django.core.files.base import ContentFile
    from django.core.files.storage import default_storage

    for name, data in files.items():
        if name == main or os.path.splitext(name)[1].lower() not in HTML_EXT:
            continue
        if not data or len(data) > 2 * 1024 * 1024:
            continue
        try:
            page = data.decode("utf-8")
        except UnicodeDecodeError:
            page = data.decode("cp1256", errors="replace")
        maps_fallback = _google_maps_embed_fallback(page)
        if maps_fallback:
            url_map[name] = maps_fallback
            url_map.setdefault(os.path.basename(name), maps_fallback)
            continue
        page_dir = posixpath.dirname(name)
        for match in re.finditer(
            r'(<script\b[^>]*?\bsrc\s*=\s*)(["\'])([^"\']+)(\2)',
            page, re.I,
        ):
            ref = match.group(3).strip()
            parsed = urllib.parse.urlparse(ref)
            if parsed.scheme or parsed.netloc:
                continue
            key = posixpath.normpath(posixpath.join(page_dir, parsed.path.lstrip("./")))
            script_data = files.get(key) or files.get(os.path.basename(key))
            if not script_data or len(script_data) > MAX_RUNTIME_SCRIPT_BYTES:
                continue
            safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(key)) or "script.js"
            digest = hashlib.sha256(script_data).hexdigest()[:16]
            script_path = default_storage.save(
                f"template_pages/{digest}-{safe_name}", ContentFile(script_data)
            )
            script_url = default_storage.url(script_path)
            url_map[key] = script_url
            url_map.setdefault(os.path.basename(key), script_url)
            page = page.replace(f'src="{ref}"', f'src="{script_url}"')
            page = page.replace(f"src='{ref}'", f"src='{script_url}'")
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.basename(name)) or "embed.html"
        digest = hashlib.sha256(page.encode("utf-8")).hexdigest()[:16]
        page_path = default_storage.save(
            f"template_pages/{digest}-{safe_name}", ContentFile(page.encode("utf-8"))
        )
        page_url = default_storage.url(page_path)
        url_map[name] = page_url
        url_map.setdefault(os.path.basename(name), page_url)


def _rewrite_media_srcs(html: str, url_map: dict[str, str]) -> str:

    """يحل مسارات الصور والفيديو والصوت وposter داخل HTML."""

    html = _SRCSET_RE.sub("", html)      # srcset بيشاور على ملفات مش مخزّنة
    def repl(m):
        raw = (m.group(3) or "").strip()
        low = raw.lower()
        if low.startswith(("data:", "http://", "https://", "//")):
            return m.group(0)
        key = raw.lstrip("./").split("?")[0].split("#")[0]
        decoded_key = urllib.parse.unquote(key)
        names = [key, decoded_key]
        # بعض ZIPs القديمة تحفظ UTF-8 كأنها CP437؛ جرّب العكس فقط
        # للمطابقة، من غير تعديل النص المعروض أو فتح مسارات خارجية.
        for candidate in (decoded_key, key):
            try:
                names.append(candidate.encode("utf-8").decode("cp437"))
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
            try:
                names.append(candidate.encode("cp437").decode("utf-8"))
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
        mapped = ""
        for candidate in names:
            mapped = url_map.get(candidate) or url_map.get(candidate.rsplit("/", 1)[-1]) or ""
            if mapped:
                break

        mapped = _stream_video_url(mapped)

        return f"{m.group(1)}{m.group(2)}{mapped}{m.group(2)}"

    return _MEDIA_SRC_RE.sub(repl, html)


# ==========================================================================
# الاستيراد
# ==========================================================================
def _store_audio(files: dict[str, bytes], label: str) -> int:
    """يضيف أي ملف صوت في الأرشيف لمكتبة الموسيقى.

    قوالب الدعوات بتيجي ومعاها ملف موسيقى في ``media/``. من غير الخطوة
    دي الملف كان بيتتجاهل والمستخدم يرفعه بإيده تاني.
    """
    from django.core.files.base import ContentFile
    from .models import MusicTrack

    added = 0
    for name, data in files.items():
        if os.path.splitext(name)[1].lower() not in AUDIO_EXT or not data:
            continue
        base = os.path.basename(name)
        track = MusicTrack(name=f"{label} — {os.path.splitext(base)[0]}"[:120],
                           note="جاي مع قالب مستورد")
        track.file.save(base, ContentFile(data), save=True)
        added += 1
    return added


def _store_fonts(files: dict[str, bytes], url_map: dict[str, str]) -> None:
    """يخزّن خطوط الأرشيف عشان @font-face تفضل شغّالة.

    الخط مش صورة فمالوش سجل Asset — بيتحط في التخزين على طول ونربط
    مساره في الخريطة زي أي ملف تاني.
    """
    from django.core.files.base import ContentFile
    from django.core.files.storage import default_storage

    for name, data in files.items():
        if os.path.splitext(name)[1].lower() not in FONT_EXT or not data:
            continue
        base = os.path.basename(name)
        path = default_storage.save(f"template_fonts/{base}", ContentFile(data))
        url = default_storage.url(path)
        url_map[name] = url
        url_map.setdefault(base, url)


def _store_media(files: dict[str, bytes], *, preserve_original: bool = False) -> dict[str, str]:
    """يخزّن وسائط الأرشيف ويرجع خريطة المسارات.

    القوالب المستوردة تُعرض كتصميم جاهز؛ لذلك نحفظ صورها الأصلية كما هي
    بدلاً من تمريرها على ضغط صور الرفع العادي، حتى لا تظهر الخلفيات مبكسلة.
    """

    from django.core.files.base import ContentFile

    url_map: dict[str, str] = {}
    for name, data in files.items():
        ext = os.path.splitext(name)[1].lower()
        if not data:
            continue
        base = os.path.basename(name)
        if ext in IMAGE_EXT:

            if preserve_original:
                from PIL import Image
                stored = ContentFile(data, name=base)
                thumb = None
                try:
                    with Image.open(io.BytesIO(data)) as im:
                        w, h = im.size
                except Exception:
                    w, h = 0, 0
            else:
                upload = InMemoryUploadedFile(
                    io.BytesIO(data), "ImageField", base,
                    f"image/{ext.lstrip('.')}", len(data), None)
                stored, thumb, w, h = upload, None, 0, 0
                if ext != ".svg":
                    try:
                        stored, thumb, w, h = images.compress(upload, f"image/{ext.lstrip('.')}")
                    except Exception:
                        upload.seek(0)
                        stored, thumb = upload, None
            kind = "image"

        elif ext in VIDEO_EXT:
            stored = ContentFile(data, name=base)
            if preserve_original and ext in {".mp4", ".mov", ".m4v"}:
                mime = "video/quicktime" if ext == ".mov" else "video/mp4"
                upload = InMemoryUploadedFile(
                    io.BytesIO(data), "FileField", base, mime, len(data), None)
                stored, _ = video.prepare_for_stream(upload)

            thumb, w, h, kind = None, 0, 0, "video"

        elif ext in AUDIO_EXT:
            stored, thumb, w, h, kind = ContentFile(data, name=base), None, 0, 0, "audio"
        else:
            continue
        asset = Asset.objects.create(
            file=stored, thumb=thumb, kind=kind, original_name=base[:200],
            width=w, height=h, size_bytes=getattr(stored, "size", len(data)),
            invitation=None,
        )
        url_map[name] = asset.url
        url_map.setdefault(base, asset.url)
    _store_fonts(files, url_map)
    return url_map


def parse_upload(upload) -> tuple[str, dict[str, bytes]]:
    """يقرأ الملف المرفوع ويرجّع ``(اسم_ملف_HTML, الملفات)``."""
    raw = upload.read()
    if len(raw) > MAX_ARCHIVE_BYTES:
        raise ImportError_("حجم الملف أكبر من 50 ميجابايت.")
    if not raw:
        raise ImportError_("الملف فاضي.")

    name = (getattr(upload, "name", "") or "").lower()
    if raw[:2] == b"PK" or name.endswith(".zip"):
        files = _read_zip(raw)
        if not files:
            raise ImportError_("مفيش ملفات صالحة جوّه الأرشيف.")
        return _pick_main_html(files), files

    if not name.endswith((".html", ".htm")):
        raise ImportError_("ارفع ملف HTML أو أرشيف ZIP.")
    return "index.html", {"index.html": raw}


def build_document(main: str, files: dict[str, bytes]) -> tuple[dict, str, list[dict[str, str]], dict[str, str]]:
    """يحوّل الملفات لمستند بلوكات ويرجّع المستند والعنوان والـruntime scripts."""

    try:
        html = files[main].decode("utf-8")
    except UnicodeDecodeError:
        html = files[main].decode("cp1256", errors="replace")

    # نحتفظ بالافتتاحية الأصلية؛ تشغيلها أصبح جزءاً من runtime الخاص بالقالب.
    # لا يتم تشغيلها داخل المحرر، وتظهر فقط في المعاينة العامة/الدعوة المنشورة.

    html, files = _upgrade_lazy_images(html, files)

    parser = _Splitter()
    parser.feed(html)
    parser.close()

    url_map = _store_media(files, preserve_original=True)
    _store_embedded_pages(files, main, url_map)
    runtime_scripts = _store_runtime_scripts(html, main, files, url_map)

    # CSS: الملفات المربوطة الأول (ترتيب المتصفح) وبعدين <style> الداخلي

    base_dir = posixpath.dirname(main)
    raw_css = []
    for href in parser.css_links:
        key = posixpath.normpath(posixpath.join(base_dir, href.split("?")[0]))
        data = files.get(key) or files.get(os.path.basename(key))
        if data:
            raw_css.append(data.decode("utf-8", errors="replace"))
    raw_css.extend(parser.styles)
    stylesheet = "\n".join(raw_css)

    # نحلّ روابط url() مرة واحدة هنا — الخريطة موجودة دلوقتي بس
    stylesheet_resolved = cssscope.resolve_urls(stylesheet, url_map)
    # ملفات JS الخارجية لا تُشغّل داخل القالب المستورد لأسباب أمنية؛ بعض
    # القوالب تترك الأقسام مخفية حتى يضيف JS class مثل .in-view، أو تترك
    # preloader ثابتاً فوق الصفحة. هذه القواعد المحلية تحفظ الشكل المرئي
    # بدون تشغيل كود المصدر الخارجي.
    stylesheet_resolved += "\n.fade-up{opacity:1 !important;transform:none !important;}"
    # Tilda يترك عناصر النص والصور المتحركة مخفية حتى ينفّذ JS
    # ويضيف حالة الظهور. بما أن الاستيراد لا يشغّل JS، نعرضها ثابتة.
    stylesheet_resolved += (
        ".t-animate,.t-animate_started,.t-sbs-anim_started,.t-sbs-anim_current{"
        "opacity:1 !important;visibility:visible !important;"
        "transform:none !important;animation:none !important;}"
        ".t-animate_wait{opacity:1 !important;visibility:visible !important;}"
    )
    stylesheet_resolved += ".preloader{display:none !important;}"

    # Tilda يضع كل المحتوى داخل allrecords، لذلك parser.parts يعتبره
    # بلوكاً واحداً ضخماً. نعيد فصل recNNN حتى لا يظهر أول فيديو فقط.
    tilda_parts = _split_tilda_records(html)
    parts = [p for p in (tilda_parts or parser.parts) if p.strip()][:MAX_BLOCKS]
    if not parts:
        raise ImportError_("ملف HTML مافيهوش محتوى داخل <body>.")

    blocks = []
    for i, part in enumerate(parts, 1):
        bid = f"imp-{i}"
        part = _unwrap_allrecords(part)
        part = _align_embedded_map_element(
            _rewrite_iframe_srcs(
                _rewrite_inline_styles(_rewrite_media_srcs(part, url_map), url_map), url_map
            )
        )

        cleaned = clean_html(part, max_length=MAX_BLOCK_HTML)

        if not cleaned.strip():
            continue
        blocks.append({
            "id": bid,
            "type": "custom_html",
            "label": _guess_label(cleaned, part, i),
            "props": {
                "html": cleaned,
                # الستايل شيت كامل مع كل قسم: تخمين أنهي قاعدة بتخص أنهي
                # قسم بيغلط ويضيّع تنسيق. الحصر بيتعمل وقت العرض بمعرّف
                # القسم (فلتر safe_css)، فالتكرار مالوش أثر جانبي.
                "css": stylesheet_resolved,
            },
            # القالب المستورد مصمَّم لصفحة كاملة، فبنشيل حدود العرض
            # والمسافات بتاعت المحرك عشان يطلع زي ما اتصمّم. كل دي حقول
            # عادية في المُفتّش تقدر ترجّعها لو حبيت.
            "style": {"width": "full", "padding_top": 0, "padding_bottom": 0,
                      "animation": "none"},
        })

    if not blocks:
        raise ImportError_(
            "المحتوى كله اتشال بعد التنقية. غالباً الصفحة مبنية بجافاسكربت "
            "أو محتواها كله جوّه وسوم مش مسموح بيها."
        )

    # ------------------------------------------------------------------
    # الصفحة اتقرت، بس هل فيها كلام أصلاً؟
    #
    # المواقع الحديثة بتبعت HTML شبه فاضي (<div id="root"></div>) والمحتوى
    # كله بيتبني بجافاسكربت في المتصفح. الملفات المحلية تُحفظ كـruntime منفصل،

    # فالناتج بيبقى هيكل فاضي. أسوأ حاجة نعملها إننا نسيبه يتحفظ كقالب
    # ويكتشف بنفسه إنه فاضي — فبنوقف هنا ونقول السبب.
    visible = _visible_text("".join(b["props"]["html"] for b in blocks))
    # بنرفض **بس** لما الصفحة واضح إنها بتتبني بجافاسكربت — ساعتها
    # الاستيراد مالوش أي فايدة والنتيجة هتبقى هيكل فاضي مضمون.
    # صفحة قصيرة وخلاص بتعدّي عادي، والعرض بيحذّر منها (شوف
    # document_text_length) — مش شغلنا نمنع حد من ملف صغير.
    if len(visible) < MIN_VISIBLE_CHARS and _looks_scripted(html) and not runtime_scripts:
        raise ImportError_(

            f"القالب طلع فاضي: لقينا {len(blocks)} قسم بس مفيش فيهم كلام "
            f"(‎{len(visible)}‎ حرف). الصفحة دي بتتبني بجافاسكربت — الكلام "
            "مش موجود في ملف HTML نفسه، بيتحط في المتصفح وقت التشغيل، "
            "ولم نجد ملفات JavaScript محلية كافية لتشغيله. "

            "افتح الصفحة في المتصفح واستنى تحمّل، وبعدين Ctrl+S ← "
            "«صفحة كاملة»، أو انسخ الـHTML النهائي من أدوات المطوّر."
        )

    runtime_root_attrs = _runtime_root_attrs(html)

    document = blocks_engine.normalize_document({
        "version": 1, "blocks": blocks, "theme": {}, "settings": {},
    })
    return document, parser.title.strip()[:120], runtime_scripts, runtime_root_attrs


def import_template(upload, *, name: str = "", category: str = "classic") -> Template:
    main, files = parse_upload(upload)
    document, title, runtime_scripts, runtime_root_attrs = build_document(main, files)

    label = (name or title
             or os.path.splitext(os.path.basename(getattr(upload, "name", "")))[0]
             or "قالب مستورد")[:120]

    slug = slugify(label, allow_unicode=False) or "imported"
    base, n = slug, 2
    while Template.objects.filter(slug=slug).exists():
        slug = f"{base}-{n}"
        n += 1

    added_tracks = _store_audio(files, label)

    upload.seek(0)
    tpl = Template.objects.create(
        name=label, slug=slug, category=category, source="import",
        source_file=upload,
        description="قالب مستورد من ملف — الأقسام قابلة للترتيب والإخفاء من المحرر.",
        document=document, runtime_scripts=runtime_scripts,
        runtime_root_attrs=runtime_root_attrs, is_active=True,

    )
    # عدد المقطوعات اللي دخلت مع الاستيراد ده بالذات — العرض بيعرضها
    # للمستخدم. مش عمود في الداتابيز، بيانات لحظة الاستيراد بس.
    tpl.imported_tracks = added_tracks
    # نبني نسخة المعاينة مرة واحدة وقت الاستيراد بدل أول زيارة للزائر.
    try:
        get_template_preview(tpl, lang="ar")
    except Exception:
        # الكاش تحسين اختياري؛ فشل بنائه لا يلغي نجاح استيراد القالب.
        pass
    return tpl


def document_text_length(document: dict) -> int:
    """عدد حروف النص الظاهر في مستند — العرض بيحذّر لو طلع قليل."""
    html = "".join(
        (b.get("props") or {}).get("html") or ""
        for b in (document or {}).get("blocks") or []
    )
    return len(_visible_text(html))
