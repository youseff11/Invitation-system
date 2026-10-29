"""اختبارات واجهة الموقع العام (‎/api/v1/public/‎ و‎/api/v1/orders/‎)."""

import json
from decimal import Decimal

from django.core.cache import cache
from django.test import Client, TestCase

from system.api import public
from system.models import (
    FAQ, Customer, Order, OrderAddon, Plan, PlanAddon, SiteSetting, Template,
)


class PublicApiTestCase(TestCase):
    def setUp(self):
        cache.clear()
        # enforce_csrf_checks: نفس مسار المتصفح — الرمز من ‎/csrf/‎ ثم في الهيدر
        self.client = Client(enforce_csrf_checks=True)

    def csrf_headers(self):
        token = self.client.get("/api/v1/csrf/").json()["csrfToken"]
        return {"HTTP_X_CSRFTOKEN": token}

    def post_order(self, data, **extra):
        return self.client.post("/api/v1/orders/", data=json.dumps(data),
                                content_type="application/json",
                                **self.csrf_headers(), **extra)


class HomeApiTests(PublicApiTestCase):
    def test_home_payload_shape(self):
        Template.objects.create(name="ذهبي", name_en="Golden", category="wedding")
        plan = Plan.objects.create(name="الأساسية", name_en="Essential", slug="basic",
                                   price=Decimal("750.00"), bullets=["أ", "ب"],
                                   bullets_en=["a", "b"])
        FAQ.objects.create(question_ar="س؟", answer_ar="ج", question_en="q?", answer_en="a")

        data = self.client.get("/api/v1/public/home/").json()

        self.assertEqual(set(data), {"site", "templates", "plans", "faqs"})
        self.assertIn("ordersEnabled", data["site"])
        card = data["templates"][0]
        self.assertEqual((card["name"], card["nameEn"]), ("ذهبي", "Golden"))
        self.assertEqual(card["categoryLabel"], "زفاف")
        self.assertNotIn("document", card)
        self.assertEqual(data["plans"][0]["id"], plan.pk)
        self.assertEqual(data["plans"][0]["price"], 750)
        self.assertEqual(data["plans"][0]["bulletsEn"], ["a", "b"])
        self.assertEqual(data["faqs"][0]["questionEn"], "q?")

    def test_home_templates_active_only_and_capped_at_twelve(self):
        for i in range(14):
            Template.objects.create(name=f"قالب {i}")
        Template.objects.create(name="مخفي", is_active=False)
        names = [t["name"] for t in self.client.get("/api/v1/public/home/").json()["templates"]]
        self.assertEqual(len(names), public.HOME_TEMPLATES)
        self.assertNotIn("مخفي", names)

    def test_home_hides_inactive_plans_and_faqs(self):
        Plan.objects.create(name="مخفية", slug="hidden", is_active=False)
        FAQ.objects.create(question_ar="مخفي", answer_ar="x", is_active=False)
        data = self.client.get("/api/v1/public/home/").json()
        self.assertEqual(data["plans"], [])
        self.assertEqual(data["faqs"], [])

    def test_plan_prices_are_whole_numbers_rounded_half_up(self):
        Plan.objects.create(name="أ", slug="a", price=Decimal("99.50"))
        Plan.objects.create(name="ب", slug="b", price=Decimal("750.40"), sort_order=1)
        prices = [p["price"] for p in self.client.get("/api/v1/public/home/").json()["plans"]]
        self.assertEqual(prices, [100, 750])

    def test_addons_follow_plan_links(self):
        basic = Plan.objects.create(name="الأساسية", slug="basic", sort_order=0)
        royal = Plan.objects.create(name="الملكية", slug="royal", sort_order=1)
        everyone = PlanAddon.objects.create(name="للكل", price=100)
        only_royal = PlanAddon.objects.create(name="للملكية", name_en="Royal only", price=Decimal("200.50"))
        only_royal.plans.add(royal)
        PlanAddon.objects.create(name="معطّلة", price=5, is_active=False)

        plans = {p["slug"]: p for p in self.client.get("/api/v1/public/home/").json()["plans"]}

        self.assertEqual([a["name"] for a in plans["basic"]["addons"]], ["للكل"])
        self.assertEqual([a["name"] for a in plans["royal"]["addons"]], ["للكل", "للملكية"])
        self.assertEqual(plans["royal"]["addons"][1]["nameEn"], "Royal only")
        self.assertEqual(plans["royal"]["addons"][1]["price"], 201)
        self.assertEqual(everyone.pk, plans["basic"]["addons"][0]["id"])
        self.assertEqual(basic.pk, plans["basic"]["id"])

    def test_home_is_public(self):
        self.assertEqual(self.client.get("/api/v1/public/home/").status_code, 200)

    def test_home_wrong_method(self):
        response = self.client.post("/api/v1/public/home/", **self.csrf_headers())
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "GET")


