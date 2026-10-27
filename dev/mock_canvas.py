"""A small fake Canvas API for local development. Not used in production.

    uvicorn dev.mock_canvas:app --port 9001
"""
import itertools
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

app = FastAPI()
BASE = "http://127.0.0.1:9001"
ME = 9
ids = itertools.count(1000)


def iso(days=0, hours=0, minutes=0):
    t = datetime.now(timezone.utc) + timedelta(days=days, hours=hours, minutes=minutes)
    return t.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def err(status, msg):
    return JSONResponse({"errors": [{"message": msg}]}, status)


async def form(request):
    """Form fields from urlencoded or multipart bodies."""
    return await request.form()


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
GROUPS = [{"id": 401, "name": "Study Group A", "course_id": 102, "members_count": 3}]

USERS = {
    9: {"id": 9, "name": "Sam Student", "sortable_name": "Student, Sam", "pronouns": "they/them"},
    8: {"id": 8, "name": "Alex Kim", "sortable_name": "Kim, Alex"},
    7: {"id": 7, "name": "Dr. Patel", "sortable_name": "Patel, Dr."},
    6: {"id": 6, "name": "Jordan Lee", "sortable_name": "Lee, Jordan"},
}
ROSTER = {101: [(7, "TeacherEnrollment"), (9, "StudentEnrollment"), (8, "StudentEnrollment")],
          102: [(7, "TeacherEnrollment"), (6, "TaEnrollment"), (9, "StudentEnrollment"), (8, "StudentEnrollment")],
          103: [(7, "TeacherEnrollment"), (9, "StudentEnrollment")]}

ASSIGNMENTS = {
    1: {"id": 1, "course_id": 101, "name": "Problem Set 7: Series", "due_at": iso(1, 3), "points_possible": 20,
        "submission_types": ["online_upload"], "allowed_extensions": ["pdf"], "group": 1,
        "description": '<p>Complete problems 1-12 from <strong>section 11.4</strong>.</p><img src="/courses/101/files/501/preview"><p><a href="/courses/101/pages/series-notes">See the notes</a></p><script>alert(1)</script><p onclick="alert(2)" style="color:red;text-align:center">Show all work.</p>',
        "rubric": [{"id": "r1", "description": "Correctness", "points": 15}, {"id": "r2", "description": "Clarity", "points": 5}]},
    2: {"id": 2, "course_id": 101, "name": "Quiz 4", "due_at": iso(3), "points_possible": 10, "quiz_id": 77,
        "submission_types": ["online_quiz"], "group": 2, "description": "<p>Covers sections 11.1-11.3. 30 minutes.</p>"},
    3: {"id": 3, "course_id": 102, "name": "Reflection essay", "due_at": iso(5), "points_possible": 50,
        "submission_types": ["online_text_entry", "online_upload", "online_url"], "group": 3, "peer_reviews": True,
        "description": "<p>Write 500 words on a memory study.</p><iframe src=\"https://www.youtube.com/embed/xyz\" title=\"Lecture video\"></iframe>"},
    4: {"id": 4, "course_id": 102, "name": "Chapter 3 reading check", "due_at": iso(-4), "points_possible": 5,
        "submission_types": ["external_tool"], "is_quiz_lti_assignment": True, "group": 3, "description": ""},
    5: {"id": 5, "course_id": 101, "name": "Problem Set 6", "due_at": iso(-6), "points_possible": 20,
        "submission_types": ["online_upload"], "group": 1, "description": "<p>Sections 11.1-11.3</p>"},
    6: {"id": 6, "course_id": 103, "name": "Memo draft", "due_at": iso(-2), "points_possible": 25,
        "submission_types": ["online_text_entry"], "group": 4, "description": "<p>One page memo.</p>"},
    8: {"id": 8, "course_id": 101, "name": "Problem Set 5", "due_at": iso(-13), "points_possible": 20,
        "submission_types": ["online_upload"], "group": 1, "description": ""},
    9: {"id": 9, "course_id": 101, "name": "Participation", "due_at": None, "points_possible": 5,
        "submission_types": ["none"], "group": 1, "omit_from_final_grade": True, "description": ""},
    7: {"id": 7, "course_id": 101, "name": "Midterm (proctored)", "due_at": iso(8), "points_possible": 100, "quiz_id": 78,
        "submission_types": ["online_quiz"], "group": 2, "description": "<p>LockDown Browser required.</p>"},
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
    7: {"workflow_state": "unsubmitted"},
    8: {"workflow_state": "graded", "submitted_at": iso(-14), "score": 10, "grade": "10"},
    9: {"workflow_state": "graded", "score": 5, "grade": "5"},
}
# Calculus II: PS6 18/20 + PS5 10/20 (dropped) -> homework 90%; quiz 4 not graded yet -> current 90% (A- on its scheme).
COURSES[0]["grading_standard_id"] = 55
COURSES[0]["enrollments"] = enrollment(90.0, "A-")
GROUP_RULES = {1: {"drop_lowest": 1}}
PAST_COURSES = [
    {"id": 91, "name": "Calculus I", "course_code": "MATH 151", "term": {"name": "Spring 2026", "start_at": "2026-01-12T00:00:00Z"},
     "enrollments": [{"type": "student", "computed_final_score": 88.2, "computed_final_grade": "B+"}]},
    {"id": 92, "name": "English Composition", "course_code": "ENG 101", "term": {"name": "Spring 2026", "start_at": "2026-01-12T00:00:00Z"},
     "enrollments": [{"type": "student", "computed_final_score": 95.0, "computed_final_grade": "A"}]},
    {"id": 93, "name": "Intro to Programming", "course_code": "CS 101", "term": {"name": "Fall 2025", "start_at": "2025-08-25T00:00:00Z"},
     "enrollments": [{"type": "student", "computed_final_score": 79.0, "computed_final_grade": None}]},
]
CUSTOM_DATA = {}
PEER_COMMENTS = []

