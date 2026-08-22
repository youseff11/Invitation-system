"""نصوص الأقسام المستوردة — استخراجها واستبدالها من غير ما الكود يتكسر.

القسم المستورد (``custom_html``) مالوش حقول نص زي باقي البلوكات: كلامه
عايش جوّه الـHTML نفسه. عشان كده جدول الترجمة كان بيعرض للمصمّم حقل
الكود بدل الكلام — وهو عايز يترجم «YOU'RE INVITED» مش يقرا CSS.

المحرر بيعلّم كل وحدة نص في القسم بـ``data-move="el-N"`` وبيحفظها جوّه
الكود، فالمعرّف ده موجود أصلاً وثابت بين الحفظات — بنستعمله كمفتاح.

**الاستبدال بيعيد كتابة الوسوم زي ما هي حرف بحرف** (``get_starttag_text``)
ومابيلمسش غير النص جوّه العنصر المطلوب. أي إعادة بناء للـHTML من
الأول كانت هتغيّر الاقتباسات والترتيب وتكسر ستايل القالب المستورد.
"""

from __future__ import annotations

from html import escape
from html.parser import HTMLParser

# وسوم مالهاش محتوى — عمرها ما هتبقى وحدة نص
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}

# كلام الضيف مش هنا. لو نص جوّه دول اتعرض للترجمة يبقى إحنا بنعرض كود.
SKIP_TAGS = {"script", "style", "template", "noscript"}

MAX_UNIT_CHARS = 600


class _Collector(HTMLParser):
    """يجمع وحدات النص: عنصر له ``data-move`` ومحتواه نص صافي.

    «نص صافي» شرط متشدّد عن قصد: لو جوّه العنصر أي وسم تاني بنسيبه.
    الاستبدال ساعتها كان هيمسح الوسم ده (``<br>`` أو ``<span>`` ملوّن)
    والمصمّم مش هيفهم راح فين. الأقسام المستوردة أغلب عناوينها نص صافي.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.units: list[tuple[str, str]] = []
        self._stack: list[str] = []
        self._skip = 0
        self._move: str | None = None
        self._buf: list[str] = []
        self._dirty = False          # اتفتح وسم جوّه العنصر؟

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self._skip += 1
            return
        if tag in VOID_TAGS:
            if self._move is not None:
                self._dirty = True
            return
        self._stack.append(tag)
        if self._move is not None:
            self._dirty = True
            return
        if self._skip:
            return
        move = dict(attrs).get("data-move")
        if move:
            self._move = move
            self._buf = []
            self._dirty = False
            self._depth = len(self._stack)

    def handle_startendtag(self, tag, attrs):
        if self._move is not None:
            self._dirty = True

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if tag in VOID_TAGS:
            return
        if self._stack:
            self._stack.pop()
        if self._move is not None and len(self._stack) < self._depth:
            text = "".join(self._buf).strip()
            if text and not self._dirty and len(text) <= MAX_UNIT_CHARS:
                self.units.append((self._move, text))
            self._move = None
            self._buf = []

    def handle_data(self, data):
        if self._move is not None and not self._skip:
            self._buf.append(data)


def text_units(html: str) -> list[tuple[str, str]]:
    """كل وحدات النص في القسم: ``[(data-move, النص), …]`` بترتيب ظهورها."""
    if not html or not isinstance(html, str):
        return []
    parser = _Collector()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return []                    # كود مكسور مايوقعش المحرر
    seen: set[str] = set()
    out = []
    for move, text in parser.units:
        if move in seen:
            continue
        seen.add(move)
        out.append((move, text))
    return out


class _Replacer(HTMLParser):
    """يكتب الكود زي ما هو، ويستبدل نص العناصر اللي في الخريطة بس."""

    def __init__(self, mapping: dict[str, str]):
        super().__init__(convert_charrefs=False)
        self.mapping = mapping
        self.out: list[str] = []
        self._stack: list[str] = []
        self._move: str | None = None
        self._depth = 0

    # ---- إعادة كتابة الوسوم كما وردت
    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text() or ""
        self.out.append(raw)
        if tag in VOID_TAGS:
            return
        self._stack.append(tag)
        if self._move is not None:
            return
        move = dict(attrs).get("data-move")
        if move and move in self.mapping:
            self._move = move
            self._depth = len(self._stack)
            self.out.append(escape(self.mapping[move]))

    def handle_startendtag(self, tag, attrs):
        self.out.append(self.get_starttag_text() or "")

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            self.out.append(f"</{tag}>")
            return
        if self._stack:
            self._stack.pop()
        if self._move is not None and len(self._stack) < self._depth:
            self._move = None
        self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self._move is None:            # النص المستبدَل اتكتب خلاص
            self.out.append(data)

    # ---- باقي التوكنات بتتكتب زي ما هي
    def handle_entityref(self, name):
        if self._move is None:
            self.out.append(f"&{name};")

    def handle_charref(self, name):
        if self._move is None:
            self.out.append(f"&#{name};")

    def handle_comment(self, data):
        self.out.append(f"<!--{data}-->")

    def handle_decl(self, decl):
        self.out.append(f"<!{decl}>")

    def handle_pi(self, data):
        self.out.append(f"<?{data}>")

    def unknown_decl(self, data):
        self.out.append(f"<![{data}]>")


def replace_texts(html: str, mapping: dict[str, str]) -> str:
    """يرجّع الكود بنفس شكله مع نصوص مترجَمة للعناصر اللي في الخريطة."""
    if not html or not isinstance(html, str) or not mapping:
        return html
    parser = _Replacer(mapping)
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return html                  # أي مشكلة = نسيب الأصل زي ما هو
    return "".join(parser.out)
