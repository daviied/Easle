import { load, cached, prefetch, me, post, upload, clearCache, ApiError } from './api.js';
import {
  html, raw, esc, sanitize, textOf, textToHtml, route as canvasRoute, setCanvasUrl, canvasUrl,
  when, dayLabel, time, ago, isoDay, num, bytes,
} from './html.js';

const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');

const COURSES = 'courses?enrollment_state=active&include[]=total_scores&include[]=term&include[]=favorites';
const COLORS = 'users/self/colors';
const groupsPath = (cid) => `courses/${cid}/assignment_groups?include[]=assignments&include[]=submission`;

const state = { courses: [], colors: {}, me: null };

// ---------- small UI helpers ----------

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

const course = (cid) => state.courses.find((c) => String(c.id) === String(cid));
const courseName = (cid) => course(cid)?.name || 'Course';
const color = (cid) => state.colors[`course_${cid}`] || '#6366f1';
const dot = (cid) => html`<span class="dot" style="background:${color(cid)}"></span>`;
const ext = raw('<span class="ext" aria-label="opens Canvas">↗</span>');

function link(url, label, cls = '') {
  const r = canvasRoute(url);
  if (!r) return html`<span class="${cls}">${label}</span>`;
  return r.external
    ? html`<a class="${cls}" href="${r.href}" target="_blank" rel="noopener">${label} ${ext}</a>`
    : html`<a class="${cls}" href="${r.href}">${label}</a>`;
}

const empty = (msg) => html`<div class="empty">${msg}</div>`;

function enrollment(c) {
  return (c?.enrollments || []).find((e) => e.type === 'student' || e.type === 'StudentEnrollment') || c?.enrollments?.[0];
}

function gradeText(c) {
  const e = enrollment(c);
  if (!e || c.hide_final_grades) return '';
  const score = e.computed_current_score;
  if (score == null) return e.computed_current_grade || '';
  return `${num(score)}%${e.computed_current_grade ? ' · ' + e.computed_current_grade : ''}`;
}

function badges(sub, a = {}) {
  const out = [];
  if (!sub) return out;
  if (sub.excused) out.push(html`<span class="badge">Excused</span>`);
  else if (sub.missing) out.push(html`<span class="badge red">Missing</span>`);
  if (sub.late) out.push(html`<span class="badge orange">Late</span>`);
  if (sub.graded || sub.workflow_state === 'graded') {
    out.push(sub.score != null && a.points_possible
      ? html`<span class="badge green">${num(sub.score)}/${num(a.points_possible)}</span>`
      : html`<span class="badge green">Graded</span>`);
  } else if (sub.submitted || sub.submitted_at || sub.workflow_state === 'submitted' || sub.workflow_state === 'pending_review') {
    out.push(html`<span class="badge blue">Submitted</span>`);
  }
  if (sub.has_feedback) out.push(html`<span class="badge">Feedback</span>`);
  return out;
}

const isQuiz = (a) => a.is_quiz_assignment || a.is_quiz_lti_assignment || a.quiz_id
  || (a.submission_types || []).includes('online_quiz');

// ---------- screens ----------
// Each screen: data(params) -> {key: path | {path, optional}}, render(d, params), optional after(el, d, params).

const screens = {};

screens.dashboard = {
  title: () => 'Home',
  data: () => ({
    items: `planner/items?start_date=${isoDay(-14)}&end_date=${isoDay(45)}`,
    missing: { path: 'users/self/missing_submissions?filter[]=submittable', optional: true },
    courses: COURSES,
  }),
  render({ items, missing }) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const missingIds = new Set((missing || []).map((m) => m.id));
    const visible = items.filter((i) => i.plannable_type !== 'announcement');
    const upcoming = visible.filter((i) => new Date(i.plannable_date) >= today);
    const past = visible.filter((i) => new Date(i.plannable_date) < today && !(i.plannable_type === 'assignment' && missingIds.has(i.plannable_id)));
    const byDay = new Map();
    for (const i of upcoming) {
      const k = dayLabel(i.plannable_date);
      byDay.has(k) || byDay.set(k, []);
      byDay.get(k).push(i);
    }
    const news = items.filter((i) => i.plannable_type === 'announcement').slice(-5).reverse();
    return html`
      <div class="dash">
        <div class="dash-main">
          ${missing?.length ? html`
            <section class="card warn">
              <h2>Missing <span class="count">${missing.length}</span></h2>
              ${missing.sort((a, b) => new Date(b.due_at) - new Date(a.due_at)).map((m) => html`
                <a class="row" href="#/c/${m.course_id}/a/${m.id}">
                  ${dot(m.course_id)}
                  <div class="grow"><div class="t">${m.name}</div>
                  <div class="sub">${courseName(m.course_id)} · was due ${when(m.due_at)}</div></div>
                  ${m.points_possible ? html`<span class="pts">${num(m.points_possible)} pts</span>` : ''}
                </a>`)}
            </section>` : ''}
          <section>
            <h2>Upcoming</h2>
            ${byDay.size ? [...byDay].map(([day, list]) => html`
              <div class="day"><h3>${day}</h3><div class="card list">${list.map(plannerRow)}</div></div>`)
              : empty('Nothing due in the next 6 weeks.')}
          </section>
          ${past.length ? html`
            <details class="past"><summary>Past two weeks (${past.length})</summary>
              <div class="card list">${past.reverse().map(plannerRow)}</div></details>` : ''}
        </div>
        <aside class="dash-side">
          <section><h2>Courses</h2>${courseCards()}</section>
          ${news.length ? html`<section><h2>Recent announcements</h2><div class="card list">
            ${news.map((n) => html`<a class="row" href="${canvasRoute(n.html_url)?.href}">${dot(n.course_id)}
              <div class="grow"><div class="t">${n.plannable.title}</div><div class="sub">${n.context_name} · ${ago(n.plannable_date)}</div></div></a>`)}
            </div></section>` : ''}
        </aside>
      </div>`;
  },
};