GROUPS_BY_COURSE = {101: [(1, "Homework", 40), (2, "Quizzes", 60)], 102: [(3, "Assignments", 100)], 103: [(4, "Writing", 100)]}

TOPICS = {
    201: {"id": 201, "ctx": "courses/101", "title": "Week 9 office hours moved", "is_announcement": True, "posted_at": iso(-1),
          "message": "<p>Office hours are Thursday 3-5pm this week.</p>", "read_state": "unread", "author": {"display_name": "Prof. Lee"}},
    202: {"id": 202, "ctx": "courses/102", "title": "Exam 2 study guide posted", "is_announcement": True, "posted_at": iso(-3),
          "message": "<p>The study guide is in Files.</p>", "read_state": "read", "author": {"display_name": "Dr. Patel"}},
    203: {"id": 203, "ctx": "courses/102", "title": "Is memory reliable?", "is_announcement": False, "posted_at": iso(-6),
          "message": "<p>Discuss with one example.</p>", "read_state": "unread", "unread_count": 1, "author": {"display_name": "Dr. Patel"},
          "allow_rating": True,
          "entries": [{"id": 301, "user_id": 8, "message": "<p>Not entirely, see the Loftus studies.</p>", "created_at": iso(-2), "replies": [], "rating_sum": 2},
                      {"id": 302, "user_id": 9, "message": "<p>My first take.</p>", "created_at": iso(-1), "replies": [], "rating_sum": 0}]},
    204: {"id": 204, "ctx": "groups/401", "title": "Split up the chapters", "is_announcement": False, "posted_at": iso(-2),
          "message": "<p>I'll take chapter 4.</p>", "read_state": "read", "author": {"display_name": "Alex Kim"}, "entries": []},
}
RATINGS = {}  # entry id -> my rating


def page(request: Request, items):
    """Paginate lists like Canvas, so the client's Link-following gets exercised."""
    per = int(request.query_params.get("per_page", 10))
    p = int(request.query_params.get("page", 1))
    resp = JSONResponse(items[(p - 1) * per: p * per])
    if p * per < len(items):
        q = dict(request.query_params)
        q["page"] = str(p + 1)
        resp.headers["Link"] = f'<{BASE}{request.url.path}?{urlencode(q)}>; rel="next"'
    return resp


def with_sub(a):
    return {**a, "submission": dict(SUBMISSIONS.get(a["id"], {}))}


def course_name(cid):
    return next(c["name"] for c in COURSES if c["id"] == cid)


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.headers.get("authorization") != "Bearer dev":
        return err(401, "Invalid access token.")
    return await call_next(request)


# ---------- users, courses, groups ----------

