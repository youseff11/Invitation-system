"""توليد CSS مواضع عناصر Tilda Zero Block على السيرفر.

المشكلة اللي بيحلها الملف ده
-----------------------------
القوالب المستوردة من Tilda مابتشحنش أي قاعدة CSS لمواضع العناصر. كل
``.t396__elem`` عنده ``position:absolute`` وبس، والمواضع (left/top/width)
بيكتبها ``t396_init`` كـinline styles بعد ما runtime القالب يحمّل بالكامل.
النتيجة إن أول رسمة للصفحة بتبقى مكسورة — العناصر واقعة في مواضعها
الافتراضية وخارجة عن الشاشة — لحد ما الجافاسكربت يخلص (٦ ثواني+ على
اتصال بطيء).

الحل: نحسب نفس المواضع هنا وقت العرض ونطبعها ``<style>`` في ``<head>``،
فالصفحة تبدأ مظبوطة من أول رسمة، والـruntime لما يشتغل بيكتب نفس القيم
inline فوقها من غير أي قفزة.

الحسابات منقولة حرفياً من ``t396_elem__convertPosition__Local__toAbsolute``
في ``tilda-zero-1.min.js`` ومتحقَّق منها عنصر بعنصر على قالب حقيقي:
٧٣/٧٣ عنصر بنفس القيم بالظبط على مقاسين مختلفين.

المعادلة الأساسية (container = grid):

    grid_width       = أكبر breakpoint أصغر من أو يساوي عرض الشاشة
    grid_offset_left = (عرض الشاشة - grid_width) / 2
    left             = grid_offset_left + قيمة الحقل

وبما إن ``.t396__artboard`` عرضه ١٠٠٪ من الشاشة، الشطر الأول بيتكتب في
CSS كـ ``50% - grid_width/2`` من غير ما نعرف عرض الشاشة أصلاً.
"""

from __future__ import annotations

import re
from functools import lru_cache
from html.parser import HTMLParser

# ملاحظة: Tilda بيقرا لستة الحقول من ``data-fields``، بس المنقّي
# (‎sanitize.clean_html‎) بيشيل السمة دي لأنها مش في الـallowlist —
# الـruntime بيعيد بناءها في المتصفح. فبنعتمد على وجود ‎data-field-*‎
# نفسها كدليل على إن الحقل مطلوب، وده اتقارن بناتج ‎t396_init‎ على قالب
# حقيقي وطلع مطابق ٧٣/٧٣ عنصر.

# الحقول اللي بنعرف نحسبها. أي حقل تاني بيسيبه للـruntime.
_POS_FIELDS = ("left", "top", "width", "height")
_FIELD_ATTRS = _POS_FIELDS + (
    "axisx", "axisy", "container",
    "leftunits", "topunits", "widthunits", "heightunits", "heightmode",
)

_ELEM_CLASS_RE = re.compile(r"\btn-elem__(\d+)\b")
_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_DEFAULT_SCREENS = (320, 480, 640, 960, 1200)

# القيم بتتطبع في CSS، فلازم تبقى أرقام مش نص حر.
_NUM_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def _num(value, default=None):
    """يرجّع رقم من قيمة data-field أو ``default`` لو مش رقم صريح."""
    if value is None:
        return default
    text = str(value).strip()
    if text.endswith("px"):
        text = text[:-2].strip()
    if not _NUM_RE.match(text):
        return default
    return float(text)


def _fmt(value: float) -> str:
    """رقم CSS مختصر: 44.5 مش 44.500000، و25 مش 25.0."""
    if value == int(value):
        return str(int(value))
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _offset(value: float) -> str:
    """‎+ 12px‎ أو ‎- 12px‎ — ‎calc()‎ بتحتاج مسافات حوالين العلامة."""
    sign = "-" if value < 0 else "+"
    return f"{sign} {_fmt(abs(value))}px"


# وسوم مالهاش وسم إغلاق — لازم تتستثنى من عدّ العمق وإلا الـartboard
# مايتقفلش صح (والقوالب مليانة ‎<img>‎ و‎<br>‎).
_VOID_TAGS = frozenset({
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
})


