"""يطلّع ‎e2e/routes.local.json‎ — المعرّفات والرموز الحقيقية اللي صفحات الاختبار
محتاجاها (قوالب، دعوات، ضيوف، رموز الصفحات الخاصة).

بيشتغل على الإعدادات اللي في ‎DJANGO_SETTINGS_MODULE‎ (الافتراضي ‎Core.settings‎).
الملف الناتج فيه رموز سرية فمتحطّوش في Git — هو أصلاً في ‎.gitignore‎.

    python frontend/e2e/dump_routes.py
    DJANGO_SETTINGS_MODULE=my_copy_settings python frontend/e2e/dump_routes.py
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "Core.settings")

import django  # noqa: E402

django.setup()

from system.models import Invitation, Template  # noqa: E402

LIMIT = int(os.environ.get("E2E_LIMIT", "3"))

templates = [
    {"id": t.pk, "slug": t.slug}
    for t in Template.objects.filter(is_active=True).only("id", "slug")[:LIMIT]
]
invitations = []
for inv in Invitation.objects.select_related("template").order_by("pk")[:LIMIT]:
    invitations.append({
        "id": inv.pk,
        "slug": inv.slug,
        "live": bool(inv.is_live),
        "locked": bool(inv.password),
        "clientToken": inv.client_token,
        "venueToken": inv.venue_token,
        "guests": [{"id": g.pk, "token": g.token} for g in inv.guests.all()[:2]],
    })

out = Path(__file__).with_name("routes.local.json")
out.write_text(json.dumps({"templates": templates, "invitations": invitations}, indent=2),
               encoding="utf-8")
print(f"wrote {out.name}: {len(templates)} templates, {len(invitations)} invitations")
