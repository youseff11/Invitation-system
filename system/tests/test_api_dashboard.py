"""اختبارات واجهة لوحة التحكم (‎/api/v1/dashboard/‎).

كل مسار: نجاح، تحقق، غير داخل (401)، داخل وليس من فريق العمل (403)، وCSRF.
"""

import io
import json
import shutil
import tempfile
import zipfile
from decimal import Decimal

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from system import blocks as blocks_engine
from system.models import (
    Asset, CustomFont, Customer, Guest, IntroVideo, Invitation, MusicTrack, Order,
    OrderAddon, Plan, PlanAddon, RSVPResponse, SiteSetting, Template,
)

BASE = "/api/v1/dashboard"

# (method, path) لكل مسار في اللوحة — نفس القايمة بتتجرّب للحماية (401/403/CSRF)
def _endpoints(ids):
    return [
        ("GET", f"{BASE}/overview/"),
        ("GET", f"{BASE}/analytics/"),
        ("GET", f"{BASE}/orders/"),
        ("GET", f"{BASE}/invitations/"),
        ("POST", f"{BASE}/invitations/"),
        ("GET", f"{BASE}/invitations/options/"),
        ("DELETE", f"{BASE}/invitations/{ids['invitation']}/"),
        ("POST", f"{BASE}/invitations/{ids['invitation']}/duplicate/"),
        ("POST", f"{BASE}/invitations/{ids['invitation']}/customer/"),
        ("GET", f"{BASE}/templates/"),
        ("POST", f"{BASE}/templates/"),
        ("POST", f"{BASE}/templates/import/"),
        ("DELETE", f"{BASE}/templates/{ids['template']}/"),
        ("POST", f"{BASE}/templates/{ids['template']}/toggle/"),
        ("GET", f"{BASE}/fonts/"),
        ("POST", f"{BASE}/fonts/"),
        ("DELETE", f"{BASE}/fonts/{ids['font']}/"),
        ("POST", f"{BASE}/fonts/{ids['font']}/toggle/"),
        ("GET", f"{BASE}/music/"),
        ("POST", f"{BASE}/music/"),
        ("DELETE", f"{BASE}/music/{ids['track']}/"),
        ("POST", f"{BASE}/music/{ids['track']}/toggle/"),
        ("GET", f"{BASE}/intros/"),
        ("POST", f"{BASE}/intros/"),
        ("DELETE", f"{BASE}/intros/{ids['clip']}/"),
        ("POST", f"{BASE}/intros/{ids['clip']}/toggle/"),
        ("GET", f"{BASE}/plans/"),
        ("PATCH", f"{BASE}/plans/{ids['plan']}/"),
        ("POST", f"{BASE}/addons/"),
        ("PATCH", f"{BASE}/addons/{ids['addon']}/"),
        ("DELETE", f"{BASE}/addons/{ids['addon']}/"),
        ("POST", f"{BASE}/addons/{ids['addon']}/toggle/"),
        ("GET", f"{BASE}/site/"),
        ("PUT", f"{BASE}/site/"),
    ]


