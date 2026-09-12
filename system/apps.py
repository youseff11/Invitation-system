from django.apps import AppConfig


class SystemConfig(AppConfig):
    name = 'system'

    def ready(self):
        # ربط إشارات فهرس الوسائط. الاستيراد هنا مش فوق عشان الموديلات
        # تكون اتحمّلت خلاص وقت التنفيذ.
        from . import signals  # noqa: F401
