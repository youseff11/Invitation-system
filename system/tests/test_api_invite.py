"""اختبارات عارض الدعوة (B3): صفحات الـshell، حمولة الـrender، كلمة السر، ورد الضيف (RSVP)."""

import json
import tempfile
from datetime import timedelta
from pathlib import Path

from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from system import blocks as B
from system.data import golden_classic
from system.api import invite_render
from system.models import Customer, Guest, Invitation, RSVPResponse, Template

MANIFEST = {
    "src/invite-main.tsx": {
        "file": "assets/invite-aaa.js", "isEntry": True,
        "css": ["assets/invite-bbb.css"], "imports": ["_vendor-1.js"],
    },
    "src/main.tsx": {"file": "assets/main-ccc.js", "isEntry": True},
    "_vendor-1.js": {"file": "assets/vendor-1.js"},
}


def post_json(client, url, data, **extra):
    return client.post(url, data=json.dumps(data), content_type="application/json", **extra)


class InviteBase(TestCase):
    def setUp(self):
        cache.clear()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        (Path(tmp.name) / "manifest.json").write_text(json.dumps(MANIFEST), encoding="utf-8")
        override = override_settings(VITE_BUILD_DIR=Path(tmp.name), VITE_DEV_SERVER="")
        override.enable()
        self.addCleanup(override.disable)

        self.template = Template.objects.create(
            name="ذهبي", slug="golden-t", document=golden_classic.build())
        self.customer = Customer.objects.create(name="عميل", phone="0100")
        self.inv = self.make_invitation()
        self.guest = Guest.objects.create(
            invitation=self.inv, name="ضيف", phone="01000000001", plus_ones_allowed=2)
        self.client = Client(enforce_csrf_checks=True)

    def make_invitation(self, **overrides):
        data = dict(
            customer=self.customer, template=self.template,
            name_one="ليلى", name_two="أحمد", status="published",
            event_date=timezone.now() + timedelta(days=30),
            document=self.template.get_document(),
        )
        data.update(overrides)
        return Invitation.objects.create(**data)

    def boot(self, response) -> dict:
        html = response.content.decode()
        marker = '<script id="invite-data" type="application/json">'
        start = html.index(marker) + len(marker)
        return json.loads(html[start:html.index("</script>", start)])

    def csrf(self):
        token = self.client.get("/api/v1/csrf/").json()["csrfToken"]
        return {"HTTP_X_CSRFTOKEN": token}

    def rsvp(self, data, inv=None, **extra):
        inv = inv or self.inv
        return post_json(self.client, f"/api/v1/invitations/{inv.slug}/rsvp/", data,
                         **self.csrf(), **extra)

    def set_rsvp_props(self, **props):
        doc = self.inv.get_document()
        for block in doc["blocks"]:
            if block["type"] == "rsvp":
                block["props"].update(props)
        self.inv.document = doc
        self.inv.save()


