"""Single-user login (password + optional TOTP) with an HMAC-signed session cookie."""
import asyncio
import hashlib
import hmac
import time
from collections import defaultdict, deque

from . import totp
from .config import settings

COOKIE = "easel_session"
WINDOW = 15 * 60
MAX_PER_IP = 8          # failures per IP per window
MAX_GLOBAL = 40         # failures from all IPs per window (stops attacks spread across many IPs)

_failures = defaultdict(deque)
_global = deque()


def _sign(value):
    return hmac.new(settings.secret, value.encode(), hashlib.sha256).hexdigest()


def make_session():
    exp = str(int(time.time()) + settings.session_days * 86400)
    return f"{exp}.{_sign(exp)}"


def valid(cookie):
    if not settings.password and settings.allow_no_password:
        return True
    if not cookie or "." not in cookie:
        return False
    exp, sig = cookie.split(".", 1)
    if not hmac.compare_digest(sig, _sign(exp)):
        return False
    return exp.isdigit() and int(exp) > time.time()


def _trim(q, now):
    while q and q[0] < now - WINDOW:
        q.popleft()


def locked_out(ip):
    now = time.time()
    _trim(_failures[ip], now)
    _trim(_global, now)
    return len(_failures[ip]) >= MAX_PER_IP or len(_global) >= MAX_GLOBAL


async def check(ip, password, code):
    ok = hmac.compare_digest(password.encode(), settings.password.encode())
    if ok and settings.totp_secret:
        ok = totp.verify(settings.totp_secret, code)
    if ok:
        _failures.pop(ip, None)
        return True
    now = time.time()
    _failures[ip].append(now)
    _global.append(now)
    await asyncio.sleep(0.7)  # slow down guessing
    return False
