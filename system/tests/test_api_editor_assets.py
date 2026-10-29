"""اختبارات مكتبة أصول المحرر والمفضلة والخطوط (‎/api/v1/editor/…‎).

كل مسار: نجاح، تحقق، غير داخل (401)، داخل وليس من فريق العمل (403)، وCSRF. المكتبة
بتتعامل مع ملفات حقيقية فبنوجّه ‎MEDIA_ROOT‎ لمجلد مؤقت — مفيش اختبار بيكتب في ‎media/‎.
"""

import io
import json
import tempfile
from unittest import mock

from django.contrib.auth.models import User
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from PIL import Image

from system.data import golden_classic
from system.forms import CustomFontForm
from system.models import Asset, Customer, CustomFont, FavoriteBlock, Invitation, Plan, Template

BASE = "/api/v1/editor"


def png_bytes(size=(64, 48), color=(200, 40, 40)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def jpeg_bytes(size=(32, 24)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(buf, "JPEG")
    return buf.getvalue()


def image_file(name="photo.png", **kwargs) -> SimpleUploadedFile:
    return SimpleUploadedFile(name, png_bytes(**kwargs), content_type="image/png")


class AssetsApiCase(TestCase):
    @classmethod
    def setUpClass(cls):
        cls._media = tempfile.TemporaryDirectory()
        cls._override = override_settings(MEDIA_ROOT=cls._media.name)
        cls._override.enable()
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        cls._override.disable()
        cls._media.cleanup()

    def setUp(self):
        cache.clear()
        self.staff = User.objects.create_user("owner", password="x" * 12, is_staff=True)
        self.plain = User.objects.create_user("visitor", password="x" * 12)
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.staff)

        self.customer = Customer.objects.create(name="عميل", phone="0100")
        self.plan = Plan.objects.create(name="أساسية", slug="basic", price=100, features=["rsvp"])
        self.template = Template.objects.create(
            name="ذهبي", slug="golden-t", document=golden_classic.build())
        self.other_template = Template.objects.create(
            name="تاني", slug="other-t", document=golden_classic.build())
        self.inv = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="ليلى", name_two="أحمد", status="published")
        self.other_inv = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="سارة", name_two="علي", status="published")

    # --- أدوات
    def csrf(self):
        return {"HTTP_X_CSRFTOKEN": self.client.get("/api/v1/csrf/").json()["csrfToken"]}

    def post(self, path, data):
        return self.client.post(path, data=json.dumps(data),
                                content_type="application/json", **self.csrf())

    def upload(self, path, **files):
        return self.client.post(path, data=files, **self.csrf())

    def assertError(self, response, status, code):
        self.assertEqual(response.status_code, status, response.content[:300])
        self.assertEqual(response.json()["error"]["code"], code)

    def make_asset(self, *, invitation=None, template=None, name="a.png") -> Asset:
        """أصل حقيقي بالرفع نفسه (مش ‎Asset.objects.create‎) فالملفات موجودة على القرص."""
        owner = ({"invitations": invitation} if invitation else {"templates": template})
        (kind, obj), = owner.items()
        response = self.upload(f"{BASE}/{kind}/{obj.pk}/assets/upload/", file=image_file(name))
        self.assertEqual(response.status_code, 201, response.content[:300])
        return Asset.objects.get(pk=response.json()["asset"]["id"])

    def use_in_document(self, asset: Asset, owner=None):
        """يحط رابط الأصل جوّه مستند الدعوة ويحفظ — الفهرس بيتحدّث بإشارة ‎post_save‎."""
        owner = owner or self.inv
        document = golden_classic.build()
        document["blocks"][0]["props"]["image"] = asset.url
        owner.document = document
        owner.save()


def _endpoints(inv, tpl, fav):
    inv_base = f"{BASE}/invitations/{inv}/assets/"
    tpl_base = f"{BASE}/templates/{tpl}/assets/"
    return [
        ("GET", inv_base), ("POST", inv_base + "upload/"), ("POST", inv_base + "crop/"),
        ("POST", inv_base + "delete/"), ("POST", inv_base + "bulk-delete/"),
        ("GET", tpl_base), ("POST", tpl_base + "upload/"), ("POST", tpl_base + "crop/"),
        ("POST", tpl_base + "delete/"), ("POST", tpl_base + "bulk-delete/"),
        ("GET", f"{BASE}/favorites/"), ("POST", f"{BASE}/favorites/"),
        ("DELETE", f"{BASE}/favorites/{fav}/"), ("POST", f"{BASE}/fonts/"),
    ]