# ---------------------------------------------------------------- صفحة الدعوة (shell)
class InvitePageTests(InviteBase):
    def test_published_invitation_renders_shell_with_og_head(self):
        response = self.client.get(f"/app/i/{self.inv.slug}/")
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "spa/invite.html")
        html = response.content.decode()
        for needle in (
            '<title>ليلى و أحمد</title>', 'property="og:title"', 'property="og:description"',
            'property="og:url"', 'name="twitter:card"', 'name="twitter:title"',
            'rel="canonical"', 'name="robots" content="noindex, nofollow"',
            'property="og:locale" content="ar_AR"',
        ):
            self.assertIn(needle, html)
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        self.assertIn("csrftoken", response.cookies)
        self.assertIn("no-store", response["Cache-Control"])
        # الـentry الخاص بالدعوة بس — مش التطبيق الكامل
        self.assertIn("assets/invite-aaa.js", html)
        self.assertIn("assets/invite-bbb.css", html)
        self.assertNotIn("assets/main-ccc.js", html)

    def test_canonical_points_to_public_invitation_url(self):
        html = self.client.get(f"/app/i/{self.inv.slug}/").content.decode()
        self.assertIn(f'href="http://testserver/i/{self.inv.slug}/"', html)

    def test_share_title_and_description_come_from_document_settings(self):
        doc = self.inv.get_document()
        doc["settings"]["share_title"] = "دعوة خاصة"
        doc["settings"]["share_description"] = "نشرّفكم بحضوركم"
        self.inv.document = doc
        self.inv.save()
        html = self.client.get(f"/app/i/{self.inv.slug}/").content.decode()
        self.assertIn('<meta property="og:title" content="دعوة خاصة">', html)
        self.assertIn('<meta property="og:description" content="نشرّفكم بحضوركم">', html)

    def test_og_image_is_absolute_with_size(self):
        self.template.cover_url = "https://cdn.example.com/cover.jpg"
        self.template.save()
        html = self.client.get(f"/app/i/{self.inv.slug}/").content.decode()
        self.assertIn('property="og:image" content="https://cdn.example.com/cover.jpg"', html)
        self.assertIn('name="twitter:card" content="summary_large_image"', html)

    def test_boot_payload_has_blocks_without_inline_css(self):
        boot = self.boot(self.client.get(f"/app/i/{self.inv.slug}/"))
        self.assertEqual(boot["mode"], "view")
        self.assertEqual(boot["kind"], "invitation")
        self.assertNotIn("css", boot)            # الستايل في الـhead مش في JSON
        self.assertIn("hero", [b["type"] for b in boot["blocks"]])
        self.assertIsNone(boot["guest"])

    def test_layout_css_is_printed_in_head(self):
        html = self.client.get(f"/app/i/{self.inv.slug}/").content.decode()
        self.assertIn('class="lb-doc"', html)
        self.assertIn("--accent", html)           # متغيّرات الثيم على الـbody

    def test_unpublished_is_404(self):
        for status in ("draft", "review", "archived"):
            inv = self.make_invitation(status=status)
            self.assertEqual(self.client.get(f"/app/i/{inv.slug}/").status_code, 404, status)

    def test_expired_is_404(self):
        inv = self.make_invitation(expires_at=timezone.now() - timedelta(days=1))
        self.assertEqual(self.client.get(f"/app/i/{inv.slug}/").status_code, 404)

    def test_unknown_slug_is_404(self):
        self.assertEqual(self.client.get("/app/i/nope/").status_code, 404)

    def test_view_counter_counts_get_not_head(self):
        self.client.get(f"/app/i/{self.inv.slug}/")
        self.client.get(f"/app/i/{self.inv.slug}/")
        self.client.head(f"/app/i/{self.inv.slug}/")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.public_views, 2)

    def test_post_not_allowed(self):
        self.assertEqual(Client().post(f"/app/i/{self.inv.slug}/").status_code, 405)

    def test_language_param_falls_back_when_no_translation(self):
        boot = self.boot(self.client.get(f"/app/i/{self.inv.slug}/?lang=en"))
        self.assertEqual(boot["lang"], "ar")
        self.assertFalse(boot["hasAlt"])

    def test_language_param_uses_translation_when_present(self):
        doc = self.inv.get_document()
        hero = next(b for b in doc["blocks"] if b["type"] == "hero")
        doc["i18n"] = {"en": {f"{hero['id']}.kicker": "Wedding invitation"}, "ar": {}}
        self.inv.document = doc
        self.inv.save()
        response = self.client.get(f"/app/i/{self.inv.slug}/?lang=en")
        boot = self.boot(response)
        self.assertEqual(boot["lang"], "en")
        self.assertEqual(boot["dir"], "ltr")
        self.assertTrue(boot["hasAlt"])
        self.assertIn('lang="en" dir="ltr"', response.content.decode())
        self.assertIn('property="og:locale" content="en_US"', response.content.decode())
        hero_block = next(b for b in boot["blocks"] if b["type"] == "hero")
        self.assertEqual(hero_block["props"]["kicker"], "Wedding invitation")
        # بدون ?lang= بيفضل الأساسي
        self.assertEqual(self.boot(self.client.get(f"/app/i/{self.inv.slug}/"))["lang"], "ar")


