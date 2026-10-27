// Server calls plus a persistent IndexedDB cache so every screen paints instantly from the last copy.

const mem = new Map();
let dbp;

function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('easel', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }).catch(() => null);
}

async function cacheGet(key) {
  if (mem.has(key)) return mem.get(key);
  const d = await db();
  if (!d) return undefined;
  return new Promise((res) => {
    try {
      const q = d.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => { if (q.result !== undefined) mem.set(key, q.result); res(q.result); };
      q.onerror = () => res(undefined);
    } catch { res(undefined); }
  });
}

function cachePut(key, val) {
  mem.set(key, val);
  db().then((d) => { try { d?.transaction('kv', 'readwrite').objectStore('kv').put(val, key); } catch { /* quota */ } });
}

export async function clearCache() {
  mem.clear();
  const d = await db();
  try { d?.transaction('kv', 'readwrite').objectStore('kv').clear(); } catch { /* ignore */ }
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(url, opts = {}) {
  let r;
  try {
    r = await fetch(url, { credentials: 'same-origin', ...opts, headers: { 'X-Easel': '1', ...(opts.headers || {}) } });
  } catch {
    throw new ApiError(0, 'You appear to be offline');
  }
  if (r.status === 401) {
    location.href = '/login?next=' + encodeURIComponent(location.hash || '#/');
    throw new ApiError(401, 'Signed out');
  }
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new ApiError(r.status, body?.error || `HTTP ${r.status}`);
  return body;
}

const inflight = new Map();
const urlFor = (path) => '/api/' + (path.startsWith('x/') ? path : 'c/' + path);

/** Fetch from the server and store in the cache. `force` skips the server's short cache too. */
export function load(path, { force = false } = {}) {
  const key = path + (force ? '#force' : '');
  if (inflight.has(key)) return inflight.get(key);
  const p = request(urlFor(path), force ? { headers: { 'X-Fresh': '1' } } : {})
    .then((d) => { cachePut(path, { t: Date.now(), d }); return d; })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function cached(path) {
  return (await cacheGet(path))?.d;
}

export async function prefetch(path, maxAgeMs = 60000) {
  const c = await cacheGet(path);
  if (c && Date.now() - c.t < maxAgeMs) return;
  load(path).catch(() => {});
}

export function me() { return request('/api/me'); }

/** Uncached GET of one of our own endpoints (e.g. quiz session state). */
export function getJson(url) { return request(url); }

export function post(url, body) {
  return request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

/** Multipart upload with progress (fetch can't report upload progress). */
export function upload(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('X-Easel', '1');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => {
      let body = {};
      try { body = JSON.parse(x.responseText); } catch { /* not json */ }
      if (x.status === 401) { location.href = '/login'; return reject(new ApiError(401, 'Signed out')); }
      x.status < 400 ? resolve(body) : reject(new ApiError(x.status, body.error || `HTTP ${x.status}`));
    };
    x.onerror = () => reject(new ApiError(0, 'Upload failed: network error'));
    x.send(formData);
  });
}
