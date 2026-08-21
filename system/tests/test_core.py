"""اختبارات المحرك — البلوكات، العرض، الأمان، وواجهة المحرر."""

import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta

from system import blocks as B
from system.data import golden_classic
from system.models import Customer, Guest, Invitation, Plan, RSVPResponse, Template
from system.renderer import layout_css, render_document
from system.sanitize import clean_html
from system import guestimport
from system.templatetags import invite as invite_tags
from django.core.files.uploadedfile import SimpleUploadedFile


# ==========================================================================
class SanitizeTests(TestCase):
    def test_removes_script_and_content(self):
        out = clean_html('مرحباً<script>alert(1)</script>بكم')
        self.assertNotIn("script", out)
        self.assertNotIn("alert", out)
        self.assertIn("مرحباً", out)

    def test_removes_event_handlers(self):
        out = clean_html('<p onclick="steal()">نص</p>')
        self.assertNotIn("onclick", out)
        self.assertIn("نص", out)

    def test_blocks_javascript_urls(self):
        out = clean_html('<a href="javascript:alert(1)">اضغط</a>')
        self.assertNotIn("javascript", out)

    def test_keeps_allowed_markup(self):
        out = clean_html("<p><strong>مهم</strong> وعادي</p>")
        self.assertIn("<strong>", out)

    def test_balances_unclosed_tags(self):
        out = clean_html("<p><strong>نص")
        self.assertTrue(out.endswith("</strong></p>"))

    def test_strips_dangerous_css(self):
        out = clean_html('<p style="color:red;background:url(evil)">نص</p>')
        self.assertIn("color:red", out)
        self.assertNotIn("url(", out)


# ==========================================================================
class DocumentTests(TestCase):
    def test_unknown_block_type_dropped(self):
        doc = B.normalize_document({"blocks": [{"type": "evil_block"}, {"type": "text"}]})
        self.assertEqual(len(doc["blocks"]), 1)
        self.assertEqual(doc["blocks"][0]["type"], "text")

    def test_singleton_enforced(self):
        doc = B.normalize_document({"blocks": [{"type": "hero"}, {"type": "hero"}]})
        self.assertEqual(len(doc["blocks"]), 1)

    def test_range_clamped_to_bounds(self):
        doc = B.normalize_document({"theme": {"radius": 99999}})
        self.assertLessEqual(doc["theme"]["radius"], 40)

    def test_invalid_color_falls_back(self):
        doc = B.normalize_document({"theme": {"accent": "url(javascript:1)"}})
        self.assertEqual(doc["theme"]["accent"], "#b8914f")

    def test_invalid_select_falls_back(self):
        doc = B.normalize_document({"theme": {"pattern": "../../etc/passwd"}})
        self.assertEqual(doc["theme"]["pattern"], "none")

    def test_javascript_url_rejected(self):
        doc = B.normalize_document({
            "blocks": [{"type": "location", "props": {"map_embed": "javascript:alert(1)"}}]
        })
        self.assertEqual(doc["blocks"][0]["props"]["map_embed"], "")

    def test_duplicate_ids_regenerated(self):
        doc = B.normalize_document({"blocks": [
            {"type": "text", "id": "same"}, {"type": "text", "id": "same"},
        ]})
        self.assertNotEqual(doc["blocks"][0]["id"], doc["blocks"][1]["id"])

    def test_block_limit_enforced(self):
        doc = B.normalize_document({"blocks": [{"type": "text"}] * 500})
        self.assertLessEqual(len(doc["blocks"]), 120)

    def test_every_registered_block_has_a_template(self):
        from django.template.loader import get_template
        for btype in B.BLOCK_REGISTRY:
            get_template(f"blocks/{btype}.html")   # يرمي استثناء لو مفقود


