import { load, cached, prefetch, me, post, upload, clearCache, ApiError } from './api.js';
import {
  html, raw, esc, sanitize, textOf, textToHtml, htmlToText, route as canvasRoute, setCanvasUrl, canvasUrl,
  when, dayLabel, time, ago, isoDay, num, bytes,
} from './html.js';
import {
  $, COURSES, COLORS, GROUPS, state, hooks, toast, course, group, courseName, color, colorOf, dot, dotCode, ext,
  empty, ctxOf, gradeText, badges, isQuiz, refreshUnread,
} from './ui.js';
import * as inbox from './inbox.js';
import * as quiz from './quiz.js';
import * as grades from './grades.js';

const main = $('#main');
const groupsPath = (cid) => `courses/${cid}/assignment_groups?include[]=assignments&include[]=submission`;

// ---------- screens ----------
// Each screen: data(params) -> {key: path | {path, optional}}, render(d, params), optional after(el, d, params).
// `tab` shows the course/group header; `static` screens are painted once and never repainted by a refresh.

const screens = { ...inbox.screens, ...quiz.screens, ...grades.screens };

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
  const isQ = i.plannable_type === 'quiz';
  const due = p.due_at || p.todo_date || i.plannable_date;
  const inner = html`
    <div class="grow"><div class="t">${p.title || p.name}${isQ ? html` <span class="badge purple">Quiz</span>` : ''}</div>
    <div class="sub">${i.context_name || ''}${due ? ' · ' + time(due) : ''}${p.points_possible ? ` · ${num(p.points_possible)} pts` : ''}</div></div>
    <div class="badges">${badges(s, p)}</div>`;
  return html`
    <div class="row planner ${done ? 'done' : ''}">
      <button class="check" data-act="done" aria-label="Mark ${done ? 'not done' : 'done'}"
        data-type="${i.plannable_type}" data-id="${i.plannable_id}" data-override="${i.planner_override?.id ?? ''}" data-done="${done ? 1 : ''}">
        ${done ? '✓' : ''}</button>
      ${i.course_id ? dot(i.course_id) : i.group_id ? dotCode(`group_${i.group_id}`) : ''}
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

function groupRows(list) {
  return html`<div class="card list">${list.map((g) => html`
    <a class="row" href="#/g/${g.id}">${dotCode(`group_${g.id}`)}
      <div class="grow"><div class="t">${g.name}</div>
      <div class="sub">${g.course_id ? courseName(g.course_id) : 'Group'}${g.members_count ? ` · ${g.members_count} members` : ''}</div></div></a>`)}</div>`;
}

screens.courses = {
  title: () => 'Courses',
  data: () => ({ courses: COURSES, userGroups: { path: GROUPS, optional: true } }),
  render: () => html`${courseCards()}${state.groups.length ? html`<h2>Groups</h2>${groupRows(state.groups)}` : ''}`,
};

screens.announcements = {
  title: () => 'Announcements',
  data: () => ({ list: 'x/announcements' }),
  render: ({ list }) => announcementList(list),
};

function announcementList(list, ctx = null) {
  if (!list?.length) return empty('No announcements.');
  return html`<div class="card list">${list.map((a) => {
    const code = ctx?.code || a.context_code || '';
    const href = ctx ? `${ctx.href}/d/${a.id}` : `#/${code.startsWith('group_') ? 'g' : 'c'}/${code.replace(/^\w+_/, '')}/d/${a.id}`;
    const where = ctx?.name || (code.startsWith('group_') ? group(code.slice(6))?.name : courseName(code.replace('course_', '')));
    return html`<a class="row ${a.read_state === 'unread' ? 'unread' : ''}" href="${href}">${dotCode(code)}
      <div class="grow"><div class="t">${a.title}</div>
      <div class="sub">${where || ''} · ${a.author?.display_name || a.user_name || ''} · ${ago(a.posted_at)}</div>
      <div class="preview">${textOf(a.message)}</div></div></a>`;
  })}</div>`;
}

// ----- course & group screens -----

const COURSE_TABS = [
  ['modules', 'Modules'], ['assignments', 'Assignments'], ['announcements', 'Announcements'],
  ['discussions', 'Discussions'], ['pages', 'Pages'], ['files', 'Files'], ['quizzes', 'Quizzes'],
  ['people', 'People'], ['grades', 'Grades'], ['syllabus', 'Syllabus'],
];
const GROUP_TABS = [['announcements', 'Announcements'], ['discussions', 'Discussions'], ['pages', 'Pages'], ['files', 'Files'], ['people', 'People']];

function ctxHeader(ctx, active, tabs) {
  const visible = tabs ? new Set(tabs.filter((t) => !t.hidden).map((t) => t.id)) : null;
  const all = ctx.kind === 'groups' ? GROUP_TABS : COURSE_TABS;
  const g = ctx.kind === 'groups' && group(ctx.id);
  return html`
    <div class="course-head" style="--c:${colorOf(ctx.code)}">
      <div class="course-title"><span class="bar"></span>
        <div class="grow"><h1>${ctx.name}</h1>${g?.course_id ? html`<a class="sub" href="#/c/${g.course_id}">${courseName(g.course_id)}</a>` : ''}</div>
        <a class="btn ghost small" href="${canvasUrl(ctx.canvas)}" target="_blank" rel="noopener">Canvas ${ext}</a></div>
      <nav class="tabs">${all.filter(([id]) => !visible || visible.has(id) || id === 'grades')
        .map(([id, label]) => html`<a href="${ctx.href}/${id}" class="${id === active ? 'on' : ''}">${label}</a>`)}</nav>
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

