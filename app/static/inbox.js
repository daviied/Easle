// Inbox: Canvas conversations (list, thread, reply, compose, attachments).
import { load, post, upload } from './api.js';
import { html, ago, when } from './html.js';
import { state, toast, empty, hooks, dotCode, refreshUnread, COURSES, GROUPS } from './ui.js';

const SCOPES = [['inbox', 'Inbox'], ['unread', 'Unread'], ['sent', 'Sent'], ['archived', 'Archived']];
const scopeOf = (q) => SCOPES.some(([s]) => s === q?.get('scope')) ? q.get('scope') : 'inbox';

const others = (c) => (c.participants || []).filter((p) => p.id !== state.meId);
const names = (c) => others(c).map((p) => p.name).join(', ') || 'Just you';

function body(text) {
  return html`<div class="msg-body">${text || ''}</div>`;
}

function attachments(list) {
  return (list || []).map((f) => html`<a class="file" href="/api/file/${f.id}?inline=1" target="_blank" rel="noopener">📎 ${f.display_name}</a>`);
}

/** Upload picked files to the user's "conversation attachments" folder; returns their ids. */
async function uploadAll(input, bar) {
  const ids = [];
  const files = [...(input?.files || [])];
  for (let i = 0; i < files.length; i++) {
    const fd = new FormData();
    fd.append('file', files[i]);
    if (bar) bar.hidden = false;
    const r = await upload('/api/inbox/upload', fd, (p) => {
      if (bar) bar.firstElementChild.style.width = `${Math.round(((i + p) / files.length) * 100)}%`;
    });
    ids.push(r.id);
  }
  return ids;
}

export const screens = {};

screens.inbox = {
  title: () => 'Inbox',
  data: ({ q }) => ({ list: `conversations?scope=${scopeOf(q)}&per_page=50&_pages=1` }),
  render({ list }, { q }) {
    const scope = scopeOf(q);
    return html`
      <div class="inbox-head">
        <nav class="tabs">${SCOPES.map(([s, label]) => html`<a href="#/inbox?scope=${s}" class="${s === scope ? 'on' : ''}">${label}</a>`)}</nav>
        <a class="btn primary" href="#/inbox/new">✏️ New message</a>
      </div>
      ${list.length ? html`<div class="card list">${list.map((c) => html`
        <a class="row ${c.workflow_state === 'unread' ? 'unread' : ''}" href="#/inbox/${c.id}">
          ${c.context_code ? dotCode(c.context_code) : ''}
          <div class="grow">
            <div class="t">${names(c)}${c.message_count > 1 ? html` <span class="muted">(${c.message_count})</span>` : ''}</div>
            <div class="sub"><b>${c.subject || '(no subject)'}</b>${c.context_name ? ' · ' + c.context_name : ''}</div>
            <div class="preview">${c.last_message || ''}</div>
          </div>
          <span class="pts">${ago(c.last_message_at || c.last_authored_message_at)}${c.has_attachments ? ' 📎' : ''}</span>
        </a>`)}</div>` : empty(scope === 'unread' ? 'No unread messages.' : 'No messages here.')}`;
  },
  after() { refreshUnread(); },
};

screens.conversation = {
  title: (d) => d.c.subject || '(no subject)',
  // auto_mark_as_read=false so hover-prefetching never marks a thread read; we mark it when opened.
  data: ({ id }) => ({ c: `conversations/${id}?auto_mark_as_read=false` }),
  render({ c }) {
    const people = new Map((c.participants || []).map((p) => [p.id, p]));
    const msgs = [...(c.messages || [])].reverse();
    return html`
      <article class="detail">
        <h1>${c.subject || '(no subject)'}</h1>
        <div class="meta"><span>${names(c)}</span>${c.context_name ? html`<span>${c.context_name}</span>` : ''}
          <button class="link-btn" data-act="conv-state" data-id="${c.id}" data-state="unread">Mark unread</button>
          <button class="link-btn" data-act="conv-state" data-id="${c.id}" data-state="${c.workflow_state === 'archived' ? 'read' : 'archived'}">
            ${c.workflow_state === 'archived' ? 'Unarchive' : 'Archive'}</button></div>
        <div class="thread">${msgs.map((m) => {
          const mine = m.author_id === state.meId;
          return html`<div class="msg ${mine ? 'mine' : ''}">
            <div class="cmeta"><b>${people.get(m.author_id)?.name || 'Someone'}</b> · ${when(m.created_at)}</div>
            ${body(m.body)}${attachments(m.attachments)}
            ${m.media_comment ? html`<a class="file" href="${m.media_comment.url}" target="_blank" rel="noopener">🎬 Media message</a>` : ''}
          </div>`;
        })}</div>
        <form class="card inline-form col" data-form="conv-reply" data-id="${c.id}">
          <textarea name="body" rows="4" placeholder="Reply to everyone…" required></textarea>
          <label class="attach">📎 <input type="file" name="files" multiple><span class="muted">Attach files</span></label>
          <div class="progress" hidden><div></div></div>
          <button class="btn primary">Send</button>
        </form>
      </article>`;
  },
  after(_el, { c }) {
    if (c.workflow_state === 'unread') {
      post(`/api/inbox/${c.id}/state`, { state: 'read' }).then(() => refreshUnread(true)).catch(() => {});
    }
  },
};

