"""منقّي HTML بسيط ومتحفّظ.

يُستخدم لكل حقل من نوع ``html`` في المحرر ولكل جزء يأتي من قالب مستورد.
القاعدة: قائمة سماح صريحة — أي وسم أو خاصية غير مذكورة هنا يُحذف.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "small", "mark",
    "span", "div", "main", "nav", "aside", "section", "article", "header", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "figure", "figcaption",
    "a", "img", "hr", "sup", "sub", "abbr", "time",
    "table", "thead", "tbody", "tr", "th", "td",
    # وسائط وعناصر نموذج آمنة للعرض داخل القالب المستورد. لا نسمح
    # بخاصية action أو أي event handler، لذلك تظل هذه العناصر عرضية فقط.
    "video", "audio", "source", "track", "form", "label", "input",
    "textarea", "select", "option", "button",
    # SVG inline للزخارف والأيقونات؛ السمات المسموحة أدناه لا تشمل href خارجي.
    "svg", "g", "path", "line", "circle", "rect", "polyline", "polygon",
}

# وسوم يُحذف محتواها بالكامل لا الوسم فقط. عناصر العرض والنماذج لم تعد
# ضمن القائمة: نحتفظ بها بعد تنظيف سماتها حتى لا تختفي أجزاء القالب المستورد.
DROP_CONTENT_TAGS = {"script", "style", "iframe", "object", "embed", "math",
                     "link", "meta", "noscript", "template"}

VOID_TAGS = {"br", "img", "hr", "source", "track", "input"}

# data-move بتربط العنصر بموضعه المحفوظ في block.layout. من غيرها
# السحب بالماوس جوّه قسم مستورد بيضيع أول ما تحفظ.
_MOVE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

ALLOWED_ATTRS = {
    "*": {"class", "id", "title", "dir", "lang", "style", "data-move",
          "role", "aria-hidden", "aria-label"},
    "a": {"href", "target", "rel", "download"},
    "img": {"src", "alt", "width", "height", "loading", "decoding"},
    "video": {"src", "poster", "width", "height", "controls", "autoplay",
              "loop", "muted", "playsinline", "preload"},
    "audio": {"src", "controls", "autoplay", "loop", "muted", "preload"},
    "source": {"src", "type", "media"},
    "track": {"src", "kind", "srclang", "label", "default"},
    "form": {"method", "novalidate", "autocomplete"},
    "input": {"type", "name", "value", "placeholder", "required", "checked",
              "min", "max", "step", "maxlength", "autocomplete"},
    "textarea": {"name", "placeholder", "rows", "cols", "required", "maxlength"},
    "select": {"name", "required", "multiple"},
    "option": {"value", "selected", "disabled"},
    "button": {"type", "name", "value", "disabled"},
    "svg": {"viewBox", "preserveAspectRatio", "width", "height", "fill",
            "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin"},
    "path": {"d", "fill", "stroke", "stroke-width", "opacity"},
    "line": {"x1", "x2", "y1", "y2", "stroke", "stroke-width"},
    "circle": {"cx", "cy", "r", "fill", "stroke", "stroke-width"},
    "rect": {"x", "y", "width", "height", "rx", "ry", "fill", "stroke", "stroke-width"},
    "polyline": {"points", "fill", "stroke", "stroke-width"},
    "polygon": {"points", "fill", "stroke", "stroke-width"},
    "time": {"datetime"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"},
}

_URL_SCHEME_RE = re.compile(r"^\s*(javascript|vbscript|data|file)\s*:", re.I)

# خصائص CSS مسموحة داخل style=""
ALLOWED_CSS_PROPS = {
    "color", "background-color", "background", "font-size", "font-weight",
    "font-style", "font-family", "text-align", "text-decoration", "line-height",
    "letter-spacing", "margin", "margin-top", "margin-bottom", "margin-right",
    "margin-left", "padding", "padding-top", "padding-bottom", "padding-right",
    "padding-left", "border", "border-radius", "width", "max-width", "height",
    "opacity", "display", "direction",
    "background-image", "background-size", "background-position",
    "background-repeat", "min-height", "aspect-ratio",
}
_CSS_DANGER_RE = re.compile(r"(expression|javascript:|@import|behavior)", re.I)

# url() مسموحة **بس** لو بتشاور على ملف مخزّن عندنا. الرابط الخارجي في
# style بيسرّب زيارة الضيف لسيرفر تاني، وdata: بيفتح باب لمحتوى مش متحكّم فيه.
_SAFE_URL_RE = re.compile(
    r"""url\(\s*(['"]?)(/(?:media|static)/[^'")\s]*)\1\s*\)""", re.I)
_ANY_URL_RE = re.compile(r"url\s*\(", re.I)


def _url_ok(value: str) -> bool:
    """صح لو كل url() في القيمة بتشاور على ملف عندنا."""
    return len(_SAFE_URL_RE.findall(value)) == len(_ANY_URL_RE.findall(value))


def _clean_style(value: str) -> str:
    parts = []
    for chunk in value.split(";"):
        if ":" not in chunk:
            continue
        prop, _, val = chunk.partition(":")
        prop = prop.strip().lower()
        val = val.strip()
        if prop not in ALLOWED_CSS_PROPS:
            continue
        if _CSS_DANGER_RE.search(val):
            continue
        if "url(" in val.lower() and not _url_ok(val):
            continue
        parts.append(f"{prop}:{val}")
    return ";".join(parts[:20])


def _clean_url(value: str) -> str | None:
    val = (value or "").strip()
    if not val:
        return None
    if _URL_SCHEME_RE.match(val):
        return None
    return val[:2000]


class _Cleaner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []
        self.skip_depth = 0

    # -- helpers ----------------------------------------------------------
    def _attrs(self, tag: str, attrs) -> str:
        allowed = ALLOWED_ATTRS["*"] | ALLOWED_ATTRS.get(tag, set())
        parts = []
        for name, value in attrs:
            name = (name or "").lower()
            value = value or ""
            # Tilda Zero blocks store responsive coordinates in data-* attrs;
            # their CSS selectors need these inert layout values to position
            # text and images. Preserve only known layout namespaces.
            tilda_layout_attr = name.startswith((
                "data-elem-", "data-field-", "data-artboard-", "data-animate-"
            )) or name in {"data-record-type", "data-animationappear"}
            if name.startswith("on") or (name not in allowed and not tilda_layout_attr):
                continue

            if name in {"href", "src"}:
                cleaned = _clean_url(value)
                if cleaned is None:
                    continue
                value = cleaned
            elif name == "style":
                value = _clean_style(value)
                if not value:
                    continue
            elif name == "data-move":
                if not _MOVE_RE.match(value):
                    continue
            value = value.replace('"', "&quot;").replace("<", "&lt;")
            parts.append(f'{name}="{value}"')
        if tag == "a":
            # لو القالب حاطط rel بنفسه، نستبدلها مش نضيف تانية —
            # وسم بخاصية مكرّرة المتصفح بياخد الأولى ويرمي التانية
            parts = [p for p in parts if not p.startswith("rel=")]
            parts.append('rel="noopener noreferrer"')
        return (" " + " ".join(parts)) if parts else ""

    # -- parser hooks -----------------------------------------------------
    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if self.skip_depth or tag in DROP_CONTENT_TAGS:
            if tag in DROP_CONTENT_TAGS:
                self.skip_depth += 1
            return
        if tag not in ALLOWED_TAGS:
            return
        self.out.append(f"<{tag}{self._attrs(tag, attrs)}>")
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        tag = tag.lower()
        if self.skip_depth or tag not in ALLOWED_TAGS:
            return
        self.out.append(f"<{tag}{self._attrs(tag, attrs)}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth or tag in VOID_TAGS or tag not in ALLOWED_TAGS:
            return
        if tag in self.stack:
            # نغلق كل ما فُتح بعده لضمان HTML متوازن
            while self.stack:
                open_tag = self.stack.pop()
                self.out.append(f"</{open_tag}>")
                if open_tag == tag:
                    break

    def handle_data(self, data):
        if self.skip_depth:
            return
        self.out.append(
            data.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        )

    def handle_comment(self, data):  # التعليقات تُحذف
        return

    def result(self) -> str:
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")
        return "".join(self.out)


def clean_html(value: str, *, max_length: int | None = 20000) -> str:
    """ينقّي نص HTML ويعيده آمناً للعرض.

    ``None`` أو صفر يعنيان عدم قصّ المحتوى؛ التنقية نفسها تظل مطبقة.
    ده ضروري لأقسام القوالب المستوردة الكبيرة حتى لا ينقطع HTML في منتصف
    عنصر Tilda وتتشوه بقية الصفحة.
    """
    if not value:
        return ""
    parser = _Cleaner()
    source = value if max_length in (None, 0) else value[:max_length]
    parser.feed(source)

    parser.close()
    return parser.result()


def strip_tags(value: str) -> str:
    """يزيل كل الوسوم ويعيد نصاً خاماً."""
    return re.sub(r"<[^>]+>", " ", value or "").strip()
