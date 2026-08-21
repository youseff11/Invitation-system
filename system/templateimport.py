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

import io
import os
import posixpath
import re
import zipfile
from html import unescape as _unescape
from html.parser import HTMLParser

from django.core.files.uploadedfile import InMemoryUploadedFile
from django.utils.text import slugify

from . import blocks as blocks_engine
from . import cssscope, images
from .models import Asset, Template
from .sanitize import clean_html

MAX_ARCHIVE_BYTES = 20 * 1024 * 1024      # حجم الملف المرفوع نفسه
MAX_UNPACKED_BYTES = 80 * 1024 * 1024     # مجموع الحجم بعد فك الضغط
MAX_MEMBERS = 400
MAX_RATIO = 120                           # نسبة انتفاخ مشبوهة = zip bomb
MAX_BLOCKS = 40
MIN_VISIBLE_CHARS = 60     # أقل من كده = صفحة بلا كلام

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".svg"}
CSS_EXT = {".css"}
HTML_EXT = {".html", ".htm"}
FONT_EXT = {".woff2", ".woff", ".ttf", ".otf"}
AUDIO_EXT = {".mp3", ".m4a", ".ogg", ".wav"}


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
            if ext not in IMAGE_EXT | CSS_EXT | HTML_EXT | FONT_EXT | AUDIO_EXT:
                continue          # لا js ولا أي حاجة بتتنفّذ
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


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_SCRIPT_SRC_RE = re.compile(r"<script[^>]*\ssrc=", re.I)
_ROOT_DIV_RE = re.compile(
    r'<(div|main)[^>]*\sid=["\'](root|app|__next|__nuxt|___gatsby)["\']', re.I)


def _visible_text(html: str) -> str:
    """النص اللي الضيف هيشوفه فعلاً — من غير وسوم ولا مسافات زيادة."""
    return _WS_RE.sub(" ", _TAG_RE.sub(" ", html or "")).strip()


def _looks_scripted(html: str) -> bool:
    """هل الصفحة دي بتعتمد على جافاسكربت في بناء محتواها؟"""
    return bool(_ROOT_DIV_RE.search(html) or _SCRIPT_SRC_RE.search(html))


_STYLE_ATTR_RE = re.compile(r'(\sstyle=)(["\'])(.*?)\2', re.I | re.S)
_SRC_RE = re.compile(r'(<img\b[^>]*?\ssrc=)(["\'])(.*?)\2', re.I | re.S)
_SRCSET_RE = re.compile(r'\ssrcset=(["\']).*?\1', re.I | re.S)


def _rewrite_inline_styles(html: str, url_map: dict[str, str]) -> str:
    """يحلّ ``url()`` جوّه style="" — من غير كده المنقّي بيرمي الخاصية كلها."""
    def repl(m):
        value = cssscope.resolve_urls(m.group(3), url_map)
        # resolve_urls بيلفّ الرابط بعلامتين تنصيص مزدوجة، ودي بتقفل
        # الخاصية نفسها. بنهرّبها — HTMLParser بيرجّعها تاني وقت القراءة.
        value = value.replace('"', "&quot;")
        return f"{m.group(1)}{m.group(2)}{value}{m.group(2)}"
    return _STYLE_ATTR_RE.sub(repl, html)


def _rewrite_img_srcs(html: str, url_map: dict[str, str]) -> str:
    html = _SRCSET_RE.sub("", html)      # srcset بيشاور على ملفات مش مخزّنة
    def repl(m):
        raw = (m.group(3) or "").strip()
        low = raw.lower()
        if low.startswith(("data:", "http://", "https://", "//")):
            return m.group(0)
        key = raw.lstrip("./").split("?")[0].split("#")[0]
        mapped = url_map.get(key) or url_map.get(key.rsplit("/", 1)[-1]) or ""
        return f"{m.group(1)}{m.group(2)}{mapped}{m.group(2)}"
    return _SRC_RE.sub(repl, html)


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