# ---------------------------------------------------------------- الحماية
class GuardTests(AssetsApiCase):
    def request(self, method, path):
        if method == "GET":
            return self.client.get(path)
        if method == "DELETE":
            return self.client.delete(path, **self.csrf())
        return self.post(path, {})

    def endpoints(self):
        fav = FavoriteBlock.objects.create(name="x", block_type="hero", block_data={})
        return _endpoints(self.inv.pk, self.template.pk, fav.pk)

    def test_anonymous_gets_401(self):
        endpoints = self.endpoints()
        self.client.logout()
        for method, path in endpoints:
            with self.subTest(method=method, path=path):
                self.assertEqual(self.request(method, path).status_code, 401)

    def test_non_staff_gets_403(self):
        endpoints = self.endpoints()
        self.client.force_login(self.plain)
        for method, path in endpoints:
            with self.subTest(method=method, path=path):
                self.assertEqual(self.request(method, path).status_code, 403)

    def test_writes_without_csrf_are_rejected(self):
        for method, path in self.endpoints():
            if method == "GET":
                continue
            with self.subTest(method=method, path=path):
                response = self.client.generic(method, path, data="{}",
                                               content_type="application/json")
                self.assertEqual(response.status_code, 403)

    def test_unknown_owner_is_404(self):
        self.assertError(self.client.get(f"{BASE}/invitations/999999/assets/"), 404, "not_found")
        self.assertError(self.post(f"{BASE}/templates/999999/assets/delete/", {"asset": 1}),
                         404, "not_found")

    def test_wrong_method_is_405(self):
        self.assertEqual(self.client.get(f"{BASE}/invitations/{self.inv.pk}/assets/upload/")
                         .status_code, 405)
        self.assertEqual(self.client.delete(f"{BASE}/invitations/{self.inv.pk}/assets/",
                                            **self.csrf()).status_code, 405)


# ---------------------------------------------------------------- القائمة
class ListingTests(AssetsApiCase):
    def test_invitation_sees_own_and_shared_but_not_other_invitations(self):
        own = self.make_asset(invitation=self.inv)
        shared = self.make_asset(template=self.template)
        foreign = self.make_asset(invitation=self.other_inv)
        data = self.client.get(f"{BASE}/invitations/{self.inv.pk}/assets/").json()
        ids = [a["id"] for a in data["assets"]]
        self.assertIn(own.pk, ids)
        self.assertIn(shared.pk, ids)
        self.assertNotIn(foreign.pk, ids)
        row = next(a for a in data["assets"] if a["id"] == own.pk)
        self.assertEqual(set(row), {"id", "url", "thumb", "source", "name", "kind", "used"})
        self.assertFalse(row["used"])

    def test_template_library_is_shared_assets_only(self):
        shared = self.make_asset(template=self.template)
        own = self.make_asset(invitation=self.inv)
        data = self.client.get(f"{BASE}/templates/{self.template.pk}/assets/").json()
        ids = [a["id"] for a in data["assets"]]
        self.assertIn(shared.pk, ids)
        self.assertNotIn(own.pk, ids)

    def test_used_flag_follows_documents(self):
        asset = self.make_asset(invitation=self.inv)
        self.use_in_document(asset)
        data = self.client.get(f"{BASE}/invitations/{self.inv.pk}/assets/").json()
        self.assertTrue(next(a for a in data["assets"] if a["id"] == asset.pk)["used"])

    def test_listing_is_capped_at_300_newest_first(self):
        Asset.objects.bulk_create(
            [Asset(file=f"assets/2026/01/{i:012x}/f.png", kind="image") for i in range(305)])
        assets = self.client.get(f"{BASE}/invitations/{self.inv.pk}/assets/").json()["assets"]
        self.assertEqual(len(assets), 300)
        self.assertEqual(assets[0]["id"], max(a["id"] for a in assets))


