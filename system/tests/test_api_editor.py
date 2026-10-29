"""اختبارات واجهة المحرر البصري (‎/api/v1/editor/‎).

كل مسار: نجاح، تحقق، غير داخل (401)، داخل وليس من فريق العمل (403)، وCSRF.
"""

import json
import tempfile
from pathlib import Path

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from system import blocks as B
from system.data import golden_classic
from system.models import Customer, Invitation, Plan, Template

BASE = "/api/v1/editor"


def _endpoints(inv, tpl):
    return [
        ("GET", f"{BASE}/schema/"),
        ("GET", f"{BASE}/invitations/{inv}/"),
        ("POST", f"{BASE}/invitations/{inv}/preview/"),
        ("POST", f"{BASE}/invitations/{inv}/save/"),
        ("POST", f"{BASE}/invitations/{inv}/translations/"),
        ("POST", f"{BASE}/invitations/{inv}/save-template/"),
        ("GET", f"{BASE}/templates/{tpl}/"),
        ("POST", f"{BASE}/templates/{tpl}/preview/"),
        ("POST", f"{BASE}/templates/{tpl}/save/"),
        ("POST", f"{BASE}/templates/{tpl}/translations/"),
    ]


class EditorApiCase(TestCase):
    def setUp(self):
        cache.clear()
        self.staff = User.objects.create_user("owner", password="x" * 12, is_staff=True)
        self.plain = User.objects.create_user("visitor", password="x" * 12)
        self.client = Client(enforce_csrf_checks=True)
        self.client.force_login(self.staff)

        self.customer = Customer.objects.create(name="عميل", phone="0100")
        # باقة فيها RSVP بس: أقسام العد التنازلي والمعرض… خارج الباقة
        self.plan = Plan.objects.create(name="أساسية", slug="basic", price=100,
                                        features=["rsvp"])
        self.template = Template.objects.create(
            name="ذهبي", slug="golden-t", document=golden_classic.build())
        self.inv = Invitation.objects.create(
            customer=self.customer, template=self.template, plan=self.plan,
            name_one="ليلى", name_two="أحمد", status="published", venue="القاعة")

    def csrf(self):
        return {"HTTP_X_CSRFTOKEN": self.client.get("/api/v1/csrf/").json()["csrfToken"]}

    def post(self, path, data):
        return self.client.post(path, data=json.dumps(data),
                                content_type="application/json", **self.csrf())

    def assertError(self, response, status, code):
        self.assertEqual(response.status_code, status, response.content[:300])
        self.assertEqual(response.json()["error"]["code"], code)


# ---------------------------------------------------------------- الحماية
class GuardTests(EditorApiCase):
    def test_anonymous_gets_401(self):
        self.client.logout()
        for method, path in _endpoints(self.inv.pk, self.template.pk):
            with self.subTest(path=path):
                response = (self.client.get(path) if method == "GET"
                            else self.post(path, {}))
                self.assertEqual(response.status_code, 401, response.content[:200])

    def test_non_staff_gets_403(self):
        self.client.force_login(self.plain)
        for method, path in _endpoints(self.inv.pk, self.template.pk):
            with self.subTest(path=path):
                response = (self.client.get(path) if method == "GET"
                            else self.post(path, {}))
                self.assertEqual(response.status_code, 403, response.content[:200])

    def test_post_without_csrf_is_rejected(self):
        for method, path in _endpoints(self.inv.pk, self.template.pk):
            if method != "POST":
                continue
            with self.subTest(path=path):
                response = self.client.post(path, data="{}", content_type="application/json")
                self.assertEqual(response.status_code, 403)

    def test_unknown_ids_are_404(self):
        self.assertError(self.client.get(f"{BASE}/invitations/999999/"), 404, "not_found")
        self.assertError(self.client.get(f"{BASE}/templates/999999/"), 404, "not_found")