class PasswordTests(InviteBase):
    def setUp(self):
        super().setUp()
        self.inv.password = "s3cret"
        self.inv.save()
        self.url = f"/app/i/{self.inv.slug}/"

    def test_locked_shell_leaks_nothing(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        boot = self.boot(response)
        self.assertEqual(boot["mode"], "locked")
        self.assertNotIn("blocks", boot)
        html = response.content.decode()
        self.assertNotIn("ليلى", html)
        self.assertIn("دعوة محمية", html)
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.public_views, 0)

    def test_render_api_requires_unlock(self):
        response = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "locked")

    def test_wrong_password_rejected(self):
        response = post_json(self.client, f"/api/v1/invitations/{self.inv.slug}/unlock/",
                             {"password": "bad"}, **self.csrf())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "wrong_password")
        self.assertEqual(self.boot(self.client.get(self.url))["mode"], "locked")

    def test_unlock_then_shell_and_render_work(self):
        response = post_json(self.client, f"/api/v1/invitations/{self.inv.slug}/unlock/",
                             {"password": "s3cret"}, **self.csrf())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.boot(self.client.get(self.url))["mode"], "view")
        self.assertEqual(
            self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").status_code, 200)

    def test_unlock_requires_csrf(self):
        response = post_json(self.client, f"/api/v1/invitations/{self.inv.slug}/unlock/",
                             {"password": "s3cret"})
        self.assertEqual(response.status_code, 403)

    def test_unlock_attempts_are_throttled(self):
        for _ in range(20):
            post_json(self.client, f"/api/v1/invitations/{self.inv.slug}/unlock/",
                      {"password": "x"}, **self.csrf())
        response = post_json(self.client, f"/api/v1/invitations/{self.inv.slug}/unlock/",
                             {"password": "s3cret"}, **self.csrf())
        self.assertEqual(response.status_code, 429)

    def test_unlock_does_not_unlock_other_invitation(self):
        other = self.make_invitation(password="other")
        post_json(self.client, f"/api/v1/invitations/{self.inv.slug}/unlock/",
                  {"password": "s3cret"}, **self.csrf())
        self.assertEqual(self.boot(self.client.get(f"/app/i/{other.slug}/"))["mode"], "locked")

    def test_guest_link_skips_password(self):
        boot = self.boot(self.client.get(f"/app/i/{self.inv.slug}/g/{self.guest.token}/"))
        self.assertEqual(boot["mode"], "view")
        self.assertEqual(boot["guest"]["name"], "ضيف")


class GuestTokenTests(InviteBase):
    def test_valid_token_sets_guest_and_prefills_rsvp(self):
        boot = self.boot(self.client.get(f"/app/i/{self.inv.slug}/g/{self.guest.token}/"))
        self.assertEqual(boot["guest"], {"name": "ضيف", "token": self.guest.token})
        rsvp = next(b for b in boot["blocks"] if b["type"] == "rsvp")
        self.assertEqual(rsvp["rsvp"]["guest"]["name"], "ضيف")
        self.assertEqual(rsvp["rsvp"]["guest"]["maxCompanions"], 2)
        self.assertEqual(boot["intro"]["guestName"], "ضيف")

    def test_wrong_token_404(self):
        self.assertEqual(
            self.client.get(f"/app/i/{self.inv.slug}/g/{'x' * 24}/").status_code, 404)

    def test_token_length_bounds_404(self):
        for token in ("short", "x" * 65):
            self.assertEqual(
                self.client.get(f"/app/i/{self.inv.slug}/g/{token}/").status_code, 404, token)

    def test_token_from_another_invitation_404(self):
        other = self.make_invitation()
        stranger = Guest.objects.create(invitation=other, name="غريب")
        self.assertEqual(
            self.client.get(f"/app/i/{self.inv.slug}/g/{stranger.token}/").status_code, 404)

    def test_guest_link_does_not_skip_publication(self):
        self.inv.status = "draft"
        self.inv.save()
        self.assertEqual(
            self.client.get(f"/app/i/{self.inv.slug}/g/{self.guest.token}/").status_code, 404)

    def test_guest_visit_counts_a_view(self):
        self.client.get(f"/app/i/{self.inv.slug}/g/{self.guest.token}/")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.public_views, 1)


