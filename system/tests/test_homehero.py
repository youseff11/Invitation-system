"""هيرو الرئيسية: خلفيات (دارك/لايت × عربي/إنجليزي) مضغوطة + نصوص قابلة للتعديل من إدارة البيانات."""

import io
import json
import shutil
import tempfile
from pathlib import Path

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings

from system.models import HomeHero

BASE = "/api/v1/data/system.homehero"


def noisy_png(width=3200, height=1800) -> bytes:
    """صورة كبيرة بتفاصيل عشوائية (عشان الضغط يفرق فعلاً)."""
    import os

    from PIL import Image

    img = Image.frombytes("RGB", (width, height), os.urandom(width * height * 3))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


class HeroBase(TestCase):
    def setUp(self):
        self.media = tempfile.mkdtemp()
        override = override_settings(MEDIA_ROOT=self.media)
        override.enable()
        self.addCleanup(override.disable)
        self.addCleanup(shutil.rmtree, self.media, True)
        self.admin = User.objects.create_superuser("boss", "b@x.test", "pw-123456")
        self.client = Client()
        self.client.force_login(self.admin)

    def upload(self, name="light.png", data=None):
        return SimpleUploadedFile(name, data or noisy_png(), content_type="image/png")


class HeroModelTests(HeroBase):
    def test_single_record_with_empty_defaults(self):
        hero = HomeHero.load()
        self.assertEqual((hero.pk, HomeHero.objects.count()), (1, 1))
        HomeHero(main_ar="x").save()
        self.assertEqual(HomeHero.objects.count(), 1)
        self.assertEqual(HomeHero.load().main_ar, "x")

    def test_uploaded_background_is_resized_and_converted_to_webp(self):
        original = noisy_png()
        hero = HomeHero.load()
        hero.bg_dark_ar = self.upload("dark.png", original)
        hero.save()
        stored = Path(hero.bg_dark_ar.path)
        self.assertEqual(stored.suffix, ".webp")
        self.assertLess(stored.stat().st_size, len(original))
        from PIL import Image

        with Image.open(stored) as img:
            self.assertEqual(img.format, "WEBP")
            self.assertLessEqual(max(img.size), 2400)
            self.assertEqual(img.size, (2400, 1350))  # النسبة محفوظة

    def test_replacing_or_clearing_deletes_the_old_file(self):
        hero = HomeHero.load()
        hero.bg_light_en = self.upload("a.png", noisy_png(800, 450))
        hero.save()
        first = Path(hero.bg_light_en.path)
        self.assertTrue(first.exists())

        hero.bg_light_en = self.upload("b.png", noisy_png(800, 450))
        hero.save()
        second = Path(hero.bg_light_en.path)
        self.assertNotEqual(first, second)
        self.assertFalse(first.exists())
        self.assertTrue(second.exists())

        hero.bg_light_en = ""
        hero.save()
        self.assertFalse(second.exists())

    def test_saving_text_does_not_touch_the_stored_images(self):
        hero = HomeHero.load()
        hero.bg_light_ar = self.upload("x.png", noisy_png(800, 450))
        hero.save()
        before = hero.bg_light_ar.name
        hero = HomeHero.load()
        hero.main_en = "Your love story"
        hero.save()
        self.assertEqual(HomeHero.load().bg_light_ar.name, before)
        self.assertTrue(Path(HomeHero.load().bg_light_ar.path).exists())


class HeroPublicPayloadTests(HeroBase):
    def test_site_api_exposes_hero_images_and_text(self):
        hero = HomeHero.load()
        hero.bg_dark_en = self.upload("d.png", noisy_png(800, 450))
        hero.main_ar = "عنوان جديد"
        hero.trust2_value_en = "12h"
        hero.save()
        data = Client().get("/api/v1/site/").json()["hero"]
        self.assertTrue(data["images"]["darkEn"].startswith("/media/home/"))
        self.assertTrue(data["images"]["darkEn"].endswith(".webp"))
        self.assertEqual(data["images"]["lightAr"], "")
        self.assertEqual(data["text"]["ar"]["main"], "عنوان جديد")
        self.assertEqual(data["text"]["en"]["trust"][1]["value"], "12h")
        self.assertEqual(data["text"]["en"]["top"], "")  # فاضي = الافتراضي المترجم في الواجهة

    def test_boot_data_in_the_shell_carries_the_hero(self):
        HomeHero.load()
        html = Client().get("/").content.decode()
        self.assertIn('"hero"', html)


class HeroDataAdminTests(HeroBase):
    def test_it_is_a_single_record_table_in_the_catalog(self):
        HomeHero.load()
        keys = {m["key"]: m for a in self.client.get("/api/v1/data/").json()["apps"] for m in a["models"]}
        self.assertTrue(keys["system.homehero"]["single"])

    def test_form_groups_images_and_texts_in_the_admin_order(self):
        data = self.client.get(f"{BASE}/{HomeHero.load().pk}/").json()
        self.assertEqual(data["fieldsets"][0]["fields"], ["bg_light_ar", "bg_light_en", "bg_dark_ar", "bg_dark_en"])
        kinds = {f["name"]: f["kind"] for f in data["fields"]}
        self.assertEqual(kinds["bg_dark_ar"], "image")
        self.assertEqual(kinds["main_ar"], "text")
        self.assertEqual(len(data["fieldsets"]), 5)

    def test_editing_texts_through_the_data_admin(self):
        pk = HomeHero.load().pk
        response = self.client.post(f"{BASE}/{pk}/", data=json.dumps({"main_ar": "تعكس قصتكم", "cta_en": "Start now"}), content_type="application/json")
        self.assertEqual(response.status_code, 200, response.content[:300])
        hero = HomeHero.load()
        self.assertEqual((hero.main_ar, hero.cta_en), ("تعكس قصتكم", "Start now"))

    def test_uploading_a_background_through_the_data_admin_compresses_it(self):
        pk = HomeHero.load().pk
        original = noisy_png()
        response = self.client.post(f"{BASE}/{pk}/", {"payload": json.dumps({}), "bg_light_ar": self.upload("big.png", original)})
        self.assertEqual(response.status_code, 200, response.content[:300])
        stored = Path(HomeHero.load().bg_light_ar.path)
        self.assertEqual(stored.suffix, ".webp")
        self.assertLess(stored.stat().st_size, len(original) / 2)

    def test_removing_a_background_through_the_data_admin(self):
        hero = HomeHero.load()
        hero.bg_dark_ar = self.upload("x.png", noisy_png(800, 450))
        hero.save()
        path = Path(hero.bg_dark_ar.path)
        response = self.client.post(f"{BASE}/{hero.pk}/", data=json.dumps({"bg_dark_ar": None}), content_type="application/json")
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertFalse(HomeHero.load().bg_dark_ar)
        self.assertFalse(path.exists())
