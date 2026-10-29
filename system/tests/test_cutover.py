"""اختبارات التحويل النهائي (Phase D): ‎SPA_BASENAME‎ فاضي = React على الجذر.

الأهم: كل رابط اتبعت للضيوف (دعوة، رابط شخصي، تصريح، عميل، قاعة، QR) بيفضل شغّال بنفس شكله.
بنعيد تحميل ‎Core.urls‎ بـ‎SPA_BASENAME=""‎ جوّه الاختبار ونرجّعه بعده.
"""

import importlib

from django.test import override_settings
from django.urls import clear_url_caches, resolve, reverse

from system.api.invite_page import invitation_page, template_page
from system.spa import spa_shell
from system.tests.test_api_invite import InviteBase


def _reload_urls():
    import Core.urls
    import system.urls

    clear_url_caches()
    importlib.reload(system.urls)  # الـredirect من ‎/app/‎ بيتسجّل حسب ‎SPA_BASENAME‎ وقت الاستيراد
    importlib.reload(Core.urls)
    clear_url_caches()


class CutoverTests(InviteBase):
    def setUp(self):
        super().setUp()
        # LIFO: الـoverride بيتشال الأول وبعدين الـURLconf بيتحمّل بالقيمة الأصلية
        self.addCleanup(_reload_urls)
        override = override_settings(SPA_BASENAME="", ROOT_URLCONF="Core.urls")
        override.enable()
        self.addCleanup(override.disable)
        _reload_urls()
        self.client = self.client_class()

    # -------------------------------------------------------------- الأسماء والمسارات
    def test_reversed_links_keep_their_old_shape(self):
        slug, token = self.inv.slug, self.guest.token
        self.assertEqual(reverse("invitation_public", kwargs={"slug": slug}), f"/i/{slug}/")
        self.assertEqual(reverse("invitation_guest", kwargs={"slug": slug, "token": token}), f"/i/{slug}/g/{token}/")
        self.assertEqual(reverse("guest_pass", kwargs={"slug": slug, "token": token}), f"/i/{slug}/g/{token}/pass/")
        self.assertEqual(reverse("invitation_client_followup", kwargs={"slug": slug, "token": "c"}), f"/i/{slug}/client/c/")
        self.assertEqual(reverse("invitation_venue", kwargs={"slug": slug, "token": "v"}), f"/i/{slug}/venue/v/")
        self.assertEqual(reverse("template_demo", kwargs={"slug": "golden-t"}), "/templates/golden-t/preview/")
        self.assertEqual(reverse("template_gallery"), "/templates/")
        self.assertEqual((reverse("home"), reverse("login"), reverse("dashboard")), ("/", "/login/", "/dashboard/"))

    def test_models_still_build_the_shared_urls(self):
        self.assertEqual(self.inv.get_absolute_url(), f"/i/{self.inv.slug}/")
        self.assertIn(f"/i/{self.inv.slug}/client/", self.inv.get_client_followup_url())
        self.assertIn(f"/i/{self.inv.slug}/venue/", self.inv.get_venue_url())

    def test_pages_are_served_by_react(self):
        slug, token = self.inv.slug, self.guest.token
        self.assertIs(resolve(f"/i/{slug}/").func, invitation_page)
        self.assertIs(resolve(f"/i/{slug}").func, invitation_page)  # من غير سلاش
        self.assertIs(resolve(f"/i/{slug}/g/{token}/").func, invitation_page)
        self.assertIs(resolve(f"/templates/{self.template.slug}/preview/").func, template_page)
        for path in ("/", "/login/", "/templates/", "/dashboard/", "/dashboard/invitations/1/editor",
                     f"/i/{slug}/g/{token}/pass/", f"/i/{slug}/client/c/", f"/i/{slug}/venue/v/", "/anything/else"):
            with self.subTest(path=path):
                self.assertIs(resolve(path).func, spa_shell)

    # -------------------------------------------------------------- طلبات حقيقية
    def test_old_shared_links_answer(self):
        slug, token = self.inv.slug, self.guest.token
        self.assertEqual(self.client.get(f"/i/{slug}/").status_code, 200)
        self.assertEqual(self.client.get(f"/i/{slug}/g/{token}/").status_code, 200)
        self.assertEqual(self.client.get(f"/i/{slug}/g/{token}/pass/").status_code, 200)
        self.assertEqual(self.client.get(f"/i/{slug}/client/{self.inv.client_token}/").status_code, 200)

    def test_qr_images_are_still_django(self):
        slug, token = self.inv.slug, self.guest.token
        png = self.client.get(f"/i/{slug}/g/{token}/qr.png")
        self.assertEqual((png.status_code, png["Content-Type"]), (200, "image/png"))
        svg = self.client.get(f"/i/{slug}/g/{token}/qr.svg")
        self.assertEqual((svg.status_code, svg["Content-Type"]), (200, "image/svg+xml"))
        self.assertEqual(self.client.get(f"/i/{slug}/qr.svg")["Content-Type"], "image/svg+xml")

    def test_robots_sitemap_and_api_are_not_swallowed(self):
        self.assertEqual(self.client.get("/robots.txt")["Content-Type"].split(";")[0], "text/plain")
        sitemap = self.client.get("/sitemap.xml")
        self.assertEqual(sitemap.status_code, 200)
        self.assertIn("/templates/", sitemap.content.decode())
        self.assertEqual(self.client.get("/api/v1/site/")["Content-Type"], "application/json")
        self.assertEqual(self.client.get("/admin/login/").status_code, 200)

    def test_old_app_prefix_redirects_permanently(self):
        slug, token = self.inv.slug, self.guest.token
        for old, new in (
            (f"/app/i/{slug}/g/{token}/", f"/i/{slug}/g/{token}/"),
            ("/app/dashboard/?x=1", "/dashboard/?x=1"),
            ("/app/", "/"),
            ("/app", "/"),
        ):
            with self.subTest(old=old):
                response = self.client.get(old)
                self.assertEqual((response.status_code, response["Location"]), (301, new))

    def test_shell_is_no_longer_noindex(self):
        response = self.client.get("/")
        self.assertNotIn("X-Robots-Tag", response)
        self.assertNotIn(b'content="noindex', response.content)
