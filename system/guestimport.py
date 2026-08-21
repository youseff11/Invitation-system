"""استيراد قائمة الضيوف من ملف CSV.

المشكلة الحقيقية هنا مش القراءة — هي الترميز. إكسل على ويندوز عربي بيحفظ
الـCSV بترميز windows-1256 أو UTF-8 مع BOM، ولو قريناه UTF-8 عادي الأسماء
العربية بتطلع رموز مكسّرة. فبنجرّب الترميزات بالترتيب ونقيس أي واحد أنتج
عربي سليم، بدل ما نفترض ترميز واحد ونكسر نص الملفات.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field

MAX_BYTES = 2 * 1024 * 1024      # ٢ ميجا — قايمة ضيوف مش داتابيز
MAX_ROWS = 2000

# أسماء الأعمدة المقبولة لكل حقل — عربي وإنجليزي، عشان المستخدم ما يضطرش
# يظبط ترويسة الملف بنفسه.
HEADERS: dict[str, set[str]] = {
    "name":   {"name", "الاسم", "اسم", "الضيف", "guest", "full name", "fullname"},
    "phone":  {"phone", "mobile", "الهاتف", "التليفون", "الموبايل", "رقم", "رقم الهاتف",
               "tel", "whatsapp", "واتساب"},
    "group":  {"group", "المجموعة", "مجموعة", "العائلة", "family", "side", "الجهة"},
    "plus":   {"plus_ones", "plus", "companions", "مرافقون", "المرافقين", "مرافقين",
               "عدد المرافقين", "مرافق"},
    "note":   {"note", "notes", "ملاحظة", "ملاحظات", "تعليق"},
}

_ARABIC = re.compile(r"[؀-ۿ]")
# الأرقام العربية-الهندية (مصر/الخليج) والفارسية → لاتينية
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


@dataclass
class ImportReport:
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    encoding: str = ""

    @property
    def total(self) -> int:
        return self.created + self.updated


def _decode(raw: bytes) -> tuple[str, str]:
    """يرجّع (النص، اسم الترميز). بيختار الترميز اللي أنتج أكتر عربي سليم."""
    best_text, best_enc, best_score = "", "utf-8", -1
    for enc in ("utf-8-sig", "utf-8", "cp1256", "iso-8859-6", "utf-16"):
        try:
            text = raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        # حرف الاستبدال معناه الترميز غلط
        score = len(_ARABIC.findall(text)) - text.count("�") * 50
        if score > best_score:
            best_text, best_enc, best_score = text, enc, score
        if enc == "utf-8-sig" and score > 0:
            break                      # الأغلب الأعم وصح — مفيش داعي نكمل
    if not best_text:
        best_text = raw.decode("utf-8", errors="replace")
    return best_text, best_enc


def _sniff(text: str) -> csv.Dialect | type[csv.Dialect]:
    """إكسل العربي بيستخدم الفاصلة المنقوطة بدل الفاصلة."""
    sample = text[:4096]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        return csv.excel


def _map_columns(fieldnames: list[str] | None) -> dict[str, str]:
    """يربط أعمدة الملف بحقولنا. المفتاح = حقلنا، القيمة = اسم العمود."""
    out: dict[str, str] = {}
    for raw in fieldnames or []:
        key = (raw or "").strip().lstrip("﻿").lower()
        for target, names in HEADERS.items():
            if target in out:
                continue
            if key in names:
                out[target] = raw
                break
    return out


def _clean_phone(value: str) -> str:
    """أرقام عربية → لاتينية، وشيل المسافات والشرط. الرقم مفتاح المطابقة."""
    v = (value or "").strip().translate(_DIGITS)
    v = re.sub(r"[\s\-()]+", "", v)
    return v[:40]


def parse_guests(raw: bytes) -> tuple[list[dict], ImportReport]:
    """يحوّل بايتات الملف لقائمة صفوف نظيفة + تقرير."""
    report = ImportReport()
    rows: list[dict] = []

    if len(raw) > MAX_BYTES:
        report.errors.append(f"الملف أكبر من {MAX_BYTES // (1024 * 1024)} ميجا.")
        return rows, report

    text, report.encoding = _decode(raw)
    if not text.strip():
        report.errors.append("الملف فاضي.")
        return rows, report

    reader = csv.DictReader(io.StringIO(text), dialect=_sniff(text))
    cols = _map_columns(reader.fieldnames)

    if "name" not in cols:
        found = ", ".join((reader.fieldnames or [])[:6]) or "لا شيء"
        report.errors.append(
            f"مفيش عمود للاسم. لازم يكون فيه عمود اسمه «الاسم» أو «name». "
            f"الأعمدة اللي في ملفك: {found}"
        )
        return rows, report

    for i, row in enumerate(reader, start=2):     # ٢ لأن السطر ١ ترويسة
        if len(rows) >= MAX_ROWS:
            report.errors.append(f"وقفنا عند {MAX_ROWS} صف — الباقي مش متقرا.")
            break

        name = (row.get(cols["name"]) or "").strip()[:120]
        if not name:
            report.skipped += 1
            continue
        if len(name) < 2:
            report.skipped += 1
            report.errors.append(f"سطر {i}: الاسم «{name}» قصير جداً.")
            continue

        plus = 0
        if "plus" in cols:
            digits = re.sub(r"\D", "", (row.get(cols["plus"]) or "").translate(_DIGITS))
            plus = min(int(digits), 20) if digits else 0

        rows.append({
            "name": name,
            "phone": _clean_phone(row.get(cols.get("phone", ""), "")),
            "group_name": (row.get(cols.get("group", ""), "") or "").strip()[:80],
            "plus_ones_allowed": plus,
            "note": (row.get(cols.get("note", ""), "") or "").strip()[:250],
            "_line": i,
        })

    if not rows and not report.errors:
        report.errors.append("مفيش أي صف فيه اسم.")
    return rows, report


def _fresh_pass_code(used: set) -> str:
    """كود تصريح مش مستخدم — لا في الداتابيز ولا في الدفعة الحالية."""
    from .models import Guest
    for _ in range(30):
        code = Guest.new_pass_code()
        if code not in used:
            used.add(code)
            return code
    import secrets
    code = "FRH-" + secrets.token_hex(5).upper()
    used.add(code)
    return code


def import_guests(invitation, raw: bytes) -> ImportReport:
    """يقرأ الملف ويضيف/يحدّث الضيوف. المطابقة بالهاتف ثم بالاسم."""
    from .models import Guest

    rows, report = parse_guests(raw)
    if not rows:
        return report

    existing = list(invitation.guests.all())
    by_phone = {g.phone: g for g in existing if g.phone}
    by_name = {g.name.strip(): g for g in existing}

    to_create: list[Guest] = []
    seen_phones: set[str] = set()
    used_codes: set[str] = set(
        Guest.objects.exclude(pass_code="").values_list("pass_code", flat=True))

    for row in rows:
        row.pop("_line", None)
        phone = row["phone"]

        # تكرار جوّه نفس الملف
        if phone and phone in seen_phones:
            report.skipped += 1
            continue
        if phone:
            seen_phones.add(phone)

        match = by_phone.get(phone) if phone else by_name.get(row["name"])
        if match is not None:
            changed = False
            for key, value in row.items():
                # ما نمسحش بيانات موجودة بقيمة فاضية من الملف
                if value in ("", 0) and getattr(match, key):
                    continue
                if getattr(match, key) != value:
                    setattr(match, key, value)
                    changed = True
            if changed:
                match.save()
                report.updated += 1
            else:
                report.skipped += 1
            continue

        guest = Guest(invitation=invitation, **row)
        # bulk_create مابيناديش save()، فالرمز وكود التصريح لازم يتولّدوا
        # هنا بإيدنا — وإلا كل الصفوف بتنزل بكود فاضي والقيد unique بيقع.
        guest.token = Guest.new_token()
        guest.pass_code = _fresh_pass_code(used_codes)
        # الضيف المستورد ليه دخلة + مرافقينه
        guest.entries_allowed = 1 + int(row.get("plus_ones_allowed") or 0)
        to_create.append(guest)
        by_name[row["name"]] = guest
        if phone:
            by_phone[phone] = guest

    if to_create:
        Guest.objects.bulk_create(to_create, batch_size=500)
        report.created = len(to_create)
    return report


SAMPLE_CSV = (
    "﻿"                       # BOM عشان إكسل يفتحه عربي صح
    "الاسم,رقم الهاتف,المجموعة,عدد المرافقين,ملاحظات\n"
    "أحمد سالم,01000000001,أهل العريس,2,\n"
    "منى فؤاد,01000000002,أهل العروسة,1,تحتاج كرسي\n"
    "كريم يوسف,,أصدقاء,0,\n"
)
