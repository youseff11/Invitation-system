"""اختبارات المحرك — البلوكات، العرض، الأمان، وواجهة المحرر."""

import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta

from system import blocks as B
from system.data import golden_classic
from system.models import (
    Asset, Customer, Guest, Invitation, MusicTrack, Plan, RSVPResponse,
    Template,
)
from system.renderer import layout_css, render_document
from system.sanitize import clean_html
from system import cssscope, guestimport, images, templateimport, video
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
        self.assertIn('#hero-1 [data-move="name_one"]{--dx:4cqw;--dy:-2cqw}', css)
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


# ==========================================================================
class ImagePipelineTests(BaseAppTest):
    """ضغط الصور والقص — أهم بند لأن ناتجه بيوصل للضيوف."""

    def _photo(self, size=(4032, 3024)):
        from PIL import Image
        import io as _io
        img = Image.new("RGB", size, (180, 150, 120))
        buf = _io.BytesIO()
        img.save(buf, "JPEG", quality=92)
        return buf.getvalue()

    def _upload(self, raw, name="photo.jpg", ctype="image/jpeg"):
        self.client.force_login(self.staff)
        return self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/upload/",
            {"file": SimpleUploadedFile(name, raw, ctype)},
        )

    def test_large_photo_is_downscaled_and_converted(self):
        raw = self._photo()
        self.assertTrue(self._upload(raw).json()["ok"])
        asset = Asset.objects.latest("id")
        self.assertLessEqual(max(asset.width, asset.height), images.MAX_EDGE)
        self.assertTrue(asset.file.name.endswith(".webp"))
        self.assertLess(asset.size_bytes, len(raw) / 4)   # توفير معتبر مش تجميلي

    def test_thumbnail_and_source_are_kept(self):
        self._upload(self._photo((1200, 900)))
        asset = Asset.objects.latest("id")
        self.assertTrue(asset.thumb)
        self.assertTrue(asset.source)          # الأصل لازم يفضل عشان إعادة القص

    def test_small_image_is_not_upscaled(self):
        self._upload(self._photo((400, 300)))
        asset = Asset.objects.latest("id")
        self.assertEqual((asset.width, asset.height), (400, 300))

    def test_corrupt_file_is_refused(self):
        res = self._upload(b"not an image at all", "x.jpg")
        self.assertEqual(res.status_code, 400)

    # ---- القص
    def _crop(self, asset, box):
        return self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/crop/",
            data=json.dumps({"asset": asset.pk, "box": box}),
            content_type="application/json",
        )

    def test_crop_respects_the_requested_ratio(self):
        self._upload(self._photo())
        asset = Asset.objects.latest("id")
        data = self._crop(asset, {"x": 0, "y": 0, "w": 0.25, "h": 0.5}).json()
        self.assertTrue(data["ok"])
        got = data["asset"]["width"] / data["asset"]["height"]
        want = (0.25 * 4032) / (0.5 * 3024)
        self.assertAlmostEqual(got, want, delta=0.05)

    def test_crop_keeps_the_original_so_it_can_be_recropped(self):
        self._upload(self._photo())
        first = Asset.objects.latest("id")
        cropped = Asset.objects.get(pk=self._crop(first, {"x": 0, "y": 0, "w": .5, "h": .5}).json()["asset"]["id"])
        self.assertTrue(cropped.source)
        again = self._crop(cropped, {"x": 0, "y": 0, "w": .5, "h": .5})
        self.assertTrue(again.json()["ok"])

    def test_out_of_bounds_box_is_clamped_not_crashed(self):
        self._upload(self._photo((800, 600)))
        asset = Asset.objects.latest("id")
        res = self._crop(asset, {"x": 5, "y": 5, "w": 9, "h": 9})
        self.assertEqual(res.status_code, 200)

    def test_crop_requires_staff(self):
        self._upload(self._photo((400, 300)))
        asset = Asset.objects.latest("id")
        self.client.logout()
        self.assertNotEqual(self._crop(asset, {"x": 0, "y": 0, "w": 1, "h": 1}).status_code, 200)

    def test_crop_rejects_asset_from_another_invitation(self):
        other = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="س", name_two="ص", status="published",
            event_date=timezone.now() + timedelta(days=5),
            document=self.template.get_document(),
        )
        self.client.force_login(self.staff)
        stranger = Asset.objects.create(kind="image", invitation=other,
                                        original_name="x", width=10, height=10)
        self.assertEqual(self._crop(stranger, {"x": 0, "y": 0, "w": 1, "h": 1}).status_code, 403)