# ==========================================================================
class RendererTests(TestCase):
    def test_renders_every_block_type(self):
        doc = B.empty_document()
        doc["blocks"] = [B.make_block(t) for t in B.BLOCK_REGISTRY]
        out = render_document(doc)
        self.assertGreater(len(str(out["html"])), 500)
        self.assertIn("--accent", out["css_vars"])

    def test_hidden_block_not_sent_to_guest(self):
        doc = B.empty_document()
        doc["blocks"] = [B.make_block("text", props={"heading": "سرّي"}, visible=False)]
        out = render_document(doc, editable=False)
        self.assertNotIn("سرّي", str(out["html"]))

    def test_hidden_block_visible_in_editor(self):
        doc = B.empty_document()
        doc["blocks"] = [B.make_block("text", props={"heading": "سرّي"}, visible=False)]
        out = render_document(doc, editable=True)
        self.assertIn("سرّي", str(out["html"]))

    def test_feature_gating_hides_block_from_guest(self):
        doc = B.empty_document()
        doc["blocks"] = [B.make_block("gallery", props={"heading": "المعرض"})]
        out = render_document(doc, allowed_features={"rsvp"}, editable=False)
        self.assertNotIn("المعرض", str(out["html"]))

    def test_xss_in_text_field_is_escaped(self):
        doc = B.empty_document()
        doc["blocks"] = [B.make_block("text", props={"heading": '<img src=x onerror=alert(1)>'})]
        html = str(render_document(doc)["html"])
        # يجب أن يظهر النص مهرَّباً لا كوسم فعلي
        self.assertNotIn("<img", html)
        self.assertIn("&lt;img", html)

    def test_golden_template_builds_and_renders(self):
        doc = golden_classic.build()
        self.assertGreater(len(doc["blocks"]), 8)
        self.assertGreater(len(str(render_document(doc)["html"])), 1000)


# ==========================================================================
class BaseAppTest(TestCase):
    def setUp(self):
        self.plan = Plan.objects.create(
            name="مميزة", slug="plus", price=1000,
            features=["rsvp", "countdown", "location", "qr", "gallery", "companions"],
        )
        self.basic = Plan.objects.create(
            name="أساسية", slug="basic", price=500, features=["countdown"],
        )
        self.template = Template.objects.create(
            name="ذهبي", slug="golden", document=golden_classic.build(),
        )
        self.customer = Customer.objects.create(name="عميل", phone="0100")
        self.inv = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="ليلى", name_two="أحمد", status="published",
            event_date=timezone.now() + timedelta(days=30),
            document=self.template.get_document(),
        )
        self.staff = User.objects.create_user("staff", password="Pass!12345x", is_staff=True)
        self.normal = User.objects.create_user("normal", password="Pass!12345x")
        # الكاش يعيش خارج المعاملة، فلا بد من تفريغه حتى لا يسرّب تحديد
        # المعدّل من اختبار إلى آخر.
        from django.core.cache import cache
        cache.clear()


# ==========================================================================
class AccessTests(BaseAppTest):
    def test_dashboard_requires_login(self):
        self.assertEqual(self.client.get("/dashboard/").status_code, 302)

    def test_dashboard_forbidden_for_non_staff(self):
        self.client.force_login(self.normal)
        self.assertEqual(self.client.get("/dashboard/").status_code, 403)

    def test_editor_forbidden_for_non_staff(self):
        self.client.force_login(self.normal)
        r = self.client.get(f"/dashboard/invitations/{self.inv.pk}/editor/")
        self.assertEqual(r.status_code, 403)

    def test_save_api_forbidden_for_non_staff(self):
        self.client.force_login(self.normal)
        r = self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/save/",
            data=json.dumps({"document": {}, "fields": {}}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 403)

    def test_draft_invitation_is_404(self):
        self.inv.status = "draft"
        self.inv.save()
        self.assertEqual(self.client.get(f"/i/{self.inv.slug}/").status_code, 404)

    def test_expired_invitation_is_404(self):
        self.inv.expires_at = timezone.now() - timedelta(days=1)
        self.inv.save()
        self.assertEqual(self.client.get(f"/i/{self.inv.slug}/").status_code, 404)

    def test_password_protected_invitation(self):
        self.inv.password = "sirr"
        self.inv.save()
        r = self.client.get(f"/i/{self.inv.slug}/")
        self.assertContains(r, "محمية")
        self.client.post(f"/i/{self.inv.slug}/", {"password": "sirr"})
        self.assertContains(self.client.get(f"/i/{self.inv.slug}/"), "ليلى")