# ---------------------------------------------------------------- الرفع
class UploadTests(AssetsApiCase):
    url = property(lambda self: f"{BASE}/invitations/{self.inv.pk}/assets/upload/")

    def test_image_upload_creates_asset_for_the_invitation(self):
        response = self.upload(self.url, file=image_file("زفاف.png"))
        self.assertEqual(response.status_code, 201, response.content[:300])
        data = response.json()["asset"]
        self.assertEqual((data["kind"], data["used"]), ("image", False))
        self.assertTrue(data["url"] and data["thumb"])
        asset = Asset.objects.get(pk=data["id"])
        self.assertEqual((asset.invitation_id, asset.template_id), (self.inv.pk, None))
        self.assertEqual(asset.uploaded_by, self.staff)
        self.assertGreater(asset.size_bytes, 0)

    def test_template_upload_is_attached_to_the_template(self):
        response = self.upload(f"{BASE}/templates/{self.template.pk}/assets/upload/",
                               file=image_file())
        self.assertEqual(response.status_code, 201)
        asset = Asset.objects.get(pk=response.json()["asset"]["id"])
        self.assertEqual((asset.invitation_id, asset.template_id), (None, self.template.pk))

    def test_video_upload_accepts_a_client_frame_as_thumbnail(self):
        video = SimpleUploadedFile("clip.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\0" * 64,
                                   content_type="video/mp4")
        frame = SimpleUploadedFile("clip-thumb.jpg", jpeg_bytes(), content_type="image/jpeg")
        response = self.upload(self.url, file=video, thumb=frame)
        self.assertEqual(response.status_code, 201, response.content[:300])
        asset = Asset.objects.get(pk=response.json()["asset"]["id"])
        self.assertEqual(asset.kind, "video")
        self.assertTrue(asset.thumb, "فريم المتصفح لازم يتحفظ كمصغّرة")

    def test_audio_upload(self):
        audio = SimpleUploadedFile("song.mp3", b"ID3" + b"\0" * 64, content_type="audio/mpeg")
        response = self.upload(self.url, file=audio)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["asset"]["kind"], "audio")

    def test_missing_file_is_a_validation_error(self):
        self.assertError(self.upload(self.url), 400, "validation_error")
        self.assertError(self.post(self.url, {}), 400, "validation_error")

    def test_disallowed_type_is_rejected(self):
        for name, content_type in [("note.txt", "text/plain"), ("x.exe", "application/x-msdownload"),
                                   ("v.svg", "image/svg+xml")]:
            with self.subTest(name=name):
                bad = SimpleUploadedFile(name, b"<svg/>", content_type=content_type)
                self.assertError(self.upload(self.url, file=bad), 400, "validation_error")
        self.assertEqual(Asset.objects.count(), 0)

    def test_fake_image_is_rejected(self):
        fake = SimpleUploadedFile("fake.png", b"this is not a png", content_type="image/png")
        response = self.upload(self.url, file=fake)
        self.assertError(response, 400, "validation_error")
        self.assertIn("تالفة", response.json()["error"]["message"])

    def test_oversized_image_is_rejected(self):
        with mock.patch("system.views.MAX_ASSET_BYTES", 1024):
            response = self.upload(self.url, file=image_file(size=(400, 400)))
        self.assertError(response, 400, "validation_error")
        self.assertIn("ميجابايت", response.json()["error"]["message"])
        self.assertEqual(Asset.objects.count(), 0)

    def test_video_has_its_own_higher_limit(self):
        video = SimpleUploadedFile("clip.mp4", b"\0" * 4096, content_type="video/mp4")
        with mock.patch("system.views.MAX_VIDEO_BYTES", 1024):
            self.assertError(self.upload(self.url, file=video), 400, "validation_error")
        # نفس الحجم كصورة (الحد ٨ ميجا) ما كانش اترفض
        with mock.patch("system.views.MAX_ASSET_BYTES", 1024):
            video.seek(0)
            self.assertEqual(self.upload(self.url, file=video).status_code, 201)

    def test_octet_stream_video_is_recognised_by_extension(self):
        video = SimpleUploadedFile("clip.mov", b"\0" * 64, content_type="application/octet-stream")
        response = self.upload(self.url, file=video)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["asset"]["kind"], "video")


