"""Easel: a fast personal Canvas client. The server keeps the Canvas token; the browser never sees it."""
import asyncio
import html
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

from fastapi import Body, FastAPI, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask

from . import auth
from .canvas import Canvas, CanvasError
from .config import settings

STATIC = Path(__file__).parent / "static"
PATH_RE = re.compile(r"[\w\-./~@+:,()!']+")
PLANNABLE_TYPES = {
    "assignment", "quiz", "discussion_topic", "wiki_page", "planner_note",
    "calendar_event", "announcement", "assessment_request", "sub_assignment",
}
INLINE_TYPES = ("image/", "video/", "audio/", "text/plain", "application/pdf")

canvas: Canvas = None


@asynccontextmanager
async def lifespan(_app):
    global canvas
    settings.check()
    canvas = Canvas(settings.canvas_url, settings.token, settings.cache_ttl)
    yield
    await canvas.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

CSP = (
    "default-src 'self'; img-src * data: blob:; media-src *; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; "
    "base-uri 'none'; form-action 'self'"
)


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/"):
        if not auth.valid(request.cookies.get(auth.COOKIE)):
            return JSONResponse({"error": "Not signed in"}, 401)
        # Custom header can't be sent cross-site without CORS, so this blocks CSRF on writes.
        if request.method not in ("GET", "HEAD") and request.headers.get("x-easel") != "1":
            return JSONResponse({"error": "Missing X-Easel header"}, 403)
    resp = await call_next(request)
    resp.headers.setdefault("Content-Security-Policy", CSP)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["X-Frame-Options"] = "DENY"
    if request.url.scheme == "https":
        resp.headers["Strict-Transport-Security"] = "max-age=31536000"
    if not path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-cache")
    return resp


@app.exception_handler(CanvasError)
async def canvas_error(_request, exc: CanvasError):
    return JSONResponse({"error": exc.message}, exc.status)


def fresh(request: Request):
    return request.headers.get("x-fresh") == "1"


# ---------- login ----------