// ----- compose -----

const draft = { to: new Map() };
let searchTimer;

screens.compose = {
  title: () => 'New message',
  static: true, // interactive form: never repaint it from a background refresh
  data: () => ({ courses: COURSES, userGroups: { path: GROUPS, optional: true } }),
  render(_d, { q }) {
    draft.to = new Map();
    if (q?.get('to')) draft.to.set(q.get('to'), q.get('name') || q.get('to'));
    const ctx = q?.get('ctx') || '';
    return html`
      <form class="card compose" data-form="compose" autocomplete="off">
        <label>Course or group
          <select name="context">
            <option value="">Any</option>
            ${state.courses.map((c) => html`<option value="course_${c.id}" ${ctx === `course_${c.id}` ? 'selected' : ''}>${c.name}</option>`)}
            ${state.groups.map((g) => html`<option value="group_${g.id}" ${ctx === `group_${g.id}` ? 'selected' : ''}>${g.name}</option>`)}
          </select></label>
        <label>To
          <div class="chips" id="to-chips"></div>
          <input type="text" id="to-search" placeholder="Search people, or pick a course first to see its roles">
          <div class="results card list" id="to-results" hidden></div></label>
        <label class="check-line" id="individual-line" hidden><input type="checkbox" name="individual"> Send an individual message to each recipient</label>
        <input type="text" name="subject" placeholder="Subject">
        <textarea name="body" rows="8" placeholder="Message" required></textarea>
        <label class="attach">📎 <input type="file" name="files" multiple><span class="muted">Attach files</span></label>
        <div class="progress" hidden><div></div></div>
        <button class="btn primary" type="submit">Send</button>
      </form>`;
  },
  after(el) {
    const search = el.querySelector('#to-search');
    const results = el.querySelector('#to-results');
    const ctxSel = el.querySelector('select[name=context]');
    drawChips(el);
    const run = async () => {
      const term = search.value.trim();
      const ctx = ctxSel.value;
      if (!term && !ctx) { results.hidden = true; return; }
      const qs = new URLSearchParams({ search: term, per_page: '20', _pages: '1' });
      if (ctx) qs.set('context', ctx);
      try {
        const list = await load(`search/recipients?${qs}`);
        results.innerHTML = list.length ? list.map((r) => html`
          <button type="button" class="row" data-act="to-add" data-id="${r.id}" data-name="${r.name}">
            ${r.avatar_url ? html`<img class="avatar" src="${r.avatar_url}" alt="">` : html`<span class="ico">${r.type === 'context' ? '👥' : '👤'}</span>`}
            <div class="grow"><div class="t">${r.name}</div>${r.user_count ? html`<div class="sub">${r.user_count} people</div>` : ''}</div>
          </button>`.s).join('') : '<div class="row muted">No matches</div>';
        results.hidden = false;
      } catch (e) { toast(e.message, 'err'); }
    };
    search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(run, 250); });
    search.addEventListener('focus', run);
    ctxSel.addEventListener('change', run);
  },
};

function drawChips(el = document) {
  const box = el.querySelector('#to-chips');
  if (!box) return;
  box.innerHTML = [...draft.to].map(([id, name]) => html`
    <span class="chip">${name}<button type="button" data-act="to-remove" data-id="${id}" aria-label="Remove ${name}">×</button></span>`.s).join('');
  const line = el.querySelector('#individual-line');
  if (line) line.hidden = draft.to.size < 2;
}

export const actions = {
  'to-add'(btn) {
    draft.to.set(btn.dataset.id, btn.dataset.name);
    drawChips();
    const s = document.querySelector('#to-search');
    s.value = '';
    document.querySelector('#to-results').hidden = true;
    s.focus();
  },
  'to-remove'(btn) {
    draft.to.delete(btn.dataset.id);
    drawChips();
  },
  async 'conv-state'(btn) {
    try {
      await post(`/api/inbox/${btn.dataset.id}/state`, { state: btn.dataset.state });
      refreshUnread(true);
      if (btn.dataset.state === 'read') { toast('Moved to inbox', 'ok'); hooks.render(true); return; }
      toast(btn.dataset.state === 'archived' ? 'Archived' : 'Marked unread', 'ok');
      location.hash = '#/inbox';
    } catch (e) { toast(e.message, 'err'); }
  },
};

export const forms = {
  async compose(f) {
    if (!draft.to.size) throw new Error('Add at least one recipient');
    const ids = await uploadAll(f.files, f.querySelector('.progress'));
    await post('/api/inbox/send', {
      recipients: [...draft.to.keys()], subject: f.subject.value, body: f.body.value,
      context_code: f.context.value || null, individual: f.individual.checked, attachment_ids: ids,
    });
    toast('Message sent', 'ok');
    location.hash = '#/inbox?scope=sent';
    return false;
  },
  async 'conv-reply'(f) {
    const ids = await uploadAll(f.files, f.querySelector('.progress'));
    await post(`/api/inbox/${f.dataset.id}/reply`, { body: f.body.value, attachment_ids: ids });
    f.reset();
    toast('Sent', 'ok');
  },
};
