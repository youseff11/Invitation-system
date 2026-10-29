"""أيقونة الموقع (favicon): رفع من «إدارة البيانات»، تقديمها، وظهورها في ‎<head>‎ الصفحات."""

import io
import shutil
import tempfile

from django.contrib.auth.models import Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.template import Context, Template as DjangoTemplate
from django.test import Client, TestCase, override_settings
from PIL import Image

from system import siteicon

URL = "/api/v1/data/site-icon/"


def image_bytes(size=(300, 120), fmt="PNG", color=(200, 30, 30, 255)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA" if fmt == "PNG" else "RGB", size, color if fmt == "PNG" else color[:3]).save(buffer, format=fmt)
    return buffer.getvalue()


def upload(client, data: bytes, name="icon.png", type_="image/png"):
    return client.post(URL, {"file": SimpleUploadedFile(name, data, content_type=type_)})


class SiteIconTests(TestCase):
    def setUp(self):
        self._media = tempfile.mkdtemp()
        override = override_settings(MEDIA_ROOT=self._media)
        override.enable()
        self.addCleanup(override.disable)
        self.addCleanup(shutil.rmtree, self._media, ignore_errors=True)
        self.admin = User.objects.create_superuser("boss", "b@x.test", "pw-123456")
        self.client = Client()
        self.client.force_login(self.admin)

    def test_default_until_an_icon_is_uploaded(self):
        body = self.client.get(URL).json()
        self.assertEqual(body, {"custom": False, "url": ""})
        # من غير أيقونة مرفوعة: الرابط بيحوّل للافتراضية بدل 404
        response = self.client.get("/site-icon.png")
        self.assertEqual(response.status_code, 302)
        self.assertIn("logo", response["Location"])

    def test_upload_makes_a_square_transparent_png_and_serves_it(self):
        response = upload(self.client, image_bytes((300, 120)))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["custom"])
        self.assertTrue(body["url"].startswith("/site-icon.png?v="))
        served = self.client.get(body["url"])
        self.assertEqual(served.status_code, 200)
        self.assertEqual(served["Content-Type"], "image/png")
        self.assertIn("max-age", served["Cache-Control"])
        icon = Image.open(io.BytesIO(served.content))
        self.assertEqual(icon.size, (siteicon.SIZE, siteicon.SIZE))
        self.assertEqual(icon.getpixel((0, 0))[3], 0)  # الأطراف شفافة (الصورة مستطيلة ومتمركزة)
        # /favicon.ico (من غير v) مابيتخزّنش عشان التغيير يبان فوراً
        self.assertEqual(self.client.get("/favicon.ico")["Cache-Control"], "no-cache")

    def test_jpeg_is_accepted_and_garbage_or_oversize_is_refused(self):
        self.assertEqual(upload(self.client, image_bytes(fmt="JPEG"), "a.jpg", "image/jpeg").status_code, 200)
        bad = upload(self.client, b"not an image at all", "x.png")
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json()["error"]["code"], "bad_image")
        svg = upload(self.client, b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "x.svg", "image/svg+xml")
        self.assertEqual(svg.status_code, 400)
        self.assertEqual(self.client.post(URL, {}).status_code, 400)
        with override_settings():
            siteicon.MAX_BYTES, old = 10, siteicon.MAX_BYTES
            try:
                self.assertEqual(upload(self.client, image_bytes()).status_code, 400)
            finally:
                siteicon.MAX_BYTES = old

    def test_delete_restores_the_default(self):
        upload(self.client, image_bytes())
        self.assertTrue(siteicon.is_custom())
        body = self.client.delete(URL).json()
        self.assertEqual(body, {"custom": False, "url": ""})
        self.assertFalse(siteicon.is_custom())

    def test_only_staff_with_site_settings_permission_can_change_it(self):
        anon = Client()
        self.assertEqual(anon.get(URL).status_code, 401)
        plain = User.objects.create_user("plain", password="pw-123456")
        client = Client()
        client.force_login(plain)
        self.assertEqual(upload(client, image_bytes()).status_code, 403)

        clerk = User.objects.create_user("clerk", password="pw-123456", is_staff=True)
        client = Client()
        client.force_login(clerk)
        self.assertEqual(upload(client, image_bytes()).status_code, 403)
        clerk.user_permissions.add(Permission.objects.get(codename="change_sitesetting"))
        client = Client()
        client.force_login(clerk)
        self.assertEqual(upload(client, image_bytes()).status_code, 200)

    def test_pages_use_the_uploaded_icon_in_their_head(self):
        tag = DjangoTemplate("{% load siteicon %}{% site_icon_href 'images/logo.jpeg' %}")
        self.assertIn("logo.jpeg", tag.render(Context()))
        upload(self.client, image_bytes())
        self.assertTrue(tag.render(Context()).startswith("/site-icon.png?v="))
        shell = self.client.get("/")
        self.assertContains(shell, '<link rel="icon" href="/site-icon.png?v=')
        self.assertContains(shell, '<link rel="apple-touch-icon" href="/site-icon.png?v=')


