// Grades: overview, per-course grades with what-if scores, and GPA tracking.
import { post } from './api.js';
import { html, raw, when, num, canvasUrl } from './html.js';
import { state, hooks, course, dot, ext, empty, enrollment, gradeText, toast, COURSES } from './ui.js';

export const PREF_PATH = 'users/self/custom_data/gpa?ns=com.easel.app';
const PAST = 'courses?enrollment_state=completed&include[]=total_scores&include[]=term';
const groupsPath = (cid) => `courses/${cid}/assignment_groups?include[]=assignments&include[]=submission`;

// Canvas's default letter scheme (fraction of 100%).
const DEFAULT_SCHEME = [['A', 0.94], ['A-', 0.9], ['B+', 0.87], ['B', 0.84], ['B-', 0.8], ['C+', 0.77], ['C', 0.74],
  ['C-', 0.7], ['D+', 0.67], ['D', 0.64], ['D-', 0.61], ['F', 0]];
const LETTERS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'];
const STANDARD = { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0 };
const SCALES = {
  standard: { label: '4.0 scale with + / −', points: STANDARD },
  aplus: { label: '4.3 scale (A+ = 4.3)', points: { ...STANDARD, 'A+': 4.3 } },
  simple: { label: '4.0 scale, no + / −', points: { 'A+': 4, A: 4, 'A-': 4, 'B+': 3, B: 3, 'B-': 3, 'C+': 2, C: 2, 'C-': 2, 'D+': 1, D: 1, 'D-': 1, F: 0 } },
};

// ---------- grade math ----------

function schemeFor(c, standards) {
  const s = c?.grading_standard_id && (standards || []).find((x) => String(x.id) === String(c.grading_standard_id));
  const list = (s?.grading_scheme || []).map((e) => [e.name, Number(e.value)]);
  return list.length ? list.sort((a, b) => b[1] - a[1]) : DEFAULT_SCHEME;
}

function letterFor(pct, scheme = DEFAULT_SCHEME) {
  if (pct == null) return null;
  const f = Math.round(pct * 100) / 10000; // Canvas compares the score rounded to 2 decimals
  for (const [name, min] of scheme) if (f >= min - 1e-9) return name;
  return scheme[scheme.length - 1][0];
}

/** Drop lowest/highest by percentage, never dropping `never_drop` items or the last one left. */
function applyDrops(items, rules) {
  const never = new Set((rules.never_drop || []).map(String));
  const fixed = items.filter((i) => never.has(String(i.id)));
  const ratio = (i) => (i.possible ? i.score / i.possible : Infinity);
  let pool = items.filter((i) => !never.has(String(i.id))).sort((a, b) => ratio(a) - ratio(b));
  pool = pool.slice(Math.min(rules.drop_lowest || 0, Math.max(0, pool.length - 1)));
  pool = pool.slice(0, pool.length - Math.min(rules.drop_highest || 0, Math.max(0, pool.length - 1)));
  return [...fixed, ...pool];
}

/** Current grade the way Canvas computes it: graded work only, group weights renormalised over groups with grades. */
function computeGrade(groups, weighted, whatif = {}) {
  let earned = 0, possible = 0, wSum = 0, wTotal = 0;
  const perGroup = new Map();
  const dropped = new Set();
  for (const g of groups) {
    const items = [];
    for (const a of g.assignments || []) {
      const s = a.submission || {};
      if (a.omit_from_final_grade || a.grading_type === 'not_graded' || s.excused) continue;
      const w = whatif[a.id];
      const score = w != null && w !== '' ? Number(w) : s.score;
      if (score == null || Number.isNaN(score)) continue;
      items.push({ id: a.id, score, possible: a.points_possible || 0 });
    }
    const kept = applyDrops(items, g.rules || {});
    items.filter((i) => !kept.includes(i)).forEach((i) => dropped.add(String(i.id)));
    const gs = kept.reduce((x, i) => x + i.score, 0);
    const gp = kept.reduce((x, i) => x + i.possible, 0);
    perGroup.set(String(g.id), gp ? (gs / gp) * 100 : null);
    earned += gs;
    possible += gp;
    if (weighted && gp > 0) {
      wTotal += (g.group_weight || 0) * (gs / gp);
      wSum += g.group_weight || 0;
    }
  }
  const pct = weighted ? (wSum ? (wTotal / wSum) * 100 : null) : (possible ? (earned / possible) * 100 : null);
  return { pct, perGroup, dropped };
}

