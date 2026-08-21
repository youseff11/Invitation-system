"""إعدادات مشروع "فرحة" — منصة الدعوات الرقمية.

كل القيم الحساسة تُقرأ من متغيرات البيئة، مع قيم افتراضية آمنة للتطوير المحلي فقط.
القيم بتتقرا من ملف .env جنب manage.py لو موجود، وإلا من متغيرات النظام.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """يقرأ ملف .env بسطور KEY=VALUE — من غير أي مكتبة خارجية.

    متغيّرات النظام لها الأولوية دايماً، فالاستضافة تقدر تتجاوز الملف.
    """
    if not path.is_file():
        return
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except OSError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv(BASE_DIR / ".env")


def env(key, default=None):
    return os.environ.get(key, default)


def env_bool(key, default=False):
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(key, default=""):
    raw = os.environ.get(key, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


# ---------------------------------------------------------------- core
DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = env(
    "DJANGO_SECRET_KEY",
    default="dev-only-insecure-key-do-not-use-in-production" if DEBUG else None
)

if not SECRET_KEY:
    raise RuntimeError(
        "DJANGO_SECRET_KEY غير محدد. عيّن المتغير قبل التشغيل في وضع الإنتاج."
    )

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")
if DEBUG and "testserver" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append("testserver")
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS", 
    "http://localhost,https://localhost,http://127.0.0.1,http://*"
)

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.humanize",
    "system",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    # العربية هي الافتراضي حتى لو المتصفح إنجليزي — لازم تسبق LocaleMiddleware
    "system.middleware.DefaultLanguageMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# whitenoise اختياري — لو غير مثبت نُسقطه بهدوء بدل تعطّل المشروع.
try:  # pragma: no cover - يعتمد على البيئة
    import whitenoise  # noqa: F401
except ImportError:  # pragma: no cover
    MIDDLEWARE.remove("whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "Core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.template.context_processors.i18n",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "system.context_processors.site_settings",
            ],
        },
    }
]

WSGI_APPLICATION = "Core.wsgi.application"
ASGI_APPLICATION = "Core.asgi.application"

# ---------------------------------------------------------------- database
# SQLite افتراضياً — مفيش خدمة خارجية ولا متغيّرات لازمة للتشغيل.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        "OPTIONS": {
            # يقلّل قفل القاعدة لما أكتر من طلب يكتبوا في نفس الوقت
            "timeout": 20,
            "transaction_mode": "IMMEDIATE",
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

# لما تقرر تربطه بقاعدة خارجية، حط DATABASE_URL في البيئة وشيل التعليق:
#   Postgres →  postgres://user:pass@host:5432/dbname
#   MySQL    →  mysql://user:pass@host/dbname     (PythonAnywhere)
# DATABASE_URL = env("DATABASE_URL", "")
# if DATABASE_URL:
#     from urllib.parse import unquote, urlparse
#     parsed = urlparse(DATABASE_URL)
#     scheme = (parsed.scheme or "").split("+")[0].lower()
#     if scheme in {"mysql", "mariadb"}:
#         engine = "django.db.backends.mysql"
#         options = {"charset": "utf8mb4",
#                    "init_command": "SET sql_mode='STRICT_TRANS_TABLES'"}
#     else:
#         engine = "django.db.backends.postgresql"
#         options = {"sslmode": env("DJANGO_DB_SSLMODE", "require")}
#     DATABASES = {"default": {
#         "ENGINE": engine,
#         "NAME": parsed.path.lstrip("/"),
#         "USER": unquote(parsed.username or ""),
#         "PASSWORD": unquote(parsed.password or ""),
#         "HOST": parsed.hostname or "",
#         "PORT": str(parsed.port or ""),
#         "CONN_MAX_AGE": 600,
#         "OPTIONS": options,
#     }}

# ---------------------------------------------------------------- auth
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "dashboard"
LOGOUT_REDIRECT_URL = "home"

# ---------------------------------------------------------------- i18n
LANGUAGE_CODE = "ar"
LANGUAGES = [("ar", "العربية"), ("en", "English")]
LOCALE_PATHS = [BASE_DIR / "locale"]
TIME_ZONE = "Africa/Cairo"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------- static / media
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]

MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("DJANGO_MEDIA_ROOT", str(BASE_DIR / "media")))

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": (
            "whitenoise.storage.CompressedManifestStaticFilesStorage"
            if "whitenoise.middleware.WhiteNoiseMiddleware" in MIDDLEWARE and not DEBUG
            else "django.contrib.staticfiles.storage.StaticFilesStorage"
        )
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---------------------------------------------------------------- security
# قيم صارمة افتراضياً، وتُخفَّف تلقائياً في وضع التطوير فقط.
X_FRAME_OPTIONS = "SAMEORIGIN"  # المحرر يعرض المعاينة داخل iframe من نفس الأصل
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 12
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024      # 10MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 4000                 # المحرر يرسل حقولاً كثيرة

if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ---------------------------------------------------------------- caching
# يُستخدم لتحديد معدّل إرسال RSVP ومنع إغراق النموذج.
CACHES = {
    "default": {
        "BACKEND": env(
            "DJANGO_CACHE_BACKEND",
            "django.core.cache.backends.locmem.LocMemCache",
        ),
        "LOCATION": env("DJANGO_CACHE_LOCATION", "leila-default"),
    }
}

# ---------------------------------------------------------------- app settings
SITE_NAME = env("SITE_NAME", "فرحة")
SITE_TAGLINE = env("SITE_TAGLINE", "دعوات رقمية تعكس قصة حبك")
SITE_NAME_EN = env("SITE_NAME_EN", "FARHA")
SITE_TAGLINE_EN = env("SITE_TAGLINE_EN", "Digital invitations that tell your love story")
SITE_WHATSAPP = env("SITE_WHATSAPP", "")
SITE_EMAIL = env("SITE_EMAIL", "")
SITE_CURRENCY = env("SITE_CURRENCY", "ج.م")

# حدود استيراد القوالب — حماية من ZIP bomb.
TEMPLATE_IMPORT_MAX_ZIP_SIZE = 20 * 1024 * 1024        # 20MB للأرشيف نفسه
TEMPLATE_IMPORT_MAX_UNCOMPRESSED = 80 * 1024 * 1024    # 80MB بعد الفك
TEMPLATE_IMPORT_MAX_FILES = 300
TEMPLATE_IMPORT_ALLOWED_ASSETS = {
    ".html", ".htm", ".css", ".js", ".json",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif",
    ".woff", ".woff2", ".ttf", ".otf",
    ".mp3", ".m4a", ".ogg", ".mp4", ".webm",
}

RSVP_RATE_LIMIT_PER_HOUR = int(env("RSVP_RATE_LIMIT_PER_HOUR", "12"))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL", "INFO")},
}
