// Classic Quizzes taken in-app. New Quizzes and quizzes with settings we can't honour open on Canvas.
import { load, post, upload, getJson } from './api.js';
import { html, raw, esc, sanitize, textToHtml, htmlToText, when, num } from './html.js';
import { toast, empty, hooks, ext, quizRestrictions } from './ui.js';

const tokenKey = (sub) => `easel.qtok.${sub}`;
const saveToken = (sub, t) => { try { sessionStorage.setItem(tokenKey(sub), t); } catch { /* private mode */ } };
const readToken = (sub) => { try { return sessionStorage.getItem(tokenKey(sub)); } catch { return null; } };

const subsOf = (d) => (Array.isArray(d) ? d : d?.quiz_submissions) || [];
const inProgress = (subs) => subs.find((s) => s.workflow_state === 'untaken');
const finished = (subs) => subs.filter((s) => ['complete', 'pending_review'].includes(s.workflow_state));

function attemptsLeft(q, subs) {
  if (q.allowed_attempts == null || q.allowed_attempts < 0) return Infinity;
  const latest = subs.reduce((a, s) => (s.attempt > (a?.attempt || 0) ? s : a), null);
  if (latest?.attempts_left != null) return latest.attempts_left;
  return q.allowed_attempts - finished(subs).length;
}

export const screens = {};

screens.quiz = {
  tab: 'quizzes',
  title: (d) => d.q.title,
  data: ({ cid, qid }) => ({
    q: `courses/${cid}/quizzes/${qid}`,
    subs: { path: `courses/${cid}/quizzes/${qid}/submissions`, optional: true },
  }),
  render({ q, subs: raw_ }, { cid, qid }) {
    const subs = subsOf(raw_);
    const reasons = quizRestrictions(q);
    const current = inProgress(subs);
    const left = attemptsLeft(q, subs);
    const done = finished(subs).sort((a, b) => b.attempt - a.attempt);
    const canStart = !q.locked_for_user && left > 0;
    return html`
      <article class="detail">
        <h1>${q.title}</h1>
        <div class="meta">
          <span><b>Due</b> ${q.due_at ? when(q.due_at) : 'No due date'}</span>
          ${q.points_possible != null ? html`<span><b>Points</b> ${num(q.points_possible)}</span>` : ''}
          <span><b>Questions</b> ${q.question_count ?? '–'}</span>
          <span><b>Time limit</b> ${q.time_limit ? `${q.time_limit} min` : 'None'}</span>
          <span><b>Attempts</b> ${q.allowed_attempts > 0 ? `${done.length}/${q.allowed_attempts}` : 'Unlimited'}</span>
          ${q.lock_at ? html`<span><b>Available until</b> ${when(q.lock_at)}</span>` : ''}
          <a href="${q.html_url}" target="_blank" rel="noopener">Open in Canvas ${ext}</a>
        </div>
        ${q.description ? html`<section class="card prose">${sanitize(q.description)}</section>` : ''}
        ${q.locked_for_user ? html`<div class="card callout">${q.lock_explanation ? sanitize(q.lock_explanation) : 'This quiz is locked.'}</div>` : ''}
        ${reasons.length ? html`
          <div class="card callout quiz">
            <div><b>Take this quiz on Canvas.</b> It uses ${reasons.join(', ')}, which only the official site can enforce.</div>
            <a class="btn primary" href="${q.html_url}" target="_blank" rel="noopener">Take quiz on Canvas ${ext}</a>
          </div>`
        : current ? html`
          <div class="card callout quiz">
            <div><b>You have an attempt in progress.</b>${current.end_at ? ` Time runs out ${when(current.end_at)}.` : ''}</div>
            <a class="btn primary" href="#/c/${cid}/q/${qid}/take">Resume quiz</a>
          </div>`
        : canStart ? html`
          <div class="card callout quiz">
            <div>${q.time_limit ? html`<b>${q.time_limit}-minute time limit.</b> The timer starts when you begin and keeps running if you leave.` : 'Your answers save as you go.'}</div>
            <button class="btn primary" data-act="quiz-start" data-cid="${cid}" data-qid="${qid}" data-limit="${q.time_limit || ''}">
              ${done.length ? 'Retake quiz' : 'Start quiz'}</button>
          </div>`
        : !q.locked_for_user ? html`<div class="card callout">No attempts left.</div>` : ''}
        ${done.length ? html`<section class="card"><h2>Your attempts</h2>
          <table class="rubric"><tbody>${done.map((s) => html`
            <tr><td><b>Attempt ${s.attempt}</b><div class="muted">${s.finished_at ? when(s.finished_at) : ''}${s.workflow_state === 'pending_review' ? ' · waiting for grading' : ''}</div></td>
            <td class="rpts">${s.score != null ? num(s.score) : '–'} / ${num(s.quiz_points_possible ?? q.points_possible)}</td></tr>`)}
          </tbody></table>
          ${done[0]?.kept_score != null ? html`<p class="muted">Kept score: ${num(done[0].kept_score)}</p>` : ''}
          <a href="${q.html_url}" target="_blank" rel="noopener">See results and answers on Canvas ${ext}</a></section>` : ''}
      </article>`;
  },
};