function plannerRow(i) {
  const s = i.submissions || {};
  const done = i.planner_override?.marked_complete ?? (s.submitted || s.excused || false);
  const p = i.plannable || {};
  const r = canvasRoute(i.html_url);
  const quiz = i.plannable_type === 'quiz';
  const due = p.due_at || p.todo_date || i.plannable_date;
  const inner = html`
    <div class="grow"><div class="t">${p.title || p.name}${quiz ? html` <span class="badge purple">Quiz</span>` : ''}</div>
    <div class="sub">${i.context_name || ''}${due ? ' · ' + time(due) : ''}${p.points_possible ? ` · ${num(p.points_possible)} pts` : ''}</div></div>
    <div class="badges">${badges(s, p)}</div>`;
  return html`
    <div class="row planner ${done ? 'done' : ''}">
      <button class="check" data-act="done" aria-label="Mark ${done ? 'not done' : 'done'}"
        data-type="${i.plannable_type}" data-id="${i.plannable_id}" data-override="${i.planner_override?.id ?? ''}" data-done="${done ? 1 : ''}">
        ${done ? '✓' : ''}</button>
      ${dot(i.course_id)}
      ${r ? (r.external
        ? html`<a class="rowlink" href="${r.href}" target="_blank" rel="noopener">${inner}${ext}</a>`
        : html`<a class="rowlink" href="${r.href}">${inner}</a>`)
        : html`<div class="rowlink">${inner}</div>`}
    </div>`;
}

function courseCards() {
  if (!state.courses.length) return empty('No active courses.');
  return html`<div class="course-cards">${state.courses.map((c) => html`
    <a class="course-card" href="#/c/${c.id}" style="--c:${color(c.id)}">
      <div class="cc-name">${c.name}</div>
      <div class="cc-sub">${c.course_code}${c.term?.name && !/default/i.test(c.term.name) ? ' · ' + c.term.name : ''}</div>
      ${gradeText(c) ? html`<div class="cc-grade">${gradeText(c)}</div>` : ''}
    </a>`)}</div>`;
}

screens.courses = {
  title: () => 'Courses',
  data: () => ({ courses: COURSES }),
  render: () => courseCards(),
};

screens.grades = {
  title: () => 'Grades',
  data: () => ({ courses: COURSES }),
  render: () => html`<div class="card list">${state.courses.map((c) => html`
    <a class="row" href="#/c/${c.id}/grades">${dot(c.id)}
      <div class="grow"><div class="t">${c.name}</div><div class="sub">${c.course_code}</div></div>
      <span class="grade">${gradeText(c) || (c.hide_final_grades ? 'Hidden' : '–')}</span></a>`)}</div>`,
};

screens.announcements = {
  title: () => 'Announcements',
  data: () => ({ list: 'x/announcements' }),
  render: ({ list }) => announcementList(list),
};

function announcementList(list) {
  if (!list?.length) return empty('No announcements.');
  return html`<div class="card list">${list.map((a) => {
    const cid = a.context_code?.replace('course_', '') || a.course_id;
    return html`<a class="row ${a.read_state === 'unread' ? 'unread' : ''}" href="#/c/${cid}/d/${a.id}">${dot(cid)}
      <div class="grow"><div class="t">${a.title}</div>
      <div class="sub">${courseName(cid)} · ${a.author?.display_name || a.user_name || ''} · ${ago(a.posted_at)}</div>
      <div class="preview">${textOf(a.message)}</div></div></a>`;
  })}</div>`;
}

// ----- course screens -----

const TABS = [
  ['modules', 'Modules'], ['assignments', 'Assignments'], ['announcements', 'Announcements'],
  ['discussions', 'Discussions'], ['pages', 'Pages'], ['files', 'Files'], ['quizzes', 'Quizzes'],
  ['grades', 'Grades'], ['syllabus', 'Syllabus'],
];

function courseHeader(cid, active, tabs) {
  const visible = tabs ? new Set(tabs.filter((t) => !t.hidden).map((t) => t.id)) : null;
  return html`
    <div class="course-head" style="--c:${color(cid)}">
      <div class="course-title"><span class="bar"></span><h1>${courseName(cid)}</h1>
        <a class="btn ghost small" href="${canvasUrl('/courses/' + cid)}" target="_blank" rel="noopener">Canvas ${ext}</a></div>
      <nav class="tabs">${TABS.filter(([id]) => !visible || visible.has(id) || id === 'grades')
        .map(([id, label]) => html`<a href="#/c/${cid}/${id}" class="${id === active ? 'on' : ''}">${label}</a>`)}</nav>
    </div>`;
}

screens.courseHome = {
  data: () => ({}),
  render: () => html`<div class="skeleton"></div>`,
  after(_el, _d, { cid }) {
    const v = course(cid)?.default_view;
    const tab = { assignments: 'assignments', wiki: 'front', syllabus: 'syllabus', feed: 'announcements' }[v] || 'modules';
    history.replaceState(null, '', `#/c/${cid}/${tab}`);
    render();
  },
};

