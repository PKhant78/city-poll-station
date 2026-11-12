"""Environment settings shared by the app and explicit database bootstrap."""
import os
import re
from sqlalchemy.engine import make_url

DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5180,http://127.0.0.1:5180,http://localhost:8000,http://127.0.0.1:8000'


def cookie_secure():
    cloud = on_vercel() and os.getenv('VERCEL_ENV') != 'development'
    return os.getenv('COOKIE_SECURE', 'true' if cloud else 'false').lower() == 'true'


def allowed_origins():
    origins = {origin.strip() for origin in os.getenv('ALLOWED_ORIGINS', DEFAULT_ALLOWED_ORIGINS).split(',') if origin.strip()}
    # vercel dev injects a loopback host:port, not a cloud DNS hostname.
    # Its HTTP origin is configured explicitly through ALLOWED_ORIGINS.
    if on_vercel() and os.getenv('VERCEL_ENV') != 'development':
        for name in ('VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL'):
            host = os.getenv(name)
            if host:
                # These trusted system variables contain DNS hosts, never URLs.
                labels = host.split('.')
                if len(host) > 253 or any(not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in labels):
                    raise ValueError(f'{name} must contain only a DNS hostname.')
                origins.add(f'https://{host.lower()}')
    return origins


def on_vercel():
    return os.getenv('VERCEL') == '1'


def normalize_database_url(value):
    url = make_url(value)
    if url.drivername in {'postgres', 'postgresql'}:
        url = url.set(drivername='postgresql+psycopg')
    return url


def resolve_database_url(explicit=None, *, required=False):
    # Explicit URLs support isolated SQLite tests, including serverless tests.
    from database import DEFAULT_DATABASE_URL
    value = explicit if explicit is not None else os.getenv('DATABASE_URL')
    if not value:
        if required or on_vercel():
            raise ValueError('DATABASE_URL is required.')
        value = DEFAULT_DATABASE_URL
    url = normalize_database_url(value)
    if on_vercel() and explicit is None and url.get_backend_name() != 'postgresql':
        raise ValueError('DATABASE_URL must use PostgreSQL on Vercel.')
    return url
