"""اختبارات إدارة البيانات (‎/api/v1/data/‎) — بديل ‎/admin/‎ فوق نفس ‎ModelAdmin‎."""

import json

from django.contrib.admin.models import ADDITION, CHANGE, DELETION, LogEntry
from django.contrib.auth.models import Permission, User
from django.test import Client, TestCase
from django.utils import timezone

from system.data import golden_classic
from system.models import Customer, Guest, Invitation, Order, Plan, PlanAddon, SiteSetting, Template

BASE = "/api/v1/data"


def post(client, url, data):
    return client.post(url, data=json.dumps(data), content_type="application/json")


class DataAdminCase(TestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("boss", "b@x.test", "pw-123456")
        self.client = Client()
        self.client.force_login(self.admin)
        self.customer = Customer.objects.create(name="منى", phone="0100", email="m@x.test")
        self.plan = Plan.objects.create(name="ذهبية", slug="gold", price=100)
        self.template = Template.objects.create(name="ذهبي", slug="gold-t", document=golden_classic.build())
        self.invitation = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan, name_one="ليلى", name_two="أحمد",
            status="published", event_date=timezone.now(), document=self.template.get_document())
        self.guest = Guest.objects.create(invitation=self.invitation, name="ضيف", phone="0111")

    def get(self, path, **params):
        return self.client.get(f"{BASE}/{path}", params)


class AccessTests(DataAdminCase):
    def test_anonymous_and_non_staff_are_refused(self):
        anon = Client()
        self.assertEqual(anon.get(f"{BASE}/").status_code, 401)
        user = User.objects.create_user("plain", password="pw-123456")
        plain = Client()
        plain.force_login(user)
        self.assertEqual(plain.get(f"{BASE}/").status_code, 403)
        self.assertEqual(plain.get(f"{BASE}/system.customer/").status_code, 403)

    def test_staff_without_model_permissions_sees_nothing(self):
        staff = User.objects.create_user("clerk", password="pw-123456", is_staff=True)
        client = Client()
        client.force_login(staff)
        self.assertEqual(client.get(f"{BASE}/").json()["apps"], [])
        self.assertEqual(client.get(f"{BASE}/system.customer/").status_code, 403)

    def test_view_only_permission_cannot_write(self):
        staff = User.objects.create_user("viewer", password="pw-123456", is_staff=True)
        staff.user_permissions.add(Permission.objects.get(codename="view_customer"))
        client = Client()
        client.force_login(staff)
        listing = client.get(f"{BASE}/system.customer/").json()
        self.assertEqual(listing["perms"], {"view": True, "add": False, "change": False, "delete": False})
        self.assertEqual(post(client, f"{BASE}/system.customer/", {"name": "x"}).status_code, 403)
        self.assertEqual(post(client, f"{BASE}/system.customer/{self.customer.pk}/", {"name": "x"}).status_code, 403)
        self.assertEqual(post(client, f"{BASE}/system.customer/delete/", {"ids": [self.customer.pk]}).status_code, 403)

    def test_unknown_model_is_404_and_csrf_is_enforced(self):
        self.assertEqual(self.get("system.nothing/").status_code, 404)
        strict = Client(enforce_csrf_checks=True)
        strict.force_login(self.admin)
        response = strict.post(f"{BASE}/system.customer/", data="{}", content_type="application/json")
        self.assertEqual(response.status_code, 403)