screens.modules = {
  tab: 'modules',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ modules: `courses/${cid}/modules?include[]=items&include[]=content_details` }),
  render({ modules }, { cid }) {
    if (!modules.length) return empty('This course has no modules.');
    return html`${modules.map((m) => html`
      <details class="module card" open>
        <summary><span class="mname">${m.name}</span>
          ${m.state === 'locked' ? html`<span class="badge">Locked${m.unlock_at ? ' until ' + when(m.unlock_at) : ''}</span>` : ''}
          ${m.state === 'completed' ? html`<span class="badge green">Complete</span>` : ''}</summary>
        <div class="list">${m.items ? m.items.map((it) => moduleItem(cid, m, it))
          : html`<div class="row muted" data-lazy-module="${m.id}">Loading ${m.items_count} items…</div>`}</div>
      </details>`)}`;
  },
  async after(el, _d, { cid }) {
    for (const ph of el.querySelectorAll('[data-lazy-module]')) {
      const mid = ph.dataset.lazyModule;
      const path = `courses/${cid}/modules/${mid}/items?include[]=content_details`;
      const items = (await cached(path)) || (await load(path).catch(() => null));
      if (items && ph.isConnected) ph.outerHTML = items.map((it) => moduleItem(cid, { id: mid }, it).s).join('');
    }
  },
};

const ICONS = { Assignment: '📝', Quiz: '❓', Discussion: '💬', Page: '📄', File: '📎', ExternalUrl: '🔗', ExternalTool: '🧩' };

function moduleItem(cid, m, it) {
  if (it.type === 'SubHeader') return html`<div class="subheader" style="padding-left:${12 + it.indent * 18}px">${it.title}</div>`;
  const cd = it.content_details || {};
  const req = it.completion_requirement;
  const markRead = req && req.type === 'must_view' && !req.completed ? `${cid}/${m.id}/${it.id}` : '';
  let href, external = false;
  switch (it.type) {
    case 'Assignment': href = `#/c/${cid}/a/${it.content_id}`; break;
    case 'Discussion': href = `#/c/${cid}/d/${it.content_id}`; break;
    case 'Page': href = `#/c/${cid}/p/${it.page_url}`; break;
    case 'File': href = `/api/file/${it.content_id}?inline=1`; external = true; break;
    case 'ExternalUrl': href = it.external_url; external = true; break;
    default: href = it.html_url; external = true; // quizzes and external tools open in Canvas
  }
  const locked = cd.locked_for_user;
  return html`
    <a class="row mitem ${locked ? 'locked' : ''}" style="padding-left:${12 + it.indent * 18}px" href="${href}"
      ${raw(external ? 'target="_blank" rel="noopener"' : '')} ${raw(markRead ? `data-markread="${esc(markRead)}"` : '')}>
      <span class="ico">${ICONS[it.type] || '•'}</span>
      <div class="grow"><div class="t">${it.title}</div>
        <div class="sub">${[cd.due_at && 'Due ' + when(cd.due_at), cd.points_possible && num(cd.points_possible) + ' pts', locked && 'Locked'].filter(Boolean).join(' · ')}</div></div>
      ${req ? html`<span class="req ${req.completed ? 'ok' : ''}" title="${req.type.replace(/_/g, ' ')}">${req.completed ? '✓' : '○'}</span>` : ''}
      ${external ? ext : ''}
    </a>`;
}

screens.assignments = {
  tab: 'assignments',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ groups: groupsPath(cid) }),
  render({ groups }, { cid }) {
    const all = groups.flatMap((g) => g.assignments || []);
    if (!all.length) return empty('No assignments.');
    const now = Date.now();
    const upcoming = all.filter((a) => a.due_at && new Date(a.due_at) >= now).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
    const undated = all.filter((a) => !a.due_at);
    const past = all.filter((a) => a.due_at && new Date(a.due_at) < now).sort((a, b) => new Date(b.due_at) - new Date(a.due_at));
    const section = (title, list) => list.length ? html`<h2>${title}</h2><div class="card list">${list.map((a) => assignmentRow(cid, a))}</div>` : '';
    return html`${section('Upcoming', upcoming)}${section('No due date', undated)}${section('Past', past)}`;
  },
};

function assignmentRow(cid, a) {
  return html`
    <a class="row" href="#/c/${cid}/a/${a.id}">
      <span class="ico">${isQuiz(a) ? '❓' : '📝'}</span>
      <div class="grow"><div class="t">${a.name}</div>
        <div class="sub">${a.due_at ? 'Due ' + when(a.due_at) : 'No due date'}${a.points_possible ? ` · ${num(a.points_possible)} pts` : ''}</div></div>
      <div class="badges">${isQuiz(a) ? html`<span class="badge purple">Quiz</span>` : ''}${badges(a.submission, a)}</div>
    </a>`;
}

const SUBMITTABLE = { online_upload: 'File upload', online_text_entry: 'Text', online_url: 'Website URL' };

