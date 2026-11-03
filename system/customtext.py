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

# ‎<br>‎ مسموح جوّه وحدة النص. الجملة اللي المصمّم كاتبها على سطرين
# («A beautiful beginning<br>of our forever») جملة واحدة بيقراها الضيف،
# فكان غلط نستبعدها من الترجمة عشان فيها فاصل سطر. بتتعرض للمترجم
# كسطرين، وبترجع ‎<br>‎ وقت الاستبدال.
LINE_BREAK_TAGS = {"br"}


def _text_to_html(text: str) -> str:
    """نص المترجم -> HTML: تهريب كامل، والسطور بتبقى ‎<br>‎."""
    lines = str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "<br>".join(escape(line) for line in lines)


class _Candidate:
    """عنصر مرقّم لسه مفتوح — بيجمع نصه وهل اتفتح جواه وسم."""

    __slots__ = ("move", "depth", "buf", "dirty")

    def __init__(self, move: str, depth: int):
        self.move = move
        self.depth = depth
        self.buf: list[str] = []
        self.dirty = False           # اتفتح وسم جوّه العنصر؟


class _Collector(HTMLParser):
    """يجمع وحدات النص: عنصر له ``data-move`` ومحتواه نص صافي.

    «نص صافي» شرط متشدّد عن قصد: لو جوّه العنصر أي وسم تاني بنسيبه.
    الاستبدال ساعتها كان هيمسح الوسم ده (``<br>`` أو ``<span>`` ملوّن)
    والمصمّم مش هيفهم راح فين. الأقسام المستوردة أغلب عناوينها نص صافي.

    العناصر المرقّمة ممكن تتداخل: مربع «كود متقدّم» بيرقّم الكارت وعناوينه
    اللي جوّاه. الكارت مش نص صافي فبنسيبه، لكن عناوينه لازم تفضل وحدات
    نص مستقلة — وإلا الكلام اللي جوّا أي كارت ما يوصلش لجدول الترجمة.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.units: list[tuple[str, str]] = []
        self._stack: list[str] = []
        self._skip = 0
        self._open: list[_Candidate] = []   # الأقرب للوسم الحالي في الآخر

    def _mark_dirty(self):
        for cand in self._open:
            cand.dirty = True

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self._skip += 1
            return
        if tag in LINE_BREAK_TAGS:
            if self._open and not self._skip:
                self._open[-1].buf.append("\n")
            return
        if tag in VOID_TAGS:
            self._mark_dirty()
            return
        self._stack.append(tag)
        self._mark_dirty()
        if self._skip:
            return
        move = dict(attrs).get("data-move")
        if move:
            self._open.append(_Candidate(move, len(self._stack)))

    def handle_startendtag(self, tag, attrs):
        if tag in LINE_BREAK_TAGS:
            if self._open and not self._skip:
                self._open[-1].buf.append("\n")
            return
        self._mark_dirty()

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if tag in LINE_BREAK_TAGS or tag in VOID_TAGS:
            return
        if self._stack:
            self._stack.pop()
        if self._open and len(self._stack) < self._open[-1].depth:
            cand = self._open.pop()
            text = "\n".join(
                line.strip() for line in "".join(cand.buf).split("\n")
            ).strip()
            if text and not cand.dirty and len(text) <= MAX_UNIT_CHARS:
                self.units.append((cand.move, text))

    def handle_data(self, data):
        if self._open and not self._skip:
            self._open[-1].buf.append(data)


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
        if self._move is not None:
            # جوّه عنصر اتستبدل: بنبلع وسومه (زي ‎<br>‎) — النص الجديد
            # اتكتب كامل بسطوره، ولو سيبنا القديمة كانت هتتكرر معاه.
            if tag not in VOID_TAGS:
                self._stack.append(tag)
            return
        self.out.append(self.get_starttag_text() or "")
        if tag in VOID_TAGS:
            return
        self._stack.append(tag)
        move = dict(attrs).get("data-move")
        if move and move in self.mapping:
            self._move = move
            self._depth = len(self._stack)
            self.out.append(_text_to_html(self.mapping[move]))

    def handle_startendtag(self, tag, attrs):
        if self._move is not None:
            return
        self.out.append(self.get_starttag_text() or "")

    def handle_endtag(self, tag):
        if tag in VOID_TAGS:
            if self._move is None:
                self.out.append(f"</{tag}>")
            return
        if self._stack:
            self._stack.pop()
        if self._move is not None:
            if len(self._stack) < self._depth:
                self._move = None         # قفلة العنصر نفسه بتتكتب
            else:
                return                    # قفلة وسم جوّاه — بتتبلع
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
        if self._move is None:
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