screens.quizTake = {
  tab: 'quizzes',
  static: true, // the attempt lives in the DOM; never repaint it from a background refresh
  title: (d) => d.q.title,
  data: ({ cid, qid }) => ({ q: `courses/${cid}/quizzes/${qid}` }),
  render: () => html`<div id="quiz-take"><div class="skeleton"><div></div><div></div><div></div></div></div>`,
  after(el, { q }, params) { runQuiz(el.querySelector('#quiz-take'), q, params); },
};

export const actions = {
  async 'quiz-start'(btn) {
    const { cid, qid, limit } = btn.dataset;
    if (limit && !confirm(`This quiz has a ${limit}-minute time limit. Start now?`)) return;
    btn.disabled = true;
    try {
      const s = await post(`/api/quiz/${cid}/${qid}/start`);
      if (s.submission && s.token) saveToken(s.submission.id, s.token);
      location.hash = `#/c/${cid}/q/${qid}/take`;
    } catch (e) {
      toast(e.message, 'err');
      btn.disabled = false;
    }
  },
};

// ---------- taking a quiz ----------

const TYPES_WITH_BLANKS = new Set(['fill_in_multiple_blanks_question', 'multiple_dropdowns_question']);

function blankIds(q) {
  const ids = new Set((q.answers || []).map((a) => a.blank_id).filter(Boolean));
  for (const m of (q.question_text || '').matchAll(/\[([^\]\s<>]+)\]/g)) ids.add(m[1]);
  return [...ids];
}