screens.assignment = {
  tab: 'assignments',
  title: (d) => d.a.name,
  data: ({ cid, aid }) => ({
    a: `courses/${cid}/assignments/${aid}`,
    s: { path: `courses/${cid}/assignments/${aid}/submissions/self?include[]=submission_comments&include[]=rubric_assessment`, optional: true },
  }),
  render({ a, s }, { cid }) {
    const types = a.submission_types || [];
    const quiz = isQuiz(a);
    const canHere = types.filter((t) => SUBMITTABLE[t]);
    const attemptsLeft = a.allowed_attempts > 0 ? a.allowed_attempts - (s?.attempt || 0) : Infinity;
    const submitted = s && (s.submitted_at || s.workflow_state === 'submitted' || s.workflow_state === 'graded');
    const canSubmit = !quiz && canHere.length && !a.locked_for_user && attemptsLeft > 0;
    const other = types.filter((t) => !SUBMITTABLE[t] && !['none', 'not_graded', 'on_paper', 'online_quiz'].includes(t));
    return html`
      <article class="detail">
        <h1>${a.name}</h1>
        <div class="meta">
          <span><b>Due</b> ${a.due_at ? when(a.due_at) : 'No due date'}</span>
          <span><b>Points</b> ${num(a.points_possible)}</span>
          ${a.lock_at ? html`<span><b>Available until</b> ${when(a.lock_at)}</span>` : ''}
          ${a.allowed_attempts > 0 ? html`<span><b>Attempts</b> ${s?.attempt || 0}/${a.allowed_attempts}</span>` : ''}
          <a href="${a.html_url}" target="_blank" rel="noopener">Open in Canvas ${ext}</a>
        </div>
        ${quiz ? html`
          <div class="card callout quiz">
            <div><b>This is a quiz.</b> Quizzes are taken on the official Canvas site.</div>
            <a class="btn primary" href="${a.html_url}" target="_blank" rel="noopener">Take quiz on Canvas ${ext}</a>
          </div>` : ''}
        ${a.locked_for_user ? html`<div class="card callout">${a.lock_explanation ? sanitize(a.lock_explanation) : 'This assignment is locked.'}</div>` : ''}
        ${s ? submissionCard(a, s) : ''}
        ${a.description ? html`<section class="card prose">${sanitize(a.description)}</section>` : ''}
        ${a.rubric ? rubric(a, s) : ''}
        ${canSubmit ? submitForm(cid, a, canHere, submitted) : ''}
        ${!quiz && other.length ? html`<div class="card callout">
          <div>This assignment takes a ${other.map((t) => t.replace(/_/g, ' ')).join(' / ')} submission, which you can do on Canvas.</div>
          <a class="btn" href="${a.html_url}" target="_blank" rel="noopener">Submit on Canvas ${ext}</a></div>` : ''}
        ${s ? comments(cid, a, s) : ''}
      </article>`;
  },
};

function submissionCard(a, s) {
  const has = s.submitted_at || s.workflow_state === 'graded' || s.excused;
  if (!has && !s.missing) return '';
  return html`
    <section class="card sub-card">
      <div class="sub-head">
        <h2>Your submission</h2>
        <div class="badges">${badges(s, a)}</div>
      </div>
      ${s.submitted_at ? html`<div class="muted">Submitted ${when(s.submitted_at)}${s.attempt ? ` · attempt ${s.attempt}` : ''}</div>` : ''}
      ${s.grade != null && s.workflow_state === 'graded' ? html`<div class="big-grade">${num(s.score)} <small>/ ${num(a.points_possible)}</small>${s.grade && s.grade !== String(s.score) ? html` <span class="muted">(${s.grade})</span>` : ''}</div>` : ''}
      ${(s.attachments || []).map((f) => html`<a class="file" href="/api/file/${f.id}?inline=1" target="_blank" rel="noopener">📎 ${f.display_name}</a>`)}
      ${s.submission_type === 'online_url' && s.url ? html`<a class="file" href="${s.url}" target="_blank" rel="noopener">🔗 ${s.url}</a>` : ''}
      ${s.submission_type === 'online_text_entry' && s.body ? html`<details><summary>Show text</summary><div class="prose">${sanitize(s.body)}</div></details>` : ''}
    </section>`;
}

function rubric(a, s) {
  const ra = s?.rubric_assessment || {};
  return html`
    <section class="card"><h2>Rubric</h2>
      <table class="rubric"><tbody>${a.rubric.map((c) => html`
        <tr><td><b>${c.description}</b>${c.long_description ? html`<div class="muted">${c.long_description}</div>` : ''}
          ${ra[c.id]?.comments ? html`<div class="rcomment">${ra[c.id].comments}</div>` : ''}</td>
        <td class="rpts">${ra[c.id]?.points != null ? num(ra[c.id].points) + ' / ' : ''}${num(c.points)}</td></tr>`)}
      </tbody></table></section>`;
}

function submitForm(cid, a, types, resubmit) {
  const accept = (a.allowed_extensions || []).map((e) => '.' + e).join(',');
  return html`
    <form class="card submit" data-form="submit" data-cid="${cid}" data-aid="${a.id}" data-resubmit="${resubmit ? 1 : ''}">
      <h2>${resubmit ? 'Resubmit' : 'Submit assignment'}</h2>
      ${types.length > 1 ? html`<div class="seg">${types.map((t, i) => html`
        <label><input type="radio" name="type" value="${t}" ${raw(i === 0 ? 'checked' : '')}><span>${SUBMITTABLE[t]}</span></label>`)}</div>`
        : html`<input type="hidden" name="type" value="${types[0]}">`}
      ${types.includes('online_upload') ? html`<div class="pane" data-pane="online_upload">
        <label class="drop"><input type="file" name="files" multiple ${raw(accept ? `accept="${esc(accept)}"` : '')}>
        <span>Choose files${accept ? ` (${a.allowed_extensions.join(', ')})` : ''} or drop them here</span></label>
        <ul class="picked"></ul></div>` : ''}
      ${types.includes('online_text_entry') ? html`<div class="pane" data-pane="online_text_entry">
        <textarea name="body" rows="10" placeholder="Type your submission…"></textarea></div>` : ''}
      ${types.includes('online_url') ? html`<div class="pane" data-pane="online_url">
        <input type="url" name="url" placeholder="https://…"></div>` : ''}
      <input type="text" name="comment" placeholder="Comment (optional)">
      <div class="progress" hidden><div></div></div>
      <button class="btn primary" type="submit">${resubmit ? 'Resubmit' : 'Submit'}</button>
    </form>`;
}