# ==========================================================================
class IntroTests(BaseAppTest):
    """الشاشة الافتتاحية — لازم تظهر في المحرر عشان تتعاين وتتعدّل."""

    def _enable(self, **extra):
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = True
        doc["settings"].update(extra)
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])

    def test_intro_shows_for_guests(self):
        self._enable()
        self.assertIn("lb-intro", self.client.get(self.inv.get_absolute_url()).content.decode())

    def test_intro_shows_inside_the_editor_preview(self):
        self._enable()
        self.client.force_login(self.staff)
        body = self.client.get(
            f"/dashboard/invitations/{self.inv.pk}/preview-frame/").content.decode()
        self.assertIn("lb-intro", body)
        # العلامة دي بتخلي المحرر يقدر يرجّعها بعد ما تضغط «التالي»
        self.assertIn("data-intro-editable", body)

    def test_intro_video_is_muted_and_inline(self):
        self._enable(intro_video="/media/x.mp4")
        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        self.assertIn("data-intro-video", body)
        # المتصفحات بتمنع التشغيل التلقائي بصوت، وiOS بيحتاج playsinline
        self.assertIn("muted", body)
        self.assertIn("playsinline", body)

    def test_no_intro_markup_when_disabled(self):
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = False
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        self.assertNotIn("lb-intro",
                         self.client.get(self.inv.get_absolute_url()).content.decode())


# ==========================================================================
class VideoUploadTests(BaseAppTest):
    """رفع فيديو الافتتاحية — كان بيترفض قبل كده لأن المُنتقي ما كانش بيقبله."""

    def _clip(self, seconds=20, height=1080):
        """يولّد MP4 حقيقي بـffmpeg. لو مش متثبّت بنتخطّى الاختبار."""
        import shutil, subprocess, tempfile, os
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg غير متاح")
        path = tempfile.mktemp(suffix=".mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             # libx264 مع yuv420p بيرفض الأبعاد الفردية
             "-i", f"testsrc=size={height * 16 // 9 // 2 * 2}x{height}:rate=25:duration={seconds}",
             "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path],
            check=True, timeout=120,
        )
        raw = open(path, "rb").read()
        os.unlink(path)
        return raw

    def _upload(self, raw, name="intro.mp4", ctype="video/mp4"):
        self.client.force_login(self.staff)
        return self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/upload/",
            {"file": SimpleUploadedFile(name, raw, ctype)},
        )

    def test_video_upload_is_accepted(self):
        data = self._upload(self._clip(seconds=3, height=360)).json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["asset"]["kind"], "video")

    def test_tall_video_is_shrunk_to_720p(self):
        raw = self._clip(seconds=6, height=1080)
        data = self._upload(raw).json()
        asset = Asset.objects.latest("id")
        self.assertLess(asset.size_bytes, len(raw))          # اتضغط فعلاً
        self.assertGreater(data["asset"]["seconds"], 0)

    def test_duration_is_not_silently_trimmed(self):
        """القص الصامت بيبوّظ مقطع فرح طويل من غير ما المستخدم يعرف."""
        data = self._upload(self._clip(seconds=14, height=480)).json()
        self.assertGreater(data["asset"]["seconds"], 13)

    def test_audio_is_kept(self):
        """قسم الفيديو ممكن يكون مقطع ليه صوت — مانشيلوش."""
        import shutil, subprocess, tempfile, os
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg غير متاح")
        path = tempfile.mktemp(suffix=".mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error",
             "-f", "lavfi", "-i", "testsrc=size=640x480:rate=25:duration=4",
             "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
             "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-shortest", path],
            check=True, timeout=120)
        raw = open(path, "rb").read()
        os.unlink(path)
        self.assertTrue(self._upload(raw).json()["ok"])
        asset = Asset.objects.latest("id")
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a",
             "-show_entries", "stream=codec_type", "-of", "default=nw=1:nk=1",
             asset.file.path],
            capture_output=True, text=True, timeout=20)
        self.assertIn("audio", probe.stdout)

    def test_compress_falls_back_when_ffmpeg_is_missing(self):
        """الاستضافة ممكن تكون من غير ffmpeg — لازم الرفع يفضل شغّال."""
        original = video.available
        video.available = lambda: False
        try:
            up = SimpleUploadedFile("x.mp4", b"fake bytes", "video/mp4")
            out, secs = video.compress(up)
            self.assertIs(out, up)
            self.assertEqual(secs, 0)
        finally:
            video.available = original

    def test_disguised_file_is_refused(self):
        self.assertEqual(self._upload(b"x", "a.exe", "application/x-msdownload").status_code, 400)


