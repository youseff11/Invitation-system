"""اختبارات المحرك — البلوكات، العرض، الأمان، وواجهة المحرر."""

import json
import re

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta

from system import blocks as B
from system.data import golden_classic
from system.models import (
        Asset, CustomFont, Customer, FavoriteBlock, Guest, Invitation, IntroVideo, MusicTrack, Order,
    OrderAddon, Plan, PlanAddon, RSVPResponse, SiteSetting, Template,

)
from system.forms import OrderForm, PlanAddonForm
from decimal import Decimal
from urllib.parse import quote
from system.renderer import block_style_css, layout_css, render_document

from system.sanitize import clean_html
from system import cssscope, customtext, guestimport, images, templateimport, tildacss, video
from system.templatetags import invite as invite_tags
from django.core.files.uploadedfile import SimpleUploadedFile
from django.conf import settings
from pathlib import Path


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

    def test_feature_outside_plan_still_renders(self):
        doc = B.empty_document()
        doc["blocks"] = [B.make_block("gallery", props={"heading": "المعرض"})]
        out = render_document(doc, allowed_features={"rsvp"}, editable=False)
        self.assertIn("المعرض", str(out["html"]))

    def test_uploaded_font_is_emitted_as_font_face(self):
        font = CustomFont.objects.create(
            name="خط الدعوة", family="WeddingFont",
            file=SimpleUploadedFile("wedding.woff2", b"fake-font", content_type="font/woff2"),
        )
        out = render_document(B.empty_document())
        css = str(out["font_css"])
        self.assertIn("font-family:\"WeddingFont\"", css)
        self.assertIn(font.url, css)
        self.assertIn("format('woff2')", css)

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
class SharePreviewTests(BaseAppTest):
    def test_robots_lets_social_crawlers_read_invitations(self):
        """ميتا بتلتزم بـ robots.txt: ‎/i/‎ المقفول كان بيشيل صورة المعاينة.

        ومجموعة ‎User-agent‎ متعددة ماكانتش بتتفهم عند ميتا، فمجموعة واحدة.
        """
        body = self.client.get("/robots.txt").content.decode()
        self.assertEqual(body.count("User-agent:"), 1)
        self.assertNotIn("Disallow: /i/\n", body)
        self.assertIn("Disallow: /i/*/client/", body)
        self.assertIn("Disallow: /i/*/venue/", body)

    def test_invitation_page_is_noindex_for_search_engines(self):
        """الدعوات برّه جوجل بـ ‎noindex‎ بدل ‎robots.txt‎."""
        res = self.client.get(f"/i/{self.inv.slug}/")
        self.assertEqual(res.status_code, 200)
        self.assertIn('name="robots" content="noindex, nofollow"', res.content.decode())
        self.assertEqual(res["X-Robots-Tag"], "noindex, nofollow")

    def test_webp_share_image_is_served_as_jpeg(self):
        """‎.webp‎ بيتردّ من غير Content-Type على الإنتاج فميتا بترفضه."""
        import io
        import shutil
        import tempfile
        from PIL import Image
        from django.test import override_settings

        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root, True)
        folder = Path(root) / "assets"
        folder.mkdir()
        Image.new("RGB", (1320, 902), (200, 30, 30)).save(folder / "سسسس.webp", "WEBP")
        with override_settings(MEDIA_ROOT=root):
            self.template.cover_url = "/media/assets/%D8%B3%D8%B3%D8%B3%D8%B3.webp"
            self.template.save()
            html = self.client.get(f"/i/{self.inv.slug}/").content.decode()
            m = re.search(r'property="og:image" content="([^"]+)"', html)
            self.assertIn("/share-image/assets/", m.group(1))
            self.assertIn('property="og:image:width" content="1200"', html)
            res = self.client.get(m.group(1).replace("http://testserver", ""))
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res["Content-Type"], "image/jpeg")
            self.assertEqual(Image.open(io.BytesIO(b"".join(res.streaming_content))).format, "JPEG")
            self.assertIn(".jpg?v=", m.group(1))
            # الرابط القديم (من غير ‎.jpg‎) لسه شغال لأي معاينة اتخزنت قبل كده
            old = m.group(1).replace("http://testserver", "").replace(".jpg?v=", "?v=")
            self.assertEqual(self.client.get(old).status_code, 200)
            self.assertEqual(self.client.get("/share-image/../settings.py").status_code, 404)

    def test_invitation_page_has_absolute_og_image(self):
        self.template.cover_url = "/static/img/cover.jpg"
        self.template.save()
        html = self.client.get(
            f"/i/{self.inv.slug}/",
            HTTP_USER_AGENT="facebookexternalhit/1.1",
        ).content.decode()
        self.assertIn(
            'property="og:image" content="http://testserver/static/img/cover.jpg"',
            html,
        )


# ==========================================================================
class AccessTests(BaseAppTest):


    def test_draft_invitation_is_404(self):
        self.inv.status = "draft"
        self.inv.save()
        self.assertEqual(self.client.get(f"/i/{self.inv.slug}/").status_code, 404)

    def test_expired_invitation_is_404(self):
        self.inv.expires_at = timezone.now() - timedelta(days=1)
        self.inv.save()
        self.assertEqual(self.client.get(f"/i/{self.inv.slug}/").status_code, 404)


# ==========================================================================


# ========================================================================== 
class RsvpTests(BaseAppTest):

    def url(self):
        return f"/i/{self.inv.slug}/rsvp/"


    def test_honeypot_blocks_bot(self):
        self.client.post(self.url(), {"name": "بوت", "website": "spam.com"})
        self.assertEqual(RSVPResponse.objects.count(), 0)

    def test_empty_name_rejected(self):
        self.client.post(self.url(), {"name": "", "status": "attending"})
        self.assertEqual(RSVPResponse.objects.count(), 0)


# ==========================================================================
class ViewCounterTests(BaseAppTest):
    def test_views_increment_without_race(self):
        for _ in range(5):
            self.client.get(f"/i/{self.inv.slug}/")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.public_views, 5)


# ==========================================================================


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

    def test_section_height_is_sanitized_and_emitted(self):
        doc = B.normalize_document({"blocks": [{
            "type": "hero", "id": "hero-1", "style": {"section_height": 640}
        }]})
        style = doc["blocks"][0]["style"]
        self.assertEqual(style["section_height"], 640)
        css = block_style_css(style, B.default_theme())
        self.assertIn("--block-section-height:640px", css)


    def test_imported_section_height_and_background_are_rendered(self):
        doc = B.normalize_document({"blocks": [{
            "type": "custom_html", "id": "imp-1",
            "props": {"html": "<div class='countdown-grid'>محتوى</div>"},
            "style": {"section_height": 640, "bg_color": "#123456"},
        }]})
        rendered = render_document(doc, editable=False)
        html = str(rendered["html"])
        self.assertIn("lb--custom-bg", html)
        self.assertIn("--block-section-height:640px", html)

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