function comments(cid, a, s) {
  const list = s.submission_comments || [];
  return html`
    <section class="card"><h2>Comments</h2>
      ${list.length ? list.map((c) => html`
        <div class="comment"><div class="cmeta"><b>${c.author_name}</b> · ${ago(c.created_at)}</div>
          <div>${c.comment}</div>
          ${(c.attachments || []).map((f) => html`<a class="file" href="/api/file/${f.id}?inline=1" target="_blank" rel="noopener">📎 ${f.display_name}</a>`)}
        </div>`) : html`<p class="muted">No comments yet.</p>`}
      <form class="inline-form" data-form="comment" data-cid="${cid}" data-aid="${a.id}">
        <input type="text" name="text" placeholder="Add a comment…" required><button class="btn">Send</button>
      </form>
    </section>`;
}

screens.courseAnnouncements = {
  tab: 'announcements',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ list: `courses/${cid}/discussion_topics?only_announcements=true` }),
  render: ({ list }, { cid }) => announcementList(list.map((a) => ({ ...a, course_id: cid }))),
};

screens.discussions = {
  tab: 'discussions',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ list: `courses/${cid}/discussion_topics?order_by=recent_activity` }),
  render({ list }, { cid }) {
    if (!list.length) return empty('No discussions.');
    const sorted = [...list].sort((a, b) => (b.pinned - a.pinned));
    return html`<div class="card list">${sorted.map((t) => html`
      <a class="row ${t.read_state === 'unread' || t.unread_count ? 'unread' : ''}" href="#/c/${cid}/d/${t.id}">
        <span class="ico">${t.pinned ? '📌' : '💬'}</span>
        <div class="grow"><div class="t">${t.title}</div>
          <div class="sub">${t.discussion_subentry_count} replies${t.last_reply_at ? ' · last ' + ago(t.last_reply_at) : ''}${t.assignment ? ' · graded' : ''}${t.locked ? ' · closed' : ''}</div></div>
        ${t.unread_count ? html`<span class="badge blue">${t.unread_count} new</span>` : ''}
      </a>`)}</div>`;
  },
};

screens.discussion = {
  tab: 'discussions',
  title: (d) => d.t.title,
  data: ({ cid, did }) => ({
    t: `courses/${cid}/discussion_topics/${did}`,
    v: { path: `courses/${cid}/discussion_topics/${did}/view?include_new_entries=1`, optional: true },
  }),
  render({ t, v }, { cid, did }) {
    const people = new Map((v?.participants || []).map((p) => [p.id, p]));
    const unread = new Set(v?.unread_entries || []);
    const entry = (e) => {
      const p = people.get(e.user_id) || {};
      return html`
        <div class="entry ${unread.has(e.id) ? 'unread' : ''}">
          <div class="emeta">${p.avatar_image_url ? html`<img class="avatar" src="${p.avatar_image_url}" alt="">` : ''}
            <b>${p.display_name || e.user_name || 'Someone'}</b> · ${ago(e.created_at)}</div>
          ${e.deleted ? html`<div class="muted">This reply was deleted.</div>` : html`<div class="prose">${sanitize(e.message)}</div>`}
          ${canReply && !e.deleted ? html`<button class="link-btn" data-act="reply-toggle" data-id="${e.id}">Reply</button>
            <form class="inline-form reply" data-form="reply" data-cid="${cid}" data-did="${did}" data-parent="${e.id}" hidden>
              <textarea name="message" rows="3" placeholder="Write a reply…" required></textarea><button class="btn">Post</button></form>` : ''}
          ${e.replies?.length ? html`<div class="replies">${e.replies.map(entry)}</div>` : ''}
        </div>`;
    };
    const canReply = !t.locked && !t.locked_for_user && (t.permissions?.reply ?? true);
    return html`
      <article class="detail">
        <h1>${t.title}</h1>
        <div class="meta"><span>${t.author?.display_name || t.user_name || ''}</span><span>${when(t.posted_at)}</span>
          ${t.assignment ? html`<a href="#/c/${cid}/a/${t.assignment_id}">Graded · ${num(t.assignment.points_possible)} pts</a>` : ''}
          <a href="${t.html_url}" target="_blank" rel="noopener">Open in Canvas ${ext}</a></div>
        <section class="card prose">${sanitize(t.message)}</section>
        ${(t.attachments || []).map((f) => html`<a class="file" href="/api/file/${f.id}?inline=1" target="_blank" rel="noopener">📎 ${f.display_name}</a>`)}
        ${canReply ? html`
          <form class="card inline-form col" data-form="reply" data-cid="${cid}" data-did="${did}">
            <textarea name="message" rows="4" placeholder="Write a reply…" required></textarea><button class="btn primary">Post reply</button></form>` : ''}
        ${v ? (v.view?.length ? html`<section class="entries">${v.view.map(entry)}</section>` : empty('No replies yet.'))
          : t.require_initial_post ? html`<div class="card callout">Post a reply to see what others wrote.</div>` : ''}
      </article>`;
  },
  after(_el, { t }, { cid, did }) {
    if (t.read_state === 'unread' || t.unread_count > 0) post(`/api/discussion/${cid}/${did}/read`).catch(() => {});
  },
};

