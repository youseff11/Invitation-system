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
        "video", "audio", "source", "track", "iframe", "form", "label", "input",

    "textarea", "select", "option", "button",
    # SVG inline للزخارف والأيقونات؛ السمات المسموحة أدناه لا تشمل href خارجي.
    "svg", "g", "path", "line", "circle", "rect", "polyline", "polygon",
    # بقية عناصر SVG: القص والأقنعة والتدرّجات والنصوص. من غيرها كان أي
    # كود SVG جاهز فيه ‎<clipPath>‎ أو ‎<linearGradient>‎ بيتشال بالسكوت
    # ويطلع الشكل مكسور والمصمّم مش عارف السبب.
    # الأسماء بحروف صغيرة عن قصد: ‎HTMLParser‎ بيصغّرها، والمتصفح بيرجّع
    # ‎clippath‎ لـ‎clipPath‎ تلقائياً وهو بيبني الـDOM (جدول تصحيح SVG
    # في مواصفة HTML). ‎foreignObject‎ **مستبعد**: بيفتح باب HTML جوّه SVG.
    "defs", "clippath", "mask", "use", "symbol", "marker",
    "ellipse", "text", "tspan", "textpath",
    "lineargradient", "radialgradient", "stop", "pattern", "image",
    "title", "desc",
    # الرسم بالكانفس — الأساس لأي حاجة زي كارت الخدش. موجود في كل
    # المتصفحات ومش محتاج أي مكتبة؛ كل اللي كان ناقص إننا مانشيلوش.
    "canvas",
}

# وسوم يُحذف محتواها بالكامل لا الوسم فقط. عناصر العرض والنماذج لم تعد
# ضمن القائمة: نحتفظ بها بعد تنظيف سماتها حتى لا تختفي أجزاء القالب المستورد.
DROP_CONTENT_TAGS = {"script", "style", "object", "embed", "math",

                     "link", "meta", "noscript", "template"}

VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}

# data-move بتربط العنصر بموضعه المحفوظ في block.layout. من غيرها
# السحب بالماوس جوّه قسم مستورد بيضيع أول ما تحفظ.
_MOVE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

# ‎data-*‎ عموماً مسموحة: دي الطريقة الوحيدة اللي بيها كود المصمّم
# يربط الجافاسكربت بعناصره (‎[data-scratch]‎ مثلاً). السمات دي خاملة —
# مابتنفّذش حاجة. اللي بنحجزه بس أسماء المنصة نفسها، عشان كود في قسم
# مايقدرش يوهم المحرر إن عنده بلوك أو عنصر قابل للتحرير.
_RESERVED_DATA = {"data-block", "data-block-type", "data-editable"}
_RESERVED_DATA_PREFIX = ("data-lb-",)


def _data_attr_ok(name: str) -> bool:
    if not name.startswith("data-") or len(name) < 6:
        return False
    if name in _RESERVED_DATA or name.startswith(_RESERVED_DATA_PREFIX):
        return False
    return _DATA_NAME_RE.match(name) is not None