// ---------- what-if storage (this device only, like Canvas's own what-if) ----------

const wiKey = (cid) => `easel.whatif.${cid}`;
function readWhatIf(cid) { try { return JSON.parse(localStorage.getItem(wiKey(cid)) || '{}'); } catch { return {}; } }
function writeWhatIf(cid, v) {
  try { Object.keys(v).length ? localStorage.setItem(wiKey(cid), JSON.stringify(v)) : localStorage.removeItem(wiKey(cid)); } catch { /* private mode */ }
}

const fmtPct = (p) => (p == null ? '–' : `${num(Math.round(p * 100) / 100)}%`);

// ---------- GPA prefs (saved to the user's Canvas account) ----------

let prefs = null;
let dirty = false;
let saveTimer;

function withDefaults(p) {
  return { scale: 'standard', custom: { ...STANDARD }, courses: {}, prior: { credits: '', gpa: '' }, ...(p || {}) };
}

function scalePoints(p) {
  return p.scale === 'custom' ? p.custom : (SCALES[p.scale] || SCALES.standard).points;
}

function savePrefs() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await post('/api/prefs/gpa', { data: prefs });
      dirty = false;
    } catch (e) { toast(`GPA settings not saved: ${e.message}`, 'err'); }
  }, 600);
}

function courseEntry(c, completed) {
  const e = enrollment(c) || {};
  const score = completed ? (e.computed_final_score ?? e.computed_current_score) : e.computed_current_score;
  const grade = completed ? (e.computed_final_grade ?? e.computed_current_grade) : e.computed_current_grade;
  const auto = !c.hide_final_grades && (LETTERS.includes(grade) ? grade : letterFor(score));
  return { c, completed, score: c.hide_final_grades ? null : score, auto: auto || null };
}

function gpaOf(entries, p) {
  const pts = scalePoints(p);
  let qp = 0, cr = 0, wqp = 0, anyBonus = false;
  for (const x of entries) {
    const cp = p.courses[x.c.id] || {};
    const letter = cp.letter || x.auto;
    const credits = Number(cp.credits);
    if (cp.include === false || !credits || letter === 'none' || pts[letter] == null) continue;
    const bonus = Number(cp.bonus) || 0;
    if (bonus) anyBonus = true;
    qp += pts[letter] * credits;
    wqp += (pts[letter] + bonus) * credits;
    cr += credits;
  }
  return { qp, wqp, cr, gpa: cr ? qp / cr : null, weighted: anyBonus && cr ? wqp / cr : null };
}

function withPrior(g, p) {
  const pc = Number(p.prior.credits) || 0;
  const pg = Number(p.prior.gpa);
  if (!pc || Number.isNaN(pg)) return g;
  const cr = g.cr + pc;
  return { ...g, cr, gpa: (g.qp + pg * pc) / cr, weighted: g.weighted == null ? null : (g.wqp + pg * pc) / cr };
}

const gpaText = (v) => (v == null ? '–' : v.toFixed(2));

// ---------- screens ----------

export const screens = {};

screens.grades = {
  title: () => 'Grades',
  data: () => ({ courses: COURSES, prefs: { path: PREF_PATH, optional: true } }),
  render({ prefs: pd }) {
    const p = withDefaults(prefs && dirty ? prefs : pd?.data);
    const term = gpaOf(state.courses.map((c) => courseEntry(c, false)), p);
    return html`
      <a class="card gpa-card" href="#/gpa">
        <div><div class="muted">GPA this term</div><div class="big-grade">${gpaText(term.gpa)}</div></div>
        <span class="btn ghost small">${term.cr ? 'GPA tracker →' : 'Set up GPA →'}</span>
      </a>
      <div class="card list">${state.courses.map((c) => html`
        <a class="row" href="#/c/${c.id}/grades">${dot(c.id)}
          <div class="grow"><div class="t">${c.name}</div><div class="sub">${c.course_code}</div></div>
          <span class="grade">${gradeText(c) || (c.hide_final_grades ? 'Hidden' : '–')}</span></a>`)}</div>`;
  },
};