class GalleryApiTests(PublicApiTestCase):
    def test_filters_by_category_and_lists_categories(self):
        Template.objects.create(name="زفاف", category="wedding", collection="Premium")
        Template.objects.create(name="ميلاد", category="birthday")
        Template.objects.create(name="مخفي", category="birthday", is_active=False)

        everything = self.client.get("/api/v1/public/templates/").json()
        self.assertEqual({t["name"] for t in everything["results"]}, {"زفاف", "ميلاد"})
        self.assertEqual(everything["category"], "")
        values = [c["value"] for c in everything["categories"]]
        self.assertNotIn("none", values)
        self.assertIn("wedding", values)
        self.assertEqual({c["label"] for c in everything["categories"]
                          if c["value"] == "wedding"}, {"زفاف"})

        only = self.client.get("/api/v1/public/templates/?category=birthday").json()
        self.assertEqual([t["name"] for t in only["results"]], ["ميلاد"])
        self.assertEqual(only["category"], "birthday")
        self.assertEqual(only["results"][0]["categoryLabel"], "عيد ميلاد")

    def test_unknown_category_is_an_empty_list(self):
        Template.objects.create(name="زفاف", category="wedding")
        data = self.client.get("/api/v1/public/templates/?category=nope").json()
        self.assertEqual(data["results"], [])

    def test_cards_do_not_leak_heavy_fields(self):
        Template.objects.create(name="قالب")
        card = self.client.get("/api/v1/public/templates/").json()["results"][0]
        for key in ("document", "preview_render", "runtime_scripts"):
            self.assertNotIn(key, card)

    def test_base_templates_endpoint_is_untouched(self):
        Template.objects.create(name="قالب")
        card = self.client.get("/api/v1/templates/").json()["results"][0]
        self.assertNotIn("categoryLabel", card)