# ---------------------------------------------------------------- السكيما
class SchemaTests(EditorApiCase):
    def test_schema_matches_engine_and_caches_by_etag(self):
        response = self.client.get(f"{BASE}/schema/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(set(data["blocks"]), set(B.BLOCK_REGISTRY))
        self.assertTrue(data["theme_fields"] and data["settings_fields"])
        self.assertIn("private", response["Cache-Control"])
        etag = response["ETag"]
        again = self.client.get(f"{BASE}/schema/", HTTP_IF_NONE_MATCH=etag)
        self.assertEqual(again.status_code, 304)


# ---------------------------------------------------------------- فتح المحرر
class BootstrapTests(EditorApiCase):
    def test_invitation_bootstrap(self):
        data = self.client.get(f"{BASE}/invitations/{self.inv.pk}/").json()
        self.assertEqual(data["mode"], "invitation")
        self.assertEqual(data["id"], self.inv.pk)
        self.assertEqual(data["features"], sorted(self.inv.allowed_features))
        self.assertEqual(data["fields"]["nameOne"], "ليلى")
        self.assertEqual(data["fields"]["venue"], "القاعة")
        self.assertEqual(data["fields"]["slug"], self.inv.slug)
        self.assertEqual(data["meta"]["slug"], self.inv.slug)
        self.assertIn(self.inv.slug, data["meta"]["publicUrl"])
        self.assertEqual(data["meta"]["planName"], "أساسية")
        for key in ("assets", "fonts", "intros", "videos", "music", "categories"):
            self.assertIsInstance(data[key], list, key)

    def test_video_and_intro_libraries_are_split(self):
        from system.models import IntroVideo
        IntroVideo.objects.create(name="افتتاحية", library="intros", external_url="https://x.test/i.mp4")
        IntroVideo.objects.create(name="فيديو", library="videos", external_url="https://x.test/v.mp4")
        data = self.client.get(f"{BASE}/invitations/{self.inv.pk}/").json()
        self.assertEqual([v["name"] for v in data["intros"]], ["افتتاحية"])
        self.assertEqual([v["name"] for v in data["videos"]], ["فيديو"])

    def test_empty_invitation_document_falls_back_to_template(self):
        self.assertFalse(self.inv.get_document()["blocks"])
        data = self.client.get(f"{BASE}/invitations/{self.inv.pk}/").json()
        self.assertEqual(
            [b["type"] for b in data["document"]["blocks"]],
            [b["type"] for b in self.template.get_document()["blocks"]])

    def test_event_date_uses_datetime_local_format(self):
        self.inv.event_date = timezone.now().replace(microsecond=0)
        self.inv.save()
        value = self.client.get(f"{BASE}/invitations/{self.inv.pk}/").json()["fields"]["eventDate"]
        self.assertRegex(value, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")

    def test_invitation_bootstrap_lists_status_choices(self):
        data = self.client.get(f"{BASE}/invitations/{self.inv.pk}/").json()
        self.assertEqual(
            [(c["value"], c["label"]) for c in data["statusChoices"]],
            [(value, str(label)) for value, label in Invitation.STATUS_CHOICES])
        self.assertIn(data["fields"]["status"], [c["value"] for c in data["statusChoices"]])

    def test_template_bootstrap(self):
        data = self.client.get(f"{BASE}/templates/{self.template.pk}/").json()
        self.assertEqual(data["mode"], "template")
        self.assertIsNone(data["fields"])
        self.assertEqual(data["features"], sorted(B.feature_keys()))
        self.assertTrue(data["document"]["blocks"])
        self.assertIn(self.template.slug, data["meta"]["publicUrl"])


# ---------------------------------------------------------------- المعاينة
class PreviewTests(EditorApiCase):
    def doc(self, *blocks):
        document = B.empty_document()
        document["blocks"] = list(blocks)
        return document

    def preview(self, document, **extra):
        return self.post(f"{BASE}/invitations/{self.inv.pk}/preview/",
                         {"document": document, **extra})

    def test_hidden_blocks_stay_for_the_editor_and_are_marked(self):
        shown = B.make_block("text")
        hidden = B.make_block("quote", visible=False)
        data = self.preview(self.doc(shown, hidden)).json()
        by_id = {b["id"]: b for b in data["blocks"]}
        self.assertEqual(set(by_id), {shown["id"], hidden["id"]})
        self.assertIs(by_id[hidden["id"]]["hidden"], True)
        self.assertIn("lb--hidden", by_id[hidden["id"]]["attrs"]["className"])
        self.assertIs(by_id[shown["id"]]["hidden"], False)
        self.assertNotIn("lb--hidden", by_id[shown["id"]]["attrs"]["className"])
        self.assertIs(data["editable"], True)
        self.assertEqual(data["kind"], "invitation")

    def test_editor_payload_carries_dragged_offsets_and_lock_state(self):
        moved = B.make_block("hero")
        moved["layout"] = {"kicker": {"dx": 4.5, "dy": -2}}
        locked = B.make_block("text")
        locked["locked"] = True
        data = self.preview(self.doc(moved, locked)).json()
        by_id = {b["id"]: b for b in data["blocks"]}
        self.assertEqual(by_id[moved["id"]]["layout"], {"kicker": {"dx": 4.5, "dy": -2}})
        self.assertIs(by_id[moved["id"]]["locked"], False)
        self.assertIs(by_id[locked["id"]]["locked"], True)
        self.assertEqual(by_id[locked["id"]]["layout"], {})
        # الستايل الدايم للإزاحة بيطلع في css.layout زي ما بيشوفه الضيف
        self.assertIn('data-move="kicker"', data["css"]["layout"])

    def test_guest_render_never_exposes_editor_only_fields(self):
        from system.api import invite_render
        moved = B.make_block("hero")
        moved["layout"] = {"kicker": {"dx": 4.5, "dy": 0}}
        payload, _ = invite_render.build_payload(self.doc(moved))
        self.assertNotIn("layout", payload["blocks"][0])
        self.assertNotIn("locked", payload["blocks"][0])

    def test_guest_render_still_skips_hidden_blocks(self):
        from system.api import invite_render
        hidden = B.make_block("quote", visible=False)
        payload, _ = invite_render.build_payload(self.doc(B.make_block("text"), hidden))
        self.assertEqual([b["type"] for b in payload["blocks"]], ["text"])
        self.assertNotIn("hidden", payload["blocks"][0])
        self.assertNotIn("gated", payload["blocks"][0])

    def test_blocks_outside_the_plan_are_flagged(self):
        data = self.preview(self.doc(B.make_block("countdown"), B.make_block("text"))).json()
        flags = {b["type"]: b["gated"] for b in data["blocks"]}
        self.assertEqual(flags, {"countdown": True, "text": False})

    def test_unsaved_draft_is_what_gets_rendered(self):
        block = B.make_block("text", props={"heading": "عنوان مسودة"})
        data = self.preview(self.doc(block)).json()
        self.assertEqual(data["blocks"][0]["props"]["heading"], "عنوان مسودة")
        self.assertFalse(self.inv.get_document()["blocks"])     # مفيش حاجة اتحفظت

    def test_rsvp_is_a_demo_inside_the_editor(self):
        data = self.preview(self.doc(B.make_block("rsvp"))).json()
        rsvp = data["blocks"][0]["rsvp"]
        self.assertTrue(rsvp["demo"])
        self.assertEqual(rsvp["action"], "")

    def test_missing_translation_falls_back_to_the_base_language(self):
        data = self.preview(self.doc(B.make_block("text")), lang="en").json()
        self.assertEqual(data["lang"], data["baseLang"])

    def test_css_strings_are_always_included(self):
        data = self.preview(self.doc(B.make_block("text"))).json()
        self.assertEqual(set(data["css"]), {"font", "layout", "shared", "zero"})
        self.assertIn("--", data["bodyStyle"])

    def test_document_is_required(self):
        path = f"{BASE}/invitations/{self.inv.pk}/preview/"
        self.assertError(self.post(path, {}), 400, "invalid_document")
        self.assertError(self.post(path, {"document": [1]}), 400, "invalid_document")

    def hero_names(self, **extra):
        """اسمَي العروسين اللي المعاينة رسمتهم (الهيرو بيورّثهم من بيانات المناسبة)."""
        hero = B.make_block("hero", props={"name_one": "", "name_two": ""})
        props = self.preview(self.doc(hero), **extra).json()["blocks"][0]["props"]
        return props["name_one"], props["name_two"]

    def test_preview_reflects_unsaved_event_fields_without_saving(self):
        self.assertEqual(self.hero_names(), ("ليلى", "أحمد"))
        self.assertEqual(
            self.hero_names(fields={"nameOne": "سارة", "nameTwo": "خالد"}), ("سارة", "خالد"))
        self.inv.refresh_from_db()
        self.assertEqual((self.inv.name_one, self.inv.name_two), ("ليلى", "أحمد"))

    def test_preview_event_date_and_venue_flow_into_the_payload(self):
        details = B.make_block("location", props={"venue": "", "address": ""})
        data = self.preview(self.doc(details), fields={
            "venue": "الفندق الكبير", "address": "الإسكندرية", "eventDate": "2031-02-03T19:30",
        }).json()
        self.assertEqual(data["blocks"][0]["props"]["venue"], "الفندق الكبير")
        self.assertEqual(data["blocks"][0]["props"]["address"], "الإسكندرية")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.venue, "القاعة")
        self.assertIsNone(self.inv.event_date)

    def test_preview_ignores_invalid_fields_and_keeps_the_saved_value(self):
        response = self.preview(self.doc(B.make_block("text")), fields={
            "nameOne": "سارة", "eventDate": "not-a-date", "slug": "ab", "status": "bogus",
        })
        self.assertEqual(response.status_code, 200, response.content[:300])
        names = self.hero_names(fields={"nameOne": "سارة", "eventDate": "not-a-date", "slug": "ab"})
        self.assertEqual(names[0], "سارة")          # الصالح اتطبّق، الغلط اتجاهل
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.status, "published")

    def test_preview_fields_are_optional_and_unknown_keys_are_ignored(self):
        self.assertEqual(self.hero_names(fields=None), ("ليلى", "أحمد"))
        self.assertEqual(self.hero_names(fields="oops"), ("ليلى", "أحمد"))
        self.assertEqual(self.hero_names(fields={"plan": 99, "customer": 5}), ("ليلى", "أحمد"))
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.plan_id, self.plan.pk)

    def test_template_preview_never_flags_features(self):
        path = f"{BASE}/templates/{self.template.pk}/preview/"
        data = self.post(path, {"document": self.doc(B.make_block("countdown"))}).json()
        self.assertEqual(data["kind"], "template")
        self.assertIs(data["blocks"][0]["gated"], False)


