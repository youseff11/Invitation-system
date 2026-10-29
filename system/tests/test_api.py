"""اختبارات واجهة JSON (‎/api/v1/‎) وصفحة الـshell لتطبيق React."""

import json
import tempfile
from pathlib import Path

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.exceptions import ImproperlyConfigured
from django.test import Client, SimpleTestCase, TestCase, override_settings
from django.template import Context, Template as DjangoTemplate

from system.models import Template


def _post_json(client, url, data):
    return client.post(url, data=json.dumps(data), content_type="application/json")


class ApiTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user("owner", password="s3cret-Passw0rd!", is_staff=True)
        self.client = Client(enforce_csrf_checks=True)

    def csrf_headers(self):
        """يمشي نفس مسار المتصفح: يطلب الرمز الأول ثم يبعته في الهيدر."""
        token = self.client.get("/api/v1/csrf/").json()["csrfToken"]
        return {"HTTP_X_CSRFTOKEN": token}

    def login(self, password="s3cret-Passw0rd!"):
        return self.client.post(
            "/api/v1/auth/login/",
            data=json.dumps({"username": "owner", "password": password}),
            content_type="application/json",
            **self.csrf_headers(),
        )


class SessionApiTests(ApiTestCase):
    def test_csrf_sets_cookie_and_returns_token(self):
        response = self.client.get("/api/v1/csrf/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", response.cookies)
        self.assertTrue(response.json()["csrfToken"])

    def test_me_anonymous(self):
        self.assertEqual(self.client.get("/api/v1/me/").json(), {"user": None})

    def test_login_success_then_me(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        user = response.json()["user"]
        self.assertEqual(user["username"], "owner")
        self.assertTrue(user["isStaff"])
        self.assertEqual(self.client.get("/api/v1/me/").json()["user"]["username"], "owner")

    def test_login_wrong_password(self):
        response = self.login(password="nope")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_credentials")
        self.assertIsNone(self.client.get("/api/v1/me/").json()["user"])

    def test_login_missing_fields(self):
        response = self.client.post(
            "/api/v1/auth/login/", data="{}", content_type="application/json",
            **self.csrf_headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "missing_credentials")
        self.assertIn("username", response.json()["error"]["fields"])

    def test_login_invalid_json(self):
        response = self.client.post(
            "/api/v1/auth/login/", data="not json", content_type="application/json",
            **self.csrf_headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_json")

    def test_login_requires_csrf(self):
        response = _post_json(self.client, "/api/v1/auth/login/",
                              {"username": "owner", "password": "s3cret-Passw0rd!"})
        self.assertEqual(response.status_code, 403)

    def test_login_inactive_user_rejected(self):
        self.user.is_active = False
        self.user.save()
        self.assertEqual(self.login().status_code, 400)

    def test_login_is_throttled_after_repeated_failures(self):
        for _ in range(8):
            self.assertEqual(self.login(password="bad").status_code, 400)
        blocked = self.login(password="bad")
        self.assertEqual(blocked.status_code, 429)
        # حتى كلمة المرور الصح بتتحجب أثناء فترة الإيقاف
        self.assertEqual(self.login().status_code, 429)

    def test_successful_login_resets_throttle(self):
        for _ in range(3):
            self.login(password="bad")
        self.assertEqual(self.login().status_code, 200)
        self.client.post("/api/v1/auth/logout/", **self.csrf_headers())
        for _ in range(8):
            self.assertEqual(self.login(password="bad").status_code, 400)

    def test_login_wrong_method(self):
        response = self.client.get("/api/v1/auth/login/")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "POST")

    def test_logout(self):
        self.login()
        response = self.client.post("/api/v1/auth/logout/", **self.csrf_headers())
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(self.client.get("/api/v1/me/").json()["user"])


class LanguageApiTests(ApiTestCase):
    def test_sets_cookie(self):
        response = self.client.post(
            "/api/v1/language/", data=json.dumps({"language": "en"}),
            content_type="application/json", **self.csrf_headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.cookies["django_language"].value, "en")

    def test_rejects_unknown_language(self):
        response = self.client.post(
            "/api/v1/language/", data=json.dumps({"language": "xx"}),
            content_type="application/json", **self.csrf_headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_language")


class PublicApiTests(ApiTestCase):
    def test_site_payload(self):
        data = self.client.get("/api/v1/site/").json()
        self.assertEqual({lang["code"] for lang in data["languages"]}, {"ar", "en"})
        self.assertIn("ar", data["name"])
        self.assertIn("floatReady", data["whatsapp"])
        self.assertIsInstance(data["ordersEnabled"], bool)

    def test_templates_only_active_and_filtered(self):
        Template.objects.create(name="زفاف ١", category="wedding", is_active=True)
        Template.objects.create(name="عيد ميلاد", category="birthday", is_active=True)
        Template.objects.create(name="مخفي", category="wedding", is_active=False)

        everything = self.client.get("/api/v1/templates/").json()
        self.assertEqual({t["name"] for t in everything["results"]}, {"زفاف ١", "عيد ميلاد"})
        self.assertNotIn("none", {c["value"] for c in everything["categories"]})

        only = self.client.get("/api/v1/templates/?category=birthday").json()
        self.assertEqual([t["name"] for t in only["results"]], ["عيد ميلاد"])

    def test_templates_cards_do_not_leak_document(self):
        Template.objects.create(name="قالب", category="wedding")
        card = self.client.get("/api/v1/templates/").json()["results"][0]
        self.assertNotIn("document", card)
        self.assertNotIn("runtime_scripts", card)

    def test_unknown_api_path_returns_404(self):
        self.assertEqual(self.client.get("/api/v1/nope/").status_code, 404)


# --------------------------------------------------------------------------
def _write_manifest(directory: Path, manifest: dict) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


MANIFEST = {
    "src/main.tsx": {
        "file": "assets/main-abc123.js", "isEntry": True,
        "css": ["assets/main-def456.css"],
        "imports": ["_vendor-111.js"],
    },
    "_vendor-111.js": {"file": "assets/vendor-111.js", "css": ["assets/vendor-222.css"]},
}


class ShellTests(TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        _write_manifest(Path(self._tmp.name), MANIFEST)
        override = override_settings(VITE_BUILD_DIR=Path(self._tmp.name), VITE_DEV_SERVER="")
        override.enable()
        self.addCleanup(override.disable)

    def boot(self, response) -> dict:
        html = response.content.decode()
        marker = '<script id="boot-data" type="application/json">'
        start = html.index(marker) + len(marker)
        return json.loads(html[start:html.index("</script>", start)])

    def test_shell_serves_react_router_paths(self):
        for path in ["/app/", "/app", "/app/dashboard/invitations/4/editor"]:
            response = self.client.get(path, follow=True)
            self.assertEqual(response.status_code, 200, path)
            self.assertTemplateUsed(response, "spa/shell.html")

    def test_shell_sets_csrf_cookie_and_is_noindex_during_migration(self):
        response = self.client.get("/app/")
        self.assertIn("csrftoken", response.cookies)
        self.assertEqual(response["X-Robots-Tag"], "noindex, nofollow")
        self.assertContains(response, 'content="noindex, nofollow"')
        self.assertIn("no-store", response["Cache-Control"])

    def test_shell_boot_payload(self):
        User.objects.create_user("owner", password="x" * 12)
        self.client.login(username="owner", password="x" * 12)
        boot = self.boot(self.client.get("/app/"))
        self.assertEqual(boot["basename"], "/app")
        self.assertEqual(boot["lang"], "ar")
        self.assertEqual(boot["dir"], "rtl")
        self.assertEqual(boot["user"]["username"], "owner")
        self.assertIn("name", boot["site"])

    def test_shell_boot_payload_escapes_markup(self):
        # json_script بيهرّب < عشان قيمة في الإعدادات ماتقفلش الـscript
        with override_settings(SITE_NAME="</script><b>x"):
            response = self.client.get("/app/")
        html = response.content.decode()
        self.assertNotIn("</script><b>", html)

    def test_shell_loads_built_assets_with_hashed_names(self):
        html = self.client.get("/app/").content.decode()
        self.assertIn('src="/static/app/assets/main-abc123.js"', html)
        self.assertIn('href="/static/app/assets/main-def456.css"', html)
        self.assertIn('href="/static/app/assets/vendor-222.css"', html)
        self.assertIn('rel="modulepreload" href="/static/app/assets/vendor-111.js"', html)

    def test_shell_head_has_open_graph_for_crawlers(self):
        html = self.client.get("/app/").content.decode()
        for tag in ("og:title", "og:description", "og:image", "og:url", "twitter:card"):
            self.assertIn(tag, html)

    def test_shell_only_allows_safe_methods(self):
        self.assertEqual(self.client.post("/app/").status_code, 405)

    def test_root_pages_are_served_by_the_shell(self):
        # الموقع الكلاسيك اتحذف: ‎/login/‎ وغيرها بتتقدّم من React على الجذر
        response = self.client.get("/login/")
        self.assertEqual(response.status_code, 200)
        self.assertTemplateUsed(response, "spa/shell.html")


class ViteTagTests(SimpleTestCase):
    def render(self):
        return DjangoTemplate("{% load vite %}{% vite_assets %}").render(Context({}))

    def test_missing_build_fails_loudly(self):
        with tempfile.TemporaryDirectory() as empty:
            with override_settings(VITE_BUILD_DIR=Path(empty), VITE_DEV_SERVER=""):
                with self.assertRaises(ImproperlyConfigured):
                    self.render()

    @override_settings(DEBUG=True, VITE_DEV_SERVER="http://localhost:5173")
    def test_dev_server_mode(self):
        html = self.render()
        self.assertIn('src="http://localhost:5173/@vite/client"', html)
        self.assertIn('src="http://localhost:5173/src/main.tsx"', html)
        self.assertIn("@react-refresh", html)

    @override_settings(DEBUG=False, VITE_DEV_SERVER="http://localhost:5173")
    def test_dev_server_ignored_outside_debug(self):
        with tempfile.TemporaryDirectory() as tmp:
            _write_manifest(Path(tmp), MANIFEST)
            with override_settings(VITE_BUILD_DIR=Path(tmp)):
                self.assertNotIn("5173", self.render())
