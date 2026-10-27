// Shared state and small UI helpers used by every screen module.
import { load, cached } from './api.js';
import { html, raw, num, route as canvasRoute } from './html.js';

export const $ = (s, el = document) => el.querySelector(s);

export const COURSES = 'courses?enrollment_state=active&include[]=total_scores&include[]=term&include[]=favorites';
export const COLORS = 'users/self/colors';
export const GROUPS = 'users/self/groups';

export const state = { courses: [], groups: [], colors: {}, meId: null };

/** Set by app.js; lets screen modules re-run the router. */
export const hooks = { render: () => {} };

let toastTimer;
export function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

export const course = (cid) => state.courses.find((c) => String(c.id) === String(cid));
export const group = (gid) => state.groups.find((g) => String(g.id) === String(gid));
export const courseName = (cid) => course(cid)?.name || 'Course';

export function colorOf(code) {
  if (state.colors[code]) return state.colors[code];
  const g = code.startsWith('group_') && group(code.slice(6));
  return (g && state.colors[`course_${g.course_id}`]) || '#6366f1';
}
export const color = (cid) => colorOf(`course_${cid}`);
export const dotCode = (code) => html`<span class="dot" style="background:${colorOf(code)}"></span>`;
export const dot = (cid) => dotCode(`course_${cid}`);
export const ext = raw('<span class="ext" aria-label="opens Canvas">↗</span>');
export const empty = (msg) => html`<div class="empty">${msg}</div>`;

/** A course or a group: the same screens (discussions, pages, files, people) serve both. */
export function ctxOf(p) {
  if (p.gid) {
    return { kind: 'groups', id: p.gid, api: `groups/${p.gid}`, href: `#/g/${p.gid}`, code: `group_${p.gid}`,
      name: group(p.gid)?.name || 'Group', canvas: `/groups/${p.gid}` };
  }
  return { kind: 'courses', id: p.cid, api: `courses/${p.cid}`, href: `#/c/${p.cid}`, code: `course_${p.cid}`,
    name: courseName(p.cid), canvas: `/courses/${p.cid}` };
}

export function link(url, label, cls = '') {
  const r = canvasRoute(url);
  if (!r) return html`<span class="${cls}">${label}</span>`;
  return r.external
    ? html`<a class="${cls}" href="${r.href}" target="_blank" rel="noopener">${label} ${ext}</a>`
    : html`<a class="${cls}" href="${r.href}">${label}</a>`;
}

export function enrollment(c) {
  return (c?.enrollments || []).find((e) => e.type === 'student' || e.type === 'StudentEnrollment') || c?.enrollments?.[0];
}

export function gradeText(c) {
  const e = enrollment(c);
  if (!e || c.hide_final_grades) return '';
  const score = e.computed_current_score;
  if (score == null) return e.computed_current_grade || '';
  return `${num(score)}%${e.computed_current_grade ? ' · ' + e.computed_current_grade : ''}`;
}

export function badges(sub, a = {}) {
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

export const isQuiz = (a) => a.is_quiz_assignment || a.is_quiz_lti_assignment || a.quiz_id
  || (a.submission_types || []).includes('online_quiz');

/** Same rules the server enforces: quizzes with these settings are taken on Canvas. */
export function quizRestrictions(q) {
  const r = [];
  if (q.require_lockdown_browser || q.require_lockdown_browser_for_results) r.push('LockDown Browser');
  if (q.has_access_code || q.access_code) r.push('an access code');
  if (q.ip_filter) r.push('network (IP) restrictions');
  if (q.one_question_at_a_time) r.push('one question at a time');
  if (q.cant_go_back) r.push('locked questions after answering');
  return r;
}

export async function refreshUnread(force = false) {
  const path = 'conversations/unread_count';
  try {
    const c = force ? await load(path, { force: true }) : (await cached(path)) || (await load(path));
    const n = Number(c?.unread_count || 0);
    document.querySelectorAll('[data-badge=inbox]').forEach((b) => { b.textContent = n || ''; b.hidden = !n; });
    if (!force) load(path).then((x) => {
      const m = Number(x?.unread_count || 0);
      document.querySelectorAll('[data-badge=inbox]').forEach((b) => { b.textContent = m || ''; b.hidden = !m; });
    }).catch(() => {});
  } catch { /* offline */ }
}