# ---------------------------------------------------------------- الحفظ
class SaveTests(EditorApiCase):
    def path(self):
        return f"{BASE}/invitations/{self.inv.pk}/save/"

    def test_saves_document_and_fields(self):
        block = B.make_block("text", props={"heading": "محفوظ"})
        document = B.empty_document()
        document["blocks"] = [block]
        response = self.post(self.path(), {
            "document": document,
            "fields": {"nameOne": "سارة", "venue": "الفندق", "eventDate": "2030-05-01T20:30"},
        })
        self.assertEqual(response.status_code, 200, response.content[:300])
        body = response.json()
        self.assertEqual(body["slug"], self.inv.slug)
        self.assertRegex(body["savedAt"], r"^\d{2}:\d{2}:\d{2}$")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.name_one, "سارة")
        self.assertEqual(self.inv.venue, "الفندق")
        self.assertEqual(timezone.localtime(self.inv.event_date).strftime("%Y-%m-%d %H:%M"),
                         "2030-05-01 20:30")
        saved = self.inv.get_document()
        self.assertEqual([b["id"] for b in saved["blocks"]], [block["id"]])
        self.assertEqual(saved["blocks"][0]["props"]["heading"], "محفوظ")

    def test_document_only_save_keeps_event_data(self):
        document = B.empty_document()
        document["blocks"] = [B.make_block("text")]
        self.assertEqual(self.post(self.path(), {"document": document}).status_code, 200)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.name_one, "ليلى")
        self.assertEqual(self.inv.venue, "القاعة")
        self.assertEqual(self.inv.status, "published")

    def test_document_is_normalized_before_saving(self):
        document = B.empty_document()
        document["blocks"] = [B.make_block("text"), {"id": "x1", "type": "no-such-type", "props": {}}]
        self.post(self.path(), {"document": document})
        self.inv.refresh_from_db()
        self.assertEqual([b["type"] for b in self.inv.get_document()["blocks"]], ["text"])

    def test_slug_change_is_returned(self):
        document = B.empty_document()
        response = self.post(self.path(), {"document": document, "fields": {"slug": "My New Slug"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["slug"], "my-new-slug")
        self.assertIn("my-new-slug", response.json()["publicUrl"])

    def test_invalid_slug_is_a_validation_error(self):
        document = B.empty_document()
        other = Invitation.objects.create(customer=self.customer, template=self.template,
                                          slug="taken-slug")
        for value in ("ab", "rsvp", other.slug):
            with self.subTest(slug=value):
                response = self.post(self.path(), {"document": document, "fields": {"slug": value}})
                self.assertError(response, 400, "validation_error")
                self.assertIn("slug", response.json()["error"]["fields"])
        self.inv.refresh_from_db()
        self.assertNotEqual(self.inv.slug, "taken-slug")

    def test_document_is_required(self):
        self.assertError(self.post(self.path(), {"fields": {"nameOne": "x"}}), 400, "invalid_document")
        self.assertError(self.post(self.path(), {"document": "nope"}), 400, "invalid_document")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.name_one, "ليلى")

    def test_invalid_json_is_400(self):
        response = self.client.post(self.path(), data="{oops", content_type="application/json",
                                    **self.csrf())
        self.assertError(response, 400, "invalid_json")

    def test_template_save(self):
        block = B.make_block("text", props={"heading": "قالب"})
        document = B.empty_document()
        document["blocks"] = [block]
        response = self.post(f"{BASE}/templates/{self.template.pk}/save/", {"document": document})
        self.assertEqual(response.status_code, 200, response.content[:300])
        self.assertIn(self.template.slug, response.json()["publicUrl"])
        self.template.refresh_from_db()
        self.assertEqual([b["id"] for b in self.template.get_document()["blocks"]], [block["id"]])
        self.assertEqual(self.template.preview_render, {})


# ---------------------------------------------------------------- حفظ كقالب
class SaveAsTemplateTests(EditorApiCase):
    def path(self):
        return f"{BASE}/invitations/{self.inv.pk}/save-template/"

    def document(self):
        doc = B.normalize_document(golden_classic.build())
        hero = next(b for b in doc["blocks"] if b["type"] == "hero")
        hero["props"]["date_text"] = "الإثنين ٢ نوفمبر"
        return doc

    def test_creates_a_template_from_the_unsaved_document_without_personal_data(self):
        before = Template.objects.count()
        response = self.post(self.path(), {
            "document": self.document(), "name": "قالبي الجديد", "slug": "My New One",
            "category": "wedding", "collection": "Gold", "description": "وصف", "isActive": False,
        })
        self.assertEqual(response.status_code, 200, response.content[:300])
        data = response.json()
        self.assertEqual(Template.objects.count(), before + 1)
        template = Template.objects.get(pk=data["templateId"])
        self.assertEqual((template.name, template.collection, template.description, template.source),
                         ("قالبي الجديد", "Gold", "وصف", "editor"))
        self.assertFalse(template.is_active)
        self.assertEqual(template.created_by, self.staff)
        self.assertEqual(data["slug"], template.slug)
        hero = next(b for b in template.get_document()["blocks"] if b["type"] == "hero")
        self.assertEqual(hero["props"]["date_text"], "")

    def test_the_invitation_itself_is_untouched(self):
        before = self.inv.get_document()
        self.post(self.path(), {"document": self.document(), "name": "قالب"})
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.get_document(), before)
        self.assertEqual(self.inv.template_id, self.template.pk)

    def test_required_features_come_from_the_sections(self):
        document = B.empty_document()
        document["blocks"] = [B.make_block("countdown")]
        data = self.post(self.path(), {"document": document, "name": "بعد تنازلي"}).json()
        template = Template.objects.get(pk=data["templateId"])
        self.assertEqual(template.required_features,
                         sorted({B.BLOCK_REGISTRY["countdown"]["feature"]} - {""}))

    def test_defaults_when_optional_fields_are_missing_or_wrong(self):
        data = self.post(self.path(), {"document": self.document(), "name": "قالب", "category": "nope"}).json()
        template = Template.objects.get(pk=data["templateId"])
        self.assertEqual((template.category, template.collection, template.is_active), ("wedding", "Premium", True))

    def test_name_is_required(self):
        before = Template.objects.count()
        for name in ("", " ", "x"):
            with self.subTest(name=name):
                response = self.post(self.path(), {"document": self.document(), "name": name})
                self.assertError(response, 400, "invalid")
                self.assertIn("name", response.json()["error"]["fields"])
        self.assertEqual(Template.objects.count(), before)

    def test_missing_document_and_unknown_invitation(self):
        self.assertError(self.post(self.path(), {"name": "قالب"}), 400, "invalid_document")
        self.assertError(self.post(f"{BASE}/invitations/999999/save-template/", {"document": {}, "name": "قالب"}), 404, "not_found")