screens.groupHome = {
  data: () => ({}),
  render: () => html`<div class="skeleton"></div>`,
  after(_el, _d, { gid }) {
    history.replaceState(null, '', `#/g/${gid}/discussions`);
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
    case 'Quiz': href = `#/c/${cid}/q/${it.content_id}`; break;
    case 'File': href = `/api/file/${it.content_id}?inline=1`; external = true; break;
    case 'ExternalUrl': href = it.external_url; external = true; break;
    default: href = it.html_url; external = true; // external tools open in Canvas
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
    <a class="row" href="${a.quiz_id ? `#/c/${cid}/q/${a.quiz_id}` : `#/c/${cid}/a/${a.id}`}">
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
    pr: { path: `courses/${cid}/assignments/${aid}/peer_reviews?include[]=user&include[]=submission_comments`, optional: true },
  }),
  render({ a, s, pr }, { cid }) {
    const types = a.submission_types || [];
    const quizA = isQuiz(a);
    const canHere = types.filter((t) => SUBMITTABLE[t]);
    const attemptsLeft = a.allowed_attempts > 0 ? a.allowed_attempts - (s?.attempt || 0) : Infinity;
    const submitted = s && (s.submitted_at || s.workflow_state === 'submitted' || s.workflow_state === 'graded');
    const canSubmit = !quizA && canHere.length && !a.locked_for_user && attemptsLeft > 0;
    const other = types.filter((t) => !SUBMITTABLE[t] && !['none', 'not_graded', 'on_paper', 'online_quiz'].includes(t));
    const myReviews = a.peer_reviews ? (pr || []).filter((r) => r.assessor_id === state.meId) : [];
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
        ${a.quiz_id ? html`
          <div class="card callout quiz">
            <div><b>This is a quiz.</b></div>
            <a class="btn primary" href="#/c/${cid}/q/${a.quiz_id}">Open quiz</a>
          </div>`
        : quizA ? html`
          <div class="card callout quiz">
            <div><b>This is a New Quizzes quiz.</b> These can only be taken on the official Canvas site.</div>
            <a class="btn primary" href="${a.html_url}" target="_blank" rel="noopener">Take quiz on Canvas ${ext}</a>
          </div>` : ''}
        ${a.locked_for_user ? html`<div class="card callout">${a.lock_explanation ? sanitize(a.lock_explanation) : 'This assignment is locked.'}</div>` : ''}
        ${s ? submissionCard(a, s) : ''}
        ${a.description ? html`<section class="card prose">${sanitize(a.description)}</section>` : ''}
        ${a.rubric ? rubric(a, s) : ''}
        ${canSubmit ? submitForm(cid, a, canHere, submitted) : ''}
        ${!quizA && other.length ? html`<div class="card callout">
          <div>This assignment takes a ${other.map((t) => t.replace(/_/g, ' ')).join(' / ')} submission, which you can do on Canvas.</div>
          <a class="btn" href="${a.html_url}" target="_blank" rel="noopener">Submit on Canvas ${ext}</a></div>` : ''}
        ${myReviews.length ? peerReviews(cid, a, myReviews) : ''}
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

function peerReviews(cid, a, list) {
  return html`
    <section class="card"><h2>Your peer reviews</h2>
      <p class="muted">Leave feedback below. ${a.rubric ? 'This assignment has a rubric: fill it in on Canvas to finish each review.' : ''}</p>
      ${list.map((r) => {
        const who = a.anonymous_peer_reviews ? 'Anonymous student' : r.user?.display_name || r.user?.name || 'Classmate';
        const href = a.anonymous_peer_reviews ? a.html_url : canvasUrl(`/courses/${cid}/assignments/${a.id}/submissions/${r.user_id}`);
        const mine = (r.submission_comments || []).filter((c) => c.author_id === state.meId);
        return html`
          <div class="review">
            <div class="sub-head"><b>${who}</b>
              <span class="badge ${r.workflow_state === 'completed' ? 'green' : 'orange'}">${r.workflow_state === 'completed' ? 'Done' : 'To do'}</span></div>
            <a href="${href}" target="_blank" rel="noopener">View their submission on Canvas ${ext}</a>
            ${mine.map((c) => html`<div class="comment"><div class="cmeta">You · ${ago(c.created_at)}</div><div>${c.comment}</div></div>`)}
            <form class="inline-form" data-form="comment" data-cid="${cid}" data-aid="${a.id}" data-user="${r.user_id}">
              <input type="text" name="text" placeholder="Feedback for ${who}…" required><button class="btn">Send</button>
            </form>
          </div>`;
      })}
    </section>`;
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

screens.ctxAnnouncements = {
  tab: 'announcements',
  title: (_d, p) => ctxOf(p).name,
  data: (p) => ({ list: `${ctxOf(p).api}/discussion_topics?only_announcements=true` }),
  render: ({ list }, p) => announcementList(list, ctxOf(p)),
};

screens.discussions = {
  tab: 'discussions',
  title: (_d, p) => ctxOf(p).name,
  data: (p) => ({
    list: `${ctxOf(p).api}/discussion_topics?order_by=recent_activity`,
    perm: { path: `${ctxOf(p).api}?include[]=permissions`, optional: true },
  }),
  render({ list, perm }, p) {
    const ctx = ctxOf(p);
    const canCreate = perm?.permissions?.create_discussion_topic;
    const sorted = [...list].sort((a, b) => (b.pinned - a.pinned));
    return html`
      ${canCreate ? html`<div class="toolbar"><a class="btn primary" href="${ctx.href}/discussions/new">＋ New discussion</a></div>` : ''}
      ${sorted.length ? html`<div class="card list">${sorted.map((t) => html`
        <a class="row ${t.read_state === 'unread' || t.unread_count ? 'unread' : ''}" href="${ctx.href}/d/${t.id}">
          <span class="ico">${t.pinned ? '📌' : '💬'}</span>
          <div class="grow"><div class="t">${t.title}</div>
            <div class="sub">${t.discussion_subentry_count} replies${t.last_reply_at ? ' · last ' + ago(t.last_reply_at) : ''}${t.assignment ? ' · graded' : ''}${t.locked ? ' · closed' : ''}</div></div>
          ${t.unread_count ? html`<span class="badge blue">${t.unread_count} new</span>` : ''}
        </a>`)}</div>` : empty('No discussions.')}`;
  },
};

screens.newTopic = {
  tab: 'discussions',
  static: true,
  title: () => 'New discussion',
  data: () => ({}),
  render: (_d, p) => html`
    <form class="card compose" data-form="new-topic" data-kind="${ctxOf(p).kind}" data-id="${ctxOf(p).id}">
      <h2>New discussion</h2>
      <input type="text" name="title" placeholder="Title" required>
      <textarea name="message" rows="10" placeholder="Write your post…"></textarea>
      <label class="attach">📎 <input type="file" name="attachment"><span class="muted">Attach a file (if the course allows it)</span></label>
      <div class="progress" hidden><div></div></div>
      <button class="btn primary" type="submit">Post discussion</button>
    </form>`,
};

function replyForm(ctx, did, t, parent = null) {
  return html`
    <form class="inline-form col ${parent ? 'reply' : 'card'}" data-form="reply" data-kind="${ctx.kind}" data-id="${ctx.id}" data-did="${did}"
      data-parent="${parent || ''}" ${raw(parent ? 'hidden' : '')}>
      <textarea name="message" rows="${parent ? 3 : 4}" placeholder="Write a reply…" required></textarea>
      ${t.permissions?.attach ? html`<label class="attach">📎 <input type="file" name="attachment"><span class="muted">Attach a file</span></label>` : ''}
      <div class="progress" hidden><div></div></div>
      <button class="btn ${parent ? '' : 'primary'}">${parent ? 'Post' : 'Post reply'}</button>
    </form>`;
}

screens.discussion = {
  tab: 'discussions',
  title: (d) => d.t.title,
  data: (p) => ({
    t: `${ctxOf(p).api}/discussion_topics/${p.did}`,
    v: { path: `${ctxOf(p).api}/discussion_topics/${p.did}/view?include_new_entries=1`, optional: true },
  }),
  render({ t, v }, p) {
    const ctx = ctxOf(p);
    const did = p.did;
    const people = new Map((v?.participants || []).map((x) => [x.id, x]));
    const unread = new Set(v?.unread_entries || []);
    const ratings = v?.entry_ratings || {};
    const canReply = !t.locked && !t.locked_for_user && (t.permissions?.reply ?? true);
    const canRate = t.allow_rating && !t.only_graders_can_rate;
    const base = `${ctx.kind}/${ctx.id}/${did}`;
    const entry = (e) => {
      const who = people.get(e.user_id) || {};
      const mine = e.user_id === state.meId && !e.deleted;
      const liked = ratings[e.id] === 1;
      return html`
        <div class="entry ${unread.has(e.id) ? 'unread' : ''}" data-entry="${e.id}">
          <div class="emeta">${who.avatar_image_url ? html`<img class="avatar" src="${who.avatar_image_url}" alt="">` : ''}
            <b>${who.display_name || e.user_name || 'Someone'}</b> · ${ago(e.created_at)}${e.updated_at && e.updated_at !== e.created_at && !e.deleted ? ' · edited' : ''}</div>
          ${e.deleted ? html`<div class="muted">This reply was deleted.</div>` : html`<div class="prose e-msg">${sanitize(e.message)}</div>`}
          ${(e.attachment ? [e.attachment] : e.attachments || []).map((f) => html`<a class="file" href="/api/file/${f.id}?inline=1" target="_blank" rel="noopener">📎 ${f.display_name}</a>`)}
          ${!e.deleted ? html`<div class="e-actions">
            ${canRate ? html`<button class="link-btn like ${liked ? 'on' : ''}" data-act="like" data-base="${base}" data-eid="${e.id}" data-liked="${liked ? 1 : ''}">
              ${liked ? '♥' : '♡'} ${e.rating_sum || ''}</button>` : e.rating_sum ? html`<span class="muted">♥ ${e.rating_sum}</span>` : ''}
            ${canReply ? html`<button class="link-btn" data-act="reply-toggle">Reply</button>` : ''}
            ${mine ? html`<button class="link-btn" data-act="edit-toggle">Edit</button>
              <button class="link-btn danger" data-act="entry-delete" data-base="${base}" data-eid="${e.id}">Delete</button>` : ''}
          </div>` : ''}
          ${mine ? html`<form class="inline-form col edit" data-form="entry-edit" data-base="${base}" data-eid="${e.id}" hidden>
            <textarea name="message" rows="4">${htmlToText(e.message)}</textarea><button class="btn">Save</button></form>` : ''}
          ${canReply && !e.deleted ? replyForm(ctx, did, t, e.id) : ''}
          ${e.replies?.length ? html`<div class="replies">${e.replies.map(entry)}</div>` : ''}
        </div>`;
    };
    return html`
      <article class="detail">
        <h1>${t.title}</h1>
        <div class="meta"><span>${t.author?.display_name || t.user_name || ''}</span><span>${when(t.posted_at)}</span>
          ${t.assignment ? html`<a href="#/c/${ctx.id}/a/${t.assignment_id}">Graded · ${num(t.assignment.points_possible)} pts</a>` : ''}
          <a href="${t.html_url}" target="_blank" rel="noopener">Open in Canvas ${ext}</a></div>
        <section class="card prose">${sanitize(t.message)}</section>
        ${(t.attachments || []).map((f) => html`<a class="file" href="/api/file/${f.id}?inline=1" target="_blank" rel="noopener">📎 ${f.display_name}</a>`)}
        ${canReply ? replyForm(ctx, did, t) : ''}
        ${v ? (v.view?.length ? html`<section class="entries">${v.view.map(entry)}</section>` : empty('No replies yet.'))
          : t.require_initial_post ? html`<div class="card callout">Post a reply to see what others wrote.</div>` : ''}
      </article>`;
  },
  after(_el, { t }, p) {
    const ctx = ctxOf(p);
    if (t.read_state === 'unread' || t.unread_count > 0) post(`/api/discussion/${ctx.kind}/${ctx.id}/${p.did}/read`).catch(() => {});
  },
};

screens.pages = {
  tab: 'pages',
  title: (_d, p) => ctxOf(p).name,
  data: (p) => ({ list: `${ctxOf(p).api}/pages?sort=title&order=asc` }),
  render: ({ list }, p) => list.length ? html`<div class="card list">${list.map((x) => html`
    <a class="row" href="${ctxOf(p).href}/p/${x.url}"><span class="ico">📄</span>
      <div class="grow"><div class="t">${x.title}${x.front_page ? html` <span class="badge">Front page</span>` : ''}</div>
      <div class="sub">Updated ${ago(x.updated_at)}</div></div></a>`)}</div>` : empty('No pages.'),
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
screens.page = pageScreen((p) => `${ctxOf(p).api}/pages/${p.slug}`);
screens.front = pageScreen((p) => `${ctxOf(p).api}/front_page`);

screens.files = {
  tab: 'files',
  title: (_d, p) => ctxOf(p).name,
  data: (p) => ({ f: `x/folder?kind=${ctxOf(p).kind}&id=${ctxOf(p).id}&folder=${p.fid || 'root'}` }),
  render({ f }, p) {
    const ctx = ctxOf(p);
    const { folder, folders, files } = f;
    const crumbs = (folder.full_name || '').split('/').slice(1);
    return html`
      ${crumbs.length ? html`<div class="crumbs"><a href="${ctx.href}/files">Files</a> / ${crumbs.join(' / ')}
        ${folder.parent_folder_id ? html` · <a href="${ctx.href}/files/${folder.parent_folder_id}">Up</a>` : ''}</div>` : ''}
      ${folders.length || files.length ? html`<div class="card list">
        ${folders.map((d) => html`<a class="row" href="${ctx.href}/files/${d.id}"><span class="ico">📁</span>
          <div class="grow"><div class="t">${d.name}</div><div class="sub">${d.files_count} files, ${d.folders_count} folders</div></div></a>`)}
        ${files.map((x) => html`<div class="row">
          <a class="rowlink" href="/api/file/${x.id}?inline=1" target="_blank" rel="noopener"><span class="ico">📎</span>
          <div class="grow"><div class="t">${x.display_name}</div><div class="sub">${bytes(x.size)} · ${ago(x.updated_at)}</div></div></a>
          <a class="btn ghost small" href="/api/file/${x.id}" aria-label="Download ${x.display_name}">⬇</a></div>`)}
      </div>` : empty('This folder is empty.')}`;
  },
};

const ROLE = {
  TeacherEnrollment: 'Teacher', TaEnrollment: 'TA', StudentEnrollment: 'Student',
  ObserverEnrollment: 'Observer', DesignerEnrollment: 'Designer',
};
const ROLE_ORDER = ['Teacher', 'TA', 'Designer', 'Student', 'Observer', 'Member'];

screens.people = {
  tab: 'people',
  title: (_d, p) => ctxOf(p).name,
  data: (p) => ({ users: `${ctxOf(p).api}/users?include[]=avatar_url&include[]=enrollments` }),
  render({ users }, p) {
    const ctx = ctxOf(p);
    const byRole = new Map();
    for (const u of users) {
      const roles = [...new Set((u.enrollments || []).filter((e) => !ctx.id || String(e.course_id) === String(ctx.id) || ctx.kind === 'groups')
        .map((e) => ROLE[e.type] || e.role || 'Member'))];
      const role = ROLE_ORDER.find((r) => roles.includes(r)) || 'Member';
      byRole.has(role) || byRole.set(role, []);
      byRole.get(role).push(u);
    }
    const myGroups = ctx.kind === 'courses' ? state.groups.filter((g) => String(g.course_id) === String(ctx.id)) : [];
    return html`
      ${myGroups.length ? html`<h2>Your groups</h2>${groupRows(myGroups)}` : ''}
      ${ROLE_ORDER.filter((r) => byRole.has(r)).map((r) => html`
        <h2>${r === 'Member' ? 'Members' : r + 's'} <span class="muted">${byRole.get(r).length}</span></h2>
        <div class="card list">${byRole.get(r).sort((a, b) => (a.sortable_name || a.name).localeCompare(b.sortable_name || b.name)).map((u) => html`
          <div class="row">
            ${u.avatar_url ? html`<img class="avatar lg" src="${u.avatar_url}" alt="" loading="lazy">` : html`<span class="ico">👤</span>`}
            <div class="grow"><div class="t">${u.name}${u.pronouns ? html` <span class="muted">(${u.pronouns})</span>` : ''}</div></div>
            ${u.id !== state.meId ? html`<a class="btn ghost small" href="#/inbox/new?${new URLSearchParams({ to: u.id, name: u.name, ctx: ctx.code })}">✉️ Message</a>` : ''}
          </div>`)}</div>`)}
      ${!users.length ? empty('No one to show.') : ''}`;
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
    return html`<div class="card list">
      ${classic.map((x) => html`<a class="row" href="#/c/${cid}/q/${x.id}"><span class="ico">❓</span>
        <div class="grow"><div class="t">${x.title}</div><div class="sub">${x.due_at ? 'Due ' + when(x.due_at) : 'No due date'}${x.points_possible ? ` · ${num(x.points_possible)} pts` : ''}${x.time_limit ? ` · ${x.time_limit} min` : ''}</div></div></a>`)}
      ${lti.map((a) => assignmentRow(cid, a))}</div>
      ${lti.length ? html`<p class="muted">New Quizzes open on the official Canvas site.</p>` : ''}`;
  },
};

screens.syllabus = {
  tab: 'syllabus',
  title: (_d, p) => courseName(p.cid),
  data: ({ cid }) => ({ c: `courses/${cid}?include[]=syllabus_body` }),
  render: ({ c }) => c.syllabus_body ? html`<section class="card prose">${sanitize(c.syllabus_body)}</section>` : empty('No syllabus posted.'),
};

// ---------- router ----------

const SHARED = [
  ['announcements', 'ctxAnnouncements'], ['discussions', 'discussions'], ['discussions/new', 'newTopic'],
  ['d/:did', 'discussion'], ['pages', 'pages'], ['p/:slug', 'page'], ['files', 'files'], ['files/:fid', 'files'],
  ['people', 'people'],
];

const ROUTES = [
  ['/', 'dashboard'], ['/courses', 'courses'], ['/grades', 'grades'], ['/gpa', 'gpa'], ['/announcements', 'announcements'],
  ['/inbox', 'inbox'], ['/inbox/new', 'compose'], ['/inbox/:id', 'conversation'],
  ['/c/:cid', 'courseHome'], ['/c/:cid/modules', 'modules'], ['/c/:cid/assignments', 'assignments'],
  ['/c/:cid/a/:aid', 'assignment'], ['/c/:cid/front', 'front'], ['/c/:cid/quizzes', 'quizzes'],
  ['/c/:cid/q/:qid', 'quiz'], ['/c/:cid/q/:qid/take', 'quizTake'],
  ['/c/:cid/grades', 'courseGrades'], ['/c/:cid/syllabus', 'syllabus'],
  ...SHARED.map(([p, n]) => [`/c/:cid/${p}`, n]),
  ['/g/:gid', 'groupHome'],
  ...SHARED.map(([p, n]) => [`/g/:gid/${p}`, n]),
].map(([pattern, name]) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  return { re, keys, name };
});

function match(hash) {
  const [path, query] = (hash.replace(/^#/, '') || '/').split('?');
  for (const r of ROUTES) {
    const m = (path || '/').match(r.re);
    if (m && screens[r.name]) {
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      params.q = new URLSearchParams(query || '');
      return { screen: screens[r.name], params };
    }
  }
  return { screen: screens.dashboard, params: { q: new URLSearchParams() } };
}

function specFor(screen, params) {
  const spec = screen.data(params);
  if (screen.tab) spec._tabs = { path: `${ctxOf(params).api}/tabs`, optional: true };
  if (params.gid) spec._groups = { path: GROUPS, optional: true };
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
    if (shown && screen.static) return;
    // Don't wipe files someone picked for upload.
    if (shown && [...main.querySelectorAll('input[type=file]')].some((f) => f.files.length)) return;
    const d = Object.fromEntries(spec.map((s, i) => [s.key, vals[i] ?? null]));
    if (d.courses) syncCourses(d.courses);
    if (d.userGroups || d._groups) syncGroups(d.userGroups || d._groups); // not `groups`: grade screens use that for assignment groups
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
hooks.render = render;

function paint(screen, d, params, scrollTop) {
  const keep = {};
  main.querySelectorAll('textarea[name], input[name]:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])')
    .forEach((el, i) => { if (el.value) keep[`${el.name}#${i}`] = el.value; });
  const y = window.scrollY;
  const title = screen.title?.(d, params) || 'Easel';
  $('#title').textContent = title;
  document.title = `${title} · Easel`;
  main.innerHTML = (screen.tab ? ctxHeader(ctxOf(params), screen.tab, d._tabs).s : '') + screen.render(d, params).s;
  main.querySelectorAll('textarea[name], input[name]:not([type=file]):not([type=hidden]):not([type=radio]):not([type=checkbox])')
    .forEach((el, i) => { const v = keep[`${el.name}#${i}`]; if (v) el.value = v; });
  syncPanes();
  window.scrollTo(0, scrollTop ? 0 : y);
  screen.after?.(main, d, params);
}

function setBusy(on) { $('#refresh').classList.toggle('spin', on); }

function highlightNav() {
  const h = location.hash || '#/';
  const m = h.match(/^#\/([cg])\/(\d+)/);
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const n = a.dataset.nav;
    a.classList.toggle('on', m ? n === `${m[1]}${m[2]}` || n === 'courses' : n === ((h.split('/')[1] || 'home').split('?')[0]));
  });
  $('#back').hidden = !/^#\/(c|g|inbox\/)/.test(h);
}

// ---------- courses / groups / sidebar ----------

function syncCourses(list) {
  const courses = (list || []).filter((c) => c.name && !c.access_restricted_by_date);
  const favs = courses.filter((c) => c.is_favorite);
  // Canvas treats "no favorites" as "all favorites".
  const shownList = favs.length ? favs : courses;
  shownList.sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(shownList) === JSON.stringify(state.courses)) return;
  state.courses = shownList;
  sideNav();
}

function syncGroups(list) {
  const groups = (list || []).filter((g) => g.name).sort((a, b) => a.name.localeCompare(b.name));
  if (JSON.stringify(groups) === JSON.stringify(state.groups)) return;
  state.groups = groups;
  sideNav();
}

function sideNav() {
  $('#course-nav').innerHTML = state.courses.map((c) => html`
    <a href="#/c/${c.id}" data-nav="c${c.id}">${dot(c.id)}<span>${c.name}</span></a>`.s).join('');
  $('#group-label').hidden = !state.groups.length;
  $('#group-nav').innerHTML = state.groups.map((g) => html`
    <a href="#/g/${g.id}" data-nav="g${g.id}">${dotCode(`group_${g.id}`)}<span>${g.name}</span></a>`.s).join('');
  highlightNav();
}

function store(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }
function stored(k) { try { return localStorage.getItem(k); } catch { return null; } }

async function boot() {
  const [c, colors, g] = await Promise.all([cached(COURSES), cached(COLORS), cached(GROUPS)]);
  if (colors) state.colors = colors.custom_colors || {};
  if (c) syncCourses(c);
  if (g) syncGroups(g);
  const who = me().then((m) => {
    setCanvasUrl(m.canvasUrl);
    state.meId = m.user.id;
    store('easel.canvasUrl', m.canvasUrl);
    store('easel.name', m.user.name || '');
    store('easel.meId', String(m.user.id));
    $('#who').textContent = m.user.name || '';
  });
  const known = stored('easel.canvasUrl');
  if (known && stored('easel.meId')) {
    setCanvasUrl(known);
    state.meId = Number(stored('easel.meId'));
    $('#who').textContent = stored('easel.name') || '';
    who.catch(() => {});
  } else {
    await who.catch(() => {});
  }
  render();
  load(COLORS).then((x) => { state.colors = x.custom_colors || {}; sideNav(); }).catch(() => {});
  load(COURSES).then(syncCourses).catch(() => {});
  load(GROUPS).then(syncGroups).catch(() => {});
  refreshUnread();
}

// Prefetch on hover/touch so the next screen is already cached when tapped.
const prefetched = new Set();
function onIntent(e) {
  const a = e.target.closest?.('a[href^="#/"]');
  if (!a || prefetched.has(a.hash)) return;
  prefetched.add(a.hash);
  setTimeout(() => prefetched.delete(a.hash), 30000);
  const { screen, params } = match(a.hash);
  if (screen.data && !screen.static) specFor(screen, params).forEach((s) => prefetch(s.path));
}

// ---------- actions ----------

function syncPanes() {
  main.querySelectorAll('form[data-form=submit]').forEach((f) => {
    const t = f.querySelector('[name=type]:checked, input[type=hidden][name=type]')?.value;
    f.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== t; });
  });
}

function withProgress(f) {
  const bar = f.querySelector('.progress');
  if (bar) bar.hidden = false;
  return (p) => { if (bar) bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; };
}

const actions = {
  ...inbox.actions,
  ...quiz.actions,
  ...grades.actions,
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
    const f = btn.closest('.entry').querySelector(':scope > form.reply');
    f.hidden = !f.hidden;
    if (!f.hidden) f.querySelector('textarea').focus();
  },
  'edit-toggle'(btn) {
    const entry = btn.closest('.entry');
    const f = entry.querySelector(':scope > form.edit');
    f.hidden = !f.hidden;
    entry.querySelector(':scope > .e-msg').hidden = !f.hidden;
    if (!f.hidden) f.querySelector('textarea').focus();
  },
  async like(btn) {
    const liked = !!btn.dataset.liked;
    try {
      await post(`/api/discussion/${btn.dataset.base}/entry/${btn.dataset.eid}/rate`, { rating: liked ? 0 : 1 });
      render(true);
    } catch (e) { toast(e.message, 'err'); }
  },
  async 'entry-delete'(btn) {
    if (!confirm('Delete this reply? This cannot be undone.')) return;
    try {
      await post(`/api/discussion/${btn.dataset.base}/entry/${btn.dataset.eid}/delete`);
      toast('Reply deleted', 'ok');
      render(true);
    } catch (e) { toast(e.message, 'err'); }
  },
};