LOGO = "/api/v1/data/site-logo/"


class SiteLogoTests(SiteIconTests.__bases__[0]):
    def setUp(self):
        self._media = tempfile.mkdtemp()
        override = override_settings(MEDIA_ROOT=self._media)
        override.enable()
        self.addCleanup(override.disable)
        self.addCleanup(shutil.rmtree, self._media, ignore_errors=True)
        self.admin = User.objects.create_superuser("boss", "b@x.test", "pw-123456")
        self.client = Client()
        self.client.force_login(self.admin)

    def upload(self, slot, data=None, client=None):
        data = data or image_bytes((600, 150))
        return (client or self.client).post(
            LOGO, {"slot": slot, "file": SimpleUploadedFile("logo.png", data, content_type="image/png")})

    def test_default_logo_redirects_to_the_static_brand_images(self):
        self.assertEqual(self.client.get(LOGO).json()["light"], False)
        for slot in ("light", "dark"):
            response = self.client.get(f"/site-logo/{slot}.png")
            self.assertEqual(response.status_code, 302)
            self.assertIn(f"brand-{slot}", response["Location"])
        self.assertEqual(self.client.get("/site-logo/other.png").status_code, 404)

    def test_upload_keeps_the_aspect_ratio_and_dark_falls_back_to_light(self):
        body = self.upload("light").json()
        self.assertEqual((body["light"], body["dark"]), (True, False))
        served = self.client.get("/site-logo/light.png")
        logo = Image.open(io.BytesIO(served.content))
        self.assertEqual(logo.size, (600, 150))  # مش متحوّل لمربع
        # الغامق مارفعش: بيخدم الفاتح بدل لوجو الافتراضي القديم
        self.assertEqual(self.client.get("/site-logo/dark.png").status_code, 200)
        self.upload("dark", image_bytes((300, 90), color=(10, 200, 10, 255)))
        dark = Image.open(io.BytesIO(self.client.get("/site-logo/dark.png").content))
        self.assertEqual(dark.size, (300, 90))

    def test_etag_gives_304_until_the_logo_changes(self):
        self.upload("light")
        first = self.client.get("/site-logo/light.png")
        self.assertEqual(first["Cache-Control"], "no-cache")
        again = self.client.get("/site-logo/light.png", HTTP_IF_NONE_MATCH=first["ETag"])
        self.assertEqual(again.status_code, 304)
        self.upload("light", image_bytes((500, 100), color=(1, 2, 3, 255)))
        self.assertEqual(self.client.get("/site-logo/light.png", HTTP_IF_NONE_MATCH=first["ETag"]).status_code, 200)

    def test_validation_slot_reset_and_permissions(self):
        self.assertEqual(self.upload("huge").status_code, 400)
        self.assertEqual(self.upload("light", b"nope").status_code, 400)
        self.assertEqual(self.client.post(LOGO, {"slot": "light"}).status_code, 400)
        self.upload("light")
        self.assertEqual(self.client.delete(LOGO + "?slot=light").json()["light"], False)
        self.assertEqual(self.client.delete(LOGO).status_code, 400)  # من غير slot

        clerk = User.objects.create_user("clerk", password="pw-123456", is_staff=True)
        client = Client()
        client.force_login(clerk)
        self.assertEqual(self.upload("light", client=client).status_code, 403)
        self.assertEqual(client.post(LOGO + "apply/").status_code, 403)

    def test_apply_points_every_branding_block_at_the_site_logo(self):
        from system.data import golden_classic
        from system.models import Invitation, Template

        def doc(logo):
            document = golden_classic.build()
            document["blocks"].append({"id": "b-1", "type": "branding", "visible": True, "locked": False,
                                       "props": {"logo": logo, "text": "x"}, "style": {}})
            return document

        template = Template.objects.create(name="ق", slug="q-1", document=doc("/media/old.webp"),
                                           preview_render={"stale": True})
        other = Template.objects.create(name="ك", slug="q-2", document=golden_classic.build())
        from system.models import Customer, Plan
        customer = Customer.objects.create(name="م", phone="0100", email="m@x.test")
        plan = Plan.objects.create(name="ذ", slug="g", price=1)
        invitation = Invitation.objects.create(customer=customer, template=other, plan=plan, name_one="ا", name_two="ب",
                                               status="published", document=doc("/media/old.webp"))
        result = self.client.post(LOGO + "apply/").json()
        self.assertEqual(result, {"templates": 1, "invitations": 1, "blocks": 2})
        template.refresh_from_db()
        invitation.refresh_from_db()
        for document in (template.document, invitation.document):
            logos = [b["props"]["logo"] for b in document["blocks"] if b["type"] == "branding"]
            self.assertEqual(logos, [siteicon.LOGO_URL])
        self.assertEqual(template.preview_render, {})  # المعاينة المخزّنة اتصفّرت
        # تاني مرة: مفيش حاجة تتغيّر
        self.assertEqual(self.client.post(LOGO + "apply/").json(), {"templates": 0, "invitations": 0, "blocks": 0})