@app.get("/api/v1/users/self/profile")
def profile():
    return {"id": ME, "name": "Sam Student", "avatar_url": None}


@app.get("/api/v1/users/self/colors")
def colors():
    return {"custom_colors": {"course_101": "#0ea5e9", "course_102": "#f97316", "course_103": "#10b981"}}


@app.get("/api/v1/courses")
def courses(request: Request):
    return page(request, PAST_COURSES if request.query_params.get("enrollment_state") == "completed" else COURSES)


@app.get("/api/v1/courses/{cid}/grading_standards")
def grading_standards(cid: int):
    scheme = [("A", 0.93), ("A-", 0.9), ("B+", 0.87), ("B", 0.83), ("B-", 0.8), ("C", 0.7), ("D", 0.6), ("F", 0)]
    return [{"id": 55, "title": "Math dept", "grading_scheme": [{"name": n, "value": v} for n, v in scheme]}] if cid == 101 else []


@app.get("/api/v1/users/self/custom_data/{scope}")
def get_custom(scope: str, request: Request):
    key = (request.query_params.get("ns"), scope)
    return {"data": CUSTOM_DATA[key]} if key in CUSTOM_DATA else err(404, "no data for scope")


@app.put("/api/v1/users/self/custom_data/{scope}")
async def put_custom(scope: str, request: Request):
    body = await request.json()
    if not body.get("ns"):
        return err(400, "ns required")
    CUSTOM_DATA[(body["ns"], scope)] = body["data"]
    return {"data": body["data"]}


@app.get("/api/v1/courses/{cid}")
def course(cid: int):
    c = next(c for c in COURSES if c["id"] == cid)
    return {**c, "syllabus_body": "<h2>Syllabus</h2><p>Grading: homework 40%, quizzes 60%.</p>",
            "permissions": {"create_discussion_topic": cid == 102, "create_announcement": False}}


@app.get("/api/v1/courses/{cid}/tabs")
def tabs(cid: int):
    names = ["home", "announcements", "assignments", "discussions", "grades", "people", "modules", "pages", "files", "syllabus", "quizzes"]
    return [{"id": n, "label": n.title(), "hidden": n == "quizzes" and cid != 101} for n in names]


@app.get("/api/v1/courses/{cid}/users")
def course_users(cid: int, request: Request):
    return page(request, [{**USERS[u], "avatar_url": None, "enrollments": [{"type": t, "course_id": cid}]} for u, t in ROSTER[cid]])


@app.get("/api/v1/users/self/groups")
def my_groups():
    return GROUPS


@app.get("/api/v1/groups/{gid}")
def group(gid: int):
    return {**GROUPS[0], "permissions": {"create_discussion_topic": True}}


@app.get("/api/v1/groups/{gid}/tabs")
def group_tabs(gid: int):
    return [{"id": n, "label": n.title()} for n in ["home", "announcements", "pages", "people", "discussions", "files"]]


@app.get("/api/v1/groups/{gid}/users")
def group_users(gid: int):
    return [USERS[9], USERS[8], USERS[6]]


@app.get("/api/v1/groups/{gid}/pages")
def group_pages(gid: int):
    return [{"url": "notes", "title": "Group notes", "updated_at": iso(-1)}]


@app.get("/api/v1/groups/{gid}/pages/{slug}")
def group_page(gid: int, slug: str):
    return {"url": slug, "title": "Group notes", "body": "<p>Meet Tuesdays.</p>", "updated_at": iso(-1),
            "html_url": f"{BASE}/groups/{gid}/pages/{slug}"}


@app.get("/api/v1/groups/{gid}/folders/root")
def group_root(gid: int):
    return {"id": 950, "name": "group files", "full_name": "group files", "parent_folder_id": None}


# ---------- planner / assignments ----------

PLANNER_OVERRIDES = {}