screens.pages = {
  tab: 'pages',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ list: `courses/${cid}/pages?sort=title&order=asc` }),
  render: ({ list }, { cid }) => list.length ? html`<div class="card list">${list.map((p) => html`
    <a class="row" href="#/c/${cid}/p/${p.url}"><span class="ico">📄</span>
      <div class="grow"><div class="t">${p.title}${p.front_page ? html` <span class="badge">Front page</span>` : ''}</div>
      <div class="sub">Updated ${ago(p.updated_at)}</div></div></a>`)}</div>` : empty('No pages.'),
};

const pageScreen = (pathFn) => ({
  tab: 'pages',
  title: (d) => d.p.title,
  data: (params) => ({ p: pathFn(params) }),
  render: ({ p }) => html`<article class="detail"><h1>${p.title}</h1>
    <div class="meta"><span>Updated ${ago(p.updated_at)}</span><a href="${p.html_url}" target="_blank" rel="noopener">Open in Canvas ${ext}</a></div>
    ${p.locked_for_user ? html`<div class="card callout">${p.lock_explanation ? sanitize(p.lock_explanation) : 'This page is locked.'}</div>` : ''}
    <section class="card prose">${sanitize(p.body)}</section></article>`,
});
screens.page = pageScreen(({ cid, slug }) => `courses/${cid}/pages/${slug}`);
screens.front = pageScreen(({ cid }) => `courses/${cid}/front_page`);

screens.files = {
  tab: 'files',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid, fid }) => ({ f: `x/folder?course=${cid}&folder=${fid || 'root'}` }),
  render({ f }, { cid }) {
    const { folder, folders, files } = f;
    const crumbs = (folder.full_name || '').split('/').slice(1);
    return html`
      ${crumbs.length ? html`<div class="crumbs"><a href="#/c/${cid}/files">Files</a> / ${crumbs.join(' / ')}
        ${folder.parent_folder_id ? html` · <a href="#/c/${cid}/files/${folder.parent_folder_id}">Up</a>` : ''}</div>` : ''}
      ${folders.length || files.length ? html`<div class="card list">
        ${folders.map((d) => html`<a class="row" href="#/c/${cid}/files/${d.id}"><span class="ico">📁</span>
          <div class="grow"><div class="t">${d.name}</div><div class="sub">${d.files_count} files, ${d.folders_count} folders</div></div></a>`)}
        ${files.map((x) => html`<div class="row">
          <a class="rowlink" href="/api/file/${x.id}?inline=1" target="_blank" rel="noopener"><span class="ico">📎</span>
          <div class="grow"><div class="t">${x.display_name}</div><div class="sub">${bytes(x.size)} · ${ago(x.updated_at)}</div></div></a>
          <a class="btn ghost small" href="/api/file/${x.id}" aria-label="Download ${x.display_name}">⬇</a></div>`)}
      </div>` : empty('This folder is empty.')}`;
  },
};

screens.quizzes = {
  tab: 'quizzes',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ q: { path: `courses/${cid}/quizzes`, optional: true }, groups: groupsPath(cid) }),
  render({ q, groups }, { cid }) {
    const lti = groups.flatMap((g) => g.assignments || []).filter((a) => a.is_quiz_lti_assignment);
    const classic = (q || []).filter((x) => x.published !== false);
    if (!classic.length && !lti.length) return empty('No quizzes.');
    return html`<p class="muted">Quizzes open on the official Canvas site.</p><div class="card list">
      ${classic.map((x) => html`<a class="row" href="${x.html_url}" target="_blank" rel="noopener"><span class="ico">❓</span>
        <div class="grow"><div class="t">${x.title}</div><div class="sub">${x.due_at ? 'Due ' + when(x.due_at) : 'No due date'}${x.points_possible ? ` · ${num(x.points_possible)} pts` : ''}${x.time_limit ? ` · ${x.time_limit} min` : ''}</div></div>${ext}</a>`)}
      ${lti.map((a) => assignmentRow(cid, a))}</div>`;
  },
};

screens.courseGrades = {
  tab: 'grades',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ groups: groupsPath(cid), courses: COURSES }),
  render({ groups }, { cid }) {
    const c = course(cid);
    return html`
      <div class="card grade-summary"><div class="muted">Current grade</div><div class="big-grade">${gradeText(c) || '–'}</div>
        <a href="${canvasUrl(`/courses/${cid}/grades`)}" target="_blank" rel="noopener">Grades in Canvas ${ext}</a></div>
      ${groups.map((g) => html`
        <section><h2>${g.name}${c?.apply_assignment_group_weights && g.group_weight ? html` <span class="muted">${num(g.group_weight)}%</span>` : ''}</h2>
        <div class="card list">${(g.assignments || []).map((a) => {
          const s = a.submission || {};
          const score = s.excused ? 'EX' : s.score != null ? `${num(s.score)} / ${num(a.points_possible)}` : `– / ${num(a.points_possible)}`;
          return html`<a class="row" href="#/c/${cid}/a/${a.id}">
            <div class="grow"><div class="t">${a.name}</div><div class="sub">${a.due_at ? 'Due ' + when(a.due_at) : ''}</div></div>
            <div class="badges">${s.missing ? html`<span class="badge red">Missing</span>` : ''}${s.late ? html`<span class="badge orange">Late</span>` : ''}</div>
            <span class="grade">${score}</span></a>`;
        })}</div></section>`)}`;
  },
};