class DashboardApiCase(TestCase):
    """يجهّز فريق العمل وبيانات تجريبية ويحوّل MEDIA_ROOT لمجلد مؤقت."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media = tempfile.mkdtemp(prefix="dash-media-")
        cls._override = override_settings(MEDIA_ROOT=cls._media)
        cls._override.enable()

    @classmethod
    def tearDownClass(cls):
        cls._override.disable()
        shutil.rmtree(cls._media, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.staff = User.objects.create_user("owner", password="x" * 12, is_staff=True)
        self.plain = User.objects.create_user("visitor", password="x" * 12)
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.staff)

        self.customer = Customer.objects.create(name="عميل تجريبي", phone="01000000000")
        self.plan = Plan.objects.create(name="الأساسية", slug="basic", price=Decimal("750"),
                                        features=["rsvp"])
        self.template = Template.objects.create(name="ذهبي كلاسيكي", slug="golden",
                                                category="wedding", source="builtin")
        self.invitation = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="ليلى", name_two="أحمد", status="published")
        self.addon = PlanAddon.objects.create(name="أغنية", code="music", price=Decimal("200"))
        self.font = CustomFont.objects.create(name="خط", family="MyFont",
                                              external_url="https://example.com/f.woff2")
        self.track = MusicTrack.objects.create(name="مقطوعة", external_url="https://example.com/a.mp3")
        self.clip = IntroVideo.objects.create(name="افتتاحية", external_url="https://example.com/v.mp4")

    # ---- أدوات
    def csrf(self):
        token = self.client.get("/api/v1/csrf/").json()["csrfToken"]
        return {"HTTP_X_CSRFTOKEN": token}

    def get(self, path, **params):
        return self.client.get(path, params)

    def send(self, method, path, data=None):
        kwargs = self.csrf()
        if data is not None:
            kwargs.update(data=json.dumps(data), content_type="application/json")
        return getattr(self.client, method.lower())(path, **kwargs)

    def post(self, path, data=None):
        return self.send("POST", path, data)

    def upload(self, path, fields, files=None):
        """multipart كأنه ‎FormData‎ من المتصفح (مفاتيح camelCase)."""
        body = dict(fields)
        body.update(files or {})
        return self.client.post(path, body, **self.csrf())

    def ids(self):
        return {"invitation": self.invitation.pk, "template": self.template.pk,
                "font": self.font.pk, "track": self.track.pk, "clip": self.clip.pk,
                "plan": self.plan.pk, "addon": self.addon.pk}

    def assertError(self, response, status, code):
        self.assertEqual(response.status_code, status, response.content[:300])
        self.assertEqual(response.json()["error"]["code"], code)


# ---------------------------------------------------------------- الحماية
class GuardTests(DashboardApiCase):
    def test_every_endpoint_requires_login(self):
        self.client.logout()
        for method, path in _endpoints(self.ids()):
            with self.subTest(method=method, path=path):
                response = self.send(method, path, {} if method != "GET" else None)
                self.assertError(response, 401, "unauthenticated")

    def test_every_endpoint_requires_staff(self):
        self.client.force_login(self.plain)
        for method, path in _endpoints(self.ids()):
            with self.subTest(method=method, path=path):
                response = self.send(method, path, {} if method != "GET" else None)
                self.assertError(response, 403, "forbidden")

    def test_unsafe_methods_require_csrf(self):
        for method, path in _endpoints(self.ids()):
            if method == "GET":
                continue
            with self.subTest(method=method, path=path):
                response = getattr(self.client, method.lower())(path)
                self.assertEqual(response.status_code, 403)

    def test_wrong_method(self):
        response = self.client.get(f"{BASE}/music/{self.track.pk}/toggle/")
        self.assertError(response, 405, "method_not_allowed")

    def test_responses_are_not_cached(self):
        response = self.get(f"{BASE}/overview/")
        self.assertIn("no-cache", response["Cache-Control"])

    def test_unknown_ids_are_404(self):
        for method, path in [
            ("DELETE", f"{BASE}/invitations/999999/"),
            ("POST", f"{BASE}/invitations/999999/duplicate/"),
            ("DELETE", f"{BASE}/templates/999999/"),
            ("POST", f"{BASE}/templates/999999/toggle/"),
            ("DELETE", f"{BASE}/fonts/999999/"),
            ("POST", f"{BASE}/music/999999/toggle/"),
            ("DELETE", f"{BASE}/intros/999999/"),
            ("PATCH", f"{BASE}/plans/999999/"),
            ("PATCH", f"{BASE}/addons/999999/"),
        ]:
            with self.subTest(method=method, path=path):
                self.assertError(self.send(method, path, {}), 404, "not_found")


# ---------------------------------------------------------------- القراءة
class OverviewTests(DashboardApiCase):
    def test_overview(self):
        Guest.objects.create(invitation=self.invitation, name="ضيف")
        RSVPResponse.objects.create(invitation=self.invitation, name="منى", status="attending",
                                    companions=2)
        Order.objects.create(customer=self.customer, plan=self.plan, status="new")
        Invitation.objects.filter(pk=self.invitation.pk).update(public_views=18)
        data = self.get(f"{BASE}/overview/").json()
        self.assertEqual(data["stats"], {
            "invitations": 1, "published": 1, "ordersNew": 1, "customers": 1,
            "templates": 1, "guests": 1, "attending": 1, "views": 18,
        })
        row = data["recentInvitations"][0]
        self.assertEqual((row["title"], row["customerName"], row["templateName"], row["status"]),
                         (self.invitation.title, "عميل تجريبي", "ذهبي كلاسيكي", "published"))
        self.assertEqual(row["editorUrl"], f"/app/dashboard/invitations/{self.invitation.pk}/editor")
        rsvp = data["recentRsvps"][0]
        self.assertEqual((rsvp["name"], rsvp["status"], rsvp["companions"]), ("منى", "attending", 2))
        self.assertRegex(rsvp["createdLabel"], r"^\d{4}/\d{2}/\d{2} \d{2}:\d{2}$")

    def test_analytics(self):
        Invitation.objects.filter(pk=self.invitation.pk).update(public_views=5)
        RSVPResponse.objects.create(invitation=self.invitation, name="أ", status="attending")
        RSVPResponse.objects.create(invitation=self.invitation, name="ب", status="declined")
        data = self.get(f"{BASE}/analytics/").json()
        self.assertEqual(data["totals"], {"views": 5, "attending": 1, "declined": 1})
        self.assertEqual(data["invitations"][0]["rsvps"], 2)
        self.assertEqual(data["chart"][0]["views"], 5)
        self.assertLessEqual(len(data["chart"][0]["label"]), 24)

    def test_orders_filter_and_totals(self):
        order = Order.objects.create(customer=self.customer, plan=self.plan, status="new",
                                     template=self.template, event_date="2026-09-18")
        OrderAddon.objects.create(order=order, addon=self.addon, name="", price=Decimal("200"))
        Order.objects.create(customer=self.customer, plan=self.plan, status="completed")
        data = self.get(f"{BASE}/orders/", status="new").json()
        self.assertEqual(len(data["results"]), 1)
        row = data["results"][0]
        self.assertEqual(row["total"], "950")
        self.assertEqual(row["addons"], [{"name": "أغنية", "price": "200"}])
        self.assertEqual(row["templateName"], "ذهبي كلاسيكي")
        self.assertEqual(row["eventDate"], "2026/09/18")
        self.assertEqual(row["adminUrl"], f"/admin/system/order/{order.pk}/change/")
        self.assertEqual(len(self.get(f"{BASE}/orders/").json()["results"]), 2)
        self.assertEqual(data["statusChoices"][0], {"value": "new", "label": "جديد"})


# ---------------------------------------------------------------- الدعوات
class InvitationTests(DashboardApiCase):
    def test_list_and_filters(self):
        other = Invitation.objects.create(customer=self.customer, template=self.template,
                                          name_one="سارة", status="draft")
        data = self.get(f"{BASE}/invitations/").json()
        self.assertEqual([r["id"] for r in data["results"]], [other.pk, self.invitation.pk])
        row = data["results"][1]
        self.assertEqual(row["url"], f"/i/{self.invitation.slug}/")
        self.assertTrue(row["clientUrl"].startswith(f"/i/{self.invitation.slug}/client/"))
        self.assertTrue(row["venueUrl"].startswith(f"/i/{self.invitation.slug}/venue/"))
        self.assertEqual(data["templateChoices"], [{"id": self.template.pk, "name": "ذهبي كلاسيكي"}])
        self.assertEqual([c["value"] for c in data["statusChoices"]],
                         ["draft", "review", "published", "archived"])

        by_status = self.get(f"{BASE}/invitations/", status="draft").json()["results"]
        self.assertEqual([r["id"] for r in by_status], [other.pk])
        by_name = self.get(f"{BASE}/invitations/", q="سارة").json()["results"]
        self.assertEqual([r["id"] for r in by_name], [other.pk])
        by_customer = self.get(f"{BASE}/invitations/", q="تجريبي").json()["results"]
        self.assertEqual(len(by_customer), 2)
        by_template = self.get(f"{BASE}/invitations/", template=str(self.template.pk)).json()
        self.assertEqual(len(by_template["results"]), 2)
        self.assertEqual(by_template["filters"]["template"], str(self.template.pk))
        junk = self.get(f"{BASE}/invitations/", template="abc").json()
        self.assertEqual(junk["filters"]["template"], "")

    def test_counts(self):
        Guest.objects.create(invitation=self.invitation, name="ضيف 1")
        Guest.objects.create(invitation=self.invitation, name="ضيف 2")
        RSVPResponse.objects.create(invitation=self.invitation, name="ضيف 1")
        row = self.get(f"{BASE}/invitations/").json()["results"][0]
        self.assertEqual((row["guests"], row["rsvps"]), (2, 1))

    def test_duplicate(self):
        response = self.post(f"{BASE}/invitations/{self.invitation.pk}/duplicate/")
        self.assertEqual(response.status_code, 200)
        dup = Invitation.objects.get(pk=response.json()["id"])
        self.assertEqual(dup.status, "draft")
        self.assertNotEqual(dup.slug, self.invitation.slug)
        self.assertEqual(response.json()["sourceTitle"], self.invitation.title)
        self.assertTrue(dup.title.endswith("(نسخة)"))

    def test_duplicate_gets_its_own_customer(self):
        """تغيير اسم عميل النسخة مايغيّرش اسم عميل الأصل."""
        response = self.post(f"{BASE}/invitations/{self.invitation.pk}/duplicate/")
        dup = Invitation.objects.get(pk=response.json()["id"])
        original = self.invitation.customer
        self.assertNotEqual(dup.customer_id, original.pk)
        self.assertEqual((dup.customer.name, dup.customer.phone), (original.name, original.phone))
        dup.customer.name = "اسم جديد"
        dup.customer.save()
        original.refresh_from_db()
        self.assertNotEqual(original.name, "اسم جديد")

    def test_change_customer_renames_exclusive_customer_in_place(self):
        url = f"{BASE}/invitations/{self.invitation.pk}/customer/"
        before = self.invitation.customer_id
        response = self.post(url, {"customerName": "اسم جديد"})
        self.assertEqual(response.status_code, 200)
        self.invitation.refresh_from_db()
        self.assertEqual(self.invitation.customer_id, before)
        self.assertEqual(self.invitation.customer.name, "اسم جديد")

    def test_change_customer_of_shared_customer_leaves_the_other_invitation(self):
        dup = Invitation.objects.get(pk=self.post(
            f"{BASE}/invitations/{self.invitation.pk}/duplicate/").json()["id"])
        # الدعوتين على نفس العميل (زي ما كانت بتبقى قبل النسخ بعميل مستقل)
        dup.customer = self.invitation.customer
        dup.save()
        original_name = self.invitation.customer.name
        response = self.post(f"{BASE}/invitations/{dup.pk}/customer/", {"customerName": "عميل النسخة"})
        self.assertEqual(response.status_code, 200)
        dup.refresh_from_db()
        self.invitation.refresh_from_db()
        self.assertNotEqual(dup.customer_id, self.invitation.customer_id)
        self.assertEqual(dup.customer.name, "عميل النسخة")
        self.assertEqual(self.invitation.customer.name, original_name)

    def test_change_customer_to_existing_one(self):
        other = Customer.objects.create(name="عميل تاني", phone="0111")
        response = self.post(f"{BASE}/invitations/{self.invitation.pk}/customer/", {"customerId": str(other.pk)})
        self.assertEqual(response.status_code, 200)
        self.invitation.refresh_from_db()
        self.assertEqual(self.invitation.customer_id, other.pk)

    def test_change_customer_validation(self):
        url = f"{BASE}/invitations/{self.invitation.pk}/customer/"
        self.assertEqual(self.post(url, {}).status_code, 400)
        self.assertEqual(self.post(url, {"customerId": "999999"}).status_code, 400)

    def test_delete(self):
        response = self.send("DELETE", f"{BASE}/invitations/{self.invitation.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Invitation.objects.filter(pk=self.invitation.pk).exists())

    def test_options_include_hidden_templates(self):
        hidden = Template.objects.create(name="مخفي", slug="hidden", is_active=False)
        Plan.objects.create(name="موقوفة", slug="off", is_active=False)
        data = self.get(f"{BASE}/invitations/options/").json()
        self.assertEqual({t["id"] for t in data["templates"]}, {self.template.pk, hidden.pk})
        self.assertEqual(data["templates"][0]["id"], self.template.pk)   # الظاهرة الأول
        self.assertEqual([p["name"] for p in data["plans"]], ["الأساسية"])
        self.assertEqual(data["plans"][0]["price"], "750")
        self.assertEqual(data["customers"][0]["phone"], "01000000000")
        self.assertIn("زفاف", data["eventTypes"])

    def test_create_with_new_customer(self):
        Template.objects.filter(pk=self.template.pk).update(
            document={**blocks_engine.empty_document(), "blocks": []})
        response = self.post(f"{BASE}/invitations/", {
            "templateId": self.template.pk, "planId": "", "customerId": "",
            "customerName": "عميل جديد", "customerPhone": "0123", "customerEmail": "a@b.co",
            "nameOne": "ليلى", "nameTwo": "أحمد", "eventType": "خطوبة"})
        self.assertEqual(response.status_code, 200, response.content)
        inv = Invitation.objects.get(pk=response.json()["id"])
        self.assertEqual(response.json()["editorUrl"], f"/app/dashboard/invitations/{inv.pk}/editor")
        self.assertEqual((inv.customer.name, inv.customer.phone), ("عميل جديد", "0123"))
        self.assertEqual((inv.status, inv.event_type, inv.plan), ("draft", "خطوبة", None))
        self.template.refresh_from_db()
        self.assertEqual(self.template.usage_count, 1)

    def test_create_with_existing_customer_and_plan(self):
        response = self.post(f"{BASE}/invitations/", {
            "templateId": str(self.template.pk), "planId": str(self.plan.pk),
            "customerId": str(self.customer.pk)})
        self.assertEqual(response.status_code, 200)
        inv = Invitation.objects.get(pk=response.json()["id"])
        self.assertEqual((inv.customer, inv.plan, inv.event_type), (self.customer, self.plan, "زفاف"))
        self.assertEqual(Customer.objects.count(), 1)

    def test_create_validation(self):
        response = self.post(f"{BASE}/invitations/", {"customerName": "س"})
        self.assertError(response, 400, "validation_error")
        self.assertIn("templateId", response.json()["error"]["fields"])

        response = self.post(f"{BASE}/invitations/", {"templateId": self.template.pk})
        self.assertIn("customerName", response.json()["error"]["fields"])

        response = self.post(f"{BASE}/invitations/", {
            "templateId": self.template.pk, "planId": 99999, "customerName": "س"})
        self.assertIn("planId", response.json()["error"]["fields"])
        self.assertEqual(Invitation.objects.count(), 1)


# ---------------------------------------------------------------- القوالب
def _zip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


class TemplateTests(DashboardApiCase):
    def test_list(self):
        Template.objects.filter(pk=self.template.pk).update(
            document={"blocks": [{"type": "hero"}, {"type": "text"}]})
        data = self.get(f"{BASE}/templates/").json()
        self.assertEqual(len(data["results"]), 1)
        row = data["results"][0]
        self.assertEqual((row["blocks"], row["uses"], row["isActive"]), (2, 1, True))
        self.assertEqual((row["category"], row["categoryLabel"]), ("wedding", "زفاف"))
        self.assertEqual(row["sourceLabel"], "مدمج")
        self.assertEqual(row["previewUrl"], "/templates/golden/preview/")
        self.assertEqual(row["adminUrl"], f"/admin/system/template/{self.template.pk}/change/")
        self.assertEqual(data["categories"][0], {"value": "none", "label": "بدون"})

    def test_toggle(self):
        response = self.post(f"{BASE}/templates/{self.template.pk}/toggle/")
        self.assertFalse(response.json()["isActive"])
        self.template.refresh_from_db()
        self.assertFalse(self.template.is_active)
        self.assertTrue(self.post(f"{BASE}/templates/{self.template.pk}/toggle/").json()["isActive"])

    def test_delete_used_template_is_refused(self):
        response = self.send("DELETE", f"{BASE}/templates/{self.template.pk}/")
        self.assertError(response, 409, "template_in_use")
        self.assertTrue(Template.objects.filter(pk=self.template.pk).exists())

    def test_delete_unused_template(self):
        spare = Template.objects.create(name="فاضي", slug="spare")
        response = self.send("DELETE", f"{BASE}/templates/{spare.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Template.objects.filter(pk=spare.pk).exists())

    def test_create_blank_template(self):
        response = self.upload(f"{BASE}/templates/", {
            "name": "قالبي", "category": "wedding", "collection": "Premium",
            "slug": "", "description": "وصف", "coverUrl": "https://example.com/c.jpg"})
        self.assertEqual(response.status_code, 200, response.content)
        tpl = Template.objects.get(pk=response.json()["id"])
        self.assertEqual(response.json()["editorUrl"], f"/app/dashboard/templates/{tpl.pk}/editor")
        self.assertEqual((tpl.source, tpl.is_active, tpl.sort_order, tpl.created_by),
                         ("editor", True, 0, self.staff))
        self.assertEqual(tpl.document["blocks"], [])
        self.assertTrue(tpl.slug)                       # اتولّد تلقائياً

    def test_create_validation(self):
        response = self.upload(f"{BASE}/templates/", {"category": "wedding"})
        self.assertError(response, 400, "validation_error")
        self.assertIn("name", response.json()["error"]["fields"])
        response = self.upload(f"{BASE}/templates/", {"name": "س", "category": "nope"})
        self.assertIn("category", response.json()["error"]["fields"])
        response = self.upload(f"{BASE}/templates/", {"name": "س", "category": "wedding",
                                                      "coverUrl": "not a url"})
        self.assertIn("coverUrl", response.json()["error"]["fields"])

    def test_create_with_cover_upload_limit(self):
        big = SimpleUploadedFile("c.png", b"0" * (8 * 1024 * 1024 + 1), content_type="image/png")
        response = self.upload(f"{BASE}/templates/", {"name": "س", "category": "wedding"},
                               {"coverImage": big})
        self.assertError(response, 400, "file_too_large")
        junk = SimpleUploadedFile("c.png", b"not an image", content_type="image/png")
        response = self.upload(f"{BASE}/templates/", {"name": "س", "category": "wedding"},
                               {"coverImage": junk})
        self.assertIn("coverImage", response.json()["error"]["fields"])

    def test_import_html(self):
        page = ("<html><head><title>قالب مستورد</title></head><body>"
                "<section><h1>أهلاً بكم في حفل زفافنا</h1>"
                "<p>" + "نص طويل لدعوة الحفل يكفي لتجاوز الحد الأدنى للنص المرئي. " * 3 + "</p>"
                "</section></body></html>")
        upload = SimpleUploadedFile("index.html", page.encode(), content_type="text/html")
        response = self.upload(f"{BASE}/templates/import/", {"name": "", "category": "wedding"},
                               {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        tpl = Template.objects.get(pk=data["id"])
        self.assertEqual((tpl.source, tpl.category, tpl.name), ("import", "wedding", "قالب مستورد"))
        self.assertGreaterEqual(data["blocks"], 1)
        self.assertFalse(data["thinContent"])

    def test_import_zip(self):
        archive = _zip({"index.html": "<html><body><section><h1>مرحباً</h1></section></body></html>"
                                      .encode()})
        upload = SimpleUploadedFile("t.zip", archive, content_type="application/zip")
        response = self.upload(f"{BASE}/templates/import/", {"name": "من الأرشيف"}, {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["name"], "من الأرشيف")
        self.assertTrue(response.json()["thinContent"])      # نص قليل → تنبيه

    def test_import_rejections(self):
        # لا ملف
        self.assertError(self.upload(f"{BASE}/templates/import/", {}), 400, "validation_error")
        # امتداد غير مسموح
        junk = SimpleUploadedFile("t.txt", b"hello", content_type="text/plain")
        response = self.upload(f"{BASE}/templates/import/", {}, {"file": junk})
        self.assertError(response, 400, "import_failed")
        # أرشيف تالف
        broken = SimpleUploadedFile("t.zip", b"PK-not-really-a-zip", content_type="application/zip")
        response = self.upload(f"{BASE}/templates/import/", {}, {"file": broken})
        self.assertError(response, 400, "import_failed")
        self.assertIn("ZIP", response.json()["error"]["message"])
        # تصنيف غلط
        ok = SimpleUploadedFile("index.html", b"<html><body><p>x</p></body></html>")
        response = self.upload(f"{BASE}/templates/import/", {"category": "bogus"}, {"file": ok})
        self.assertIn("category", response.json()["error"]["fields"])
        self.assertEqual(Template.objects.count(), 1)

    def test_import_size_limit_is_checked_before_reading(self):
        from system import templateimport

        big = SimpleUploadedFile("t.zip", b"PK" + b"0" * (templateimport.MAX_ARCHIVE_BYTES + 1))
        response = self.upload(f"{BASE}/templates/import/", {}, {"file": big})
        self.assertError(response, 400, "import_failed")
        self.assertIn("50", response.json()["error"]["message"])

    def test_import_skips_path_traversal_members(self):
        archive = _zip({
            "../evil.html": b"<html><body><p>x</p></body></html>",
            "index.html": b"<html><body><section><h1>ok</h1></section></body></html>",
        })
        upload = SimpleUploadedFile("t.zip", archive, content_type="application/zip")
        response = self.upload(f"{BASE}/templates/import/", {}, {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertGreaterEqual(response.json()["blocks"], 1)
        self.assertFalse(Asset.objects.filter(file__contains="evil").exists())


# ---------------------------------------------------------------- المكتبات
class FontTests(DashboardApiCase):
    def valid(self, **extra):
        data = {"name": "خط جديد", "nameEn": "New", "family": "NewFont", "externalUrl": "",
                "weight": "400", "style": "normal", "isActive": "true", "order": "0"}
        data.update(extra)
        return data

    def test_list(self):
        row = self.get(f"{BASE}/fonts/").json()["results"][0]
        self.assertEqual((row["name"], row["family"], row["weight"], row["styleLabel"]),
                         ("خط", "MyFont", 400, "عادي"))
        self.assertEqual(row["url"], "https://example.com/f.woff2")

    def test_upload_font(self):
        upload = SimpleUploadedFile("f.woff2", b"wOF2" + b"0" * 32, content_type="font/woff2")
        response = self.upload(f"{BASE}/fonts/", self.valid(), {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)
        font = CustomFont.objects.get(pk=response.json()["id"])
        self.assertEqual((font.family, font.uploaded_by, font.is_active), ("NewFont", self.staff, True))
        self.assertTrue(response.json()["url"].startswith("/media/fonts/"))

    def test_external_url_instead_of_file(self):
        response = self.upload(f"{BASE}/fonts/", self.valid(externalUrl="https://x.test/f.woff2"))
        self.assertEqual(response.status_code, 200, response.content)

    def test_needs_file_or_url(self):
        response = self.upload(f"{BASE}/fonts/", self.valid())
        self.assertError(response, 400, "validation_error")
        self.assertIn("ملف خط", response.json()["error"]["message"])
        self.assertIn("__all__", response.json()["error"]["fields"])

    def test_field_validation(self):
        response = self.upload(f"{BASE}/fonts/", self.valid(
            family="١٢٣ bad", weight="450", externalUrl="https://x.test/f.woff2"))
        fields = response.json()["error"]["fields"]
        self.assertIn("family", fields)
        self.assertIn("weight", fields)

    def test_extension_and_size_limits(self):
        exe = SimpleUploadedFile("f.exe", b"MZ", content_type="application/octet-stream")
        response = self.upload(f"{BASE}/fonts/", self.valid(), {"file": exe})
        self.assertIn("file", response.json()["error"]["fields"])
        big = SimpleUploadedFile("f.ttf", b"0" * (8 * 1024 * 1024 + 1))
        response = self.upload(f"{BASE}/fonts/", self.valid(), {"file": big})
        self.assertIn("٨ ميجابايت", response.json()["error"]["fields"]["file"])
        self.assertEqual(CustomFont.objects.count(), 1)

    def test_toggle_and_delete(self):
        self.assertFalse(self.post(f"{BASE}/fonts/{self.font.pk}/toggle/").json()["isActive"])
        self.assertEqual(self.send("DELETE", f"{BASE}/fonts/{self.font.pk}/").status_code, 200)
        self.assertEqual(CustomFont.objects.count(), 0)


class MusicTests(DashboardApiCase):
    def valid(self, **extra):
        data = {"name": "جديدة", "externalUrl": "", "note": "", "isActive": "true", "order": "3"}
        data.update(extra)
        return data

    def test_list(self):
        row = self.get(f"{BASE}/music/").json()["results"][0]
        self.assertEqual((row["name"], row["isActive"], row["url"]),
                         ("مقطوعة", True, "https://example.com/a.mp3"))

    def test_upload(self):
        upload = SimpleUploadedFile("s.mp3", b"ID3" + b"0" * 64, content_type="audio/mpeg")
        response = self.upload(f"{BASE}/music/", self.valid(), {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)
        track = MusicTrack.objects.get(pk=response.json()["id"])
        self.assertEqual((track.name, track.order), ("جديدة", 3))
        self.assertTrue(response.json()["url"].startswith("/media/music/"))

    def test_accepts_audio_by_extension_when_browser_sends_generic_type(self):
        upload = SimpleUploadedFile("s.m4a", b"0" * 64, content_type="application/octet-stream")
        response = self.upload(f"{BASE}/music/", self.valid(), {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)

    def test_rejects_non_audio_and_oversize(self):
        page = SimpleUploadedFile("a.html", b"<script>1</script>", content_type="text/html")
        response = self.upload(f"{BASE}/music/", self.valid(), {"file": page})
        self.assertError(response, 400, "validation_error")
        self.assertIn("file", response.json()["error"]["fields"])
        big = SimpleUploadedFile("s.mp3", b"0" * (8 * 1024 * 1024 + 1), content_type="audio/mpeg")
        response = self.upload(f"{BASE}/music/", self.valid(), {"file": big})
        self.assertIn("file", response.json()["error"]["fields"])
        self.assertEqual(MusicTrack.objects.count(), 1)

    def test_needs_file_or_url(self):
        response = self.upload(f"{BASE}/music/", self.valid())
        self.assertIn("__all__", response.json()["error"]["fields"])
        self.assertIn("name", self.upload(f"{BASE}/music/", self.valid(name="")).json()["error"]["fields"])

    def test_toggle_and_delete(self):
        self.assertFalse(self.post(f"{BASE}/music/{self.track.pk}/toggle/").json()["isActive"])
        self.assertEqual(self.send("DELETE", f"{BASE}/music/{self.track.pk}/").status_code, 200)
        self.assertEqual(MusicTrack.objects.count(), 0)


class IntroTests(DashboardApiCase):
    def valid(self, **extra):
        data = {"name": "جديدة", "externalUrl": "", "note": "", "isActive": "true", "order": "0"}
        data.update(extra)
        return data

    def test_list(self):
        IntroVideo.objects.filter(pk=self.clip.pk).update(seconds=3.5)
        row = self.get(f"{BASE}/intros/").json()["results"][0]
        self.assertEqual((row["name"], row["posterUrl"]), ("افتتاحية", ""))
        self.assertRegex(row["secondsLabel"], r"^3[.,]5$")

    def test_upload_video_goes_through_the_compressor(self):
        from unittest import mock

        upload = SimpleUploadedFile("i.mp4", b"0" * 128, content_type="video/mp4")
        with mock.patch("system.video.compress", return_value=(upload, 4.0)) as compress, \
                mock.patch("system.video.make_thumbnail", return_value=None):
            response = self.upload(f"{BASE}/intros/", self.valid(), {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)
        compress.assert_called_once()
        clip = IntroVideo.objects.get(pk=response.json()["id"])
        self.assertEqual(clip.seconds, 4.0)
        self.assertTrue(clip.file.name.startswith("intro_videos/"))

    def test_compression_failure_keeps_the_original(self):
        from unittest import mock

        upload = SimpleUploadedFile("i.mp4", b"0" * 128, content_type="video/mp4")
        with mock.patch("system.video.compress", side_effect=RuntimeError("no ffmpeg")):
            response = self.upload(f"{BASE}/intros/", self.valid(), {"file": upload})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(IntroVideo.objects.get(pk=response.json()["id"]).file)

    def test_rejects_non_video_and_oversize(self):
        text = SimpleUploadedFile("i.txt", b"hello", content_type="text/plain")
        response = self.upload(f"{BASE}/intros/", self.valid(), {"file": text})
        self.assertIn("file", response.json()["error"]["fields"])
        from system import video

        big = SimpleUploadedFile("i.mp4", b"0" * (video.MAX_UPLOAD_BYTES + 1), content_type="video/mp4")
        response = self.upload(f"{BASE}/intros/", self.valid(), {"file": big})
        self.assertIn("file", response.json()["error"]["fields"])
        poster = SimpleUploadedFile("p.png", b"0" * (8 * 1024 * 1024 + 1), content_type="image/png")
        response = self.upload(f"{BASE}/intros/", self.valid(externalUrl="https://x.test/i.mp4"),
                               {"poster": poster})
        self.assertError(response, 400, "file_too_large")
        self.assertEqual(IntroVideo.objects.count(), 1)

    def test_needs_file_or_url(self):
        response = self.upload(f"{BASE}/intros/", self.valid())
        self.assertIn("__all__", response.json()["error"]["fields"])

    def test_toggle_and_delete(self):
        self.assertFalse(self.post(f"{BASE}/intros/{self.clip.pk}/toggle/").json()["isActive"])
        self.assertEqual(self.send("DELETE", f"{BASE}/intros/{self.clip.pk}/").status_code, 200)
        self.assertEqual(IntroVideo.objects.count(), 0)


class VideoLibraryTests(DashboardApiCase):
    def setUp(self):
        super().setUp()
        self.video = IntroVideo.objects.create(
            name="عادي", library="videos", external_url="https://example.com/a.mp4")

    def test_libraries_are_separate(self):
        videos = self.get(f"{BASE}/videos/").json()["results"]
        intros = self.get(f"{BASE}/intros/").json()["results"]
        self.assertEqual([r["name"] for r in videos], ["عادي"])
        self.assertEqual([r["name"] for r in intros], ["افتتاحية"])

    def test_upload_lands_in_the_videos_library(self):
        response = self.upload(f"{BASE}/videos/", {
            "name": "جديد", "externalUrl": "https://x.test/v.mp4", "note": "",
            "isActive": "true", "order": "0"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(IntroVideo.objects.get(pk=response.json()["id"]).library, "videos")

    def test_move_to_intros_removes_it_from_videos(self):
        response = self.post(f"{BASE}/videos/{self.video.pk}/move/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(IntroVideo.objects.get(pk=self.video.pk).library, "intros")
        self.assertEqual(self.get(f"{BASE}/videos/").json()["results"], [])
        names = [r["name"] for r in self.get(f"{BASE}/intros/").json()["results"]]
        self.assertIn("عادي", names)
        # مرة تانية: مبقاش في الفيديوهات
        self.assertEqual(self.post(f"{BASE}/videos/{self.video.pk}/move/").status_code, 404)

    def test_rename_in_both_libraries(self):
        for kind, pk in (("videos", self.video.pk), ("intros", self.clip.pk)):
            response = self.send("PATCH", f"{BASE}/{kind}/{pk}/", {"name": "  اسم جديد "})
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()["name"], "اسم جديد")
        self.assertEqual(IntroVideo.objects.get(pk=self.clip.pk).name, "اسم جديد")

    def test_rename_rejects_blank_and_long(self):
        for name in ("   ", "x" * 121):
            response = self.send("PATCH", f"{BASE}/videos/{self.video.pk}/", {"name": name})
            self.assertEqual(response.status_code, 400)
            self.assertIn("name", response.json()["error"]["fields"])

    def test_cannot_touch_the_other_library(self):
        self.assertEqual(self.send("PATCH", f"{BASE}/intros/{self.video.pk}/", {"name": "x"}).status_code, 404)
        self.assertEqual(self.send("DELETE", f"{BASE}/videos/{self.clip.pk}/").status_code, 404)
        self.assertEqual(self.post(f"{BASE}/videos/{self.clip.pk}/toggle/").status_code, 404)

    def test_toggle_and_delete(self):
        self.assertFalse(self.post(f"{BASE}/videos/{self.video.pk}/toggle/").json()["isActive"])
        self.assertEqual(self.send("DELETE", f"{BASE}/videos/{self.video.pk}/").status_code, 200)

    def test_needs_staff(self):
        self.client.logout()
        self.assertIn(self.client.get(f"{BASE}/videos/").status_code, (401, 403))


# ---------------------------------------------------------------- الباقات
class PlanTests(DashboardApiCase):
    def addon_body(self, **extra):
        body = {"name": "تسليم سريع", "nameEn": "", "code": "", "price": "100", "description": "",
                "plans": [], "isActive": True, "sortOrder": 0}
        body.update(extra)
        return body

    def test_list(self):
        PlanAddon.objects.filter(pk=self.addon.pk).update()
        self.addon.plans.add(self.plan)
        Plan.objects.create(name="موقوفة", slug="off", is_active=False)
        data = self.get(f"{BASE}/plans/").json()
        addon = data["addons"][0]
        self.assertEqual((addon["name"], addon["price"], addon["code"]), ("أغنية", "200", "music"))
        self.assertEqual(addon["plans"], [{"id": self.plan.pk, "name": "الأساسية"}])
        self.assertEqual(addon["planIds"], [self.plan.pk])
        plan = next(p for p in data["plans"] if p["id"] == self.plan.pk)
        self.assertEqual((plan["name"], plan["price"], plan["oldPrice"]), ("الأساسية", "750", ""))
        self.assertEqual(plan["features"], ["rsvp"])
        self.assertEqual([p["name"] for p in data["planChoices"]], ["الأساسية"])
        self.assertIn("music", data["featureKeys"])
        self.assertEqual(data["featureKeys"], sorted(data["featureKeys"]))

    def test_create_addon(self):
        response = self.post(f"{BASE}/addons/", self.addon_body(
            code="gallery", plans=[self.plan.pk], price="49.5"))
        self.assertEqual(response.status_code, 200, response.content)
        addon = PlanAddon.objects.get(pk=response.json()["id"])
        self.assertEqual((addon.code, addon.price, list(addon.plans.all())),
                         ("gallery", Decimal("49.50"), [self.plan]))

    def test_addon_validation(self):
        response = self.post(f"{BASE}/addons/", self.addon_body(code="nonsense", name=""))
        self.assertError(response, 400, "validation_error")
        fields = response.json()["error"]["fields"]
        self.assertIn("code", fields)
        self.assertIn("name", fields)
        self.assertIn("price", self.post(f"{BASE}/addons/", self.addon_body(price="-5"))
                      .json()["error"]["fields"])
        # باقة موقوفة مش من اختيارات النموذج
        off = Plan.objects.create(name="موقوفة", slug="off", is_active=False)
        self.assertIn("plans", self.post(f"{BASE}/addons/", self.addon_body(plans=[off.pk]))
                      .json()["error"]["fields"])

    def test_update_addon(self):
        response = self.send("PATCH", f"{BASE}/addons/{self.addon.pk}/",
                             self.addon_body(name="اسم جديد", code="music", price="250"))
        self.assertEqual(response.status_code, 200, response.content)
        self.addon.refresh_from_db()
        self.assertEqual((self.addon.name, self.addon.price), ("اسم جديد", Decimal("250.00")))

    def test_toggle_addon(self):
        self.assertFalse(self.post(f"{BASE}/addons/{self.addon.pk}/toggle/").json()["isActive"])

    def test_delete_addon(self):
        response = self.send("DELETE", f"{BASE}/addons/{self.addon.pk}/")
        self.assertEqual(response.json(), {"deleted": True, "deactivated": False, "name": "أغنية"})
        self.assertFalse(PlanAddon.objects.filter(pk=self.addon.pk).exists())

    def test_delete_sold_addon_only_deactivates(self):
        order = Order.objects.create(customer=self.customer, plan=self.plan)
        OrderAddon.objects.create(order=order, addon=self.addon, name="أغنية", price=Decimal("200"))
        response = self.send("DELETE", f"{BASE}/addons/{self.addon.pk}/")
        self.assertEqual(response.json()["deactivated"], True)
        self.addon.refresh_from_db()
        self.assertFalse(self.addon.is_active)

    def test_quick_plan_edit(self):
        response = self.send("PATCH", f"{BASE}/plans/{self.plan.pk}/", {
            "name": "  الأساسية+  ", "price": "800", "oldPrice": "1000", "isActive": False})
        self.assertEqual(response.status_code, 200, response.content)
        self.plan.refresh_from_db()
        self.assertEqual((self.plan.name, self.plan.price, self.plan.old_price, self.plan.is_active),
                         ("الأساسية+", Decimal("800"), Decimal("1000"), False))
        cleared = self.send("PATCH", f"{BASE}/plans/{self.plan.pk}/", {
            "name": "", "price": 900, "oldPrice": "", "isActive": True})
        self.plan.refresh_from_db()
        self.assertEqual((self.plan.name, self.plan.old_price), ("الأساسية+", None))
        self.assertEqual(cleared.json()["price"], "900")

    def test_quick_plan_edit_rejects_bad_prices(self):
        for body, message in [
            ({"price": "abc"}, "السعر لازم يكون رقم."),
            ({"price": "NaN"}, "السعر لازم يكون رقم."),
            ({"price": "-1"}, "السعر ماينفعش يكون بالسالب."),
            ({"price": "10", "oldPrice": "-3"}, "السعر ماينفعش يكون بالسالب."),
            ({"price": "1e12"}, "السعر أكبر من الحد المسموح."),
        ]:
            with self.subTest(body=body):
                response = self.send("PATCH", f"{BASE}/plans/{self.plan.pk}/",
                                     {"name": "س", "isActive": True, **body})
                self.assertError(response, 400, "invalid_price")
                self.assertEqual(response.json()["error"]["message"], message)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.price, Decimal("750"))


# ---------------------------------------------------------------- إعدادات الموقع
class SiteTests(DashboardApiCase):
    def body(self, **extra):
        body = {
            "plansPublic": True, "homeTemplatesPerRow": 1, "ordersEnabled": True,
            "whatsappEnabled": True, "whatsappNumber": "+201000000000",
            "whatsappFloatEnabled": True, "whatsappCtaMessage": "أهلاً",
            "previewCtaEnabled": True, "previewCtaText": "عجبك القالب؟",
            "whatsappMessage": "عايز قالب {template}",
            "facebookEnabled": True, "facebookUrl": "https://facebook.com/x",
            "instagramEnabled": False, "instagramUrl": "",
        }
        body.update(extra)
        return body

    def test_get(self):
        data = self.get(f"{BASE}/site/").json()
        self.assertEqual(set(data["values"]), set(self.body()))
        self.assertEqual(data["sample"]["previewUrl"], "/templates/golden/preview/")
        self.assertIn("previewCtaReady", data["state"])

    def test_save_and_state(self):
        response = self.send("PUT", f"{BASE}/site/", self.body())
        self.assertEqual(response.status_code, 200, response.content)
        cfg = SiteSetting.load()
        self.assertEqual((cfg.whatsapp_number, cfg.instagram_enabled, cfg.preview_cta_text),
                         ("+201000000000", False, "عجبك القالب؟"))
        state = response.json()["state"]
        self.assertTrue(state["previewCtaReady"])
        self.assertEqual(state["whatsappNumber"], "+201000000000")
        self.assertTrue(state["facebookLinked"])
        self.assertFalse(state["instagramLinked"])
        self.assertEqual(SiteSetting.objects.count(), 1)

    def test_unticked_boxes_are_saved_false(self):
        body = self.body(plansPublic=False, ordersEnabled=False)
        self.send("PUT", f"{BASE}/site/", body)
        cfg = SiteSetting.load()
        self.assertEqual((cfg.plans_public, cfg.orders_enabled), (False, False))

    def test_templates_per_row_is_saved_validated_and_public(self):
        self.assertEqual(self.get("/api/v1/site/").json()["templatesPerRow"], 1)
        response = self.send("PUT", f"{BASE}/site/", self.body(homeTemplatesPerRow=2))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["values"]["homeTemplatesPerRow"], 2)
        self.assertEqual(self.get("/api/v1/site/").json()["templatesPerRow"], 2)
        # قيمة برّه الاختيارات مرفوضة، ومفتاح ناقص بيسيب القيمة الحالية
        self.assertEqual(self.send("PUT", f"{BASE}/site/", self.body(homeTemplatesPerRow=3)).status_code, 400)
        body = self.body()
        del body["homeTemplatesPerRow"]
        self.assertEqual(self.send("PUT", f"{BASE}/site/", body).status_code, 200)
        self.assertEqual(SiteSetting.load().home_templates_per_row, 2)

    def test_cta_enabled_without_contact_is_not_ready(self):
        response = self.send("PUT", f"{BASE}/site/", self.body(
            whatsappNumber="", facebookUrl="", previewCtaEnabled=True))
        state = response.json()["state"]
        self.assertTrue(state["previewCtaEnabled"])
        self.assertFalse(state["previewCtaReady"])

    def test_validation(self):
        response = self.send("PUT", f"{BASE}/site/", self.body(
            facebookUrl="nope", previewCtaText="", whatsappMessage=""))
        self.assertError(response, 400, "validation_error")
        self.assertEqual(set(response.json()["error"]["fields"]),
                         {"facebookUrl", "previewCtaText", "whatsappMessage"})
        self.assertNotEqual(SiteSetting.load().facebook_url, "nope")

    def test_invalid_json(self):
        response = self.client.put(f"{BASE}/site/", data="not json",
                                   content_type="application/json", **self.csrf())
        self.assertError(response, 400, "invalid_json")


class RoutesAreReversible(TestCase):
    def test_urls_used_in_payloads_exist(self):
        for name, args in [("template_demo", ["x"]), ("admin:system_order_change", [1]),
                           ("admin:system_plan_change", [1]), ("admin:system_template_change", [1])]:
            with self.subTest(name=name):
                self.assertTrue(reverse(name, args=args))
