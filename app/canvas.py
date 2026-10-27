"""Thin async Canvas REST client: pagination, a short in-memory cache and request de-duplication."""
import asyncio
import re
import time
from urllib.parse import urlencode

import httpx

LINK_RE = re.compile(r'<([^>]+)>;\s*rel="([^"]+)"')


class CanvasError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _error_message(r):
    try:
        j = r.json()
    except ValueError:
        return f"Canvas returned HTTP {r.status_code}"
    if isinstance(j, dict):
        if isinstance(j.get("errors"), list) and j["errors"]:
            e = j["errors"][0]
            return e.get("message", str(e)) if isinstance(e, dict) else str(e)
        if isinstance(j.get("errors"), dict):
            return "; ".join(f"{k}: {v}" for k, v in j["errors"].items())
        if j.get("message"):
            return j["message"]
        if j.get("status"):
            return str(j["status"])
    return f"Canvas returned HTTP {r.status_code}"


class Canvas:
    def __init__(self, base_url, token, ttl=30.0):
        self.base = base_url
        self.api = base_url + "/api/v1/"
        self.ttl = ttl
        self.client = httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            timeout=httpx.Timeout(30.0, connect=10.0),
            limits=httpx.Limits(max_connections=24, max_keepalive_connections=12),
            follow_redirects=False,
        )
        self.sem = asyncio.Semaphore(10)
        self.cache = {}
        self.inflight = {}

    async def close(self):
        await self.client.aclose()

    def _same_host(self, url):
        return url.startswith(self.base + "/")

    async def request(self, method, url, **kw):
        if not url.startswith("http"):
            url = self.api + url
        if not self._same_host(url):
            raise CanvasError(400, "Refusing to send the token to another host")
        if isinstance(kw.get("data"), list):  # repeated keys like file_ids[]; httpx only form-encodes dicts
            kw["content"] = urlencode(kw.pop("data"))
            kw["headers"] = {"Content-Type": "application/x-www-form-urlencoded"}
        async with self.sem:
            try:
                r = await self.client.request(method, url, **kw)
            except httpx.TimeoutException:
                raise CanvasError(504, "Canvas took too long to respond")
            except httpx.HTTPError as e:
                raise CanvasError(502, f"Could not reach Canvas: {e.__class__.__name__}")
        if r.status_code == 401:
            raise CanvasError(502, "Canvas rejected the access token (check CANVAS_TOKEN)")
        if r.status_code >= 400:
            raise CanvasError(r.status_code, _error_message(r))
        return r

    async def get(self, path, params=(), fresh=False, paginate=True, max_pages=50):
        params = list(params)
        key = path + "?" + urlencode(params, doseq=True) + f"#{max_pages}"
        if not fresh:
            hit = self.cache.get(key)
            if hit and hit[0] > time.monotonic():
                return hit[1]
        if key in self.inflight:
            return await asyncio.shield(self.inflight[key])
        task = asyncio.ensure_future(self._fetch(path, params, paginate, max_pages))
        self.inflight[key] = task
        try:
            data = await task
        finally:
            self.inflight.pop(key, None)
        if len(self.cache) > 3000:
            now = time.monotonic()
            self.cache = {k: v for k, v in self.cache.items() if v[0] > now}
        self.cache[key] = (time.monotonic() + self.ttl, data)
        return data

    async def _fetch(self, path, params, paginate, max_pages):
        if paginate and not any(k == "per_page" for k, _ in params):
            params.append(("per_page", "100"))
        r = await self.request("GET", path, params=params)
        data = r.json()
        if not paginate or not isinstance(data, list):
            return data
        pages = 1
        nxt = _next_link(r)
        while nxt and pages < max_pages and self._same_host(nxt):
            r = await self.request("GET", nxt)
            data.extend(r.json())
            pages += 1
            nxt = _next_link(r)
        return data

    async def send(self, method, path, invalidate=True, **kw):
        """Write call. Clears the cache so every device sees the change on its next refresh."""
        r = await self.request(method, path, **kw)
        if invalidate:
            self.cache.clear()
        try:
            return r.json()
        except ValueError:
            return {}

    async def upload_submission_file(self, course, assignment, upload):
        return await self.upload_file(f"courses/{course}/assignments/{assignment}/submissions/self/files", upload)

    async def upload_file(self, announce_path, upload, extra=None):
        """Canvas 3-step upload: announce, upload to the returned URL, confirm. Returns the file id."""
        upload.file.seek(0, 2)
        size = upload.file.tell()
        upload.file.seek(0)
        ctype = upload.content_type or "application/octet-stream"
        r = await self.request(
            "POST",
            announce_path,
            data={"name": upload.filename, "size": str(size), "content_type": ctype, **(extra or {})},
        )
        info = r.json()
        # The upload URL is usually a separate storage host: never send the Canvas token there.
        async with httpx.AsyncClient(timeout=httpx.Timeout(900.0, connect=15.0), follow_redirects=False) as c:
            try:
                r2 = await c.post(
                    info["upload_url"],
                    data=info.get("upload_params") or {},
                    files={"file": (upload.filename, upload.file, ctype)},
                )
            except httpx.HTTPError as e:
                raise CanvasError(502, f"File upload failed: {e.__class__.__name__}")
        if r2.status_code in (301, 302, 303):
            return (await self.request("GET", r2.headers["location"])).json()["id"]
        if r2.status_code >= 400:
            raise CanvasError(502, f"File upload failed: {_error_message(r2)}")
        j = r2.json() if r2.content else {}
        if j.get("id"):
            return j["id"]
        loc = j.get("location") or r2.headers.get("location")
        if loc:
            return (await self.request("GET", loc)).json()["id"]
        raise CanvasError(502, "File upload did not return a file id")


def _next_link(r):
    for url, rel in LINK_RE.findall(r.headers.get("link", "")):
        if rel == "next":
            return url
    return None