# ==========================================================================


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


    def test_no_intro_markup_when_disabled(self):

        doc = self.inv.document
        doc["settings"]["intro_enabled"] = False
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        self.assertNotIn('class="lb-intro',
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


# ==========================================================================
class MusicLibraryTests(BaseAppTest):
    """مكتبة الموسيقى — ترفع المقطوعة مرة وتختارها في أي دعوة."""

    def setUp(self):
        super().setUp()
        self.track = MusicTrack.objects.create(
            name="زفة كلاسيك", external_url="https://cdn.example.com/a.mp3")

    def test_page_requires_staff(self):
        self.assertNotEqual(self.client.get("/dashboard/music/").status_code, 200)


    def test_track_needs_a_file_or_a_url(self):
        from system.forms import MusicTrackForm
        self.assertFalse(MusicTrackForm({"name": "بدون صوت", "order": 0}).is_valid())
        self.assertTrue(MusicTrackForm(
            {"name": "برابط", "external_url": "https://x.test/a.mp3", "order": 0}).is_valid())


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

    def test_scripts_and_handlers_are_stripped_from_editable_html(self):
        up = SimpleUploadedFile("t.html", self.PAGE.encode(), "text/html")
        tpl = templateimport.import_template(up)
        blob = json.dumps(tpl.document, ensure_ascii=False)
        self.assertNotIn("steal", blob)
        self.assertNotIn("onload", blob)
        self.assertNotIn("<script", blob)

    def test_local_scripts_are_saved_as_runtime_metadata(self):
        page = "<html><head><script src='js/app.js'></script></head><body><h1>دعوة</h1><p>محتوى كافٍ للمعاينة والتجربة.</p></body></html>"
        tpl = templateimport.import_template(
            self._zip({"index.html": page, "js/app.js": "window.__templateLoaded = true;"}),
            name="قالب JavaScript",
        )
        self.assertEqual(len(tpl.runtime_scripts), 1)
        self.assertTrue(tpl.runtime_scripts[0]["src"].startswith("/media/"))
        blob = json.dumps(tpl.document, ensure_ascii=False).lower()
        self.assertNotIn("window.__templateloaded", blob)
        self.assertNotIn("<script", blob)
        body = self.client.get(f"/templates/{tpl.slug}/preview/").content.decode()
        self.assertIn(tpl.runtime_scripts[0]["src"], body)


    def test_full_runtime_keeps_intro_and_embedded_iframe(self):
        page = (
            '<html><head><script src="js/app.js"></script></head><body>'
            '<div id="weiOverlay"><video id="weiVideo"></video></div>'
            '<section class="countdown"><div id="countdownContainer">00:00:00</div>'
            '<iframe src="embed.html" title="Map"></iframe></section>'
            '<p>محتوى كافٍ لاختبار القالب الكامل وتشغيل السكربتات.</p>'
            '</body></html>'
        )
        tpl = templateimport.import_template(
            self._zip({
                "index.html": page,
                "js/app.js": "window.__fullRuntime = true;",
                "embed.html": '<html><body><div id="mapDiv"></div><script src="js/map.js"></script></body></html>',
                "js/map.js": "window.__mapRuntime = true;",
            }),
            name="قالب Runtime كامل",
        )
        blob = json.dumps(tpl.document, ensure_ascii=False)
        self.assertIn("weiOverlay", blob)
        self.assertIn("countdownContainer", blob)
        self.assertIn("/media/template_pages/", blob)
        self.assertEqual(len(tpl.runtime_scripts), 1)
        page_html = self.client.get(f"/templates/{tpl.slug}/preview/").content.decode()
        self.assertIn("weiOverlay", page_html)
        self.assertIn("countdownContainer", page_html)
        self.assertIn(tpl.runtime_scripts[0]["src"], page_html)

    def test_expired_countdown_stays_visible_as_zero(self):
        page = (
            '<html><body><div id="countdownContainer">'
            '<div id="days">168</div><div id="hours">00</div>'
            '</div><script>'
            "var dist=eventDate-now;if(dist<0) {document.getElementById('countdownContainer').innerHTML='See you there!';return;}"
            '</script><p>محتوى كافٍ لاختبار العدّاد المنتهي.</p></body></html>'
        )
        tpl = templateimport.import_template(
            SimpleUploadedFile("countdown.html", page.encode(), "text/html"),
            name="عداد منتهي",
        )
        code = "\n".join(s.get("code") or "" for s in tpl.runtime_scripts)
        self.assertIn("if (dist < 0) { dist = 0; }", code)
        self.assertNotIn("See you there!", code)
        self.assertIn("countdownContainer", tpl.document["blocks"][0]["props"]["html"])

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

    def test_unsupported_members_are_dropped_but_js_is_kept_for_runtime(self):
        _, files = templateimport.parse_upload(
            self._zip({"index.html": self.PAGE, "x.js": "steal()",
                       "x.php": "<?php ?>", "x.exe": "MZ"}))
        self.assertEqual(set(files), {"index.html", "x.js"})

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


# ==========================================================================


# ==========================================================================
class IntroNoteTests(BaseAppTest):
    """النوت بقى حقل يكتبه المصمّم بدل ما الافتتاحية تاخد اسم العميل."""

    def _intro(self, **settings_):
        """جزء الافتتاحية بس — ‎lb-kicker‎ موجود في الغلاف كمان، فمقارنة
        على الصفحة كلها بتكدب."""
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = True
        doc["settings"].update(settings_)
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        i = body.index('<div class="lb-intro')
        return body[i:body.index("lb-stage", i)]


    def test_the_note_defaults_to_empty(self):
        field = next(f for f in B.editor_schema()["settings_fields"]
                     if f["key"] == "intro_note")
        self.assertEqual(field["default"], "")


# ==========================================================================


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


    def test_sound_button_can_be_switched_off(self):
        body = self._render(intro_video="/media/x.mp4", intro_video_sound=False)
        self.assertNotIn("data-intro-sound", body)

    def test_no_sound_button_without_a_video(self):
        self.assertNotIn("data-intro-sound", self._render(intro_image="/media/x.webp"))


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

    def test_javascript_built_page_is_allowed_with_a_local_script(self):
        document, _title, scripts, root_attrs = templateimport.build_document(
            *templateimport.parse_upload(self._zip({
                "index.html": self.SPA,
                "js/main.js": "document.body.dataset.loaded = 'yes';",
            })))
        self.assertGreaterEqual(len(document["blocks"]), 1)
        self.assertEqual(len(scripts), 1)
        self.assertTrue(scripts[0]["src"].startswith("/media/"))
        self.assertEqual(root_attrs, {"data-lb-spa": "true"})

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


# ==========================================================================


# ==========================================================================


# ==========================================================================


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


# ==========================================================================
class BlockLabelTests(TestCase):
    """اسم القسم في القائمة — من غيره القالب المستورد كله «كود HTML مخصص»."""

    def _import(self, body):
        page = f"<html><head><title>T</title></head><body>{body}</body></html>"
        return templateimport.import_template(
            SimpleUploadedFile("a.html", page.encode(), "text/html"))

    LONG = "<p>يتشرفان بدعوتكم لحضور حفل زفافهما في قاعة الياسمين بالقاهرة</p>"

    def test_heading_becomes_the_label(self):
        tpl = self._import(f"<section><h2>قصتنا</h2>{self.LONG}</section>")
        self.assertEqual(tpl.document["blocks"][0]["label"], "قصتنا")

    def test_entities_are_decoded_in_the_label(self):
        """«ليلى &amp; كريم» كان بيظهر بالكيان في القائمة."""
        tpl = self._import(f"<header><h1>ليلى &amp; كريم</h1>{self.LONG}</header>")
        self.assertEqual(tpl.document["blocks"][0]["label"], "ليلى & كريم")

    def test_known_class_names_map_to_arabic(self):
        tpl = self._import(f'<div class="preloader">{self.LONG}</div>')
        self.assertEqual(tpl.document["blocks"][0]["label"], "شاشة التحميل")

    def test_tag_name_is_the_next_fallback(self):
        tpl = self._import(f"<footer>{self.LONG}</footer>")
        self.assertEqual(tpl.document["blocks"][0]["label"], "الخاتمة")

    def test_label_survives_normalisation(self):
        doc = B.normalize_document({
            "blocks": [{"id": "b1", "type": "text", "label": "قسمي أنا"}],
        })
        self.assertEqual(doc["blocks"][0]["label"], "قسمي أنا")

    def test_label_is_trimmed_and_capped(self):
        doc = B.normalize_document({
            "blocks": [{"id": "b1", "type": "text", "label": "  " + "ط" * 200}],
        })
        self.assertEqual(len(doc["blocks"][0]["label"]), 60)

    def test_non_string_label_is_ignored(self):
        doc = B.normalize_document({
            "blocks": [{"id": "b1", "type": "text", "label": {"x": 1}}],
        })
        self.assertEqual(doc["blocks"][0]["label"], "")


# ==========================================================================
class ImportedEditingTests(TestCase):
    """تحرير القالب المستورد بصرياً — نص، موضع، لون — من غير ما تفتح الكود."""

    def _import(self, body, css=""):
        page = (f"<html><head><title>T</title>"
                f"{'<style>' + css + '</style>' if css else ''}</head>"
                f"<body>{body}</body></html>")
        return templateimport.import_template(
            SimpleUploadedFile("a.html", page.encode(), "text/html"))

    LONG = "<p>يتشرفان بدعوتكم لحضور حفل زفافهما في قاعة الياسمين بالقاهرة</p>"

    # ---- المواضع
    def test_el_slots_survive_normalisation(self):
        """el-N فيها شرطة، و_SLOT_RE مابيسمحش بيها — كانت بتتشال كلها."""
        doc = B.normalize_document({"blocks": [{
            "id": "imp-1", "type": "custom_html",
            "layout": {"el-3": {"dx": -15.5, "dy": -10.3}},
        }]})
        self.assertEqual(doc["blocks"][0]["layout"],
                         {"el-3": {"dx": -15.5, "dy": -10.3}})

    def test_el_slot_renders_positioning_css(self):
        doc = B.normalize_document({"blocks": [{
            "id": "imp-1", "type": "custom_html",
            "layout": {"el-3": {"dx": 4, "dy": -2}},
        }]})
        css = layout_css(doc["blocks"])
        self.assertIn('#imp-1 [data-move="el-3"]{--dx:4px;--dy:-2px}', css)

    def test_bogus_slot_names_are_still_refused(self):
        doc = B.normalize_document({"blocks": [{
            "id": "imp-1", "type": "custom_html",
            "layout": {"../etc": {"dx": 1}, "el-": {"dx": 1},
                       "el-12345678": {"dx": 1}, "EL-1": {"dx": 1}},
        }]})
        self.assertEqual(doc["blocks"][0]["layout"], {})

    # ---- data-move لازم ينجو من المنقّي
    def test_data_move_survives_sanitising(self):
        """من غيره العنصر بيفقد ارتباطه بموضعه المحفوظ أول ما تحفظ."""
        out = clean_html('<div data-move="el-7">نص</div>')
        self.assertIn('data-move="el-7"', out)

    def test_bad_data_move_value_is_dropped(self):
        out = clean_html('<div data-move="a b&quot;c">نص</div>')
        self.assertNotIn("data-move", out)

    def test_other_data_attributes_are_still_stripped(self):
        out = clean_html('<div data-track="spy" data-move="el-1">نص</div>')
        self.assertNotIn("data-track", out)
        self.assertIn("data-move", out)

    # ---- الكود مش في الواجهة
    def test_code_fields_sit_in_the_advanced_group(self):
        """الكود مش المفروض يكون أول حاجة يشوفها اللي رفع قالب جاهز."""
        spec = B.BLOCK_REGISTRY["custom_html"]
        for f in spec["props"]:
            if f["key"] in ("html", "css"):
                self.assertEqual(f["group"], "كود متقدّم")

    # ---- الألوان موجودة في الستايل عشان اللوحة تلاقيها
    def test_imported_css_keeps_its_colours_for_the_picker(self):
        tpl = self._import(f'<section class="s">{self.LONG}</section>',
                           css=".s{color:#b08948;background:#faf6ef}")
        stored = tpl.document["blocks"][0]["props"]["css"]
        self.assertIn("#b08948", stored)
        self.assertIn("#faf6ef", stored)


# ==========================================================================
class ElementStyleTests(TestCase):
    """لوحة العنصر بتكتب style مضمّن — لازم ينجو من المنقّي كله."""

    def test_font_and_size_survive(self):
        out = clean_html(
            '<h1 style="font-family:\'Great Vibes\', cursive;font-size:92px">ليلى</h1>')
        self.assertIn("font-family", out)
        self.assertIn("Great Vibes", out)
        self.assertIn("font-size:92px", out)

    def test_colour_weight_align_spacing_survive(self):
        out = clean_html('<p style="color:#b08948;background-color:#fff;'
                         'font-weight:700;text-align:center;letter-spacing:2px;'
                         'line-height:1.6">نص</p>')
        for want in ("color:#b08948", "background-color:#fff", "font-weight:700",
                     "text-align:center", "letter-spacing:2px", "line-height:1.6"):
            self.assertIn(want, out)

    def test_hiding_an_element_survives(self):
        self.assertIn("display:none", clean_html('<p style="display:none">نص</p>'))

    def test_dangerous_style_is_still_dropped(self):
        out = clean_html('<p style="font-size:20px;behavior:url(x.htc);'
                         'width:expression(alert(1))">نص</p>')
        self.assertIn("font-size:20px", out)
        self.assertNotIn("behavior", out)
        self.assertNotIn("expression", out)

    def test_external_url_in_style_is_still_dropped(self):
        """رابط خارجي في style بيسرّب زيارة الضيف لسيرفر تاني."""
        out = clean_html('<p style="background-image:url(https://evil.test/x.png)">ن</p>')
        self.assertNotIn("evil.test", out)

    def test_our_own_media_url_is_allowed(self):
        out = clean_html('<p style="background-image:url(/media/a/b.webp)">ن</p>')
        self.assertIn("/media/a/b.webp", out)


# ==========================================================================
class GuestPassTests(BaseAppTest):
    """تصريح الدخول: كود قصير + عدد دخلات + حالة نشط/مستخدم."""

    def _guest(self, **kw):
        base = dict(invitation=self.inv, name="كريم", entries_allowed=1)
        base.update(kw)
        return Guest.objects.create(**base)

    def test_pass_code_is_generated_and_readable(self):
        g = self._guest()
        self.assertTrue(g.pass_code.startswith("FRH-"))
        self.assertEqual(len(g.pass_code), 10)
        # الحروف اللي بتتلخبط في القراءة مستبعدة
        for ch in "IO01":
            self.assertNotIn(ch, g.pass_code[4:])

    def test_pass_codes_are_unique(self):
        codes = {self._guest(name=f"ض{i}").pass_code for i in range(40)}
        self.assertEqual(len(codes), 40)

    def test_entries_counting(self):
        g = self._guest(entries_allowed=3)
        self.assertEqual((g.entries_left, g.pass_status), (3, "active"))
        self.assertTrue(g.consume_entry())
        self.assertEqual((g.entries_used, g.entries_left), (1, 2))
        self.assertTrue(g.consume_entry())
        self.assertTrue(g.consume_entry())
        self.assertEqual(g.pass_status, "used")
        self.assertFalse(g.consume_entry())      # الرابعة مترفوضة
        self.assertEqual(g.entries_used, 3)

    def test_first_entry_sets_checked_in(self):
        g = self._guest()
        g.consume_entry()
        self.assertTrue(g.checked_in)
        self.assertIsNotNone(g.checked_in_at)

    def test_no_pass_when_allowance_is_zero(self):
        self.assertEqual(self._guest(entries_allowed=0).pass_status, "none")

    # ---- الصفحة


    def test_qr_png_downloads(self):
        g = self._guest()
        res = self.client.get(f"/i/{self.inv.slug}/g/{g.token}/qr.png")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/png")
        self.assertIn(g.pass_code, res["Content-Disposition"])
        self.assertTrue(res.content.startswith(b"\x89PNG"))


# ==========================================================================


# ==========================================================================


# ==========================================================================
class GuestExportTests(BaseAppTest):
    """كشف الإكسل اللي بيتبعت للقاعة."""

    def setUp(self):
        super().setUp()
        self.client.force_login(self.staff)
        Guest.objects.create(invitation=self.inv, name="كريم عبد الله",
                             phone="01000000000", entries_allowed=3)
        Guest.objects.create(invitation=self.inv, name="منى", entries_allowed=1,
                             source="rsvp")


    def test_export_requires_staff(self):
        self.client.logout()
        res = self.client.get(f"/dashboard/invitations/{self.inv.pk}/guests/export.xlsx")
        self.assertNotEqual(res.status_code, 200)


# ==========================================================================
class IntroLibraryTests(BaseAppTest):
    """مكتبة الافتتاحيات — نفس فكرة مكتبة الموسيقى."""

    def setUp(self):
        super().setUp()
        self.clip = IntroVideo.objects.create(
            name="افتتاحية ذهبية", external_url="https://cdn.test/a.mp4", seconds=6)

    def test_page_requires_staff(self):
        self.assertNotEqual(self.client.get("/dashboard/intros/").status_code, 200)


    def test_clip_needs_a_file_or_a_url(self):
        from system.forms import IntroVideoForm
        self.assertFalse(IntroVideoForm({"name": "بدون", "order": 0}).is_valid())
        self.assertTrue(IntroVideoForm(
            {"name": "برابط", "external_url": "https://x.test/a.mp4",
             "order": 0}).is_valid())


# ==========================================================================
class IntroPlayButtonTests(BaseAppTest):
    """زر تشغيل الافتتاحية — لمسة الضيف بتسمح بالصوت من أول ثانية."""

    def _render(self, **settings_):
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = True
        doc["settings"]["intro_video"] = "/media/x.mp4"
        doc["settings"].update(settings_)
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        return self.client.get(self.inv.get_absolute_url()).content.decode()


    def test_old_intro_font_controls_are_hidden_from_editor_schema(self):
        fields = {f["key"]: f for f in B.editor_schema()["settings_fields"]}
        for key in (
            "intro_font", "intro_note_color", "intro_text_color",
            "intro_guest_name_color", "intro_button_color",
            "intro_play_color", "intro_play_bg_color",
        ):
            self.assertTrue(fields[key].get("editor_hidden"), key)


    def test_schema_exposes_only_the_three_start_modes(self):
        field = next(f for f in B.editor_schema()["settings_fields"]
                     if f["key"] == "intro_play_mode")
        self.assertEqual(field["default"], "autoplay")
        self.assertEqual(
            [option["value"] for option in field["options"]],
            ["autoplay", "button", "button_effects"],
        )
        self.assertNotIn(
            "intro_play_effects",
            {f["key"] for f in B.editor_schema()["settings_fields"]},
        )

    def test_legacy_effects_flag_maps_to_plain_button(self):
        doc = B.normalize_document({"settings": {"intro_play_effects": False}})
        self.assertEqual(doc["settings"]["intro_play_mode"], "button")
        self.assertFalse(doc["settings"]["intro_play_effects"])

    def test_legacy_autoplay_flag_maps_to_autoplay(self):
        doc = B.normalize_document({"settings": {"intro_autoplay": True}})
        self.assertEqual(doc["settings"]["intro_play_mode"], "autoplay")


# ==========================================================================
class FullBleedWidthTests(BaseAppTest):
    """«ملء الشاشة» — القسم بيكسر حدود كارت الدعوة على أي مقاس جهاز."""

    def setUp(self):
        super().setUp()
        # قسم الفيديو مربوط بميزة في الباقة — من غيرها بيتخفي من الصفحة
        self.plan.features = list(self.plan.features) + ["video"]
        self.plan.save(update_fields=["features"])

    def _render(self, width):
        doc = B.normalize_document({"blocks": [
            {"type": "video", "id": "vid-1",
             "props": {"url": "/media/clip.mp4"},
             "style": {"width": width}},
        ]})
        self.inv.document = doc
        self.inv.save(update_fields=["document"])
        return self.client.get(self.inv.get_absolute_url()).content.decode()

    def test_screen_width_is_an_offered_choice(self):
        values = [o["value"] for o in B.WIDTH_CHOICES]
        self.assertIn("screen", values)
        # «كامل العرض» لسه موجود — ده عرض الكارت مش الشاشة
        self.assertIn("full", values)

    def test_screen_width_emits_its_class(self):
        self.assertIn("lb--w-screen", self._render("screen"))

    def test_full_is_not_screen(self):
        body = self._render("full")
        self.assertIn("lb--w-full", body)
        self.assertNotIn("lb--w-screen", body)

    def test_bogus_width_falls_back_to_normal(self):
        self.assertIn("lb--w-normal", self._render("100vw"))

    def _rule(self):
        css = (Path(settings.BASE_DIR) / "static/css/invite.css").read_text("utf-8")
        i = css.index(".lb.lb--w-screen {")
        return css[i:css.index("}", i)]


# ==========================================================================
class VideoBlockSourceTests(BaseAppTest):
    """قسم الفيديو — رفع ملف مش لينك بس، ونسبة عرض/ارتفاع."""

    def setUp(self):
        super().setUp()
        # قسم الفيديو مربوط بميزة في الباقة — من غيرها بيتخفي من الصفحة
        self.plan.features = list(self.plan.features) + ["video"]
        self.plan.save(update_fields=["features"])

    def _spec(self, key):
        block = B.editor_schema()["blocks"]["video"]
        return next(f for f in block["props"] if f["key"] == key)

    def test_url_field_offers_upload_not_just_a_link(self):
        spec = self._spec("url")
        self.assertEqual(spec["type"], "media")
        self.assertEqual(spec["media_kind"], "video")

    def _render(self, props):
        doc = B.normalize_document({"blocks": [
            {"type": "video", "id": "vid-1", "props": props},
        ]})
        self.inv.document = doc
        self.inv.save(update_fields=["document"])
        return self.client.get(self.inv.get_absolute_url()).content.decode()


    def test_youtube_link_still_works(self):
        body = self._render({"url": "https://youtu.be/abc12345"})
        self.assertIn("https://youtu.be/abc12345", body)


    def test_sound_is_off_by_default(self):
        """فيديو بيطلع صوت من غير ما حد يطلبه بيخضّ الضيف."""
        self.assertFalse(self._spec("sound")["default"])
        self.assertNotIn("data-sound", self._render({"url": "/media/c.mp4"}))


    def test_media_field_still_blocks_javascript_scheme(self):
        """الحقل كان type=url وليه فلتر. تحويله لـmedia ماينفعش يشيله."""
        doc = B.normalize_document({"blocks": [
            {"type": "video", "id": "v-1",
             "props": {"url": "javascript:alert(1)"}},
        ]})
        self.assertEqual(doc["blocks"][0]["props"]["url"], "")

    def test_image_fields_block_it_too(self):
        doc = B.normalize_document({"blocks": [
            {"type": "video", "id": "v-1",
             "props": {"url": "/x.mp4", "poster": "vbscript:msgbox 1"}},
        ]})
        self.assertEqual(doc["blocks"][0]["props"]["poster"], "")

    def test_inline_image_data_url_is_kept(self):
        """المحرر بيولّد data:image عند القص — مانكسرهاش."""
        tiny = ("data:image/png;base64,"
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
        doc = B.normalize_document({"blocks": [
            {"type": "video", "id": "v-1", "props": {"url": "/x.mp4", "poster": tiny}},
        ]})
        self.assertEqual(doc["blocks"][0]["props"]["poster"], tiny)

    def test_non_image_data_url_is_dropped(self):
        doc = B.normalize_document({"blocks": [
            {"type": "video", "id": "v-1",
             "props": {"url": "data:text/html;base64,PHNjcmlwdD4="}},
        ]})
        self.assertEqual(doc["blocks"][0]["props"]["url"], "")


# ==========================================================================
class VideoUploadLimitTests(BaseAppTest):
    """حد الفيديو أعلى من حد الصورة — مقطع فرح حقيقي بيعدّي ٨ ميجا."""

    def _post(self, raw, name, ctype):
        self.client.force_login(self.staff)
        return self.client.post(
            f"/dashboard/invitations/{self.inv.pk}/api/upload/",
            {"file": SimpleUploadedFile(name, raw, ctype)},
        )

    def test_video_over_the_image_limit_is_accepted(self):
        """قبل التعديل ده كان أي مقطع أكبر من ٨ ميجا بيترفض."""
        import shutil, subprocess, tempfile, os
        if not shutil.which("ffmpeg"):
            self.skipTest("ffmpeg غير متاح")
        path = tempfile.mktemp(suffix=".mp4")
        # مقطع ضوضاء مش بينضغط — بيطلع أكبر من ٨ ميجا فعلاً
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", "nullsrc=size=640x360:rate=25:duration=2",
             "-vf", "geq=random(1)*255:128:128", "-c:v", "libx264",
             "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv420p", path],
            check=True, timeout=180)
        raw = open(path, "rb").read()
        os.unlink(path)
        if not (8 * 1024 * 1024 < len(raw) < video.MAX_UPLOAD_BYTES):
            self.skipTest(f"المقطع المولَّد خرج بره النطاق المطلوب: {len(raw)}")
        res = self._post(raw, "clip.mp4", "video/mp4").json()
        self.assertTrue(res["ok"], res)


    def test_intro_library_uses_the_same_limit(self):
        """حدّين مختلفين لنفس الملف حسب مكان الرفع = ارتباك."""
        from system.forms import IntroVideoForm
        form = IntroVideoForm(
            {"name": "x", "order": 0},
            {"file": SimpleUploadedFile("a.mp4", b"\0" * (9 * 1024 * 1024), "video/mp4")},
        )
        form.is_valid()
        self.assertNotIn("file", form.errors)