@app.get("/api/v1/planner/items")
def planner(request: Request):
    items = []
    for a in ASSIGNMENTS.values():
        if not a["due_at"]:
            continue
        s = SUBMISSIONS.get(a["id"], {})
        ptype = "quiz" if a.get("quiz_id") else "assignment"
        pid = a.get("quiz_id") or a["id"]
        items.append({
            "course_id": a["course_id"], "plannable_id": pid, "plannable_type": ptype, "plannable_date": a["due_at"],
            "context_name": course_name(a["course_id"]),
            "plannable": {"title": a["name"], "due_at": a["due_at"], "points_possible": a["points_possible"]},
            "html_url": a["html_url"].replace(BASE, ""),
            "submissions": {"submitted": bool(s.get("submitted_at")), "graded": s.get("workflow_state") == "graded",
                            "missing": bool(s.get("missing")), "late": False, "has_feedback": bool(s.get("submission_comments"))},
            "planner_override": PLANNER_OVERRIDES.get((ptype, pid)),
        })
    items.sort(key=lambda i: i["plannable_date"])
    return page(request, items)


@app.post("/api/v1/planner/overrides")
async def new_override(request: Request):
    f = await form(request)
    o = {"id": next(ids), "marked_complete": f["marked_complete"] == "true"}
    PLANNER_OVERRIDES[(f["plannable_type"], int(f["plannable_id"]))] = o
    return o


@app.put("/api/v1/planner/overrides/{oid}")
async def put_override(oid: int, request: Request):
    f = await form(request)
    for o in PLANNER_OVERRIDES.values():
        if o["id"] == oid:
            o["marked_complete"] = f["marked_complete"] == "true"
            return o
    return err(404, "not found")


@app.get("/api/v1/users/self/missing_submissions")
def missing():
    return [a for a in ASSIGNMENTS.values() if SUBMISSIONS.get(a["id"], {}).get("missing")]


@app.get("/api/v1/courses/{cid}/assignment_groups")
def groups(cid: int):
    return [{"id": gid, "name": name, "group_weight": w, "rules": GROUP_RULES.get(gid, {}),
             "assignments": [with_sub(a) for a in ASSIGNMENTS.values() if a["group"] == gid]}
            for gid, name, w in GROUPS_BY_COURSE[cid]]


@app.get("/api/v1/courses/{cid}/assignments/{aid}")
def assignment(cid: int, aid: int):
    return ASSIGNMENTS[aid]


@app.get("/api/v1/courses/{cid}/assignments/{aid}/submissions/self")
def submission(cid: int, aid: int):
    return {"assignment_id": aid, **SUBMISSIONS[aid]}


@app.put("/api/v1/courses/{cid}/assignments/{aid}/submissions/{user}")
async def comment(cid: int, aid: int, user: str, request: Request):
    f = await form(request)
    c = {"author_id": ME, "author_name": "Sam Student", "comment": f["comment[text_comment]"], "created_at": iso()}
    if user == "self":
        SUBMISSIONS[aid].setdefault("submission_comments", []).append(c)
        return SUBMISSIONS[aid]
    PEER_COMMENTS.append((aid, int(user), c))
    return {"user_id": int(user)}


@app.get("/api/v1/courses/{cid}/assignments/{aid}/peer_reviews")
def peer_reviews(cid: int, aid: int):
    if not ASSIGNMENTS[aid].get("peer_reviews"):
        return []
    mine = [c for a, u, c in PEER_COMMENTS if a == aid and u == 8]
    return [{"assessor_id": ME, "user_id": 8, "asset_id": 5555, "workflow_state": "completed" if mine else "assigned",
             "user": {"id": 8, "display_name": "Alex Kim"}, "submission_comments": mine}]


UPLOADS = {}


@app.post("/api/v1/courses/{cid}/assignments/{aid}/submissions/self/files")
@app.post("/api/v1/courses/{cid}/quizzes/{aid}/submissions/self/files")
@app.post("/api/v1/users/self/files")
async def announce_upload(request: Request, cid: int = 0, aid: int = 0):
    f = await form(request)
    return {"upload_url": f"{BASE}/upload", "upload_params": {"filename": f["name"], "key": "abc"}}


@app.post("/upload")
async def do_upload(request: Request):
    f = await form(request)
    fid = next(ids)
    UPLOADS[fid] = (f["filename"], await f["file"].read())
    # Mimic Canvas: redirect to a confirm URL that must be fetched with the token.
    return Response(status_code=302, headers={"Location": f"{BASE}/api/v1/files/{fid}/create_success"})


@app.get("/api/v1/files/{fid}/create_success")
def create_success(fid: int):
    return {"id": fid, "display_name": UPLOADS[fid][0]}


