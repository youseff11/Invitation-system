"""نسخة الموبايل من الفيديو (‎.web.mp4‎) وتوجيه الروابط ليها."""

import os
import shutil
import subprocess
import tempfile
import unittest

from django.test import SimpleTestCase, override_settings

from system import video
from system.templatetags import invite as tags


class WebRenditionUrlTests(SimpleTestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        os.makedirs(os.path.join(self.root, "assets", "v"))
        with open(os.path.join(self.root, "assets", "v", "big.mp4"), "wb") as fh:
            fh.write(b"x")

    def test_original_when_no_rendition(self):
        with override_settings(MEDIA_ROOT=self.root, MEDIA_URL="/media/"):
            self.assertEqual(tags.video_url("/media/assets/v/big.mp4"),
                             "/media-video/assets/v/big.mp4")

    def test_rendition_is_preferred_when_present(self):
        with open(os.path.join(self.root, "assets", "v", "big.web.mp4"), "wb") as fh:
            fh.write(b"y")
        with override_settings(MEDIA_ROOT=self.root, MEDIA_URL="/media/"):
            self.assertEqual(tags.video_url("/media/assets/v/big.mp4"),
                             "/media-video/assets/v/big.web.mp4")
            # الروابط جوّه HTML (كود مخصّص) بتتوجّه برضه
            html = str(tags.safe_html('<video src="/media/assets/v/big.mp4"></video>', 0))
            self.assertIn("/media-video/assets/v/big.web.mp4", html)

    def test_external_urls_untouched(self):
        with override_settings(MEDIA_ROOT=self.root, MEDIA_URL="/media/"):
            self.assertEqual(tags.video_url("https://cdn.x/v.mp4"), "https://cdn.x/v.mp4")


@unittest.skipUnless(video.available(), "ffmpeg مش متاح")
class MakeWebRenditionTests(SimpleTestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)

    def _make(self, name, size, fps, rate="6M"):
        path = os.path.join(self.dir, name)
        subprocess.run(
            [video.ffmpeg_bin(), "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", f"testsrc2=size={size}:rate={fps}:duration=2",
             "-c:v", "libx264", "-b:v", rate, "-pix_fmt", "yuv420p", path],
            check=True, timeout=120)
        return path

    def test_heavy_vertical_video_gets_720p_30fps_copy(self):
        src = self._make("tall.mp4", "1080x1920", 60)
        out = video.make_web_rendition(src)
        self.assertTrue(out.endswith("tall.web.mp4"))
        info = video.probe(out)
        # أصغر ضلع 720 (مش الارتفاع): الرأسي يفضل حاد
        self.assertEqual((info["width"], info["height"]), (720, 1280))
        self.assertLessEqual(info["fps"], 30.5)
        self.assertLess(os.path.getsize(out), os.path.getsize(src))
        self.assertTrue(os.path.exists(src))  # الأصل مابيتلمسش

    def test_light_video_is_left_alone(self):
        src = self._make("small.mp4", "480x854", 24, rate="400k")
        self.assertEqual(video.make_web_rendition(src), "")
        self.assertFalse(os.path.exists(video.web_path(src)))