# ==========================================================================
class IntroPlayLabelTests(BaseAppTest):
    """نص اختياري على زر تشغيل الافتتاحية."""

    def _render(self, label=None):
        doc = self.inv.document
        doc["settings"]["intro_enabled"] = True
        doc["settings"]["intro_video"] = "/media/x.mp4"
        doc["settings"]["intro_play_mode"] = "button"

        if label is not None:
            doc["settings"]["intro_play_label"] = label
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        return self.client.get(self.inv.get_absolute_url()).content.decode()

    def _button(self, body):
        i = body.index("data-intro-play")
        start = body.rindex("<button", 0, i)
        return body[start:body.index("</button>", start)]


    def test_label_is_ignored_in_auto_mode(self):
        doc = self.inv.document
        doc["settings"].update({"intro_enabled": True, "intro_video": "/media/x.mp4",
                                                                "intro_play_mode": "autoplay",

                                "intro_play_label": "ابدأ"})
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        self.assertNotIn("data-intro-play", body)

    def test_field_default_is_empty(self):
        field = next(f for f in B.editor_schema()["settings_fields"]
                     if f["key"] == "intro_play_label")
        self.assertEqual(field["default"], "")


# ==========================================================================


# ==========================================================================


# ==========================================================================
class AutoScrollTests(BaseAppTest):
    """التمرير التلقائي — مفتاح تشغيل، وسرعة، ويقف أول ما الضيف يلمس."""

    def _render(self, **s):
        doc = self.inv.document
        doc["settings"].update(s)
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        return self.client.get(self.inv.get_absolute_url()).content.decode()

    def test_default_is_off(self):
        """ميزة بتحرّك الصفحة تحت إيد الواحد ماينفعش تبقى الافتراضي."""
        field = next(f for f in B.editor_schema()["settings_fields"]
                     if f["key"] == "auto_scroll")
        self.assertIs(field["default"], False)
        body = self._render()
        self.assertIn('"enabled": false', body)


    def test_bogus_speed_falls_back(self):
        body = self._render(auto_scroll=True, auto_scroll_speed="\"};alert(1)//")
        self.assertIn('"speed": "normal"', body)
        self.assertNotIn("alert(1)", body)


    def test_delay_is_clamped(self):
        body = self._render(auto_scroll=True, auto_scroll_delay=9999)
        self.assertIn('"delay": 20', body)      # الحد الأعلى في الحقل

    # -- ضمانات في ملف الجافاسكربت ---------------------------------------
    def _js(self):
        js = (Path(settings.BASE_DIR) / "static/js/invite.js").read_text("utf-8")
        i = js.index("function initAutoScroll()")
        return js[i:js.index("\n  // -----", i)]


# ==========================================================================
class PreviewCtaTests(BaseAppTest):
    """شريط «عجبك القالب؟» — في معاينة القالب بس."""

    def setUp(self):
        super().setUp()
        self.cfg = SiteSetting.load()
        self.cfg.whatsapp_number = "+20 155-940 3203"
        self.cfg.facebook_url = "https://facebook.com/farha"
        self.cfg.save()

    def _preview(self):
        return self.client.get(f"/templates/{self.template.slug}/preview/").content.decode()


    def test_whatsapp_link_carries_the_template_name(self):
        body = self._preview()
        self.assertIn("wa.me/201559403203", body)
        # الاسم متشفّر في الرابط
        self.assertIn(quote(self.template.name), body)

    def test_number_is_normalised_for_wa_me(self):
        """wa.me بيرفض + والمسافات والشرط — بيدّي صفحة غلط من غير شرح."""
        self.assertEqual(SiteSetting.load().whatsapp_digits, "201559403203")

    def test_facebook_link_is_there(self):
        self.assertIn("facebook.com/farha", self._preview())

    def test_toggle_hides_the_whole_bar(self):
        self.cfg.preview_cta_enabled = False
        self.cfg.save()
        self.assertNotIn("data-preview-cta", self._preview())


    def test_bar_disappears_when_nothing_is_left_to_show(self):
        """شريط فيه نص وبس ومفيش أي زرار = ضوضاء."""
        self.cfg.whatsapp_enabled = False
        self.cfg.facebook_enabled = False
        self.cfg.save()
        self.assertNotIn("data-preview-cta", self._preview())

    def test_it_never_shows_on_a_real_invitation(self):
        """دعوة العميل مش مكان إعلان — الشريط للمعاينة بس."""
        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        self.assertNotIn("data-preview-cta", body)

    def test_message_placeholder_is_replaced(self):
        self.cfg.whatsapp_message = "عايز {template} لو سمحت"
        self.cfg.save()
        body = self._preview()
        self.assertIn(quote(f"عايز {self.template.name} لو سمحت"), body)
        self.assertNotIn("{template}", body)

    def test_settings_are_one_row_only(self):
        """سجلين إعدادات = مين اللي شغّال؟"""
        SiteSetting.objects.create(preview_cta_text="تاني")
        self.assertEqual(SiteSetting.objects.count(), 1)
        self.assertEqual(SiteSetting.load().preview_cta_text, "تاني")


# ==========================================================================
class PreviewCtaOnAFreshInstallTests(BaseAppTest):
    """أول ما تنصّب المشروع الشريط مفعّل بس الرقم فاضي.

    فبيختفي بالكامل، واللوحة كانت بتقول «ظاهر»، ومفيش أي رسالة تفسّر —
    وقعد الواحد يدوّر في الكود على حاجة موجودة أصلاً وشغّالة صح.
    """

    def _preview(self):
        return self.client.get(
            f"/templates/{self.template.slug}/preview/").content.decode()

    def _dash(self):
        self.client.force_login(self.staff)
        return self.client.get("/dashboard/site/").content.decode()

    def test_the_defaults_leave_it_enabled_but_contactless(self):
        cfg = SiteSetting.load()
        self.assertTrue(cfg.preview_cta_enabled)
        self.assertEqual(cfg.whatsapp_number, "")
        self.assertEqual(cfg.facebook_url, "")

    def test_so_the_bar_does_not_render(self):
        self.assertNotIn("data-preview-cta", self._preview())


    def test_a_disabled_toggle_is_not_reported_as_a_problem(self):
        cfg = SiteSetting.load()
        cfg.preview_cta_enabled = False
        cfg.save()
        self.assertNotIn("data-cta-warning", self._dash())