class CatalogAndListTests(DataAdminCase):
    def test_catalog_lists_every_registered_table_with_counts(self):
        apps = {a["app"]: a for a in self.get("").json()["apps"]}
        keys = {m["key"]: m for a in apps.values() for m in a["models"]}
        for key in ("system.customer", "system.invitation", "system.template", "system.order", "auth.user", "auth.group", "system.sitesetting"):
            self.assertIn(key, keys)
        self.assertEqual(keys["system.customer"]["count"], 1)
        self.assertEqual(keys["system.invitation"]["count"], 1)
        self.assertEqual(list(apps)[0], "system")

    def test_single_row_tables_without_add_are_flagged(self):
        SiteSetting.objects.all().delete()
        SiteSetting.objects.create()
        keys = {m["key"]: m for a in self.get("").json()["apps"] for m in a["models"]}
        self.assertTrue(keys["system.sitesetting"]["single"])
        self.assertFalse(keys["system.customer"]["single"])

    def test_list_uses_the_admin_columns_and_formats_cells(self):
        data = self.get("system.invitation/").json()
        self.assertEqual([c["name"] for c in data["columns"]], ["title", "customer", "plan", "status", "public_views", "link"])
        row = data["rows"][0]
        cells = dict(zip([c["name"] for c in data["columns"]], row["cells"]))
        self.assertEqual(cells["customer"]["v"], "منى")
        self.assertEqual(cells["status"]["v"], dict(Invitation.STATUS_CHOICES)["published"])  # اسم الاختيار مش القيمة
        self.assertEqual(cells["link"]["k"], "link")
        self.assertEqual(cells["link"]["url"], self.invitation.get_absolute_url())

    def test_search_filter_sort_and_paging(self):
        for i in range(30):
            Customer.objects.create(name=f"عميل {i:02d}", phone=f"05{i:02d}")
        page1 = self.get("system.customer/").json()
        self.assertEqual((page1["total"], page1["pages"], len(page1["rows"])), (31, 2, 25))
        page2 = self.get("system.customer/", page=2).json()
        self.assertEqual(len(page2["rows"]), 6)
        found = self.get("system.customer/", q="عميل 07").json()
        self.assertEqual([r["title"] for r in found["rows"]], ["عميل 07"])
        asc = self.get("system.customer/", o="name").json()["rows"][0]["title"]
        desc = self.get("system.customer/", o="-name").json()["rows"][0]["title"]
        self.assertNotEqual(asc, desc)
        self.assertEqual(self.get("system.customer/", page="x").status_code, 400)

    def test_filters_are_described_and_applied(self):
        data = self.get("system.invitation/").json()
        names = {f["name"]: f for f in data["filters"]}
        self.assertEqual(set(names), {"status", "plan", "template"})
        self.assertIn("published", [o["value"] for o in names["status"]["options"]])
        self.assertEqual(self.get("system.invitation/", f_status="published").json()["total"], 1)
        self.assertEqual(self.get("system.invitation/", f_status="draft").json()["total"], 0)
        self.assertEqual(self.get("system.invitation/", f_plan=str(self.plan.pk)).json()["total"], 1)
        flags = {f["name"]: f for f in self.get("system.guest/").json()["filters"]}
        self.assertEqual(flags["checked_in"]["kind"], "bool")
        self.assertEqual(self.get("system.guest/", f_checked_in="true").json()["total"], 0)
        self.assertEqual(self.get("system.guest/", f_checked_in="false").json()["total"], 1)