# ==========================================================================
class MusicLibraryTests(BaseAppTest):
    """مكتبة الموسيقى — ترفع المقطوعة مرة وتختارها في أي دعوة."""

    def setUp(self):
        super().setUp()
        self.track = MusicTrack.objects.create(
            name="زفة كلاسيك", external_url="https://cdn.example.com/a.mp3")

    def test_page_requires_staff(self):
        self.assertNotEqual(self.client.get("/dashboard/music/").status_code, 200)

    def test_page_lists_tracks(self):
        self.client.force_login(self.staff)
        self.assertIn("زفة كلاسيك", self.client.get("/dashboard/music/").content.decode())

    def test_track_needs_a_file_or_a_url(self):
        from system.forms import MusicTrackForm
        self.assertFalse(MusicTrackForm({"name": "بدون صوت", "order": 0}).is_valid())
        self.assertTrue(MusicTrackForm(
            {"name": "برابط", "external_url": "https://x.test/a.mp3", "order": 0}).is_valid())

    def test_library_reaches_the_editor(self):
        self.client.force_login(self.staff)
        body = self.client.get(
            f"/dashboard/invitations/{self.inv.pk}/editor/").content.decode()
        self.assertIn("editor-music", body)
        # json_script بيهرّب العربي لـ\\uXXXX، فبندوّر على الشكل ده مش على الحروف
        self.assertIn(r"\u0632\u0641\u0629", body)

    def test_hidden_tracks_do_not_reach_the_editor(self):
        MusicTrack.objects.update(is_active=False)
        self.client.force_login(self.staff)
        body = self.client.get(
            f"/dashboard/invitations/{self.inv.pk}/editor/").content.decode()
        self.assertIn('id="editor-music" type="application/json">[]', body)

    def test_deleting_a_track(self):
        self.client.force_login(self.staff)
        self.client.post("/dashboard/music/",
                         {"action": "delete", "track": self.track.pk})
        self.assertFalse(MusicTrack.objects.filter(pk=self.track.pk).exists())

    def test_music_url_field_is_an_audio_picker(self):
        """قبل كده كان حقل نص — المستخدم كان لازم يعرف رابط جاهز."""
        field = next(f for f in B.editor_schema()["settings_fields"]
                     if f["key"] == "music_url")
        self.assertEqual(field["type"], "media")
        self.assertEqual(field["media_kind"], "audio")


