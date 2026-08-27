"""اختبارات مواضع Tilda Zero وتجميع ستايل الأقسام المستوردة.

القيم المتوقّعة هنا مش تخمين: اتقريت من صفحة معاينة شغّالة بعد ما
``t396_init`` خلّص، فالاختبار بيقارن الناتج بالمرجع الحقيقي.
"""

from django.test import SimpleTestCase

from system import tildacss
from system.renderer import layout_css, shared_block_css
from system import templateimport


# artboard حقيقي من قالب Blossom & Oud — تلات عناصر بأنواع مختلفة.
# ملاحظة: من غير ``data-fields`` عن قصد — ‎sanitize.clean_html‎ بيشيلها
# قبل التخزين، فالـHTML اللي بيوصل للمولّد شكله كده بالظبط.
ARTBOARD = (
    '<div class="t396__artboard" data-artboard-recid="2443433753" '
    'data-artboard-screens="320,480,640,960,1200" data-artboard-upscale="grid" '
    'data-artboard-valign="center" data-artboard-proxy-min-offset-top="0" '
    'data-artboard-proxy-min-height="248" data-artboard-proxy-max-height="248">'

    # (1) بلوك HTML: عرض وارتفاع ثابتين + قيم مختلفة لكل مقاس
    '<div class="t396__elem tn-elem tn-elem__24434337531771277551711000001" '
    'data-elem-type="html" '
    'data-field-left-value="335" data-field-left-res-320-value="-75" '
    'data-field-left-res-480-value="-25" data-field-left-res-640-value="55" '
    'data-field-left-res-960-value="215" '
    'data-field-top-value="73" data-field-width-value="531" '
    'data-field-width-res-320-value="470" data-field-height-value="170" '
    'data-field-axisx-value="left" data-field-axisy-value="top" '
    'data-field-container-value="grid" data-field-leftunits-value="px" '
    'data-field-topunits-value="px" data-field-widthunits-value="px"></div>'

    # (2) نص: Tilda بيسيب ارتفاعه auto مهما كانت قيمة الحقل
    '<div class="t396__elem tn-elem tn-elem__24434337531771277026942000001" '
    'data-elem-type="text" '
    'data-field-left-value="323" data-field-left-res-320-value="-120" '
    'data-field-top-value="45" data-field-width-value="560" '
    'data-field-height-value="64" data-field-axisx-value="left" '
    'data-field-axisy-value="top" data-field-container-value="grid" '
    'data-field-leftunits-value="px" data-field-topunits-value="px" '
    'data-field-widthunits-value="px"></div>'

    # (3) صورة hug: من غير ارتفاع صريح
    '<div class="t396__elem tn-elem tn-elem__24434337531779543504626" '
    'data-elem-type="image" '
    'data-field-left-value="531" data-field-left-res-320-value="91" '
    'data-field-top-value="110" data-field-width-value="139" '
    'data-field-height-value="28" data-field-heightmode-value="hug" '
    'data-field-axisx-value="left" data-field-axisy-value="top" '
    'data-field-container-value="grid" data-field-leftunits-value="px" '
    'data-field-topunits-value="px" data-field-widthunits-value="px"></div>'
    '</div>'
)