@app.post("/api/v1/courses/{cid}/assignments/{aid}/submissions")
async def submit(cid: int, aid: int, request: Request):
    f = await form(request)
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


# ---------- modules / pages ----------

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
    return {**PAGES[slug], "url": slug, "updated_at": iso(-3), "html_url": f"{BASE}/courses/{cid}/pages/{slug}"}


@app.get("/api/v1/courses/{cid}/front_page")
def front_page(cid: int):
    return page_one(cid, "welcome")


# ---------- discussions (courses and groups) ----------

def topic_json(t):
    return {k: v for k, v in t.items() if k not in ("entries", "ctx")} | {
        "html_url": f"{BASE}/{t['ctx']}/discussion_topics/{t['id']}",
        "discussion_subentry_count": len(t.get("entries", [])),
        "permissions": {"reply": not t["is_announcement"], "attach": True},
        "last_reply_at": t["entries"][-1]["created_at"] if t.get("entries") else None}


def find_entry(entries, eid):
    stack = list(entries)
    while stack:
        x = stack.pop()
        if x["id"] == eid:
            return x
        stack.extend(x["replies"])
    return None


@app.get("/api/v1/{kind}/{cid}/discussion_topics")
def topics(kind: str, cid: int, request: Request):
    ann = request.query_params.get("only_announcements") == "true"
    return [topic_json(t) for t in TOPICS.values() if t["ctx"] == f"{kind}/{cid}" and t["is_announcement"] == ann]


@app.post("/api/v1/{kind}/{cid}/discussion_topics")
async def new_topic(kind: str, cid: int, request: Request):
    f = await form(request)
    tid = next(ids)
    att = f.get("attachment")
    TOPICS[tid] = {"id": tid, "ctx": f"{kind}/{cid}", "title": f["title"], "is_announcement": False, "posted_at": iso(),
                   "message": f["message"], "read_state": "read", "author": {"display_name": "Sam Student"}, "entries": [],
                   "attachments": [{"id": 999, "display_name": att.filename}] if att and getattr(att, "filename", None) else []}
    return topic_json(TOPICS[tid])


@app.get("/api/v1/{kind}/{cid}/discussion_topics/{tid}")
def topic(kind: str, cid: int, tid: int):
    return topic_json(TOPICS[tid])


@app.get("/api/v1/{kind}/{cid}/discussion_topics/{tid}/view")
def topic_view(kind: str, cid: int, tid: int):
    t = TOPICS[tid]
    return {"participants": [{"id": u["id"], "display_name": u["name"]} for u in USERS.values()],
            "view": t.get("entries", []), "unread_entries": [301] if t.get("unread_count") else [],
            "entry_ratings": {str(k): v for k, v in RATINGS.items()}}


@app.post("/api/v1/{kind}/{cid}/discussion_topics/{tid}/entries")
@app.post("/api/v1/{kind}/{cid}/discussion_topics/{tid}/entries/{eid}/replies")
async def post_entry(kind: str, cid: int, tid: int, request: Request, eid: int | None = None):
    f = await form(request)
    att = f.get("attachment")
    e = {"id": next(ids), "user_id": ME, "message": f["message"], "created_at": iso(), "replies": [], "rating_sum": 0}
    if att and getattr(att, "filename", None):
        e["attachment"] = {"id": 998, "display_name": att.filename}
    entries = TOPICS[tid].setdefault("entries", [])
    (find_entry(entries, eid)["replies"] if eid else entries).append(e)
    return e


@app.put("/api/v1/{kind}/{cid}/discussion_topics/{tid}/entries/{eid}")
async def edit_entry(kind: str, cid: int, tid: int, eid: int, request: Request):
    e = find_entry(TOPICS[tid]["entries"], eid)
    if e["user_id"] != ME:
        return err(401, "unauthorized")
    e["message"] = (await form(request))["message"]
    e["updated_at"] = iso()
    return e


@app.delete("/api/v1/{kind}/{cid}/discussion_topics/{tid}/entries/{eid}")
def delete_entry(kind: str, cid: int, tid: int, eid: int):
    e = find_entry(TOPICS[tid]["entries"], eid)
    e.update({"deleted": True, "message": None})
    return Response(status_code=204)