# ---------------------------------------------------------------- القص
class CropTests(AssetsApiCase):
    def url(self, owner="invitations", pk=None):
        pk = pk or (self.inv.pk if owner == "invitations" else self.template.pk)
        return f"{BASE}/{owner}/{pk}/assets/crop/"

    BOX = {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5}

    def test_crop_makes_a_new_asset_and_keeps_the_source(self):
        original = self.make_asset(invitation=self.inv)
        response = self.post(self.url(), {"asset": original.pk, "box": self.BOX})
        self.assertEqual(response.status_code, 201, response.content[:300])
        data = response.json()["asset"]
        self.assertNotEqual(data["id"], original.pk)
        self.assertEqual((data["kind"], data["used"]), ("image", False))
        self.assertTrue(data["source"])
        cropped = Asset.objects.get(pk=data["id"])
        self.assertTrue(cropped.source, "الأصل لازم يفضل محفوظ لإعادة القص")
        self.assertEqual(cropped.invitation_id, self.inv.pk)
        self.assertTrue(Asset.objects.filter(pk=original.pk).exists())
        with Image.open(cropped.file) as img:
            self.assertEqual(img.size, (data["width"], data["height"]))
            self.assertLess(img.size[0], 64)

    def test_shared_asset_can_be_cropped_from_an_invitation(self):
        shared = self.make_asset(template=self.template)
        response = self.post(self.url(), {"asset": shared.pk, "box": self.BOX})
        self.assertEqual(response.status_code, 201)

    def test_other_invitations_asset_is_forbidden(self):
        foreign = self.make_asset(invitation=self.other_inv)
        self.assertError(self.post(self.url(), {"asset": foreign.pk, "box": self.BOX}),
                         403, "forbidden")

    def test_template_cannot_crop_an_invitation_asset(self):
        own = self.make_asset(invitation=self.inv)
        self.assertError(self.post(self.url("templates"), {"asset": own.pk, "box": self.BOX}),
                         403, "forbidden")

    def test_unknown_asset_and_non_image_are_404(self):
        self.assertError(self.post(self.url(), {"asset": 999999, "box": self.BOX}), 404, "not_found")
        audio = Asset.objects.create(file="assets/2026/01/aaaaaaaaaaaa/s.mp3", kind="audio")
        self.assertError(self.post(self.url(), {"asset": audio.pk, "box": self.BOX}), 404, "not_found")

    def test_invalid_payloads(self):
        asset = self.make_asset(invitation=self.inv)
        self.assertError(self.post(self.url(), {"asset": asset.pk, "box": "oops"}),
                         400, "validation_error")
        response = self.client.post(self.url(), data="{not json", content_type="application/json",
                                    **self.csrf())
        self.assertError(response, 400, "validation_error")

    def test_unreadable_source_is_a_400_not_a_500(self):
        broken = Asset.objects.create(file="assets/2026/01/bbbbbbbbbbbb/missing.png", kind="image",
                                      invitation=self.inv)
        self.assertError(self.post(self.url(), {"asset": broken.pk, "box": self.BOX}),
                         400, "validation_error")