# ==========================================================================
class CssScopeTests(TestCase):
    """حصر CSS — ده حد أمان مش تجميل، فلازم يتغطّى بالتفصيل."""

    def scope(self, css, url_map=None):
        return cssscope.scope_css(css, "#b1", url_map)

    def test_plain_rule_is_scoped(self):
        self.assertEqual(self.scope(".t{color:red}"), "#b1 .t{color:red}")

    def test_page_wide_selectors_become_the_block(self):
        for sel in ("html", "body", ":root", "*"):
            self.assertEqual(self.scope(sel + "{margin:0}"), "#b1{margin:0}")

    def test_body_descendant_is_rebased(self):
        self.assertEqual(self.scope("body .t{color:red}"), "#b1 .t{color:red}")

    def test_duplicate_selectors_are_merged(self):
        self.assertEqual(self.scope("html, body{margin:0}"), "#b1{margin:0}")

    def test_media_query_contents_are_scoped(self):
        out = self.scope("@media (max-width:600px){.t{color:red}}")
        self.assertIn("@media (max-width:600px){#b1 .t{color:red}}", out)

    def test_keyframes_pass_through_unscoped(self):
        out = self.scope("@keyframes fade{from{opacity:0}to{opacity:1}}")
        self.assertIn("@keyframes fade{", out)
        self.assertNotIn("#b1 from", out)

    def test_import_is_dropped_without_eating_the_next_rule(self):
        """الخطأ ده بلع القاعدة اللي بعده لما اتكتب أول مرة."""
        out = self.scope('@import url("//evil.test/x.css");\nbody{margin:0}')
        self.assertNotIn("evil.test", out)
        self.assertIn("#b1{margin:0}", out)

    def test_dangerous_declarations_are_dropped(self):
        css = ".t{width:expression(alert(1));behavior:url(x.htc);-moz-binding:url(y);color:red}"
        out = self.scope(css)
        self.assertNotIn("expression", out)
        self.assertNotIn("behavior", out)
        self.assertNotIn("binding", out)
        self.assertIn("color:red", out)

    def test_fixed_becomes_absolute(self):
        """fixed بيهرب من القسم ويفضل معلّق فوق باقي الدعوة."""
        self.assertIn("position:absolute", self.scope(".t{position:fixed}"))

    def test_relative_urls_map_to_stored_assets(self):
        out = self.scope(".t{background:url(bg.jpg)}", {"bg.jpg": "/media/a/bg.webp"})
        self.assertIn('url("/media/a/bg.webp")', out)

    def test_unmapped_relative_url_is_neutralised(self):
        self.assertIn("none", self.scope(".t{background:url(ghost.jpg)}"))

    def test_absolute_paths_survive_a_second_pass(self):
        """الحصر بيتعمل وقت العرض على CSS اتحلّت روابطه وقت الاستيراد."""
        once = self.scope(".t{background:url(bg.jpg)}", {"bg.jpg": "/media/a/bg.webp"})
        twice = cssscope.scope_css(once.replace("#b1 ", ""), "#b1")
        self.assertIn("/media/a/bg.webp", twice)

    def test_unbalanced_braces_do_not_crash(self):
        self.assertIsInstance(self.scope(".a{color:red}}}.b{color:blue"), str)


