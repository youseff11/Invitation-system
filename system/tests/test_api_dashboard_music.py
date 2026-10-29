"""مسح المقطوعات المكررة من مكتبة الموسيقى (‎/api/v1/dashboard/music/dedupe/‎)."""

import os

from django.core.files.base import ContentFile

from system.models import Invitation, MusicTrack, Template
from system.tests.test_api_dashboard import BASE, DashboardApiCase

DEDUPE = f"{BASE}/music/dedupe/"


class DedupeCase(DashboardApiCase):
    def setUp(self):
        super().setUp()
        self.track.delete()  # مقطوعة الأساس من الـsetUp مش محتاجينها هنا

    def file_track(self, name, content, **extra):
        track = MusicTrack(name=name, **extra)
        track.file.save("song.mp3", ContentFile(content), save=False)
        track.save()
        return track

    def disk(self, track):
        return os.path.exists(track.file.path)

    def invitation_pointing_at(self, url):
        invitation = Invitation.objects.create(customer=self.customer, template=self.template,
                                               name_one="س", name_two="ص", status="draft")
        doc = invitation.document
        doc["settings"]["music_url"] = url
        invitation.document = doc
        invitation.save()
        return invitation

    def music_url_of(self, invitation):
        invitation.refresh_from_db()
        return invitation.document["settings"]["music_url"]

    def run_dedupe(self, **body):
        return self.post(DEDUPE, body)


class GuardTests(DedupeCase):
    def test_requires_login(self):
        self.client.logout()
        self.assertEqual(self.client.post(DEDUPE, **self.csrf()).status_code, 401)

    def test_requires_staff(self):
        self.client.force_login(self.plain)
        self.assertEqual(self.post(DEDUPE, {}).status_code, 403)

    def test_requires_csrf(self):
        self.assertEqual(self.client.post(DEDUPE, data="{}", content_type="application/json").status_code, 403)

    def test_post_only(self):
        self.assertEqual(self.get(DEDUPE).status_code, 405)


class ListHintTests(DedupeCase):
    def test_hint_counts_extra_copies_by_name(self):
        self.file_track("أغنية", b"a")
        self.file_track("  أغنية ", b"b")
        self.file_track("أغنية", b"c")
        self.file_track("تانية", b"d")
        self.assertEqual(self.get(f"{BASE}/music/").json()["duplicateExtra"], 2)

    def test_no_duplicates_gives_zero(self):
        self.file_track("واحدة", b"a")
        self.file_track("اتنين", b"b")
        self.assertEqual(self.get(f"{BASE}/music/").json()["duplicateExtra"], 0)