# ---------------------------------------------------------------- إطار المعاينة (iframe)
class FramePageTests(TestCase):
    """‎/editor-frame/‎: shell فاضي لفريق العمل بس، ومتحمّل في نفس الأصل."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        manifest = {"src/editor-frame-main.tsx": {"file": "assets/editorFrame-abc.js", "isEntry": True,
                                                  "css": ["assets/editorFrame-abc.css"]}}
        (Path(tmp.name) / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        override = override_settings(VITE_BUILD_DIR=Path(tmp.name), VITE_DEV_SERVER="")
        override.enable()
        self.addCleanup(override.disable)
        self.staff = User.objects.create_user("owner", password="x" * 12, is_staff=True)
        self.plain = User.objects.create_user("visitor", password="x" * 12)

    def test_staff_gets_the_shell(self):
        self.client.force_login(self.staff)
        response = self.client.get("/editor-frame/")
        self.assertEqual(response.status_code, 200)
        html = response.content.decode()
        self.assertIn('id="root"', html)
        self.assertIn("editorFrame-abc.js", html)
        self.assertIn("lb-doc--editing", html)
        self.assertEqual(response["X-Frame-Options"], "SAMEORIGIN")
        self.assertIn("noindex", response["X-Robots-Tag"])

    def test_anonymous_and_non_staff_are_refused(self):
        self.assertEqual(self.client.get("/editor-frame/").status_code, 403)
        self.client.force_login(self.plain)
        self.assertEqual(self.client.get("/editor-frame/").status_code, 403)


# ---------------------------------------------------------------- تبويب الترجمة
class TranslationRowsTests(EditorApiCase):
    def rows(self, document, **extra):
        response = self.post(f"{BASE}/invitations/{self.inv.pk}/translations/",
                             {"document": document, **extra})
        self.assertEqual(response.status_code, 200, response.content[:300])
        return response.json()

    def doc(self, *blocks, **theme):
        document = B.empty_document()
        document["blocks"] = list(blocks)
        document["theme"].update(theme)
        return document

    def test_rows_use_the_engine_keys_in_document_order(self):
        text = B.make_block("text", props={"heading": "أهلاً", "eyebrow": "", "body": ""})
        data = self.rows(self.doc(text))
        keys = [r["key"] for r in data["entries"]]
        self.assertIn(f"{text['id']}.heading", keys)
        self.assertNotIn(f"{text['id']}.eyebrow", keys)        # الفاضي مايتترجمش
        row = next(r for r in data["entries"] if r["key"] == f"{text['id']}.heading")
        self.assertEqual(row["value"], "أهلاً")
        self.assertEqual(row["group"], "قسم نصي")
        self.assertEqual((data["baseLang"], data["altLang"]), ("ar", "en"))

    def test_event_data_rows_use_the_unsaved_fields(self):
        data = self.rows(self.doc(), fields={"nameOne": "سلمى", "venue": "الفندق"})
        by_key = {r["key"]: r["value"] for r in data["entries"]}
        self.assertEqual(by_key["data.name_one"], "سلمى")
        self.assertEqual(by_key["data.venue"], "الفندق")
        self.assertEqual(by_key["data.name_two"], "أحمد")
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.name_one, "ليلى")             # مفيش حفظ

    def test_english_base_flips_the_alt_language(self):
        data = self.rows(self.doc(base_lang="en"))
        self.assertEqual((data["baseLang"], data["altLang"]), ("en", "ar"))

    def test_list_items_get_indexed_keys(self):
        agenda = B.make_block("agenda", props={"items": [{"time": "7", "title": "الزفة", "icon": "music"}]})
        keys = [r["key"] for r in self.rows(self.doc(agenda))["entries"]]
        self.assertIn(f"{agenda['id']}.items.0.title", keys)

    def test_template_editor_has_no_event_data_rows(self):
        path = f"{BASE}/templates/{self.template.pk}/translations/"
        response = self.post(path, {"document": self.doc(B.make_block("text"))})
        self.assertEqual(response.status_code, 200)
        keys = [r["key"] for r in response.json()["entries"]]
        self.assertTrue(keys)
        self.assertFalse([k for k in keys if k.startswith("data.")])

    def test_document_is_required(self):
        path = f"{BASE}/invitations/{self.inv.pk}/translations/"
        self.assertError(self.post(path, {}), 400, "invalid_document")