class OrderFormOptionsTests(PublicApiTestCase):
    def test_options_when_orders_enabled(self):
        plan = Plan.objects.create(name="الأساسية", slug="basic", price=750)
        tpl = Template.objects.create(name="قالب", name_en="Tpl")
        Template.objects.create(name="مخفي", is_active=False)
        addon = PlanAddon.objects.create(name="موسيقى", price=200, description="أغنية")
        addon.plans.add(plan)

        data = self.client.get("/api/v1/public/order-form/").json()

        self.assertEqual([t["id"] for t in data["templates"]], [tpl.pk])
        self.assertEqual(data["plans"][0]["id"], plan.pk)
        self.assertEqual(data["addons"][0]["planIds"], [plan.pk])
        self.assertEqual(data["addons"][0]["description"], "أغنية")
        self.assertEqual(data["defaultEventType"], "زفاف")

    def test_options_closed_when_orders_disabled(self):
        SiteSetting.objects.update_or_create(pk=1, defaults={"orders_enabled": False})
        response = self.client.get("/api/v1/public/order-form/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "orders_disabled")


class OrderCreateTests(PublicApiTestCase):
    def setUp(self):
        super().setUp()
        self.plan = Plan.objects.create(name="الأساسية", slug="basic", price=750)
        self.royal = Plan.objects.create(name="الملكية", slug="royal", price=2600)
        self.template = Template.objects.create(name="قالب")
        self.addon = PlanAddon.objects.create(name="موسيقى", price=200)
        self.payload = {
            "customerName": "أحمد علي", "customerPhone": "01012345678",
            "customerEmail": "a@example.com", "plan": self.plan.pk,
            "template": self.template.pk, "eventType": "زفاف",
            "eventDate": "2027-07-07", "names": "أحمد وسارة", "message": "ملاحظة",
            "addons": [self.addon.pk],
        }

    def test_creates_order_customer_and_snapshots_addon_price(self):
        response = self.post_order(self.payload)

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertTrue(body["received"])
        self.assertTrue(body["message"])
        order = Order.objects.get()
        self.assertEqual(order.customer.name, "أحمد علي")
        self.assertEqual(order.customer.phone, "01012345678")
        self.assertEqual(order.plan, self.plan)
        self.assertEqual(order.template, self.template)
        self.assertEqual(str(order.event_date), "2027-07-07")
        self.assertEqual(order.status, "new")
        oa = OrderAddon.objects.get(order=order)
        self.assertEqual((oa.name, oa.price), ("موسيقى", Decimal("200")))

    def test_reuses_customer_with_same_phone(self):
        existing = Customer.objects.create(name="قديم", phone="01012345678")
        self.post_order(self.payload)
        self.post_order(self.payload)
        self.assertEqual(Customer.objects.count(), 1)
        self.assertEqual(Order.objects.filter(customer=existing).count(), 2)

    def test_template_addons_and_email_are_optional(self):
        for key in ("template", "customerEmail", "addons", "eventDate", "names", "message"):
            self.payload.pop(key)
        self.assertEqual(self.post_order(self.payload).status_code, 201)
        self.assertIsNone(Order.objects.get().template)

    def test_missing_required_fields_report_per_field_errors(self):
        response = self.post_order({})
        self.assertEqual(response.status_code, 400)
        error = response.json()["error"]
        self.assertEqual(error["code"], "invalid_order")
        self.assertEqual(error["message"], "يرجى مراجعة البيانات المدخلة.")
        self.assertEqual(set(error["fields"]),
                         {"customerName", "customerPhone", "plan", "eventType"})
        self.assertEqual(Order.objects.count(), 0)

    def test_invalid_values_are_rejected(self):
        self.payload.update(customerEmail="not-an-email", eventDate="غلط", plan=9999,
                            template=9999)
        error = self.post_order(self.payload).json()["error"]
        self.assertEqual(set(error["fields"]),
                         {"customerEmail", "eventDate", "plan", "template"})
        self.assertEqual(Order.objects.count(), 0)

    def test_inactive_plan_template_and_addon_are_rejected(self):
        Plan.objects.filter(pk=self.plan.pk).update(is_active=False)
        Template.objects.filter(pk=self.template.pk).update(is_active=False)
        PlanAddon.objects.filter(pk=self.addon.pk).update(is_active=False)
        error = self.post_order(self.payload).json()["error"]
        self.assertEqual(set(error["fields"]), {"plan", "template", "addons"})

    def test_addon_linked_to_another_plan_is_rejected(self):
        self.addon.plans.add(self.royal)
        response = self.post_order(self.payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("addons", response.json()["error"]["fields"])
        self.assertEqual(Order.objects.count(), 0)

    def test_addon_linked_to_the_chosen_plan_is_accepted(self):
        self.addon.plans.add(self.plan)
        self.assertEqual(self.post_order(self.payload).status_code, 201)

    def test_overlong_values_are_rejected(self):
        self.payload["customerName"] = "ا" * 121
        error = self.post_order(self.payload).json()["error"]
        self.assertIn("customerName", error["fields"])

    def test_rejects_non_scalar_values(self):
        self.payload["names"] = {"x": 1}
        error = self.post_order(self.payload).json()["error"]
        self.assertEqual(list(error["fields"]), ["names"])

    def test_rejects_non_list_addons(self):
        self.payload["addons"] = "1"
        error = self.post_order(self.payload).json()["error"]
        self.assertEqual(list(error["fields"]), ["addons"])

    def test_closed_when_orders_disabled(self):
        SiteSetting.objects.update_or_create(pk=1, defaults={"orders_enabled": False})
        response = self.post_order(self.payload)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "orders_disabled")
        self.assertEqual(Order.objects.count(), 0)

    def test_closed_orders_beat_validation(self):
        SiteSetting.objects.update_or_create(pk=1, defaults={"orders_enabled": False})
        self.assertEqual(self.post_order({}).status_code, 403)

    def test_requires_csrf(self):
        response = self.client.post("/api/v1/orders/", data=json.dumps(self.payload),
                                    content_type="application/json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Order.objects.count(), 0)

    def test_invalid_json(self):
        response = self.client.post("/api/v1/orders/", data="not json",
                                    content_type="application/json",
                                    **self.csrf_headers())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "invalid_json")

    def test_get_not_allowed(self):
        response = self.client.get("/api/v1/orders/")
        self.assertEqual(response.status_code, 405)
        self.assertEqual(response["Allow"], "POST")

    def test_rate_limited_after_many_orders(self):
        for _ in range(public.ORDER_RATE_LIMIT):
            self.assertEqual(self.post_order(self.payload).status_code, 201)
        blocked = self.post_order(self.payload)
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.json()["error"]["code"], "too_many_orders")
        self.assertEqual(Order.objects.count(), public.ORDER_RATE_LIMIT)

    def test_failed_attempts_do_not_use_up_the_limit(self):
        for _ in range(public.ORDER_RATE_LIMIT + 2):
            self.assertEqual(self.post_order({}).status_code, 400)
        self.assertEqual(self.post_order(self.payload).status_code, 201)