@app.post("/api/v1/{kind}/{cid}/discussion_topics/{tid}/entries/{eid}/rating")
async def rate(kind: str, cid: int, tid: int, eid: int, request: Request):
    r = int((await form(request))["rating"])
    e = find_entry(TOPICS[tid]["entries"], eid)
    e["rating_sum"] = (e.get("rating_sum") or 0) + (r - RATINGS.get(eid, 0))
    RATINGS[eid] = r
    return Response(status_code=204)


@app.put("/api/v1/{kind}/{cid}/discussion_topics/{tid}/read_all")
def read_all(kind: str, cid: int, tid: int):
    TOPICS[tid]["read_state"] = "read"
    TOPICS[tid]["unread_count"] = 0
    return Response(status_code=204)


@app.get("/api/v1/announcements")
def announcements(request: Request):
    codes = request.query_params.getlist("context_codes[]")
    return [topic_json(t) | {"context_code": t["ctx"].replace("courses/", "course_")} for t in TOPICS.values()
            if t["is_announcement"] and t["ctx"].replace("courses/", "course_") in codes]


# ---------- inbox ----------

CONVS = {
    601: {"id": 601, "subject": "Office hours question", "workflow_state": "unread", "context_code": "course_101",
          "context_name": "Calculus II", "participants": [USERS[9], USERS[7]],
          "messages": [{"id": 1, "author_id": 7, "created_at": iso(-1), "body": "Sure, come by Thursday.\nBring your notes.", "attachments": []},
                       {"id": 2, "author_id": 9, "created_at": iso(-2), "body": "Can I come to office hours?", "attachments": []}]},
    602: {"id": 602, "subject": "Group project", "workflow_state": "read", "context_code": "group_401",
          "context_name": "Study Group A", "participants": [USERS[9], USERS[8], USERS[6]],
          "messages": [{"id": 3, "author_id": 8, "created_at": iso(-3), "body": "Meeting at 5?",
                        "attachments": [{"id": 503, "display_name": "agenda.txt"}]}]},
}


def conv_summary(c):
    last = c["messages"][0]
    return {k: v for k, v in c.items() if k != "messages"} | {
        "last_message": last["body"], "last_message_at": last["created_at"], "message_count": len(c["messages"]),
        "has_attachments": any(m["attachments"] for m in c["messages"])}


@app.get("/api/v1/conversations")
def conversations(request: Request):
    scope = request.query_params.get("scope", "inbox")
    pick = {"inbox": lambda c: c["workflow_state"] != "archived", "unread": lambda c: c["workflow_state"] == "unread",
            "archived": lambda c: c["workflow_state"] == "archived",
            "sent": lambda c: any(m["author_id"] == ME for m in c["messages"])}[scope]
    return page(request, [conv_summary(c) for c in CONVS.values() if pick(c)])


@app.get("/api/v1/conversations/unread_count")
def unread_count():
    return {"unread_count": str(sum(c["workflow_state"] == "unread" for c in CONVS.values()))}


@app.get("/api/v1/conversations/{cid}")
def conversation(cid: int, request: Request):
    c = CONVS[cid]
    if request.query_params.get("auto_mark_as_read", "true") != "false":
        c["workflow_state"] = "read"
    return c


def _attachments(f):
    return [{"id": int(i), "display_name": UPLOADS[int(i)][0]} for i in f.getlist("attachment_ids[]")]


@app.post("/api/v1/conversations")
async def new_conversation(request: Request):
    f = await form(request)
    recips = f.getlist("recipients[]")
    people = [USERS[int(r)] for r in recips if r.isdigit() and int(r) in USERS]
    msg = {"id": next(ids), "author_id": ME, "created_at": iso(), "body": f["body"], "attachments": _attachments(f)}
    made = []
    targets = [[p] for p in people] if f.get("group_conversation") == "false" else [people]
    for t in targets:
        cid = next(ids)
        CONVS[cid] = {"id": cid, "subject": f.get("subject") or "", "workflow_state": "read", "context_code": f.get("context_code"),
                      "context_name": "", "participants": [USERS[ME], *t], "messages": [dict(msg)]}
        made.append(conv_summary(CONVS[cid]))
    return made


@app.post("/api/v1/conversations/{cid}/add_message")
async def add_message(cid: int, request: Request):
    f = await form(request)
    CONVS[cid]["messages"].insert(0, {"id": next(ids), "author_id": ME, "created_at": iso(), "body": f["body"], "attachments": _attachments(f)})
    return CONVS[cid]


