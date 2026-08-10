from pathlib import Path

from corsheaders.defaults import default_headers

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = 'django-insecure-cases-dev-only-change-in-production'
DEBUG = True
ALLOWED_HOSTS = ['*']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'cases',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

CORS_ALLOWED_ORIGINS = [
    'http://localhost:5178',
    'http://127.0.0.1:5178',
]
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_HEADERS = (*default_headers, 'x-player-id')
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.AllowAny'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
    'DEFAULT_PARSER_CLASSES': ['rest_framework.parsers.JSONParser'],
}

CASES_STARTING_BALANCE = '10000.00'
CASES_MIN_BET = '1.00'
CASES_MAX_BET = '100000.00'
CASES_REEL_LENGTH = 80
CASES_WIN_INDEX_MIN = 48
CASES_WIN_INDEX_MAX = 68

# Chest colors: cyan (common), slate (low), blue, red (high), gold (jackpot)
CASES_POOL = [
    {'multiplier': '0.02', 'weight': 40, 'tone': 'slate'},
    {'multiplier': '0.20', 'weight': 28, 'tone': 'slate'},
    {'multiplier': '0.50', 'weight': 22, 'tone': 'cyan'},
    {'multiplier': '1.00', 'weight': 20, 'tone': 'cyan'},
    {'multiplier': '1.40', 'weight': 16, 'tone': 'cyan'},
    {'multiplier': '1.80', 'weight': 12, 'tone': 'blue'},
    {'multiplier': '2.20', 'weight': 10, 'tone': 'blue'},
    {'multiplier': '2.80', 'weight': 8, 'tone': 'blue'},
    {'multiplier': '3.50', 'weight': 6, 'tone': 'red'},
    {'multiplier': '5.00', 'weight': 4, 'tone': 'red'},
    {'multiplier': '10.00', 'weight': 2, 'tone': 'red'},
    {'multiplier': '20.00', 'weight': 1, 'tone': 'gold'},
]


CORS_ALLOW_ALL_ORIGINS = True