class TemplatePreviewPageTests(InviteBase):
    def test_preview_page_and_head(self):
        response = self.client.get("/app/templates/golden-t/preview/")
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn("<title>معاينة قالب ذهبي</title>", html)
        self.assertIn('property="og:title" content="معاينة قالب ذهبي"', html)
        self.assertIn('href="http://testserver/templates/golden-t/preview/"', html)
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        boot = self.boot(response)
        self.assertEqual(boot["kind"], "template")
        self.assertTrue(boot["demo"])

    def test_preview_rsvp_is_demo(self):
        boot = self.boot(self.client.get("/app/templates/golden-t/preview/"))
        rsvp = next(b for b in boot["blocks"] if b["type"] == "rsvp")
        self.assertTrue(rsvp["rsvp"]["demo"])
        self.assertEqual(rsvp["rsvp"]["action"], "")

    def test_inactive_or_unknown_template_404(self):
        self.assertEqual(self.client.get("/app/templates/nope/preview/").status_code, 404)
        self.template.is_active = False
        self.template.save()
        self.assertEqual(self.client.get("/app/templates/golden-t/preview/").status_code, 404)

    def test_preview_does_not_touch_any_invitation_counter(self):
        self.client.get("/app/templates/golden-t/preview/")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.public_views, 0)


