"""حصر CSS القوالب المستوردة داخل القسم بتاعها.

القالب المستورد جاي بـCSS كتب لصفحة كاملة: فيه ``body{margin:0}`` و
``.title{...}`` و ``position:fixed``. لو حطّيناه زي ما هو في صفحة الدعوة
هيكسر باقي الأقسام ويطلع بره حدوده.

الحل: نمشي على الستايل شيت ونحط كل مُحدِّد جوّه نطاق القسم:

    .title{color:red}          →   #blk-3 .title{color:red}
    body{background:#000}      →   #blk-3{background:#000}

مش محلّل CSS كامل — بس بيتعامل صح مع القواعد العادية و@media و@supports
و@font-face و@keyframes، وده اللي بيغطّي قوالب الدعوات عملياً.
"""

from __future__ import annotations

import re

# أي حاجة من دول في تصريح = نرميه. مش تجميل، دي منافذ تنفيذ كود فعلية
# في متصفحات قديمة (expression) أو تحميل خارجي مش متحكّمين فيه.
_DANGER = re.compile(r"(expression\s*\(|javascript:|vbscript:|behavior\s*:|"
                     r"-moz-binding|@import|@charset)", re.I)

_COMMENT = re.compile(r"/\*.*?\*/", re.S)

# مُحدِّدات بتشاور على الصفحة كلها — بنستبدلها بالقسم نفسه
_ROOT_SELECTORS = {"html", "body", ":root", "*", "html body", ":root body"}

# at-rules ليها مُحدِّدات جوّاها لازم تتحصر هي كمان
_NESTED_AT = re.compile(r"^@(media|supports|container|layer)\b", re.I)
# at-rules مالهاش مُحدِّدات — بتتساب زي ما هي
_PASSTHROUGH_AT = re.compile(r"^@(font-face|keyframes|-webkit-keyframes|page|"
                             r"counter-style|property)\b", re.I)

_URL_RE = re.compile(r"url\(\s*(['\"]?)([^'\")]+)\1\s*\)", re.I)


def _rewrite_urls(text: str, url_map: dict[str, str]) -> str:
    """يبدّل مسارات الملفات النسبية بروابط الأصول المرفوعة."""
    def repl(m):
        raw = (m.group(2) or "").strip()
        low = raw.lower()
        # الروابط المطلقة و/media/… اتحلّت قبل كده — نسيبها
        if low.startswith(("data:", "http://", "https://", "//", "/")):
            return f'url("{raw}")'
        key = raw.lstrip("./").split("?")[0].split("#")[0]
        mapped = url_map.get(key) or url_map.get(key.rsplit("/", 1)[-1])
        # مسار نسبي مش موجود في الأرشيف = صورة مكسورة. نشيل الخاصية بدل
        # ما نسيب طلب بيروح لسيرفرنا ويرجع 404.
        return f'url("{mapped}")' if mapped else "none"
    return _URL_RE.sub(repl, text)


def resolve_urls(css: str, url_map: dict[str, str]) -> str:
    """يحلّ مسارات ``url()`` النسبية لروابط الأصول المخزّنة.

    بيتنادى مرة واحدة وقت الاستيراد — الخريطة موجودة ساعتها بس. بعد كده
    المخزَّن كله روابط مطلقة، فالحصر وقت العرض مابيحتاجش خريطة.
    """
    return _rewrite_urls(css or "", url_map or {})


def _clean_declarations(body: str, url_map: dict[str, str]) -> str:
    out = []
    for decl in body.split(";"):
        if ":" not in decl:
            continue
        if _DANGER.search(decl):
            continue
        prop, _, val = decl.partition(":")
        prop, val = prop.strip(), val.strip()
        if not prop or not val:
            continue
        # fixed بيطلع بره القسم ويفضل معلّق فوق باقي الدعوة
        if prop.lower() == "position" and val.lower() == "fixed":
            val = "absolute"
        if "url(" in val.lower():
            val = _rewrite_urls(val, url_map)
        out.append(f"{prop}:{val}")
    return ";".join(out)


def _scope_selector(sel: str, scope: str) -> str:
    sel = " ".join(sel.split())
    if not sel:
        return ""
    low = sel.lower()
    if low in _ROOT_SELECTORS:
        return scope
    # زي html.dark أو body.rtl — نخلّيها على القسم نفسه
    for root in ("html", "body", ":root"):
        if low.startswith(root) and len(low) > len(root) and low[len(root)] in ".:[#":
            return scope + sel[len(root):]
        if low.startswith(root + " "):
            return f"{scope} {sel[len(root) + 1:]}"
    return f"{scope} {sel}"


def _scope_prelude(prelude: str, scope: str) -> str:
    seen, parts = set(), []
    for raw in prelude.split(","):
        one = _scope_selector(raw, scope)
        # html و body الاتنين بيبقوا نفس المُحدِّد بعد الحصر — نكتبه مرة
        if one and one not in seen:
            seen.add(one)
            parts.append(one)
    return ", ".join(parts)


def _split_top_level(css: str):
    """يقسّم الستايل شيت لعناصر ``(prelude, block_body)`` على المستوى الأعلى."""
    items, depth, start, prelude_end = [], 0, 0, None
    for i, ch in enumerate(css):
        if ch == ";" and depth == 0:
            # at-rule منتهية بفاصلة منقوطة (@import/@charset) — من غير
            # السطر ده كانت بتلتصق بالقاعدة اللي بعدها وتبلعها معاها
            start = i + 1
            continue
        if ch == "{":
            if depth == 0:
                prelude_end = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                items.append((css[start:prelude_end], css[prelude_end + 1:i]))
                start = i + 1
            elif depth < 0:      # قوس زيادة — نتجاهله بدل ما نقع
                depth = 0
                start = i + 1
    return items


def scope_css(css: str, scope: str, url_map: dict[str, str] | None = None,
              *, _depth: int = 0) -> str:
    """يرجّع CSS محصور داخل ``scope`` (زي ``#blk-3``)."""
    if not css or _depth > 3:
        return ""
    url_map = url_map or {}
    css = _COMMENT.sub("", css)
    out = []

    for prelude, body in _split_top_level(css):
        prelude = prelude.strip()
        if not prelude:
            continue
        if prelude.startswith("@"):
            if _PASSTHROUGH_AT.match(prelude):
                # مفيش مُحدِّدات هنا (نِسَب زي 0%/100%) — بننضّف التصريحات بس
                inner = "".join(
                    f"{p.strip()}{{{_clean_declarations(b, url_map)}}}"
                    for p, b in _split_top_level(body)
                ) or _clean_declarations(body, url_map)
                out.append(f"{prelude}{{{inner}}}")
            elif _NESTED_AT.match(prelude):
                inner = scope_css(body, scope, url_map, _depth=_depth + 1)
                if inner:
                    out.append(f"{prelude}{{{inner}}}")
            # أي at-rule تانية (@import مثلاً) بتتشال
            continue

        selector = _scope_prelude(prelude, scope)
        decls = _clean_declarations(body, url_map)
        if selector and decls:
            out.append(f"{selector}{{{decls}}}")

    return "".join(out)