class DetectionTests(DedupeCase):
    def test_same_name_and_same_content_are_duplicates(self):
        a = self.file_track("Zein", b"AUDIO-BYTES")
        self.file_track("Zein", b"AUDIO-BYTES")
        self.file_track("Zein", b"AUDIO-BYTES")
        result = self.run_dedupe(dryRun=True).json()
        self.assertEqual((result["removeCount"], result["keepCount"]), (2, 1))
        self.assertEqual(result["groups"][0]["keepId"], a.pk)  # الأقدم عند التساوي

    def test_same_name_different_content_is_kept(self):
        self.file_track("Zein", b"ONE-SONG")
        self.file_track("Zein", b"OTHER-SONG!")  # حجم مختلف
        self.file_track("Zein", b"SAME-SIZE!!")  # نفس حجم اللي قبله
        self.file_track("Zein", b"OTHER-SONG!")
        result = self.run_dedupe(dryRun=True).json()
        # الاتنين بنفس المحتوى «OTHER-SONG!» بس هم المكررين
        self.assertEqual((result["removeCount"], result["keepCount"]), (1, 1))

    def test_different_names_are_never_duplicates(self):
        self.file_track("أول", b"same")
        self.file_track("تاني", b"same")
        self.assertEqual(self.run_dedupe(dryRun=True).json()["removeCount"], 0)

    def test_name_match_ignores_case_and_spacing(self):
        self.file_track("Blossom  Oud", b"x")
        self.file_track("blossom oud ", b"x")
        self.assertEqual(self.run_dedupe(dryRun=True).json()["removeCount"], 1)

    def test_external_urls(self):
        MusicTrack.objects.create(name="ريمكس", external_url="https://x.test/a.mp3")
        MusicTrack.objects.create(name="ريمكس", external_url="https://x.test/a.mp3")
        MusicTrack.objects.create(name="ريمكس", external_url="https://x.test/b.mp3")
        self.assertEqual(self.run_dedupe(dryRun=True).json()["removeCount"], 1)

    def test_missing_files_with_the_same_name_count_as_duplicates(self):
        # بيئة تطوير من غير مجلد media: مفيش محتوى يتفرّق بيه
        for _ in range(3):
            track = MusicTrack(name="Dev song")
            track.file.name = "music/2026/08/ghost.mp3"
            track.save()
        self.assertEqual(self.run_dedupe(dryRun=True).json()["removeCount"], 2)

    def test_dry_run_changes_nothing(self):
        self.file_track("Zein", b"x")
        self.file_track("Zein", b"x")
        self.run_dedupe(dryRun=True)
        self.assertEqual(MusicTrack.objects.count(), 2)

    def test_nothing_to_do(self):
        self.file_track("وحيدة", b"x")
        result = self.run_dedupe().json()
        self.assertEqual((result["removeCount"], result["keepCount"], result["groups"]), (0, 0, []))
        self.assertEqual(MusicTrack.objects.count(), 1)