@app.put("/api/v1/conversations/{cid}")
async def update_conversation(cid: int, request: Request):
    CONVS[cid]["workflow_state"] = (await form(request))["conversation[workflow_state]"]
    return conv_summary(CONVS[cid])


@app.get("/api/v1/search/recipients")
def recipients(request: Request):
    term = request.query_params.get("search", "").lower()
    ctx = request.query_params.get("context")
    out = []
    if ctx and not term:
        out.append({"id": f"{ctx}_teachers", "name": "Teachers", "type": "context", "user_count": 1})
    out += [{"id": str(u["id"]), "name": u["name"], "type": "user"} for u in USERS.values()
            if u["id"] != ME and term in u["name"].lower()]
    return out


# ---------- classic quizzes ----------

QUIZZES = {
    77: {"id": 77, "title": "Quiz 4", "due_at": ASSIGNMENTS[2]["due_at"], "points_possible": 10, "time_limit": 30,
         "allowed_attempts": 2, "question_count": 9, "quiz_type": "assignment", "assignment_id": 2,
         "description": "<p>Covers sections 11.1-11.3.</p>", "html_url": f"{BASE}/courses/101/quizzes/77"},
    78: {"id": 78, "title": "Midterm (proctored)", "due_at": ASSIGNMENTS[7]["due_at"], "points_possible": 100, "time_limit": 90,
         "allowed_attempts": 1, "question_count": 30, "require_lockdown_browser": True,
         "html_url": f"{BASE}/courses/101/quizzes/78"},
}
QUESTIONS = [
    {"id": 1, "position": 1, "question_type": "multiple_choice_question", "question_text": "<p>Does the series ∑ 1/n² converge?</p>",
     "answers": [{"id": 11, "text": "Yes"}, {"id": 12, "text": "No"}]},
    {"id": 2, "position": 2, "question_type": "true_false_question", "question_text": "<p>The harmonic series converges.</p>",
     "answers": [{"id": 21, "text": "True"}, {"id": 22, "text": "False"}]},
    {"id": 3, "position": 3, "question_type": "multiple_answers_question", "question_text": "<p>Pick every convergence test.</p>",
     "answers": [{"id": 31, "text": "Ratio test"}, {"id": 32, "text": "Root test"}, {"id": 33, "text": "Chain rule"}]},
    {"id": 4, "position": 4, "question_type": "short_answer_question", "question_text": "<p>Name the test that compares to an integral.</p>", "answers": []},
    {"id": 5, "position": 5, "question_type": "numerical_question", "question_text": "<p>What is ∑ (1/2)ⁿ from n=1 to ∞?</p>", "answers": []},
    {"id": 6, "position": 6, "question_type": "fill_in_multiple_blanks_question",
     "question_text": "<p>A geometric series converges when |r| [cond] [one].</p>", "answers": []},
    {"id": 7, "position": 7, "question_type": "multiple_dropdowns_question", "question_text": "<p>∑ 1/n is [kind].</p>",
     "answers": [{"id": 71, "text": "convergent", "blank_id": "kind"}, {"id": 72, "text": "divergent", "blank_id": "kind"}]},
    {"id": 8, "position": 8, "question_type": "matching_question", "question_text": "<p>Match each series to its behaviour.</p>",
     "answers": [{"id": 81, "text": "∑ 1/n"}, {"id": 82, "text": "∑ 1/n²"}],
     "matches": [{"match_id": 801, "text": "diverges"}, {"match_id": 802, "text": "converges"}]},
    {"id": 10, "position": 9, "question_type": "text_only_question", "question_text": "<p><b>Part 2.</b> Show your reasoning.</p>"},
    {"id": 9, "position": 10, "question_type": "essay_question", "question_text": "<p>Explain the ratio test.</p>", "answers": []},
]
QSUBS = {}      # quiz id -> list of quiz submissions
ANSWERS = {}    # sub id -> {question id: answer}
FLAGS = {}


