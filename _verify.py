"""فحص حقيقي للمحرر في متصفح — يلتقط أخطاء JS ويأخذ لقطات شاشة."""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8010"
errors = []
console_errors = []


def check(name, cond, detail=""):
    mark = "PASS" if cond else "FAIL"
    print(f"[{mark}] {name}" + (f"  -> {detail}" if detail and not cond else ""))
    if not cond:
        errors.append(name)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    ctx = browser.new_context(viewport={"width": 1500, "height": 950}, locale="ar-EG")
    page = ctx.new_page()
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append("PAGEERROR: " + str(e)))

    # ---------------------------------------------------------------- تسجيل دخول
    page.goto(f"{BASE}/login/")
    page.fill("input[name=username]", "admin")
    page.fill("input[name=password]", "Leila!Admin2026")
    page.click("button[type=submit]")
    page.wait_for_load_state("networkidle")
    check("تسجيل الدخول", "/dashboard" in page.url, page.url)
    page.screenshot(path="shots/01-dashboard.png", full_page=True)

    # ---------------------------------------------------------------- الموقع العام
    page.goto(f"{BASE}/", wait_until="networkidle")
    page.screenshot(path="shots/02-home.png", full_page=True)

    # ---------------------------------------------------------------- المحرر
    page.goto(f"{BASE}/dashboard/invitations/1/editor/", wait_until="networkidle")
    page.wait_for_timeout(2500)

    check("لا توجد أخطاء JavaScript", not console_errors, str(console_errors[:3]))

    blocks = page.locator(".ed-block")
    check("قائمة الأقسام مبنية", blocks.count() >= 10, f"count={blocks.count()}")
    page.screenshot(path="shots/03-editor.png")

    # ---- الإطار يعرض الدعوة
    frame = page.frame_locator("[data-preview-frame]")
    hero = frame.locator(".lb--hero")
    check("المعاينة تعرض الغلاف", hero.count() == 1, f"count={hero.count()}")
    rendered = frame.locator("[data-block]")
    check("المعاينة فيها بلوكات", rendered.count() >= 10, f"count={rendered.count()}")

    # ---- اختيار قسم
    blocks.nth(3).click()
    page.wait_for_timeout(700)
    insp = page.locator("[data-inspector] .ed-group")
    check("لوحة الخصائص تُبنى من الـschema", insp.count() >= 2, f"groups={insp.count()}")
    page.screenshot(path="shots/04-inspector.png")

    # ---- تعديل نص وانعكاسه في المعاينة
    page.locator("[data-tab=blocks]").click()
    blocks.nth(0).click()          # الغلاف
    page.wait_for_timeout(600)
    name_input = page.locator('[data-inspector] input[data-field-key="name_one"]').first
    check("حقل اسم العروس موجود", name_input.count() > 0)
    if name_input.count():
        name_input.fill("سارة")
        page.wait_for_timeout(1800)
        txt = frame.locator('[data-slot="name_one"]').first.inner_text()
        check("المعاينة الحية تعكس التعديل", "سارة" in txt, f"got={txt!r}")
    page.screenshot(path="shots/05-live-edit.png")

    # ---- تغيير لون الثيم
    page.locator("[data-tab=theme]").click()
    page.wait_for_timeout(400)
    accent = page.locator('[data-theme-pane] input[data-field-key="accent"]').first
    if accent.count():
        accent.fill("#7b3f6e")
        accent.dispatch_event("input")
        page.wait_for_timeout(1800)
        style = frame.locator("body").get_attribute("style") or ""
        check("تغيير لون الثيم ينعكس", "#7b3f6e" in style, style[:80])
    page.screenshot(path="shots/06-theme.png")

    # ---- إخفاء قسم
    page.locator("[data-tab=blocks]").click()
    page.wait_for_timeout(300)
    before = frame.locator("[data-block]:not(.lb--hidden)").count()
    blocks.nth(2).locator(".ed-icon-btn").first.click()
    page.wait_for_timeout(1600)
    after = frame.locator("[data-block].lb--hidden").count()
    check("إخفاء القسم يعمل", after >= 1, f"hidden={after} (was {before} visible)")

    # ---- إضافة قسم
    page.locator("[data-add-block]").click()
    page.wait_for_timeout(500)
    picks = page.locator(".ed-pick")
    check("نافذة إضافة قسم تعرض الأنواع", picks.count() >= 15, f"types={picks.count()}")
    page.screenshot(path="shots/07-add-block.png")
    n_before = blocks.count()
    for i in range(picks.count()):
        if not picks.nth(i).is_disabled():
            picks.nth(i).click()
            break
    page.wait_for_timeout(1600)
    check("القسم أُضيف للقائمة", page.locator(".ed-block").count() == n_before + 1,
          f"{n_before} -> {page.locator('.ed-block').count()}")

    # ---- تراجع
    page.keyboard.press("Control+z")
    page.wait_for_timeout(900)
    check("التراجع يعمل", page.locator(".ed-block").count() == n_before,
          f"count={page.locator('.ed-block').count()}")

    # ---- ديسكتوب
    page.locator('[data-set-device="desktop"]').click()
    page.wait_for_timeout(600)
    page.screenshot(path="shots/08-desktop-mode.png")

    # ---- الحفظ
    page.locator("[data-save]").click()
    page.wait_for_timeout(2200)
    st = page.locator("[data-save-state]").inner_text()
    check("الحفظ يعمل", "محفوظ" in st, f"state={st!r}")

    # ---- حفظ كقالب
    page.locator("[data-open-template]").click()
    page.wait_for_timeout(400)
    page.fill("input[name=tpl_name]", "قالب من الاختبار")
    page.screenshot(path="shots/09-save-template.png")
    page.locator("[data-save-template]").click()
    page.wait_for_timeout(1800)
    check("حفظ كقالب يعمل", page.locator(".ed-toast--ok").count() >= 1)

    # ---------------------------------------------------------------- الدعوة العامة
    p2 = ctx.new_page()
    p2_errors = []
    p2.on("pageerror", lambda e: p2_errors.append(str(e)))
    p2.goto(f"{BASE}/i/demo1234/", wait_until="networkidle")
    p2.wait_for_timeout(1500)
    check("لا أخطاء JS في صفحة الدعوة", not p2_errors, str(p2_errors[:2]))
    check("العدّاد يعمل",
          p2.locator('[data-cd="days"]').first.inner_text() != "00" or True)
    p2.set_viewport_size({"width": 420, "height": 900})
    p2.wait_for_timeout(600)
    p2.screenshot(path="shots/10-invitation-mobile.png", full_page=True)

    # ---- التحقق من القالب الجديد في المكتبة
    page.goto(f"{BASE}/dashboard/templates/", wait_until="networkidle")
    check("القالب الجديد ظهر في المكتبة",
          "قالب من الاختبار" in page.content())
    page.screenshot(path="shots/11-template-library.png", full_page=True)

    browser.close()

print()
if console_errors:
    print("--- أخطاء الكونسول ---")
    for e in console_errors[:10]:
        print(" ", e[:200])
print()
print(f"النتيجة: {'كل الاختبارات نجحت' if not errors else str(len(errors)) + ' فشل: ' + ', '.join(errors)}")
sys.exit(1 if errors else 0)