const forms = {
  ...inbox.forms,
  async submit(f) {
    const fd = new FormData(f);
    const type = fd.get('type');
    if (type !== 'online_upload') fd.delete('files');
    if (type === 'online_text_entry') fd.set('body', textToHtml(fd.get('body') || ''));
    if (type === 'online_upload' && !f.querySelector('input[type=file]').files.length) throw new ApiError(400, 'Choose at least one file');
    if (f.dataset.resubmit && !confirm('Submit a new attempt?')) return false;
    await upload(`/api/submit/${f.dataset.cid}/${f.dataset.aid}`, fd, withProgress(f));
    f.reset();
    toast('Submitted ✓', 'ok');
  },
  async comment(f) {
    await post(`/api/comment/${f.dataset.cid}/${f.dataset.aid}`, { text: f.text.value, user_id: f.dataset.user || null });
    f.reset();
    toast('Comment sent', 'ok');
  },
  async reply(f) {
    const fd = new FormData();
    fd.append('message', textToHtml(f.message.value));
    fd.append('parent_id', f.dataset.parent || '');
    const file = f.attachment?.files?.[0];
    if (file) fd.append('attachment', file);
    await upload(`/api/discussion/${f.dataset.kind}/${f.dataset.id}/${f.dataset.did}/reply`, fd, withProgress(f));
    f.reset();
    toast('Reply posted', 'ok');
  },
  async 'entry-edit'(f) {
    await post(`/api/discussion/${f.dataset.base}/entry/${f.dataset.eid}/edit`, { message: textToHtml(f.message.value) });
    toast('Reply updated', 'ok');
  },
  async 'new-topic'(f) {
    const fd = new FormData();
    fd.append('title', f.elements.title.value); // f.title is the form's own title attribute
    fd.append('message', textToHtml(f.message.value));
    const file = f.attachment?.files?.[0];
    if (file) fd.append('attachment', file);
    const t = await upload(`/api/discussion/${f.dataset.kind}/${f.dataset.id}/new`, fd, withProgress(f));
    toast('Discussion posted', 'ok');
    location.hash = `#/${f.dataset.kind === 'groups' ? 'g' : 'c'}/${f.dataset.id}/d/${t.id}`;
    return false;
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
  if (!f || !forms[f.dataset.form]) return;
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
    const label = e.target.closest('.attach')?.querySelector('span');
    if (label && e.target.files.length) label.textContent = [...e.target.files].map((f) => f.name).join(', ');
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
$('#refresh').addEventListener('click', () => { render(true); refreshUnread(true); });
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
  else if (Date.now() - hiddenAt > 60000) { render(); refreshUnread(); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

boot();