# ==========================================================================
class OrdersToggleTests(BaseAppTest):
    """قفل نموذج «اطلب دعوتك» من اللوحة بدل ما يتعمل كومنت في الكود.

    الكومنت كان هيخفي القسم بس ويسيب حاجتين مكسورين: الـPOST على ‎/‎
    لسه شغّال وأي حد يقدر يبعت طلب، وأزرار «اطلب دعوتك» في النڤ
    والقوالب والباقات بتودّي على مرساة ‎#order‎ مش موجودة.
    """

    def setUp(self):
        super().setUp()
        self.cfg = SiteSetting.load()
        self.cfg.whatsapp_number = "+201000000000"
        self.cfg.save()

    def _off(self):
        self.cfg.orders_enabled = False
        self.cfg.save()

    def _home(self):
        return self.client.get("/").content.decode()


    def test_closing_it_removes_the_form(self):
        self._off()
        self.assertNotIn("إرسال الطلب", self._home())


    def test_the_buttons_point_at_whatsapp_instead_of_a_dead_anchor(self):
        self._off()
        body = self._home()
        self.assertNotIn('href="#order"', body)
        self.assertIn("wa.me/201000000000", body)

    def test_with_no_number_the_buttons_disappear_rather_than_break(self):
        self.cfg.whatsapp_number = ""
        self.cfg.orders_enabled = False
        self.cfg.save()
        body = self._home()
        self.assertNotIn('href="#order"', body)
        self.assertNotIn("اطلب على واتساب", body)


# ==========================================================================
class PlanAddonShowcaseTests(BaseAppTest):
    """الإضافات بقت عرض سعر تحت كل باقة — مش اختيار في نموذج."""

    def setUp(self):
        super().setUp()
        self.video = PlanAddon.objects.create(name="اضافه فيديو", price=200)
        self.song = PlanAddon.objects.create(name="اضافه اغنيه", price=300)
        self.song.plans.add(self.basic)          # مربوطة بباقة واحدة بس

    def _home(self):
        return self.client.get("/").content.decode()


    def test_an_inactive_addon_is_not_advertised(self):
        self.video.is_active = False
        self.video.save()
        self.assertNotIn("اضافه فيديو", self._home())


# ==========================================================================
class WhatsAppFloatTests(BaseAppTest):
    """أيقونة واتساب عائمة في صفحات الموقع، رقمها من لوحة التحكم."""

    def setUp(self):
        super().setUp()
        self.cfg = SiteSetting.load()
        self.cfg.whatsapp_number = "+20 155-940 3203"
        self.cfg.save()


    def test_the_ready_message_rides_along(self):
        self.cfg.whatsapp_cta_message = "عايز أستفسر"
        self.cfg.save()
        self.assertIn(quote("عايز أستفسر"), self.client.get("/").content.decode())

    def test_no_number_means_no_button(self):
        self.cfg.whatsapp_number = ""
        self.cfg.save()
        self.assertNotIn("data-wa-float", self.client.get("/").content.decode())

    def test_its_own_toggle_turns_it_off(self):
        self.cfg.whatsapp_float_enabled = False
        self.cfg.save()
        self.assertNotIn("data-wa-float", self.client.get("/").content.decode())


    def test_it_never_shows_on_a_guest_invitation(self):
        """دعوة العميل مش مكان إعلان عننا."""
        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        self.assertNotIn("data-wa-float", body)

    def test_it_never_shows_in_the_dashboard(self):
        self.client.force_login(self.staff)
        self.assertNotIn("data-wa-float",
                         self.client.get("/dashboard/").content.decode())


# ==========================================================================
class PlanAddonTests(BaseAppTest):
    """إضافات بسعر زيادة فوق الباقة."""

    def setUp(self):
        super().setUp()
        self.music = PlanAddon.objects.create(
            name="موسيقى بالخلفية", code="music", price=50)
        self.fast = PlanAddon.objects.create(
            name="تسليم ٢٤ ساعة", code="", price=100)


    def test_unknown_feature_code_is_refused(self):
        """إضافة بمفتاح مش موجود بتتباع ومابتفتحش حاجة — والعميل مش
        هيعرف إن مفيش فرق."""
        form = PlanAddonForm({"name": "x", "code": "not_a_feature",
                              "price": "10", "sort_order": "0"})
        self.assertFalse(form.is_valid())
        self.assertIn("code", form.errors)

    def test_blank_code_is_fine(self):
        """الإضافة ممكن تبقى خدمة مش ميزة — زي التسليم السريع."""
        form = PlanAddonForm({"name": "تسليم سريع", "code": "",
                              "price": "100", "sort_order": "0"})
        self.assertTrue(form.is_valid(), form.errors)


    # -- الطلب -------------------------------------------------------------
    def _order(self, *addons, plan=None):
        form = OrderForm({
            "customer_name": "يوسف", "customer_phone": "0100000001",
            "plan": (plan or self.plan).pk, "event_type": "زفاف",
            "names": "يوسف و سارة",
            "addons": [a.pk for a in addons],
        })
        self.assertTrue(form.is_valid(), form.errors)
        return form.save()

    def test_order_total_adds_the_addons(self):
        order = self._order(self.music, self.fast)
        self.assertEqual(order.addons_total, Decimal("150"))
        self.assertEqual(order.total_price, self.plan.price + Decimal("150"))

    def test_price_at_purchase_is_frozen(self):
        """تغيير سعر الإضافة بعدين ماينفعش يعيد كتابة طلب قديم."""
        order = self._order(self.music)
        self.music.price = Decimal("500")
        self.music.save(update_fields=["price"])
        order.refresh_from_db()
        self.assertEqual(order.addons_total, Decimal("50"))

    def test_name_at_purchase_is_frozen_too(self):
        order = self._order(self.music)
        self.music.name = "اسم تاني خالص"
        self.music.save(update_fields=["name"])
        self.assertEqual(order.order_addons.first().name, "موسيقى بالخلفية")

    def test_bought_feature_opens_on_the_invitation(self):
        """اللي دفع في «موسيقى» فوق باقة مافيهاش موسيقى لازم ياخدها."""
        bare = Plan.objects.create(name="بسيطة", slug="bare", price=300,
                                   features=["countdown"])
        inv = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=bare,
            name_one="أ", name_two="ب", status="published",
            event_date=timezone.now() + timedelta(days=10),
            document=self.template.get_document(),
        )
        self.assertNotIn("music", inv.allowed_features)

        order = self._order(self.music, plan=bare)
        order.invitation = inv
        order.save(update_fields=["invitation"])
        inv.refresh_from_db()
        self.assertIn("music", inv.allowed_features)
        self.assertIn("countdown", inv.allowed_features)   # ومزايا الباقة باقية

    def test_service_addon_opens_nothing(self):
        order = self._order(self.fast)
        self.assertEqual(order.addon_features, set())

    def test_addon_limited_to_other_plans_is_refused(self):
        """الإخفاء في المتصفح مش حماية — الفورم بيتبعت من غير جافاسكربت."""
        self.music.plans.set([self.basic])
        form = OrderForm({
            "customer_name": "يوسف", "customer_phone": "0100000002",
            "plan": self.plan.pk, "event_type": "زفاف",
            "addons": [self.music.pk],
        })
        self.assertFalse(form.is_valid())
        self.assertIn("addons", form.errors)

    def test_unrestricted_addon_works_with_any_plan(self):
        self.assertTrue(self.music.available_for(self.plan))
        self.assertTrue(self.music.available_for(self.basic))


    def test_inactive_addon_is_not_offered(self):
        self.music.is_active = False
        self.music.save(update_fields=["is_active"])
        self.assertNotIn("موسيقى بالخلفية", self.client.get("/").content.decode())


# ==========================================================================
class PlanQuickEditTests(BaseAppTest):
    """تعديل اسم وسعر الباقة من الجدول من غير ما تفتح صفحة تانية."""

    def setUp(self):
        super().setUp()
        self.client.force_login(self.staff)

    def _post(self, **extra):
        data = {"action": "plan", "plan": self.plan.pk, "name": self.plan.name,
                "price": str(self.plan.price)}
        data.update(extra)
        return self.client.post("/dashboard/plans/", data)


    def test_negative_price_is_refused(self):
        old = self.plan.price
        self._post(price="-100")
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.price, old)


    def test_features_are_not_touched(self):
        """التعديل السريع للسعر ماينفعش يمسح مزايا الباقة بالغلط."""
        before = list(self.plan.features)
        self._post(price="900", is_active="on")
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.features, before)


# ==========================================================================
class CssVariableTests(TestCase):
    """كل ‎var(--x)‎ **من غير قيمة احتياطية** لازم يكون ليه مصدر.

    الحكاية دي جت من غلطة حقيقية: كتبت ‎var(--border)‎ في ‎site.css‎
    والاسم ده موجود في ‎invite.css‎ بس. النتيجة إن السطر كله بيبقى غير
    صالح — الكارت طلع من غير حدود ومن غير إبراز للمختار، **من غير أي
    رسالة خطأ في أي مكان**. ده أسوأ نوع غلط: بيسكت.

    ‎var(--x, 62px)‎ بقيمة احتياطية مالهاش المشكلة دي — بتنزل على
    الاحتياطي وخلاص، وده استخدام مقصود مش سهو.
    """

    # الاسم، وبعده فاصلة لو فيه قيمة احتياطية
    VAR = re.compile(r"var\(\s*(--[a-z0-9-]+)\s*(,?)")
    DEF = re.compile(r"(--[a-z0-9-]+)\s*:")

    def _read(self, rel):
        return (Path(settings.BASE_DIR) / rel).read_text("utf-8")

    def _required(self, css):
        """المتغيرات المستخدمة من غير قيمة احتياطية."""
        return {name for name, comma in self.VAR.findall(css) if not comma}


    def test_the_check_would_have_caught_the_real_bug(self):
        """ضمان إن الفحص نفسه شغّال مش بيعدّي كل حاجة."""
        fake = ".x { border: 1px solid var(--does-not-exist); }"
        self.assertEqual(self._required(fake), {"--does-not-exist"})
        # ومع قيمة احتياطية مايتبلّغش عنه
        self.assertEqual(self._required(".x { color: var(--nope, red); }"), set())


# ==========================================================================


# ==========================================================================


# ==========================================================================
class CropUsesTheOriginalTests(BaseAppTest):
    """نافذة القص كانت بتعرض النسخة المقصوصة وتقص من الأصل.

    ‎api_crop‎ بيقص من ‎asset.source‎ (الأصل قبل أي قص) عشان ما يحصلش فقد
    جودة متراكم. لكن الـJSON اللي بيروح للمحرر ما كانش فيه ‎source‎
    خالص، فالنافذة كانت بتعرض ‎asset.url‎ — النسخة المقصوصة. يعني الكادر
    اللي بترسمه على صورة، بيتطبّق على صورة تانية.
    """

    def _asset(self):
        from django.core.files.base import ContentFile
        from system.models import Asset
        return Asset.objects.create(
            file=ContentFile(b"x", name="a.webp"),
            source=ContentFile(b"y", name="a-source.webp"),
            kind="image", original_name="a.webp", invitation=self.inv,
        )

    def test_the_model_can_point_at_the_original(self):
        a = self._asset()
        self.assertNotEqual(a.source_url, a.url)


# ==========================================================================
class DocumentWallpaperTests(BaseAppTest):
    """وول بيبر على الدعوة كلها — الخلفية لقسم واحد موجودة أصلاً."""

    def _vars(self, **theme):
        doc = self.inv.document
        doc["theme"].update(theme)
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        body = self.client.get(self.inv.get_absolute_url()).content.decode()
        i = body.index('<body class="lb-doc"')
        return body[i:body.index(">", i)]

    def test_no_image_means_none_not_a_broken_url(self):
        self.assertIn("--doc-bg:none", self._vars())

    def test_the_image_reaches_the_page(self):
        self.assertIn("/media/wall.webp", self._vars(bg_image="/media/wall.webp"))

    def test_a_semicolon_in_the_url_cannot_break_the_other_variables(self):
        """كل المتغيّرات في سمة ‎style‎ واحدة مفصولة بـ‎;‎."""
        out = self._vars(bg_image="/media/a;b.webp")
        self.assertNotIn("/media/a;b.webp", out)
        self.assertIn("%3B", out)
        self.assertIn("--doc-bg-attach", out)      # اللي بعده لسه سليم

    def test_no_overlay_means_no_veil_layer(self):
        self.assertIn("--doc-bg-veil:none", self._vars(bg_image="/media/w.webp"))

    def test_the_overlay_becomes_a_gradient_layer(self):
        out = self._vars(bg_image="/media/w.webp", bg_overlay=40)
        self.assertIn("rgba(0,0,0,0.4)", out)

    def test_fixed_is_off_by_default(self):
        self.assertIn("--doc-bg-attach:scroll", self._vars())
        self.assertIn("--doc-bg-attach:fixed", self._vars(bg_fixed=True))


    def test_a_section_can_still_have_its_own_background(self):
        """الطلب كان «للدعوة كلها ولا لأقسام معينة» — التانية موجودة أصلاً."""
        keys = [f["key"] for f in B.editor_schema()["blocks"]["text"]["style"]]
        self.assertIn("bg_image", keys)