screens.courseGrades = {
  tab: 'grades',
  title: (_d, p) => course(p.cid)?.name || 'Grades',
  data: ({ cid }) => ({
    groups: groupsPath(cid), courses: COURSES,
    standards: { path: `courses/${cid}/grading_standards`, optional: true },
  }),
  render({ groups, standards }, { cid }) {
    const c = course(cid);
    const weighted = !!c?.apply_assignment_group_weights;
    const scheme = schemeFor(c, standards);
    const wi = readWhatIf(cid);
    const real = computeGrade(groups, weighted);
    const sim = computeGrade(groups, weighted, wi);
    const canvasScore = enrollment(c)?.computed_current_score;
    const mismatch = canvasScore != null && real.pct != null && Math.abs(canvasScore - real.pct) > 0.5;
    const anyWi = Object.keys(wi).length > 0;
    return html`<div class="grades-page">
      <div class="card grade-summary whatif-summary" data-cid="${cid}">
        <div class="gs-cols">
          <div><div class="muted">Current grade</div><div class="big-grade">${gradeText(c) || '–'}</div></div>
          <div class="wi-col" ${raw(anyWi ? '' : 'hidden')}><div class="muted">What-if grade</div>
            <div class="big-grade accent" data-calc="whatif">${fmtPct(sim.pct)}${sim.pct != null ? ' · ' + letterFor(sim.pct, scheme) : ''}</div></div>
        </div>
        <p class="muted small">Type a score next to any assignment to see how it would change your grade. What-if scores stay on this device and are never sent to Canvas.</p>
        ${mismatch ? html`<p class="muted small">Easel calculates ${fmtPct(real.pct)} from what it can see, and Canvas shows ${fmtPct(canvasScore)}. Your teacher may use settings that aren't visible to students, so treat what-if results as an estimate.</p>` : ''}
        <div class="gs-actions">
          <button class="btn small" data-act="whatif-reset" data-cid="${cid}" ${raw(anyWi ? '' : 'hidden')}>Reset what-if scores</button>
          <a href="${canvasUrl(`/courses/${cid}/grades`)}" target="_blank" rel="noopener">Grades in Canvas ${ext}</a>
        </div>
      </div>
      ${groups.map((g) => {
        const rules = g.rules || {};
        const notes = [weighted && g.group_weight ? `${num(g.group_weight)}% of grade` : '',
          rules.drop_lowest ? `drops lowest ${rules.drop_lowest}` : '', rules.drop_highest ? `drops highest ${rules.drop_highest}` : ''].filter(Boolean);
        return html`
        <section><h2>${g.name} <span class="muted" data-group-pct="${g.id}">${fmtPct(sim.perGroup.get(String(g.id)))}</span>
          ${notes.length ? html`<span class="muted small"> · ${notes.join(' · ')}</span>` : ''}</h2>
        <div class="card list">${(g.assignments || []).map((a) => {
          const s = a.submission || {};
          const excluded = a.omit_from_final_grade || a.grading_type === 'not_graded';
          const w = wi[a.id];
          return html`<div class="row grade-row ${w != null ? 'is-whatif' : ''} ${sim.dropped.has(String(a.id)) ? 'is-dropped' : ''}" data-aid="${a.id}">
            <a class="rowlink" href="${a.quiz_id ? `#/c/${cid}/q/${a.quiz_id}` : `#/c/${cid}/a/${a.id}`}">
              <div class="grow"><div class="t">${a.name}</div><div class="sub">${a.due_at ? 'Due ' + when(a.due_at) : ''}</div></div></a>
            <div class="badges">${s.missing ? html`<span class="badge red">Missing</span>` : ''}${s.late ? html`<span class="badge orange">Late</span>` : ''}
              <span class="badge dropped-badge">Dropped</span></div>
            ${s.excused ? html`<span class="grade">Excused</span>`
              : excluded ? html`<span class="grade muted">Not counted</span>`
              : html`<span class="grade score-edit"><input type="number" step="any" min="0" class="wi-input" data-aid="${a.id}"
                  value="${w ?? s.score ?? ''}" placeholder="–" aria-label="Score for ${a.name}"> / ${num(a.points_possible)}</span>`}
          </div>`;
        })}</div></section>`;
      })}</div>`;
  },
  after(main, { groups, standards }, { cid }) {
    const el = main.querySelector('.grades-page');
    const c = course(cid);
    const weighted = !!c?.apply_assignment_group_weights;
    const scheme = schemeFor(c, standards);
    const scores = new Map(groups.flatMap((g) => g.assignments || []).map((a) => [String(a.id), a.submission?.score]));
    el.addEventListener('input', (e) => {
      if (!e.target.classList.contains('wi-input')) return;
      const wi = readWhatIf(cid);
      const id = e.target.dataset.aid;
      const v = e.target.value;
      const real = scores.get(id);
      if (v === '' || Number(v) === real) delete wi[id];
      else wi[id] = Number(v);
      writeWhatIf(cid, wi);
      const sim = computeGrade(groups, weighted, wi);
      const any = Object.keys(wi).length > 0;
      el.querySelector('[data-calc=whatif]').textContent = `${fmtPct(sim.pct)}${sim.pct != null ? ' · ' + letterFor(sim.pct, scheme) : ''}`;
      el.querySelector('.wi-col').hidden = !any;
      el.querySelector('[data-act=whatif-reset]').hidden = !any;
      for (const [gid, pct] of sim.perGroup) {
        const g = el.querySelector(`[data-group-pct="${gid}"]`);
        if (g) g.textContent = fmtPct(pct);
      }
      el.querySelectorAll('.grade-row').forEach((r) => {
        r.classList.toggle('is-whatif', wi[r.dataset.aid] != null);
        r.classList.toggle('is-dropped', sim.dropped.has(r.dataset.aid));
      });
    });
  },
};

screens.gpa = {
  title: () => 'GPA',
  data: () => ({ courses: COURSES, past: { path: PAST, optional: true }, prefs: { path: PREF_PATH, optional: true } }),
  render({ past, prefs: pd }) {
    if (!dirty) prefs = withDefaults(pd?.data);
    const p = prefs;
    const current = state.courses.map((c) => courseEntry(c, false));
    const done = (past || []).filter((c) => c.name && !c.access_restricted_by_date).map((c) => courseEntry(c, true));
    const byTerm = new Map();
    for (const x of done) {
      const t = x.c.term?.name || 'Other';
      byTerm.has(t) || byTerm.set(t, { start: x.c.term?.start_at || '', list: [] });
      byTerm.get(t).list.push(x);
    }
    const terms = [...byTerm].sort((a, b) => String(b[1].start).localeCompare(String(a[1].start)));
    const row = (x) => {
      const cp = p.courses[x.c.id] || {};
      return html`
        <div class="row gpa-row ${cp.include === false ? 'off' : ''}" data-cid="${x.c.id}">
          <input type="checkbox" class="g-include" ${raw(cp.include === false ? '' : 'checked')} aria-label="Count ${x.c.name}">
          ${dot(x.c.id)}
          <div class="grow"><div class="t">${x.c.name}</div>
            <div class="sub">${x.score != null ? fmtPct(x.score) : 'No grade yet'}${x.auto ? ` · Canvas: ${x.auto}` : ''}</div></div>
          <label class="g-field">Grade
            <select class="g-letter">
              <option value="">${x.auto ? `Auto (${x.auto})` : 'Auto (none)'}</option>
              ${LETTERS.map((l) => html`<option value="${l}" ${raw(cp.letter === l ? 'selected' : '')}>${l}</option>`)}
              <option value="none" ${raw(cp.letter === 'none' ? 'selected' : '')}>Pass/fail (no GPA)</option>
            </select></label>
          <label class="g-field">Credits <input type="number" class="g-credits" min="0" step="0.5" value="${cp.credits ?? ''}" placeholder="0"></label>
          <label class="g-field narrow" title="Extra points for honors/AP weighting, e.g. 0.5 or 1">Bonus <input type="number" class="g-bonus" min="0" step="0.5" value="${cp.bonus ?? ''}" placeholder="0"></label>
          <span class="g-points grade"></span>
        </div>`;
    };
    return html`<div class="gpa-page">
      <div class="gpa-summary">
        <div class="card"><div class="muted">Cumulative GPA</div><div class="big-grade" data-gpa="cum">–</div><div class="muted small" data-gpa="cum-cr"></div></div>
        <div class="card"><div class="muted">This term</div><div class="big-grade" data-gpa="term">–</div><div class="muted small" data-gpa="term-cr"></div></div>
      </div>
      <p class="muted small">Enter the credit hours for each course to count it. Grades come from Canvas (your current grade, or the final grade for finished courses). Pick a letter to override one, for example to match your transcript or to try a what-if. Settings are saved to your Canvas account, so they show up on all your devices. Only you can see them.</p>
      <section class="card gpa-settings">
        <label class="g-field">Scale
          <select class="g-scale">${Object.entries(SCALES).map(([k, s]) => html`<option value="${k}" ${raw(p.scale === k ? 'selected' : '')}>${s.label}</option>`)}
            <option value="custom" ${raw(p.scale === 'custom' ? 'selected' : '')}>Custom</option></select></label>
        <div class="custom-scale" ${raw(p.scale === 'custom' ? '' : 'hidden')}>${LETTERS.map((l) => html`
          <label class="g-field narrow">${l} <input type="number" step="0.01" min="0" class="g-custom" data-letter="${l}" value="${p.custom[l] ?? ''}"></label>`)}</div>
        <div class="prior"><b>Earlier credits</b> <span class="muted small">(before Canvas, or transferred)</span>
          <label class="g-field">Credits <input type="number" class="g-prior-cr" min="0" step="0.5" value="${p.prior.credits}"></label>
          <label class="g-field">GPA <input type="number" class="g-prior-gpa" min="0" step="0.01" value="${p.prior.gpa}"></label></div>
      </section>
      <h2>In progress</h2>
      ${current.length ? html`<div class="card list">${current.map(row)}</div>` : empty('No active courses.')}
      ${terms.map(([name, t]) => html`<h2>${name} <span class="muted" data-term-gpa="${name}"></span></h2><div class="card list">${t.list.map(row)}</div>`)}
      ${past == null ? html`<p class="muted small">Couldn't load finished courses from Canvas.</p>` : ''}</div>`;
  },
  after(main, { past }) {
    const el = main.querySelector('.gpa-page');
    const current = state.courses.map((c) => courseEntry(c, false));
    const done = (past || []).filter((c) => c.name && !c.access_restricted_by_date).map((c) => courseEntry(c, true));
    const all = new Map([...current, ...done].map((x) => [String(x.c.id), x]));
    const update = () => {
      const p = prefs;
      const pts = scalePoints(p);
      const term = gpaOf(current, p);
      const cum = withPrior(gpaOf([...current, ...done], p), p);
      const set = (k, v) => { const n = el.querySelector(`[data-gpa="${k}"]`); if (n) n.textContent = v; };
      set('term', gpaText(term.gpa) + (term.weighted != null ? ` · ${gpaText(term.weighted)} weighted` : ''));
      set('cum', gpaText(cum.gpa) + (cum.weighted != null ? ` · ${gpaText(cum.weighted)} weighted` : ''));
      set('term-cr', term.cr ? `${num(term.cr)} credits` : 'No credits entered yet');
      set('cum-cr', cum.cr ? `${num(cum.cr)} credits` : 'No credits entered yet');
      el.querySelectorAll('[data-term-gpa]').forEach((h) => {
        const list = done.filter((x) => (x.c.term?.name || 'Other') === h.dataset.termGpa);
        const g = gpaOf(list, p);
        h.textContent = g.gpa != null ? `GPA ${gpaText(g.gpa)}` : '';
      });
      el.querySelectorAll('.gpa-row').forEach((r) => {
        const x = all.get(r.dataset.cid);
        const cp = p.courses[r.dataset.cid] || {};
        const letter = cp.letter || x.auto;
        const counted = cp.include !== false && Number(cp.credits) > 0 && letter !== 'none' && pts[letter] != null;
        r.classList.toggle('off', !counted);
        r.querySelector('.g-points').textContent = counted ? `${num(pts[letter])} pts` : '';
      });
    };
    update();
    el.addEventListener('input', (e) => {
      const t = e.target;
      const r = t.closest('.gpa-row');
      if (r) {
        const cp = (prefs.courses[r.dataset.cid] ||= {});
        if (t.classList.contains('g-include')) cp.include = t.checked;
        if (t.classList.contains('g-letter')) cp.letter = t.value || undefined;
        if (t.classList.contains('g-credits')) cp.credits = t.value === '' ? undefined : Number(t.value);
        if (t.classList.contains('g-bonus')) cp.bonus = t.value === '' ? undefined : Number(t.value);
      } else if (t.classList.contains('g-scale')) {
        prefs.scale = t.value;
        el.querySelector('.custom-scale').hidden = t.value !== 'custom';
      } else if (t.classList.contains('g-custom')) {
        prefs.custom[t.dataset.letter] = t.value === '' ? undefined : Number(t.value);
      } else if (t.classList.contains('g-prior-cr')) {
        prefs.prior.credits = t.value;
      } else if (t.classList.contains('g-prior-gpa')) {
        prefs.prior.gpa = t.value;
      } else return;
      savePrefs();
      update();
    });
  },
};

export const actions = {
  'whatif-reset'(btn) {
    writeWhatIf(btn.dataset.cid, {});
    hooks.render();
  },
};