def new_qsub(qid):
    q = QUIZZES[qid]
    sid = next(ids)
    s = {"id": sid, "quiz_id": qid, "attempt": len(QSUBS.get(qid, [])) + 1, "workflow_state": "untaken",
         "validation_token": secrets.token_hex(8), "started_at": iso(),
         "end_at": iso(minutes=q["time_limit"]) if q.get("time_limit") else None, "quiz_points_possible": q["points_possible"]}
    QSUBS.setdefault(qid, []).append(s)
    return s


def public(s):
    return {k: v for k, v in s.items() if k != "validation_token"}


@app.get("/api/v1/courses/{cid}/quizzes")
def quizzes(cid: int):
    return list(QUIZZES.values()) if cid == 101 else []


@app.get("/api/v1/courses/{cid}/quizzes/{qid}")
def quiz(cid: int, qid: int):
    return QUIZZES[qid]


@app.get("/api/v1/courses/{cid}/quizzes/{qid}/submissions")
def quiz_subs(cid: int, qid: int):
    # Real Canvas returns the token to the owner while the attempt is in progress.
    return {"quiz_submissions": [s if s["workflow_state"] == "untaken" else public(s) for s in QSUBS.get(qid, [])]}


@app.post("/api/v1/courses/{cid}/quizzes/{qid}/submissions")
def start_quiz(cid: int, qid: int):
    if any(s["workflow_state"] == "untaken" for s in QSUBS.get(qid, [])):
        return err(409, "a quiz attempt is already in progress")
    done = [s for s in QSUBS.get(qid, []) if s["workflow_state"] == "complete"]
    if len(done) >= QUIZZES[qid]["allowed_attempts"]:
        return err(403, "no more attempts")
    return {"quiz_submissions": [new_qsub(qid)]}


def find_qsub(sid):
    return next(s for subs in QSUBS.values() for s in subs if s["id"] == sid)


@app.get("/api/v1/quiz_submissions/{sid}/questions")
def get_questions(sid: int):
    a = ANSWERS.get(sid, {})
    return {"quiz_submission_questions": [q | {"answer": a.get(q["id"]), "flagged": FLAGS.get((sid, q["id"]), False)} for q in QUESTIONS]}


@app.post("/api/v1/quiz_submissions/{sid}/questions")
async def answer(sid: int, request: Request):
    body = await request.json()
    s = find_qsub(sid)
    if body.get("validation_token") != s["validation_token"] or s["workflow_state"] != "untaken":
        return err(403, "invalid token or attempt is over")
    for q in body["quiz_questions"]:
        ANSWERS.setdefault(sid, {})[int(q["id"])] = q["answer"]
    return {"quiz_submission_questions": []}


@app.put("/api/v1/quiz_submissions/{sid}/questions/{qid}/{action}")
async def flag(sid: int, qid: int, action: str, request: Request):
    FLAGS[(sid, qid)] = action == "flag"
    return Response(status_code=204)


@app.post("/api/v1/courses/{cid}/quizzes/{qid}/submissions/{sid}/complete")
async def complete(cid: int, qid: int, sid: int, request: Request):
    body = await request.json()
    s = find_qsub(sid)
    if body.get("validation_token") != s["validation_token"]:
        return err(403, "invalid token")
    a = ANSWERS.get(sid, {})
    score = (a.get(1) == 11) + (a.get(2) == 22) + (sorted(a.get(3) or []) == [31, 32])
    s.update({"workflow_state": "pending_review" if a.get(9) else "complete", "finished_at": iso(), "score": score,
              "kept_score": score, "attempts_left": QUIZZES[qid]["allowed_attempts"] - s["attempt"]})
    return {"quiz_submissions": [public(s)]}


# ---------- files ----------

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
    if fid == 901:
        return [{"id": 501, "display_name": "lecture9.pdf", "size": 48213, "updated_at": iso(-2)}]
    if fid == 950:
        return [{"id": 504, "display_name": "group-plan.txt", "size": 300, "updated_at": iso(-1)}]
    return [{"id": 503, "display_name": "syllabus.txt", "size": 1200, "updated_at": iso(-30)}]


FILES = {501: ("lecture9.png", "image/png"), 502: ("ps6.txt", "text/plain"), 503: ("syllabus.txt", "text/plain"),
         504: ("group-plan.txt", "text/plain")}


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
        return Response((Path(__file__).parent.parent / "app/static/icons/icon-192.png").read_bytes(), media_type="image/png")
    return Response(f"Contents of file {fid}\n", media_type="text/plain")