# ---------------------------------------------------------------- الحذف
class DeleteTests(AssetsApiCase):
    def url(self, name="delete", owner="invitations"):
        pk = self.inv.pk if owner == "invitations" else self.template.pk
        return f"{BASE}/{owner}/{pk}/assets/{name}/"

    def test_unused_asset_is_deleted_with_its_files(self):
        asset = self.make_asset(invitation=self.inv)
        names = [asset.file.name, asset.thumb.name]
        response = self.post(self.url(), {"asset": asset.pk, "kind": "image"})
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(response.json(), {"deleted": asset.pk})
        self.assertFalse(Asset.objects.filter(pk=asset.pk).exists())
        from django.core.files.storage import default_storage
        for name in names:
            self.assertFalse(default_storage.exists(name), name)

    def test_used_asset_is_refused_with_409(self):
        asset = self.make_asset(invitation=self.inv)
        self.use_in_document(asset)
        response = self.post(self.url(), {"asset": asset.pk})
        self.assertError(response, 409, "asset_in_use")
        self.assertTrue(response.json()["error"]["message"])
        self.assertTrue(Asset.objects.filter(pk=asset.pk).exists())

    def test_asset_used_by_another_document_is_refused_too(self):
        asset = self.make_asset(template=self.template)
        self.use_in_document(asset, owner=self.other_template)
        self.assertError(self.post(self.url("delete", "templates"), {"asset": asset.pk}),
                         409, "asset_in_use")

    def test_other_invitations_asset_is_forbidden(self):
        foreign = self.make_asset(invitation=self.other_inv)
        self.assertError(self.post(self.url(), {"asset": foreign.pk}), 403, "forbidden")
        self.assertTrue(Asset.objects.filter(pk=foreign.pk).exists())

    def test_template_cannot_delete_invitation_asset(self):
        own = self.make_asset(invitation=self.inv)
        self.assertError(self.post(self.url("delete", "templates"), {"asset": own.pk}),
                         403, "forbidden")

    def test_template_cannot_delete_another_templates_asset(self):
        theirs = self.make_asset(template=self.other_template)
        self.assertError(self.post(self.url("delete", "templates"), {"asset": theirs.pk}),
                         403, "forbidden")

    def test_validation(self):
        self.assertError(self.post(self.url(), {"asset": "abc"}), 400, "validation_error")
        self.assertError(self.post(self.url(), {}), 400, "validation_error")
        self.assertError(self.post(self.url(), {"asset": 999999}), 404, "not_found")
        self.assertError(self.post(self.url(), {"asset": 1, "kind": "audio"}), 400, "validation_error")

    def test_video_kind(self):
        video = Asset.objects.create(file="assets/2026/01/cccccccccccc/v.mp4", kind="video",
                                     invitation=self.inv)
        self.assertError(self.post(self.url(), {"asset": video.pk, "kind": "image"}), 404, "not_found")
        self.assertEqual(self.post(self.url(), {"asset": video.pk, "kind": "video"}).status_code, 200)

    # --- الحذف الجماعي
    def test_bulk_delete(self):
        assets = [self.make_asset(invitation=self.inv, name=f"{i}.png") for i in range(3)]
        keep = self.make_asset(invitation=self.inv, name="keep.png")
        ids = [a.pk for a in assets]
        response = self.post(self.url("bulk-delete"), {"assets": ids, "kind": "image"})
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertEqual(response.json(), {"deleted": sorted(ids)})
        self.assertEqual(list(Asset.objects.values_list("pk", flat=True)), [keep.pk])

    def test_bulk_delete_is_all_or_nothing_when_one_is_used(self):
        free, used = (self.make_asset(invitation=self.inv, name=f"{i}.png") for i in range(2))
        self.use_in_document(used)
        response = self.post(self.url("bulk-delete"), {"assets": [free.pk, used.pk]})
        self.assertError(response, 409, "asset_in_use")
        self.assertEqual(Asset.objects.count(), 2)

    def test_bulk_delete_ownership_and_validation(self):
        foreign = self.make_asset(invitation=self.other_inv)
        own = self.make_asset(invitation=self.inv)
        self.assertError(self.post(self.url("bulk-delete"), {"assets": [own.pk, foreign.pk]}),
                         403, "forbidden")
        self.assertError(self.post(self.url("bulk-delete"), {"assets": [own.pk, 999999]}),
                         404, "not_found")
        self.assertError(self.post(self.url("bulk-delete"), {"assets": []}), 400, "validation_error")
        self.assertError(self.post(self.url("bulk-delete"), {"assets": ["x"]}), 400, "validation_error")
        self.assertError(self.post(self.url("bulk-delete"), {"assets": list(range(1, 302))}),
                         400, "validation_error")
        self.assertEqual(Asset.objects.count(), 2)


