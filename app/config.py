"""Settings, read only from environment variables. Nothing secret lives in the repo."""
import hashlib
import os
import sys


def _env(name, default=""):
    return os.environ.get(name, default).strip()


class Settings:
    def __init__(self):
        url = _env("CANVAS_BASE_URL").rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            url = "https://" + url
        if url.endswith("/api/v1"):
            url = url[: -len("/api/v1")]
        self.canvas_url = url
        self.token = _env("CANVAS_TOKEN")
        self.password = os.environ.get("APP_PASSWORD", "")
        self.allow_no_password = _env("ALLOW_NO_PASSWORD") == "1"
        self.totp_secret = _env("TOTP_SECRET")
        # Stable across restarts without extra config; changing the password, token or TOTP secret signs everyone out.
        self.secret = (
            _env("SESSION_SECRET")
            or hashlib.sha256(f"easel|{self.password}|{self.token}|{self.totp_secret}".encode()).hexdigest()
        ).encode()
        self.session_days = int(_env("SESSION_DAYS", "30") or 30)
        self.cache_ttl = float(_env("CACHE_TTL", "30") or 30)
        self.cookie_secure = _env("COOKIE_SECURE", "auto").lower()  # auto | true | false

    def check(self):
        problems = []
        if not self.canvas_url:
            problems.append("CANVAS_BASE_URL is not set (e.g. https://yourschool.instructure.com)")
        if not self.token:
            problems.append("CANVAS_TOKEN is not set")
        if not self.password and not self.allow_no_password:
            problems.append("APP_PASSWORD is not set (set ALLOW_NO_PASSWORD=1 to run without one, not recommended)")
        if self.totp_secret:
            from .totp import valid_secret
            if not valid_secret(self.totp_secret):
                problems.append("TOTP_SECRET is not valid base32 (generate one with: python -m app.totp)")
        if self.password and len(self.password) < 12:
            print("[easel] warning: APP_PASSWORD is shorter than 12 characters; use a long one if this is public",
                  file=sys.stderr)
        if problems:
            for p in problems:
                print(f"[easel] config error: {p}", file=sys.stderr)
            sys.exit(1)


settings = Settings()