screens.syllabus = {
  tab: 'syllabus',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ c: `courses/${cid}?include[]=syllabus_body` }),
  render: ({ c }) => c.syllabus_body ? html`<section class="card prose">${sanitize(c.syllabus_body)}</section>` : empty('No syllabus posted.'),
};

// ---------- router ----------

const ROUTES = [
  ['/', 'dashboard'], ['/courses', 'courses'], ['/grades', 'grades'], ['/announcements', 'announcements'],
  ['/c/:cid', 'courseHome'], ['/c/:cid/modules', 'modules'], ['/c/:cid/assignments', 'assignments'],
  ['/c/:cid/a/:aid', 'assignment'], ['/c/:cid/announcements', 'courseAnnouncements'],
  ['/c/:cid/discussions', 'discussions'], ['/c/:cid/d/:did', 'discussion'], ['/c/:cid/pages', 'pages'],
  ['/c/:cid/p/:slug', 'page'], ['/c/:cid/front', 'front'], ['/c/:cid/files', 'files'], ['/c/:cid/files/:fid', 'files'],
  ['/c/:cid/quizzes', 'quizzes'], ['/c/:cid/grades', 'courseGrades'], ['/c/:cid/syllabus', 'syllabus'],
].map(([pattern, name]) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys, name };
});

