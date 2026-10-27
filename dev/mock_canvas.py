"""A tiny fake Canvas API for local development. Not used in production.

    uvicorn dev.mock_canvas:app --port 9001
"""
import itertools
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

app = FastAPI()
BASE = "http://127.0.0.1:9001"
ids = itertools.count(1000)


def iso(days=0, hours=0):
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def enrollment(score, grade):
    return [{"type": "student", "computed_current_score": score, "computed_current_grade": grade}]


COURSES = [
    {"id": 101, "name": "Calculus II", "course_code": "MATH 152", "default_view": "modules", "is_favorite": True,
     "term": {"name": "Fall 2026"}, "enrollments": enrollment(91.4, "A-"), "apply_assignment_group_weights": True},
    {"id": 102, "name": "Intro to Psychology", "course_code": "PSY 101", "default_view": "assignments", "is_favorite": True,
     "term": {"name": "Fall 2026"}, "enrollments": enrollment(84.0, "B")},
    {"id": 103, "name": "Technical Writing", "course_code": "ENG 210", "default_view": "wiki", "is_favorite": True,
     "term": {"name": "Fall 2026"}, "enrollments": enrollment(None, None)},
]

ASSIGNMENTS = {
    1: {"id": 1, "course_id": 101, "name": "Problem Set 7: Series", "due_at": iso(1, 3), "points_possible": 20,
        "submission_types": ["online_upload"], "allowed_extensions": ["pdf"], "group": 1,
        "description": '<p>Complete problems 1-12 from <strong>section 11.4</strong>.</p><img src="/courses/101/files/501/preview"><p><a href="/courses/101/pages/series-notes">See the notes</a></p><script>alert(1)</script><p onclick="alert(2)" style="color:red;text-align:center">Show all work.</p>',
        "rubric": [{"id": "r1", "description": "Correctness", "points": 15}, {"id": "r2", "description": "Clarity", "points": 5}]},
    2: {"id": 2, "course_id": 101, "name": "Quiz 4", "due_at": iso(3), "points_possible": 10, "quiz_id": 77,
        "submission_types": ["online_quiz"], "group": 2, "description": "<p>Covers sections 11.1-11.3. 30 minutes.</p>"},
    3: {"id": 3, "course_id": 102, "name": "Reflection essay", "due_at": iso(5), "points_possible": 50,
        "submission_types": ["online_text_entry", "online_upload", "online_url"], "group": 3,
        "description": "<p>Write 500 words on a memory study.</p><iframe src=\"https://www.youtube.com/embed/xyz\" title=\"Lecture video\"></iframe>"},
    4: {"id": 4, "course_id": 102, "name": "Chapter 3 reading check", "due_at": iso(-4), "points_possible": 5,
        "submission_types": ["external_tool"], "is_quiz_lti_assignment": True, "group": 3, "description": ""},
    5: {"id": 5, "course_id": 101, "name": "Problem Set 6", "due_at": iso(-6), "points_possible": 20,
        "submission_types": ["online_upload"], "group": 1, "description": "<p>Sections 11.1-11.3</p>"},
    6: {"id": 6, "course_id": 103, "name": "Memo draft", "due_at": iso(-2), "points_possible": 25,
        "submission_types": ["online_text_entry"], "group": 4, "description": "<p>One page memo.</p>"},
}
for a in ASSIGNMENTS.values():
    a["html_url"] = f"{BASE}/courses/{a['course_id']}/{'quizzes/' + str(a['quiz_id']) if a.get('quiz_id') else 'assignments/' + str(a['id'])}"

SUBMISSIONS = {
    1: {"workflow_state": "unsubmitted", "attempt": None, "submission_comments": []},
    2: {"workflow_state": "unsubmitted"},
    3: {"workflow_state": "unsubmitted", "submission_comments": []},
    4: {"workflow_state": "unsubmitted", "missing": True},
    5: {"workflow_state": "graded", "submitted_at": iso(-7), "score": 18, "grade": "18", "attempt": 1,
        "attachments": [{"id": 502, "display_name": "ps6.pdf"}],
        "submission_comments": [{"author_name": "Prof. Lee", "comment": "Nice work on #4.", "created_at": iso(-5)}],
        "rubric_assessment": {"r1": {"points": 14, "comments": "Small slip on #7"}, "r2": {"points": 4}}},
    6: {"workflow_state": "unsubmitted", "missing": True, "submission_comments": []},
}