# ==========================================================================
class TemplateImportTests(TestCase):
    """استيراد قالب من ملف — الملف جاي من بره فالأمان أهم بند."""

    def _zip(self, files: dict):
        import io as _io, zipfile
        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                z.writestr(name, data)
        return SimpleUploadedFile("t.zip", buf.getvalue(), "application/zip")

    PAGE = """<!doctype html><html><head><title>عمر و ياسمين</title>
      <link rel="stylesheet" href="s.css"><script src="x.js"></script>
      <style>.hero h1{font-size:64px}</style></head>
      <body onload="track()">
        <header class="hero"><h1>عمر و ياسمين</h1>
          <p>يتشرفان بدعوتكم لحضور حفل زفافهما بقاعة الماسة</p></header>
        <section class="story"><h2>قصتنا</h2>
          <p>اتقابلنا في الجامعة سنة ألفين وتسعتاشر وكمّلنا مع بعض من ساعتها.</p>
          <script>steal()</script></section>
      </body></html>"""
    CSS = "body{background:#111}.hero{min-height:100vh}"

    def test_plain_html_file_imports(self):
        up = SimpleUploadedFile("t.html", self.PAGE.encode(), "text/html")
        tpl = templateimport.import_template(up)
        self.assertEqual(len(tpl.document["blocks"]), 2)
        self.assertEqual(tpl.source, "import")

    def test_title_is_used_as_the_name(self):
        up = SimpleUploadedFile("t.html", self.PAGE.encode(), "text/html")
        self.assertEqual(templateimport.import_template(up).name, "عمر و ياسمين")

    def test_explicit_name_wins(self):
        up = SimpleUploadedFile("t.html", self.PAGE.encode(), "text/html")
        self.assertEqual(templateimport.import_template(up, name="اسمي").name, "اسمي")

    def test_scripts_and_handlers_are_stripped(self):
        up = SimpleUploadedFile("t.html", self.PAGE.encode(), "text/html")
        tpl = templateimport.import_template(up)
        blob = json.dumps(tpl.document, ensure_ascii=False)
        self.assertNotIn("steal", blob)
        self.assertNotIn("onload", blob)
        self.assertNotIn("<script", blob)

    def test_linked_stylesheet_is_picked_up(self):
        tpl = templateimport.import_template(
            self._zip({"index.html": self.PAGE, "s.css": self.CSS}))
        self.assertIn("min-height:100vh", tpl.document["blocks"][0]["props"]["css"])

    def test_stored_css_is_scoped_when_rendered(self):
        tpl = templateimport.import_template(
            self._zip({"index.html": self.PAGE, "s.css": self.CSS}))
        html = render_document(tpl.document, invitation=None, request=None,
                               allowed_features=None, editable=False)["html"]
        bid = tpl.document["blocks"][0]["id"]
        self.assertIn(f"#{bid}", html)
        # body{} اللي كان بيصبغ الصفحة كلها بقى على القسم نفسه
        self.assertNotIn("body{background", html.replace(" ", ""))

    def test_images_are_stored_and_relinked(self):
        from PIL import Image
        import io as _io
        buf = _io.BytesIO()
        Image.new("RGB", (900, 600), (1, 2, 3)).save(buf, "PNG")
        target = "<h1>عمر و ياسمين</h1>"
        self.assertIn(target, self.PAGE)      # لو الفيكستشر اتغيّر، نعرف فوراً
        page = self.PAGE.replace(target, target + '<img src="p.png" alt="">')
        tpl = templateimport.import_template(
            self._zip({"index.html": page, "p.png": buf.getvalue()}))
        blob = json.dumps(tpl.document)
        self.assertIn("/media/", blob)
        self.assertNotIn('src="p.png"', blob)
        self.assertTrue(Asset.objects.filter(invitation__isnull=True).exists())

    # ---- الأمان
    def test_path_traversal_members_are_ignored(self):
        up = self._zip({"../../../etc/passwd.html": "<body><p>x</p></body>",
                        "index.html": self.PAGE})
        tpl = templateimport.import_template(up)
        self.assertIn("عمر", json.dumps(tpl.document, ensure_ascii=False))

    def test_absolute_path_member_is_ignored(self):
        main, files = templateimport.parse_upload(
            self._zip({"/etc/x.html": "<body><p>x</p></body>", "index.html": self.PAGE}))
        self.assertNotIn("/etc/x.html", files)

    def test_executable_members_are_dropped(self):
        _, files = templateimport.parse_upload(
            self._zip({"index.html": self.PAGE, "x.js": "steal()",
                       "x.php": "<?php ?>", "x.exe": "MZ"}))
        self.assertEqual(set(files), {"index.html"})

    def test_zip_bomb_is_refused(self):
        bomb = self._zip({"index.html": self.PAGE, "big.css": "a" * (30 * 1024 * 1024)})
        with self.assertRaises(templateimport.ImportError_):
            templateimport.parse_upload(bomb)

    def test_archive_without_html_is_refused(self):
        with self.assertRaises(templateimport.ImportError_):
            templateimport.parse_upload(self._zip({"a.css": "x{}"}))

    def test_broken_zip_is_refused(self):
        up = SimpleUploadedFile("t.zip", b"PK\x03\x04 garbage", "application/zip")
        with self.assertRaises(templateimport.ImportError_):
            templateimport.parse_upload(up)

    def test_wrong_extension_is_refused(self):
        with self.assertRaises(templateimport.ImportError_):
            templateimport.parse_upload(
                SimpleUploadedFile("a.txt", b"hello", "text/plain"))

    def test_index_html_is_preferred_over_other_pages(self):
        main, _ = templateimport.parse_upload(self._zip({
            "pages/about.html": "<body><p>about</p></body>",
            "index.html": self.PAGE,
        }))
        self.assertEqual(main, "index.html")

    def test_slug_collision_gets_a_suffix(self):
        for _ in range(2):
            templateimport.import_template(
                SimpleUploadedFile("t.html", self.PAGE.encode(), "text/html"))
        slugs = list(Template.objects.filter(source="import").values_list("slug", flat=True))
        self.assertEqual(len(set(slugs)), len(slugs))