# ---------------------------------------------------------------- المفضلة
class FavoritesTests(AssetsApiCase):
    url = f"{BASE}/favorites/"

    def block(self):
        return {"id": "hero-1", "type": "hero", "visible": True, "props": {"title": "أهلاً"},
                "style": {}}

    def test_create_list_and_delete(self):
        response = self.post(self.url, {"name": "  غلاف جميل  ", "block": self.block()})
        self.assertEqual(response.status_code, 201, response.content[:300])
        favorite = response.json()["favorite"]
        self.assertEqual((favorite["name"], favorite["blockType"]), ("غلاف جميل", "hero"))
        self.assertEqual(favorite["block"]["type"], "hero")
        self.assertEqual(FavoriteBlock.objects.get(pk=favorite["id"]).created_by, self.staff)

        listed = self.client.get(self.url).json()["favorites"]
        self.assertEqual([f["id"] for f in listed], [favorite["id"]])

        response = self.client.delete(f"{self.url}{favorite['id']}/", **self.csrf())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": favorite["id"]})
        self.assertFalse(FavoriteBlock.objects.exists())

    def test_name_is_required_and_trimmed_to_120(self):
        response = self.post(self.url, {"name": "   ", "block": self.block()})
        self.assertError(response, 400, "validation_error")
        self.assertIn("name", response.json()["error"]["fields"])
        response = self.post(self.url, {"name": "ن" * 300, "block": self.block()})
        self.assertEqual(len(response.json()["favorite"]["name"]), 120)

    def test_invalid_block_is_rejected(self):
        for body in [{"name": "x"}, {"name": "x", "block": "nope"},
                     {"name": "x", "block": {"type": "no-such-block"}}]:
            with self.subTest(body=body):
                response = self.post(self.url, body)
                self.assertError(response, 400, "validation_error")
                self.assertIn("block", response.json()["error"]["fields"])
        self.assertFalse(FavoriteBlock.objects.exists())

    def test_block_goes_through_the_engine_normalizer(self):
        dirty = self.block()
        dirty["props"]["not_a_real_prop"] = "<script>alert(1)</script>"
        favorite = self.post(self.url, {"name": "x", "block": dirty}).json()["favorite"]
        self.assertNotIn("not_a_real_prop", favorite["block"]["props"])

    def test_delete_unknown_is_404(self):
        self.assertError(self.client.delete(f"{self.url}999999/", **self.csrf()), 404, "not_found")


# ---------------------------------------------------------------- الخطوط
class FontTests(AssetsApiCase):
    url = f"{BASE}/fonts/"

    def form(self, **overrides):
        data = {"name": "خط الفرح", "family": "Farah Sans", "weight": "400", "style": "normal",
                "is_active": "on",
                "file": SimpleUploadedFile("farah.woff2", b"wOF2" + b"\0" * 32,
                                           content_type="font/woff2")}
        data.update(overrides)
        return {k: v for k, v in data.items() if v is not None}

    def test_upload_creates_an_active_font(self):
        response = self.upload(self.url, **self.form())
        self.assertEqual(response.status_code, 201, response.content[:300])
        font = response.json()["font"]
        self.assertEqual((font["name"], font["family"]), ("خط الفرح", "Farah Sans"))
        self.assertEqual(font["value"], "'Farah Sans', sans-serif")
        self.assertTrue(font["url"].endswith(".woff2"))
        row = CustomFont.objects.get(pk=font["id"])
        self.assertTrue(row.is_active)
        self.assertEqual(row.uploaded_by, self.staff)

    def test_new_font_shows_up_in_the_editor_bootstrap(self):
        font = self.upload(self.url, **self.form()).json()["font"]
        boot = self.client.get(f"{BASE}/invitations/{self.inv.pk}/").json()
        self.assertIn(font["id"], [f["id"] for f in boot["fonts"]])

    def test_bad_extension_and_family_report_their_field(self):
        bad_file = SimpleUploadedFile("evil.exe", b"MZ", content_type="application/octet-stream")
        response = self.upload(self.url, **self.form(file=bad_file))
        self.assertError(response, 400, "validation_error")
        self.assertIn("file", response.json()["error"]["fields"])
        response = self.upload(self.url, **self.form(family="١٢٣ خط"))
        self.assertIn("family", response.json()["error"]["fields"])
        response = self.upload(self.url, **self.form(weight="450"))
        self.assertIn("weight", response.json()["error"]["fields"])
        self.assertFalse(CustomFont.objects.exists())

    def test_file_or_link_is_required(self):
        response = self.upload(self.url, **self.form(file=None))
        self.assertError(response, 400, "validation_error")
        self.assertTrue(response.json()["error"]["message"])

    def test_external_link_is_enough(self):
        response = self.upload(self.url, **self.form(file=None,
                                                     external_url="https://cdn.example.com/f.woff2"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["font"]["url"], "https://cdn.example.com/f.woff2")

    def test_oversized_font_is_rejected(self):
        big = SimpleUploadedFile("big.ttf", b"\0" * 2048, content_type="font/ttf")
        with mock.patch.object(CustomFontForm, "MAX_BYTES", 1024):
            response = self.upload(self.url, **self.form(file=big))
        self.assertError(response, 400, "validation_error")
        self.assertIn("file", response.json()["error"]["fields"])