GROUPS = {101: [(1, "Homework", 40), (2, "Quizzes", 60)], 102: [(3, "Assignments", 100)], 103: [(4, "Writing", 100)]}

TOPICS = {
    201: {"id": 201, "course": 101, "title": "Week 9 office hours moved", "is_announcement": True, "posted_at": iso(-1),
          "message": "<p>Office hours are Thursday 3-5pm this week.</p>", "read_state": "unread", "author": {"display_name": "Prof. Lee"}},
    202: {"id": 202, "course": 102, "title": "Exam 2 study guide posted", "is_announcement": True, "posted_at": iso(-3),
          "message": "<p>The study guide is in Files.</p>", "read_state": "read", "author": {"display_name": "Dr. Patel"}},
    203: {"id": 203, "course": 102, "title": "Is memory reliable?", "is_announcement": False, "posted_at": iso(-6),
          "message": "<p>Discuss with one example.</p>", "read_state": "unread", "unread_count": 1, "author": {"display_name": "Dr. Patel"},
          "entries": [{"id": 301, "user_id": 9, "message": "<p>Not entirely, see the Loftus studies.</p>", "created_at": iso(-2), "replies": []}]},
}

PLANNER_OVERRIDES = {}


def page(request: Request, items):
    """Paginate lists like Canvas, so the client's Link-following gets exercised."""
    per = int(request.query_params.get("per_page", 10))
    p = int(request.query_params.get("page", 1))
    chunk = items[(p - 1) * per: p * per]
    resp = JSONResponse(chunk)
    if p * per < len(items):
        q = dict(request.query_params)
        q["page"] = str(p + 1)
        from urllib.parse import urlencode
        resp.headers["Link"] = f'<{BASE}{request.url.path}?{urlencode(q)}>; rel="next"'
    return resp


def with_sub(a):
    s = dict(SUBMISSIONS.get(a["id"], {}))
    return {**a, "submission": s}


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.headers.get("authorization") != "Bearer dev":
        return JSONResponse({"errors": [{"message": "Invalid access token."}]}, 401)
    return await call_next(request)


@app.get("/api/v1/users/self/profile")
def profile():
    return {"id": 9, "name": "Sam Student", "avatar_url": None}


@app.get("/api/v1/users/self/colors")
def colors():
    return {"custom_colors": {"course_101": "#0ea5e9", "course_102": "#f97316", "course_103": "#10b981"}}


@app.get("/api/v1/courses")
def courses(request: Request):
    return page(request, COURSES)


@app.get("/api/v1/courses/{cid}")
def course(cid: int):
    c = next(c for c in COURSES if c["id"] == cid)
    return {**c, "syllabus_body": "<h2>Syllabus</h2><p>Grading: homework 40%, quizzes 60%.</p>"}


@app.get("/api/v1/courses/{cid}/tabs")
def tabs(cid: int):
    names = ["home", "announcements", "assignments", "discussions", "grades", "modules", "pages", "files", "syllabus", "quizzes"]
    return [{"id": n, "label": n.title(), "hidden": n == "quizzes" and cid != 101} for n in names]