class ZeroBlockCssTests(SimpleTestCase):

    def test_ignores_html_without_artboards(self):
        self.assertEqual(tildacss.zero_block_css("imp-1", "<p>أهلاً</p>"), "")

    def test_rejects_unsafe_block_id(self):
        self.assertEqual(tildacss.zero_block_css('x" onload="', ARTBOARD), "")

    def test_smallest_breakpoint_has_no_lower_bound(self):
        # ‎t396_detectResolution‎ بيرجّع أصغر مقاس لما الشاشة أضيق منه،
        # فقاعدة 320 لازم تشمل اللي تحتها.
        css = tildacss.zero_block_css("imp-5", ARTBOARD)
        self.assertIn("@media (max-width:479.98px){", css)
        self.assertNotIn("(min-width:320px)", css)

    def test_positions_match_runtime_on_mobile(self):
        """القيم دي مقروءة من صفحة حقيقية بعد ما Tilda خلّص حسابه.

        عند عرض 375px: ‎grid_width = 320‎ و‎grid_offset_left = 27.5‎.
        فمثلاً العنصر الأول: ‎27.5 + (-75) = -47.5px‎، وهو نفسه اللي
        بيطلع من ‎calc(50% - 235px)‎ جوّه artboard عرضه 375px.
        """
        css = tildacss.zero_block_css("imp-5", ARTBOARD)
        mobile = css.split("@media (max-width:479.98px){")[1].split("@media")[0]

        self.assertIn(
            "#imp-5 .tn-elem__24434337531771277551711000001"
            "{width:470px;left:calc(50% - 235px);top:73px;height:170px}",
            mobile,
        )
        self.assertIn(
            "#imp-5 .tn-elem__24434337531771277026942000001"
            "{width:560px;left:calc(50% - 280px);top:45px}",
            mobile,
        )
        self.assertIn(
            "#imp-5 .tn-elem__24434337531779543504626"
            "{width:139px;left:calc(50% - 69px);top:110px}",
            mobile,
        )

    def test_field_falls_back_to_larger_breakpoint(self):
        """مقاس من غير قيمة بياخد قيمة أقرب مقاس **أكبر**، مش الأساسي."""
        css = tildacss.zero_block_css("imp-5", ARTBOARD)
        wide = css.split("@media (min-width:960px) and (max-width:1199.98px){")[1]
        # left عند 960 = 215، و‎grid/2 = 480‎ ← ‎calc(50% - 265px)‎
        self.assertIn("left:calc(50% - 265px)", wide)
        # العنصر التاني مالوش قيمة عند 960 فبياخد الأساسية 323 ← 323-480
        self.assertIn("left:calc(50% - 157px)", wide)

    def test_text_height_stays_auto(self):
        css = tildacss.zero_block_css("imp-5", ARTBOARD)
        self.assertNotIn("height:64px", css)

    def test_hug_image_has_no_height(self):
        css = tildacss.zero_block_css("imp-5", ARTBOARD)
        self.assertNotIn("height:28px", css)

    def test_scale_artboard_is_hidden_until_runtime_renders(self):
        """artboard بوضع ‎upscale=window‎ محتاج ‎zoom‎ محسوب من عرض الشاشة،

        وده رقم مستحيل يتحسب في CSS. الأأمن نخفي عناصره لحد ما الـruntime
        يرسمها بدل ما تظهر مكسورة.
        """
        scaled = ARTBOARD.replace(
            'data-artboard-upscale="grid"', 'data-artboard-upscale="window"'
        )
        css = tildacss.zero_block_css("imp-5", scaled)
        self.assertEqual(
            css,
            "#imp-5 .t396__artboard_scale:not(.rendered) .t396__elem"
            "{visibility:hidden}",
        )

    def test_document_helper_skips_non_tilda_blocks(self):
        blocks = [
            {"id": "b1", "type": "text", "props": {"html": ARTBOARD}},
            {"id": "imp-5", "type": "custom_html", "props": {"html": ARTBOARD}},
            {"id": "imp-6", "type": "custom_html", "props": {"html": "<p>x</p>"}},
        ]
        css = tildacss.document_zero_css(blocks)
        self.assertIn("#imp-5 .tn-elem__", css)
        self.assertNotIn("#b1 ", css)
        self.assertNotIn("#imp-6 ", css)

    def test_survives_void_tags_and_nesting(self):
        """‎<img>‎ و‎<br>‎ مالهمش وسم إغلاق — لو اتحسبوا في العمق، الـartboard

        مايتقفلش وعناصر الأقسام اللي بعده تتحسب غلط.
        """
        html = (
            '<section id="wrap">'
            + ARTBOARD.replace(
                '<div class="t396__elem tn-elem tn-elem__24434337531779543504626"',
                '<div class="deco"><img src="a.png"><br></div>'
                '<div class="t396__elem tn-elem tn-elem__24434337531779543504626"',
            )
            + '<p>بره الـartboard</p>'
            + ARTBOARD.replace("2443433753", "9999999999")
            + '</section>'
        )
        parser = tildacss._ZeroBlockParser()
        parser.feed(html)
        parser.close()
        self.assertEqual(len(parser.artboards), 2)
        self.assertEqual(len(parser.artboards[0]["elems"]), 3)
        self.assertEqual(len(parser.artboards[1]["elems"]), 3)

    def test_elements_inside_groups_are_left_to_runtime(self):
        """مواضع عناصر الـgroup نسبية لأبوها — حساب مختلف مش منقول هنا."""
        grouped = ARTBOARD.replace(
            '<div class="t396__elem tn-elem tn-elem__24434337531771277026942000001"',
            '<div class="tn-group" data-group-type="physical">'
            '<div class="t396__elem tn-elem tn-elem__24434337531771277026942000001"',
        ).replace("</div></div>", "</div></div></div>", 1)
        css = tildacss.zero_block_css("imp-5", grouped)
        self.assertNotIn("tn-elem__24434337531771277026942000001", css)
        self.assertIn("tn-elem__24434337531771277551711000001", css)