# ---------------------------------------------------------------- API الحمولة
class RenderApiTests(InviteBase):
    def test_render_returns_css_and_blocks_and_no_view_count(self):
        response = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(set(data["css"]), {"font", "layout", "shared", "zero"})
        self.assertTrue(data["bodyStyle"].startswith("--bg:"))
        types = [b["type"] for b in data["blocks"]]
        self.assertEqual(types[0], "hero")
        self.assertIn("rsvp", types)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.public_views, 0)

    def test_render_404_for_unpublished(self):
        self.inv.status = "draft"
        self.inv.save()
        self.assertEqual(
            self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").status_code, 404)

    def test_render_with_guest_param(self):
        response = self.client.get(
            f"/api/v1/invitations/{self.inv.slug}/render/?guest={self.guest.token}")
        self.assertEqual(response.json()["guest"]["name"], "ضيف")
        bad = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/?guest=nopenope1")
        self.assertEqual(bad.status_code, 404)

    def test_hidden_blocks_are_not_sent(self):
        doc = self.inv.get_document()
        for block in doc["blocks"]:
            if block["type"] == "quote":
                block["visible"] = False
        self.inv.document = doc
        self.inv.save()
        data = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").json()
        self.assertNotIn("quote", [b["type"] for b in data["blocks"]])

    def test_every_block_type_serializes(self):
        doc = self.inv.get_document()
        doc["blocks"] = [B.make_block(t) for t in B.BLOCK_REGISTRY]
        self.inv.document = doc
        self.inv.save()
        response = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/")
        self.assertEqual(response.status_code, 200)
        sent = {b["type"] for b in response.json()["blocks"]}
        # «الدعاية» لما تكون فاضية بتتشال عند الضيف زي القديم؛ والباقي كله بيوصل
        self.assertEqual(set(B.BLOCK_REGISTRY) - sent - {"branding"}, set())

    def test_custom_html_is_sanitized_and_scoped_on_server(self):
        doc = self.inv.get_document()
        block = B.make_block("custom_html", props={
            "html": '<p onclick="x()">مرحبا</p><script>alert(1)</script>',
            "css": "p{color:red}",
        })
        doc["blocks"] = [block]
        self.inv.document = doc
        self.inv.save()
        data = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").json()
        props = data["blocks"][0]["props"]
        self.assertIn("مرحبا", props["html"])
        self.assertNotIn("<script", props["html"])
        self.assertNotIn("onclick", props["html"])
        self.assertIn(f"#{block['id']}", props["css"])

    def test_text_body_is_sanitized(self):
        doc = self.inv.get_document()
        doc["blocks"] = [B.make_block("text", props={"body": "<b>مهم</b><img src=x onerror=alert(1)>"})]
        self.inv.document = doc
        self.inv.save()
        data = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").json()
        body = data["blocks"][0]["props"]["bodyHtml"]
        self.assertIn("<b>مهم</b>", body)
        self.assertNotIn("onerror", body)

    def test_branding_social_links_are_validated(self):
        socials = invite_render._socials({
            "show_whatsapp": True, "whatsapp_url": "javascript:alert(1)",
            "show_facebook": True, "facebook_url": "https://facebook.com/x",
            "facebook_color": "red;background:url(x)",
            "show_instagram": False,
        })
        by_name = {s["name"]: s for s in socials}
        self.assertNotIn("instagram", by_name)
        self.assertEqual(by_name["whatsapp"]["href"], "")
        self.assertEqual(by_name["facebook"]["href"], "https://facebook.com/x")
        self.assertEqual(by_name["facebook"]["color"], "currentColor")

    def test_template_preview_api_and_cache(self):
        first = self.client.get("/api/v1/templates/golden-t/preview/")
        self.assertEqual(first.status_code, 200)
        second = self.client.get("/api/v1/templates/golden-t/preview/")
        self.assertEqual(first.json()["blocks"], second.json()["blocks"])
        self.assertEqual(self.client.get("/api/v1/templates/nope/preview/").status_code, 404)

    def test_runtime_scripts_and_root_attrs_are_forwarded(self):
        self.template.runtime_scripts = [
            {"src": "https://cdn.example.com/a.js"}, {"code": "window.__x=1"}, {"bad": True}]
        self.template.runtime_root_attrs = {"data-rec": "1", "onclick": "evil()", "class": "x"}
        self.template.save()
        data = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").json()
        self.assertEqual(len(data["runtimeScripts"]), 2)
        self.assertTrue(data["stage"]["runtime"])
        # data-* بس: أي سمة تانية (onclick…) ماتتبعتش
        self.assertEqual(data["stage"]["rootAttrs"], {"data-rec": "1"})


# ---------------------------------------------------------------- RSVP
class RsvpApiTests(InviteBase):
    def test_attending_creates_response_guest_and_pass(self):
        response = self.rsvp({"name": "منى", "phone": "0111", "status": "attending",
                              "companions": 1, "message": "مبروك"})
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["ok"])
        self.assertTrue(data["message"])
        self.assertIn("code", data["pass"])
        rsvp = RSVPResponse.objects.get(invitation=self.inv, name="منى")
        self.assertEqual(rsvp.status, "attending")
        self.assertEqual(rsvp.message, "مبروك")
        guest = Guest.objects.get(invitation=self.inv, name="منى")
        self.assertEqual(guest.source, "rsvp")
        self.assertEqual(rsvp.guest, guest)

    def test_pass_urls_are_internal(self):
        data = self.rsvp({"name": "منى", "status": "attending"}).json()
        self.assertTrue(data["pass"]["url"].startswith("/app/i/"))
        self.assertTrue(data["pass"]["qr"].endswith("qr.svg"))

    def test_declined_has_no_pass(self):
        data = self.rsvp({"name": "منى", "status": "declined"}).json()
        self.assertNotIn("pass", data)
        self.assertFalse(Guest.objects.filter(invitation=self.inv, name="منى").exists())

    def test_invalid_status_defaults_to_attending(self):
        self.rsvp({"name": "منى", "status": "hack"})
        self.assertEqual(RSVPResponse.objects.get(name="منى").status, "attending")

    def test_name_validation(self):
        response = self.rsvp({"name": " م "})
        self.assertEqual(response.status_code, 400)
        error = response.json()["error"]
        self.assertEqual(error["code"], "invalid_name")
        self.assertIn("name", error["fields"])
        self.assertEqual(RSVPResponse.objects.count(), 0)

    def test_messages_follow_language(self):
        ar = self.rsvp({"name": "x"}).json()["error"]["message"]
        en = self.rsvp({"name": "x", "lang": "en"}).json()["error"]["message"]
        self.assertEqual(ar, "يرجى كتابة الاسم.")
        self.assertEqual(en, "Please enter your name.")

    def test_invalid_json(self):
        response = self.client.post(
            f"/api/v1/invitations/{self.inv.slug}/rsvp/", data="nope",
            content_type="application/json", **self.csrf())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_json")

    def test_requires_csrf(self):
        response = post_json(self.client, f"/api/v1/invitations/{self.inv.slug}/rsvp/",
                             {"name": "منى"})
        self.assertEqual(response.status_code, 403)

    def test_get_not_allowed(self):
        self.assertEqual(
            self.client.get(f"/api/v1/invitations/{self.inv.slug}/rsvp/").status_code, 405)

    def test_unpublished_invitation_404(self):
        self.inv.status = "draft"
        self.inv.save()
        self.assertEqual(self.rsvp({"name": "منى"}).status_code, 404)

    @override_settings(RSVP_RATE_LIMIT_PER_HOUR=2)
    def test_rate_limit(self):
        self.assertEqual(self.rsvp({"name": "أول"}).status_code, 200)
        self.assertEqual(self.rsvp({"name": "تاني"}).status_code, 200)
        response = self.rsvp({"name": "تالت"})
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"]["code"], "rate_limited")
        self.assertFalse(RSVPResponse.objects.filter(name="تالت").exists())

    def test_rate_limit_is_per_invitation(self):
        other = self.make_invitation()
        with override_settings(RSVP_RATE_LIMIT_PER_HOUR=1):
            self.assertEqual(self.rsvp({"name": "أحمد"}).status_code, 200)
            self.assertEqual(self.rsvp({"name": "بسمة"}).status_code, 429)
            self.assertEqual(self.rsvp({"name": "جميلة"}, inv=other).status_code, 200)

    def test_honeypot_is_silently_accepted(self):
        response = self.rsvp({"name": "بوت", "website": "http://spam"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertFalse(RSVPResponse.objects.exists())

    def test_companions_clamped_to_block_limit(self):
        self.set_rsvp_props(ask_companions=True, max_companions=2)
        self.rsvp({"name": "منى", "companions": 9})
        self.assertEqual(RSVPResponse.objects.get(name="منى").companions, 2)
        self.rsvp({"name": "نور", "companions": -3})
        self.assertEqual(RSVPResponse.objects.get(name="نور").companions, 0)

    def test_phone_and_status_locks_from_editor(self):
        self.set_rsvp_props(ask_phone=False, ask_status=False)
        self.rsvp({"name": "منى", "phone": "0100", "status": "declined"})
        rsvp = RSVPResponse.objects.get(name="منى")
        self.assertEqual(rsvp.phone, "")
        self.assertEqual(rsvp.status, "attending")

    def test_show_pass_off_hides_pass_but_keeps_guest(self):
        self.set_rsvp_props(show_pass=False)
        data = self.rsvp({"name": "منى"}).json()
        self.assertNotIn("pass", data)
        self.assertTrue(Guest.objects.filter(invitation=self.inv, name="منى").exists())

    def test_duplicate_anonymous_reply_within_ten_minutes(self):
        self.rsvp({"name": "منى"})
        data = self.rsvp({"name": "منى"}).json()
        self.assertTrue(data["ok"])
        self.assertEqual(RSVPResponse.objects.filter(name="منى").count(), 1)

    def test_guest_token_updates_previous_reply(self):
        first = self.rsvp({"name": "ضيف", "guestToken": self.guest.token, "status": "attending",
                           "companions": 2, "message": "أول"}).json()
        self.assertTrue(first["ok"])
        self.rsvp({"name": "ضيف", "guestToken": self.guest.token, "status": "declined"})
        rows = RSVPResponse.objects.filter(invitation=self.inv, guest=self.guest)
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().status, "declined")
        self.assertEqual(rows.get().message, "أول")          # الرسالة القديمة بتفضل

    def test_guest_companions_limited_by_guest_allowance(self):
        self.set_rsvp_props(ask_companions=True, max_companions=5)
        self.rsvp({"name": "ضيف", "guestToken": self.guest.token, "companions": 5})
        self.assertEqual(RSVPResponse.objects.get(guest=self.guest).companions, 2)

    def test_foreign_guest_token_is_ignored(self):
        other = self.make_invitation()
        stranger = Guest.objects.create(invitation=other, name="غريب")
        self.rsvp({"name": "منى", "guestToken": stranger.token})
        self.assertFalse(RSVPResponse.objects.filter(invitation=self.inv, guest=stranger).exists())
        self.assertFalse(RSVPResponse.objects.filter(invitation=other).exists())

    def test_custom_questions_answers_are_validated_against_document(self):
        self.set_rsvp_props(questions=[
            {"kind": "choice", "label": "الوجبة", "options": [{"label": "لحم"}, {"label": "سمك"}]},
            {"kind": "choice", "label": "الحلو", "multiple": True,
             "options": [{"label": "كيك"}, {"label": "آيس"}]},
            {"kind": "text", "label": "حساسية"},
        ])
        self.rsvp({"name": "منى", "answers": {
            "q0": "لحم", "q1": ["كيك", "مخترع"], "q2": "  مكسرات  ", "q9": "x"}})
        answers = RSVPResponse.objects.get(name="منى").answers
        self.assertEqual([a["q"] for a in answers], ["الوجبة", "الحلو", "حساسية"])
        self.assertEqual(answers[0]["a"], "لحم")
        self.assertEqual(answers[1]["a"], "كيك")              # الاختيار المخترع اتشال
        self.assertEqual(answers[2]["a"], "مكسرات")

    def test_choice_answer_outside_options_is_dropped(self):
        self.set_rsvp_props(questions=[
            {"kind": "choice", "label": "الوجبة", "options": [{"label": "لحم"}]}])
        self.rsvp({"name": "منى", "answers": {"q0": "حاجة تانية"}})
        self.assertEqual(RSVPResponse.objects.get(name="منى").answers, [])

    def test_render_payload_exposes_questions_and_closed_flag(self):
        self.set_rsvp_props(
            questions=[{"kind": "text", "label": "سؤال"}],
            deadline=(timezone.localdate() - timedelta(days=1)).isoformat())
        data = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").json()
        rsvp = next(b for b in data["blocks"] if b["type"] == "rsvp")["rsvp"]
        self.assertTrue(rsvp["closed"])
        self.assertEqual(rsvp["questions"][0]["name"], "q0")
        self.assertEqual(rsvp["action"], f"/api/v1/invitations/{self.inv.slug}/rsvp/")

    def test_only_approved_wishes_are_exposed(self):
        RSVPResponse.objects.create(invitation=self.inv, name="أ", message="مبروك", is_approved=True)
        RSVPResponse.objects.create(invitation=self.inv, name="ب", message="سرّي", is_approved=False)
        self.set_rsvp_props(show_wishes=True)
        data = self.client.get(f"/api/v1/invitations/{self.inv.slug}/render/").json()
        rsvp = next(b for b in data["blocks"] if b["type"] == "rsvp")["rsvp"]
        self.assertEqual([w["name"] for w in rsvp["wishes"]], ["أ"])