# ==========================================================================
class TemplateImportViewTests(BaseAppTest):
    def test_upload_requires_staff(self):
        self.assertNotEqual(self.client.get("/dashboard/templates/").status_code, 200)

    def test_upload_creates_a_template(self):
        self.client.force_login(self.staff)
        page = ("<html><head><title>Imported</title></head><body>"
                "<h1>عمر و ياسمين</h1>"
                "<p>يتشرفان بدعوتكم لحضور حفل زفافهما بقاعة الماسة يوم الجمعة</p>"
                "</body></html>").encode()
        res = self.client.post("/dashboard/templates/", {
            "template_file": SimpleUploadedFile("a.html", page, "text/html"),
        }, follow=True)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(Template.objects.filter(source="import").exists())

    def test_bad_upload_shows_an_arabic_error_not_a_500(self):
        self.client.force_login(self.staff)
        res = self.client.post("/dashboard/templates/", {
            "template_file": SimpleUploadedFile("a.txt", b"nope", "text/plain"),
        }, follow=True)
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Template.objects.filter(source="import").exists())


# ==========================================================================
class IntroLivePreviewTests(BaseAppTest):
    """الافتتاحية لازم تتحدّث لحظياً في المحرر.

    كانت مكتوبة جوّه render.html، والمحرر بيبدّل ‎.lb-stage‎ بس — والافتتاحية
    أخت للـstage مش جواه. فأي تعديل فيها ما كانش بيبان غير بعد ما تقفل
    المحرر وتفتحه تاني.
    """

    def _doc(self, **settings_):
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = True
        doc["settings"].update(settings_)
        return B.normalize_document(doc)

    def _preview(self, doc):
        self.client.force_login(self.staff)
        return self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/preview/",
            data=json.dumps({"document": doc}), content_type="application/json",
        ).json()

    def test_preview_returns_the_intro_separately(self):
        data = self._preview(self._doc(intro_text="أهلاً بيكم"))
        self.assertIn("intro", data)
        self.assertIn("lb-intro", data["intro"])
        self.assertIn("أهلاً بيكم", data["intro"])
        # مش المفروض تتكرر جوّه html بتاع الأقسام
        self.assertNotIn("lb-intro", data["html"])

    def test_editing_intro_text_changes_the_preview(self):
        first = self._preview(self._doc(intro_text="نص أول"))["intro"]
        second = self._preview(self._doc(intro_text="نص تاني"))["intro"]
        self.assertIn("نص أول", first)
        self.assertIn("نص تاني", second)
        self.assertNotIn("نص أول", second)

    def test_editing_the_button_label_changes_the_preview(self):
        out = self._preview(self._doc(intro_button="ادخل يا حبيبي"))["intro"]
        self.assertIn("ادخل يا حبيبي", out)

    def test_disabling_the_intro_returns_empty(self):
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = False
        self.assertEqual(self._preview(B.normalize_document(doc))["intro"], "")

    def test_intro_is_marked_editable_in_the_preview(self):
        out = self._preview(self._doc())["intro"]
        self.assertIn("data-intro-editable", out)

    def test_page_and_preview_render_the_same_intro_partial(self):
        """لو الاتنين ما استعملوش نفس الملف هيفرقوا مع الوقت."""
        self.inv.document = self._doc(intro_text="نص مشترك")
        self.inv.save(update_fields=["document"])
        page = self.client.get(self.inv.get_absolute_url()).content.decode()
        self.assertIn("نص مشترك", page)
        self.assertIn("نص مشترك", self._preview(self.inv.document)["intro"])


# ==========================================================================
class IntroSoundTests(BaseAppTest):
    """صوت فيديو الافتتاحية — المتصفح بيمنع الصوت التلقائي، فالزر هو الحل."""

    def _render(self, **settings_):
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = True
        doc["settings"].update(settings_)
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        return self.client.get(self.inv.get_absolute_url()).content.decode()

    def test_video_still_starts_muted(self):
        """مفيش متصفح بيسمح بالتشغيل التلقائي بصوت — لو شلنا muted الفيديو
        نفسه مش هيشتغل خالص."""
        body = self._render(intro_video="/media/x.mp4")
        self.assertIn("muted", body)
        self.assertIn("playsinline", body)

    def test_sound_button_appears_with_a_video(self):
        self.assertIn("data-intro-sound", self._render(intro_video="/media/x.mp4"))

    def test_sound_button_can_be_switched_off(self):
        body = self._render(intro_video="/media/x.mp4", intro_video_sound=False)
        self.assertNotIn("data-intro-sound", body)

    def test_no_sound_button_without_a_video(self):
        self.assertNotIn("data-intro-sound", self._render(intro_image="/media/x.webp"))

    def test_video_has_no_loop_so_it_can_open_on_end(self):
        """loop بيمنع حدث ended اللي بيفتح الدعوة لوحدها."""
        body = self._render(intro_video="/media/x.mp4")
        video_tag = body[body.index("<video"):body.index("</video>")]
        self.assertNotIn(" loop", video_tag)