class FormTests(DataAdminCase):
    def test_schema_follows_the_admin_fieldsets_and_field_kinds(self):
        data = self.get("system.template/schema/").json()
        names = [f["name"] for f in data["fields"]]
        self.assertEqual(names[:3], ["name", "name_en", "slug"])
        kinds = {f["name"]: f["kind"] for f in data["fields"]}
        self.assertEqual(kinds["category"], "choice")
        self.assertEqual(kinds["is_active"], "bool")
        self.assertEqual(kinds["cover_image"], "image")
        self.assertEqual(kinds["usage_count"], "readonly")
        self.assertNotIn("document", names)  # الأدمن مخبّيه (ضخم) والمحرر هو اللي بيعدّله
        category = next(f for f in data["fields"] if f["name"] == "category")
        self.assertIn("wedding", [c["value"] for c in category["choices"]])

    def test_object_has_values_readonly_cells_and_related_labels(self):
        data = self.get(f"system.invitation/{self.invitation.pk}/").json()
        self.assertEqual(data["title"], str(self.invitation))
        self.assertEqual(data["values"]["customer"], {"id": self.customer.pk, "label": "منى"})
        self.assertEqual(data["values"]["name_one"], "ليلى")
        self.assertIs(data["values"]["document"] is not None, True)
        self.assertEqual(data["values"]["event_date"][:10], timezone.localtime(self.invitation.event_date).date().isoformat())
        self.assertEqual(self.get("system.invitation/999999/").status_code, 404)

    def test_create_validates_and_logs(self):
        bad = post(self.client, f"{BASE}/system.customer/", {"name": "", "phone": "1"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("name", bad.json()["error"]["fields"])
        ok = post(self.client, f"{BASE}/system.customer/", {"name": "جديد", "phone": "0122", "email": "n@x.test", "notes": ""})
        self.assertEqual(ok.status_code, 200, ok.content[:300])
        created = Customer.objects.get(pk=ok.json()["id"])
        self.assertEqual((created.name, created.email), ("جديد", "n@x.test"))
        entry = LogEntry.objects.filter(object_id=str(created.pk)).first()
        self.assertEqual(entry.action_flag, ADDITION)
        self.assertEqual(entry.user, self.admin)

    def test_update_is_partial_and_keeps_untouched_fields(self):
        self.invitation.venue = "قاعة النيل"
        self.invitation.public_views = 7
        self.invitation.save()
        before = self.invitation.get_document()
        response = post(self.client, f"{BASE}/system.invitation/{self.invitation.pk}/", {"name_one": "سلمى"})
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.invitation.refresh_from_db()
        self.assertEqual((self.invitation.name_one, self.invitation.name_two), ("سلمى", "أحمد"))
        self.assertEqual((self.invitation.venue, self.invitation.public_views, self.invitation.status), ("قاعة النيل", 7, "published"))
        self.assertEqual(self.invitation.customer_id, self.customer.pk)
        self.assertEqual(self.invitation.get_document(), before)
        self.assertEqual(LogEntry.objects.filter(action_flag=CHANGE, object_id=str(self.invitation.pk)).count(), 1)

    def test_booleans_choices_foreign_keys_and_dates_round_trip(self):
        pk = self.guest.pk
        response = post(self.client, f"{BASE}/system.guest/{pk}/", {
            "checked_in": True, "source": "rsvp", "invitation": {"id": self.invitation.pk}})
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.guest.refresh_from_db()
        self.assertTrue(self.guest.checked_in)
        self.assertEqual(self.guest.source, "rsvp")
        again = self.get(f"system.guest/{pk}/").json()["values"]
        self.assertIs(again["checked_in"], True)
        self.assertEqual(again["source"], "rsvp")
        self.assertEqual(again["invitation"]["id"], self.invitation.pk)
        post(self.client, f"{BASE}/system.guest/{pk}/", {"checked_in": False})
        self.guest.refresh_from_db()
        self.assertFalse(self.guest.checked_in)

    def test_dates_round_trip_in_local_time(self):
        url = f"{BASE}/system.invitation/{self.invitation.pk}/"
        self.assertEqual(post(self.client, url, {"event_date": "2026-11-02T18:30:00"}).status_code, 200)
        self.invitation.refresh_from_db()
        self.assertEqual(timezone.localtime(self.invitation.event_date).strftime("%Y-%m-%d %H:%M"), "2026-11-02 18:30")
        self.assertEqual(self.get(f"system.invitation/{self.invitation.pk}/").json()["values"]["event_date"], "2026-11-02T18:30:00")
        self.assertEqual(post(self.client, url, {"event_date": ""}).status_code, 200)
        self.invitation.refresh_from_db()
        self.assertIsNone(self.invitation.event_date)

    def test_json_fields_and_many_to_many(self):
        addon = PlanAddon.objects.create(name="إضافة", code="x1", price=5)
        response = post(self.client, f"{BASE}/system.planaddon/{addon.pk}/", {"plans": [{"id": self.plan.pk}]})
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(list(addon.plans.values_list("pk", flat=True)), [self.plan.pk])
        values = self.get(f"system.planaddon/{addon.pk}/").json()["values"]
        self.assertEqual(values["plans"], [{"id": self.plan.pk, "label": str(self.plan)}])

        bad = post(self.client, f"{BASE}/system.plan/{self.plan.pk}/", {"bullets": "{not json"})
        self.assertEqual(bad.status_code, 400)
        self.assertIn("bullets", bad.json()["error"]["fields"])
        good = post(self.client, f"{BASE}/system.plan/{self.plan.pk}/", {"bullets": ["أ", "ب"]})
        self.assertEqual(good.status_code, 200, good.content[:300])
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.bullets, ["أ", "ب"])

    def test_lookup_searches_related_rows(self):
        Customer.objects.create(name="سارة", phone="05")
        results = self.get("system.invitation/lookup/customer/", q="سار").json()["results"]
        self.assertEqual([r["label"] for r in results], ["سارة"])
        self.assertEqual(self.get("system.invitation/lookup/title/").status_code, 404)

    def test_readonly_fields_are_displayed_not_editable(self):
        data = self.get(f"system.guest/{self.guest.pk}/").json()
        self.assertIn("token", data["readonly"])
        before = self.guest.token
        post(self.client, f"{BASE}/system.guest/{self.guest.pk}/", {"token": "hacked", "name": "اسم"})
        self.guest.refresh_from_db()
        self.assertEqual((self.guest.token, self.guest.name), (before, "اسم"))

    def test_order_shows_its_lines_as_a_related_table(self):
        order = Order.objects.create(customer=self.customer, plan=self.plan, event_type="زفاف", status="new")
        data = self.get(f"system.order/{order.pk}/").json()
        self.assertEqual(len(data["inlines"]), 1)
        self.assertEqual(data["inlines"][0]["rows"], [])


class UserTests(DataAdminCase):
    def test_password_hash_is_never_sent(self):
        data = self.get(f"auth.user/{self.admin.pk}/").json()
        self.assertNotIn("password", data["values"])
        self.assertNotIn("pbkdf2", json.dumps(data))

    def test_create_user_and_change_password(self):
        bad = post(self.client, f"{BASE}/auth.user/", {"username": "new", "password1": "a", "password2": "b"})
        self.assertEqual(bad.status_code, 400)
        ok = post(self.client, f"{BASE}/auth.user/", {"username": "newbie", "password1": "Zx-98765-abc", "password2": "Zx-98765-abc"})
        self.assertEqual(ok.status_code, 200, ok.content[:300])
        user = User.objects.get(username="newbie")
        self.assertTrue(user.check_password("Zx-98765-abc"))
        changed = post(self.client, f"{BASE}/auth.user/{user.pk}/password/", {"password1": "Qw-45678-xyz", "password2": "Qw-45678-xyz"})
        self.assertEqual(changed.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("Qw-45678-xyz"))
        mismatch = post(self.client, f"{BASE}/auth.user/{user.pk}/password/", {"password1": "a", "password2": "b"})
        self.assertEqual(mismatch.status_code, 400)


class DeleteTests(DataAdminCase):
    def test_preview_lists_what_goes_with_it(self):
        data = post(self.client, f"{BASE}/system.customer/delete-preview/", {"ids": [self.customer.pk]}).json()
        texts = " ".join(item["text"] for item in data["items"])
        self.assertIn("منى", texts)
        self.assertGreaterEqual(sum(data["counts"].values()), 3)  # العميل + الدعوة + الضيف
        self.assertEqual(data["protected"], [])

    def test_delete_removes_rows_and_logs(self):
        other = Customer.objects.create(name="مؤقت", phone="0")
        before = LogEntry.objects.count()
        response = post(self.client, f"{BASE}/system.customer/delete/", {"ids": [other.pk]})
        self.assertEqual((response.status_code, response.json()), (200, {"deleted": 1}))
        self.assertFalse(Customer.objects.filter(pk=other.pk).exists())
        self.assertEqual(LogEntry.objects.count(), before + 1)
        self.assertEqual(LogEntry.objects.filter(action_flag=DELETION).count(), 1)

    def test_protected_rows_refuse_to_delete(self):
        preview = post(self.client, f"{BASE}/system.template/delete-preview/", {"ids": [self.template.pk]}).json()
        self.assertTrue(preview["protected"])
        response = post(self.client, f"{BASE}/system.template/delete/", {"ids": [self.template.pk]})
        self.assertEqual((response.status_code, response.json()["error"]["code"]), (409, "protected"))
        self.assertTrue(Template.objects.filter(pk=self.template.pk).exists())

    def test_ids_are_required_and_validated(self):
        self.assertEqual(post(self.client, f"{BASE}/system.customer/delete/", {"ids": []}).status_code, 400)
        self.assertEqual(post(self.client, f"{BASE}/system.customer/delete/", {"ids": ["x"]}).status_code, 400)
        self.assertEqual(post(self.client, f"{BASE}/system.customer/delete/", {"ids": [999999]}).status_code, 404)