@app.get("/api/v1/planner/items")
def planner(request: Request):
    items = []
    for a in ASSIGNMENTS.values():
        s = SUBMISSIONS.get(a["id"], {})
        ptype = "quiz" if a.get("quiz_id") else "assignment"
        pid = a.get("quiz_id") or a["id"]
        items.append({
            "course_id": a["course_id"], "plannable_id": pid, "plannable_type": ptype, "plannable_date": a["due_at"],
            "context_name": next(c["name"] for c in COURSES if c["id"] == a["course_id"]),
            "plannable": {"title": a["name"], "due_at": a["due_at"], "points_possible": a["points_possible"]},
            "html_url": a["html_url"].replace(BASE, ""),
            "submissions": {"submitted": bool(s.get("submitted_at")), "graded": s.get("workflow_state") == "graded",
                            "missing": bool(s.get("missing")), "late": False, "has_feedback": bool(s.get("submission_comments"))},
            "planner_override": PLANNER_OVERRIDES.get((ptype, pid)),
        })
    for t in TOPICS.values():
        if t["is_announcement"]:
            items.append({"course_id": t["course"], "plannable_id": t["id"], "plannable_type": "announcement",
                          "plannable_date": t["posted_at"], "context_name": next(c["name"] for c in COURSES if c["id"] == t["course"]),
                          "plannable": {"title": t["title"]}, "html_url": f"/courses/{t['course']}/discussion_topics/{t['id']}",
                          "submissions": False})
    items.sort(key=lambda i: i["plannable_date"])
    return page(request, items)


@app.post("/api/v1/planner/overrides")
async def new_override(request: Request):
    f = await request.form()
    o = {"id": next(ids), "marked_complete": f["marked_complete"] == "true"}
    PLANNER_OVERRIDES[(f["plannable_type"], int(f["plannable_id"]))] = o
    return o


@app.put("/api/v1/planner/overrides/{oid}")
async def put_override(oid: int, request: Request):
    f = await request.form()
    for o in PLANNER_OVERRIDES.values():
        if o["id"] == oid:
            o["marked_complete"] = f["marked_complete"] == "true"
            return o
    return JSONResponse({"errors": [{"message": "not found"}]}, 404)


@app.get("/api/v1/users/self/missing_submissions")
def missing():
    return [a for a in ASSIGNMENTS.values() if SUBMISSIONS.get(a["id"], {}).get("missing")]


@app.get("/api/v1/courses/{cid}/assignment_groups")
def groups(cid: int):
    return [{"id": gid, "name": name, "group_weight": w,
             "assignments": [with_sub(a) for a in ASSIGNMENTS.values() if a["group"] == gid]}
            for gid, name, w in GROUPS[cid]]


@app.get("/api/v1/courses/{cid}/assignments/{aid}")
def assignment(cid: int, aid: int):
    return ASSIGNMENTS[aid]


@app.get("/api/v1/courses/{cid}/assignments/{aid}/submissions/self")
def submission(cid: int, aid: int):
    return {"assignment_id": aid, **SUBMISSIONS[aid]}


@app.put("/api/v1/courses/{cid}/assignments/{aid}/submissions/self")
async def comment(cid: int, aid: int, request: Request):
    f = await request.form()
    SUBMISSIONS[aid].setdefault("submission_comments", []).append(
        {"author_name": "Sam Student", "comment": f["comment[text_comment]"], "created_at": iso()})
    return SUBMISSIONS[aid]


UPLOADS = {}


@app.post("/api/v1/courses/{cid}/assignments/{aid}/submissions/self/files")
async def announce_upload(cid: int, aid: int, request: Request):
    f = await request.form()
    return {"upload_url": f"{BASE}/upload", "upload_params": {"filename": f["name"], "key": "abc"}}


@app.post("/upload")
async def do_upload(request: Request):
    f = await request.form()
    fid = next(ids)
    data = await f["file"].read()
    UPLOADS[fid] = (f["filename"], data)
    # Mimic Canvas: redirect to a confirm URL that must be fetched with the token.
    return Response(status_code=302, headers={"Location": f"{BASE}/api/v1/files/{fid}/create_success"})


@app.get("/api/v1/files/{fid}/create_success")
def create_success(fid: int):
    return {"id": fid, "display_name": UPLOADS[fid][0]}


