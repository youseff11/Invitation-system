"""منقّي HTML بسيط ومتحفّظ.

يُستخدم لكل حقل من نوع ``html`` في المحرر ولكل جزء يأتي من قالب مستورد.
القاعدة: قائمة سماح صريحة — أي وسم أو خاصية غير مذكورة هنا يُحذف.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser

ALLOWED_TAGS = {
    "p", "br", "strong", "b", "em", "i", "u", "s", "small", "mark",
    "span", "div", "section", "article", "header", "footer",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "blockquote", "figure", "figcaption",
    "a", "img", "hr", "sup", "sub", "abbr", "time",
    "table", "thead", "tbody", "tr", "th", "td",
}

# وسوم يُحذف محتواها بالكامل لا الوسم فقط
DROP_CONTENT_TAGS = {"script", "style", "iframe", "object", "embed", "form",
                     "input", "button", "select", "textarea", "svg", "math",
                     "link", "meta", "noscript", "template"}

VOID_TAGS = {"br", "img", "hr"}

ALLOWED_ATTRS = {
    "*": {"class", "id", "title", "dir", "lang", "style"},
    "a": {"href", "target", "rel"},
    "img": {"src", "alt", "width", "height", "loading"},
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
            if name.startswith("on") or name not in allowed:
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


def clean_html(value: str, *, max_length: int = 20000) -> str:
    """ينقّي نص HTML ويعيده آمناً للعرض."""
    if not value:
        return ""
    parser = _Cleaner()
    parser.feed(value[:max_length])
    parser.close()
    return parser.result()


def strip_tags(value: str) -> str:
    """يزيل كل الوسوم ويعيد نصاً خاماً."""
    return re.sub(r"<[^>]+>", " ", value or "").strip()