function questionBody(q) {
  const saved = q.answer;
  const name = `q${q.id}`;
  const choiceHtml = (a) => a.html ? sanitize(a.html) : html`${a.text}`;
  switch (q.question_type) {
    case 'multiple_choice_question':
    case 'true_false_question':
      return html`<div class="choices">${(q.answers || []).map((a) => html`
        <label class="choice"><input type="radio" name="${name}" value="${a.id}" ${raw(String(saved) === String(a.id) ? 'checked' : '')}><span>${choiceHtml(a)}</span></label>`)}</div>`;
    case 'multiple_answers_question': {
      const set = new Set((saved || []).map(String));
      return html`<div class="choices">${(q.answers || []).map((a) => html`
        <label class="choice"><input type="checkbox" name="${name}" value="${a.id}" ${raw(set.has(String(a.id)) ? 'checked' : '')}><span>${choiceHtml(a)}</span></label>`)}</div>`;
    }
    case 'short_answer_question':
      return html`<input type="text" class="ans" value="${saved ?? ''}" placeholder="Your answer">`;
    case 'numerical_question':
    case 'calculated_question':
      return html`<input type="text" class="ans" inputmode="decimal" value="${saved ?? ''}" placeholder="Number">`;
    case 'essay_question':
      return html`<textarea class="ans" rows="8" placeholder="Your answer">${htmlToText(saved || '')}</textarea>`;
    case 'matching_question': {
      const chosen = new Map((saved || []).map((m) => [String(m.answer_id), String(m.match_id)]));
      return html`<table class="matching"><tbody>${(q.answers || []).map((a) => html`
        <tr><td>${a.text}</td><td><select data-answer="${a.id}"><option value="">Choose…</option>
          ${(q.matches || []).map((m) => html`<option value="${m.match_id}" ${raw(chosen.get(String(a.id)) === String(m.match_id) ? 'selected' : '')}>${m.text}</option>`)}
        </select></td></tr>`)}</tbody></table>`;
    }
    case 'file_upload_question':
      return html`<label class="attach">📎 <input type="file" class="ans-file"><span class="muted">${saved?.length ? 'File uploaded. Choose another to replace it.' : 'Upload a file'}</span></label>`;
    default:
      return '';
  }
}

/** Question text, with [blank] tokens replaced by inputs/dropdowns for the two "blanks" types. */
function questionText(q) {
  let text = sanitize(q.question_text).s;
  if (!TYPES_WITH_BLANKS.has(q.question_type)) return raw(text);
  const saved = q.answer || {};
  const missing = [];
  for (const b of blankIds(q)) {
    let field;
    if (q.question_type === 'multiple_dropdowns_question') {
      const opts = (q.answers || []).filter((a) => a.blank_id === b);
      field = html`<select data-blank="${b}"><option value="">Choose…</option>${opts.map((a) => html`
        <option value="${a.id}" ${raw(String(saved[b]) === String(a.id) ? 'selected' : '')}>${a.text}</option>`)}</select>`.s;
    } else {
      field = html`<input type="text" class="blank" data-blank="${b}" value="${saved[b] ?? ''}" aria-label="${b}">`.s;
    }
    const token = `[${esc(b)}]`;
    if (text.includes(token)) text = text.split(token).join(field);
    else missing.push(html`<label class="blank-line">${b} ${raw(field)}</label>`.s);
  }
  return raw(text + missing.join(''));
}

function collect(fs, q) {
  const t = q.question_type;
  const name = `q${q.id}`;
  switch (t) {
    case 'multiple_choice_question':
    case 'true_false_question': {
      const c = fs.querySelector(`input[name="${name}"]:checked`);
      return c ? Number(c.value) : null;
    }
    case 'multiple_answers_question':
      return [...fs.querySelectorAll(`input[name="${name}"]:checked`)].map((c) => Number(c.value));
    case 'short_answer_question':
      return fs.querySelector('.ans').value;
    case 'numerical_question':
    case 'calculated_question': {
      const v = fs.querySelector('.ans').value.trim();
      return v === '' || Number.isNaN(Number(v)) ? null : Number(v);
    }
    case 'essay_question': {
      const v = fs.querySelector('.ans').value;
      return v.trim() ? textToHtml(v) : '';
    }
    case 'fill_in_multiple_blanks_question':
      return Object.fromEntries([...fs.querySelectorAll('[data-blank]')].map((i) => [i.dataset.blank, i.value]));
    case 'multiple_dropdowns_question':
      return Object.fromEntries([...fs.querySelectorAll('select[data-blank]')].filter((s) => s.value).map((s) => [s.dataset.blank, Number(s.value)]));
    case 'matching_question':
      return [...fs.querySelectorAll('select[data-answer]')].filter((s) => s.value)
        .map((s) => ({ answer_id: Number(s.dataset.answer), match_id: Number(s.value) }));
    default:
      return undefined;
  }
}