@app.post("/api/v1/courses/{cid}/assignments/{aid}/submissions")
async def submit(cid: int, aid: int, request: Request):
    f = await request.form()
    s = SUBMISSIONS[aid]
    t = f["submission[submission_type]"]
    s.update({"workflow_state": "submitted", "submitted_at": iso(), "missing": False, "submission_type": t,
              "attempt": (s.get("attempt") or 0) + 1})
    if t == "online_text_entry":
        s["body"] = f["submission[body]"]
    if t == "online_url":
        s["url"] = f["submission[url]"]
    if t == "online_upload":
        s["attachments"] = [{"id": int(i), "display_name": UPLOADS[int(i)][0]} for i in f.getlist("submission[file_ids][]")]
    if f.get("comment[text_comment]"):
        s.setdefault("submission_comments", []).append({"author_name": "Sam Student", "comment": f["comment[text_comment]"], "created_at": iso()})
    return s


@app.get("/api/v1/courses/{cid}/modules")
def modules(cid: int):
    return [
        {"id": 1, "name": "Week 9: Series", "state": "started", "items_count": 4, "items": [
            {"id": 11, "type": "SubHeader", "title": "Read first", "indent": 0},
            {"id": 12, "type": "Page", "title": "Series notes", "page_url": "series-notes", "indent": 1,
             "completion_requirement": {"type": "must_view", "completed": False}},
            {"id": 13, "type": "Assignment", "title": "Problem Set 7: Series", "content_id": 1, "indent": 1,
             "content_details": {"due_at": ASSIGNMENTS[1]["due_at"], "points_possible": 20},
             "completion_requirement": {"type": "must_submit", "completed": False}},
            {"id": 14, "type": "Quiz", "title": "Quiz 4", "content_id": 77, "indent": 1, "html_url": f"{BASE}/courses/101/modules/items/14"},
            {"id": 15, "type": "File", "title": "lecture9.pdf", "content_id": 501, "indent": 1},
        ]},
        {"id": 2, "name": "Week 10: Power series", "state": "locked", "unlock_at": iso(6), "items_count": 1},
    ]


@app.get("/api/v1/courses/{cid}/modules/{mid}/items")
def module_items(cid: int, mid: int):
    return [{"id": 21, "type": "ExternalUrl", "title": "Desmos", "external_url": "https://www.desmos.com", "indent": 0}]


@app.post("/api/v1/courses/{cid}/modules/{mid}/items/{iid}/mark_read")
def mark_read(cid: int, mid: int, iid: int):
    return {}


PAGES = {"series-notes": {"title": "Series notes", "body": "<h2>Convergence tests</h2><ul><li>Ratio test</li><li>Root test</li></ul>"},
         "welcome": {"title": "Welcome", "body": "<p>Welcome to Technical Writing!</p>", "front_page": True}}


@app.get("/api/v1/courses/{cid}/pages")
def pages(cid: int):
    return [{"url": k, "title": v["title"], "updated_at": iso(-3), "front_page": v.get("front_page", False)} for k, v in PAGES.items()]


@app.get("/api/v1/courses/{cid}/pages/{slug}")
def page_one(cid: int, slug: str):
    p = PAGES[slug]
    return {**p, "url": slug, "updated_at": iso(-3), "html_url": f"{BASE}/courses/{cid}/pages/{slug}"}


@app.get("/api/v1/courses/{cid}/front_page")
def front_page(cid: int):
    return page_one(cid, "welcome")


def topic_json(t):
    return {k: v for k, v in t.items() if k not in ("entries", "course")} | {
        "html_url": f"{BASE}/courses/{t['course']}/discussion_topics/{t['id']}",
        "discussion_subentry_count": len(t.get("entries", [])), "permissions": {"reply": not t["is_announcement"]},
        "last_reply_at": t["entries"][-1]["created_at"] if t.get("entries") else None}


@app.get("/api/v1/courses/{cid}/discussion_topics")
def topics(cid: int, request: Request):
    ann = request.query_params.get("only_announcements") == "true"
    return [topic_json(t) for t in TOPICS.values() if t["course"] == cid and t["is_announcement"] == ann]