# ==========================================================================
class EditorApiTests(BaseAppTest):
    def setUp(self):
        super().setUp()
        self.client.force_login(self.staff)

    def test_editor_page_loads(self):
        r = self.client.get(f"/dashboard/invitations/{self.inv.pk}/editor/")
        self.assertEqual(r.status_code, 200)
        self.assertContains(r, "editor-schema")
        self.assertContains(r, "editor-document")

    def test_preview_api_returns_html(self):
        r = self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/preview/",
            data=json.dumps({"document": self.inv.document}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data["ok"])
        self.assertIn("lb-", data["html"])

    def test_save_persists_document_and_fields(self):
        doc = B.empty_document()
        doc["blocks"] = [B.make_block("text", props={"heading": "عنوان محفوظ"})]
        r = self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/save/",
            data=json.dumps({"document": doc, "fields": {
                "name_one": "سارة", "name_two": "خالد", "status": "published",
                "event_type": "زفاف",
            }}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.name_one, "سارة")
        self.assertEqual(self.inv.document["blocks"][0]["props"]["heading"], "عنوان محفوظ")

    def test_save_rejects_malicious_document(self):
        bad = {"blocks": [
            {"type": "text", "props": {"body": '<script>alert(1)</script>ok'}},
            {"type": "not_a_real_block"},
        ]}
        self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/save/",
            data=json.dumps({"document": bad, "fields": {"status": "draft", "event_type": "زفاف", "name_one": "ليلى"}}),
            content_type="application/json",
        )
        self.inv.refresh_from_db()
        self.assertEqual(len(self.inv.document["blocks"]), 1)
        # ملاحظة: نبحث عن الوسم نفسه لا عن كلمة "script"،
        # لأن اسم الحقل share_description يحتوي عليها.
        self.assertNotIn("<script", json.dumps(self.inv.document))
        self.assertNotIn("alert(1)", json.dumps(self.inv.document))
        self.assertEqual(self.inv.document["blocks"][0]["props"]["body"], "ok")

    def test_save_as_template_creates_template(self):
        r = self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/save-template/",
            data=json.dumps({"document": self.inv.document, "name": "قالب جديد"}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200)
        self.assertTrue(Template.objects.filter(name="قالب جديد").exists())

    def test_save_as_template_requires_name(self):
        r = self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/save-template/",
            data=json.dumps({"document": {}, "name": ""}),
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 400)

    def test_upload_rejects_non_media_file(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        evil = SimpleUploadedFile("shell.php", b"<?php ?>", content_type="application/x-php")
        r = self.client.post(f"/dashboard/invitations/{self.inv.pk}/api/upload/", {"file": evil})
        self.assertEqual(r.status_code, 400)


# ==========================================================================
class RsvpTests(BaseAppTest):
    def url(self):
        return f"/i/{self.inv.slug}/rsvp/"

    def test_rsvp_saved(self):
        self.client.post(self.url(), {"name": "منى", "status": "attending", "companions": "2"})
        self.assertEqual(RSVPResponse.objects.count(), 1)
        self.assertEqual(RSVPResponse.objects.first().companions, 2)

    def test_companions_clamped_to_block_max(self):
        self.client.post(self.url(), {"name": "منى", "status": "attending", "companions": "9999"})
        self.assertLessEqual(RSVPResponse.objects.first().companions, 5)

    def test_honeypot_blocks_bot(self):
        self.client.post(self.url(), {"name": "بوت", "website": "spam.com"})
        self.assertEqual(RSVPResponse.objects.count(), 0)

    def test_empty_name_rejected(self):
        self.client.post(self.url(), {"name": "", "status": "attending"})
        self.assertEqual(RSVPResponse.objects.count(), 0)

    def test_duplicate_within_window_ignored(self):
        for _ in range(3):
            self.client.post(self.url(), {"name": "منى", "status": "attending"})
        self.assertEqual(RSVPResponse.objects.count(), 1)

    def test_rate_limited(self):
        from django.core.cache import cache
        cache.clear()
        blocked = False
        for i in range(20):
            r = self.client.post(self.url(), {"name": f"ضيف {i}", "status": "attending"},
                                 HTTP_X_REQUESTED_WITH="XMLHttpRequest")
            if r.status_code == 429:
                blocked = True
                break
        self.assertTrue(blocked, "لم يُفعَّل تحديد المعدّل")

    def test_rsvp_blocked_when_plan_lacks_feature(self):
        self.inv.plan = self.basic
        self.inv.save()
        r = self.client.post(self.url(), {"name": "منى", "status": "attending"},
                             HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(RSVPResponse.objects.count(), 0)


# ==========================================================================
class ViewCounterTests(BaseAppTest):
    def test_views_increment_without_race(self):
        for _ in range(5):
            self.client.get(f"/i/{self.inv.slug}/")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.public_views, 5)



# ==========================================================================
class LayoutTests(BaseAppTest):
    """مواضع النصوص (السحب بالماوس) — تنظيف المدخلات وتوليد الـCSS."""

    def _layout(self, raw):
        doc = B.normalize_document({"blocks": [
            {"type": "hero", "id": "hero-1", "layout": raw}
        ]})
        return doc["blocks"][0]["layout"]

    def test_valid_offsets_kept(self):
        self.assertEqual(self._layout({"name_one": {"dx": 5.5, "dy": -3.25}}),
                         {"name_one": {"dx": 5.5, "dy": -3.25}})

    def test_out_of_range_is_clamped(self):
        got = self._layout({"name_one": {"dx": 9999, "dy": -9999}})
        self.assertEqual(got["name_one"],
                         {"dx": B.LAYOUT_MAX_X, "dy": -B.LAYOUT_MAX_Y})

    def test_zero_offset_is_dropped(self):
        self.assertEqual(self._layout({"name_one": {"dx": 0, "dy": 0}}), {})

    def test_unknown_and_malicious_slots_rejected(self):
        self.assertEqual(self._layout({
            "not_a_real_slot": {"dx": 3, "dy": 3},
            '"] {display:none} [x="': {"dx": 3, "dy": 3},
            "name_one": "مش قاموس",
            "subtitle": {"dx": "نص", "dy": None},
        }), {})

    def test_layout_css_only_emits_moved_slots(self):
        css = layout_css([
            {"id": "hero-1", "layout": {"name_one": {"dx": 4, "dy": -2},
                                        "subtitle": {"dx": 0, "dy": 0}}},
            {"id": "quote-1", "layout": {}},
        ])
        self.assertIn('#hero-1 [data-slot="name_one"]{--dx:4cqw;--dy:-2cqw}', css)
        self.assertNotIn("subtitle", css)
        self.assertNotIn("quote-1", css)

    def test_layout_css_empty_when_nothing_moved(self):
        self.assertEqual(layout_css([{"id": "hero-1", "layout": {}}]), "")

    def test_layout_renders_on_public_invitation(self):
        doc = self.inv.document
        doc["blocks"][0]["layout"] = {"name_one": {"dx": 7.5, "dy": 2.5}}
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])

        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        self.assertIn("--dx:7.5cqw", body)
        # لازم يخرج غير مهرَّب، وإلا الـCSS تبقى غير صالحة تماماً
        self.assertNotIn("&quot;name_one&quot;", body)