_DATA_NAME_RE = re.compile(r"^data-[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
_ARIA_NAME_RE = re.compile(r"^aria-[a-z]{1,32}$")

ALLOWED_ATTRS = {
    "*": {"class", "id", "title", "dir", "lang", "style", "data-move",
          "role", "aria-hidden", "aria-label", "tabindex", "hidden"},
    "a": {"href", "target", "rel", "download"},
    "img": {"src", "alt", "width", "height", "loading", "decoding"},
    "video": {"src", "poster", "width", "height", "controls", "autoplay",
              "loop", "muted", "playsinline", "preload"},
    "audio": {"src", "controls", "autoplay", "loop", "muted", "preload"},
    "source": {"src", "type", "media"},
        "track": {"src", "kind", "srclang", "label", "default"},
    "iframe": {"src", "title", "width", "height", "loading", "allow",
                "allowfullscreen", "frameborder", "referrerpolicy"},

    "form": {"method", "novalidate", "autocomplete"},
    "input": {"type", "name", "value", "placeholder", "required", "checked",
              "min", "max", "step", "maxlength", "autocomplete"},
    "textarea": {"name", "placeholder", "rows", "cols", "required", "maxlength"},
    "select": {"name", "required", "multiple"},
    "option": {"value", "selected", "disabled"},
    "button": {"type", "name", "value", "disabled"},
    # سمات الرسم المشتركة بين كل عناصر SVG — بتتضاف لكل وسم SVG تحت.
    "canvas": {"width", "height"},
    "svg": {"xmlns", "viewbox", "preserveaspectratio", "width", "height",
            "x", "y", "overflow"},
    "path": {"d", "pathlength"},
    "line": {"x1", "x2", "y1", "y2"},
    "circle": {"cx", "cy", "r"},
    "ellipse": {"cx", "cy", "rx", "ry"},
    "rect": {"x", "y", "width", "height", "rx", "ry"},
    "polyline": {"points"},
    "polygon": {"points"},
    "clippath": {"clippathunits"},
    "mask": {"maskunits", "maskcontentunits", "x", "y", "width", "height"},
    "use": {"href", "x", "y", "width", "height"},
    "symbol": {"viewbox", "preserveaspectratio", "x", "y", "width", "height"},
    "marker": {"viewbox", "refx", "refy", "markerwidth", "markerheight",
               "orient", "markerunits", "preserveaspectratio"},
    "lineargradient": {"x1", "y1", "x2", "y2", "gradientunits",
                       "gradienttransform", "spreadmethod", "href"},
    "radialgradient": {"cx", "cy", "r", "fx", "fy", "gradientunits",
                       "gradienttransform", "spreadmethod", "href"},
    "stop": {"offset", "stop-color", "stop-opacity"},
    "pattern": {"x", "y", "width", "height", "patternunits",
                "patterncontentunits", "patterntransform", "viewbox", "href"},
    "image": {"href", "x", "y", "width", "height", "preserveaspectratio"},
    "text": {"x", "y", "dx", "dy", "text-anchor", "dominant-baseline",
             "font-size", "font-family", "font-weight", "letter-spacing",
             "textlength", "lengthadjust", "writing-mode"},
    "tspan": {"x", "y", "dx", "dy", "text-anchor", "font-size", "font-weight"},
    "textpath": {"href", "startoffset", "method", "spacing"},
    "time": {"datetime"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan", "scope"},
}

# وسوم SVG كلها بتاخد نفس سمات الرسم (fill / transform / clip-path …).
# بنجمّعها مرة واحدة بدل ما نكرّرها في كل وسم.
_SVG_TAGS = {
    "svg", "g", "path", "line", "circle", "rect", "polyline", "polygon",
    "defs", "clippath", "mask", "use", "symbol", "marker", "ellipse",
    "text", "tspan", "textpath", "lineargradient", "radialgradient",
    "stop", "pattern", "image", "title", "desc",
}
_SVG_COMMON_ATTRS = {
    "fill", "fill-opacity", "fill-rule",
    "stroke", "stroke-width", "stroke-opacity", "stroke-linecap",
    "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
    "stroke-miterlimit",
    "opacity", "transform", "transform-origin",
    "clip-path", "clip-rule", "mask", "filter",
    "color", "display", "visibility", "pointer-events",
    "vector-effect", "paint-order", "shape-rendering", "overflow",
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
    # خصائص تخطيط وشكل شائعة في أي كود جاهز. من غيرها كان
    # ‎<div style="display:flex;gap:12px">‎ بيفقد الـgap بالسكوت،
    # فالكود يطلع متكوّم والمصمّم مش عارف ليه.
    "gap", "row-gap", "column-gap", "flex", "flex-direction", "flex-wrap",
    "justify-content", "align-items", "align-self", "order",
    "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
    "box-shadow", "text-shadow", "transform", "transform-origin",
    "transition", "filter", "backdrop-filter", "overflow", "object-fit",
    "border-color", "border-width", "border-style", "border-top",
    "border-bottom", "border-inline-start", "border-inline-end",
    "min-width", "max-height", "text-transform", "white-space",
    "word-break", "vertical-align", "list-style", "cursor", "font-variant",
    # خصائص التفاعل — من غيرها مافيش كارت خدش يشتغل: الإصبع بيسحب
    # الصفحة بدل ما يخدش، والنص بيتحدّد وانت بتمسح.
    "touch-action", "pointer-events", "user-select", "-webkit-user-select",
    "-webkit-touch-callout", "-webkit-tap-highlight-color",
    "overscroll-behavior", "caret-color",
    # طبقات ورسم
    "position", "top", "right", "bottom", "left", "inset",
    "inset-inline", "inset-block", "z-index",
    "isolation", "mix-blend-mode", "clip-path", "mask", "mask-image",
    "-webkit-mask", "-webkit-mask-image", "visibility", "will-change",
    "box-sizing", "contain", "image-rendering", "resize",
    "flex-grow", "flex-shrink", "flex-basis", "align-content",
    "place-items", "place-content", "outline", "outline-offset",
    "background-clip", "-webkit-background-clip", "-webkit-text-fill-color",
    # ملحوظة أمان: ‎position:fixed‎ بيتحوّل لـ‎absolute‎ في ‎_clean_style‎،
    # ونفس الشيء لـ‎sticky‎ — نفس السياسة الموجودة في ‎cssscope.py‎ —
    # وحاوية الكود (‎.lb-extra-html‎) عندها ‎position:relative‎ و
    # ‎contain:layout‎، يعني المطلق بيتحبس جوّه القسم مش على الصفحة.
}

# قيم ‎position‎ اللي بتهرب من القسم وتغطّي الشاشة كلها
_ESCAPING_POSITIONS = {"fixed", "sticky"}
_MAX_Z_INDEX = 999
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
        # ‎fixed‎/‎sticky‎ بيطلعوا بره القسم ويفضلوا معلّقين فوق باقي
        # الدعوة — بنرجّعهم ‎absolute‎ جوّه القسم، زي ‎cssscope.py‎ بالظبط.
        if prop == "position" and val.split()[0].lower() in _ESCAPING_POSITIONS:
            val = "absolute"
        if prop == "z-index":
            try:
                val = str(min(int(float(val)), _MAX_Z_INDEX))
            except (TypeError, ValueError):
                continue
        parts.append(f"{prop}:{val}")
    return ";".join(parts[:40])


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
        if tag in _SVG_TAGS:
            allowed = allowed | _SVG_COMMON_ATTRS
        parts = []
        for name, value in attrs:
            name = (name or "").lower()
            value = value or ""
            # Tilda Zero blocks store responsive coordinates in data-* attrs;
            # their CSS selectors need these inert layout values to position
            # text and images. Preserve only known layout namespaces.
            tilda_layout_attr = name.startswith((
                "data-elem-", "data-field-", "data-artboard-", "data-animate-"
            )) or name in {
                "data-record-type", "data-animationappear",
                "data-lb-map-width", "data-lb-map-height",
            }

            custom_data = _data_attr_ok(name)
            # ‎aria-*‎ كلها سمات وصف خاملة — بتفيد قارئ الشاشة ومابتنفّذش حاجة
            aria_attr = bool(_ARIA_NAME_RE.match(name))

            if name.startswith("on") or (
                name not in allowed and not tilda_layout_attr
                and not custom_data and not aria_attr
            ):
                continue

            if name in {"href", "src", "xlink:href"}:
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
        if tag in DROP_CONTENT_TAGS:
            # meta/link/embed عناصر فارغة؛ لا يجوز أن تظل skip_depth مفتوحة
            # فتخفي كل ما بعدها داخل سجل Tilda.
            if tag not in VOID_TAGS:
                self.skip_depth += 1
            return
        if self.skip_depth:
            return

        if tag not in ALLOWED_TAGS:
            return
        self.out.append(f"<{tag}{self._attrs(tag, attrs)}>")
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        """وسم مقفول على نفسه: ‎<path … />‎.

        لازم نقفله صراحةً. ‎<path>‎ مش عنصر فاضي في HTML، فلو طلع من
        غير قفلة المتصفح بيفضل فاتحه ويحطّ اللي بعده جوّاه — يعني
        ‎<ellipse/><text/>‎ بيبقى النص جوّه الشكل ومايبانش خالص.
        """
        tag = tag.lower()
        if self.skip_depth or tag not in ALLOWED_TAGS:
            return
        opened = f"<{tag}{self._attrs(tag, attrs)}>"
        self.out.append(opened if tag in VOID_TAGS else opened + f"</{tag}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            if tag not in VOID_TAGS:
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