@app.get("/api/v1/courses/{cid}/discussion_topics/{tid}")
def topic(cid: int, tid: int):
    return topic_json(TOPICS[tid])


@app.get("/api/v1/courses/{cid}/discussion_topics/{tid}/view")
def topic_view(cid: int, tid: int):
    t = TOPICS[tid]
    return {"participants": [{"id": 9, "display_name": "Sam Student"}, {"id": 8, "display_name": "Alex Kim"}],
            "view": t.get("entries", []), "unread_entries": [301] if t.get("unread_count") else []}


@app.post("/api/v1/courses/{cid}/discussion_topics/{tid}/entries")
@app.post("/api/v1/courses/{cid}/discussion_topics/{tid}/entries/{eid}/replies")
async def post_entry(cid: int, tid: int, request: Request, eid: int | None = None):
    f = await request.form()
    e = {"id": next(ids), "user_id": 9, "message": f["message"], "created_at": iso(), "replies": []}
    entries = TOPICS[tid].setdefault("entries", [])
    if eid:
        stack = list(entries)
        while stack:
            x = stack.pop()
            if x["id"] == eid:
                x["replies"].append(e)
                break
            stack.extend(x["replies"])
    else:
        entries.append(e)
    return e


@app.put("/api/v1/courses/{cid}/discussion_topics/{tid}/read_all")
def read_all(cid: int, tid: int):
    TOPICS[tid]["read_state"] = "read"
    TOPICS[tid]["unread_count"] = 0
    return Response(status_code=204)


@app.get("/api/v1/announcements")
def announcements(request: Request):
    codes = request.query_params.getlist("context_codes[]")
    return [topic_json(t) | {"context_code": f"course_{t['course']}"} for t in TOPICS.values()
            if t["is_announcement"] and f"course_{t['course']}" in codes]


@app.get("/api/v1/courses/{cid}/quizzes")
def quizzes(cid: int):
    return [{"id": 77, "title": "Quiz 4", "due_at": ASSIGNMENTS[2]["due_at"], "points_possible": 10, "time_limit": 30,
             "html_url": f"{BASE}/courses/101/quizzes/77"}] if cid == 101 else []


@app.get("/api/v1/courses/{cid}/folders/root")
def root_folder(cid: int):
    return {"id": 900, "name": "course files", "full_name": "course files", "parent_folder_id": None}


@app.get("/api/v1/folders/{fid}")
def folder(fid: int):
    return {"id": fid, "name": "Lectures", "full_name": "course files/Lectures", "parent_folder_id": 900}


@app.get("/api/v1/folders/{fid}/folders")
def subfolders(fid: int):
    return [{"id": 901, "name": "Lectures", "files_count": 1, "folders_count": 0}] if fid == 900 else []


@app.get("/api/v1/folders/{fid}/files")
def folder_files(fid: int):
    return [{"id": 501, "display_name": "lecture9.pdf", "size": 48213, "updated_at": iso(-2)}] if fid == 901 else \
        [{"id": 503, "display_name": "syllabus.txt", "size": 1200, "updated_at": iso(-30)}]


FILES = {501: ("lecture9.png", "image/png"), 502: ("ps6.txt", "text/plain"), 503: ("syllabus.txt", "text/plain")}


@app.get("/api/v1/files/{fid}")
def file_info(fid: int):
    if fid in UPLOADS:
        return {"id": fid, "display_name": UPLOADS[fid][0], "url": f"{BASE}/files/{fid}/download"}
    name, ctype = FILES[fid]
    return {"id": fid, "display_name": name, "content-type": ctype, "url": f"{BASE}/files/{fid}/download?verifier=x"}


@app.get("/files/{fid}/download")
def download(fid: int):
    if fid in UPLOADS:
        return Response(UPLOADS[fid][1], media_type="application/octet-stream")
    if fid == 501:
        from pathlib import Path
        return Response((Path(__file__).parent.parent / "app/static/icons/icon-192.png").read_bytes(), media_type="image/png")
    return Response(f"Contents of file {fid}\n", media_type="text/plain")