# ==========================================================================
class GuestLinkTests(BaseAppTest):
    """الرابط الشخصي للضيف — الرمز هو بيانات الاعتماد."""

    def setUp(self):
        super().setUp()
        self.guest = Guest.objects.create(
            invitation=self.inv, name="أحمد سالم",
            phone="01000000001", plus_ones_allowed=2,
        )

    # ---- الوصول
    def test_guest_link_opens(self):
        res = self.client.get(self.guest.get_absolute_url())
        self.assertEqual(res.status_code, 200)
        self.assertIn(self.guest.name, res.content.decode())

    def test_form_is_prefilled_and_carries_token(self):
        body = self.client.get(self.guest.get_absolute_url()).content.decode()
        self.assertIn(f'name="guest_token" value="{self.guest.token}"', body)
        self.assertIn(f'value="{self.guest.name}"', body)

    def test_bad_token_is_404(self):
        self.assertEqual(
            self.client.get(f"/i/{self.inv.slug}/g/{'z' * 24}/").status_code, 404)

    def test_token_from_another_invitation_is_404(self):
        other = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="س", name_two="ص", status="published",
            event_date=timezone.now() + timedelta(days=10),
            document=self.template.get_document(),
        )
        stranger = Guest.objects.create(invitation=other, name="غريب")
        self.assertEqual(
            self.client.get(f"/i/{self.inv.slug}/g/{stranger.token}/").status_code, 404)

    def test_token_is_long_and_unique(self):
        other = Guest.objects.create(invitation=self.inv, name="ضيف تاني")
        self.assertGreaterEqual(len(self.guest.token), 20)
        self.assertNotEqual(self.guest.token, other.token)

    def test_draft_invitation_stays_hidden_even_with_token(self):
        self.inv.status = "draft"
        self.inv.save(update_fields=["status"])
        self.assertEqual(self.client.get(self.guest.get_absolute_url()).status_code, 404)

    # ---- الرد
    def test_rsvp_links_to_guest_and_caps_companions(self):
        self.client.post(f"/i/{self.inv.slug}/rsvp/", {
            "guest_token": self.guest.token, "name": self.guest.name,
            "status": "attending", "companions": "99",
        })
        r = RSVPResponse.objects.get(guest=self.guest)
        self.assertEqual(r.companions, self.guest.plus_ones_allowed)

    def test_guest_can_change_answer_without_duplicate(self):
        for status in ("attending", "declined"):
            self.client.post(f"/i/{self.inv.slug}/rsvp/", {
                "guest_token": self.guest.token, "name": self.guest.name,
                "status": status, "companions": "0",
            })
        self.assertEqual(RSVPResponse.objects.filter(guest=self.guest).count(), 1)
        self.assertEqual(RSVPResponse.objects.get(guest=self.guest).status, "declined")

    def test_anonymous_duplicate_is_still_blocked(self):
        for _ in range(2):
            self.client.post(f"/i/{self.inv.slug}/rsvp/",
                             {"name": "زائر مجهول", "status": "attending"})
        self.assertEqual(RSVPResponse.objects.filter(name="زائر مجهول").count(), 1)

    def test_forged_token_does_not_attach_to_a_guest(self):
        self.client.post(f"/i/{self.inv.slug}/rsvp/", {
            "guest_token": "x" * 24, "name": "منتحل", "status": "attending",
        })
        self.assertIsNone(RSVPResponse.objects.get(name="منتحل").guest)