LOGIN_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Easel · Sign in</title>
<meta name="theme-color" content="#4f46e5"><link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"></head>
<body class="login-body"><form class="login-card" method="post" action="/login">
<img src="/icons/icon.svg" alt="" width="56" height="56"><h1>Easel</h1>
<p class="muted">Your Canvas, faster.</p>{error}
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
{code}<input type="hidden" name="next" value="{next}"><button class="btn primary" type="submit">Sign in</button>
</form></body></html>"""


CODE_FIELD = ('<input type="text" name="code" placeholder="6-digit code" inputmode="numeric" '
              'autocomplete="one-time-code" pattern="[0-9 ]{6,7}" required>')


def _safe_next(nxt):
    return nxt if nxt.startswith("#/") else "#/"


def _login_html(error, nxt):
    return LOGIN_PAGE.format(error=error, next=html.escape(_safe_next(nxt)),
                             code=CODE_FIELD if settings.totp_secret else "")


@app.get("/login", response_class=HTMLResponse)
async def login_page(next: str = "#/"):
    return _login_html("", next)


@app.post("/login")
async def login(request: Request, password: str = Form(""), code: str = Form(""), next: str = Form("#/")):
    # Behind a proxy this is the real client IP once FORWARDED_ALLOW_IPS trusts the proxy.
    ip = request.client.host if request.client else "?"
    if auth.locked_out(ip):
        return HTMLResponse(_login_html('<p class="err">Too many attempts. Try again in 15 minutes.</p>', next), 429)
    if not await auth.check(ip, password, code):
        msg = "Wrong password or code." if settings.totp_secret else "Wrong password."
        return HTMLResponse(_login_html(f'<p class="err">{msg}</p>', next), 401)
    resp = RedirectResponse("/" + _safe_next(next), 303)
    secure = settings.cookie_secure == "true" or (settings.cookie_secure == "auto" and request.url.scheme == "https")
    resp.set_cookie(auth.COOKIE, auth.make_session(), max_age=settings.session_days * 86400,
                    httponly=True, samesite="lax", secure=secure, path="/")
    return resp


@app.post("/logout")
async def logout():
    resp = RedirectResponse("/login", 303)
    resp.delete_cookie(auth.COOKIE, path="/")
    return resp


@app.get("/healthz")
async def healthz():
    return {"ok": True}


# ---------- reads ----------

@app.get("/api/me")
async def me(request: Request):
    profile = await canvas.get("users/self/profile", paginate=False, fresh=fresh(request))
    return {
        "canvasUrl": settings.canvas_url,
        "user": {"id": profile.get("id"), "name": profile.get("name"), "avatar": profile.get("avatar_url")},
    }


@app.get("/api/c/{path:path}")
async def proxy(path: str, request: Request):
    """Read-only passthrough to /api/v1/<path>, following pagination."""
    if not PATH_RE.fullmatch(path) or ".." in path:
        return JSONResponse({"error": "Bad path"}, 400)
    return await canvas.get(path, request.query_params.multi_items(), fresh=fresh(request))


@app.get("/api/x/announcements")
async def all_announcements(request: Request):
    f = fresh(request)
    courses = await canvas.get("courses", [("enrollment_state", "active")], fresh=f)
    codes = [("context_codes[]", f"course_{c['id']}") for c in courses
             if c.get("name") and not c.get("access_restricted_by_date")]
    if not codes:
        return []
    now = datetime.now(timezone.utc)
    params = codes + [("start_date", (now - timedelta(days=90)).date().isoformat()),
                      ("end_date", (now + timedelta(days=1)).date().isoformat())]
    return await canvas.get("announcements", params, fresh=f)


@app.get("/api/x/folder")
async def folder(request: Request, course: int, folder: str = "root"):
    f = fresh(request)
    if folder == "root":
        info = await canvas.get(f"courses/{course}/folders/root", paginate=False, fresh=f)
    else:
        info = await canvas.get(f"folders/{int(folder)}", paginate=False, fresh=f)
    subfolders, files = await asyncio.gather(
        canvas.get(f"folders/{info['id']}/folders", fresh=f),
        canvas.get(f"folders/{info['id']}/files", fresh=f),
    )
    return {"folder": info, "folders": subfolders, "files": files}


@app.get("/api/file/{file_id}")
async def file(file_id: int, inline: int = 0):
    info = await canvas.get(f"files/{file_id}", paginate=False)
    url = info.get("url")
    if not url:
        raise CanvasError(403, "This file isn't available to you (it may be locked).")
    req = canvas.client.build_request("GET", url)
    # httpx drops the Authorization header when Canvas redirects to its storage host.
    r = await canvas.client.send(req, stream=True, follow_redirects=True)
    if r.status_code >= 400:
        await r.aclose()
        raise CanvasError(r.status_code, "Canvas would not serve this file")
    ctype = r.headers.get("content-type") or info.get("content-type") or "application/octet-stream"
    name = info.get("display_name") or info.get("filename") or f"file-{file_id}"
    disp = "inline" if inline and ctype.startswith(INLINE_TYPES) else "attachment"
    headers = {
        "Content-Disposition": f"{disp}; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, max-age=3600",
    }
    if "content-length" in r.headers:
        headers["Content-Length"] = r.headers["content-length"]
    if not ctype.startswith("application/pdf"):
        # Uploaded HTML/SVG must never run as our origin.
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'"
    return StreamingResponse(r.aiter_bytes(), media_type=ctype, headers=headers, background=BackgroundTask(r.aclose))


# ---------- writes ----------

@app.post("/api/submit/{course}/{assignment}")
async def submit(
    course: int,
    assignment: int,
    type: str = Form(...),
    body: str = Form(""),
    url: str = Form(""),
    comment: str = Form(""),
    files: list[UploadFile] | None = File(None),
):
    data = [("submission[submission_type]", type)]
    if type == "online_text_entry":
        if not body.strip():
            return JSONResponse({"error": "Text submission is empty"}, 400)
        data.append(("submission[body]", body))
    elif type == "online_url":
        if not url.strip():
            return JSONResponse({"error": "URL is empty"}, 400)
        data.append(("submission[url]", url.strip()))
    elif type == "online_upload":
        if not files:
            return JSONResponse({"error": "Choose at least one file"}, 400)
        for up in files:
            data.append(("submission[file_ids][]", str(await canvas.upload_submission_file(course, assignment, up))))
    else:
        return JSONResponse({"error": f"Submission type {type} isn't supported here"}, 400)
    if comment.strip():
        data.append(("comment[text_comment]", comment.strip()))
    return await canvas.send("POST", f"courses/{course}/assignments/{assignment}/submissions", data=data)


@app.post("/api/comment/{course}/{assignment}")
async def add_comment(course: int, assignment: int, payload: dict = Body(...)):
    text = str(payload.get("text", "")).strip()
    if not text:
        return JSONResponse({"error": "Comment is empty"}, 400)
    return await canvas.send("PUT", f"courses/{course}/assignments/{assignment}/submissions/self",
                             data={"comment[text_comment]": text})


@app.post("/api/discussion/{course}/{topic}/reply")
async def reply(course: int, topic: int, payload: dict = Body(...)):
    message = str(payload.get("message", "")).strip()
    if not message:
        return JSONResponse({"error": "Reply is empty"}, 400)
    parent = payload.get("parent_id")
    path = f"courses/{course}/discussion_topics/{topic}/entries"
    if parent:
        path += f"/{int(parent)}/replies"
    return await canvas.send("POST", path, data={"message": message})


@app.post("/api/discussion/{course}/{topic}/read")
async def mark_read(course: int, topic: int):
    return await canvas.send("PUT", f"courses/{course}/discussion_topics/{topic}/read_all")


@app.post("/api/module/{course}/{module}/{item}/read")
async def module_item_read(course: int, module: int, item: int):
    return await canvas.send("POST", f"courses/{course}/modules/{module}/items/{item}/mark_read")


@app.post("/api/planner/done")
async def planner_done(payload: dict = Body(...)):
    done = "true" if payload.get("done") else "false"
    if payload.get("override_id"):
        return await canvas.send("PUT", f"planner/overrides/{int(payload['override_id'])}", data={"marked_complete": done})
    ptype = payload.get("plannable_type")
    if ptype not in PLANNABLE_TYPES:
        return JSONResponse({"error": "Bad plannable type"}, 400)
    return await canvas.send("POST", "planner/overrides", data={
        "plannable_type": ptype, "plannable_id": str(int(payload["plannable_id"])), "marked_complete": done,
    })


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