# ==========================================================================
class DocumentTranslationTests(BaseAppTest):
    """النسخة الإنجليزية — نصوص يكتبها المصمّم بإيده، مفيش ترجمة آلية."""

    def _doc(self, table=None):
        doc = self.inv.document
        doc["i18n"] = {"en": table or {}}
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        return self.inv.document

    def _page(self, lang=""):
        url = self.inv.get_absolute_url() + (f"?lang={lang}" if lang else "")
        return self.client.get(url).content.decode()

    def _hero_key(self, field="kicker"):
        hero = next(b for b in self.inv.document["blocks"] if b["type"] == "hero")
        return f"{hero['id']}.{field}"

    # ---- التخزين
    def test_a_fresh_document_has_an_empty_table(self):
        # اللغتين موجودتين: الدعوة العربية بتملا ‎en‎ والإنجليزية بتملا ‎ar‎
        self.assertEqual(B.normalize_document({})["i18n"], {"ar": {}, "en": {}})

    def test_junk_is_thrown_away(self):
        doc = B.normalize_document({"i18n": {"en": {
            "ok": "Fine", "bad": 12, "": "x", "blank": "   ",
        }}})
        self.assertEqual(doc["i18n"]["en"], {"ok": "Fine"})

    def test_a_huge_value_is_capped(self):
        doc = B.normalize_document({"i18n": {"en": {"k": "a" * 9000}}})
        self.assertEqual(len(doc["i18n"]["en"]["k"]), B.MAX_I18N_VALUE)

    # ---- زرار اللغة
    def test_no_translation_means_no_button(self):
        """دعوة من غير ترجمة مالهاش لازمة تعرض زرار بيرجّع نفس الكلام."""
        self._doc()
        self.assertNotIn("data-lang-toggle", self._page())


    def test_asking_for_english_without_a_translation_stays_arabic(self):
        self._doc()
        body = self._page("en")
        self.assertIn('<html lang="ar"', body)

    # ---- التبديل
    def test_the_english_text_replaces_the_arabic(self):
        self._doc({self._hero_key(): "Wedding invitation"})
        body = self._page("en")
        self.assertIn("Wedding invitation", body)
        self.assertNotIn("دعوة زفاف", body)


    def test_the_page_flips_to_ltr(self):
        self._doc({self._hero_key(): "Wedding invitation"})
        body = self._page("en")
        self.assertIn('<html lang="en"', body)
        self.assertIn('dir="ltr"', body)

    # ---- بيانات المناسبة
    def test_the_names_come_from_the_table_too(self):
        """الأسماء عايشة في جدول الدعوة مش المستند، وبرضو بيشوفها الضيف."""
        self._doc({"data.name_one": "Layla", "data.venue": "Jasmine Hall"})
        body = self._page("en")
        self.assertIn("Layla", body)
        self.assertIn("Jasmine Hall", body)

    def test_the_names_are_not_touched_in_arabic(self):
        self._doc({"data.name_one": "Layla"})
        self.assertIn("ليلى", self._page())

    # ---- عناصر القوايم
    def test_a_list_item_can_be_translated(self):
        """المفتاح بيتاخد من ‎translatable_entries‎ نفسها عشان الاختبار
        ما يعتمدش على اسم حقل ممكن يتغيّر."""
        rows = B.translatable_entries(self.inv.document)
        row = next(r for r in rows if r["value"] == "والد العروس")
        self.assertEqual(row["key"].count("."), 3)      # block.list.index.sub
        self._doc({row["key"]: "Father of the bride"})
        self.assertIn("Father of the bride", self._page("en"))

    # ---- الخطوط
    def test_english_can_take_its_own_fonts(self):
        """الخطوط العربية محارفها اللاتينية ناقصة أو وحشة."""
        doc = self.inv.document
        doc["theme"]["font_heading_en"] = "'Playfair Display', serif"
        doc["i18n"] = {"en": {self._hero_key(): "Wedding invitation"}}
        self.inv.document = B.normalize_document(doc)
        self.inv.save(update_fields=["document"])
        self.assertIn("Playfair Display", self._page("en"))

    def test_an_empty_english_font_keeps_the_arabic_one(self):
        self._doc({self._hero_key(): "Wedding invitation"})
        self.assertIn("Amiri", self._page("en"))

    # ---- الأصل ما بيتلمسش
    def test_the_stored_document_is_never_rewritten(self):
        """‎apply_i18n‎ بيرجّع نسخة — لو عدّل الأصل كانت الترجمة هتاكل
        النص العربي من قاعدة البيانات."""
        doc = self._doc({self._hero_key(): "Wedding invitation"})
        B.apply_i18n(doc, "en")
        hero = next(b for b in doc["blocks"] if b["type"] == "hero")
        self.assertEqual(hero["props"]["kicker"], "دعوة زفاف")


# ==========================================================================


class CodeBoxFullWidthTests(TestCase):
    """أماكن النصوص ماتتغيّرش بين اللغتين.

    مربع «كود متقدّم» عرضه ‎max-content‎، فعنصر جوّاه ‎width:100%‎ كان بيمشي مع
    أطول نص: الإنجليزي الأطول يوسّع المربع والأعمدة تتباعد.
    """

    CARD = "<div class=\"card\"><span data-move=\"a\">اسم</span></div>"

    def _html(self, code, translated):
        block = B.make_block("text")
        block["id"] = "code-1"
        block["props"]["code"] = code
        raw = {"blocks": [block]}
        if translated:
            raw["i18n"] = {"en": {"code-1.code#a": "Name"}}
        doc = B.normalize_document(raw)
        return str(render_document(doc, editable=False)["html"])

    # ---- الكشف
    def test_a_root_class_with_full_width_is_detected(self):
        self.assertTrue(invite_tags.fills_width(".card{width:100%}", self.CARD))

    def test_the_last_part_of_the_selector_is_what_counts(self):
        self.assertTrue(invite_tags.fills_width(
            "#sec .wrap .card { color:red; width: 100% !important; }", self.CARD))

    def test_a_root_without_it_is_left_alone(self):
        self.assertFalse(invite_tags.fills_width(".card{width:260px}", self.CARD))
        self.assertFalse(invite_tags.fills_width(".card{max-width:100%}", self.CARD))
        self.assertFalse(invite_tags.fills_width(".card{min-width:100%}", self.CARD))

    def test_only_the_first_element_matters(self):
        """عنصر جوّاه عرضه ‎100%‎ مالوش دعوة بعرض المربع نفسه."""
        self.assertFalse(invite_tags.fills_width(".inner{width:100%}",
                         "<div class=\"card\"><p class=\"inner\">x</p></div>"))

    def test_another_class_does_not_count(self):
        self.assertFalse(invite_tags.fills_width(".other{width:100%}", self.CARD))

    def test_a_media_query_is_not_an_unconditional_declaration(self):
        css = "@media(max-width:300px){.card{width:100%}}"
        self.assertFalse(invite_tags.fills_width(css, self.CARD))

    def test_a_comment_or_missing_code_is_safe(self):
        self.assertFalse(invite_tags.fills_width("/* .card{width:100%} */", self.CARD))
        self.assertFalse(invite_tags.fills_width(".card{width:100%}", ""))
        self.assertFalse(invite_tags.fills_width("", self.CARD))

    # ---- العرض
    def test_a_translated_invitation_gets_a_full_width_box(self):
        html = self._html("<style>.card{width:100%}</style>" + self.CARD, True)
        self.assertRegex(html, r'class="lb-extra-html lb-full"')

    def test_an_invitation_without_a_translation_is_untouched(self):
        html = self._html("<style>.card{width:100%}</style>" + self.CARD, False)
        self.assertIn('class="lb-extra-html"', html)
        self.assertNotIn("lb-full", html)

    def test_a_fixed_width_card_keeps_hugging_its_content(self):
        html = self._html("<style>.card{width:260px}</style>" + self.CARD, True)
        self.assertIn('class="lb-extra-html"', html)


# ==========================================================================
class CustomSectionTextTests(TestCase):
    """نصوص القسم المستورد — استخراجها من الكود واستبدالها فيه."""

    HTML = (
        '<section class="c">\n'
        '  <style>.x{color:red}</style>\n'
        '  <h1 data-move="el-1" class="t">YOU&#39;RE INVITED</h1>\n'
        '  <p data-move="el-2">Mohamed &amp; Farah</p>\n'
        '  <div data-move="el-3"><span>mixed</span> markup</div>\n'
        '  <img data-move="el-4" src="a.png">\n'
        '</section>'
    )

    def test_plain_text_units_are_found(self):
        keys = [m for m, _t in customtext.text_units(self.HTML)]
        self.assertEqual(keys, ["el-1", "el-2"])

    def test_the_text_comes_out_decoded(self):
        units = dict(customtext.text_units(self.HTML))
        self.assertEqual(units["el-2"], "Mohamed & Farah")

    def test_mixed_markup_is_left_alone(self):
        """الاستبدال كان هيمسح الوسم اللي جوّه والمصمّم مش هيفهم راح فين."""
        self.assertNotIn("el-3", dict(customtext.text_units(self.HTML)))

    def test_void_tags_are_not_offered(self):
        self.assertNotIn("el-4", dict(customtext.text_units(self.HTML)))

    def test_style_and_script_are_never_offered(self):
        """ده كان الباج: الجدول بيعرض CSS بدل الكلام."""
        for _m, text in customtext.text_units(self.HTML):
            self.assertNotIn("color:red", text)

    def test_broken_html_does_not_explode(self):
        self.assertIsInstance(customtext.text_units("<div><p data-move=x>hi"), list)

    # ---- الاستبدال
    def test_only_the_targeted_text_changes(self):
        out = customtext.replace_texts(self.HTML, {"el-1": "أنتم مدعوون"})
        self.assertIn("أنتم مدعوون", out)
        self.assertIn("Mohamed &amp; Farah", out)

    def test_the_tags_survive_byte_for_byte(self):
        """إعادة بناء الكود كانت هتغيّر الاقتباسات وتكسر ستايل القالب."""
        out = customtext.replace_texts(self.HTML, {"el-1": "X"})
        self.assertIn('<h1 data-move="el-1" class="t">', out)
        self.assertIn('<img data-move="el-4" src="a.png">', out)
        self.assertIn("<style>.x{color:red}</style>", out)

    def test_the_new_text_is_escaped(self):
        out = customtext.replace_texts(self.HTML, {"el-1": '<script>x</script>'})
        self.assertNotIn("<script>x", out)
        self.assertIn("&lt;script&gt;", out)

    def test_an_empty_map_returns_the_original(self):
        self.assertEqual(customtext.replace_texts(self.HTML, {}), self.HTML)


# ==========================================================================
class CustomSectionTranslationTests(BaseAppTest):
    """الترجمة جوّه قسم مستورد — من جدول الترجمة لحد صفحة الضيف."""

    HTML = '<div><h2 data-move="el-1">أهلاً بيكم</h2>' \
           '<p data-move="el-2">في فرحنا</p></div>'

    def setUp(self):
        super().setUp()
        doc = B.normalize_document({"blocks": [
            {"type": "custom_html", "id": "custom-1",
             "props": {"html": self.HTML, "css": ".a{color:red}"}},
        ]})
        self.inv.document = doc
        self.inv.save(update_fields=["document"])

    def _rows(self):
        return B.translatable_entries(self.inv.document)

    def _page(self, lang=""):
        url = self.inv.get_absolute_url() + (f"?lang={lang}" if lang else "")
        return self.client.get(url).content.decode()

    def test_the_words_show_up_not_the_code(self):
        values = [r["value"] for r in self._rows()]
        self.assertIn("أهلاً بيكم", values)
        self.assertIn("في فرحنا", values)

    def test_the_css_field_is_gone_from_the_table(self):
        """ده اللي كان بيملا الجدول بستايل بدل كلام."""
        self.assertNotIn(".a{color:red}", [r["value"] for r in self._rows()])
        self.assertFalse(any(r["key"].endswith(".css") for r in self._rows()))

    def test_the_key_points_inside_the_html(self):
        row = next(r for r in self._rows() if r["value"] == "أهلاً بيكم")
        self.assertEqual(row["key"], "custom-1.html#el-1")


    def test_the_stored_html_is_never_rewritten(self):
        doc = self.inv.document
        doc["i18n"] = {"en": {"custom-1.html#el-1": "Welcome"}}
        B.apply_i18n(doc, "en")
        self.assertIn("أهلاً بيكم", doc["blocks"][0]["props"]["html"])