# ==========================================================================
class GuestImportTests(BaseAppTest):
    """استيراد CSV — الترميز هو اللي بيكسر الاستيراد في الواقع، مش المنطق."""

    CSV = ("الاسم,رقم الهاتف,المجموعة,عدد المرافقين\n"
           "أحمد سالم,01000123456,أهل العريس,2\n"
           "منى فؤاد,0100 123-4567,أهل العروسة,1\n")

    def test_reads_utf8_with_bom_from_excel(self):
        rows, rep = guestimport.parse_guests(self.CSV.encode("utf-8-sig"))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["name"], "أحمد سالم")

    def test_reads_windows_1256_from_arabic_excel(self):
        rows, rep = guestimport.parse_guests(self.CSV.encode("cp1256"))
        self.assertEqual(rep.encoding, "cp1256")
        self.assertEqual(rows[0]["name"], "أحمد سالم")

    def test_reads_semicolon_delimiter(self):
        rows, _ = guestimport.parse_guests(self.CSV.replace(",", ";").encode("utf-8"))
        self.assertEqual(len(rows), 2)

    def test_accepts_english_headers(self):
        rows, _ = guestimport.parse_guests(
            b"name,phone,group,plus\nAhmed,01001234567,Groom,2\n")
        self.assertEqual(rows[0]["name"], "Ahmed")
        self.assertEqual(rows[0]["plus_ones_allowed"], 2)

    def test_normalises_arabic_digits_and_spacing_in_phone(self):
        rows, _ = guestimport.parse_guests(
            "الاسم,رقم الهاتف\nسارة,٠١٠٠ ١٢٣-٤٥٦٧\n".encode("utf-8"))
        self.assertEqual(rows[0]["phone"], "01001234567")

    def test_missing_name_column_is_reported(self):
        rows, rep = guestimport.parse_guests("phone,city\n0100,القاهرة\n".encode())
        self.assertEqual(rows, [])
        self.assertTrue(any("عمود للاسم" in e for e in rep.errors))

    def test_rows_without_name_are_skipped(self):
        rows, rep = guestimport.parse_guests("الاسم,رقم الهاتف\n,0100\n".encode())
        self.assertEqual(rows, [])
        self.assertEqual(rep.skipped, 1)

    def test_oversized_file_is_refused(self):
        _, rep = guestimport.parse_guests(b"x" * (guestimport.MAX_BYTES + 1))
        self.assertTrue(rep.errors)

    # ---- الإدخال الفعلي
    def test_import_creates_guests_with_unique_tokens(self):
        rep = guestimport.import_guests(self.inv, self.CSV.encode("utf-8-sig"))
        self.assertEqual(rep.created, 2)
        tokens = set(self.inv.guests.values_list("token", flat=True))
        self.assertEqual(len(tokens), 2)
        self.assertTrue(all(len(t) >= 20 for t in tokens))

    def test_reimport_updates_instead_of_duplicating(self):
        guestimport.import_guests(self.inv, self.CSV.encode())
        changed = self.CSV.replace("أهل العريس,2", "أهل العريس,4")
        rep = guestimport.import_guests(self.inv, changed.encode())
        self.assertEqual(rep.created, 0)
        self.assertEqual(self.inv.guests.count(), 2)
        self.assertEqual(self.inv.guests.get(phone="01000123456").plus_ones_allowed, 4)

    def test_duplicate_phone_inside_one_file_is_skipped(self):
        raw = ("الاسم,رقم الهاتف\nأحمد,01000000009\nأحمد مرة تانية,01000000009\n")
        rep = guestimport.import_guests(self.inv, raw.encode())
        self.assertEqual(rep.created, 1)

    def test_upload_through_the_page(self):
        self.client.force_login(self.staff)
        upload = SimpleUploadedFile("guests.csv", self.CSV.encode("utf-8-sig"), "text/csv")
        res = self.client.post(f"/dashboard/invitations/{self.inv.pk}/guests/",
                               {"csv_file": upload})
        self.assertEqual(res.status_code, 302)
        self.assertEqual(self.inv.guests.count(), 2)