# ==========================================================================
class TemplateHygieneTests(TestCase):
    """أخطاء قوالب بتعدّي من غير ما ترمي استثناء — بتظهر للمستخدم كنص."""

    def _templates(self):
        import os
        from django.conf import settings as dj
        root = dj.BASE_DIR / "templates"
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                if name.endswith(".html"):
                    path = os.path.join(dirpath, name)
                    yield path, open(path, encoding="utf-8").read()

    def test_no_multiline_hash_comments(self):
        """‎{# #}‎ في Django بيشتغل على سطر واحد بس.

        تعليق ممتد على سطرين مابيرميش خطأ — بيتطبع على الصفحة كنص عادي
        قدام المستخدم. حصل مرتين في المشروع ده، فبقى ليه اختبار.
        """
        bad = []
        for path, body in self._templates():
            for i, line in enumerate(body.splitlines(), 1):
                if "{#" in line and "#}" not in line.split("{#", 1)[1]:
                    bad.append(f"{path}:{i}")
        self.assertEqual(bad, [], "تعليق {# #} ممتد على أكتر من سطر: " + ", ".join(bad))

    def test_every_template_loads(self):
        """لو حد نسي {% load %} الصفحة بتقع وقت العرض مش وقت الفحص."""
        from django.template.loader import get_template
        from django.conf import settings as dj
        root = dj.BASE_DIR / "templates"
        for path, _ in self._templates():
            rel = str(path).replace(str(root) + "/", "")
            with self.subTest(template=rel):
                get_template(rel)


# ==========================================================================
class EmptyImportTests(TestCase):
    """قالب مستورد فاضي لازم يترفض بسبب واضح مش يتحفظ ويكتشفه المستخدم."""

    def _zip(self, files):
        import io as _io, zipfile
        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for n, d in files.items():
                z.writestr(n, d)
        return SimpleUploadedFile("t.zip", buf.getvalue(), "application/zip")

    SPA = ('<html><head><title>Site</title></head><body>'
           '<div id="__next"></div><script src="js/main.js"></script></body></html>')

    def test_javascript_built_page_is_refused_with_a_reason(self):
        with self.assertRaises(templateimport.ImportError_) as cm:
            templateimport.build_document(
                *templateimport.parse_upload(self._zip({"index.html": self.SPA})))
        self.assertIn("جافاسكربت", str(cm.exception))

    def test_nothing_is_saved_when_the_page_is_empty(self):
        before = Template.objects.count()
        with self.assertRaises(templateimport.ImportError_):
            templateimport.import_template(
                SimpleUploadedFile("a.html", self.SPA.encode(), "text/html"))
        self.assertEqual(Template.objects.count(), before)

    def test_loading_placeholder_is_still_treated_as_empty(self):
        """«جاري التحميل…» مش محتوى — ده نص مؤقت بيستبدله جافاسكربت."""
        page = self.SPA.replace('id="__next"></div>', 'id="__next">جاري التحميل…</div>')
        with self.assertRaises(templateimport.ImportError_):
            templateimport.build_document(
                *templateimport.parse_upload(self._zip({"index.html": page})))

    def test_a_real_page_still_imports(self):
        page = ("<html><head><title>عمر و ياسمين</title></head><body>"
                "<header><h1>عمر و ياسمين</h1>"
                "<p>يتشرفان بدعوتكم لحضور حفل زفافهما بقاعة الماسة</p></header>"
                "<section><h2>الموعد</h2>"
                "<p>الجمعة ٢٤ أكتوبر ٢٠٢٦ الساعة الثامنة مساءً</p></section>"
                "</body></html>")
        tpl = templateimport.import_template(
            SimpleUploadedFile("a.html", page.encode(), "text/html"))
        self.assertEqual(len(tpl.document["blocks"]), 2)

    def test_html_without_a_body_tag_still_imports(self):
        """قصاصات كتير مالهاش <body> — كانت بتترفض غلط."""
        page = ('<div class="hero"><h1>عمر و ياسمين</h1>'
                "<p>يتشرفان بدعوتكم لحضور حفل زفافهما في قاعة الماسة</p></div>")
        tpl = templateimport.import_template(
            SimpleUploadedFile("a.html", page.encode(), "text/html"))
        self.assertGreaterEqual(len(tpl.document["blocks"]), 1)