function isAnswered(a) {
  if (a == null || a === '') return false;
  if (Array.isArray(a)) return a.length > 0;
  if (typeof a === 'object') return Object.values(a).some((v) => v !== '' && v != null);
  return true;
}

async function runQuiz(box, q, { cid, qid }) {
  const back = `#/c/${cid}/q/${qid}`;
  const stop = (msg, canvas = true) => {
    box.innerHTML = html`<div class="card callout"><div>${msg}</div>
      ${canvas ? html`<a class="btn" href="${q.html_url}" target="_blank" rel="noopener">Open on Canvas ${ext}</a>` : ''}
      <a class="btn" href="${back}">Back to quiz</a></div>`.s;
  };
  const reasons = quizRestrictions(q);
  if (reasons.length) return stop(`This quiz uses ${reasons.join(', ')}, so take it on Canvas.`);

  let session;
  try { session = await getJson(`/api/quiz/${cid}/${qid}/session`); } catch (e) { return stop(e.message); }
  const sub = session.submission;
  if (!sub) return stop('No attempt is in progress.', false);
  const token = session.token || readToken(sub.id);
  if (!token) return stop("This attempt was started somewhere else, so it can't be resumed here. Continue it on Canvas.");
  saveToken(sub.id, token);
  const auth = { attempt: sub.attempt, token };

  let questions;
  try {
    const res = await load(`quiz_submissions/${sub.id}/questions`, { force: true });
    questions = (res.quiz_submission_questions || []).sort((a, b) => a.position - b.position);
  } catch (e) { return stop(e.message); }

  let n = 0;
  box.innerHTML = html`
    <div class="quiz-bar card">
      <div><b>${q.title}</b> <span class="muted" id="quiz-progress"></span></div>
      ${sub.end_at ? html`<div class="timer" id="quiz-timer"></div>` : ''}
      <button class="btn primary" id="quiz-submit">Submit quiz</button>
    </div>
    ${questions.length ? '' : empty('This quiz has no questions.')}
    ${questions.map((x) => {
      const numbered = x.question_type !== 'text_only_question';
      return html`
        <fieldset class="card question" data-qid="${x.id}">
          <div class="q-head">
            ${numbered ? html`<b>Question ${++n}</b>` : ''}
            <span class="save-state muted"></span>
            ${numbered ? html`<button type="button" class="flag ${x.flagged ? 'on' : ''}" aria-pressed="${x.flagged ? 'true' : 'false'}" title="Flag for review">⚑</button>` : ''}
          </div>
          <div class="prose q-text">${questionText(x)}</div>
          ${questionBody(x)}
        </fieldset>`;
    })}
    <div class="quiz-foot"><button class="btn primary" id="quiz-submit-2">Submit quiz</button></div>`.s;

  const byId = new Map(questions.map((x) => [String(x.id), x]));
  const timers = new Map();
  const pending = new Map();
  let closed = false;

  const progress = () => {
    const graded = questions.filter((x) => x.question_type !== 'text_only_question');
    const answered = graded.filter((x) => isAnswered(x.answer)).length;
    const el = box.querySelector('#quiz-progress');
    if (el) el.textContent = `${answered} of ${graded.length} answered`;
  };
  progress();

  const setState = (fs, text, cls = '') => {
    const s = fs.querySelector('.save-state');
    s.textContent = text;
    s.className = `save-state ${cls || 'muted'}`;
  };

  const save = (fs, answer) => {
    const x = byId.get(fs.dataset.qid);
    if (answer === undefined || closed) return Promise.resolve();
    setState(fs, 'Saving…');
    const p = post(`/api/quiz/sub/${sub.id}/answer`, { ...auth, quiz_questions: [{ id: x.id, answer }] })
      .then(() => { x.answer = answer; setState(fs, 'Saved ✓', 'ok'); progress(); })
      .catch((e) => { setState(fs, 'Not saved', 'err'); toast(`Answer not saved: ${e.message}`, 'err'); });
    pending.set(fs.dataset.qid, p);
    return p;
  };

  const schedule = (fs, delay) => {
    clearTimeout(timers.get(fs.dataset.qid));
    timers.set(fs.dataset.qid, setTimeout(() => {
      timers.delete(fs.dataset.qid);
      save(fs, collect(fs, byId.get(fs.dataset.qid)));
    }, delay));
  };

  const flush = async () => {
    for (const [qid2, t] of timers) {
      clearTimeout(t);
      const fs = box.querySelector(`fieldset[data-qid="${qid2}"]`);
      save(fs, collect(fs, byId.get(qid2)));
    }
    timers.clear();
    await Promise.all(pending.values());
  };

  box.addEventListener('input', (e) => {
    const fs = e.target.closest('fieldset.question');
    if (fs && e.target.type !== 'file') schedule(fs, e.target.matches('input[type=text], textarea') ? 900 : 0);
  });
  box.addEventListener('change', async (e) => {
    const fs = e.target.closest('fieldset.question');
    if (!fs) return;
    if (e.target.classList.contains('ans-file')) {
      const f = e.target.files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      setState(fs, 'Uploading…');
      try {
        const r = await upload(`/api/quiz/${cid}/${qid}/upload`, fd);
        e.target.nextElementSibling.textContent = `Uploaded ${f.name}`;
        save(fs, [r.id]);
      } catch (err) { setState(fs, 'Upload failed', 'err'); toast(err.message, 'err'); }
      return;
    }
    if (!e.target.matches('input[type=text], textarea')) schedule(fs, 0);
  });
  box.addEventListener('click', async (e) => {
    const flag = e.target.closest('.flag');
    if (!flag) return;
    const on = !flag.classList.contains('on');
    flag.classList.toggle('on', on);
    flag.setAttribute('aria-pressed', on ? 'true' : 'false');
    try {
      await post(`/api/quiz/sub/${sub.id}/flag/${flag.closest('fieldset').dataset.qid}`, { ...auth, flag: on });
    } catch (err) { flag.classList.toggle('on', !on); toast(err.message, 'err'); }
  });

  let tick;
  const finish = async (auto) => {
    if (closed) return;
    if (!auto) {
      const unanswered = questions.filter((x) => x.question_type !== 'text_only_question' && !isAnswered(x.answer)).length;
      const msg = unanswered ? `You have ${unanswered} unanswered question${unanswered > 1 ? 's' : ''}. Submit anyway?` : 'Submit your quiz?';
      if (!confirm(msg)) return;
    }
    box.querySelectorAll('#quiz-submit, #quiz-submit-2').forEach((b) => { b.disabled = true; });
    await flush();
    closed = true;
    clearInterval(tick);
    try {
      await post(`/api/quiz/${cid}/${qid}/complete/${sub.id}`, auth);
      try { sessionStorage.removeItem(tokenKey(sub.id)); } catch { /* ignore */ }
      toast(auto ? "Time's up: quiz submitted" : 'Quiz submitted ✓', 'ok');
    } catch (err) {
      toast(`Submit failed: ${err.message}`, 'err');
    }
    location.hash = back;
    hooks.render(true);
  };
  box.querySelector('#quiz-submit').addEventListener('click', () => finish(false));
  box.querySelector('#quiz-submit-2').addEventListener('click', () => finish(false));

  if (sub.end_at) {
    const end = new Date(sub.end_at).getTime();
    const timerEl = box.querySelector('#quiz-timer');
    const update = () => {
      if (!box.isConnected) { clearInterval(tick); return; }
      const ms = end - Date.now();
      if (ms <= 0) { timerEl.textContent = '0:00'; finish(true); return; }
      const s = Math.floor(ms / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      timerEl.textContent = `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')} left`;
      timerEl.classList.toggle('low', ms < 120000);
    };
    update();
    tick = setInterval(update, 1000);
  }
}