class _ZeroBlockParser(HTMLParser):
    """يمشي على HTML البلوك ويجمّع الـartboards وعناصرها.

    مابنبنيش شجرة كاملة — إحنا محتاجين بس نعرف كل عنصر تابع لأنهي artboard
    وهو جوّه ``tn-group`` ولا لأ، وده يتعمل بعدّاد عمق بسيط.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.artboards: list[dict] = []
        self._depth = 0
        self._ab: dict | None = None
        self._ab_level = 0
        self._groups: list[int] = []      # عمق كل tn-group مفتوح

    def handle_starttag(self, tag, attrs):
        self._open(tag, attrs, self_closing=False)

    def handle_startendtag(self, tag, attrs):
        self._open(tag, attrs, self_closing=True)

    def _open(self, tag, attrs, *, self_closing: bool):
        a = {k: (v or "") for k, v in attrs}
        classes = (a.get("class") or "").split()

        if self._ab is None:
            if "t396__artboard" in classes:
                screens = []
                for chunk in (a.get("data-artboard-screens") or "").split(","):
                    number = _num(chunk)
                    if number:
                        screens.append(int(number))
                self._ab = {
                    "screens": sorted(screens) or list(_DEFAULT_SCREENS),
                    "upscale": a.get("data-artboard-upscale") or "grid",
                    "valign": a.get("data-artboard-valign") or "top",
                    "offset_top": _num(
                        a.get("data-artboard-proxy-min-offset-top"), 0.0),
                    "min_height": _num(
                        a.get("data-artboard-proxy-min-height"), 0.0),
                    "max_height": _num(
                        a.get("data-artboard-proxy-max-height"), 0.0),
                    "elems": [],
                }
                self._ab_level = self._depth
                self._groups = []
        else:
            if "tn-group" in classes:
                self._groups.append(self._depth)
            if "t396__elem" in classes:
                self._collect_elem(a)

        if not self_closing and tag not in _VOID_TAGS:
            self._depth += 1

    def handle_endtag(self, tag):
        if tag in _VOID_TAGS:
            return
        self._depth = max(0, self._depth - 1)
        while self._groups and self._groups[-1] >= self._depth:
            self._groups.pop()
        if self._ab is not None and self._depth <= self._ab_level:
            self.artboards.append(self._ab)
            self._ab = None

    def close(self):
        super().close()
        # HTML ناقص وسم إغلاق: ما نضيّعش الـartboard اللي لسه مفتوح.
        if self._ab is not None:
            self.artboards.append(self._ab)
            self._ab = None

    def _collect_elem(self, a: dict):
        match = _ELEM_CLASS_RE.search(a.get("class") or "")
        if not match:
            return
        fields = {}
        for key, value in a.items():
            if not key.startswith("data-field-"):
                continue
            rest = key[len("data-field-"):]
            if not rest.endswith("-value"):
                continue
            rest = rest[: -len("-value")]
            res = None
            if "-res-" in rest:
                rest, _, res_text = rest.partition("-res-")
                res = int(res_text) if res_text.isdigit() else None
            if rest not in _FIELD_ATTRS:
                continue
            fields[(rest, res)] = value
        self._ab["elems"].append({
            "cls": "tn-elem__" + match.group(1),
            "type": a.get("data-elem-type") or "",
            "fields": fields,
            "in_group": bool(self._groups),
        })


def _field(elem: dict, name: str, screens: list[int], res: int):
    """نفس تسلسل ``t396_elem__getFieldValue``.

    قيمة الـbreakpoint الحالي الأول، ولو مش موجودة بنطلع لأقرب breakpoint
    **أكبر**، وآخر واحد (أكبر مقاس) قيمته هي القيمة الأساسية بدون لاحقة.
    """
    top = screens[-1]

    def read(r):
        return elem["fields"].get((name, None)) if r == top else elem["fields"].get((name, r))

    value = read(res)
    if value:
        return value
    for screen in screens:
        if screen <= res:
            continue
        value = read(screen)
        if value:
            return value
    return None


def _elem_rule(elem: dict, ab: dict, screens: list[int], res: int) -> str:
    """يبني إعلانات CSS لعنصر واحد عند breakpoint واحد."""
    if elem["in_group"]:
        return ""

    f = lambda name: _field(elem, name, screens, res)  # noqa: E731

    container = (f("container") or "grid").strip()
    axisx = (f("axisx") or "left").strip()
    axisy = (f("axisy") or "top").strip()
    grid = res  # grid_width == الـbreakpoint الحالي

    width = _num(f("width"))
    if (f("widthunits") or "px").strip() == "%":
        if container != "grid" or width is None:
            return ""          # نسبة من عرض الشاشة — نسيبها للـruntime
        width = grid * width / 100

    left = _num(f("left"))
    if (f("leftunits") or "px").strip() == "%":
        if container != "grid" or left is None:
            return ""
        left = grid * left / 100

    top = _num(f("top"))
    height = _num(f("height"))
    ref_height = ab["min_height"] if container == "grid" else ab["max_height"]
    if (f("topunits") or "px").strip() == "%":
        if not ref_height or top is None:
            return ""
        top = ref_height * top / 100

    decls: list[str] = []

    # ---------------------------------------------------------- width
    if width is not None:
        decls.append(f"width:{_fmt(width)}px")

    # ----------------------------------------------------------- left
    if left is not None:
        if axisx == "center":
            if width is None:
                return ""
            decls.append(f"left:calc(50% {_offset(left - width / 2)})")
        elif axisx == "right":
            if width is None:
                return ""
            if container == "grid":
                decls.append(f"left:calc(50% {_offset(grid / 2 - width + left)})")
            else:
                decls.append(f"left:calc(100% {_offset(left - width)})")
        else:
            if container == "grid":
                decls.append(f"left:calc(50% {_offset(left - grid / 2)})")
            else:
                decls.append(f"left:{_fmt(left)}px")

    # ------------------------------------------------------------ top
    if top is not None:
        base = ab["offset_top"] if container == "grid" else 0.0
        if axisy == "center":
            if height is None or not ref_height:
                return ""
            decls.append(f"top:{_fmt(base + ref_height / 2 - height / 2 + top)}px")
        elif axisy == "bottom":
            if height is None or not ref_height:
                return ""
            decls.append(f"top:{_fmt(base + ref_height - height + top)}px")
        else:
            decls.append(f"top:{_fmt(base + top)}px")

    # --------------------------------------------------------- height
    # Tilda مابيحطش ارتفاع صريح على الصور (بيتحسب من نسبة الملف) ولا على
    # النصوص (‎height:auto‎) إلا لو الوضع ‎fixed‎. أي غير كده بياخد قيمة
    # الحقل زي ما هي.
    heightmode = (f("heightmode") or "").strip()
    if (
        height is not None
        and heightmode != "hug"
        and elem["type"] != "image"
        and not (elem["type"] == "text" and heightmode != "fixed")
    ):
        decls.append(f"height:{_fmt(height)}px")

    return ";".join(decls)


def _media_query(screens: list[int], index: int) -> str:
    low = screens[index]
    high = screens[index + 1] if index + 1 < len(screens) else None
    # أصغر مقاس بياخد كل اللي تحته كمان: t396_detectResolution بيرجّع
    # ‎screens[0]‎ لما الشاشة أضيق من أول breakpoint.
    parts = [] if index == 0 else [f"(min-width:{low}px)"]
    if high is not None:
        parts.append(f"(max-width:{_fmt(high - 0.02)}px)")
    return "@media " + " and ".join(parts) if parts else ""


def zero_block_css(block_id: str, html: str) -> str:
    """CSS مواضع كل عناصر Tilda داخل بلوك واحد."""
    if not html or "t396__artboard" not in html:
        return ""
    if not _SAFE_ID_RE.match(block_id or ""):
        return ""

    parser = _ZeroBlockParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:                     # HTML مكسور — الـruntime هيتصرّف
        return ""

    scope = f"#{block_id} "
    out: list[str] = []
    for ab in parser.artboards:
        screens = ab["screens"]
        if ab["upscale"] == "window":
            # الـartboard ده Tilda بيكبّره بـ‎zoom‎ محسوب من عرض الشاشة،
            # وده رقم مايتحسبش في CSS. بنخفيه لحد ما الـruntime يرسمه
            # بدل ما يظهر مكسور.
            out.append(
                scope + ".t396__artboard_scale:not(.rendered) .t396__elem"
                "{visibility:hidden}"
            )
            continue
        for index in range(len(screens)):
            res = screens[index]
            rules = []
            for elem in ab["elems"]:
                decls = _elem_rule(elem, ab, screens, res)
                if decls:
                    rules.append(f"{scope}.{elem['cls']}{{{decls}}}")
            if not rules:
                continue
            query = _media_query(screens, index)
            body = "".join(rules)
            out.append(f"{query}{{{body}}}" if query else body)
    return "".join(out)


@lru_cache(maxsize=256)
def _cached(block_id: str, html: str) -> str:
    return zero_block_css(block_id, html)


def document_zero_css(blocks: list[dict]) -> str:
    """CSS المواضع لكل بلوكات المستند المستوردة من Tilda.

    النتيجة متخزّنة في الذاكرة حسب (معرّف البلوك، الـHTML) لأن تحليل
    قالب كامل ممكن يوصل لميجابايتات، والنص مابيتغيّرش بين الطلبات.
    """
    parts = []
    for block in blocks or []:
        if block.get("type") != "custom_html":
            continue
        html = str((block.get("props") or {}).get("html") or "")
        if "t396__artboard" not in html:
            continue
        parts.append(_cached(str(block.get("id") or ""), html))
    return "".join(parts)