# ==========================================================================
class TemplateManageTests(BaseAppTest):
    """حذف/إخفاء القوالب من اللوحة — من غيرهم القالب الفاضي مالوش مخرج."""

    def _tpl(self, **kw):
        base = dict(name="مؤقت", slug="temp-x", category="classic",
                    source="import", document={"version": 1, "blocks": []})
        base.update(kw)
        return Template.objects.create(**base)

    def test_delete_removes_an_unused_template(self):
        tpl = self._tpl()
        self.client.force_login(self.staff)
        self.client.post("/dashboard/templates/",
                         {"action": "delete", "template": tpl.pk})
        self.assertFalse(Template.objects.filter(pk=tpl.pk).exists())

    def test_a_used_template_is_not_deleted(self):
        """الحذف هيسيب دعوات بغير قالب — بنمنعه ونقترح الإخفاء."""
        self.client.force_login(self.staff)
        res = self.client.post("/dashboard/templates/",
                               {"action": "delete", "template": self.template.pk},
                               follow=True)
        self.assertTrue(Template.objects.filter(pk=self.template.pk).exists())
        self.assertIn("اخفيه", res.content.decode())

    def test_toggle_hides_and_shows(self):
        tpl = self._tpl(is_active=True)
        self.client.force_login(self.staff)
        self.client.post("/dashboard/templates/",
                         {"action": "toggle", "template": tpl.pk})
        tpl.refresh_from_db()
        self.assertFalse(tpl.is_active)

    def test_delete_requires_staff(self):
        """غير مسجّل = تحويل لصفحة الدخول، والقالب مايتحذفش."""
        tpl = self._tpl()
        res = self.client.post("/dashboard/templates/",
                               {"action": "delete", "template": tpl.pk})
        self.assertIn("/login", res.get("Location", ""))
        self.assertTrue(Template.objects.filter(pk=tpl.pk).exists())


# ==========================================================================
class ImportedAudioTests(TestCase):
    """قوالب الدعوات بتيجي ومعاها ملف موسيقى — ما نتجاهلوش."""

    def _zip(self, files):
        import io as _io, zipfile
        buf = _io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for n, d in files.items():
                z.writestr(n, d)
        return SimpleUploadedFile("t.zip", buf.getvalue(), "application/zip")

    PAGE = ("<html><head><title>حفل</title></head><body>"
            "<h1>محمد و فرح</h1>"
            "<p>يتشرفان بدعوتكم لحضور حفل زفافهما في قاعة الياسمين</p>"
            "</body></html>")

    def test_audio_lands_in_the_music_library(self):
        before = MusicTrack.objects.count()
        templateimport.import_template(
            self._zip({"index.html": self.PAGE, "media/Music.mp3": b"ID3fake"}),
            name="قالب بموسيقى")
        self.assertEqual(MusicTrack.objects.count(), before + 1)
        track = MusicTrack.objects.latest("id")
        self.assertIn("قالب بموسيقى", track.name)
        self.assertTrue(track.url)

    def test_template_without_audio_adds_nothing(self):
        before = MusicTrack.objects.count()
        templateimport.import_template(self._zip({"index.html": self.PAGE}))
        self.assertEqual(MusicTrack.objects.count(), before)

    def test_audio_does_not_become_a_block(self):
        """الملف الصوتي أصل مستقل — مش قسم في الدعوة."""
        tpl = templateimport.import_template(
            self._zip({"index.html": self.PAGE, "media/x.mp3": b"ID3fake"}))
        self.assertNotIn(".mp3", json.dumps(tpl.document))
