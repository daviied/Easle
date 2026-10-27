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
RECIPIENT_RE = re.compile(r"\w+")
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


def context(kind, cid):
    """A course or group, as a Canvas API path prefix."""
    if kind not in ("courses", "groups"):
        raise CanvasError(400, "Bad context")
    return f"{kind}/{int(cid)}"


def bad(msg):
    return JSONResponse({"error": msg}, 400)


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
    """Read-only passthrough to /api/v1/<path>, following pagination (`_pages=N` caps how many pages)."""
    if not PATH_RE.fullmatch(path) or ".." in path:
        return bad("Bad path")
    params = request.query_params.multi_items()
    pages = next((int(v) for k, v in params if k == "_pages" and v.isdigit()), 50)
    params = [(k, v) for k, v in params if k != "_pages"]
    # Quiz state changes with every answer, so it is never served from the cache.
    f = fresh(request) or "quiz" in path
    return await canvas.get(path, params, fresh=f, max_pages=max(1, min(pages, 50)))


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
async def folder(request: Request, kind: str = "courses", id: int = 0, folder: str = "root"):
    f = fresh(request)
    if folder == "root":
        info = await canvas.get(f"{context(kind, id)}/folders/root", paginate=False, fresh=f)
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


# ---------- assignments ----------

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
            return bad("Text submission is empty")
        data.append(("submission[body]", body))
    elif type == "online_url":
        if not url.strip():
            return bad("URL is empty")
        data.append(("submission[url]", url.strip()))
    elif type == "online_upload":
        if not files:
            return bad("Choose at least one file")
        for up in files:
            data.append(("submission[file_ids][]", str(await canvas.upload_submission_file(course, assignment, up))))
    else:
        return bad(f"Submission type {type} isn't supported here")
    if comment.strip():
        data.append(("comment[text_comment]", comment.strip()))
    return await canvas.send("POST", f"courses/{course}/assignments/{assignment}/submissions", data=data)


@app.post("/api/comment/{course}/{assignment}")
async def add_comment(course: int, assignment: int, payload: dict = Body(...)):
    """Comment on your own submission, or on a classmate's when you're their peer reviewer (user_id)."""
    text = str(payload.get("text", "")).strip()
    if not text:
        return bad("Comment is empty")
    user = int(payload["user_id"]) if payload.get("user_id") else "self"
    return await canvas.send("PUT", f"courses/{course}/assignments/{assignment}/submissions/{user}",
                             data={"comment[text_comment]": text})


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
        return bad("Bad plannable type")
    return await canvas.send("POST", "planner/overrides", data={
        "plannable_type": ptype, "plannable_id": str(int(payload["plannable_id"])), "marked_complete": done,
    })


# ---------- discussions (courses and groups) ----------

def _attachment(up):
    if up and up.filename:
        return {"attachment": (up.filename, up.file, up.content_type or "application/octet-stream")}
    return None


@app.post("/api/discussion/{kind}/{cid}/new")
async def new_topic(kind: str, cid: int, title: str = Form(...), message: str = Form(""),
                    attachment: UploadFile | None = File(None)):
    if not title.strip():
        return bad("Title is empty")
    return await canvas.send("POST", f"{context(kind, cid)}/discussion_topics",
                             data={"title": title.strip(), "message": message, "published": "true",
                                   "discussion_type": "threaded"},
                             files=_attachment(attachment))


@app.post("/api/discussion/{kind}/{cid}/{topic}/reply")
async def reply(kind: str, cid: int, topic: int, message: str = Form(""), parent_id: str = Form(""),
                attachment: UploadFile | None = File(None)):
    if not message.strip():
        return bad("Reply is empty")
    path = f"{context(kind, cid)}/discussion_topics/{topic}/entries"
    if parent_id:
        path += f"/{int(parent_id)}/replies"
    return await canvas.send("POST", path, data={"message": message}, files=_attachment(attachment))


@app.post("/api/discussion/{kind}/{cid}/{topic}/read")
async def mark_read(kind: str, cid: int, topic: int):
    return await canvas.send("PUT", f"{context(kind, cid)}/discussion_topics/{topic}/read_all")


@app.post("/api/discussion/{kind}/{cid}/{topic}/entry/{entry}/{action}")
async def entry_action(kind: str, cid: int, topic: int, entry: int, action: str, payload: dict = Body(default={})):
    path = f"{context(kind, cid)}/discussion_topics/{topic}/entries/{entry}"
    if action == "edit":
        message = str(payload.get("message", "")).strip()
        if not message:
            return bad("Reply is empty")
        return await canvas.send("PUT", path, data={"message": message})
    if action == "delete":
        return await canvas.send("DELETE", path)
    if action == "rate":
        return await canvas.send("POST", f"{path}/rating", data={"rating": "1" if payload.get("rating") else "0"})
    return bad("Unknown action")


# ---------- inbox ----------

@app.post("/api/inbox/upload")
async def inbox_upload(file: UploadFile = File(...)):
    fid = await canvas.upload_file("users/self/files", file, {"parent_folder_path": "conversation attachments"})
    return {"id": fid}