class SharedBlockCssTests(SimpleTestCase):
    """تجميع الستايل المكرر بين الأقسام المستوردة في نسخة واحدة."""

    CSS = "body{margin:0}.t-title{color:red}"

    def test_repeated_stylesheet_is_emitted_once(self):
        blocks = [
            {"id": "imp-1", "props": {"css": self.CSS}},
            {"id": "imp-2", "props": {"css": self.CSS}},
            {"id": "imp-3", "props": {"css": self.CSS}},
        ]
        css, ids = shared_block_css(blocks)
        self.assertEqual(ids, {"imp-1", "imp-2", "imp-3"})
        self.assertEqual(css.count("color:red"), 1)

    def test_scope_keeps_id_level_specificity(self):
        """‎:is()‎ بتاخد أولوية أقوى وسيط جوّاها.

        لو حصرنا بكلاس بدل مُعرِّف، قواعد كانت بتكسب قبل كده هتخسر
        فجأة قدام قواعد ‎invite.css‎ اللي أولويتها أعلى.
        """
        blocks = [
            {"id": "imp-1", "props": {"css": self.CSS}},
            {"id": "imp-2", "props": {"css": self.CSS}},
        ]
        css, _ = shared_block_css(blocks)
        self.assertIn(":is(#imp-1,#imp-2)", css)
        # body اتحوّلت لنطاق القسم نفسه، مش سيليكتور جوّاه
        self.assertIn(":is(#imp-1,#imp-2){margin:0}", css)

    def test_single_block_keeps_its_own_style(self):
        css, ids = shared_block_css([{"id": "imp-1", "props": {"css": self.CSS}}])
        self.assertEqual(css, "")
        self.assertEqual(ids, set())

    def test_unsafe_block_id_never_reaches_the_selector(self):
        blocks = [
            {"id": 'imp-1" onload="x', "props": {"css": self.CSS}},
            {"id": "imp-2", "props": {"css": self.CSS}},
        ]
        css, ids = shared_block_css(blocks)
        self.assertEqual(css, "")
        self.assertEqual(ids, set())

    def test_different_stylesheets_are_not_merged(self):
        blocks = [
            {"id": "imp-1", "props": {"css": self.CSS}},
            {"id": "imp-2", "props": {"css": self.CSS}},
            {"id": "imp-3", "props": {"css": ".other{color:blue}"}},
        ]
        css, ids = shared_block_css(blocks)
        self.assertNotIn("color:blue", css)
        self.assertEqual(ids, {"imp-1", "imp-2"})