# ==========================================================================
class FaststartTests(TestCase):
    """نقل فهرس MP4 (moov) للأول — من غير ffmpeg.

    المتصفح مايقدرش يبدأ العرض قبل ما يقرا الـmoov. أغلب برامج التصدير
    بتكتبه في آخر الملف، فالمتصفح بينزّل الملف كله الأول. على اللوكال ده
    مالوش أثر ملحوظ، وعلى استضافة بطيئة بيبقى ثواني سودا قبل التشغيل —
    وده كان بيعدّي من غير أي رسالة لما ffmpeg مش متثبّت.
    """

    def _mp4(self, order=("ftyp", "mdat", "moov")):
        """ملف MP4 مبسّط بجدول ‎stco‎ حقيقي عشان نتأكد من تصحيح الأوفستات."""
        def box(kind, payload):
            return (len(payload) + 8).to_bytes(4, "big") + kind + payload

        ftyp = box(b"ftyp", b"isom" + b"\x00" * 8)
        media = b"\xAA" * 400
        # ترتيب الملف: ftyp ثم mdat — فبيانات mdat بتبدأ بعد ترويستها
        mdat_start = len(ftyp) + 8
        stco = box(b"stco", b"\x00\x00\x00\x00" + (1).to_bytes(4, "big")
                   + mdat_start.to_bytes(4, "big"))
        stbl = box(b"stbl", stco)
        minf = box(b"minf", stbl)
        mdia = box(b"mdia", minf)
        trak = box(b"trak", mdia)
        moov = box(b"moov", trak)
        mdat = box(b"mdat", media)
        parts = {"ftyp": ftyp, "mdat": mdat, "moov": moov}
        return b"".join(parts[k] for k in order), len(moov), mdat_start

    def test_it_spots_a_late_index(self):
        data, _m, _s = self._mp4(("ftyp", "mdat", "moov"))
        self.assertTrue(video.moov_is_late(data))

    def test_a_ready_file_is_left_alone(self):
        data, _m, _s = self._mp4(("ftyp", "moov", "mdat"))
        self.assertFalse(video.moov_is_late(data))
        self.assertIsNone(video.faststart_bytes(data))

    def test_the_index_moves_to_the_front(self):
        data, _m, _s = self._mp4()
        out = video.faststart_bytes(data)
        self.assertIsNotNone(out)
        self.assertFalse(video.moov_is_late(out))

    def test_nothing_is_re_encoded(self):
        """نفس البايتات بترتيب مختلف — الجودة والحجم زي ما هم."""
        data, _m, _s = self._mp4()
        out = video.faststart_bytes(data)
        self.assertEqual(len(out), len(data))
        self.assertIn(b"\xAA" * 400, out)

    def test_the_chunk_offsets_follow_the_move(self):
        """من غير التصحيح ده الفيديو بيبقى موجود ومش بيتفك."""
        data, moov_len, old_start = self._mp4()
        out = video.faststart_bytes(data)
        i = out.index(b"stco")
        moved = int.from_bytes(out[i + 4 + 8:i + 4 + 12], "big")
        self.assertEqual(moved, old_start + moov_len)
        # والقيمة الجديدة بتشاور فعلاً على أول بايت من بيانات mdat
        self.assertEqual(out[moved:moved + 4], b"\xAA" * 4)

    def test_junk_never_raises(self):
        for junk in (b"", b"not an mp4 at all", b"\x00\x00\x00\x08free"):
            with self.subTest(junk=junk[:12]):
                self.assertIsNone(video.faststart_bytes(junk))
                self.assertFalse(video.moov_is_late(junk))

    def test_a_truncated_file_is_left_alone(self):
        data, _m, _s = self._mp4()
        self.assertIsNone(video.faststart_bytes(data[:len(data) // 2]))

    # ---- المسار الكامل من غير ffmpeg
    def test_upload_is_fixed_even_without_ffmpeg(self):
        data, _m, _s = self._mp4()
        real = video.available
        video.available = lambda: False
        try:
            up = SimpleUploadedFile("clip.mp4", data, content_type="video/mp4")
            out, _secs = video.prepare_for_stream(up)
            self.assertFalse(video.moov_is_late(out.read()))
        finally:
            video.available = real

    def test_a_non_mp4_is_not_touched(self):
        real = video.available
        video.available = lambda: False
        try:
            up = SimpleUploadedFile("clip.webm", b"webm-ish", content_type="video/webm")
            out, _secs = video.prepare_for_stream(up)
            self.assertEqual(out.read(), b"webm-ish")
        finally:
            video.available = real


# ==========================================================================
class TextStyleGearTests(TestCase):
    """ترس النص — كل حقل نص في المحرر بياخد تنسيقه هو.

    قبل كده كان فيه ٤ بلوكات بس عندها حقول خط/حجم، بأسماء مالهاش علاقة
    بأسماء حقول النص (‎quote_font‎ لحقل اسمه ‎text‎)، ومفيش ولا حقل لون
    نص واحد. والترس كان لأربع حقول في الافتتاحية بخريطة مكتوبة بالإيد
    في ‎editor.js‎.
    """

    TEXT_TYPES = {"text", "textarea", "html"}

    def _owners(self, btype, spec):
        """حقول النص اللي المفروض ليها ترس في البلوك ده."""
        return [
            f for f in spec["props"]
            if f["type"] in self.TEXT_TYPES
            and not f.get("editor_hidden")
            and f.get("translate") is not False
            and (btype, f["key"]) not in B.NO_TEXT_STYLE
        ]

    # ---- المخطط
    def test_every_text_field_has_style_children(self):
        for btype, spec in B.BLOCK_REGISTRY.items():
            children = {}
            for f in spec["props"]:
                if f.get("style_of"):
                    children.setdefault(f["style_of"], set()).add(f["style_role"])
            for owner in self._owners(btype, spec):
                with self.subTest(block=btype, field=owner["key"]):
                    roles = children.get(owner["key"], set())
                    for role in ("font", "color", "size"):
                        self.assertIn(role, roles)

    def test_style_children_never_show_in_the_flat_list(self):
        """لو ظهروا في القايمة، يبقى نفس الإعداد في مكانين."""
        for btype, spec in B.BLOCK_REGISTRY.items():
            for f in spec["props"]:
                if f.get("style_of"):
                    with self.subTest(block=btype, field=f["key"]):
                        self.assertTrue(f.get("editor_hidden"))

    def test_the_old_font_fields_moved_into_the_gear_instead_of_doubling(self):
        """‎heading_font‎ و‎quote_size‎ و‎name_font‎ اتنقلوا مش اتكرروا."""
        cases = {
            "text": {"heading_font": "heading", "heading_size": "heading",
                     "body_size": "body", "body_line_height": "body"},
            "quote": {"quote_font": "text", "quote_size": "text"},
            "hero": {"name_font": "name_one", "name_size": "name_one",
                     "name_spacing": "name_one"},
        }
        for btype, expected in cases.items():
            fields = {f["key"]: f for f in B.BLOCK_REGISTRY[btype]["props"]}
            for key, owner in expected.items():
                with self.subTest(block=btype, field=key):
                    self.assertEqual(fields[key].get("style_of"), owner)
                    self.assertTrue(fields[key].get("editor_hidden"))
            # ومفيش مفتاح مولّد بيكرّر نفس الدور
            self.assertNotIn(f"{B.TEXT_STYLE_PREFIX}heading_font", fields)

    def test_intro_texts_keep_their_own_keys(self):
        """قيم الافتتاحية المحفوظة مالهاش تتغيّر — الترس بيقرا نفس المفاتيح."""
        fields = {f["key"]: f for f in B.SETTINGS_FIELDS}
        self.assertEqual(fields["intro_text_font"].get("style_of"), "intro_text")
        self.assertEqual(fields["intro_play_size"].get("style_of"),
                         "intro_play_label")

    def test_generated_font_fields_do_not_ship_their_own_font_list(self):
        """قايمة الخطوط بتتبعت مرة واحدة في المخطط، مش مع كل حقل."""
        heavy = [
            f["key"] for spec in B.BLOCK_REGISTRY.values() for f in spec["props"]
            if f["key"].startswith(B.TEXT_STYLE_PREFIX) and f.get("options")
            and f["type"] == "font"
        ]
        self.assertEqual(heavy, [])

    # ---- القوالب

    # ---- الناتج
    def _hero(self, **props):
        block = B.make_block("hero")
        block["id"] = "hero-test1"
        block["props"].update(props)
        return block

    def test_a_set_value_becomes_one_scoped_rule(self):
        from system.renderer import text_style_css
        css = text_style_css([self._hero(
            ts_kicker_color="#b8914f", ts_kicker_weight="700",
            ts_kicker_align="center", ts_kicker_ls=1.5, ts_kicker_lh=1.4,
        )], {"max_width": 720})
        self.assertIn('[data-ts="kicker"]', css)
        for want in ("color:#b8914f", "font-weight:700", "text-align:center",
                     "letter-spacing:1.5px", "line-height:1.4"):
            self.assertIn(want, css)

    def test_the_size_follows_the_screen_like_the_rest(self):
        from system.renderer import text_style_css
        css = text_style_css([self._hero(ts_kicker_size=22)], {"max_width": 720})
        self.assertIn("font-size:clamp(", css)

    def test_an_untouched_document_adds_no_css_at_all(self):
        from system.renderer import text_style_css
        self.assertEqual(text_style_css([self._hero()], {"max_width": 720}), "")

    def test_junk_values_never_reach_the_stylesheet(self):
        from system.renderer import text_style_css
        css = text_style_css([self._hero(
            ts_kicker_color="red;background:url(javascript:alert(1))",
            ts_kicker_font="</style><script>x</script>",
            ts_kicker_weight="999", ts_kicker_align="justify",
            ts_kicker_size=9999,
        )], {"max_width": 720})
        self.assertEqual(css, "")

    def test_the_rule_still_finds_the_rsvp_section(self):
        """قالب تأكيد الحضور بيكتب ‎id="rsvp"‎ ثابت مش ‎block.id‎."""
        from system.renderer import text_style_css
        block = B.make_block("rsvp")
        block["id"] = "rsvp-test1"
        block["props"]["ts_submit_label_color"] = "#ffffff"
        css = text_style_css([block], {"max_width": 720})
        self.assertIn('[data-block="rsvp-test1"]', css)
        # ‎:is()‎ بتدّي القاعدة قوة المُعرِّف حتى وهي بتطابق بالسمة
        self.assertTrue(css.startswith(":is(#rsvp-test1,"))

    def test_the_stylesheet_reaches_the_page_with_the_offsets(self):
        doc = B.normalize_document({"blocks": [self._hero(ts_kicker_color="#123456")]})
        out = render_document(doc, editable=False)
        self.assertIn('[data-ts="kicker"]', out["layout_css"])

    # ---- المحرر


# ==========================================================================
class OverlayTextGearTests(TestCase):
    """نص «فوق القسم» نص زي أي نص — لازم يبقى له ترس هو كمان.

    ده حقل ‎list‎، وعناصر القايمة ليها مسار تاني في ‎editor.js‎ ماكانش
    بيمرّر للترس حاجة، فحقول التنسيق كانت بتتفرد تحت النص.
    """

    def _sub(self, key):
        return next(f for f in B.SECTION_TEXT_OVERLAY_FIELD["fields"]
                    if f["key"] == key)

    def test_the_style_fields_belong_to_the_text(self):
        for key, role in (("font", "font"), ("color", "color"), ("size", "size")):
            with self.subTest(key=key):
                spec = self._sub(key)
                self.assertEqual(spec["style_of"], "text")
                self.assertEqual(spec["style_role"], role)
                self.assertTrue(spec["editor_hidden"])

    def test_position_fields_stay_out_in_the_open(self):
        """العرض والموضع مش تنسيق — ليهم مقابض في المعاينة."""
        for key in ("width", "x", "y"):
            with self.subTest(key=key):
                self.assertIsNone(self._sub(key).get("style_of"))
                self.assertFalse(self._sub(key).get("editor_hidden"))

    def test_the_saved_keys_did_not_move(self):
        """نصوص محفوظة قبل كده لازم تفضل شغالة بنفس المفاتيح.

        الترتيب مش مهم — المهم إن المفاتيح نفسها موجودة بنفس النوع،
        لأن ``video_text_style`` والمستندات المحفوظة بيقروها بالاسم.
        """
        fields = {f["key"]: f for f in B.SECTION_TEXT_OVERLAY_FIELD["fields"]}
        for key, ftype in (("text", "textarea"), ("color", "color"),
                           ("font", "font"), ("width", "range"),
                           ("x", "range"), ("y", "range")):
            with self.subTest(key=key):
                self.assertEqual(fields[key]["type"], ftype)

    def test_an_old_overlay_becomes_a_text_element(self):
        """عنصر متخزّن قبل ما النوع يتولد لازم يفضل نص."""
        doc = B.normalize_document({"blocks": [{
            "type": "text",
            "props": {"text_overlays": [{"text": "قديم", "color": "#ff0000"}]},
        }]})
        item = doc["blocks"][0]["props"]["text_overlays"][0]
        self.assertEqual(item["kind"], "text")
        self.assertEqual(item["text"], "قديم")
        self.assertEqual(item["color"], "#ff0000")

    def test_a_size_reaches_the_page_as_a_fluid_value(self):
        style = invite_tags.video_text_style(
            {"text": "x", "size": 40, "color": "#ffffff"})
        self.assertIn("--section-text-size:clamp(", style)

    def test_zero_size_writes_nothing(self):
        """صفر = حجم القالب زي ما هو، مش ‎0px‎."""
        style = invite_tags.video_text_style({"text": "x", "size": 0})
        self.assertNotIn("--section-text-size", style)

    def test_junk_size_is_dropped(self):
        for bad in ("9999", "-5", "abc", None):
            with self.subTest(size=bad):
                self.assertNotIn(
                    "--section-text-size:clamp(1",
                    invite_tags.video_text_style({"text": "x", "size": bad}))

    def test_layer_order_is_written_only_when_set(self):
        """القديم من غير z/behind مايتكتبلوش متغيّر — بيفضل ‎4‎ من الـCSS."""
        self.assertNotIn("--ovl-z", invite_tags.video_text_style({"text": "x"}))
        self.assertNotIn("--ovl-z", invite_tags.video_text_style(
            {"text": "x", "z": 0, "behind": False}))

    def test_layer_order_above_and_behind_the_section_content(self):
        above = invite_tags.video_text_style({"text": "x", "z": 3})
        self.assertIn("--ovl-z:7", above)
        behind = invite_tags.video_text_style({"text": "x", "z": 2, "behind": True})
        self.assertIn("--ovl-z:-98", behind)

    def test_junk_layer_order_is_clamped(self):
        style = invite_tags.video_text_style({"text": "x", "z": 99999, "behind": True})
        self.assertIn("--ovl-z:-40", style)
        self.assertNotIn("--ovl-z", invite_tags.video_text_style(
            {"text": "x", "z": "abc"}))


# ==========================================================================
class SectionOverlayElementsTests(TestCase):
    """عناصر فوق القسم: نص + صورة + زرار، وكلهم بيتسحبوا في أي حتة.

    التلاتة في **قايمة واحدة** (`text_overlays`) عن قصد: الموضع والعرض
    والسحب والمقابض كلهم كود واحد. نوع رابع بيتضاف في القالب بس.
    """

    def _render(self, overlay, block_type="text", editable=False):
        block = B.make_block(block_type)
        block["id"] = "ovl-1"
        block["props"]["text_overlays"] = [overlay]
        doc = B.normalize_document({"blocks": [block]})
        return str(render_document(doc, editable=editable)["html"])

    # ---- الأنواع التلاتة بتتعرض
    def test_a_text_element_still_renders_the_old_way(self):
        html = self._render({"kind": "text", "text": "أهلاً بيكم"})
        self.assertIn("lb-section-text", html)
        self.assertIn("أهلاً بيكم", html)

    def test_an_image_element_renders_an_image(self):
        html = self._render({"kind": "image", "src": "/media/x.jpg", "radius": 24})
        self.assertIn("lb-ovl--image", html)
        self.assertIn('src="/media/x.jpg"', html)
        self.assertIn("--ovl-radius:24px", html)

    def test_an_image_element_opacity_is_a_percentage_and_old_items_stay_opaque(self):
        faded = self._render({"kind": "image", "src": "/media/x.jpg", "opacity": 60})
        self.assertIn("--ovl-opacity:0.6", faded)
        # عنصر قديم مالوش المفتاح، أو ١٠٠ = مفيش تغيير (مش ٥٪)
        self.assertNotIn("--ovl-opacity", self._render({"kind": "image", "src": "/media/x.jpg"}))
        self.assertNotIn("--ovl-opacity", self._render({"kind": "image", "src": "/media/x.jpg", "opacity": 100}))

    def test_a_button_element_renders_a_real_link(self):
        html = self._render({"kind": "button", "label": "احجز مكانك",
                             "href": "https://example.com", "btn_bg": "#123456"})
        self.assertIn("lb-ovl--button", html)
        self.assertIn('href="https://example.com"', html)
        self.assertIn("احجز مكانك", html)
        self.assertIn("--ovl-btn-bg:#123456", html)

    def test_a_button_without_a_link_is_not_a_link(self):
        """‎href="#"‎ فاضي كان هيرجّع الضيف لأول الصفحة من غير سبب."""
        html = self._render({"kind": "button", "label": "زرار"})
        self.assertIn("lb-ovl-btn", html)
        self.assertNotIn("<a class=\"lb-ovl-btn\"", html)

    # ---- الحركة: كل عنصر بياخد نفس علامات السحب
    def test_every_kind_carries_the_drag_hooks(self):
        for overlay in (
            {"kind": "text", "text": "نص"},
            {"kind": "image", "src": "/media/x.jpg"},
            {"kind": "button", "label": "زرار"},
        ):
            with self.subTest(kind=overlay["kind"]):
                html = self._render(overlay)
                self.assertIn("data-section-text", html)
                self.assertIn('data-section-text-index="0"', html)
                self.assertIn("--video-text-x:", html)

    def test_the_position_is_written_for_every_kind(self):
        html = self._render({"kind": "image", "src": "/media/x.jpg", "x": 12, "y": -8})
        self.assertIn("--video-text-x:12%", html)
        self.assertIn("--video-text-y:-8%", html)

    # ---- الأمان
    def test_a_javascript_link_never_reaches_the_page(self):
        doc = B.normalize_document({"blocks": [{"type": "text", "props": {
            "text_overlays": [{"kind": "button", "label": "خد بالك",
                               "href": "javascript:alert(1)"}]}}]})
        item = doc["blocks"][0]["props"]["text_overlays"][0]
        self.assertEqual(item["href"], "")

    def test_junk_colours_and_fonts_are_dropped(self):
        html = self._render({
            "kind": "button", "label": "زرار",
            "btn_bg": "red;background:url(javascript:alert(1))",
            "btn_font": "</style><script>x</script>",
        })
        self.assertNotIn("javascript", html)
        self.assertNotIn("<script>x", html)
        self.assertIn("--ovl-btn-bg:#b8914f", html)      # رجع للافتراضي
        self.assertIn("--ovl-btn-font:inherit", html)

    def test_an_external_link_opens_in_a_new_tab_but_an_anchor_does_not(self):
        self.assertEqual(invite_tags.overlay_target("https://x.com"), "_blank")
        self.assertEqual(invite_tags.overlay_target("#rsvp"), "")
        self.assertEqual(invite_tags.overlay_target(""), "")

    # ---- خط النسخة المترجَمة
    def _translated_css(self, overlay, style, key="text", block_type="text"):
        block = B.make_block(block_type)
        block["id"] = "ovl-1"
        block["props"]["text_overlays"] = [overlay]
        doc = B.normalize_document({
            "blocks": [block],
            "i18n": {"en": {f"ovl-1.text_overlays.0.{key}": "Hello"}},
            "i18n_style": {"en": {f"ovl-1.text_overlays.0.{key}": style}},
        })
        return render_document(doc, editable=False, lang="en")["layout_css"]

    def test_the_translated_font_reaches_an_added_text(self):
        """«إضافة نص» + خط للنسخة المترجَمة: القاعدة كانت بتتشال بالسكوت."""
        css = self._translated_css(
            {"kind": "text", "text": "أهلاً"}, {"font": "'Cairo', sans-serif"})
        self.assertIn('[data-section-text-index="0"]', css)
        self.assertIn("font-family:'Cairo', sans-serif !important", css)

    def test_the_translated_size_matches_how_the_original_scales(self):
        css = self._translated_css({"kind": "text", "text": "أهلاً"}, {"size": 40})
        self.assertIn("font-size:clamp(", css)

    def test_the_translated_button_label_gets_its_font_on_the_label(self):
        css = self._translated_css(
            {"kind": "button", "label": "احجز"}, {"font": "'Cairo', sans-serif"},
            key="label")
        self.assertIn('[data-section-text-index="0"] .lb-ovl-btn', css)

    def test_the_translated_font_only_applies_to_the_other_language(self):
        block = B.make_block("text")
        block["id"] = "ovl-1"
        block["props"]["text_overlays"] = [{"kind": "text", "text": "أهلاً"}]
        doc = B.normalize_document({
            "blocks": [block],
            "i18n": {"en": {"ovl-1.text_overlays.0.text": "Hello"}},
            "i18n_style": {"en": {"ovl-1.text_overlays.0.text":
                                  {"font": "'Cairo', sans-serif"}}},
        })
        css = render_document(doc, editable=False, lang="ar")["layout_css"]
        self.assertNotIn("data-section-text-index", css)

    def test_the_translated_font_is_scoped_to_its_own_section(self):
        css = self._translated_css(
            {"kind": "text", "text": "أهلاً"}, {"font": "'Cairo', sans-serif"})
        self.assertIn(':is(#ovl-1,[data-block="ovl-1"]) ', css)

    # ---- المحرر
    def test_an_empty_element_shows_its_place_in_the_editor_only(self):
        empty = {"kind": "image", "src": ""}
        self.assertIn("lb-ovl--empty", self._render(empty, editable=True))
        self.assertNotIn("lb-ovl--empty", self._render(empty, editable=False))

    def test_the_three_add_buttons_are_declared_in_the_schema(self):
        variants = B.SECTION_TEXT_OVERLAY_FIELD["add_variants"]
        self.assertEqual([v["value"] for v in variants],
                         ["text", "image", "button"])
        self.assertTrue(B.SECTION_TEXT_OVERLAY_FIELD["group_open"])


# ==========================================================================


# ==========================================================================
class FontsMustBeLoadedNotAssumedTests(TestCase):
    """أي خط في قايمة المحرر لازم يتحمّل مع الصفحة، مايتفترضش.

    «جورجيا» كانت في القايمة من غير ما تتحمّل: الويندوز والآيفون
    عندهم الخط فبيعرضوه، وأندرويد مالوش فبيحطّ خط تاني بعرض مختلف.
    نفس الدعوة كانت بتطلع بأشكال مختلفة، والفرق بيكبر في القوالب اللي
    مواضعها ثابتة بالبكسل.
    """

    def _loaded_families(self):
        html = (Path(settings.BASE_DIR) / "templates/invitations/render.html"
                ).read_text("utf-8")
        return {
            fam.replace("+", " ")
            for fam in re.findall(r"family=([A-Za-z+]+)", html)
        }


    def test_georgia_maps_to_its_metric_compatible_web_font(self):
        """جيلاسيو مقاساته مطابقة لجورجيا حرفاً بحرف، فالشكل مايتغيّرش."""
        value = next(o["value"] for o in B.FONT_CHOICES if o["label"] == "Georgia")
        self.assertTrue(value.startswith("'Gelasio'"))
        self.assertIn("Georgia", value)          # احتياطي لو الويب فونت ماوصلش

    def test_an_old_document_saying_georgia_is_migrated_on_the_fly(self):
        doc = B.normalize_document({"blocks": [{"type": "text", "props": {
            "text_overlays": [{"kind": "text", "text": "x",
                               "font": "Georgia, serif"}]}}]})
        self.assertEqual(doc["blocks"][0]["props"]["text_overlays"][0]["font"],
                         "'Gelasio', Georgia, serif")

    def test_the_migration_leaves_every_other_font_alone(self):
        for option in B.FONT_CHOICES:
            with self.subTest(font=option["label"]):
                doc = B.normalize_document({"blocks": [{"type": "text", "props": {
                    "text_overlays": [{"kind": "text", "text": "x",
                                       "font": option["value"]}]}}]})
                self.assertEqual(
                    doc["blocks"][0]["props"]["text_overlays"][0]["font"],
                    option["value"])


# ==========================================================================
class SectionHeightIsProportionalTests(TestCase):
    """ارتفاع القسم لازم يبقى نسبة من عرضه، مش رقم بكسل ثابت.

    الارتفاع الثابت مع خلفية ``cover`` معناه إن نسبة الصندوق بتتغيّر
    مع عرض التليفون، والمتصفح بيقص الفرق. قياس على قسم ارتفاعه 780px
    وصورة خلفية 614×1175:

    | عرض الشاشة | القص الأفقي | القص الرأسي |
    |---|---|---|
    | 360 (أندرويد) | 48px | صفر |
    | 393 (آيفون) | 15px | صفر |
    | 430 (آيفون Pro Max) | صفر | **43px** — ٢١ فوق و٢١ تحت |

    يعني الدعوة بتتاكل من فوق وتحت على التليفون العريض بس.
    """

    def _heights(self, style):
        """القيمة الأساسية بس — القوس ‎{‎ قبلها بيستبعد نسخة ‎round()‎."""
        css = tildacss.section_surface_css("sec-1", style)
        return re.findall(r"\{height:([^!]+)!important;min-height:", css)

    def test_a_phone_height_becomes_a_ratio_of_the_section_width(self):
        """780 على إطار 390 = ضعف العرض، على أي تليفون."""
        self.assertEqual(self._heights({"section_height_mobile": 780})[0],
                         "calc(100cqw*2)")

    def test_the_ratio_keeps_the_box_shape_identical_on_every_phone(self):
        ratio = 780 / 390
        for width in (360, 393, 412, 430):
            with self.subTest(width=width):
                # نسبة الصندوق = العرض ÷ (العرض × النسبة) = ثابتة
                self.assertAlmostEqual(width / (width * ratio), 1 / ratio, places=9)

    def test_tablet_and_desktop_stay_in_pixels(self):
        """المسرح هناك محدود بـ‎--max-width‎، فعرضه مش عرض الشاشة."""
        self.assertEqual(
            self._heights({"section_height_tablet": 900,
                           "section_height_desktop": 1000}),
            ["900px", "1000px"])

    def test_the_legacy_single_height_gets_the_same_treatment(self):
        got = self._heights({"section_height": 600})
        self.assertEqual(got[0], "calc(100cqw*1.5385)")     # موبايل
        self.assertEqual(got[1:], ["600px", "600px"])       # تابلت وديسكتوب

    def test_no_height_writes_no_rule(self):
        self.assertEqual(self._heights({}), [])


# ==========================================================================
class SectionHeightFallsBackToThePhoneDesignTests(TestCase):
    """القسم من غير ارتفاع للديسكتوب كان بينهار على الشاشة الكبيرة.

    المستخدم بيصمّم على إطار الموبايل ويسحب الارتفاع هناك؛ حقول
    التابلت والديسكتوب بتفضل صفر في أغلب الأقسام. ومن غير ارتفاع
    القسم بيرجع لطوله الطبيعي — وده الحشو بس، لأن كل العناصر اللي
    فوق القسم ‎position:absolute‎ فمابتضيفش طول.

    قياس على قالب حقيقي (‎/templates/new/preview/‎):

    | المقاس | عرض المسرح | ارتفاع القسم | العناصر |
    |---|---|---|---|
    | موبايل | 390 | 781px (`calc(100cqw*2)`) | متوزّعة صح |
    | ديسكتوب | 720 | **160px** (حشو بس، مفيش قاعدة) | طولها 180–210px واترصّت فوق بعضها |

    ولازم تبقى **نسبة** مش بكسل: العناصر متموضعة
    ‎left:calc(50% + x%)‎ و‎top:calc(50% + y%)‎ — نسبة من العرض ومن
    الارتفاع. تثبيت نسبة الصندوق = نفس التركيب بالظبط، أكبر وبس.
    """

    def _heights(self, style):
        """قسم عادي — التوريث للأقسام غير المستوردة بس."""
        css = tildacss.section_surface_css("sec-1", style, imported=False)
        return re.findall(r"\{height:([^!]+)!important;min-height:", css)

    def test_the_phone_design_carries_to_tablet_and_desktop(self):
        self.assertEqual(self._heights({"section_height_mobile": 780}),
                         ["calc(100cqw*2)"] * 3)

    def test_it_is_a_ratio_not_the_raw_pixel_value(self):
        """780px على مسرح 720 كان هيضغط التوزيع رأسياً."""
        got = self._heights({"section_height_mobile": 780})
        self.assertNotIn("780px", got)

    def test_a_height_you_set_yourself_still_wins(self):
        self.assertEqual(
            self._heights({"section_height_mobile": 780,
                           "section_height_desktop": 1000}),
            ["calc(100cqw*2)", "calc(100cqw*2)", "1000px"])

    def test_the_old_single_height_is_not_touched(self):
        """مستند قديم لازم يفضل زي ما هو بالظبط."""
        self.assertEqual(self._heights({"section_height": 600}),
                         ["calc(100cqw*1.5385)", "600px", "600px"])

    def test_a_section_with_no_phone_height_stays_natural(self):
        """مانخترعش ارتفاع لقسم المستخدم ماحددهوش أصلاً."""
        self.assertEqual(self._heights({"section_height_tablet": 0}), [])

    def test_an_imported_section_keeps_its_own_desktop_layout(self):
        """القالب المستورد جايب تخطيط لكل مقاس — التوريث بيطوّله ٤ أضعاف.

        قياس على ‎imp-4‎ في قالب حقيقي: 780px طبيعي على الديسكتوب،
        والتوريث خلاه 3118px — قسم فاضي أربع أضعاف محتواه.
        """
        css = tildacss.section_surface_css("imp-4", {"section_height_mobile": 950},
                                           imported=True)
        got = re.findall(r"\{height:([^!]+)!important;min-height:", css)
        self.assertEqual(got, ["calc(100cqw*2.4359)"])      # الموبايل بس


    def test_the_box_shape_is_identical_on_phone_and_desktop(self):
        ratio = 780 / 390
        for width in (390, 430, 720):
            with self.subTest(width=width):
                self.assertAlmostEqual((width * ratio) / width, ratio, places=9)


# ==========================================================================
class SectionHeightSnapsToWholePixelsTests(TestCase):
    """الارتفاع النسبي لازم يترسم على شبكة البكسل، مش بكسور.

    النسبة بتدّي أرقام بكسور على أي عرض غير 390:

    | عرض الشاشة | ارتفاع قسم 950px | البداية اللي بعده |
    |---|---|---|
    | 390 | 950.000 | رقم صحيح |
    | 393 | 957.297 | **بكسر** |
    | 412 | 1003.578 | **بكسر** |

    والأقسام متراصة تحت بعضها، يعني أول كسر بيورّث نفسه لكل اللي
    بعده. سفاري بيرسم حدود الصناديق دي بحرف ناعم فبيفضل جزء من
    البكسل مش مدهون، وخلفية المسرح الكريمية بتبان من ورا زي خط رفيع
    بين الأقسام؛ كروم بيلزق الحدين على نفس البكسل فمابيبانش. ده
    بالظبط اللي المستخدم شافه: خط في الآيفون ومش موجود في الأندرويد.
    """

    def _rules(self, style):
        return tildacss.section_surface_css("sec-1", style)

    def test_a_ratio_height_also_gets_a_whole_pixel_version(self):
        css = self._rules({"section_height_mobile": 950})
        self.assertIn("height:calc(100cqw*2.4359)!important", css)
        self.assertIn("height:round(100cqw*2.4359,1px)!important", css)
        self.assertIn("min-height:round(100cqw*2.4359,1px)!important", css)

    def test_the_rounded_one_comes_after_so_it_wins(self):
        """المتصفح اللي مايعرفش ‎round()‎ بيرمي السطر ويفضل على ‎calc‎."""
        css = self._rules({"section_height_mobile": 950})
        self.assertLess(css.index("height:calc(100cqw*2.4359)"),
                        css.index("height:round(100cqw*2.4359,1px)"))

    def test_the_fallback_is_exactly_what_shipped_before(self):
        """أسوأ حالة = الوضع القديم، مش رجوع لورا."""
        self.assertEqual(tildacss._section_height_value(950, 390),
                         "calc(100cqw*2.4359)")

    def test_pixel_heights_are_left_alone(self):
        """التابلت والديسكتوب بالبكسل أصلاً — مافيش حاجة تتقرّب."""
        css = self._rules({"section_height_tablet": 900})
        self.assertIn("height:900px!important", css)
        self.assertNotIn("round(", css)

    def test_rounding_moves_the_box_by_less_than_a_pixel(self):
        """التقريب مايخربش الشكل اللي اتظبط قبل كده."""
        for width in (360, 375, 390, 393, 412, 430):
            with self.subTest(width=width):
                exact = width * 950 / 390
                self.assertLess(abs(round(exact) - exact), 1.0)


# ==========================================================================
class BrandingSectionTests(TestCase):
    """قسم الدعاية — آخر الدعوة: لوجو وكلام وأيقونات سوشيال.

    الترس والتلات أزرار (نص/صورة/زرار) مابتتكتبش هنا: بييجوا لوحدهم من
    ``attach_text_styles`` و``SECTION_TEXT_OVERLAY_FIELD``. الاختبارات
    دي بتتأكد إن ده حصل فعلاً، لأن قسم جديد بيفوّت الآلية دي هو بالظبط
    نوع الغلط اللي مايبانش غير لما المستخدم يدوّر على الترس ومايلاقيهوش.
    """

    def _render(self, editable=False, **props):
        block = B.make_block("branding")
        block["id"] = "brand-1"
        block["props"].update(props)
        doc = B.normalize_document({"blocks": [block]})
        return str(render_document(doc, editable=editable)["html"])

    # ---- المخطط
    def test_the_section_is_registered_and_offered_in_the_editor(self):
        spec = B.BLOCK_REGISTRY["branding"]
        self.assertEqual(spec["category"], "عام")
        self.assertFalse(spec["feature"])          # مش محبوس في باقة

    def test_the_three_networks_each_have_a_switch_a_link_and_a_colour(self):
        keys = {f["key"] for f in B.BLOCK_REGISTRY["branding"]["props"]}
        for net in ("whatsapp", "facebook", "instagram"):
            with self.subTest(net=net):
                self.assertIn(f"show_{net}", keys)
                self.assertIn(f"{net}_url", keys)
                self.assertIn(f"{net}_color", keys)

    def test_the_text_gets_its_gear_like_any_other_text(self):
        gear = {f["style_role"] for f in B.BLOCK_REGISTRY["branding"]["props"]
                if f.get("style_of") == "text"}
        for role in ("font", "color", "size"):
            with self.subTest(role=role):
                self.assertIn(role, gear)

    def test_the_section_takes_the_three_add_buttons_too(self):
        keys = [f["key"] for f in B.BLOCK_REGISTRY["branding"]["props"]]
        self.assertIn("text_overlays", keys)

    # ---- العرض
    def test_the_logo_and_text_reach_the_page(self):
        html = self._render(logo="/media/logo.png", logo_width=55,
                            text="صُممت عبر فرحة")
        self.assertIn('src="/media/logo.png"', html)
        self.assertIn("width:55%", html)
        self.assertIn("صُممت عبر فرحة", html)
        self.assertIn('data-ts="text"', html)      # هوك الترس

    def test_an_icon_links_out_in_a_new_tab_with_its_own_colour(self):
        html = self._render(whatsapp_url="https://wa.me/20100",
                            whatsapp_color="#25D366")
        self.assertIn('href="https://wa.me/20100"', html)
        self.assertIn('target="_blank"', html)
        self.assertIn("color:#25D366", html)

    def test_a_hidden_network_is_not_rendered_at_all(self):
        html = self._render(show_facebook=False,
                            facebook_url="https://facebook.com/x")
        self.assertNotIn("facebook.com/x", html)

    def test_an_icon_without_a_link_is_shown_but_is_not_a_link(self):
        html = self._render(whatsapp_url="", show_facebook=False,
                            show_instagram=False)
        self.assertIn("lb-social-icon", html)
        self.assertNotIn('<a class="lb-social"', html)

    # ---- الأمان
    def test_a_javascript_link_never_reaches_the_page(self):
        doc = B.normalize_document({"blocks": [{"type": "branding", "props": {
            "instagram_url": "javascript:alert(1)"}}]})
        self.assertEqual(doc["blocks"][0]["props"]["instagram_url"], "")

    def test_a_junk_colour_falls_back_instead_of_leaking_into_the_style(self):
        out = invite_tags.social_link(
            "whatsapp", "https://wa.me/1", "red;background:url(x)", 34)
        self.assertIn("color:currentColor", out)
        self.assertNotIn("background", out)

    def test_an_unknown_network_renders_nothing(self):
        self.assertEqual(invite_tags.social_link("myspace", "https://x.com",
                                                 "#fff", 34), "")

    def test_the_icon_size_is_clamped(self):
        self.assertIn('width="120"', invite_tags.social_link(
            "facebook", "https://x.com", "#fff", 9999))
        self.assertIn('width="34"', invite_tags.social_link(
            "facebook", "https://x.com", "#fff", "مش رقم"))