def _store_images(files: dict[str, bytes]) -> dict[str, str]:
    """يخزّن صور الأرشيف كأصول عامة ويرجّع خريطة ``مسار → رابط``."""
    url_map: dict[str, str] = {}
    for name, data in files.items():
        ext = os.path.splitext(name)[1].lower()
        if ext not in IMAGE_EXT or not data:
            continue
        base = os.path.basename(name)
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
        asset = Asset.objects.create(
            file=stored, thumb=thumb, kind="image", original_name=base[:200],
            width=w, height=h, size_bytes=getattr(stored, "size", len(data)),
            invitation=None,            # مكتبة عامة — متاحة لكل الدعوات
        )
        url_map[name] = asset.url
        url_map.setdefault(base, asset.url)
    _store_fonts(files, url_map)
    return url_map


def parse_upload(upload) -> tuple[str, dict[str, bytes]]:
    """يقرأ الملف المرفوع ويرجّع ``(اسم_ملف_HTML, الملفات)``."""
    raw = upload.read()
    if len(raw) > MAX_ARCHIVE_BYTES:
        raise ImportError_("حجم الملف أكبر من ٢٠ ميجابايت.")
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


def build_document(main: str, files: dict[str, bytes]) -> tuple[dict, str]:
    """يحوّل الملفات لمستند بلوكات. يرجّع ``(المستند, العنوان_المستخرج)``."""
    try:
        html = files[main].decode("utf-8")
    except UnicodeDecodeError:
        html = files[main].decode("cp1256", errors="replace")

    parser = _Splitter()
    parser.feed(html)
    parser.close()

    url_map = _store_images(files)

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

    parts = [p for p in parser.parts if p.strip()][:MAX_BLOCKS]
    if not parts:
        raise ImportError_("ملف HTML مافيهوش محتوى داخل <body>.")

    blocks = []
    for i, part in enumerate(parts, 1):
        bid = f"imp-{i}"
        part = _rewrite_inline_styles(_rewrite_img_srcs(part, url_map), url_map)
        cleaned = clean_html(part)
        if not cleaned.strip():
            continue
        blocks.append({
            "id": bid,
            "type": "custom_html",
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
    # كله بيتبني بجافاسكربت في المتصفح. إحنا بنشيل الجافاسكربت لأسباب أمنية،
    # فالناتج بيبقى هيكل فاضي. أسوأ حاجة نعملها إننا نسيبه يتحفظ كقالب
    # ويكتشف بنفسه إنه فاضي — فبنوقف هنا ونقول السبب.
    visible = _visible_text("".join(b["props"]["html"] for b in blocks))
    # بنرفض **بس** لما الصفحة واضح إنها بتتبني بجافاسكربت — ساعتها
    # الاستيراد مالوش أي فايدة والنتيجة هتبقى هيكل فاضي مضمون.
    # صفحة قصيرة وخلاص بتعدّي عادي، والعرض بيحذّر منها (شوف
    # document_text_length) — مش شغلنا نمنع حد من ملف صغير.
    if len(visible) < MIN_VISIBLE_CHARS and _looks_scripted(html):
        raise ImportError_(
            f"القالب طلع فاضي: لقينا {len(blocks)} قسم بس مفيش فيهم كلام "
            f"(‎{len(visible)}‎ حرف). الصفحة دي بتتبني بجافاسكربت — الكلام "
            "مش موجود في ملف HTML نفسه، بيتحط في المتصفح وقت التشغيل، "
            "وإحنا بنشيل الجافاسكربت لأسباب أمنية. "
            "افتح الصفحة في المتصفح واستنى تحمّل، وبعدين Ctrl+S ← "
            "«صفحة كاملة»، أو انسخ الـHTML النهائي من أدوات المطوّر."
        )

    document = blocks_engine.normalize_document({
        "version": 1, "blocks": blocks, "theme": {}, "settings": {},
    })
    return document, parser.title.strip()[:120]


def import_template(upload, *, name: str = "", category: str = "classic") -> Template:
    main, files = parse_upload(upload)
    document, title = build_document(main, files)

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
        document=document, is_active=True,
    )
    # عدد المقطوعات اللي دخلت مع الاستيراد ده بالذات — العرض بيعرضها
    # للمستخدم. مش عمود في الداتابيز، بيانات لحظة الاستيراد بس.
    tpl.imported_tracks = added_tracks
    return tpl


def document_text_length(document: dict) -> int:
    """عدد حروف النص الظاهر في مستند — العرض بيحذّر لو طلع قليل."""
    html = "".join(
        (b.get("props") or {}).get("html") or ""
        for b in (document or {}).get("blocks") or []
    )
    return len(_visible_text(html))