# ==========================================================================
class CheckinTests(BaseAppTest):
    """مسح الدخول على الباب."""

    def setUp(self):
        super().setUp()
        self.guest = Guest.objects.create(
            invitation=self.inv, name="ضيف مسح", plus_ones_allowed=3)
        self.url = f"/dashboard/invitations/{self.inv.pk}/checkin/scan/"

    def test_requires_staff(self):
        self.assertNotEqual(self.client.post(self.url, {"token": self.guest.token}).status_code, 200)

    def test_first_scan_marks_arrival(self):
        self.client.force_login(self.staff)
        data = self.client.post(self.url, {"token": self.guest.token}).json()
        self.assertTrue(data["ok"])
        self.assertFalse(data["already"])
        self.guest.refresh_from_db()
        self.assertTrue(self.guest.checked_in)
        self.assertIsNotNone(self.guest.checked_in_at)

    def test_second_scan_warns_instead_of_passing_silently(self):
        self.client.force_login(self.staff)
        self.client.post(self.url, {"token": self.guest.token})
        data = self.client.post(self.url, {"token": self.guest.token}).json()
        self.assertTrue(data["already"])

    def test_accepts_full_url_from_the_camera(self):
        self.client.force_login(self.staff)
        full = f"https://x.test/i/{self.inv.slug}/g/{self.guest.token}/"
        self.assertTrue(self.client.post(self.url, {"token": full}).json()["ok"])

    def test_unknown_and_short_tokens(self):
        self.client.force_login(self.staff)
        self.assertEqual(self.client.post(self.url, {"token": "z" * 24}).status_code, 404)
        self.assertEqual(self.client.post(self.url, {"token": "abc"}).status_code, 400)

    def test_token_from_another_invitation_is_rejected(self):
        other = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="س", name_two="ص", status="published",
            event_date=timezone.now() + timedelta(days=5),
            document=self.template.get_document(),
        )
        stranger = Guest.objects.create(invitation=other, name="غريب")
        self.client.force_login(self.staff)
        self.assertEqual(self.client.post(self.url, {"token": stranger.token}).status_code, 404)

    def test_guest_qr_is_served(self):
        res = self.client.get(f"/i/{self.inv.slug}/g/{self.guest.token}/qr.svg")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/svg+xml")


# ==========================================================================
class FluidSizeTests(BaseAppTest):
    """المقاسات المرنة — تُضبط مرة على الديسكتوب وتتقلّص لوحدها."""

    def test_produces_clamp_with_container_units(self):
        out = invite_tags._fluid(72, ref=760)
        self.assertTrue(out.startswith("clamp("))
        self.assertIn("cqw", out)
        self.assertIn("72.0px", out)          # الحد الأقصى = اللي المستخدم كتبه

    def test_user_mobile_value_becomes_the_floor(self):
        self.assertTrue(invite_tags._fluid(72, floor=46).startswith("clamp(46.0px"))

    def test_floor_never_exceeds_the_desktop_size(self):
        out = invite_tags._fluid(30, floor=90)
        self.assertTrue(out.startswith("clamp(30.0px"))

    def test_zero_and_garbage_are_safe(self):
        for bad in ("", None, "abc", 0, -5):
            self.assertEqual(invite_tags._fluid(bad), "0px")

    def test_scales_relative_to_stage_width(self):
        # ٧٦ من ٧٦٠ = ١٠٪ من عرض المسرح
        self.assertIn("10.0cqw", invite_tags._fluid(76, ref=760))

    def test_rendered_invitation_uses_clamp_not_fixed_px(self):
        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        self.assertIn("--name-size:clamp(", body)
        self.assertIn("--block-pt:clamp(", body)
        self.assertNotIn("--name-size-m:", body)   # الحقل القديم اتحوّل لحد أدنى