class ApplyTests(DedupeCase):
    def test_keeps_one_per_group_and_deletes_the_rest_with_their_files(self):
        first = self.file_track("Zein", b"x" * 100)
        second = self.file_track("Zein", b"x" * 100)
        third = self.file_track("Zein", b"x" * 100)
        solo = self.file_track("Other", b"y")
        # الملفات بتتمسح بعد نجاح المعاملة (on_commit)
        with self.captureOnCommitCallbacks(execute=True):
            result = self.run_dedupe().json()
        self.assertEqual((result["removeCount"], result["keepCount"]), (2, 1))
        self.assertEqual(result["freedBytes"], 200)
        self.assertEqual(set(MusicTrack.objects.values_list("pk", flat=True)), {first.pk, solo.pk})
        self.assertTrue(self.disk(first))
        self.assertTrue(self.disk(solo))
        self.assertFalse(os.path.exists(second.file.path))
        self.assertFalse(os.path.exists(third.file.path))

    def test_prefers_the_copy_that_documents_point_to(self):
        old = self.file_track("Zein", b"x")
        used = self.file_track("Zein", b"x")
        invitation = self.invitation_pointing_at(used.url)
        result = self.run_dedupe().json()
        self.assertEqual(result["groups"][0]["keepId"], used.pk)
        self.assertEqual(result["repointedDocs"], 0)  # اللي مستخدم هو اللي فضل، فمفيش مستند اتبدّل
        self.assertFalse(MusicTrack.objects.filter(pk=old.pk).exists())
        self.assertEqual(self.music_url_of(invitation), used.url)

    def test_documents_pointing_at_a_removed_copy_are_redirected_to_the_kept_one(self):
        older = self.file_track("Zein", b"x")
        popular = self.file_track("Zein", b"x")
        straggler = self.invitation_pointing_at(older.url)  # مرجع واحد على القديمة
        self.invitation_pointing_at(popular.url)  # ومرجعين على الشعبية
        self.invitation_pointing_at(popular.url)
        result = self.run_dedupe().json()
        self.assertEqual(result["groups"][0]["keepId"], popular.pk)
        self.assertEqual(result["repointedDocs"], 1)
        self.assertEqual(self.music_url_of(straggler), popular.url)
        self.assertEqual(list(MusicTrack.objects.values_list("pk", flat=True)), [popular.pk])

    def test_percent_encoded_and_decoded_links_are_both_redirected(self):
        from urllib.parse import unquote

        kept = MusicTrack(name="Arabic")
        kept.file.save("أغنية-١.mp3", ContentFile(b"x"), save=False)
        kept.save()
        gone = MusicTrack(name="Arabic")
        gone.file.save("أغنية-٢.mp3", ContentFile(b"x"), save=False)
        gone.save()
        self.assertNotEqual(kept.url, unquote(kept.url))  # الرابط في الموديل مكوّد
        self.invitation_pointing_at(kept.url)
        self.invitation_pointing_at(kept.url)
        decoded = self.invitation_pointing_at(unquote(gone.url))  # مفكوك زي ما بيتكتب أحياناً
        encoded = self.invitation_pointing_at(gone.url)
        self.run_dedupe()
        self.assertEqual(self.music_url_of(decoded), unquote(kept.url))
        self.assertEqual(self.music_url_of(encoded), kept.url)

    def test_a_longer_file_name_sharing_the_same_prefix_is_not_touched(self):
        self.file_track("Zein", b"x")
        gone = self.file_track("Zein", b"x")
        self.invitation_pointing_at(gone.url)
        lookalike = self.invitation_pointing_at(gone.url + "9")  # ملف تاني اسمه أطول
        self.run_dedupe()
        self.assertEqual(self.music_url_of(lookalike), gone.url + "9")

    def test_template_documents_are_redirected_and_their_cached_preview_is_cleared(self):
        older = self.file_track("Zein", b"x")
        popular = self.file_track("Zein", b"x")
        doc = self.template.document
        doc["settings"]["music_url"] = older.url
        self.template.document = doc
        self.template.save()
        Template.objects.filter(pk=self.template.pk).update(preview_render={"stale": True})
        self.invitation_pointing_at(popular.url)
        self.invitation_pointing_at(popular.url)
        self.run_dedupe()
        self.template.refresh_from_db()
        self.assertEqual(self.template.document["settings"]["music_url"], popular.url)
        self.assertEqual(self.template.preview_render, {})

    def test_availability_is_not_lost(self):
        hidden = self.file_track("Zein", b"x", is_active=False)
        visible = self.file_track("Zein", b"x", is_active=True)
        self.run_dedupe()
        survivor = MusicTrack.objects.get(name="Zein")
        self.assertTrue(survivor.is_active)
        self.assertEqual(survivor.pk, visible.pk)  # المتاحة أولى
        self.assertFalse(MusicTrack.objects.filter(pk=hidden.pk).exists())

    def test_a_hidden_keeper_is_reactivated_if_a_removed_copy_was_available(self):
        popular_but_hidden = self.file_track("Zein", b"x", is_active=False)
        available = self.file_track("Zein", b"x", is_active=True)
        self.invitation_pointing_at(popular_but_hidden.url)
        self.invitation_pointing_at(popular_but_hidden.url)
        self.run_dedupe()
        survivor = MusicTrack.objects.get(name="Zein")
        self.assertEqual(survivor.pk, popular_but_hidden.pk)
        self.assertTrue(survivor.is_active)
        self.assertFalse(MusicTrack.objects.filter(pk=available.pk).exists())

    def test_shared_file_is_not_deleted_while_another_row_uses_it(self):
        keeper = self.file_track("Zein", b"x")
        twin = MusicTrack(name="Zein")
        twin.file.name = keeper.file.name  # صفين بيشاوروا على نفس الملف
        twin.save()
        with self.captureOnCommitCallbacks(execute=True):
            self.run_dedupe()
        self.assertEqual(MusicTrack.objects.filter(name="Zein").count(), 1)
        self.assertTrue(self.disk(keeper))

    def test_second_run_is_a_no_op(self):
        for _ in range(3):
            self.file_track("Zein", b"x")
        self.run_dedupe()
        self.assertEqual(self.run_dedupe().json()["removeCount"], 0)