class MapFrameAlignmentTests(SimpleTestCase):
    """توسيط خريطة Google جوّه الإطار الزخرفي بتاعها."""

    FRAME = (
        '<div class="t396__elem tn-elem" data-elem-type="image" '
        'data-field-left-value="430" data-field-top-value="2" '
        'data-field-width-value="341" data-field-height-value="341" '
        'data-field-left-res-320-value="-10" '
        'data-field-left-res-480-value="70">'
    )
    MAP = (
        '<div class="t396__elem tn-elem" data-elem-type="html" '
        'data-lb-map-width="275" data-lb-map-height="278" '
        'data-field-left-value="430" data-field-top-value="2" '
        'data-field-width-value="275" data-field-height-value="278" '
        'data-field-width-res-320-value="275" '
        'data-field-height-res-320-value="278" '
        'data-field-left-res-320-value="-10">'
    )

    def test_map_is_centred_not_pinned_to_the_corner(self):
        """الخريطة أصغر من الإطار، فالفرق لازم يتقسم على الجهتين.

        قبل كده الكود كان بينسخ ‎left/top‎ بتوع الإطار زي ما هي، فالخريطة
        كانت بتتلزق في الركن وتسيب ٦٦ بكسل فاضيين على جنب واحد.
        """
        out = templateimport._center_map_in_frame(self.MAP, self.FRAME)
        # (341 - 275) / 2 = 33   و  (341 - 278) / 2 = 31.5
        self.assertEqual(templateimport._tag_attr(out, "data-field-left-value"), "463")
        self.assertEqual(templateimport._tag_attr(out, "data-field-top-value"), "33.5")

    def test_centring_applies_to_every_breakpoint(self):
        out = templateimport._center_map_in_frame(self.MAP, self.FRAME)
        # -10 + 33 = 23
        self.assertEqual(
            templateimport._tag_attr(out, "data-field-left-res-320-value"), "23")

    def test_same_size_map_keeps_the_frame_position(self):
        """خريطة بمقاس الإطار مالهاش إزاحة — التوسيط مايحركهاش."""
        same = self.MAP.replace(
            'data-field-width-value="275"', 'data-field-width-value="341"'
        ).replace('data-field-height-value="278"', 'data-field-height-value="341"')
        out = templateimport._center_map_in_frame(same, self.FRAME)
        self.assertEqual(templateimport._tag_attr(out, "data-field-left-value"), "430")
        self.assertEqual(templateimport._tag_attr(out, "data-field-top-value"), "2")

    def test_field_lookup_falls_back_to_a_larger_screen(self):
        tag = ('<div data-field-left-value="430" '
               'data-field-left-res-960-value="310">')
        self.assertEqual(templateimport._field_at(tag, "left", 640), "310")
        self.assertEqual(templateimport._field_at(tag, "left", None), "430")


class LayoutOffsetUnitTests(SimpleTestCase):
    """وحدة إزاحة العناصر: بكسل للمستورد، نسبة للأقسام العادية."""

    def test_imported_element_offset_is_in_pixels(self):
        """‎cqw‎ بتتحسب من عرض المسرح، والمسرح في المحرر إطار جهاز وفي

        المعاينة عرض الشاشة — فنفس الرقم كان بيطلع إزاحة مختلفة في
        الاتنين. عناصر Tilda مواضعها بالبكسل أصلاً.
        """
        css = layout_css([
            {"id": "imp-5", "layout": {"el-9": {"dx": 4.71, "dy": 3.64}}},
        ])
        self.assertIn('--dx:4.71px;--dy:3.64px', css)
        self.assertNotIn("cqw", css)

    def test_regular_slot_stays_relative(self):
        css = layout_css([
            {"id": "blk-2", "layout": {"title": {"dx": 4.71, "dy": 3.64}}},
        ])
        self.assertIn('--dx:4.71cqw;--dy:3.64cqw', css)

    def test_unsafe_ids_are_dropped(self):
        css = layout_css([
            {"id": 'x" onload="', "layout": {"el-1": {"dx": 5, "dy": 0}}},
        ])
        self.assertEqual(css, "")
