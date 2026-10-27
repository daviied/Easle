"""RFC 6238 TOTP (authenticator-app codes), standard library only.

Generate a secret for TOTP_SECRET:

    python -m app.totp
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def _key(secret):
    s = secret.replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def code(secret, at=None, step=30, digits=6):
    counter = int((time.time() if at is None else at) // step)
    h = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    n = (struct.unpack(">I", h[o:o + 4])[0] & 0x7FFFFFFF) % 10 ** digits
    return str(n).zfill(digits)


_used = {}


def verify(secret, submitted, window=1):
    """Accept the current code or one step either side; each code works only once."""
    submitted = "".join(ch for ch in submitted if ch.isdigit())
    if len(submitted) != 6:
        return False
    now = time.time()
    for k in list(_used):
        if _used[k] < now - 120:
            del _used[k]
    for d in range(-window, window + 1):
        t = now + d * 30
        if hmac.compare_digest(code(secret, t), submitted):
            slot = int(t // 30)
            if slot in _used:
                return False
            _used[slot] = now
            return True
    return False


def valid_secret(secret):
    try:
        return len(_key(secret)) >= 10
    except (ValueError, base64.binascii.Error):
        return False


if __name__ == "__main__":
    s = base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")
    print(f"TOTP_SECRET={s}")
    print()
    print("Add it to your authenticator app by entering the secret above, or turn this URI into a QR code:")
    print(f"otpauth://totp/{quote('Easel')}?secret={s}&issuer=Easel")