@app.post("/api/inbox/send")
async def inbox_send(payload: dict = Body(...)):
    recipients = [str(r) for r in payload.get("recipients") or []]
    body = str(payload.get("body", "")).strip()
    if not recipients or not all(RECIPIENT_RE.fullmatch(r) for r in recipients):
        return bad("Add at least one recipient")
    if not body:
        return bad("Message is empty")
    data = [("recipients[]", r) for r in recipients]
    data += [("subject", str(payload.get("subject", "")).strip()), ("body", body),
             # One shared thread, unless "send individually" was ticked.
             ("group_conversation", "false" if payload.get("individual") else "true"),
             ("bulk_message", "1" if payload.get("individual") else "0")]
    if payload.get("context_code") and RECIPIENT_RE.fullmatch(str(payload["context_code"])):
        data.append(("context_code", str(payload["context_code"])))
    data += [("attachment_ids[]", str(int(a))) for a in payload.get("attachment_ids") or []]
    return await canvas.send("POST", "conversations", data=data)


@app.post("/api/inbox/{conv}/reply")
async def inbox_reply(conv: int, payload: dict = Body(...)):
    body = str(payload.get("body", "")).strip()
    if not body:
        return bad("Message is empty")
    data = [("body", body)] + [("attachment_ids[]", str(int(a))) for a in payload.get("attachment_ids") or []]
    return await canvas.send("POST", f"conversations/{conv}/add_message", data=data)


@app.post("/api/inbox/{conv}/state")
async def inbox_state(conv: int, payload: dict = Body(...)):
    state = payload.get("state")
    if state not in ("read", "unread", "archived"):
        return bad("Bad state")
    return await canvas.send("PUT", f"conversations/{conv}", data={"conversation[workflow_state]": state})


# ---------- classic quizzes ----------
# Quizzes whose settings this app can't honour stay on Canvas; the server re-checks so no rule can be bypassed.

def quiz_restrictions(q):
    reasons = []
    if q.get("require_lockdown_browser") or q.get("require_lockdown_browser_for_results"):
        reasons.append("LockDown Browser")
    if q.get("has_access_code") or q.get("access_code"):
        reasons.append("an access code")
    if q.get("ip_filter"):
        reasons.append("network (IP) restrictions")
    if q.get("one_question_at_a_time"):
        reasons.append("one question at a time")
    if q.get("cant_go_back"):
        reasons.append("locked questions after answering")
    return reasons


QUIZ_TOKENS = {}  # quiz submission id -> validation token (needed to answer and submit)


def _in_progress(subs):
    for s in subs:
        if s.get("workflow_state") == "untaken":
            return s
    return None


async def _quiz_subs(course, quiz):
    res = await canvas.get(f"courses/{course}/quizzes/{quiz}/submissions", fresh=True)
    return res.get("quiz_submissions", []) if isinstance(res, dict) else res


async def _checked_quiz(course, quiz):
    q = await canvas.get(f"courses/{course}/quizzes/{quiz}", paginate=False, fresh=True)
    reasons = quiz_restrictions(q)
    if reasons:
        raise CanvasError(403, f"This quiz uses {', '.join(reasons)}, so take it on Canvas.")
    return q


def _session(sub):
    if not sub:
        return {"submission": None, "token": None}
    if sub.get("validation_token"):
        QUIZ_TOKENS[sub["id"]] = sub["validation_token"]
    return {"submission": sub, "token": QUIZ_TOKENS.get(sub["id"])}


@app.get("/api/quiz/{course}/{quiz}/session")
async def quiz_session(course: int, quiz: int):
    await _checked_quiz(course, quiz)
    return _session(_in_progress(await _quiz_subs(course, quiz)))


@app.post("/api/quiz/{course}/{quiz}/start")
async def quiz_start(course: int, quiz: int):
    await _checked_quiz(course, quiz)
    try:
        res = await canvas.send("POST", f"courses/{course}/quizzes/{quiz}/submissions")
        subs = res.get("quiz_submissions", [])
    except CanvasError as e:
        if e.status != 409:  # 409 = an attempt is already in progress; resume it
            raise
        subs = await _quiz_subs(course, quiz)
    return _session(_in_progress(subs))


@app.post("/api/quiz/{course}/{quiz}/upload")
async def quiz_upload(course: int, quiz: int, file: UploadFile = File(...)):
    await _checked_quiz(course, quiz)
    return {"id": await canvas.upload_file(f"courses/{course}/quizzes/{quiz}/submissions/self/files", file)}


def _token_body(payload, sub):
    return {"attempt": int(payload["attempt"]),
            "validation_token": payload.get("token") or QUIZ_TOKENS.get(sub, "")}


@app.post("/api/quiz/sub/{sub}/answer")
async def quiz_answer(sub: int, payload: dict = Body(...)):
    body = _token_body(payload, sub) | {"quiz_questions": payload.get("quiz_questions") or []}
    return await canvas.send("POST", f"quiz_submissions/{sub}/questions", json=body, invalidate=False)


@app.post("/api/quiz/sub/{sub}/flag/{question}")
async def quiz_flag(sub: int, question: int, payload: dict = Body(...)):
    action = "flag" if payload.get("flag") else "unflag"
    return await canvas.send("PUT", f"quiz_submissions/{sub}/questions/{question}/{action}",
                             json=_token_body(payload, sub), invalidate=False)


@app.post("/api/quiz/{course}/{quiz}/complete/{sub}")
async def quiz_complete(course: int, quiz: int, sub: int, payload: dict = Body(...)):
    res = await canvas.send("POST", f"courses/{course}/quizzes/{quiz}/submissions/{sub}/complete",
                            json=_token_body(payload, sub))
    QUIZ_TOKENS.pop(sub, None)
    return res


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