function match(hash) {
  const path = (hash.replace(/^#/, '') || '/').split('?')[0];
  for (const r of ROUTES) {
    const m = path.match(r.re);
    if (m) return { screen: screens[r.name], params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return { screen: screens.dashboard, params: {} };
}

function specFor(screen, params) {
  const spec = screen.data(params);
  if (screen.tab) spec._tabs = { path: `courses/${params.cid}/tabs`, optional: true };
  return Object.entries(spec).map(([key, v]) => ({ key, ...(typeof v === 'string' ? { path: v } : v) }));
}

let navId = 0;
let lastPath = null;

async function render(force = false) {
  const id = ++navId;
  const { screen, params } = match(location.hash);
  const spec = specFor(screen, params);
  const isNewPage = lastPath !== location.hash;
  lastPath = location.hash;
  highlightNav();
  let shown = null;

  const show = (vals) => {
    if (id !== navId) return;
    const json = JSON.stringify(vals);
    if (json === shown) return;
    // Don't wipe files someone picked for upload.
    if (shown && [...main.querySelectorAll('input[type=file]')].some((f) => f.files.length)) return;
    const d = Object.fromEntries(spec.map((s, i) => [s.key, vals[i] ?? null]));
    if (d.courses) syncCourses(d.courses);
    paint(screen, d, params, !shown && isNewPage);
    shown = json;
  };

  const fromCache = await Promise.all(spec.map((s) => cached(s.path)));
  if (id !== navId) return;
  if (spec.every((s, i) => fromCache[i] !== undefined || s.optional)) show(fromCache);
  else main.innerHTML = '<div class="skeleton"><div></div><div></div><div></div></div>';

  setBusy(true);
  try {
    const fresh = await Promise.all(spec.map((s) => load(s.path, { force }).catch((e) => {
      if (s.optional) return null;
      throw e;
    })));
    show(fresh);
  } catch (e) {
    if (id !== navId || e.status === 401) return;
    if (shown) toast(`Couldn't refresh: ${e.message}`, 'err');
    else main.innerHTML = html`<div class="empty err"><b>${e.status === 403 ? "You don't have access to this in Canvas." : e.status === 404 ? 'Not found.' : "Couldn't load this."}</b>
      <div class="muted">${e.message}</div><button class="btn" data-act="retry">Try again</button></div>`.s;
  } finally {
    if (id === navId) setBusy(false);
  }
}

function paint(screen, d, params, scrollTop) {
  const keep = {};
  main.querySelectorAll('textarea[name], input[name]:not([type=file]):not([type=hidden]):not([type=radio])')
    .forEach((el, i) => { if (el.value) keep[`${el.name}#${i}`] = el.value; });
  const y = window.scrollY;
  const title = screen.title?.(d, params) || 'Easel';
  $('#title').textContent = title;
  document.title = `${title} · Easel`;
  main.innerHTML = (screen.tab ? courseHeader(params.cid, screen.tab, d._tabs).s : '') + screen.render(d, params).s;
  main.querySelectorAll('textarea[name], input[name]:not([type=file]):not([type=hidden]):not([type=radio])')
    .forEach((el, i) => { const v = keep[`${el.name}#${i}`]; if (v) el.value = v; });
  syncPanes();
  window.scrollTo(0, scrollTop ? 0 : y);
  screen.after?.(main, d, params);
}

function setBusy(on) { $('#refresh').classList.toggle('spin', on); }

function highlightNav() {
  const h = location.hash || '#/';
  const cid = h.match(/^#\/c\/(\d+)/)?.[1];
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const n = a.dataset.nav;
    a.classList.toggle('on', cid ? n === `c${cid}` || n === 'courses' : n === (h.split('/')[1] || 'home'));
  });
  $('#back').hidden = !h.startsWith('#/c/');
}

// ---------- courses / sidebar ----------

function syncCourses(list) {
  const courses = (list || []).filter((c) => c.name && !c.access_restricted_by_date);
  const favs = courses.filter((c) => c.is_favorite);
  // Canvas treats "no favorites" as "all favorites".
  const shownList = favs.length ? favs : courses;
  shownList.sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(shownList) === JSON.stringify(state.courses)) return;
  state.courses = shownList;
  courseNav();
}

function courseNav() {
  $('#course-nav').innerHTML = state.courses.map((c) => html`
    <a href="#/c/${c.id}" data-nav="c${c.id}">${dot(c.id)}<span>${c.name}</span></a>`.s).join('');
  highlightNav();
}

function store(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function stored(k) { try { return localStorage.getItem(k); } catch { return null; } }

async function boot() {
  const [c, colors] = await Promise.all([cached(COURSES), cached(COLORS)]);
  if (colors) state.colors = colors.custom_colors || {};
  if (c) syncCourses(c);
  const who = me().then((m) => {
    setCanvasUrl(m.canvasUrl);
    store('easel.canvasUrl', m.canvasUrl);
    store('easel.name', m.user.name || '');
    $('#who').textContent = m.user.name || '';
  });
  const known = stored('easel.canvasUrl');
  if (known) {
    setCanvasUrl(known);
    $('#who').textContent = stored('easel.name') || '';
    who.catch(() => {});
  } else {
    await who.catch(() => {});
  }
  render();
  load(COLORS).then((x) => { state.colors = x.custom_colors || {}; courseNav(); }).catch(() => {});
  load(COURSES).then(syncCourses).catch(() => {});
}

// Prefetch on hover/touch so the next screen is already cached when tapped.
const prefetched = new Set();
function onIntent(e) {
  const a = e.target.closest?.('a[href^="#/"]');
  if (!a || prefetched.has(a.hash)) return;
  prefetched.add(a.hash);
  setTimeout(() => prefetched.delete(a.hash), 30000);
  const { screen, params } = match(a.hash);
  if (screen.data) specFor(screen, params).forEach((s) => prefetch(s.path));
}

// ---------- actions ----------

function syncPanes() {
  main.querySelectorAll('form[data-form=submit]').forEach((f) => {
    const t = f.querySelector('[name=type]:checked, input[type=hidden][name=type]')?.value;
    f.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
  });
}

const actions = {
  retry: () => render(true),
  async done(btn) {
    const wasDone = !!btn.dataset.done;
    btn.closest('.row').classList.toggle('done', !wasDone);
    btn.textContent = wasDone ? '' : '✓';
    try {
      await post('/api/planner/done', {
        plannable_type: btn.dataset.type, plannable_id: btn.dataset.id,
        override_id: btn.dataset.override || null, done: !wasDone,
      });
      render(true);
    } catch (e) {
      toast(e.message, 'err');
      render();
    }
  },
  'reply-toggle'(btn) {
    const f = btn.parentElement.querySelector(':scope > form.reply');
    f.hidden = !f.hidden;
    if (!f.hidden) f.querySelector('textarea').focus();
  },
};

const forms = {
  async submit(f) {
    const fd = new FormData(f);
    const type = fd.get('type');
    if (type !== 'online_upload') fd.delete('files');
    if (type === 'online_text_entry') fd.set('body', textToHtml(fd.get('body') || ''));
    if (type === 'online_upload' && !f.querySelector('input[type=file]').files.length) throw new ApiError(400, 'Choose at least one file');
    if (f.dataset.resubmit && !confirm('Submit a new attempt?')) return false;
    const bar = f.querySelector('.progress');
    bar.hidden = false;
    await upload(`/api/submit/${f.dataset.cid}/${f.dataset.aid}`, fd, (p) => { bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; });
    f.reset();
    toast('Submitted ✓', 'ok');
  },
  async comment(f) {
    await post(`/api/comment/${f.dataset.cid}/${f.dataset.aid}`, { text: f.text.value });
    f.reset();
    toast('Comment sent', 'ok');
  },
  async reply(f) {
    await post(`/api/discussion/${f.dataset.cid}/${f.dataset.did}/reply`, {
      message: textToHtml(f.message.value), parent_id: f.dataset.parent || null,
    });
    f.reset();
    toast('Reply posted', 'ok');
  },
};

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn && actions[btn.dataset.act]) { e.preventDefault(); actions[btn.dataset.act](btn); return; }
  const mr = e.target.closest('[data-markread]');
  if (mr) post(`/api/module/${mr.dataset.markread}/read`).catch(() => {});
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const btn = f.querySelector('button[type=submit], button:not([type])');
  btn.disabled = true;
  try {
    const ok = await forms[f.dataset.form](f);
    if (ok !== false) render(true);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    const bar = f.querySelector('.progress');
    if (bar) { bar.hidden = true; bar.firstElementChild.style.width = '0'; }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.name === 'type') syncPanes();
  if (e.target.type === 'file') {
    const ul = e.target.closest('.pane')?.querySelector('.picked');
    if (ul) ul.innerHTML = [...e.target.files].map((f) => html`<li>${f.name} <span class="muted">${bytes(f.size)}</span></li>`.s).join('');
  }
});

for (const ev of ['dragover', 'drop']) {
  document.addEventListener(ev, (e) => {
    const drop = e.target.closest?.('.drop');
    if (!drop) return;
    e.preventDefault();
    if (ev === 'drop') {
      const input = drop.querySelector('input[type=file]');
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

document.addEventListener('pointerover', onIntent, { passive: true });
document.addEventListener('touchstart', onIntent, { passive: true });
window.addEventListener('hashchange', () => render());
$('#refresh').addEventListener('click', () => render(true));
$('#back').addEventListener('click', () => history.length > 1 ? history.back() : (location.hash = '#/'));
$('#logout').addEventListener('click', async () => {
  await clearCache();
  const f = document.createElement('form');
  f.method = 'post'; f.action = '/logout';
  document.body.append(f); f.submit();
});

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (Date.now() - hiddenAt > 60000) render();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

boot();
