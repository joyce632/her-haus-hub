/* Her Haus Hub — single-page frontend. No build step; talks to the Flask JSON API. */
'use strict';

// ============================================================ utilities
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  me: null, settings: {}, statuses: [], priorities: [], users: [], clients: [],
  status: null, view: 'employee',
};

const APP_VERSION = document.querySelector('meta[name="app-version"]')?.content || '';
// If this tab is running older code than the server (e.g. a cached page after an update), refresh once.
// Load the newest Hub from a brand-new address no cache (browser, antivirus, office network) has ever stored.
// The server answers that address with an instruction to clear the browser's stored copies — an automatic hard refresh.
function freshReload(tag = Date.now().toString(36)) {
  location.replace(`/?fresh=${encodeURIComponent(tag)}${location.hash || ''}`);
}
function checkVersion(r) {
  const server = r.headers.get('X-App-Version');
  if (!server || !APP_VERSION || server === APP_VERSION) return;
  const alreadyTried = new URLSearchParams(location.search).get('fresh') === server;
  let last = ''; try { last = sessionStorage.getItem('hh_reloaded_for') || ''; } catch (_) { /* storage blocked */ }
  if (alreadyTried || last === server) return;  // at most one automatic refresh per version — never a loop
  try { sessionStorage.setItem('hh_reloaded_for', server); } catch (_) { /* storage blocked */ }
  freshReload(server);
}
// Tidy the address bar after a fresh reload (keep the page the person was on).
if (new URLSearchParams(location.search).has('fresh')) history.replaceState(null, '', `/${location.hash || ''}`);
async function api(method, url, data) {
  const opt = { method, headers: { 'X-HH': '1' }, credentials: 'same-origin', cache: 'no-store' };
  if (data instanceof FormData) opt.body = data;
  else if (data !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(data); }
  let r;
  try { r = await fetch(url, opt); }
  catch (err) {  // network blip (often while a page is reloading): retry reads once
    if (method !== 'GET') throw new Error('Connection problem — please try again');
    await new Promise((res) => setTimeout(res, 600));
    r = await fetch(url, opt);
  }
  checkVersion(r);
  let j = null;
  try { j = await r.json(); } catch (_) { /* non-JSON */ }
  if (r.status === 401 && url !== '/api/login' && url !== '/api/me') { S.me = null; route(); throw new Error('Your session expired — please log in again'); }
  if (!r.ok) throw new Error((j && j.error) || `Request failed (${r.status})`);
  return j;
}

function reportError(err, where = '') {
  try {
    fetch('/api/client-error', { method: 'POST', headers: { 'X-HH': '1', 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ message: String(err && (err.stack || err.message) || err).slice(0, 600), where, page: location.hash, version: APP_VERSION }) });
  } catch (_) { /* never let reporting break the page */ }
}
window.addEventListener('error', (e) => reportError(e.error || e.message, 'window'));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $('#toast-root').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 3200);
}

const TZ = () => S.settings.timezone || 'Asia/Manila';
const CUR = () => S.settings.currency || '₱';
const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const hms = (sec) => { sec = Math.max(0, Math.floor(sec)); return `${pad(sec / 3600)}:${pad((sec % 3600) / 60)}:${pad(sec % 60)}`; };
const hrs = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const money = (n) => CUR() + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const av = (name, fileId, cls = '') => fileId
  ? `<img class="avatar ${cls}" src="/api/files/${fileId}?inline=1" alt="${esc(name)}" title="${esc(name)}" loading="lazy">`
  : `<span class="avatar ${cls}" title="${esc(name)}">${esc(initials(name))}</span>`;
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function tzParts(d) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {};
  f.formatToParts(d).forEach((p) => { o[p.type] = p.value; });
  return o;
}
const todayStr = () => { const p = tzParts(new Date()); return `${p.year}-${p.month}-${p.day}`; };
const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ(), hour: 'numeric', minute: '2-digit' }) : '—';
const fmtDateTs = (iso) => iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: TZ(), month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDate = (d) => d ? new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDateShort = (d) => d ? new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '';
// datetime-local <-> UTC, interpreted in the company timezone
function toZonedInput(iso) { if (!iso) return ''; const p = tzParts(new Date(iso)); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
function fromZonedInput(v) {
  if (!v) return null;
  const [d, t] = v.split('T'); const [Y, M, D] = d.split('-').map(Number); const [h, m] = t.split(':').map(Number);
  const guess = Date.UTC(Y, M - 1, D, h, m);
  const p = tzParts(new Date(guess));
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess;
  return new Date(guess - off).toISOString();
}
// Deadlines: a date plus an optional "HH:MM" time, both in the company timezone.
const fmtClock12 = (hm) => { const [h, m] = hm.split(':').map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const nowHHMM = () => { const p = tzParts(new Date()); return `${p.hour}:${p.minute}`; };
const isOverdue = (t) => !!t.deadline && t.status !== 'Done'
  && (t.deadline < todayStr() || (t.deadline === todayStr() && !!t.deadline_time && t.deadline_time < nowHHMM()));
const dueShort = (t) => `${t.deadline === todayStr() ? 'Today' : fmtDateShort(t.deadline)}${t.deadline_time ? ` · ${fmtClock12(t.deadline_time)}` : ''}`;
const dueLong = (t) => `${fmtDate(t.deadline)}${t.deadline_time ? ` at ${fmtClock12(t.deadline_time)}` : ''}`;
const deadlineInputs = (date, time, idPrefix = '') => `<span class="deadline-pair">
  <input class="input" type="date" name="deadline" ${idPrefix ? `id="${idPrefix}deadline"` : ''} value="${esc(date || '')}">
  <input class="input" type="time" name="deadline_time" ${idPrefix ? `id="${idPrefix}deadline-time"` : ''} value="${esc(time || '')}" title="Time (optional)" ${date ? '' : 'disabled'}></span>`;
// The time box only makes sense once a date is picked.
document.addEventListener('input', (e) => {
  if (e.target.name !== 'deadline') return;
  const pair = e.target.closest('.deadline-pair'); if (!pair) return;
  const timeBox = pair.querySelector('[name=deadline_time]');
  timeBox.disabled = !e.target.value; if (!e.target.value) timeBox.value = '';
});
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
// Time blocks: an optional work session the assignee plans for a task (company timezone).
const minutesOf = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const dayWord = (d) => {
  if (d === todayStr()) return 'Today';
  const t = new Date(todayStr() + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + 1);
  return d === t.toISOString().slice(0, 10) ? 'Tomorrow' : fmtDateShort(d);
};
const blockRange = (t) => `${fmtClock12(t.block_start).replace(':00', '')}–${fmtClock12(t.block_end).replace(':00', '')}`;
const isBlockNow = (t) => t.block_date === todayStr() && t.block_start <= nowHHMM() && nowHHMM() < t.block_end;
const blockMs = (t, which) => Date.parse(fromZonedInput(`${t.block_date}T${which === 'end' ? t.block_end : t.block_start}`));
const countdownAttrs = (t) => `data-countdown="${blockMs(t, 'end')}" data-start="${blockMs(t, 'start')}"`;
const countdownText = (t) => `${fmtLeft(blockMs(t, 'end') - Date.now())} left`;
const shiftDay = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// Horizontal day timeline. rows: [{key, label, items}] — overlapping blocks in a row stack into sub-lanes.
function timelineHTML(rows, day, { showPeople = false, emptyText = '' } = {}) {
  const all = rows.flatMap((r) => r.items);
  if (!all.length) return `<div class="empty tl-empty">${emptyText}</div>`;
  // Fit the planned blocks (rounded to the hour), at least 6 hours wide so short days don't look cramped.
  let from = Math.floor(Math.min(...all.map((t) => minutesOf(t.block_start))) / 60) * 60;
  let to = Math.ceil(Math.max(...all.map((t) => minutesOf(t.block_end))) / 60) * 60;
  if (to - from < 6 * 60) { const pad = 6 * 60 - (to - from); from = Math.max(0, from - Math.floor(pad / 120) * 60); to = Math.min(24 * 60, from + 6 * 60); }
  const isToday = day === todayStr(), now = minutesOf(nowHHMM());
  const span = to - from, pct = (m) => ((m - from) / span) * 100;
  const step = span > 12 * 60 ? 120 : 60;
  const ticks = []; for (let m = from; m <= to; m += step) ticks.push(m);
  const nowLine = isToday && now >= from && now <= to ? `<div class="tl-now" style="left:${pct(now)}%"></div>` : '';
  const lanesFor = (items) => {
    const lanes = [];
    [...items].sort((a, b) => a.block_start.localeCompare(b.block_start)).forEach((t) => {
      let i = lanes.findIndex((end) => end <= t.block_start); if (i < 0) { i = lanes.length; lanes.push(''); }
      lanes[i] = t.block_end; t._lane = i;
    });
    return Math.max(1, lanes.length);
  };
  const rowHTML = (r) => {
    const n = lanesFor(r.items);
    return `<div class="tl-row">${showPeople ? `<div class="tl-who">${r.label}</div>` : ''}
      <div class="tl-track" style="height:${n * 46 + 8}px">${ticks.map((m) => `<i class="tl-grid" style="left:${pct(m)}%"></i>`).join('')}
        ${r.items.map((t) => {
          const done = t.status === 'Done', live = isBlockNow(t) && !done;
          return `<button type="button" class="tl-block ${done ? 'done' : ''} ${live ? 'live' : ''}" data-task="${t.id}"
            style="left:${pct(minutesOf(t.block_start))}%;width:${pct(minutesOf(t.block_end)) - pct(minutesOf(t.block_start))}%;top:${t._lane * 46 + 4}px;--c:${esc(t.client_color || '#0C2E60')}"
            title="${esc(`${t.title} · ${t.client_name} · ${blockRange(t)}${showPeople && t.assignee_name ? ` · ${t.assignee_name}` : ''}`)}">
            <b>${done ? '✓ ' : ''}${esc(t.title)}</b>${live
              ? `<small><span class="tl-timer" ${countdownAttrs(t)}>${countdownText(t)}</span> · ${blockRange(t)}</small><i class="tl-progress"></i>`
              : `<small>${blockRange(t)} · ${esc(t.client_name)}</small>`}</button>`;
        }).join('')}${nowLine}</div></div>`;
  };
  return `<div class="tl ${showPeople ? 'with-people' : ''}">
    <div class="tl-axis">${showPeople ? '<div class="tl-who"></div>' : ''}<div class="tl-ticks">${ticks.map((m) => `<span style="left:${pct(m)}%">${fmtClock12(`${String(Math.floor(m / 60) % 24).padStart(2, '0')}:00`).replace(':00', '')}</span>`).join('')}</div></div>
    ${rows.map(rowHTML).join('')}</div>`;
}

const isExec = () => S.me && S.me.role === 'executive';
const execView = () => isExec() && S.view === 'exec';
const userName = (id) => (S.users.find((u) => u.id === id) || {}).name || '';

const STATUS_META = {
  'Not Started': { c: '#8a99ae', b: 'b-gray' },
  'Blocked': { c: '#CB252B', b: 'b-red' },
  'For Revision': { c: '#d18a00', b: 'b-amber' },
  'In Progress': { c: '#2463c7', b: 'b-blue' },
  'Done': { c: '#1f8a4c', b: 'b-green' },
};
const PRIORITY_BADGE = { Urgent: 'b-red', High: 'b-amber', Medium: 'b-blue', Low: 'b-gray' };
const PRIORITY_COLOR = { Urgent: '#CB252B', High: '#ea7a2f', Medium: '#3b6fc0', Low: '#a3b1c4' };
const CLIENT_TYPE_META = { 'VIP Client': 'ct-vip', 'Stable Client': 'ct-stable', 'Low Priority Client': 'ct-low' };
const CLIENT_HEALTH_META = { Stable: 'b-green', 'At Risk': 'b-red', 'Newly Onboarded': 'b-blue' };
const clientTypeBadge = (t) => t ? `<span class="badge ${CLIENT_TYPE_META[t] || 'b-gray'}">${t === 'VIP Client' ? I.star.replace('width="18" height="18"', 'width="11" height="11"') : ''}${esc(t)}</span>` : '';
const clientHealthBadge = (h) => h ? `<span class="badge ${CLIENT_HEALTH_META[h] || 'b-gray'}"><i class="live-dot" style="animation:none"></i>${esc(h)}</span>` : '';
const statusBadge = (s) => `<span class="badge ${(STATUS_META[s] || {}).b || 'b-gray'}">${esc(s)}</span>`;
const prioBadge = (p) => `<span class="badge ${PRIORITY_BADGE[p] || 'b-gray'}">${esc(p)}</span>`;
const shiftBadge = (s) => `<span class="badge ${s === 'On Shift' ? 'b-green' : s === 'On Break' ? 'b-amber' : 'b-gray'}">${esc(s)}</span>`;
const CLIENT_COLORS = ['#0C2E60', '#CB252B', '#2463c7', '#1f8a4c', '#d18a00', '#7c3aed', '#0e7490', '#be185d', '#475569'];

// ============================================================ icons
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">${p}</svg>`;
const I = {
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  users: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><path d="M16 4.5a3.5 3.5 0 010 7M22 20c0-2.6-1.6-4.7-4-5.6"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/>'),
  smile: svg('<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>'),
  doc: svg('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
  folder: svg('<path d="M3 6h6l2 2h10v11H3z"/>'),
  brief: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V4h6v3M3 13h18"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'),
  clip: svg('<path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7"/>'),
  link: svg('<path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  download: svg('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  trophy: svg('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z"/><path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/>'),
  alert: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18h.01"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  coffee: svg('<path d="M4 9h13v5a5 5 0 01-5 5H9a5 5 0 01-5-5z"/><path d="M17 10h1.5a2.5 2.5 0 010 5H17M8 3v3M12 3v3"/>'),
  lunch: svg('<path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 21V3c-2 1-3 4-3 8h3"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  bars: svg('<path d="M5 20V12M10 20V6M15 20v-9M20 20V4"/>'),
  repeat: svg('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/>'),
  play: svg('<path d="M7 4l13 8-13 8z"/>'),
  pause: svg('<path d="M8 4v16M16 4v16"/>'),
  bell: svg('<path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 003.4 0"/>'),
  chat: svg('<path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z"/>'),
  at: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.9 7.9"/>'),
  archive: svg('<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9M10 13h4"/>'),
  restore: svg('<path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8"/><path d="M3 3v5h5"/>'),
  star: svg('<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>'),
  grip: svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  volume: svg('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/>'),
  mute: svg('<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>'),
  pip: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="7" rx="1" fill="currentColor" stroke="none"/>'),
  send: svg('<path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/>'),
};

// ============================================================ modal + forms
function openModal({ title, body, foot = '', wide = false }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${I.x}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  $('#modal-root').appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $$('[data-close]', bg).forEach((b) => { b.onclick = close; });
  return { el: $('.modal', bg), close };
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const m = $$('#modal-root .modal-bg').pop(); if (m && !m.dataset.locked) m.remove(); }
});

function fieldHTML(f) {
  const v = f.value ?? '';
  const cls = f.full ? 'field full' : 'field';
  const hint = f.hint ? `<span class="hint">${f.hint}</span>` : '';
  const head = `<span class="field-label">${esc(f.label || '')}${hint}</span>`;
  const req = f.required ? 'required' : '';
  switch (f.type) {
    case 'textarea':
      return `<label class="${cls}">${head}<textarea class="input" name="${f.name}" rows="${f.rows || 4}" placeholder="${esc(f.placeholder || '')}" ${req}>${esc(v)}</textarea></label>`;
    case 'select':
      return `<label class="${cls}">${head}<select class="input" name="${f.name}">${f.options.map((o) => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select></label>`;
    case 'checkbox':
      return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'color':
      return `<div class="${cls}"><span>${esc(f.label)}</span><div class="color-swatches" data-swatches="${f.name}">${CLIENT_COLORS.map((c) =>
        `<button type="button" style="background:${c}" data-color="${c}" class="${c === v ? 'on' : ''}" aria-label="${c}"></button>`).join('')}</div>
        <input type="hidden" name="${f.name}" value="${esc(v || CLIENT_COLORS[0])}"></div>`;
    case 'info':
      return `<div class="full">${f.html}</div>`;
    case 'deadline':
      return `<label class="${cls}"><span class="field-label">${esc(f.label)}<span class="hint">· time optional</span></span>${deadlineInputs(v, f.time)}</label>`;
    case 'datetime':
      return `<label class="${cls}">${head}<input class="input" type="datetime-local" name="${f.name}" value="${esc(v)}" ${req}></label>`;
    default:
      return `<label class="${cls}">${head}<input class="input" type="${f.type || 'text'}" name="${f.name}" value="${f.type === 'file' ? '' : esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.step ? `step="${f.step}"` : ''} ${f.accept ? `accept="${f.accept}"` : ''} ${req}></label>`;
  }
}

function formModal({ title, fields, submit = 'Save', wide = false, onSubmit, extraFoot = '' }) {
  const { el, close } = openModal({
    title, wide,
    body: `<form class="form-grid" novalidate>${fields.map(fieldHTML).join('')}</form>`,
    foot: `${extraFoot}<span style="flex:1"></span><button class="btn ghost" data-close>Cancel</button><button class="btn" data-submit>${esc(submit)}</button>`,
  });
  const form = $('form', el);
  $$('[data-swatches]', el).forEach((box) => box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    $$('button', box).forEach((x) => x.classList.remove('on')); b.classList.add('on');
    form.elements[box.dataset.swatches].value = b.dataset.color;
  }));
  const btn = $('[data-submit]', el);
  const submitIt = async () => {
    const missing = fields.find((f) => f.required && !String(form.elements[f.name]?.value || '').trim());
    if (missing) { toast(`${missing.label} is required`, 'err'); form.elements[missing.name].focus(); return; }
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.classList.add('is-busy'); btn.innerHTML = '<span class="spinner"></span>Saving…';
    try {
      let data;
      if (fields.some((f) => f.type === 'file')) {
        data = new FormData(form);
        fields.filter((f) => f.type === 'checkbox').forEach((f) => data.set(f.name, form.elements[f.name].checked ? '1' : '0'));
      } else {
        data = {};
        fields.forEach((f) => {
          const x = form.elements[f.name]; if (!x || f.type === 'info') return;
          data[f.name] = f.type === 'checkbox' ? x.checked : f.type === 'datetime' ? fromZonedInput(x.value) : x.value;
          if (f.type === 'deadline') data.deadline_time = form.elements.deadline_time.value;
        });
      }
      await onSubmit(data, close);
    } catch (e) { toast(e.message, 'err'); } finally { btn.disabled = false; btn.classList.remove('is-busy'); if (btn.innerHTML.includes('spinner')) btn.innerHTML = label; }
  };
  btn.onclick = submitIt;
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); submitIt(); } });
  setTimeout(() => { const first = $('input:not([type=hidden]),textarea,select', form); if (first) first.focus(); }, 40);
  return { el, close };
}

function confirmModal(message, { okLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    const { el, close } = openModal({
      title: 'Please confirm', body: `<p>${esc(message)}</p>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'red' : ''}" data-ok>${esc(okLabel)}</button>`,
    });
    $('[data-ok]', el).onclick = () => { close(); resolve(true); };
    $$('[data-close]', el).forEach((b) => b.addEventListener('click', () => resolve(false)));
  });
}

function passwordReveal(title, email, pw) {
  openModal({
    title,
    body: `<div class="stack"><p>Share these sign-in details with the team member privately. They'll be asked to set their own password the first time they log in.</p>
      <div class="callout"><b>Email:</b> ${esc(email)}<br><b>Temporary password:</b> <span class="mono" id="tmp-pw">${esc(pw)}</span></div></div>`,
    foot: `<button class="btn ghost" id="copy-pw">Copy details</button><button class="btn" data-close>Done</button>`,
  });
  $('#copy-pw').onclick = () => { navigator.clipboard.writeText(`Her Haus Hub login\nURL: ${location.origin}\nEmail: ${email}\nTemporary password: ${pw}`); toast('Copied', 'ok'); };
}

// ============================================================ live tickers
// Any element with data-live="hms|hrs|money" ticks from data-base at data-rate units per second.
function liveAttrs(kind, base, rate) { return `data-live="${kind}" data-base="${base}" data-rate="${rate}" data-at="${Date.now()}"`; }
function liveValue(el) { return Number(el.dataset.base) + ((Date.now() - Number(el.dataset.at)) / 1000) * Number(el.dataset.rate); }
// Countdown for the time block in progress: any element with data-countdown="<end ms>" (and optionally
// data-start="<start ms>") shows the time remaining; a .tl-progress inside the same block fills up.
const fmtLeft = (ms) => {
  const t = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s2 = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}` : `${m}:${String(s2).padStart(2, '0')}`;
};
function tickCountdowns() {
  const now = Date.now();
  $$('[data-countdown]').forEach((el) => {
    const end = Number(el.dataset.countdown), start = Number(el.dataset.start || 0), left = end - now;
    el.textContent = left > 0 ? `${fmtLeft(left)} left` : 'Time’s up';
    el.classList.toggle('ended', left <= 0);
    const bar = el.closest('.tl-block')?.querySelector('.tl-progress');
    if (bar && start) bar.style.width = `${Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))}%`;
  });
}
setInterval(() => {
  tickCountdowns();
  $$('[data-live]').forEach((el) => {
    const v = liveValue(el);
    el.textContent = el.dataset.live === 'money' ? money(v) : el.dataset.live === 'hrs' ? hrs(v) : hms(v);
  });
}, 1000);

async function refreshStatus() {
  if (!S.me) return;
  try { S.status = await api('GET', '/api/time/status'); S.statusAt = Date.now(); renderPill(); } catch (_) { /* ignore */ }
}
setInterval(refreshStatus, 60000);

// ============================================================ auth / boot
// If the Hub hasn't appeared after 8 seconds, offer a fresh reload instead of leaving a blank or stuck screen.
let loadWatchdog = null;
function watchLoading(stage) {
  clearTimeout(loadWatchdog);
  loadWatchdog = setTimeout(() => {
    const ready = document.querySelector('#login-form') || (document.querySelector('.shell') && !$('#page .empty')?.innerText.startsWith('Loading'));
    if (ready) return;
    reportError(new Error(`Hub still loading after 8s (${stage})`), 'watchdog');
    if (document.getElementById('load-rescue')) return;
    const box = document.createElement('div');
    box.id = 'load-rescue';
    box.innerHTML = `<div class="rescue-card"><span class="spinner"></span><div><b>Taking longer than usual</b><small>Your connection or a stored copy of the Hub may be out of date.</small></div>
      <button class="btn sm" type="button">Reload</button></div>`;
    $('button', box).onclick = () => freshReload();
    document.body.appendChild(box);
  }, 8000);
}
function loadingDone() { clearTimeout(loadWatchdog); document.getElementById('load-rescue')?.remove(); }

async function boot() {
  watchLoading('opening');
  try {
    const r = await api('GET', '/api/me');
    await setMe(r);
  } catch (_) { S.me = null; }
  await route();
  loadingDone();
}

async function setMe(r) {
  S.me = r.user; S.settings = r.settings; S.statuses = r.statuses; S.priorities = r.priorities;
  lastNotifId = null;
  S.clientTypes = r.client_types || []; S.clientStatuses = r.client_statuses || [];
  let saved = null;
  try { saved = localStorage.getItem('hh_view'); } catch (_) { /* storage blocked */ }
  S.view = S.me.role === 'executive' ? (saved || 'exec') : 'employee';
  await Promise.all([loadUsers(), loadClients(), refreshStatus()]);
}
async function loadUsers() { S.users = await api('GET', '/api/users'); }
async function loadClients() { S.clients = await api('GET', '/api/clients'); }

function renderLogin() {
  $('#app').innerHTML = `
  <div class="login-wrap">
    <div class="login-art">
      <span class="glass-chip"><i></i>Her Haus Hub · Team Portal</span>
      <div><div class="stripe"></div><h1>The home base for the <b>Her Haus</b> team.</h1>
        <p>Clock in, track your breaks, manage client tasks, and send your EODs — all in one place.</p></div>
      <p class="small">© ${new Date().getFullYear()} Her Haus Co. · Real Estate Wholesaling</p>
    </div>
    <div class="login-form">
      <form id="login-form">
        <img src="/static/logo-dark.webp" alt="Her Haus LLC — Real Estate Wholesaling">
        <div><h1>Welcome back</h1><p class="muted" style="margin-top:4px">Sign in with your work email.</p></div>
        <label class="field">Email<input class="input" type="email" name="email" autocomplete="username" required></label>
        <label class="field">Password<input class="input" type="password" name="password" autocomplete="current-password" required></label>
        <button class="btn lg" type="submit">Sign in</button>
        <p class="small muted" style="text-align:center">Forgot your password? Ask an executive to reset it.</p>
      </form>
    </div>
  </div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const b = $('button', f); b.disabled = true;
    try {
      await api('POST', '/api/login', { email: f.email.value, password: f.password.value });
      watchLoading('signing in');
      await setMe(await api('GET', '/api/me'));
      const next = new URLSearchParams(location.search).get('next') || '';
      if (/^\/api\/files\/\d+(\?[\w=&]*)?$/.test(next)) {  // file link from Google Chat: go back to the download
        history.replaceState(null, '', '/#/');
        location.href = next;
      }
      await route();  // keep the address they came in on, e.g. a task link from Google Chat
      loadingDone();
    } catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; }
  };
}

function changePasswordModal(forced = false) {
  const m = formModal({
    title: forced ? 'Set your password' : 'Change password',
    fields: [
      ...(forced ? [{ type: 'info', html: '<p class="muted">Welcome! Please replace your temporary password before continuing.</p>' }] : []),
      { name: 'current', label: forced ? 'Temporary password' : 'Current password', type: 'password', full: true, required: true },
      { name: 'new', label: 'New password', type: 'password', full: true, required: true, hint: 'At least 8 characters' },
      { name: 'confirm', label: 'Confirm new password', type: 'password', full: true, required: true },
    ],
    submit: 'Update password',
    onSubmit: async (d, close) => {
      if (d.new !== d.confirm) throw new Error("Passwords don't match");
      await api('POST', '/api/me/password', d);
      S.me.must_change_password = 0;
      close(); toast('Password updated', 'ok');
    },
  });
  if (forced) { m.el.parentElement.dataset.locked = '1'; $$('[data-close]', m.el).forEach((b) => b.remove()); }
}

async function logout() {
  await api('POST', '/api/logout');
  S.me = null; location.hash = ''; route();
}

// ============================================================ shell
function navLink(href, icon, label, extra = '') {
  return `<a href="#/${href}" data-nav="${href}">${icon}<span style="flex:1">${esc(label)}</span>${extra}</a>`;
}
const notifNav = () => navLink('notifications', I.bell, 'Notifications', '<span class="nav-count" id="nav-notif-count" hidden></span>');
const chatNav = () => navLink('chat', I.chat, 'Chat', '<span class="nav-count" id="nav-chat-count" hidden></span>');

function renderShell() {
  const execNav = [
    navLink('overview', I.chart, 'Overview'),
    notifNav(),
    chatNav(),
    navLink('team', I.users, 'Team'),
    navLink('timesheets', I.clock, 'Timesheets & Payroll'),
    navLink('metrics', I.bars, 'Task Metrics'),
    navLink('eods', I.doc, 'EOD Reports'),
    navLink('clients', I.brief, 'Clients'),
    navLink('resources', I.folder, 'Resources'),
    navLink('archive', I.archive, 'Archive'),
    navLink('settings', I.gear, 'Settings'),
  ];
  const empNav = [
    navLink('dashboard', I.home, 'My Dashboard'),
    notifNav(),
    chatNav(),
    navLink('eod', I.doc, 'Submit EOD'),
    navLink('metrics', I.bars, 'My Task Metrics'),
    navLink('profile/me', I.user, 'My Profile'),
    navLink('resources', I.folder, 'Resources'),
    navLink('archive', I.archive, 'Archive'),
  ];
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#/" aria-label="Her Haus Hub home"><img src="/static/logo-dark.webp" alt="Her Haus LLC — Real Estate Wholesaling"></a>
      ${isExec() ? `<div class="view-switch"><button data-view="exec" class="${S.view === 'exec' ? 'on' : ''}">Executive</button><button data-view="employee" class="${S.view === 'employee' ? 'on' : ''}">Employee</button></div>` : ''}
      <nav class="nav">
        ${(execView() ? execNav : empNav).join('')}
        <div class="nav-label">Client Boards</div>
        <div id="client-nav">${clientNavHTML()}</div>
      </nav>
      <div class="sidebar-foot">
        <div class="me-chip">${av(S.me.name, S.me.avatar_file_id)}
          <div class="who"><b>${esc(S.me.name)}</b><span>${esc(S.me.position || (isExec() ? 'Executive' : 'Team Member'))}</span></div></div>
        <div class="row" style="margin-top:10px;gap:14px"><button class="linkbtn" id="chg-pw">Change password</button><button class="linkbtn" id="logout">Log out</button></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="row" style="gap:12px;flex-wrap:nowrap;min-width:0">
          <button class="menu-btn" id="menu-btn" aria-label="Menu">${I.menu}</button>
          <div style="min-width:0"><h1 id="page-title"></h1><div class="sub" id="page-sub"></div></div>
        </div>
        <div class="row" style="gap:10px;flex-wrap:nowrap">
          <div class="bell-wrap"><button class="bell" id="bell" aria-label="Notifications">${I.bell}<span class="bell-count" id="bell-count" hidden></span></button>
            <div class="notif-panel hidden" id="notif-panel"></div></div>
          <div id="pill"></div>
        </div>
      </header>
      <div class="page" id="page"></div>
    </div>
  </div>`;
  $$('[data-view]').forEach((b) => b.onclick = () => {
    S.view = b.dataset.view;
    try { localStorage.setItem('hh_view', S.view); } catch (_) { /* storage blocked */ }
    location.hash = S.view === 'exec' ? '#/overview' : '#/dashboard';
    renderShell(); route();
  });
  $('#logout').onclick = logout;
  $('#chg-pw').onclick = () => changePasswordModal(false);
  $('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#bell').onclick = (e) => {
    e.stopPropagation();
    const p = $('#notif-panel'); const opening = p.classList.contains('hidden');
    p.classList.toggle('hidden');
    if (opening) { p.innerHTML = '<div class="empty">Loading…</div>'; renderNotifPanel(); }
  };
  pollNotifications();
  $('#page').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  renderPill();
}

function clientNavHTML() {
  if (!S.clients.length) return `<p class="small muted" style="padding:4px 12px">${isExec() ? 'No clients yet — add one under Clients.' : 'No clients yet.'}</p>`;
  return S.clients.map((c) => `<a href="#/board/${c.id}" data-nav="board/${c.id}" title="${esc([c.client_type, c.client_status].filter(Boolean).join(' · '))}"><span class="dot" style="background:${esc(c.color)}"></span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>${c.client_type === 'VIP Client' ? `<span class="nav-vip" aria-label="VIP client">${I.star}</span>` : ''}${c.client_status === 'At Risk' ? '<span class="nav-risk" aria-label="At risk"></span>' : ''}${c.open_tasks ? `<span class="small" style="opacity:.7">${c.open_tasks}</span>` : ''}</a>`).join('');
}
function refreshClientNav() { const n = $('#client-nav'); if (n) { n.innerHTML = clientNavHTML(); markActiveNav(); } }

function renderPill() {
  const box = $('#pill'); const s = S.status;
  if (!box || !s) return;
  if (s.on_break) {
    box.innerHTML = `<div class="shift-pill brk"><span class="pulse"></span><span class="lbl">On ${esc(s.break.kind.toLowerCase())}</span>
      <span class="mono" ${liveAttrs('hms', (Date.now() - new Date(s.break.start)) / 1000, 1)}>${hms((Date.now() - new Date(s.break.start)) / 1000)}</span>
      <button class="btn sm" data-clock="break-end">End break</button></div>`;
  } else if (s.on_shift) {
    box.innerHTML = `<div class="shift-pill on"><span class="pulse"></span><span class="lbl">On shift</span>
      <span class="mono" ${liveAttrs('hms', s.today_seconds, 1)}>${hms(s.today_seconds)}</span>
      <button class="btn sm soft pill-float" type="button" data-float title="Float timer — stays on top in other tabs">${I.pip}</button>
      <a class="btn sm soft" href="#/dashboard">Time clock</a></div>`;
  } else {
    box.innerHTML = `<div class="shift-pill"><span class="pulse"></span><span class="lbl">Off shift</span><button class="btn sm red" data-clock="clock-in">Clock in</button></div>`;
  }
  $$('[data-clock]', box).forEach((b) => b.onclick = () => clockAction(b.dataset.clock));
  const fb = $('[data-float]', box); if (fb) fb.onclick = openFloater;
}

function setTitle(t, sub = '') { $('#page-title').textContent = t; $('#page-sub').textContent = sub; document.title = `${t} · Her Haus Hub`; }
function markActiveNav() {
  const h = location.hash.replace(/^#\//, '').split('?')[0];
  $$('.nav a').forEach((a) => a.classList.toggle('active', h === a.dataset.nav || (a.dataset.nav === 'profile/me' && h === `profile/${S.me.id}`)));
}

// ============================================================ router
const ROUTES = {
  dashboard: { render: pageDashboard },
  eod: { render: pageEod },
  profile: { render: pageProfile },
  resources: { render: pageResources },
  board: { render: pageBoard },
  metrics: { render: pageMetrics },
  notifications: { render: pageNotifications },
  chat: { render: pageChat },
  archive: { render: pageArchive },
  overview: { render: pageOverview, exec: true },
  team: { render: pageTeam, exec: true },
  timesheets: { render: pageTimesheets, exec: true },
  eods: { render: pageEodsAll, exec: true },
  clients: { render: pageClients, exec: true },
  settings: { render: pageSettings, exec: true },
};

let routeSeq = 0;
async function route() {
  $('#modal-root').innerHTML = '';
  if (!S.me) { renderLogin(); return; }
  if (!$('#page')) renderShell();
  const [pathPart, queryPart] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const taskParam = new URLSearchParams(queryPart || '').get('task');
  if (taskParam && parts[0] === 'board') {  // deep link from Google Chat: open that task, then tidy the URL
    S.openTaskOnLoad = Number(taskParam);
    history.replaceState(null, '', `#/${pathPart}`);
  }
  let key = parts[0];
  const def = execView() ? 'overview' : 'dashboard';
  if (!ROUTES[key] || (ROUTES[key].exec && !isExec())) { key = def; history.replaceState(null, '', `#/${def}`); }
  if (ROUTES[key].exec && !execView()) { S.view = 'exec'; renderShell(); }
  markActiveNav();
  const old = $('#page');
  const page = old.cloneNode(false); // fresh node drops old listeners
  page.className = 'page';
  old.replaceWith(page);
  page.addEventListener('click', () => $('#sidebar').classList.remove('open'));
  page.innerHTML = '<div class="empty">Loading…</div>';
  const seq = ++routeSeq;
  try {
    await ROUTES[key].render(page, parts.slice(1), () => seq === routeSeq);
  } catch (e) {
    reportError(e, `route ${key}`);
    if (seq === routeSeq) page.innerHTML = `<div class="card empty"><b>Something went wrong</b>${esc(e.message)}<div style="margin-top:12px"><button class="btn sm" onclick="route()">Try again</button></div></div>`;
  }
  if (S.me && S.me.must_change_password && !$('#modal-root .modal-bg')) changePasswordModal(true);
}
window.addEventListener('hashchange', route);

// ============================================================ time clock
async function clockAction(action, extra) {
  try {
    S.status = await api('POST', `/api/time/${action}`, extra || {}); S.statusAt = Date.now();
    const msg = { 'clock-in': 'Clocked in — have a great shift!', 'clock-out': 'Clocked out. Nice work today!', 'break-start': 'Break started', 'break-end': 'Welcome back!' }[action];
    toast(msg, 'ok');
    renderPill();
    const card = $('#clock-card'); if (card) card.innerHTML = clockCardHTML();
    const earn = $('#earn-card'); if (earn) earn.innerHTML = earnCardHTML();
    bindClockButtons();
    if (action === 'clock-out' && !$('#eod-form')) {
      const go = await confirmModal('Want to submit your EOD report now?', { okLabel: 'Write EOD', danger: false });
      if (go) location.hash = '#/eod';
    }
  } catch (e) { toast(e.message, 'err'); }
}
function bindClockButtons() { $$('#page [data-clock]').forEach((b) => b.onclick = () => clockAction(b.dataset.clock, b.dataset.kind ? { kind: b.dataset.kind } : undefined)); }

function clockCardHTML() {
  const s = S.status;
  const state = s.on_break ? 'brk' : s.on_shift ? 'on' : '';
  const label = s.on_break ? `On ${s.break.kind.toLowerCase()}` : s.on_shift ? 'On shift' : 'Off shift';
  let actions, meta;
  if (s.on_break) {
    const since = (Date.now() - new Date(s.break.start)) / 1000;
    meta = `${esc(s.break.kind)} started ${fmtTime(s.break.start)} · <span ${liveAttrs('hms', since, 1)}>${hms(since)}</span> elapsed`;
    actions = `<button class="btn lg white" data-clock="break-end">End ${esc(s.break.kind.toLowerCase())}</button>`;
  } else if (s.on_shift) {
    meta = `Clocked in at ${fmtTime(s.entry.clock_in)} · Breaks today: ${hrs(s.today_break_seconds)}`;
    actions = `<button class="btn lg ghost" data-clock="break-start" data-kind="Break">${I.coffee} Start break</button>
      <button class="btn lg ghost" data-clock="break-start" data-kind="Lunch">${I.lunch} Lunch</button>
      <button class="btn lg red" data-clock="clock-out">Clock out</button>`;
  } else {
    meta = s.today_seconds ? `You've logged ${hrs(s.today_seconds)} today.` : 'Ready when you are. Your team will be notified in Google Chat.';
    actions = `<button class="btn lg white" data-clock="clock-in">Clock in</button>`;
  }
  return `<div class="row between"><h2>Time Clock</h2><div class="row" style="gap:8px"><a class="eod-link" href="#/eod">${I.send} Submit EOD</a><span class="status-tag ${state}"><i></i>${label}</span></div></div>
    <div class="clock-time" ${liveAttrs('hms', s.today_seconds, s.running ? 1 : 0)}>${hms(s.today_seconds)}</div>
    <div class="clock-meta">Worked today · ${meta}</div>
    <div class="clock-actions">${actions}</div>`;
}

function earnCardHTML() {
  const c = S.status.cutoff; const run = S.status.running;
  const pct = c.expected_hours ? Math.min(100, (c.worked_seconds / 3600 / c.expected_hours) * 100) : 0;
  return `<div class="card-head"><h2>Earnings this cutoff</h2>${run ? '<span class="badge b-green"><i class="live-dot"></i>Live</span>' : ''}</div>
    <div class="earn-big" ${liveAttrs('money', c.earnings, run ? c.hourly_rate / 3600 : 0)}>${money(c.earnings)}</div>
    <p class="muted small" style="margin:4px 0 14px">${fmtDateShort(c.start)} – ${fmtDate(c.end)} · Pay day ${c.end.slice(8) === '15' ? '15th' : 'end of month'}</p>
    <div class="row between small" style="margin-bottom:6px"><span><b ${liveAttrs('hrs', c.worked_seconds, run ? 1 : 0)}>${hrs(c.worked_seconds)}</b> of ${num(c.expected_hours)}h</span><span class="muted">${Math.round(pct)}%</span></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
    <div class="grid g2" style="margin-top:16px;gap:10px">
      <div><div class="muted small">Salary / cutoff</div><b>${money(c.salary)}</b></div>
      <div><div class="muted small">Hourly rate</div><b>${money(c.hourly_rate)}</b></div>
    </div>`;
}

// ============================================================ employee dashboard
async function pageDashboard(page, _a, alive) {
  setTitle(`Good ${greeting()}, ${S.me.name.split(' ')[0]}`, new Date().toLocaleDateString('en-US', { timeZone: TZ(), weekday: 'long', month: 'long', day: 'numeric' }));
  await refreshStatus();
  if (!alive()) return;
  page.innerHTML = `
    <div class="grid g3">
      <div class="card clock-card span2" id="clock-card">${clockCardHTML()}</div>
      <div class="card" id="earn-card">${earnCardHTML()}</div>
      <div class="card span3" id="my-plan"></div>
      <div class="card span3" id="my-board"><div class="empty">Loading your tasks…</div></div>
    </div>`;
  bindClockButtons();
  const plan = planCard($('#my-plan'), S.me.id, alive);
  await myTasksBoard($('#my-board'), alive, plan.reload);
  await plan.ready;
}

// ============================================================ floating timer
// A small always-on-top window with the current time block's countdown (and shift time), so it stays visible
// in other tabs and apps. Chrome/Edge: Document Picture-in-Picture. Safari: a live video picture-in-picture.
let floater = null;
let floaterData = { items: [], day: '' };
let floaterInbox = { items: [], unread: 0, seen: 0, key: '', open: false };
const FLOAT_SMALL = 230, FLOAT_BIG = 470;   // window height without / with the notification list   // unread alerts shown in the floating window
async function refreshFloaterInbox() {
  if (!floater || !S.me) return;
  try {
    const r = await api('GET', '/api/notifications?unread=1&limit=6');
    floaterInbox.items = r.items; floaterInbox.unread = r.unread;
  } catch (_) { return; }
  drawFloaterInbox();
}
function fitFloater(h) {   // browsers only allow this right after a click inside the floating window
  const w = floater?.win; if (!w) return;
  const frame = Math.min(Math.max(w.outerHeight - w.innerHeight, 0), 80);   // title bar
  try { w.resizeTo(w.outerWidth, h + frame); } catch (_) { /* not allowed right now */ }
}
function floaterStripHTML() {   // collapsed: one line with the latest alert
  const { items, unread } = floaterInbox, [t] = alertPlain(items[0]);
  return `<div class="fi-strip"><span class="fi-ic k-${items[0].kind}">${I.bell}</span>
    <span class="fi-strip-text"><b>${esc(t)}</b>${unread > 1 ? ` · +${unread - 1} more` : ''}</span>
    <button type="button" class="fi-view" data-fexpand>View</button></div>`;
}
function floaterInboxHTML() {
  const { items, unread } = floaterInbox;
  if (!floaterInbox.open) return floaterStripHTML();
  const head = `<div class="fi-head"><span>${I.bell} Notifications${unread ? ` <b class="fi-count">${unread > 99 ? '99+' : unread}</b>` : ''}</span>
    <span class="fi-acts">${unread ? '<button type="button" class="fi-all" data-fread-all>Mark all read</button>' : ''}<button type="button" class="fi-all" data-fcollapse>Hide</button></span></div>`;
  if (!items.length) return `${head}<div class="fi-empty">You’re all caught up.</div>`;
  const icon = { mention: I.at, comment: I.chat, deadline: I.clock, follow: I.eye, assigned: I.brief, chat_mention: I.at, chat_dm: I.chat };
  return head + `<div class="fi-list">${items.map((n) => `<div class="fi-item k-${n.kind} ${n.id > floaterInbox.seen ? 'fresh' : ''}">
      <span class="fi-ic">${icon[n.kind] || I.brief}</span>
      <div class="fi-main"><div class="fi-text">${notifText(n)}</div>
        ${n.snippet && n.kind !== 'assigned' ? `<div class="fi-snip">“${esc(n.snippet)}”</div>` : ''}
        <div class="fi-meta">${n.client_name ? `${esc(n.client_name)} · ` : ''}${timeAgo(n.created_at)}</div>
        <div class="fi-btns"><button type="button" class="fi-open" data-fopen="${n.id}">Open</button>
          <button type="button" class="fi-read" data-fread="${n.id}">${I.check} Mark read</button></div></div></div>`).join('')}</div>
    ${unread > items.length ? `<div class="fi-more">+${unread - items.length} more in the hub</div>` : ''}`;
}
function drawFloaterInbox() {
  if (floater?.kind !== 'doc') return;
  const box = floater.win.document.getElementById('fl-inbox');
  const key = floaterInbox.unread + ':' + floaterInbox.items.map((n) => n.id).join(',');
  if (!box) return;
  if (!floaterInbox.items.length) {   // nothing unread: hide the section and shrink back to the timer
    box.hidden = true; box.innerHTML = ''; floaterInbox.key = key;
    if (floaterInbox.open) { floaterInbox.open = false; fitFloater(FLOAT_SMALL); }
    return;
  }
  const fullKey = `${key}:${floaterInbox.open}`;
  if (fullKey === floaterInbox.key) return;   // only redraw when something changed, so buttons don't flicker
  floaterInbox.key = fullKey;
  box.hidden = false;
  box.classList.toggle('open', floaterInbox.open);
  box.innerHTML = floaterInboxHTML();
  floaterInbox.seen = Math.max(floaterInbox.seen, ...floaterInbox.items.map((n) => n.id), 0);
}
async function floaterInboxClick(e) {
  const expand = e.target.closest('[data-fexpand]'), collapse = e.target.closest('[data-fcollapse]');
  if (expand || collapse) {
    floaterInbox.open = !!expand; fitFloater(expand ? FLOAT_BIG : FLOAT_SMALL); drawFloaterInbox(); return;
  }
  const all = e.target.closest('[data-fread-all]'), read = e.target.closest('[data-fread]'), open = e.target.closest('[data-fopen]');
  if (all) { await api('POST', '/api/notifications/read', { all: true }); }
  else if (read) { await api('POST', '/api/notifications/read', { ids: [+read.dataset.fread] }); }
  else if (open) {
    const n = floaterInbox.items.find((x) => x.id === +open.dataset.fopen);
    window.focus();   // bring the hub tab forward, then open the task there
    if (n) await openNotification(n);
  } else return;
  await refreshFloaterInbox(); pollNotifications();
}
async function refreshFloaterData() {
  if (!S.me) return;
  try { floaterData = { items: (await api('GET', `/api/schedule?date=${todayStr()}&user_id=${S.me.id}`)).items, day: todayStr() }; } catch (_) { /* keep last */ }
  refreshStatus();
}
function floaterState() {
  const open = floaterData.items.filter((t) => t.status !== 'Done');
  const live = open.filter(isBlockNow).sort((a, b) => blockMs(a, 'end') - blockMs(b, 'end'));   // ending soonest first
  const now = live[0];
  const next = open.find((t) => t.block_start > nowHHMM());
  const s = S.status;
  let shift = 'Off shift';
  if (s && s.on_break) shift = `On ${s.break.kind.toLowerCase()} · ${hms((Date.now() - new Date(s.break.start)) / 1000)}`;
  else if (s && s.on_shift) shift = `On shift · ${hms(s.today_seconds + (Date.now() - (S.statusAt || Date.now())) / 1000)}`;
  return { now, live, next, shift };
}
const blockPct = (t) => Math.min(100, Math.max(0, ((Date.now() - blockMs(t, 'start')) / (blockMs(t, 'end') - blockMs(t, 'start'))) * 100));
function floaterMultiHTML(live, next, shift) {   // two or more overlapping blocks: one compact row each
  return `<div class="f-top"><span class="f-tag live">● ${live.length} ongoing</span><span class="f-shift">${esc(shift)}</span></div>
    <div class="f-multi">${live.map((t) => { const left = blockMs(t, 'end') - Date.now(); return `
      <button type="button" class="f-row" data-ftask="${t.id}" title="Open in Her Haus Hub">
        <span class="f-row-main"><span class="f-row-title">${esc(t.title)}</span><span class="f-row-sub">${esc(t.client_name)} · ${blockRange(t)}</span></span>
        <span class="f-row-count ${left <= 0 ? 'ended' : ''}">${left > 0 ? fmtLeft(left) : 'Time’s up'}</span>
        <span class="f-bar"><i style="width:${blockPct(t)}%"></i></span></button>`; }).join('')}</div>
    ${live.length > 2 ? '' : `<div class="f-next">${next ? `Up next: <b>${esc(next.title)}</b> · ${fmtClock12(next.block_start)}` : 'Nothing else planned today'}</div>`}`;
}
function floaterHTML() {
  const { now, live, next, shift } = floaterState();
  if (live.length > 1) return floaterMultiHTML(live, next, shift);
  const pct = now ? Math.min(100, Math.max(0, ((Date.now() - blockMs(now, 'start')) / (blockMs(now, 'end') - blockMs(now, 'start'))) * 100)) : 0;
  const left = now ? blockMs(now, 'end') - Date.now() : 0;
  return `<div class="f-top"><span class="f-tag ${now ? 'live' : ''}">${now ? '● Now' : 'Time block'}</span><span class="f-shift">${esc(shift)}</span></div>
    ${now ? `<div class="f-title">${esc(now.title)}</div><div class="f-client">${esc(now.client_name)} · ${blockRange(now)}</div>
      <div class="f-count ${left <= 0 ? 'ended' : ''}">${left > 0 ? fmtLeft(left) : 'Time’s up'}<small>${left > 0 ? 'left' : ''}</small></div>
      <div class="f-bar"><i style="width:${pct}%"></i></div>`
    : `<div class="f-title muted">No time block right now</div>`}
    <div class="f-next">${next ? `Up next: <b>${esc(next.title)}</b> · ${fmtClock12(next.block_start)}` : now ? 'Nothing else planned today' : 'Plan time blocks from any of your tasks.'}</div>
    <button class="f-open" type="button" data-open-hub>Open Her Haus Hub</button>`;
}
const FLOAT_CSS = `*{box-sizing:border-box}html,body{margin:0;height:100%}body{font-family:Montserrat,system-ui,sans-serif;color:#fff;
  background:radial-gradient(260px 160px at 100% 0%,rgba(66,133,244,.45),transparent 65%),radial-gradient(240px 150px at 0% 120%,rgba(227,38,45,.4),transparent 65%),linear-gradient(135deg,#123A7A,#0C2E60 55%,#071C3D);
  padding:14px 16px;display:flex;flex-direction:column;gap:12px;overflow:hidden}#fl{display:flex;flex-direction:column;gap:5px;width:100%;flex:none}
  svg{width:14px;height:14px;flex:none}
  #fl-inbox{flex:none;display:flex;flex-direction:column;gap:8px}#fl-inbox[hidden]{display:none}
  #fl-inbox.open{flex:1;min-height:0;border-top:1px solid rgba(255,255,255,.16);padding-top:10px}
  .fi-strip{display:flex;align-items:center;gap:8px;padding:6px 6px 6px 8px;border-radius:10px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);animation:fiIn .4s ease}
  .fi-strip .fi-ic{width:22px;height:22px}.fi-strip .fi-ic svg{width:12px;height:12px}
  .fi-strip-text{flex:1;min-width:0;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.fi-strip-text b{font-weight:700}
  .fi-view{border:0;background:#fff;color:#0C2E60;font:700 11px Montserrat,sans-serif;padding:4px 11px;border-radius:7px;cursor:pointer;flex:none}
  .fi-acts{display:flex;gap:12px}.fi-ic.k-mention{background:#E3262D}.fi-ic.k-assigned{background:#1B4BA8}.fi-ic.k-deadline{background:#B7791F}
  .fi-head{display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
  .fi-head>span{display:flex;align-items:center;gap:6px}.fi-count{background:#E3262D;border-radius:99px;padding:1px 7px;font-size:10.5px;letter-spacing:0}
  .fi-all{border:0;background:none;color:#fff;opacity:.8;font:600 11px Montserrat,sans-serif;cursor:pointer;text-decoration:underline;text-underline-offset:3px;padding:0}
  .fi-all:hover{opacity:1}.fi-empty{font-size:12px;opacity:.7}
  .fi-list{display:flex;flex-direction:column;gap:6px;overflow-y:auto;min-height:0;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
  .fi-item{display:flex;gap:9px;padding:9px 10px;border-radius:10px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1)}
  .fi-item.fresh{animation:fiIn .5s ease;border-color:rgba(255,255,255,.35)}@keyframes fiIn{from{opacity:0;transform:translateY(-4px)}}
  .fi-ic{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.14);flex:none}
  .fi-item.k-mention .fi-ic{background:#E3262D}.fi-item.k-assigned .fi-ic{background:#1B4BA8}.fi-item.k-deadline .fi-ic{background:#B7791F}
  .fi-main{min-width:0;flex:1}.fi-text{font-size:12px;line-height:1.35}.fi-text b{font-weight:700}
  .fi-snip{font-size:11.5px;opacity:.8;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fi-meta{font-size:10.5px;opacity:.6;margin-top:2px}
  .fi-btns{display:flex;gap:6px;margin-top:6px}.fi-btns button{display:inline-flex;align-items:center;gap:4px;border-radius:7px;font:600 11px Montserrat,sans-serif;padding:4px 10px;cursor:pointer}
  .fi-open{background:#fff;color:#0C2E60;border:1px solid #fff}.fi-read{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)}
  .fi-btns button:hover{filter:brightness(1.1)}.fi-btns svg{width:12px;height:12px}.fi-more{font-size:11px;opacity:.65;text-align:center}.f-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .f-tag{font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:3px 9px;border-radius:99px;background:rgba(255,255,255,.12)}
  .f-tag.live{background:#E3262D}.f-shift{font-size:11px;font-weight:600;opacity:.8;font-variant-numeric:tabular-nums}
  .f-title{font-size:15px;font-weight:700;line-height:1.25;margin-top:4px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .f-title.muted{opacity:.75;font-weight:600}.f-client{font-size:11.5px;opacity:.75}
  .f-count{font-size:34px;font-weight:300;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1.1;margin-top:2px}
  .f-count small{font-size:12px;font-weight:600;opacity:.75;margin-left:6px;letter-spacing:0}.f-count.ended{color:#FFD1D3;font-size:22px;font-weight:700}
  .f-bar{height:4px;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden}.f-bar i{display:block;height:100%;background:#fff;border-radius:4px}
  .f-multi{display:flex;flex-direction:column;gap:5px;margin-top:4px;max-height:144px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
  .f-row{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;text-align:left;width:100%;padding:5px 10px 6px;flex:none;border-radius:10px;
    background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);color:#fff;font:inherit;cursor:pointer}
  .f-row:hover{background:rgba(255,255,255,.14)}.f-row-main{min-width:0;display:flex;flex-direction:column}
  .f-row-title{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.f-row-sub{font-size:10.5px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .f-row-count{font-size:17px;font-weight:300;font-variant-numeric:tabular-nums;letter-spacing:-.01em}.f-row-count.ended{font-size:11px;font-weight:700;color:#FFD1D3}
  .f-row .f-bar{grid-column:1/-1;height:3px}
  .f-next{font-size:11.5px;opacity:.85;margin-top:2px}.f-next b{font-weight:700}
  .f-open{margin-top:auto;align-self:flex-start;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;font:600 11px Montserrat,sans-serif;padding:5px 10px;border-radius:8px;cursor:pointer}`;
function openTaskInHub(t) {
  S.openTaskOnLoad = t.id;
  if (location.hash === `#/board/${t.client_id}`) route(); else location.hash = `#/board/${t.client_id}`;
}
async function openFloater() {
  if (floater) { if (floater.kind === 'doc') floater.win.focus(); return; }
  // Open the window first: browsers only allow it right after the click, so nothing slow may come before it.
  let opened = false, why = '';
  if ('documentPictureInPicture' in window) {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 360, height: FLOAT_SMALL });
      win.document.title = 'Her Haus · Timer';
      win.document.head.innerHTML = `<meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;500;600;700&display=swap" rel="stylesheet"><style>${FLOAT_CSS}</style>`;
      win.document.body.innerHTML = '<div id="fl"></div><div id="fl-inbox" hidden></div>';
      const draw = () => { const box = win.document.getElementById('fl'); if (box) box.innerHTML = floaterHTML(); };
      win.document.body.addEventListener('click', (e) => {
        const row = e.target.closest('[data-ftask]');
        if (row) { const t = floaterData.items.find((x) => x.id === +row.dataset.ftask); window.focus(); if (t) openTaskInHub(t); }
        else if (e.target.closest('[data-open-hub]')) window.focus();
        else floaterInboxClick(e);
      });
      draw(); win.setInterval(draw, 1000);   // the floating window's own timer keeps ticking while this tab is hidden
      floater = { kind: 'doc', win };
      floaterInbox.key = ''; floaterInbox.open = false; floaterInbox.seen = Number.MAX_SAFE_INTEGER;   // existing alerts don't animate in
      win.addEventListener('pagehide', () => { floater = null; });
      opened = true;
    } catch (err) { why = err.message; }
  }
  if (!opened && document.pictureInPictureEnabled) {   // second option (and Safari's): picture-in-picture video
    try { await videoFloater(); opened = true; } catch (err) { why = why || err.message; }
  }
  if (!opened) {
    reportError(new Error(`Floating timer unavailable: ${why || 'not supported'}`), 'floater');
    toast('This browser couldn’t open a floating window. Use Chrome, Edge, or Safari for the floating timer.', 'err');
    return;
  }
  refreshFloaterData();   // fill in today's blocks right after it opens
  await refreshFloaterInbox(); floaterInbox.seen = Math.max(0, ...floaterInbox.items.map((n) => n.id));
}
async function videoFloater() {   // Safari fallback: draw the timer on a canvas and show it as picture-in-picture video
  const c = document.createElement('canvas'); c.width = 640; c.height = 400;
  const g = c.getContext('2d');
  const paint = () => {
    const { now, next, shift } = floaterState();
    const grad = g.createLinearGradient(0, 0, 640, 400); grad.addColorStop(0, '#123A7A'); grad.addColorStop(1, '#071C3D');
    g.fillStyle = grad; g.fillRect(0, 0, 640, 400); g.fillStyle = '#fff'; g.textBaseline = 'top';
    g.font = '600 24px Montserrat, sans-serif'; g.globalAlpha = 0.8; g.fillText(shift, 40, 32); g.globalAlpha = 1;
    const { live } = floaterState();
    if (live.length > 1) {   // overlapping blocks: one line each with its countdown
      live.slice(0, 3).forEach((t, i) => {
        const left = blockMs(t, 'end') - Date.now(), y = 85 + i * 62;
        g.font = '700 28px Montserrat, sans-serif'; g.fillText(t.title.slice(0, 24), 40, y);
        g.font = '300 34px Montserrat, sans-serif'; g.textAlign = 'right'; g.fillText(left > 0 ? fmtLeft(left) : 'Time’s up', 600, y - 4); g.textAlign = 'left';
        g.globalAlpha = 0.2; g.fillRect(40, y + 38, 560, 5); g.globalAlpha = 1; g.fillRect(40, y + 38, 5.6 * blockPct(t), 5);
      });
    } else g.font = '700 34px Montserrat, sans-serif', g.fillText((now ? now.title : 'No time block right now').slice(0, 30), 40, 90);
    if (now && live.length === 1) {
      const left = blockMs(now, 'end') - Date.now();
      g.font = '300 96px Montserrat, sans-serif'; g.fillText(left > 0 ? fmtLeft(left) : 'Time’s up', 40, 150);
      const pct = Math.min(1, Math.max(0, (Date.now() - blockMs(now, 'start')) / (blockMs(now, 'end') - blockMs(now, 'start'))));
      g.globalAlpha = 0.2; g.fillRect(40, 280, 560, 10); g.globalAlpha = 1; g.fillRect(40, 280, 560 * pct, 10);
    }
    g.font = '500 24px Montserrat, sans-serif'; g.globalAlpha = 0.85;
    g.fillText(next ? `Up next: ${next.title.slice(0, 26)} · ${fmtClock12(next.block_start)}` : '', 40, 320); g.globalAlpha = 1;
    const latest = floaterInbox.items[0];
    if (floaterInbox.unread && latest) {
      g.fillStyle = '#E3262D'; g.fillRect(0, 360, 640, 40); g.fillStyle = '#fff'; g.font = '600 20px Montserrat, sans-serif';
      const [t, body] = alertPlain(latest);
      g.fillText(`🔔 ${floaterInbox.unread} new · ${t}: ${body}`.slice(0, 52), 40, 370);
    }
  };
  paint();
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.srcObject = c.captureStream(2);
  await video.play(); await video.requestPictureInPicture();
  const timer = setInterval(paint, 1000);
  floater = { kind: 'video', video };
  refreshFloaterInbox();
  video.addEventListener('leavepictureinpicture', () => { clearInterval(timer); floater = null; });
}
// If someone leaves the tab during a live time block without the floater open, suggest it once a day when they return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || floater || !S.me) return;
  const live = (floaterData.items || []).some((t) => isBlockNow(t) && t.status !== 'Done') || $('.tblock.live');
  let shown = ''; try { shown = localStorage.getItem('hh_float_tip') || ''; } catch (_) { /* storage blocked */ }
  if (live && shown !== todayStr()) {
    try { localStorage.setItem('hh_float_tip', todayStr()); } catch (_) { /* storage blocked */ }
    toast('Tip: click “Float timer” on your dashboard to keep your countdown visible in other tabs.');
  }
});

// "Today's plan": the person's time-blocked tasks on a timeline, with day navigation.
function planCard(box, userId, alive) {
  let day = todayStr();
  const reload = async () => {
    const r = await api('GET', `/api/schedule?date=${day}&user_id=${userId}`);
    if (alive && !alive()) return;
    const items = r.items;
    const open = items.filter((t) => t.status !== 'Done');
    const now = open.find(isBlockNow), next = open.find((t) => day === todayStr() && t.block_start > nowHHMM());
    const mins = items.reduce((a, t) => a + minutesOf(t.block_end) - minutesOf(t.block_start), 0);
    box.innerHTML = `<div class="card-head plan-head">
        <div><h2>${I.clock} ${day === todayStr() ? 'Today’s plan' : `Plan · ${dayWord(day)}`}</h2>
          <p class="small muted" style="margin-top:3px">${items.length ? `${items.length} time block${items.length === 1 ? '' : 's'} · ${hrs(mins * 60)} planned`
            + (now ? ` · <b class="now-text">Now: ${esc(now.title)} · <span ${countdownAttrs(now)}>${countdownText(now)}</span></b>` : next ? ` · Next: <b>${esc(next.title)}</b> at ${fmtClock12(next.block_start)}` : '') : 'Nothing planned yet'}</p></div>
        <div class="row" style="gap:8px;flex-wrap:nowrap"><button class="btn sm ghost" type="button" data-float title="Keep the countdown on top while you work in other tabs">${I.pip} Float timer</button>
        <div class="seg day-nav"><button data-d="-1" aria-label="Previous day">‹</button><button data-d="0" class="${day === todayStr() ? 'on' : ''}">Today</button><button data-d="1" aria-label="Next day">›</button></div></div>
      </div>
      ${timelineHTML([{ key: userId, items }], day, { emptyText: `<b>No time blocks ${day === todayStr() ? 'today' : 'this day'}</b>Open any of your tasks and set a <b>Time block</b> to plan when you’ll work on it.` })}`;
    $$('.day-nav button', box).forEach((b) => b.onclick = () => { day = b.dataset.d === '0' ? todayStr() : shiftDay(day, Number(b.dataset.d)); reload(); });
    $$('[data-task]', box).forEach((b) => b.onclick = () => openTask(Number(b.dataset.task), () => { reload(); }));
    $('[data-float]', box).onclick = openFloater;
    if (day === todayStr()) { floaterData = { items, day }; }
  };
  const refresher = setInterval(() => {
    if ((alive && !alive()) || !box.isConnected) return clearInterval(refresher);
    if (!$('#modal-root .modal-bg')) reload();
  }, 60000);
  return { reload, ready: reload() };
}

// Personal kanban: every task assigned to me, across all clients.
async function myTasksBoard(box, alive, onChange) {
  let clientFilter = sessionStorage.getItem('hh_my_client') || '';
  let show = sessionStorage.getItem('hh_my_show') || '';
  box.innerHTML = `
    <div class="card-head my-board-head">
      <div><h2>My tasks</h2><p class="small muted" id="my-sub" style="margin-top:3px"></p></div>
      <div class="row" style="flex-wrap:nowrap">
        <select class="input" id="my-show" aria-label="Show"><option value="">All tasks</option><option value="today">Time-blocked today</option><option value="planned">Has a time block</option><option value="unplanned">Not planned yet</option></select>
        <select class="input" id="my-client"><option value="">All clients</option>${S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <button class="btn red" id="my-new">${I.plus} New task</button>
      </div>
    </div>
    <div class="board my-board">${S.statuses.map((st) => `<div class="col" data-status="${esc(st)}">
      <div class="col-head"><span class="t"><i style="background:${STATUS_META[st].c}"></i>${esc(st)}</span><span class="count">0</span></div>
      <div class="col-body"></div></div>`).join('')}</div>`;
  $('#my-client', box).value = clientFilter; $('#my-show', box).value = show;
  let tasks = [];
  const showOk = (t) => !show || (show === 'today' ? t.block_date === todayStr() : show === 'planned' ? !!t.block_date : !t.block_date && t.status !== 'Done');
  const fill = () => {
    const list = tasks.filter((t) => (!clientFilter || String(t.client_id) === clientFilter) && showOk(t));
    if (show === 'today' || show === 'planned') list.sort((a, b) => `${a.block_date}${a.block_start}`.localeCompare(`${b.block_date}${b.block_start}`));
    $$('.col', box).forEach((col) => {
      const mine = list.filter((t) => t.status === col.dataset.status);
      $('.col-body', col).innerHTML = mine.map((t) => taskCardHTML(t, true)).join('');
      $('.count', col).textContent = mine.length;
    });
    const open = list.filter((t) => t.status !== 'Done');
    const overdue = open.filter(isOverdue).length;
    const today = open.filter((t) => t.deadline === todayStr()).length;
    $('#my-sub', box).innerHTML = `${open.length} open across ${new Set(open.map((t) => t.client_id)).size} client${new Set(open.map((t) => t.client_id)).size === 1 ? '' : 's'}`
      + (overdue ? ` · <span style="color:var(--red);font-weight:600">${overdue} overdue</span>` : '') + (today ? ` · ${today} due today` : '');
  };
  const load = async () => { tasks = await api('GET', '/api/tasks/mine?include_done=1'); if (alive && !alive()) return; fill(); if (onChange) onChange(); };
  $('#my-client', box).onchange = (e) => { clientFilter = e.target.value; sessionStorage.setItem('hh_my_client', clientFilter); fill(); };
  $('#my-show', box).onchange = (e) => { show = e.target.value; sessionStorage.setItem('hh_my_show', show); fill(); };
  $('#my-new', box).onclick = () => newTaskModal(clientFilter ? Number(clientFilter) : null, 'Not Started', load, { assignToMe: true });

  const board = $('.my-board', box);
  board.hhReload = load;
  board.addEventListener('click', (e) => { const card = e.target.closest('.tcard'); if (card) openTask(Number(card.dataset.id), load); });
  board.addEventListener('dragstart', (e) => { const card = e.target.closest('.tcard'); if (!card) return; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.id); });
  board.addEventListener('dragend', (e) => { e.target.closest('.tcard')?.classList.remove('dragging'); $$('.col', box).forEach((x) => x.classList.remove('drag-over')); });
  $$('.col', box).forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = $('.tcard.dragging', box); if (!dragging) return;
      $$('.col', box).forEach((x) => x.classList.toggle('drag-over', x === col));
      if (dragging.parentElement !== $('.col-body', col)) $('.col-body', col).prepend(dragging);
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drag-over');
      const dragging = $('.tcard.dragging', box); if (!dragging) return;
      const t = tasks.find((x) => x.id === Number(dragging.dataset.id));
      if (!t || t.status === col.dataset.status) { fill(); return; }
      // Only the status changes here, so each client board keeps its own card order.
      try { await api('PUT', `/api/tasks/${t.id}`, { status: col.dataset.status }); t.status = col.dataset.status; if (t.status === 'Done') toast('Nice work — task done!', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
      load();
    });
  });
  await load();
}

// ============================================================ kanban board
async function pageBoard(page, [cid], alive) {
  const fetchBoard = () => api('GET', `/api/clients/${cid}/tasks`);
  const data = await fetchBoard();
  if (!alive()) return;
  const c = data.client;
  setTitle(c.name, c.archived ? 'Archived client — restore it from the Archive to make changes'
    : [c.client_type, c.client_status, c.description].filter(Boolean).join(' · ') || 'Client task board');
  let filters = { q: '', assignee: '', priority: '' };
  try { filters = { ...filters, ...JSON.parse(sessionStorage.getItem('hh_board_filters') || '{}') }; } catch (_) { /* ignore */ }

  page.innerHTML = `
    <div class="board-bar">
      <input class="input" id="f-q" placeholder="Search tasks…" value="${esc(filters.q)}">
      <select class="input" id="f-assignee"><option value="">Everyone</option><option value="me">Assigned to me</option><option value="none">Unassigned</option>
        ${S.users.filter((u) => u.active).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <select class="input" id="f-priority"><option value="">Any priority</option>${S.priorities.map((p) => `<option>${p}</option>`).join('')}</select>
      <span style="flex:1"></span>
      <a class="btn ghost" id="board-chat" hidden>${I.chat} Chat</a>
      <button class="btn ghost" id="automations">${I.repeat} Automations<span class="btn-count" id="auto-count" hidden></span></button>
      <button class="btn red" id="new-task">${I.plus} New task</button>
    </div>
    <div class="board" id="board">
      ${S.statuses.map((s) => `<div class="col" data-status="${esc(s)}">
        <div class="col-head"><span class="t"><i style="background:${STATUS_META[s].c}"></i>${esc(s)}</span>
          <span class="row" style="gap:4px;flex-wrap:nowrap">${s === 'Done' ? `<button class="icon-btn" id="archive-done" title="Archive all done tasks">${I.archive}</button>` : ''}<span class="count">0</span></span></div>
        <div class="col-body"></div>
        ${s === 'Done' ? '<div class="done-more"></div>' : ''}
        <button class="add-card" data-add="${esc(s)}">+ Add task</button></div>`).join('')}
    </div>`;
  $('#f-assignee').value = filters.assignee; $('#f-priority').value = filters.priority;

  const fill = (d) => {
    $$('.col', page).forEach((col) => {
      const body = $('.col-body', col);
      body.innerHTML = d.tasks.filter((t) => t.status === col.dataset.status).map((t) => taskCardHTML(t)).join('');
    });
    const more = $('.col[data-status="Done"] .done-more', page);
    more.innerHTML = `${d.auto_archive_days ? `<span>Auto-archives ${d.auto_archive_days} day${d.auto_archive_days === 1 ? '' : 's'} after done</span>` : ''}
      ${d.archived_count ? `<a href="#/archive?client=${cid}">${I.archive} ${d.archived_count} archived</a>` : ''}`;
    applyFilters();
  };
  const reload = async () => { fill(await fetchBoard()); loadClients().then(refreshClientNav); };
  const applyFilters = () => {
    const qv = filters.q.toLowerCase();
    $$('.tcard', page).forEach((el) => {
      const ok = (!qv || el.dataset.search.includes(qv))
        && (!filters.priority || el.dataset.priority === filters.priority)
        && (!filters.assignee || (filters.assignee === 'me' ? el.dataset.assignee === String(S.me.id) : filters.assignee === 'none' ? !el.dataset.assignee : el.dataset.assignee === filters.assignee));
      el.classList.toggle('hidden', !ok);
    });
    $$('.col', page).forEach((col) => { $('.count', col).textContent = $$('.tcard:not(.hidden)', col).length; });
    try { sessionStorage.setItem('hh_board_filters', JSON.stringify(filters)); } catch (_) { /* ignore */ }
  };
  $('#f-q').oninput = (e) => { filters.q = e.target.value; applyFilters(); };
  $('#f-assignee').onchange = (e) => { filters.assignee = e.target.value; applyFilters(); };
  $('#f-priority').onchange = (e) => { filters.priority = e.target.value; applyFilters(); };
  $('#new-task').onclick = () => newTaskModal(c.id, 'Not Started', reload);
  const countAutos = async () => {
    const rules = await api('GET', `/api/clients/${c.id}/automations`);
    const n = rules.filter((r) => r.active).length; const el = $('#auto-count');
    if (el) { el.textContent = n; el.hidden = !n; }
  };
  $('#automations').onclick = () => automationsModal(c, async () => { await reload(); countAutos(); });
  countAutos();
  api('GET', `/api/clients/${c.id}/chat`).then((ids) => {   // a Google Chat space linked to this client
    const b = $('#board-chat'); if (b && ids.length) { b.href = `#/chat/${ids[0]}`; b.hidden = false; }
  }).catch(() => {});
  $$('[data-add]', page).forEach((b) => b.onclick = () => newTaskModal(c.id, b.dataset.add, reload));

  const board = $('#board');
  board.hhReload = reload;   // used by the quick reassign menu on cards
  board.addEventListener('click', (e) => { const card = e.target.closest('.tcard'); if (card) openTask(Number(card.dataset.id), reload); });
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.tcard'); if (!card) return;
    card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.id);
  });
  board.addEventListener('dragend', (e) => { const card = e.target.closest('.tcard'); if (card) card.classList.remove('dragging'); $$('.col', page).forEach((x) => x.classList.remove('drag-over')); });
  $$('.col', page).forEach((col) => {
    const body = $('.col-body', col);
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = $('.tcard.dragging', page); if (!dragging) return;
      $$('.col', page).forEach((x) => x.classList.toggle('drag-over', x === col));
      const after = $$('.tcard:not(.dragging)', body).find((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      if (after) body.insertBefore(dragging, after); else body.appendChild(dragging);
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const dragging = $('.tcard.dragging', page);
      const ids = $$('.tcard', body).map((x) => Number(x.dataset.id));
      if (dragging) dragging.dataset.status = col.dataset.status;
      applyFilters();
      try { await api('POST', '/api/tasks/reorder', { status: col.dataset.status, ids }); }
      catch (err) { toast(err.message, 'err'); reload(); }
    });
  });
  if (S.openTaskOnLoad) { const tid = S.openTaskOnLoad; S.openTaskOnLoad = null; openTask(tid, reload).catch(() => toast('That task was deleted', 'err')); }
  $('#archive-done').onclick = async (e) => {
    e.stopPropagation();
    const n = $$('.col[data-status="Done"] .tcard', page).length;
    if (!n) { toast('No done tasks to archive'); return; }
    if (!await confirmModal(`Archive all ${n} done task${n === 1 ? '' : 's'} on this board? You can find and restore them in the Archive.`, { okLabel: 'Archive', danger: false })) return;
    const r = await api('POST', `/api/clients/${cid}/archive-done`, {}); toast(`Archived ${r.archived} task${r.archived === 1 ? '' : 's'}`, 'ok'); reload();
  };
  fill(data);
}

function taskCardHTML(t, showClient = false) {
  try { return taskCardInner(t, showClient); }
  catch (err) {
    reportError(err, `task card ${t && t.id}`);
    return `<div class="tcard" data-id="${t.id}" draggable="true" data-status="${esc(t.status)}" data-search="${esc(String(t.title || '').toLowerCase())}"><div class="tt">${esc(t.title || 'Task')}</div></div>`;
  }
}
function taskCardInner(t, showClient) {
  const over = isOverdue(t);
  return `<div class="tcard p-${esc(t.priority)}" draggable="true" data-id="${t.id}" data-status="${esc(t.status)}" data-priority="${esc(t.priority)}"
      data-assignee="${t.assignee_id || ''}" data-search="${esc(`${t.title} ${t.description} ${t.assignee_name || ''}`.toLowerCase())}">
    ${showClient ? `<div class="tclient"><span class="client-dot" style="background:${esc(t.client_color)}"></span>${esc(t.client_name)}</div>` : ''}
    <div class="tt">${t.recurring_rule_id ? `<span class="rec-ic" title="Created by an automation">${I.repeat}</span>` : ''}${esc(t.title)}</div>
    ${t.description ? `<div class="td">${esc(t.description)}</div>` : ''}
    ${t.block_date && t.status !== 'Done' ? `<div class="tblock ${isBlockNow(t) ? 'live' : ''}">${I.clock}${isBlockNow(t) ? `Now · <span ${countdownAttrs(t)}>${countdownText(t)}</span>` : `${dayWord(t.block_date)} · ${blockRange(t)}`}</div>` : ''}
    <div class="meta">
      <div class="row" style="gap:6px">${prioBadge(t.priority)}${t.deadline ? `<span class="due ${over ? 'over' : ''}">${dueShort(t)}</span>` : ''}</div>
      <div class="icons">
        ${t.follower_count ? `<span title="${t.follower_count} follower${t.follower_count === 1 ? '' : 's'}">${I.eye.replace('width="18" height="18"', 'width="13" height="13"')} ${t.follower_count}</span>` : ''}
        ${t.comment_count ? `<span title="Comments">${I.chat.replace('width="18" height="18"', 'width="13" height="13"')} ${t.comment_count}</span>` : ''}
        ${t.file_count ? `<span title="Files">${I.clip.replace('width="18" height="18"', 'width="13" height="13"')} ${t.file_count}</span>` : ''}
        ${t.link_count ? `<span title="Links">${I.link.replace('width="18" height="18"', 'width="13" height="13"')} ${t.link_count}</span>` : ''}
      </div>
    </div>
    <div class="tassignee ${t.assignee_name ? '' : 'none'}" role="button" tabindex="0" data-reassign="${t.id}" data-current="${t.assignee_id || ''}" title="${t.assignee_name ? `Assigned to ${esc(t.assignee_name)} · click to reassign` : 'Nobody is assigned yet · click to assign'}">
      ${t.assignee_name ? `${av(t.assignee_name, t.assignee_avatar, 'xs')}<span>${esc(t.assignee_name.split(' ')[0])}${t.assignee_id === S.me?.id ? ' <em>(you)</em>' : ''}</span>`
        : `<span class="avatar xs ghost">${I.user.replace('width="18" height="18"', 'width="12" height="12"')}</span><span>Unassigned</span>`}
    </div></div>`;
}

// Quick reassign: click the assignee strip on any task card.
function closeAssigneeMenu() { $('.as-menu')?.remove(); document.removeEventListener('keydown', assigneeMenuKey); }
function assigneeMenuKey(e) { if (e.key === 'Escape') closeAssigneeMenu(); }
function assigneeMenu(strip) {
  const open = $('.as-menu'); closeAssigneeMenu();
  if (open && open.dataset.task === strip.dataset.reassign) return;   // second click closes it
  const tid = Number(strip.dataset.reassign), cur = strip.dataset.current;
  const people = [{ id: '', name: 'Unassigned' }, ...S.users.filter((u) => u.active)];
  const m = document.createElement('div');
  m.className = 'as-menu'; m.dataset.task = tid;
  m.innerHTML = `<div class="as-head">Assign to</div>${people.map((u) => `<button type="button" data-uid="${u.id}" class="${String(u.id) === cur ? 'on' : ''}">
    ${u.id ? av(u.name, u.avatar_file_id, 'xs') : `<span class="avatar xs ghost">${I.user.replace('width="18" height="18"', 'width="12" height="12"')}</span>`}
    <span>${esc(u.name)}${u.id === S.me.id ? ' <em>(you)</em>' : ''}</span>${String(u.id) === cur ? I.check.replace('width="18" height="18"', 'width="14" height="14"') : ''}</button>`).join('')}`;
  document.body.appendChild(m);
  const r = strip.getBoundingClientRect(), h = m.offsetHeight, w = m.offsetWidth;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  m.style.top = `${r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6}px`;
  document.addEventListener('keydown', assigneeMenuKey);
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-uid]'); if (!b) return;
    closeAssigneeMenu();
    if (b.dataset.uid === cur) return;
    try {
      const t = await api('PUT', `/api/tasks/${tid}`, { assignee_id: b.dataset.uid });
      toast(t.assignee_name ? `Assigned to ${t.assignee_name}${t.assignee_id !== S.me.id ? ' — they’ve been notified' : ''}` : 'Task unassigned', 'ok');
      const board = strip.closest('.my-board, #board');
      if (board?.hhReload) board.hhReload(); else route();
    } catch (err) { toast(err.message, 'err'); }
  });
}
document.addEventListener('click', (e) => {
  const strip = e.target.closest('.tcard [data-reassign]');
  if (strip) { e.stopPropagation(); e.preventDefault(); assigneeMenu(strip); return; }   // don't open the task window
  if (!e.target.closest('.as-menu')) closeAssigneeMenu();
}, true);
document.addEventListener('keydown', (e) => {
  const strip = e.target.closest?.('.tcard [data-reassign]');
  if (strip && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); assigneeMenu(strip); }
}, true);
window.addEventListener('scroll', closeAssigneeMenu, true);

const assigneeOptions = () => [['', 'Unassigned'], ...S.users.filter((u) => u.active).map((u) => [u.id, u.name])];

// Pick saved Resources to attach to a task. kind: 'link' | 'file'. Resolves with the chosen resources ([] if cancelled).
async function resourcePicker(kind, { attachedUrls = [], attachedFiles = [] } = {}) {
  const all = (await api('GET', '/api/resources')).filter((r) => (kind === 'file' ? r.file_id : r.url));
  return new Promise((resolve) => {
    const noun = kind === 'file' ? 'files' : 'links';
    const isAttached = (r) => (kind === 'file' ? attachedFiles.includes(r.file_name) : attachedUrls.includes(r.url));
    const cats = [...new Set(all.map((r) => r.category))].sort();
    const picked = new Set();
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    const { el, close } = openModal({
      title: `Add ${noun} from Resources`,
      body: all.length ? `<div class="row picker-bar" style="flex-wrap:nowrap">
            <input class="input" id="rp-q" placeholder="Search ${noun}…">
            ${cats.length > 1 ? `<select class="input" id="rp-cat" style="width:auto"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>` : ''}
          </div><div class="picker-list" id="rp-list"></div>`
        : `<div class="empty"><b>No saved ${noun} yet</b>Add SOPs, templates, and scripts on the <a href="#/resources" data-close>Resources</a> page, then attach them to any task from here.</div>`,
      foot: `<span class="small muted" id="rp-count" style="margin-right:auto"></span><button class="btn ghost" data-close>Cancel</button><button class="btn" id="rp-add" disabled>Add</button>`,
    });
    $$('[data-close]', el).forEach((b) => b.addEventListener('click', () => finish([])));
    new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); finish([]); } }).observe(document.getElementById('modal-root'), { childList: true });
    const draw = () => {
      const qv = ($('#rp-q', el)?.value || '').toLowerCase(), cat = $('#rp-cat', el)?.value || '';
      const rows = all.filter((r) => (!qv || `${r.title} ${r.description} ${r.url} ${r.file_name || ''}`.toLowerCase().includes(qv)) && (!cat || r.category === cat));
      const list = $('#rp-list', el); if (!list) return;
      list.innerHTML = rows.length ? rows.map((r) => {
        const added = isAttached(r);
        const sub = kind === 'file' ? (r.file_name || '') : r.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        return `<label class="pick-row ${added ? 'is-added' : ''}">
          <input type="checkbox" value="${r.id}" ${picked.has(r.id) ? 'checked' : ''} ${added ? 'disabled' : ''}>
          <span class="pick-ic ${kind}">${kind === 'file' ? I.clip : I.link}</span>
          <span class="pick-main"><b>${esc(r.title)}</b><small>${esc(sub)}</small></span>
          <span class="pick-meta">${added ? '<span class="badge b-green">Added</span>' : `<span class="badge b-navy">${esc(r.category)}</span>`}</span>
        </label>`;
      }).join('') : '<div class="empty" style="padding:20px 0">No matches.</div>';
    };
    const sync = () => {
      $('#rp-count', el).textContent = picked.size ? `${picked.size} selected` : '';
      const b = $('#rp-add', el); b.disabled = !picked.size; b.textContent = picked.size ? `Add ${picked.size} ${picked.size === 1 ? noun.slice(0, -1) : noun}` : 'Add';
    };
    if (all.length) {
      draw(); sync();
      $('#rp-q', el).addEventListener('input', draw);
      $('#rp-cat', el)?.addEventListener('change', draw);
      $('#rp-list', el).addEventListener('change', (e) => {
        const id = Number(e.target.value); if (e.target.checked) picked.add(id); else picked.delete(id); sync();
      });
      setTimeout(() => $('#rp-q', el).focus(), 40);
    }
    $('#rp-add', el).onclick = () => { const chosen = all.filter((r) => picked.has(r.id)); finish(chosen); close(); };
  });
}

function newTaskModal(clientId, status, onDone, opts = {}) {
  if (!clientId && !S.clients.length) { toast(isExec() ? 'Create a client first (Clients page)' : 'No clients yet — ask an executive to add one', 'err'); return; }
  const files = []; const links = []; const resFiles = []; const resLinks = [];  // resFiles/resLinks: chosen Resources
  const m = formModal({
    title: 'New task', wide: true, submit: 'Create task',
    fields: [
      ...(clientId ? [] : [{ name: 'client_id', label: 'Client', type: 'select', full: true, options: S.clients.map((c) => [c.id, c.name]), value: S.clients[0].id }]),
      { name: 'title', label: 'Task title', full: true, required: true },
      { name: 'description', label: 'Description', type: 'textarea', full: true },
      { name: 'status', label: 'Status', type: 'select', options: S.statuses, value: status },
      { name: 'priority', label: 'Priority level', type: 'select', options: S.priorities, value: 'Medium' },
      { name: 'assignee_id', label: 'Assignee', type: 'select', options: assigneeOptions(), value: opts.assignToMe ? S.me.id : '' },
      { name: 'deadline', label: 'Deadline', type: 'deadline' },
      { type: 'info', html: `<div class="nt-attach">
          <div class="section-title" style="margin-top:4px"><span>Files</span><span class="row" style="gap:6px;flex-wrap:nowrap">
            <button type="button" class="btn sm ghost" id="nt-res-files">${I.folder} From Resources</button>
            <label class="btn sm soft" style="cursor:pointer">${I.plus} Upload<input type="file" id="nt-file" hidden multiple></label></span></div>
          <div class="stack" id="nt-files"><p class="small muted">No files added.</p></div>
          <div class="section-title"><span>Links</span><button type="button" class="btn sm ghost" id="nt-res-links">${I.folder} From Resources</button></div>
          <div class="stack" id="nt-links"></div>
          <div class="row" style="margin-top:8px;flex-wrap:nowrap">
            <input class="input" id="nt-url" placeholder="https://…"><input class="input" id="nt-label" placeholder="Label (optional)" style="max-width:170px">
            <button type="button" class="btn sm" id="nt-add-link">Add</button></div>
          <p class="small muted" style="margin-top:10px">Everything here is attached before the Google Chat alert goes out, so the message arrives complete.</p>
        </div>` },
    ],
    onSubmit: async (d, close) => {
      addPendingLink();
      const btn = $('[data-submit]', m.el);
      const t = await api('POST', '/api/tasks', { ...d, client_id: clientId || d.client_id, defer_alert: true });
      let failed = 0;
      for (const [i, file] of files.entries()) {
        btn.textContent = `Uploading ${i + 1} of ${files.length}…`;
        const fd = new FormData(); fd.append('file', file);
        try { await api('POST', `/api/tasks/${t.id}/files`, fd); } catch (err) { failed++; toast(`${file.name}: ${err.message}`, 'err'); }
      }
      for (const l of links) {
        try { await api('POST', `/api/tasks/${t.id}/links`, l); } catch (err) { failed++; toast(err.message, 'err'); }
      }
      for (const [only, list] of [['files', resFiles], ['links', resLinks]]) {
        if (!list.length) continue;
        btn.textContent = 'Adding from Resources…';
        try { await api('POST', `/api/tasks/${t.id}/import-resources`, { ids: list.map((r) => r.id), only }); } catch (err) { failed++; toast(err.message, 'err'); }
      }
      await api('POST', `/api/tasks/${t.id}/announce`, {}).catch(() => {});
      close(); toast(failed ? 'Task created — some attachments failed' : 'Task created', failed ? 'err' : 'ok');
      await onDone();
      openTask(t.id, onDone);
    },
  });
  const el = m.el;
  const resTag = '<span class="res-tag">Resource</span>';
  const drawFiles = () => {
    $('#nt-files', el).innerHTML = (files.length || resFiles.length) ? files.map((f, i) => `<div class="att"><span class="ic">${I.clip}</span>
      <a>${esc(f.name)}</a><span class="small muted">${fmtSize(f.size)}</span>
      <button type="button" class="icon-btn" data-rm-file="${i}" aria-label="Remove file">${I.trash}</button></div>`).join('')
      + resFiles.map((r, i) => `<div class="att"><span class="ic">${I.clip}</span><a>${esc(r.file_name || r.title)}</a>${resTag}
      <button type="button" class="icon-btn" data-rm-resfile="${i}" aria-label="Remove">${I.trash}</button></div>`).join('') : '<p class="small muted">No files added.</p>';
  };
  const drawLinks = () => {
    $('#nt-links', el).innerHTML = links.map((l, i) => `<div class="att"><span class="ic">${I.link}</span>
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a>
      <button type="button" class="icon-btn" data-rm-link="${i}" aria-label="Remove link">${I.trash}</button></div>`).join('')
      + resLinks.map((r, i) => `<div class="att"><span class="ic">${I.link}</span>
      <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a>${resTag}
      <button type="button" class="icon-btn" data-rm-reslink="${i}" aria-label="Remove">${I.trash}</button></div>`).join('');
  };
  $('#nt-res-files', el).onclick = async () => {
    const chosen = await resourcePicker('file', { attachedFiles: [...files.map((f) => f.name), ...resFiles.map((r) => r.file_name)] });
    chosen.forEach((r) => { if (!resFiles.some((x) => x.id === r.id)) resFiles.push(r); }); drawFiles();
  };
  $('#nt-res-links', el).onclick = async () => {
    const chosen = await resourcePicker('link', { attachedUrls: [...links.map((l) => l.url), ...resLinks.map((r) => r.url)] });
    chosen.forEach((r) => { if (!resLinks.some((x) => x.id === r.id)) resLinks.push(r); }); drawLinks();
  };
  function addPendingLink() {
    let url = $('#nt-url', el).value.trim(); if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    links.push({ url, label: $('#nt-label', el).value.trim() });
    $('#nt-url', el).value = ''; $('#nt-label', el).value = ''; drawLinks();
  }
  $('#nt-file', el).onchange = (e) => {
    for (const f of e.target.files) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is over 25 MB`, 'err'); continue; }
      files.push(f);
    }
    e.target.value = ''; drawFiles();
  };
  $('#nt-add-link', el).onclick = addPendingLink;
  ['#nt-url', '#nt-label'].forEach((sel) => $(sel, el).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); addPendingLink(); }  // add the link, don't submit the form
  }));
  el.addEventListener('click', (e) => {
    const rf = e.target.closest('[data-rm-file]'), rl = e.target.closest('[data-rm-link]');
    if (rf) { files.splice(Number(rf.dataset.rmFile), 1); drawFiles(); }
    if (rl) { links.splice(Number(rl.dataset.rmLink), 1); drawLinks(); }
    const rrf = e.target.closest('[data-rm-resfile]'), rrl = e.target.closest('[data-rm-reslink]');
    if (rrf) { resFiles.splice(Number(rrf.dataset.rmResfile), 1); drawFiles(); }
    if (rrl) { resLinks.splice(Number(rrl.dataset.rmReslink), 1); drawLinks(); }
  });
}

async function openTask(id, onChange) {
  const t = await api('GET', `/api/tasks/${id}`);
  const { el, close } = openModal({
    title: t.client_name, wide: true,
    body: `${t.archived_at ? `<div class="archived-banner">${I.archive}<span>Archived ${fmtDateTs(t.archived_at)}${t.archived_by_name ? ` by ${esc(t.archived_by_name)}` : ' automatically'} — it's hidden from the board but kept for reference.</span></div>` : ''}
      <div class="task-layout">
      <div>
        <label class="field">Task title<input class="input" id="t-title" value="${esc(t.title)}" style="font-size:16px;font-weight:700"></label>
        <label class="field" style="margin-top:14px">Description<textarea class="input" id="t-desc" rows="5" placeholder="What needs to be done, links to context, acceptance criteria…">${esc(t.description)}</textarea></label>
        <div class="section-title"><span>Files</span><span class="row" style="gap:6px;flex-wrap:nowrap">
          <button type="button" class="btn sm ghost" id="t-res-files">${I.folder} From Resources</button>
          <label class="btn sm soft" style="cursor:pointer">${I.plus} Upload<input type="file" id="t-file" hidden multiple></label></span></div>
        <div class="stack" id="t-files"></div>
        <div class="section-title"><span>Links</span><button type="button" class="btn sm ghost" id="t-res-links">${I.folder} From Resources</button></div>
        <div class="stack" id="t-links"></div>
        <div class="row" style="margin-top:8px;flex-wrap:nowrap">
          <input class="input" id="l-url" placeholder="https://…"><input class="input" id="l-label" placeholder="Label (optional)" style="max-width:170px">
          <button class="btn sm" id="l-add">Add</button></div>
        <div class="section-title"><span>Comments <span id="c-count"></span></span></div>
        <div id="t-comments" class="comments"><div class="small muted">Loading…</div></div>
        <div class="composer">
          ${av(S.me.name, S.me.avatar_file_id, 'sm')}
          <div class="composer-box">
            <textarea class="input" id="c-body" rows="2" placeholder="Write a comment… type @ to tag, paste a screenshot to attach it"></textarea>
            <div class="mention-pop hidden" id="c-pop"></div>
            <div class="c-tray" id="c-tray" hidden></div>
            <div class="composer-foot"><span>${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + Enter to send</span>
              <span class="row" style="gap:6px;flex-wrap:nowrap"><label class="icon-btn c-attach" title="Attach images (or paste / drop them)">${I.image}<input type="file" id="c-file" accept="image/*" multiple hidden></label>
              <button class="btn sm" id="c-send">${I.send} Comment</button></span></div>
          </div>
        </div>
      </div>
      <aside class="task-side">
        <label class="field">Status<select class="input" id="t-status">${S.statuses.map((s) => `<option ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field">Priority level<select class="input" id="t-priority">${S.priorities.map((p) => `<option ${p === t.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label class="field">Assignee<span class="assignee-pick"><span id="t-assignee-av">${t.assignee_name ? av(t.assignee_name, t.assignee_avatar) : `<span class="avatar ghost">${I.user}</span>`}</span><select class="input" id="t-assignee">${assigneeOptions().map(([v, l]) => `<option value="${v}" ${String(v) === String(t.assignee_id || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></span></label>
        <label class="field"><span class="field-label">Deadline<span class="hint">· time optional</span></span>${deadlineInputs(t.deadline, t.deadline_time, 't-')}</label>
        <div class="tb-box fl-box">
          <div class="field-label" style="font-weight:600;font-size:11.5px;color:var(--navy)">${I.eye.replace('width="18" height="18"', 'width="13" height="13"')} Followers<span class="hint">· comments &amp; deadline alerts</span></div>
          <div class="fl-list" id="t-followers"></div>
          <div class="fl-actions"><button type="button" class="btn sm" id="t-follow"></button>
            <select class="input" id="t-add-follower"><option value="">+ Add teammate</option>${S.users.filter((u) => u.active).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
        </div>
        <div class="tb-box">
          <div class="field-label" style="font-weight:600;font-size:11.5px;color:var(--navy)">${I.clock.replace('width="18" height="18"', 'width="13" height="13"')} Time block<span class="hint">· optional</span></div>
          ${t.assignee_id && (t.assignee_id === S.me.id || isExec()) ? `
            <input class="input" type="date" id="tb-date" value="${esc(t.block_date || '')}">
            <div class="tb-times"><span>From</span><input class="input" type="time" id="tb-start" value="${esc(t.block_start || '')}"><span>To</span><input class="input" type="time" id="tb-end" value="${esc(t.block_end || '')}"></div>
            ${isBlockNow(t) && t.status !== 'Done' ? `<div class="tb-live">${I.clock}<span ${countdownAttrs(t)}>${countdownText(t)}</span><small>in this time block</small></div>` : ''}
            <p class="small muted">${t.assignee_id === S.me.id ? 'Plan when you’ll work on this. It shows on your dashboard.' : `Planned by ${esc(t.assignee_name)}.`}</p>
            ${t.block_date ? '<button type="button" class="linkbtn dark" id="tb-clear" style="align-self:flex-start">Clear time block</button>' : ''}`
          : `<p class="small muted">${t.block_date ? `${dayWord(t.block_date)} · ${blockRange(t)}` : t.assignee_id ? `Only ${esc(t.assignee_name)} can plan this task’s time block.` : 'Assign this task first — the assignee can then plan a time block.'}</p>`}
        </div>
        <div><div class="small muted">Date created</div><b>${fmtDateTs(t.created_at)}</b></div>
        ${t.automation ? `<div><div class="small muted">Created by automation</div><b class="row" style="gap:6px;flex-wrap:nowrap">${I.repeat}${esc(t.automation.title)}</b></div>` : ''}
        <div><div class="small muted">Last updated</div><b>${fmtDateTs(t.updated_at)}</b></div>
      </aside></div>`,
    foot: `${isExec() ? `<button class="btn ghost" id="t-del" style="color:var(--red)">${I.trash} Delete</button>` : ''}
      ${t.archived_at ? `<button class="btn ghost" id="t-restore">${I.restore} Restore to board</button>` : `<button class="btn ghost" id="t-archive">${I.archive} Archive</button>`}
      <span style="flex:1"></span><button class="btn ghost" data-close>Close</button><button class="btn" id="t-save">Save changes</button>`,
  });
  $$('[data-close]', el).forEach((b) => b.addEventListener('click', () => onChange && onChange()));

  const renderAttachments = (task) => {
    $('#t-files', el).innerHTML = task.files.length ? task.files.map((f) => `<div class="att"><span class="ic">${I.clip}</span>
      <a href="/api/files/${f.id}" target="_blank" rel="noopener">${esc(f.original_name)}</a><span class="small muted">${fmtSize(f.size)}</span>
      <button class="icon-btn" data-del-file="${f.id}" aria-label="Remove file">${I.trash}</button></div>`).join('') : '<p class="small muted">No files yet.</p>';
    $('#t-links', el).innerHTML = task.links.length ? task.links.map((l) => `<div class="att"><span class="ic">${I.link}</span>
      <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a>
      <button class="icon-btn" data-del-link="${l.id}" aria-label="Remove link">${I.trash}</button></div>`).join('') : '<p class="small muted">No links yet.</p>';
  };
  renderAttachments(t);
  let current = t;
  const refresh = async () => { current = await api('GET', `/api/tasks/${id}`); renderAttachments(current); };
  const importFrom = async (kind) => {
    const chosen = await resourcePicker(kind, { attachedUrls: current.links.map((l) => l.url), attachedFiles: current.files.map((f) => f.original_name) });
    if (!chosen.length) return;
    try {
      const r = await api('POST', `/api/tasks/${id}/import-resources`, { ids: chosen.map((x) => x.id), only: kind === 'file' ? 'files' : 'links' });
      current = r.task; renderAttachments(current);
      const n = r.added_files + r.added_links;
      toast(n ? `Added ${n} from Resources` : 'Already attached', n ? 'ok' : '');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#t-res-files', el).onclick = () => importFrom('file');
  $('#t-res-links', el).onclick = () => importFrom('link');

  $('#t-file', el).onchange = async (e) => {
    for (const file of e.target.files) {
      const fd = new FormData(); fd.append('file', file);
      try { await api('POST', `/api/tasks/${id}/files`, fd); } catch (err) { toast(err.message, 'err'); }
    }
    e.target.value = ''; refresh(); toast('Uploaded', 'ok');
  };
  $('#l-add', el).onclick = async () => {
    const url = $('#l-url', el).value.trim(); if (!url) return;
    try { await api('POST', `/api/tasks/${id}/links`, { url, label: $('#l-label', el).value }); $('#l-url', el).value = ''; $('#l-label', el).value = ''; refresh(); }
    catch (err) { toast(err.message, 'err'); }
  };
  el.addEventListener('click', async (e) => {
    const df = e.target.closest('[data-del-file]'); const dl = e.target.closest('[data-del-link]');
    if (df && await confirmModal('Remove this file?')) { await api('DELETE', `/api/files/${df.dataset.delFile}`); refresh(); }
    if (dl) { await api('DELETE', `/api/task-links/${dl.dataset.delLink}`); refresh(); }
  });
  $('#t-save', el).onclick = async () => {
    try {
      await api('PUT', `/api/tasks/${id}`, {
        title: $('#t-title', el).value, description: $('#t-desc', el).value,
        status: $('#t-status', el).value, priority: $('#t-priority', el).value, assignee_id: $('#t-assignee', el).value, deadline: $('#t-deadline', el).value, deadline_time: $('#t-deadline-time', el).value,
        ...($('#tb-date', el) ? { block_date: $('#tb-date', el).value, block_start: $('#tb-start', el).value, block_end: $('#tb-end', el).value } : {}),
      });
      toast('Task saved', 'ok'); close(); onChange && onChange();
    } catch (err) { toast(err.message, 'err'); }
  };
  setupComments(el, id);
  let followers = t.followers || [];
  const drawFollowers = () => {
    $('#t-followers', el).innerHTML = followers.length ? followers.map((f) => `<span class="fl-chip">${av(f.name, f.avatar_file_id, 'xs')}<span>${esc(f.name.split(' ')[0])}${f.id === S.me.id ? ' (you)' : ''}</span>
      <button type="button" data-unfollow="${f.id}" aria-label="Remove ${esc(f.name)}" title="Remove">${I.x.replace('width="18" height="18"', 'width="11" height="11"')}</button></span>`).join('')
      : '<span class="small muted">No followers yet.</span>';
    const mine = followers.some((f) => f.id === S.me.id);
    const btn = $('#t-follow', el); btn.innerHTML = `${I.eye} ${mine ? 'Following' : 'Follow'}`; btn.classList.toggle('soft', mine);
    $$('#t-add-follower option', el).forEach((o) => { if (o.value) o.disabled = followers.some((f) => String(f.id) === o.value); });
  };
  drawFollowers();
  $('#t-follow', el).onclick = async () => {
    const mine = followers.some((f) => f.id === S.me.id);
    try {
      followers = (await api(mine ? 'DELETE' : 'POST', mine ? `/api/tasks/${id}/followers/${S.me.id}` : `/api/tasks/${id}/followers`, mine ? undefined : {})).followers;
      drawFollowers(); toast(mine ? 'You’ll no longer get updates on this task' : 'Following — you’ll get comments and deadline alerts', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#t-add-follower', el).onchange = async (e) => {
    const uid = e.target.value; e.target.value = ''; if (!uid) return;
    try { followers = (await api('POST', `/api/tasks/${id}/followers`, { user_id: Number(uid) })).followers; drawFollowers(); } catch (err) { toast(err.message, 'err'); }
  };
  $('#t-followers', el).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-unfollow]'); if (!b) return;
    try { followers = (await api('DELETE', `/api/tasks/${id}/followers/${b.dataset.unfollow}`)).followers; drawFollowers(); } catch (err) { toast(err.message, 'err'); }
  });
  let savedAssignee = String(t.assignee_id || '');
  $('#t-assignee', el).addEventListener('change', async (e) => {   // reassigning saves right away
    const sel = e.target, u = S.users.find((x) => String(x.id) === sel.value);
    try {
      await api('PUT', `/api/tasks/${id}`, { assignee_id: sel.value });
      savedAssignee = sel.value;
      $('#t-assignee-av', el).innerHTML = u ? av(u.name, u.avatar_file_id) : `<span class="avatar ghost">${I.user}</span>`;
      const tb = $('#tb-date', el)?.closest('.tb-box');   // a time block belongs to its assignee, so it was cleared
      if (tb) tb.querySelectorAll('#tb-date, .tb-times, .tb-live, #tb-clear, p').forEach((x) => x.remove()), tb.insertAdjacentHTML('beforeend', `<p class="small muted">${u ? `Reassigned — ${esc(u.name.split(' ')[0])} can plan a time block.` : 'Assign this task first — the assignee can then plan a time block.'}</p>`);
      toast(u ? `Assigned to ${u.name}${u.id !== S.me.id ? ' — they’ve been notified' : ''}` : 'Task unassigned', 'ok');
      onChange && onChange();
    } catch (err) { sel.value = savedAssignee; toast(err.message, 'err'); }
  });
  if ($('#tb-clear', el)) $('#tb-clear', el).onclick = () => { $('#tb-date', el).value = ''; $('#tb-start', el).value = ''; $('#tb-end', el).value = ''; toast('Time block will be cleared when you save'); };
  if ($('#tb-date', el)) $('#tb-date', el).addEventListener('change', () => {  // sensible default: a 1-hour block from the next half hour
    if (!$('#tb-start', el).value && $('#tb-date', el).value) {
      const m = Math.ceil((minutesOf(nowHHMM()) + 1) / 30) * 30, s0 = Math.min(m, 22 * 60), e0 = s0 + 60;
      const hm = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
      $('#tb-start', el).value = hm(s0); $('#tb-end', el).value = hm(e0);
    }
  });
  api('POST', '/api/notifications/read', { task_id: id }).then(pollNotifications).catch(() => {});
  if ($('#t-archive', el)) $('#t-archive', el).onclick = async () => {
    await api('POST', `/api/tasks/${id}/archive`, {}); toast('Task archived', 'ok'); close(); onChange && onChange();
  };
  if ($('#t-restore', el)) $('#t-restore', el).onclick = async () => {
    await api('POST', `/api/tasks/${id}/restore`, {}); toast('Restored to the board', 'ok'); close(); onChange && onChange();
  };
  if ($('#t-del', el)) $('#t-del', el).onclick = async () => {
    if (!await confirmModal(`Delete "${t.title}"? Its files, links, and comments will be removed too.`)) return;
    await api('DELETE', `/api/tasks/${id}`); toast('Task deleted'); close(); onChange && onChange();
  };
}

// ============================================================ comments & @mentions
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MENTION_TOKEN = /@\[([^\]\n]{1,80})\]\((\d+)\)/g;
function timeAgo(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return fmtDateTs(iso);
}
// Typed "@Jane VA" becomes a stored token "@[Jane VA](2)" so renames don't break tags.
function mentionsToTokens(text) {
  const people = S.users.filter((u) => u.active).sort((a, b) => b.name.length - a.name.length);
  for (const u of people) text = text.replace(new RegExp(`@${escRe(u.name)}(?![\\w])`, 'g'), `@[${u.name}](${u.id})`);
  return text;
}
const tokensToMentions = (text) => text.replace(MENTION_TOKEN, (_m, name) => `@${name}`);
function renderRich(text) {
  return esc(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(MENTION_TOKEN, (_m, name, id) => `<span class="mention ${Number(id) === S.me.id ? 'me' : ''}">@${name}</span>`);
}

function attachMentionPicker(ta, pop) {
  let matches = [], idx = 0, start = -1;
  const close = () => { pop.classList.add('hidden'); matches = []; };
  const update = () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/(?:^|\s)@([^\s@]{0,30})$/);
    if (!m) return close();
    start = ta.selectionStart - m[1].length - 1;
    const qv = m[1].toLowerCase();
    matches = S.users.filter((u) => u.active && u.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(qv)) || (qv && u.name.toLowerCase().startsWith(qv))).slice(0, 6);
    matches = [...new Map(matches.map((u) => [u.id, u])).values()];
    if (!matches.length) return close();
    idx = Math.min(idx, matches.length - 1);
    pop.innerHTML = matches.map((u, i) => `<button type="button" class="${i === idx ? 'on' : ''}" data-i="${i}">${av(u.name, u.avatar_file_id, 'sm')}<span><b>${esc(u.name)}</b><small>${esc(u.position || u.email)}</small></span></button>`).join('');
    pop.classList.remove('hidden');
  };
  const pick = (u) => {
    const after = ta.value.slice(ta.selectionStart);
    ta.value = `${ta.value.slice(0, start)}@${u.name} ${after}`;
    const caret = start + u.name.length + 2;
    ta.setSelectionRange(caret, caret); ta.focus(); close();
  };
  ta.addEventListener('input', () => { idx = 0; update(); });
  ta.addEventListener('click', update);
  ta.addEventListener('blur', () => setTimeout(close, 150));
  ta.addEventListener('keydown', (e) => {
    if (pop.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; update(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); pick(matches[idx]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  pop.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(matches[Number(b.dataset.i)]); } });
}

const REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '✅', '🔥', '💯', '🙌', '👏', '🚀', '💪', '🤝', '😮', '😅', '🤔', '😢', '⭐', '📌', '❗', '❓', '👌', '🏡'];
const fileUrl = (id) => `/api/files/${id}?inline=1`;
function lightbox(src, name, download) {   // full-size view of a comment image
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${esc(src)}" alt="${esc(name || 'Image')}"><div class="lb-bar"><span>${esc(name || '')}</span>
    <a class="btn sm ghost" href="${esc(download || src.replace('?inline=1', ''))}">Download</a><button class="btn sm" type="button" data-lb-close>Close</button></div>`;
  const close = () => { box.remove(); document.removeEventListener('keydown', key, true); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-lb-close]')) close(); });
  document.addEventListener('keydown', key, true);
  document.body.appendChild(box);
}
function commentImagesHTML(c) {
  if (!c.images || !c.images.length) return '';
  return `<div class="c-imgs ${c.images.length === 1 ? 'one' : ''}">${c.images.map((f) => `<button type="button" class="c-img" data-img="${f.id}" title="${esc(f.original_name)}">
    <img src="${fileUrl(f.id)}" alt="${esc(f.original_name)}" loading="lazy"></button>`).join('')}</div>`;
}
function reactionsHTML(c) {
  const order = (e) => { const i = REACTION_EMOJI.indexOf(e); return i < 0 ? 99 : i; };
  const chips = [...(c.reactions || [])].sort((a, b) => order(a.emoji) - order(b.emoji)).map((r) => `<button type="button" class="rx ${r.mine ? 'mine' : ''}" data-react="${esc(r.emoji)}"
    title="${esc(r.names.join(', '))} reacted with ${esc(r.emoji)}"><span class="rx-e">${esc(r.emoji)}</span><span>${r.count}</span></button>`).join('');
  return `<div class="rx-row ${chips ? '' : 'rx-none'}">${chips}<button type="button" class="rx rx-add" data-react-add title="Add reaction">${I.smile}<span>+</span></button></div>`;
}
function emojiPicker(anchor, onPick) {
  $('.emoji-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'emoji-pop';
  pop.innerHTML = REACTION_EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`;
  pop.style.top = `${r.top - h - 6 > 8 ? r.top - h - 6 : r.bottom + 6}px`;
  const close = () => { pop.remove(); document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); };
  const outside = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
  const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  pop.addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) { close(); onPick(b.dataset.e); } });
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true); });
}

function setupComments(el, taskId) {
  const list = $('#t-comments', el), ta = $('#c-body', el), tray = $('#c-tray', el);
  attachMentionPicker(ta, $('#c-pop', el));
  let comments = [];
  let pending = [];   // images attached to the comment being written: { key, url, id?, name }
  const commentHTML = (c) => `<div class="comment" data-cid="${c.id}">
      ${av(c.user_name || 'Former member', c.user_avatar, 'sm')}
      <div class="comment-main">
        <div class="comment-head"><b>${esc(c.user_name || 'Former member')}</b><span class="comment-time" title="${esc(fmtDateTs(c.created_at))} ${esc(fmtTime(c.created_at))}">${timeAgo(c.created_at)}${c.edited_at ? ' · edited' : ''}</span>
          <span class="comment-actions"><button data-react-add title="Add reaction">${I.smile.replace('width="18" height="18"', 'width="14" height="14"')}</button>${c.user_id === S.me.id ? `<button data-c-edit="${c.id}">Edit</button>` : ''}${c.user_id === S.me.id || isExec() ? `<button data-c-del="${c.id}">Delete</button>` : ''}</span></div>
        ${c.body ? `<div class="comment-body">${renderRich(c.body)}</div>` : ''}
        ${commentImagesHTML(c)}
        ${reactionsHTML(c)}
      </div></div>`;
  const draw = (stay) => {
    const top = list.scrollTop;
    $('#c-count', el).textContent = comments.length ? `· ${comments.length}` : '';
    list.innerHTML = comments.length ? comments.map(commentHTML).join('') : '<p class="small muted">No comments yet. Start the conversation — type @ to tag someone.</p>';
    list.scrollTop = stay ? top : list.scrollHeight;
    if (!stay) $$('img', list).forEach((img) => img.addEventListener('load', () => { list.scrollTop = list.scrollHeight; }, { once: true }));
  };
  const drawOne = (c) => {   // update a single comment in place (reactions) without jumping the scroll
    const i = comments.findIndex((x) => x.id === c.id); if (i < 0) return;
    comments[i] = c;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const node = $(`[data-cid="${c.id}"]`, list); if (node) node.outerHTML = commentHTML(c);
    if (atBottom) list.scrollTop = list.scrollHeight;
  };
  const drawTray = () => {
    tray.hidden = !pending.length;
    tray.innerHTML = pending.map((p) => `<span class="c-thumb ${p.id ? '' : 'loading'}" title="${esc(p.name)}"><img src="${p.url}" alt="">
      <button type="button" data-unattach="${p.key}" aria-label="Remove image">${I.x.replace('width="18" height="18"', 'width="11" height="11"')}</button></span>`).join('');
  };
  const addImages = (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return false;
    if (pending.length + imgs.length > 10) { toast('Up to 10 images per comment', 'err'); return true; }
    imgs.forEach(async (file) => {
      if (file.size > 10 * 1024 * 1024) { toast(`${file.name || 'Image'} is over 10 MB`, 'err'); return; }
      const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const name = file.name && file.name !== 'image.png' ? file.name : `Screenshot ${new Date().toLocaleString()}.${ext}`.replace(/[/:]/g, '-');
      const p = { key: Math.random().toString(36).slice(2), url: URL.createObjectURL(file), name };
      pending.push(p); drawTray();
      try {
        const fd = new FormData(); fd.append('file', file, name);
        p.id = (await api('POST', '/api/comment-images', fd)).id;
      } catch (err) { pending = pending.filter((x) => x !== p); toast(err.message, 'err'); }
      drawTray();
    });
    return true;
  };
  const load = async () => { comments = await api('GET', `/api/tasks/${taskId}/comments`); draw(); };
  const send = async () => {
    const text = ta.value.trim(); if (!text && !pending.length) return;
    if (pending.some((p) => !p.id)) { toast('Still uploading your image — one moment'); return; }
    const btn = $('#c-send', el); btn.disabled = true;
    try {
      comments.push(await api('POST', `/api/tasks/${taskId}/comments`, { body: mentionsToTokens(text), image_ids: pending.map((p) => p.id) }));
      ta.value = ''; pending.forEach((p) => URL.revokeObjectURL(p.url)); pending = []; drawTray(); draw();
    } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
  };
  $('#c-send', el).onclick = send;
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } });
  ta.addEventListener('paste', (e) => {   // screenshots and copied photos
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
    if (files.length && addImages(files)) e.preventDefault();
  });
  const box = ta.closest('.composer-box');
  box.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('drop'); } });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', (e) => { box.classList.remove('drop'); if (e.dataTransfer?.files?.length && addImages(e.dataTransfer.files)) e.preventDefault(); });
  $('#c-file', el).onchange = (e) => { addImages(e.target.files); e.target.value = ''; };
  tray.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unattach]'); if (!b) return;
    const p = pending.find((x) => x.key === b.dataset.unattach);
    pending = pending.filter((x) => x !== p); drawTray();
    if (p?.id) api('DELETE', `/api/files/${p.id}`).catch(() => {});
  });
  list.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-c-edit]'), de = e.target.closest('[data-c-del]');
    const img = e.target.closest('[data-img]'), rx = e.target.closest('[data-react]'), add = e.target.closest('[data-react-add]');
    const cid = Number(e.target.closest('[data-cid]')?.dataset.cid);
    if (img) { lightbox(fileUrl(img.dataset.img), img.title); return; }
    if (rx || add) {
      const react = async (emoji) => { try { drawOne(await api('POST', `/api/comments/${cid}/reactions`, { emoji })); } catch (err) { toast(err.message, 'err'); } };
      if (rx) react(rx.dataset.react); else emojiPicker(add, react);
      return;
    }
    if (de && await confirmModal('Delete this comment?')) {
      try { await api('DELETE', `/api/comments/${de.dataset.cDel}`); comments = comments.filter((c) => c.id !== Number(de.dataset.cDel)); draw(true); } catch (err) { toast(err.message, 'err'); }
    }
    if (ed) {
      const c = comments.find((x) => x.id === Number(ed.dataset.cEdit));
      let body = $(`[data-cid="${c.id}"] .comment-body`, list);
      if (!body) { $(`[data-cid="${c.id}"] .comment-head`, list).insertAdjacentHTML('afterend', '<div class="comment-body"></div>'); body = $(`[data-cid="${c.id}"] .comment-body`, list); }
      body.innerHTML = `<div class="composer-box"><textarea class="input" rows="3">${esc(tokensToMentions(c.body))}</textarea><div class="mention-pop hidden"></div>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn sm ghost" data-x>Cancel</button><button class="btn sm" data-ok>Save</button></div></div>`;
      const eta = $('textarea', body); attachMentionPicker(eta, $('.mention-pop', body)); eta.focus();
      $('[data-x]', body).onclick = () => draw(true);
      $('[data-ok]', body).onclick = async () => {
        try { const u = await api('PUT', `/api/comments/${c.id}`, { body: mentionsToTokens(eta.value) }); Object.assign(c, u); draw(true); } catch (err) { toast(err.message, 'err'); }
      };
    }
  });
  load();
}

// ============================================================ notifications
// ---------- alert sounds (synthesised, no audio files) + desktop pop-ups
const soundOn = () => { try { return localStorage.getItem('hh_sound') !== 'off'; } catch (_) { return true; } };
const setSound = (on) => { try { localStorage.setItem('hh_sound', on ? 'on' : 'off'); } catch (_) { /* storage blocked */ } };
let audioCtx = null;
function unlockAudio() {  // browsers only allow sound after the person has clicked or typed on the page once
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (_) { /* no audio */ }
}
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));
const TONES = {   // [frequency Hz, start s, length s]
  comment: [[659.25, 0, 0.16], [880, 0.13, 0.24]],                                   // soft two-note chime
  mention: [[783.99, 0, 0.12], [987.77, 0.1, 0.12], [1318.5, 0.2, 0.3]],            // bright rising triad
  deadline: [[880, 0, 0.13], [880, 0.2, 0.13], [880, 0.4, 0.13], [1174.66, 0.62, 0.34]], // urgent pulses
};
const SOUND_PRIORITY = ['deadline', 'mention', 'comment'];
function playTone(kind, force = false) {
  if (!force && !soundOn()) return;
  unlockAudio(); if (!audioCtx) return;
  const t0 = audioCtx.currentTime + 0.03;
  for (const [f, at, dur] of TONES[kind] || TONES.comment) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = kind === 'deadline' ? 'triangle' : 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
    o.connect(g).connect(audioCtx.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.05);
  }
}
function alertPlain(n) {
  const who = n.actor_name || 'Someone', task = n.task_title || 'a task';
  return { mention: [`${who} mentioned you`, `${task}${n.snippet ? ` — “${n.snippet}”` : ''}`],
    comment: [`${who} commented`, `${task}${n.snippet ? ` — “${n.snippet}”` : ''}`],
    deadline: ['Due in 15 minutes', `${task}${n.client_name ? ` · ${n.client_name}` : ''}`],
    assigned: [n.actor_name ? `${who} assigned you a task` : 'New recurring task', task],
    follow: [`${who} added you as a follower`, task],
    chat_dm: [`${who} · Google Chat`, n.snippet || 'New message'],
    chat_mention: [`${who} mentioned you${n.chat_title ? ` in ${n.chat_title}` : ''}`, n.snippet || ''] }[n.kind] || ['Her Haus Hub', task];
}
function desktopAlert(n) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const [title, body] = alertPlain(n);
  try {
    const note = new Notification(title, { body, icon: '/static/icon.png', tag: `hh-${n.id}` });
    note.onclick = () => { window.focus(); openNotification(n); note.close(); };
  } catch (_) { /* some browsers only allow this from a service worker */ }
}

let notifState = { unread: 0, mentions: 0, filter: 'all' };
let lastNotifId = null;
async function pollNotifications() {
  if (!S.me) return;
  try {
    const r = await api('GET', `/api/notifications/count${lastNotifId !== null ? `?since=${lastNotifId}` : ''}`);
    notifState.unread = r.unread; notifState.mentions = r.unread_mentions;
    const b = $('#bell-count'); if (b) { b.textContent = r.unread > 99 ? '99+' : r.unread; b.hidden = !r.unread; }
    const n = $('#nav-notif-count'); if (n) { n.textContent = r.unread; n.hidden = !r.unread; }
    const cc = $('#nav-chat-count'); if (cc) { cc.textContent = r.chat_unread > 99 ? '99+' : r.chat_unread; cc.hidden = !r.chat_unread; }
    $('#bell')?.classList.toggle('has-mention', !!r.unread_mentions);
    if (lastNotifId !== null && (r.new || []).length) {   // something new since the last check
      const kinds = r.new.map((x) => ({ chat_mention: 'mention', chat_dm: 'comment' }[x.kind] || x.kind));
      const loudest = SOUND_PRIORITY.find((k) => kinds.includes(k));
      if (loudest) playTone(loudest);
      r.new.forEach(desktopAlert);
      if (!document.hidden) { const [t, body] = alertPlain(r.new[r.new.length - 1]); toast(`${t}: ${body}`.slice(0, 140)); }
    }
    const changed = r.unread !== floaterInbox.unread || (r.new || []).length;
    lastNotifId = Math.max(lastNotifId || 0, r.latest_id || 0);
    if (floater && changed) refreshFloaterInbox();
  } catch (_) { /* offline */ }
}
// A tiny background worker keeps time even when the tab is in the background (browsers slow down page timers there).
let tickCount = 0;
const bgTicker = (() => {
  try { return new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(1), 15000)'], { type: 'text/javascript' }))); }
  catch (_) { return null; }
})();
const onTick = () => { tickCount++; pollNotifications(); if (floater && tickCount % 4 === 0) refreshFloaterData(); };
if (bgTicker) bgTicker.onmessage = onTick; else setInterval(onTick, 15000);

function notifText(n) {
  const who = `<b>${esc(n.actor_name || 'Automation')}</b>`, task = `<b>${esc(n.task_title || 'a deleted task')}</b>`;
  if (n.kind === 'mention') return `${who} mentioned you in ${task}`;
  if (n.kind === 'comment') return `${who} commented on ${task}`;
  if (n.kind === 'assigned') return n.actor_id ? `${who} assigned you ${task}` : `New recurring task for you: ${task}`;
  if (n.kind === 'deadline') return `${task} is due in 15 minutes`;
  if (n.kind === 'follow') return `${who} added you as a follower on ${task}`;
  if (n.kind === 'chat_dm') return `${who} sent you a message in Google Chat`;
  if (n.kind === 'chat_mention') return `${who} mentioned you in ${n.chat_title ? `<b>${esc(n.chat_title)}</b>` : 'Google Chat'}`;
  return task;
}
function notifItemHTML(n) {
  const icon = { mention: I.at, comment: I.chat, deadline: I.clock, follow: I.eye, chat_mention: I.at, chat_dm: I.chat }[n.kind] || I.brief;
  return `<button class="notif ${n.read_at ? '' : 'unread'}" data-n="${n.id}">
    <span class="notif-av">${n.actor_name ? av(n.actor_name, n.actor_avatar) : `<span class="avatar">${n.kind === 'deadline' ? I.clock : I.repeat}</span>`}<span class="notif-kind k-${n.kind}">${icon}</span></span>
    <span class="notif-main"><span class="notif-text">${notifText(n)}</span>
      ${n.snippet && n.kind !== 'assigned' ? `<span class="notif-snip">“${esc(n.snippet)}”</span>` : ''}
      <span class="notif-meta">${n.client_name ? `<span class="client-dot" style="background:${esc(n.client_color)}"></span>${esc(n.client_name)} · ` : ''}${timeAgo(n.created_at)}</span></span>
  </button>`;
}
async function openNotification(n) {
  if (!n.read_at) { api('POST', '/api/notifications/read', { ids: [n.id] }).then(pollNotifications); n.read_at = 'now'; }
  closeNotifPanel();
  if (n.chat_space_id) { location.hash = `#/chat/${n.chat_space_id}`; return; }
  if (!n.task_title || !n.client_id) { toast('That task was deleted', 'err'); return; }
  S.openTaskOnLoad = n.task_id;
  if (location.hash === `#/board/${n.client_id}`) route(); else location.hash = `#/board/${n.client_id}`;
}

async function renderNotifPanel() {
  const p = $('#notif-panel');
  pollNotifications();
  const kind = notifState.filter === 'mentions' ? '&kind=mention' : '';
  const r = await api('GET', `/api/notifications?limit=20${kind}`);
  const canDesk = 'Notification' in window && Notification.permission === 'default';
  p.innerHTML = `<div class="notif-head"><h2>Notifications</h2><div class="row" style="gap:6px;flex-wrap:nowrap">
      <button class="icon-btn snd-btn ${soundOn() ? 'on' : ''}" id="n-sound" title="${soundOn() ? 'Sounds on — click to mute' : 'Sounds off — click to turn on'}">${soundOn() ? I.volume : I.mute}</button>
      <button class="linkbtn dark" id="n-all-read">Mark all read</button></div></div>
    ${canDesk ? `<button class="desk-cta" id="n-desktop">${I.bell}<span>Get alerts even when you’re in another tab · <b>Turn on</b></span></button>` : ''}
    <div class="seg sm" id="n-seg"><button data-f="all" class="${notifState.filter === 'all' ? 'on' : ''}">All${r.unread ? ` · ${r.unread}` : ''}</button><button data-f="mentions" class="${notifState.filter === 'mentions' ? 'on' : ''}">Mentions${r.unread_mentions ? ` · ${r.unread_mentions}` : ''}</button></div>
    <div class="notif-list">${r.items.length ? r.items.map(notifItemHTML).join('') : `<div class="empty"><b>${notifState.filter === 'mentions' ? 'No mentions yet' : "You're all caught up"}</b>${notifState.filter === 'mentions' ? 'When someone tags you with @, it shows up here.' : 'New comments, mentions, and assignments show up here.'}</div>`}</div>
    <a class="notif-foot" href="#/notifications">View all notifications</a>`;
  $$('#n-seg button', p).forEach((b) => b.onclick = (e) => { e.stopPropagation(); notifState.filter = b.dataset.f; renderNotifPanel(); });
  $('#n-all-read', p).onclick = async (e) => { e.stopPropagation(); await api('POST', '/api/notifications/read', { all: true }); pollNotifications(); renderNotifPanel(); };
  $('#n-sound', p).onclick = (e) => { e.stopPropagation(); setSound(!soundOn()); if (soundOn()) playTone('comment', true); renderNotifPanel(); };
  if ($('#n-desktop', p)) $('#n-desktop', p).onclick = async (e) => {
    e.stopPropagation(); const res = await Notification.requestPermission();
    toast(res === 'granted' ? 'Desktop alerts are on' : 'Desktop alerts stay off (you can allow them later in your browser settings)', res === 'granted' ? 'ok' : '');
    renderNotifPanel();
  };
  $$('[data-n]', p).forEach((b) => b.onclick = () => openNotification(r.items.find((x) => x.id === Number(b.dataset.n))));
  $('.notif-foot', p).onclick = closeNotifPanel;
}
function closeNotifPanel() { $('#notif-panel')?.classList.add('hidden'); }
document.addEventListener('click', (e) => { if (!e.target.closest('.bell-wrap')) closeNotifPanel(); });

async function pageNotifications(page, _a, alive) {
  setTitle('Notifications', 'Mentions, comments, and tasks assigned to you');
  let filter = sessionStorage.getItem('hh_notif_filter') || 'all';
  const draw = async () => {
    sessionStorage.setItem('hh_notif_filter', filter);
    const qs = filter === 'mentions' ? '&kind=mention' : filter === 'unread' ? '&unread=1' : '';
    const r = await api('GET', `/api/notifications?limit=200${qs}`);
    if (!alive()) return;
    page.innerHTML = `<div class="board-bar"><div class="seg">${[['all', 'All'], ['mentions', `Mentions${r.unread_mentions ? ` · ${r.unread_mentions}` : ''}`], ['unread', `Unread${r.unread ? ` · ${r.unread}` : ''}`]].map(([v, l]) => `<button data-f="${v}" class="${v === filter ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span style="flex:1"></span>
      <button class="btn ghost" id="np-sound">${soundOn() ? I.volume : I.mute} Sounds ${soundOn() ? 'on' : 'off'}</button>
      <div class="sound-tests"><span class="small muted">Preview:</span><button class="btn sm soft" data-tone="comment">Comment</button><button class="btn sm soft" data-tone="mention">Mention</button><button class="btn sm soft" data-tone="deadline">Deadline</button></div>
      ${'Notification' in window ? `<button class="btn ghost" id="np-desk" ${Notification.permission === 'granted' ? 'disabled' : ''}>${I.bell} ${Notification.permission === 'granted' ? 'Desktop alerts on' : Notification.permission === 'denied' ? 'Desktop alerts blocked' : 'Turn on desktop alerts'}</button>` : ''}
      <button class="btn ghost" id="np-read">Mark all as read</button></div>
      <div class="card notif-page">${r.items.length ? r.items.map(notifItemHTML).join('') : `<div class="empty"><b>Nothing here</b>${filter === 'mentions' ? 'When a teammate tags you with @ in a comment, it shows up here.' : 'You are all caught up.'}</div>`}</div>`;
    $$('.seg button', page).forEach((b) => b.onclick = () => { filter = b.dataset.f; draw(); });
    $('#np-read', page).onclick = async () => { await api('POST', '/api/notifications/read', { all: true }); pollNotifications(); draw(); };
    $('#np-sound', page).onclick = () => { setSound(!soundOn()); if (soundOn()) playTone('comment', true); draw(); };
    $$('[data-tone]', page).forEach((b) => b.onclick = () => playTone(b.dataset.tone, true));
    if ($('#np-desk', page)) $('#np-desk', page).onclick = async () => {
      if (Notification.permission === 'denied') { toast('Your browser is blocking alerts for this site — allow them in the site settings (padlock in the address bar).', 'err'); return; }
      await Notification.requestPermission(); draw();
    };
    $$('[data-n]', page).forEach((b) => b.onclick = () => openNotification(r.items.find((x) => x.id === Number(b.dataset.n))));
  };
  await draw();
}

// ============================================================ automations (recurring tasks)
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const ordinal = (n) => n + (['st', 'nd', 'rd'][((n + 90) % 100 - 10) % 10 - 1] || 'th');
const fmtClock = (hm) => { const [h, m] = hm.split(':').map(Number); return `${(h % 12) || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
function ruleSummary(r) {
  const when = r.frequency === 'daily' ? 'Every day'
    : r.frequency === 'weekdays' ? 'Every weekday (Mon–Fri)'
    : r.frequency === 'weekly' ? `Every ${(r.weekdays || '').split(',').filter(Boolean).map((d) => DAY_NAMES[d]).join(', ')}`
    : `Monthly on the ${ordinal(r.day_of_month)}${r.day_of_month > 28 ? ' (or last day)' : ''}`;
  return `${when} at ${fmtClock(r.run_time)}`;
}

async function automationsModal(client, onChange) {
  const { el, close } = openModal({
    title: `Automations · ${client.name}`, wide: true,
    body: `<p class="muted" style="margin-bottom:16px;line-height:1.6">Recurring tasks are added to this board automatically on schedule (${esc(TZ())} time). Pause, edit, or run one now any time.</p><div id="auto-list"><div class="empty">Loading…</div></div>`,
    foot: `<button class="btn ghost" data-close>Close</button><button class="btn red" id="auto-new">${I.plus} New recurring task</button>`,
  });
  $$('[data-close]', el).forEach((b) => b.addEventListener('click', () => onChange && onChange()));
  const draw = async () => {
    const rules = await api('GET', `/api/clients/${client.id}/automations`);
    $('#auto-list', el).innerHTML = rules.length ? rules.map((r) => `
      <div class="auto-row ${r.active ? '' : 'paused'}">
        <span class="auto-ic">${I.repeat}</span>
        <div style="flex:1;min-width:0">
          <div class="row" style="gap:8px"><b>${esc(r.title)}</b>${prioBadge(r.priority)}${r.active ? '' : '<span class="badge b-gray">Paused</span>'}</div>
          <div class="small muted" style="margin-top:4px">${esc(ruleSummary(r))}${r.due_in_days !== null ? ` · due ${r.due_in_days === 0 ? 'same day' : `in ${r.due_in_days} day${r.due_in_days === 1 ? '' : 's'}`}${r.due_time ? ` by ${fmtClock12(r.due_time)}` : ''}` : ''}${r.skip_if_open ? ' · skips if last one is still open' : ''}</div>
          <div class="row small" style="gap:12px;margin-top:6px">
            <span class="row" style="gap:6px">${r.assignee_name ? `${av(r.assignee_name, r.assignee_avatar, 'sm')}${esc(r.assignee_name)}` : '<span class="muted">Unassigned</span>'}</span>
            <span class="muted">Next: <b style="color:var(--navy)">${r.active && r.next_run_at ? `${fmtDateTs(r.next_run_at)}, ${fmtTime(r.next_run_at)}` : '—'}</b></span>
            <span class="muted">${r.tasks_created} created</span>
          </div>
        </div>
        <div class="row" style="gap:4px;flex-wrap:nowrap">
          <button class="icon-btn" data-run="${r.id}" title="Create one now">${I.play}</button>
          <button class="icon-btn" data-toggle="${r.id}" title="${r.active ? 'Pause' : 'Resume'}">${r.active ? I.pause : I.repeat}</button>
          <button class="icon-btn" data-edit="${r.id}" title="Edit">${I.edit}</button>
          <button class="icon-btn" data-del="${r.id}" title="Delete">${I.trash}</button>
        </div>
      </div>`).join('') : `<div class="empty"><b>No automations yet</b>Set up tasks that repeat — like a weekly CRM cleanup, daily lead pulls, or a monthly report.</div>`;
    el._rules = rules;
  };
  $('#auto-new', el).onclick = () => ruleForm(client, null, draw);
  $('#auto-list', el).addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = (el._rules || []).find((x) => String(x.id) === (b.dataset.run || b.dataset.toggle || b.dataset.edit || b.dataset.del));
    if (!r) return;
    try {
      if (b.dataset.run) { await api('POST', `/api/automations/${r.id}/run`); toast(`Added "${r.title}" to the board`, 'ok'); onChange && onChange(); }
      if (b.dataset.toggle) { await api('PUT', `/api/automations/${r.id}`, { active: !r.active }); toast(r.active ? 'Automation paused' : 'Automation resumed', 'ok'); }
      if (b.dataset.edit) { ruleForm(client, r, draw); return; }
      if (b.dataset.del) { if (!await confirmModal(`Delete the "${r.title}" automation? Tasks it already created stay on the board.`)) return; await api('DELETE', `/api/automations/${r.id}`); toast('Automation deleted'); }
      draw();
    } catch (err) { toast(err.message, 'err'); }
  });
  draw();
  return close;
}

function ruleForm(client, r, onSaved) {
  r = r || { frequency: 'weekly', weekdays: '0', day_of_month: 1, run_time: '08:00', priority: 'Medium', start_status: 'Not Started', due_in_days: null, skip_if_open: 0, active: 1 };
  const wd = (r.weekdays || '').split(',').filter(Boolean);
  const { el, close } = openModal({
    title: r.id ? 'Edit recurring task' : 'New recurring task', wide: true,
    body: `<form class="form-grid" id="rule-form" novalidate>
      <label class="field full">Task title<input class="input" name="title" value="${esc(r.title || '')}" placeholder="e.g. Weekly CRM cleanup"></label>
      <label class="field full">Description<textarea class="input" name="description" rows="3">${esc(r.description || '')}</textarea></label>
      <div class="full sched">
        <div class="section-title" style="margin-top:0"><span>Schedule</span></div>
        <div class="form-grid">
          <label class="field">Repeats<select class="input" name="frequency">
            ${[['daily', 'Every day'], ['weekdays', 'Every weekday (Mon–Fri)'], ['weekly', 'Weekly on specific days'], ['monthly', 'Monthly']].map(([v, l]) => `<option value="${v}" ${v === r.frequency ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">Time it's added<input class="input" type="time" name="run_time" value="${esc(r.run_time)}"></label>
          <div class="field full" data-show="weekly"><span>On these days</span><div class="day-pick">${DAY_NAMES.map((n, i) => `<label><input type="checkbox" name="wd" value="${i}" ${wd.includes(String(i)) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
          <label class="field" data-show="monthly">Day of the month<input class="input" type="number" min="1" max="31" name="day_of_month" value="${esc(r.day_of_month)}"><span class="hint">29–31 run on the last day in shorter months</span></label>
        </div>
        <p class="small muted" id="rule-preview" style="margin-top:12px"></p>
      </div>
      <label class="field">Assignee<select class="input" name="assignee_id">${assigneeOptions().map(([v, l]) => `<option value="${v}" ${String(v) === String(r.assignee_id || '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="field">Priority level<select class="input" name="priority">${S.priorities.map((p) => `<option ${p === r.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="field">Starts in column<select class="input" name="start_status">${S.statuses.filter((x) => x !== 'Done').map((x) => `<option ${x === r.start_status ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field">Deadline<select class="input" name="due_in_days">
        ${[['', 'No deadline'], ['0', 'Same day'], ['1', '1 day later'], ['2', '2 days later'], ['3', '3 days later'], ['5', '5 days later'], ['7', '1 week later'], ['14', '2 weeks later'], ['30', '30 days later']]
          .map(([v, l]) => `<option value="${v}" ${String(r.due_in_days ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" data-due-time><span class="field-label">Due by<span class="hint">· optional</span></span><input class="input" type="time" name="due_time" value="${esc(r.due_time || '')}"></label>
      <label class="check full"><input type="checkbox" name="skip_if_open" ${r.skip_if_open ? 'checked' : ''}> Skip a run if the previous task from this automation isn't done yet</label>
      <label class="check full"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Automation is active</label>
    </form>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="rule-save">${r.id ? 'Save changes' : 'Create automation'}</button>`,
  });
  const f = $('#rule-form', el); const E = f.elements;
  const sync = () => {
    $$('[data-show]', f).forEach((x) => { x.style.display = x.dataset.show === E.frequency.value ? '' : 'none'; });
    $('[data-due-time]', f).style.display = E.due_in_days.value === '' ? 'none' : '';
    const days = $$('input[name=wd]:checked', f).map((x) => x.value).join(',');
    const ok = E.frequency.value !== 'weekly' || days;
    $('#rule-preview', el).innerHTML = ok ? `${I.repeat.replace('width="18" height="18"', 'width="13" height="13" style="vertical-align:-2px"')} ${esc(ruleSummary({ frequency: E.frequency.value, weekdays: days, day_of_month: Number(E.day_of_month.value) || 1, run_time: E.run_time.value || '08:00' }))}` : '<span style="color:var(--red)">Pick at least one day.</span>';
  };
  f.addEventListener('input', sync); f.addEventListener('change', sync); sync();
  setTimeout(() => E.title.focus(), 40);
  $('#rule-save', el).onclick = async () => {
    const d = {
      title: E.title.value, description: E.description.value, frequency: E.frequency.value, run_time: E.run_time.value || '08:00',
      weekdays: $$('input[name=wd]:checked', f).map((x) => x.value), day_of_month: E.day_of_month.value, assignee_id: E.assignee_id.value,
      priority: E.priority.value, start_status: E.start_status.value, due_in_days: E.due_in_days.value, due_time: E.due_in_days.value === '' ? '' : E.due_time.value, skip_if_open: E.skip_if_open.checked, active: E.active.checked,
    };
    try {
      if (r.id) await api('PUT', `/api/automations/${r.id}`, d);
      else await api('POST', '/api/automations', { ...d, client_id: client.id });
      close(); toast(r.id ? 'Automation updated' : 'Automation created', 'ok'); onSaved();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ============================================================ EOD
async function pageEod(page, _a, alive) {
  setTitle('EOD Report', 'Saved to your profile and posted to the Google Chat EOD channel');
  const [eods] = await Promise.all([api('GET', '/api/eods'), refreshStatus()]);
  if (!alive()) return;
  page.innerHTML = `
    <div class="grid g2">
      <div class="card">
        <div class="card-head"><h2>Today's report</h2><span class="badge b-navy">${hrs(S.status.today_seconds)} logged today</span></div>
        <form class="stack" id="eod-form">
          <div class="form-grid">
            <label class="field">Date<input class="input" type="date" name="eod_date" value="${todayStr()}"></label>
            <label class="field"><span class="field-label">Client<span class="hint">· optional</span></span><select class="input" name="client_id"><option value="">All / multiple clients</option>${S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
          </div>
          <label class="field">What did you accomplish today? *<textarea class="input" name="accomplishments" rows="6" placeholder="• Called 45 leads, 6 conversations&#10;• Sent 3 offers&#10;• Updated CRM for Oak St property"></textarea></label>
          <label class="field">Blockers / issues<textarea class="input" name="blockers" rows="3" placeholder="Anything slowing you down?"></textarea></label>
          <label class="field">Plan for tomorrow<textarea class="input" name="tomorrow" rows="3"></textarea></label>
          <label class="field">Other notes<textarea class="input" name="notes" rows="2"></textarea></label>
          <div><button class="btn red lg" type="submit">${I.send} Submit &amp; send to Google Chat</button></div>
        </form>
      </div>
      <div class="card" style="align-self:start"><div class="card-head"><h2>My past reports</h2><span class="muted small">${eods.length}</span></div>
        <div id="eod-list">${eods.length ? eods.map(eodItemHTML).join('') : '<div class="empty"><b>No reports yet</b>Your submitted EODs will appear here.</div>'}</div></div>
    </div>`;
  $('#eod-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target; const b = $('button[type=submit]', f); b.disabled = true;
    try {
      const r = await api('POST', '/api/eods', Object.fromEntries(new FormData(f)));
      toast(r.chat_ok ? 'EOD submitted and posted to Google Chat ✓' : `EOD saved. ${r.chat_message}`, r.chat_ok ? 'ok' : 'err');
      route();
    } catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; }
  };
}

function eodItemHTML(e, showName = false) {
  const sec = (label, txt) => txt ? `<div style="margin-top:8px"><div class="small muted" style="font-weight:700">${label}</div><div class="eod-body">${esc(txt)}</div></div>` : '';
  return `<div class="list-item"><div style="flex:1;min-width:0">
    <div class="row between"><div class="row" style="gap:8px">${showName ? `${av(e.user_name, e.user_avatar, 'sm')}<b>${esc(e.user_name)}</b>` : ''}<b>${fmtDate(e.eod_date)}</b>${e.client_name ? `<span class="badge b-navy">${esc(e.client_name)}</span>` : ''}</div>
      <div class="row" style="gap:6px"><span class="small muted">${hrs(e.worked_seconds)}</span><span class="badge ${e.chat_status === 'sent' ? 'b-green' : 'b-gray'}">${e.chat_status === 'sent' ? 'Posted to Chat' : 'Not posted'}</span></div></div>
    ${sec('Accomplished', e.accomplishments)}${sec('Blockers', e.blockers)}${sec('Tomorrow', e.tomorrow)}${sec('Notes', e.notes)}
  </div></div>`;
}

async function pageEodsAll(page, _a, alive) {
  setTitle('EOD Reports', 'Every report your team has submitted');
  const uid = new URLSearchParams(location.hash.split('?')[1] || '').get('user') || '';
  const eods = await api('GET', `/api/eods${uid ? `?user_id=${uid}` : ''}`);
  if (!alive()) return;
  page.innerHTML = `<div class="card"><div class="card-head"><h2>Reports</h2>
      <select class="input" id="eod-user" style="width:auto"><option value="">All team members</option>${S.users.map((u) => `<option value="${u.id}" ${String(u.id) === uid ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
    ${eods.length ? eods.map((e) => eodItemHTML(e, true)).join('') : '<div class="empty"><b>No EOD reports yet</b></div>'}</div>`;
  $('#eod-user').onchange = (e) => { location.hash = `#/eods${e.target.value ? `?user=${e.target.value}` : ''}`; };
}

// ============================================================ profile
async function pageProfile(page, [idArg], alive) {
  const uid = !idArg || idArg === 'me' ? S.me.id : Number(idArg);
  const self = uid === S.me.id;
  const [p] = await Promise.all([api('GET', `/api/profile/${uid}`), self ? refreshStatus() : null]);
  if (!alive()) return;
  const u = p.user;
  setTitle(self ? 'My Profile' : u.name, self ? 'Your goals, wins, and payroll details' : u.position || u.email);
  let tab = sessionStorage.getItem('hh_profile_tab') || 'overview';
  const c = self && S.status ? S.status.cutoff : p.cutoff;
  const running = self && S.status && S.status.running;
  const ex = isExec();

  page.innerHTML = `
    <div class="card" style="margin-bottom:18px"><div class="row between">
      <div class="row" style="gap:16px">
        ${self || ex ? `<label class="avatar-edit" title="Change profile photo">${av(u.name, u.avatar_file_id, 'lg')}<span class="cam">${I.camera}</span><input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>` : av(u.name, u.avatar_file_id, 'lg')}
        <div><h1>${esc(u.name)}</h1><p class="muted" style="margin-top:3px">${esc(u.position || '—')} · ${esc(u.email)}</p>
          <div class="row" style="margin-top:8px;gap:6px">${u.avatar_file_id && (self || ex) ? '<button class="linkbtn dark" id="avatar-remove">Remove photo</button>' : ''}${shiftBadge(p.status)}<span class="badge b-navy">${u.role === 'executive' ? 'Executive' : 'Employee'}</span>${u.active ? '' : '<span class="badge b-red">Deactivated</span>'}</div></div></div>
      ${ex ? `<div class="row"><a class="btn ghost" href="#/eods?user=${u.id}">${I.doc} EODs</a><button class="btn" id="edit-emp">${I.edit} Edit employee</button></div>` : ''}
    </div></div>
    <div class="grid g4" style="margin-bottom:18px">
      <div class="card stat"><div class="label">Salary / cutoff</div><div class="value">${money(c.salary)}</div><div class="foot">${c.workdays} workdays · ${num(c.expected_hours)}h expected</div></div>
      <div class="card stat"><div class="label">Hourly rate</div><div class="value">${money(c.hourly_rate)}</div><div class="foot">Based on ${num(u.shift_hours)}h shifts</div></div>
      <div class="card stat"><div class="label">Hours this cutoff</div><div class="value" ${liveAttrs('hrs', c.worked_seconds, running ? 1 : 0)}>${hrs(c.worked_seconds)}</div><div class="foot">${fmtDateShort(c.start)} – ${fmtDateShort(c.end)}</div></div>
      <div class="card stat accent"><div class="label">Earned so far</div><div class="value" ${liveAttrs('money', c.earnings, running ? c.hourly_rate / 3600 : 0)}>${money(c.earnings)}</div><div class="foot">${running ? '<i class="live-dot"></i>Updating live' : 'Current cutoff'}</div></div>
    </div>
    <div class="card">
      <div class="tabs" id="ptabs">
        ${[['overview', 'KPIs & Wins'], ['metrics', 'Weekly Metrics'], ['incidents', `Incident Reports${p.incidents.length ? ` (${p.incidents.length})` : ''}`], ['payroll', 'Payroll & Bank QR'], ['time', 'Timesheet']]
          .map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}
      </div>
      <div id="ptab-body"></div>
    </div>`;

  const reload = () => route();
  const crud = (table) => ({
    add: (fields, title) => formModal({ title, fields, onSubmit: async (d, close) => { await api('POST', `/api/profile/${uid}/${table}`, d); close(); toast('Saved', 'ok'); reload(); } }),
    edit: (rid, fields, title) => formModal({ title, fields, onSubmit: async (d, close) => { await api('PUT', `/api/profile/${uid}/${table}/${rid}`, d); close(); toast('Saved', 'ok'); reload(); } }),
    del: async (rid) => { if (await confirmModal('Delete this entry?')) { await api('DELETE', `/api/profile/${uid}/${table}/${rid}`); reload(); } },
  });
  const kpiFields = (k = {}) => [
    { name: 'title', label: 'KPI', full: true, required: true, value: k.title, placeholder: 'e.g. Qualified seller leads' },
    { name: 'target', label: 'Target', type: 'number', value: k.target, step: 'any' },
    { name: 'current', label: 'Current', type: 'number', value: k.current ?? 0, step: 'any' },
    { name: 'unit', label: 'Unit', value: k.unit, placeholder: 'leads, calls, %' },
    { name: 'period', label: 'Period', type: 'select', options: ['Daily', 'Weekly', 'Monthly', 'Quarterly'], value: k.period || 'Weekly' },
    { name: 'due_date', label: 'Due date', type: 'date', value: k.due_date },
  ];
  const winFields = (w = {}) => [
    { name: 'title', label: 'Win', full: true, required: true, value: w.title, placeholder: 'e.g. Closed first assignment deal' },
    { name: 'win_date', label: 'Date', type: 'date', value: w.win_date || todayStr() },
    { name: 'description', label: 'Details', type: 'textarea', full: true, value: w.description },
  ];
  const metricFields = (m = {}) => [
    { name: 'week_start', label: 'Week of', type: 'date', value: m.week_start || weekStart() },
    { name: 'metric', label: 'Metric', required: true, value: m.metric, placeholder: 'e.g. Cold calls made' },
    { name: 'achieved', label: 'Achieved', type: 'number', step: 'any', value: m.achieved },
    { name: 'target', label: 'Target', type: 'number', step: 'any', value: m.target },
    { name: 'unit', label: 'Unit', value: m.unit },
    { name: 'notes', label: 'How does this support the company direction?', type: 'textarea', full: true, value: m.notes },
    ...(ex ? [
      { name: 'alignment', label: 'Alignment (executive review)', type: 'select', options: ['Pending Review', 'Aligned', 'Partially Aligned', 'Not Aligned'], value: m.alignment || 'Pending Review' },
      { name: 'exec_comment', label: 'Executive comment', type: 'textarea', full: true, rows: 2, value: m.exec_comment },
    ] : []),
  ];
  const incFields = (i = {}) => [
    { name: 'title', label: 'Incident', full: true, required: true, value: i.title },
    { name: 'incident_date', label: 'Date', type: 'date', value: i.incident_date || todayStr() },
    { name: 'severity', label: 'Severity', type: 'select', options: ['Minor', 'Moderate', 'Major', 'Critical'], value: i.severity || 'Minor' },
    { name: 'description', label: 'What happened', type: 'textarea', full: true, value: i.description },
    { name: 'action_taken', label: 'Action taken / next steps', type: 'textarea', full: true, rows: 3, value: i.action_taken },
  ];

  const tabs = {
    overview: () => `
      <div class="grid g2">
        <div><div class="card-head"><h2>${I.target} KPI goals</h2>${ex ? '<button class="btn sm" data-a="kpi-add">+ Add KPI</button>' : ''}</div>
          ${p.kpis.length ? p.kpis.map((k) => {
            const pct = k.target ? Math.min(100, (k.current / k.target) * 100) : 0;
            return `<div class="list-item"><div style="flex:1">
              <div class="row between"><b>${esc(k.title)}</b><span class="badge b-navy">${esc(k.period)}</span></div>
              <div class="row between small" style="margin:8px 0 6px"><span><b>${num(k.current)}</b> / ${num(k.target)} ${esc(k.unit)}</span><span class="muted">${Math.round(pct)}%${k.due_date ? ` · due ${fmtDateShort(k.due_date)}` : ''}</span></div>
              <div class="progress ${pct >= 100 ? 'done' : ''}"><div style="width:${pct}%"></div></div></div>
              <div class="row" style="gap:2px;align-self:center"><button class="icon-btn" data-a="kpi-edit" data-id="${k.id}" title="Update">${I.edit}</button>${ex ? `<button class="icon-btn" data-a="kpi-del" data-id="${k.id}" title="Delete">${I.trash}</button>` : ''}</div></div>`;
          }).join('') : `<div class="empty"><b>No KPIs yet</b>${ex ? 'Set goals so progress can be tracked here.' : 'Your manager will set your KPI goals here.'}</div>`}
        </div>
        <div><div class="card-head"><h2>${I.trophy} Wins</h2><button class="btn sm red" data-a="win-add">+ Log a win</button></div>
          ${p.wins.length ? p.wins.map((w) => `<div class="list-item"><span class="icon-chip">${I.trophy}</span><div style="flex:1"><div class="row between"><b>${esc(w.title)}</b><span class="small muted">${fmtDate(w.win_date)}</span></div>
            ${w.description ? `<p class="muted" style="margin-top:4px;white-space:pre-wrap">${esc(w.description)}</p>` : ''}</div>
            <div class="row" style="gap:2px"><button class="icon-btn" data-a="win-edit" data-id="${w.id}">${I.edit}</button><button class="icon-btn" data-a="win-del" data-id="${w.id}">${I.trash}</button></div></div>`).join('')
            : '<div class="empty"><b>No wins logged yet</b>Celebrate the good stuff — big or small.</div>'}
        </div>
      </div>`,
    metrics: () => `
      ${p.company_direction ? `<div class="callout" style="margin-bottom:16px"><b>Company's current direction</b><br>${esc(p.company_direction)}</div>` : ex ? '<p class="muted small" style="margin-bottom:12px">Tip: set the company\'s current direction in Settings so it shows here for everyone.</p>' : ''}
      <div class="card-head"><h2>What was achieved each week</h2><button class="btn sm" data-a="met-add">+ Add metric</button></div>
      ${p.metrics.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Week of</th><th>Metric</th><th>Result</th><th>Alignment</th><th>Notes</th><th></th></tr></thead><tbody>
        ${p.metrics.map((m) => {
          const pct = m.target ? Math.round((m.achieved / m.target) * 100) : null;
          const ab = { Aligned: 'b-green', 'Partially Aligned': 'b-amber', 'Not Aligned': 'b-red' }[m.alignment] || 'b-gray';
          return `<tr><td style="white-space:nowrap">${fmtDate(m.week_start)}</td><td><b>${esc(m.metric)}</b></td>
            <td style="white-space:nowrap">${num(m.achieved)}${m.target ? ` / ${num(m.target)}` : ''} ${esc(m.unit)}${pct !== null ? ` <span class="badge ${pct >= 100 ? 'b-green' : pct >= 70 ? 'b-amber' : 'b-red'}">${pct}%</span>` : ''}</td>
            <td><span class="badge ${ab}">${esc(m.alignment)}</span></td>
            <td class="small">${esc(m.notes)}${m.exec_comment ? `<div style="margin-top:4px;color:var(--navy)"><b>Exec:</b> ${esc(m.exec_comment)}</div>` : ''}</td>
            <td style="white-space:nowrap"><button class="icon-btn" data-a="met-edit" data-id="${m.id}">${I.edit}</button><button class="icon-btn" data-a="met-del" data-id="${m.id}">${I.trash}</button></td></tr>`;
        }).join('')}</tbody></table></div>` : '<div class="empty"><b>No metrics yet</b>Log measurable results each week (calls made, leads qualified, deals sent…).</div>'}`,
    incidents: () => `
      <div class="card-head"><h2>${I.alert} Incident reports</h2>${ex ? '<button class="btn sm red" data-a="inc-add">+ File incident</button>' : ''}</div>
      ${p.incidents.length ? p.incidents.map((i) => `<div class="list-item"><div style="flex:1">
        <div class="row between"><div class="row" style="gap:8px"><b>${esc(i.title)}</b><span class="badge ${{ Minor: 'b-gray', Moderate: 'b-amber', Major: 'b-red', Critical: 'b-red' }[i.severity] || 'b-gray'}">${esc(i.severity)}</span></div>
          <span class="small muted">${fmtDate(i.incident_date)}${i.reporter ? ` · filed by ${esc(i.reporter)}` : ''}</span></div>
        ${i.description ? `<p style="margin-top:6px;white-space:pre-wrap">${esc(i.description)}</p>` : ''}
        ${i.action_taken ? `<p class="small" style="margin-top:6px"><b>Action taken:</b> ${esc(i.action_taken)}</p>` : ''}
        <div class="callout small" style="margin-top:8px"><b>Employee response:</b> ${i.employee_response ? esc(i.employee_response) : '<span class="muted">No response yet</span>'}</div>
        <div class="row" style="margin-top:8px">${self || ex ? `<button class="btn sm soft" data-a="inc-respond" data-id="${i.id}">${i.employee_response ? 'Edit response' : 'Add response'}</button>` : ''}
          ${ex ? `<button class="btn sm ghost" data-a="inc-edit" data-id="${i.id}">Edit</button><button class="btn sm ghost" data-a="inc-del" data-id="${i.id}" style="color:var(--red)">Delete</button>` : ''}</div>
      </div></div>`).join('') : '<div class="empty"><b>No incidents on file</b>Keep up the great work.</div>'}`,
    payroll: () => `
      <div class="grid g2">
        <div><div class="card-head"><h2>Bank details</h2></div>
          <form class="stack" id="bank-form">
            <label class="field">Bank / e-wallet<input class="input" name="bank_name" value="${esc(u.bank_name)}" placeholder="e.g. BDO, GCash, Wise"></label>
            <label class="field">Account name<input class="input" name="bank_account_name" value="${esc(u.bank_account_name)}"></label>
            <label class="field">Account number<input class="input" name="bank_account_number" value="${esc(u.bank_account_number)}"></label>
            <div><button class="btn" type="submit">Save bank details</button></div>
          </form>
          <p class="small muted" style="margin-top:12px">Only you and executives can see your bank details and QR code.</p></div>
        <div><div class="card-head"><h2>Bank QR code</h2></div>
          ${p.qr ? `<img class="qr-img" src="/api/files/${p.qr.id}?inline=1" alt="Bank QR code"><p class="small muted" style="margin:8px 0">Uploaded ${fmtDateTs(p.qr.created_at)}</p>` : '<div class="empty" style="border:1px dashed var(--line);border-radius:10px;margin-bottom:12px"><b>No QR uploaded</b>Upload a screenshot of your bank or e-wallet QR for payroll.</div>'}
          <div class="row"><label class="btn ${p.qr ? 'ghost' : 'red'}" style="cursor:pointer">${p.qr ? 'Replace QR' : 'Upload QR'}<input type="file" id="qr-file" accept="image/*" hidden></label>
          ${p.qr ? `<a class="btn ghost" href="/api/files/${p.qr.id}">${I.download} Download</a>` : ''}</div></div>
      </div>`,
    time: () => '<div id="ts-body"><div class="empty">Loading…</div></div>',
  };

  const show = (k) => {
    tab = k; sessionStorage.setItem('hh_profile_tab', k);
    $$('#ptabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    $('#ptab-body').innerHTML = tabs[k]();
    if (k === 'payroll' && (self || ex)) {
      $('#bank-form').onsubmit = async (e) => { e.preventDefault(); try { await api('PUT', `/api/users/${uid}`, Object.fromEntries(new FormData(e.target))); toast('Bank details saved', 'ok'); } catch (err) { toast(err.message, 'err'); } };
      $('#qr-file').onchange = async (e) => {
        const fd = new FormData(); fd.append('file', e.target.files[0]);
        try { await api('POST', `/api/profile/${uid}/qr`, fd); toast('QR uploaded', 'ok'); reload(); } catch (err) { toast(err.message, 'err'); }
      };
    }
    if (k === 'time') renderTimesheetInto($('#ts-body'), uid, false);
  };
  $$('#ptabs button').forEach((b) => b.onclick = () => show(b.dataset.tab));
  show(tabs[tab] ? tab : 'overview');

  const find = (arr, id) => arr.find((x) => x.id === Number(id));
  $('#ptab-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.dataset.id;
    const A = {
      'kpi-add': () => crud('kpis').add(kpiFields(), 'Add KPI goal'),
      'kpi-edit': () => crud('kpis').edit(id, ex ? kpiFields(find(p.kpis, id)) : [{ name: 'current', label: `Current progress (${find(p.kpis, id).title})`, type: 'number', step: 'any', value: find(p.kpis, id).current, full: true }], 'Update KPI'),
      'kpi-del': () => crud('kpis').del(id),
      'win-add': () => crud('wins').add(winFields(), 'Log a win'),
      'win-edit': () => crud('wins').edit(id, winFields(find(p.wins, id)), 'Edit win'),
      'win-del': () => crud('wins').del(id),
      'met-add': () => crud('metrics').add(metricFields(), 'Add weekly metric'),
      'met-edit': () => crud('metrics').edit(id, metricFields(find(p.metrics, id)), ex ? 'Review metric' : 'Edit metric'),
      'met-del': () => crud('metrics').del(id),
      'inc-add': () => crud('incidents').add(incFields(), 'File incident report'),
      'inc-edit': () => crud('incidents').edit(id, incFields(find(p.incidents, id)), 'Edit incident'),
      'inc-del': () => crud('incidents').del(id),
      'inc-respond': () => crud('incidents').edit(id, [{ name: 'employee_response', label: 'Your response', type: 'textarea', full: true, rows: 5, value: find(p.incidents, id).employee_response }], 'Respond to incident'),
    };
    A[b.dataset.a] && A[b.dataset.a]();
  });
  if (ex && $('#edit-emp')) $('#edit-emp').onclick = () => editEmployeeModal(u, reload);
  const afterAvatar = async () => {
    await loadUsers();
    if (self) { S.me = { ...S.me, avatar_file_id: (S.users.find((x) => x.id === uid) || {}).avatar_file_id }; renderShell(); }
    route();
  };
  if ($('#avatar-file')) $('#avatar-file').onchange = async (e) => {
    if (!e.target.files[0]) return;
    if (e.target.files[0].size > 5 * 1024 * 1024) { toast('Please choose an image under 5 MB', 'err'); return; }
    const fd = new FormData(); fd.append('file', e.target.files[0]);
    try { await api('POST', `/api/users/${uid}/avatar`, fd); toast('Profile photo updated', 'ok'); afterAvatar(); } catch (err) { toast(err.message, 'err'); }
  };
  if ($('#avatar-remove')) $('#avatar-remove').onclick = async () => {
    if (!await confirmModal('Remove this profile photo?', { okLabel: 'Remove' })) return;
    await api('DELETE', `/api/users/${uid}/avatar`); toast('Photo removed'); afterAvatar();
  };
}

function greeting() { const h = Number(tzParts(new Date()).hour); return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'; }

function weekStart() {
  const d = new Date(todayStr() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function employeeFields(u = {}, isNew = false) {
  return [
    { name: 'name', label: 'Full name', required: true, value: u.name },
    { name: 'email', label: 'Work email (used to log in)', type: 'email', required: true, value: u.email },
    { name: 'position', label: 'Position', value: u.position, placeholder: 'e.g. Acquisitions VA' },
    { name: 'role', label: 'Access level', type: 'select', options: [['employee', 'Employee'], ['executive', 'Executive (full access)']], value: u.role || 'employee' },
    { name: 'salary_per_cutoff', label: `Salary per cutoff (${CUR()})`, type: 'number', step: 'any', value: u.salary_per_cutoff ?? '', hint: 'Paid on the 15th and 30th' },
    { name: 'shift_hours', label: 'Shift hours per day', type: 'number', step: 'any', value: u.shift_hours ?? 8 },
    { name: 'start_date', label: 'Start date', type: 'date', value: u.start_date },
    { name: 'phone', label: 'Phone', value: u.phone },
    ...(isNew ? [{ name: 'password', label: 'Temporary password', type: 'text', full: true, hint: 'Leave blank to auto-generate one' }]
      : [{ name: 'active', label: 'Account active (can log in)', type: 'checkbox', value: !!u.active, full: true }]),
  ];
}

function editEmployeeModal(u, onDone) {
  const m = formModal({
    title: `Edit ${u.name}`, wide: true, fields: employeeFields(u),
    extraFoot: '<button class="btn ghost" id="reset-pw">Reset password</button>',
    onSubmit: async (d, close) => { await api('PUT', `/api/users/${u.id}`, d); await loadUsers(); close(); toast('Employee updated', 'ok'); onDone(); },
  });
  $('#reset-pw', m.el).onclick = async () => {
    if (!await confirmModal(`Generate a new temporary password for ${u.name}?`, { okLabel: 'Reset', danger: false })) return;
    const r = await api('POST', `/api/users/${u.id}/reset-password`, {});
    m.close(); passwordReveal('Password reset', u.email, r.temp_password);
  };
}

// ============================================================ timesheet (shared by profile + exec page)
function cutoffOptions() {
  const out = []; const t = todayStr();
  let [y, m, d] = t.split('-').map(Number); let first = d <= 15;
  for (let i = 0; i < 8; i++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const start = `${y}-${pad(m)}-${first ? '01' : '16'}`;
    const end = `${y}-${pad(m)}-${first ? '15' : last}`;
    out.push([start, `${fmtDateShort(start)} – ${fmtDate(end)}${i === 0 ? ' (current)' : ''}`]);
    if (first) { m -= 1; if (m === 0) { m = 12; y -= 1; } first = false; } else first = true;
  }
  return out;
}

async function renderTimesheetInto(box, uid, editable, ref) {
  const opts = cutoffOptions(); ref = ref || opts[0][0];
  const [y, m, d] = ref.split('-').map(Number);
  const end = d === 1 ? `${y}-${pad(m)}-15` : `${y}-${pad(m)}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`;
  const r = await api('GET', `/api/time/entries?user_id=${uid}&start=${ref}&end=${end}`);
  box.innerHTML = `<div class="row between" style="margin-bottom:12px">
      <select class="input" data-cutoff style="width:auto">${opts.map(([v, l]) => `<option value="${v}" ${v === ref ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="row"><span class="badge b-navy">Total: ${hrs(r.total_seconds)}</span>${editable ? `<button class="btn sm" data-add-entry>+ Add entry</button>` : ''}</div></div>
    ${r.entries.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Clock in</th><th>Clock out</th><th>Breaks</th><th>Worked</th>${editable ? '<th></th>' : ''}</tr></thead><tbody>
      ${r.entries.map((e) => `<tr><td>${fmtDateTs(e.clock_in)}</td><td>${fmtTime(e.clock_in)}</td><td>${e.clock_out ? fmtTime(e.clock_out) : '<span class="badge b-green">Active</span>'}</td>
        <td>${e.breaks.length ? `${hrs(e.break_seconds)} <span class="small muted">(${e.breaks.map((b) => `${b.kind} ${fmtTime(b.start)}–${b.end ? fmtTime(b.end) : 'now'}`).join(', ')})</span>` : '—'}</td>
        <td><b>${hrs(e.worked_seconds)}</b></td>
        ${editable ? `<td style="white-space:nowrap"><button class="icon-btn" data-edit-entry="${e.id}">${I.edit}</button><button class="icon-btn" data-del-entry="${e.id}">${I.trash}</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>` : '<div class="empty"><b>No time entries</b>for this cutoff.</div>'}`;
  const again = () => renderTimesheetInto(box, uid, editable, ref);
  $('[data-cutoff]', box).onchange = (e) => renderTimesheetInto(box, uid, editable, e.target.value);
  if (!editable) return;
  const tzNote = { type: 'info', html: `<p class="small muted">Times are in the company timezone (${esc(TZ())}).</p>` };
  $('[data-add-entry]', box).onclick = () => formModal({
    title: 'Add time entry', fields: [{ name: 'clock_in', label: 'Clock in', type: 'datetime', required: true }, { name: 'clock_out', label: 'Clock out', type: 'datetime', required: true }, tzNote],
    onSubmit: async (dd, close) => { await api('POST', '/api/time/entries', { ...dd, user_id: uid }); close(); toast('Entry added', 'ok'); again(); },
  });
  box.onclick = async (e) => {
    const ed = e.target.closest('[data-edit-entry]'); const de = e.target.closest('[data-del-entry]');
    if (ed) {
      const en = r.entries.find((x) => x.id === Number(ed.dataset.editEntry));
      formModal({
        title: 'Edit time entry',
        fields: [{ name: 'clock_in', label: 'Clock in', type: 'datetime', value: toZonedInput(en.clock_in), required: true }, { name: 'clock_out', label: 'Clock out', type: 'datetime', value: toZonedInput(en.clock_out) }, tzNote],
        onSubmit: async (dd, close) => { await api('PUT', `/api/time/entries/${en.id}`, dd); close(); toast('Entry updated', 'ok'); again(); },
      });
    }
    if (de && await confirmModal('Delete this time entry?')) { await api('DELETE', `/api/time/entries/${de.dataset.delEntry}`); again(); }
  };
}

// ============================================================ resources
async function pageResources(page, _a, alive) {
  setTitle('Resources', 'Links and files for quick retrieval');
  const rows = await api('GET', '/api/resources');
  if (!alive()) return;
  const cats = [...new Set(rows.map((r) => r.category))].sort();
  page.innerHTML = `
    <div class="board-bar"><input class="input" id="r-q" placeholder="Search resources…">
      <select class="input" id="r-cat"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
      <select class="input" id="r-scope"><option value="">Shared + mine</option><option value="shared">Team shared</option><option value="mine">Only mine</option></select>
      <span style="flex:1"></span><button class="btn red" id="r-add">${I.plus} Add resource</button></div>
    <div class="res-grid" id="r-grid"></div>`;
  const draw = () => {
    const qv = $('#r-q').value.toLowerCase(), cat = $('#r-cat').value, scope = $('#r-scope').value;
    const list = rows.filter((r) => (!qv || `${r.title} ${r.description} ${r.url}`.toLowerCase().includes(qv)) && (!cat || r.category === cat)
      && (!scope || (scope === 'shared' ? r.shared : r.owner_id === S.me.id)));
    $('#r-grid').innerHTML = list.length ? list.map((r) => `<div class="card res">
      <span class="ic ${r.file_id ? 'file' : ''}">${r.file_id ? I.clip : I.link}</span>
      <div class="body"><b>${esc(r.title)}</b>
        <div class="row" style="gap:6px;margin:6px 0"><span class="badge b-navy">${esc(r.category)}</span><span class="badge ${r.shared ? 'b-green' : 'b-gray'}">${r.shared ? 'Team' : 'Personal'}</span></div>
        ${r.description ? `<p class="small muted" style="margin-bottom:8px">${esc(r.description)}</p>` : ''}
        <div class="row" style="gap:8px">${r.url ? `<a class="btn sm soft" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}${r.file_id ? `<a class="btn sm soft" href="/api/files/${r.file_id}">${I.download} ${esc((r.file_name || 'File').slice(0, 22))}</a>` : ''}</div>
        <p class="small muted" style="margin-top:8px">Added by ${esc(r.owner_name || '—')}</p></div>
      ${r.owner_id === S.me.id || isExec() ? `<button class="icon-btn" data-del="${r.id}" aria-label="Delete">${I.trash}</button>` : ''}</div>`).join('')
      : '<div class="card empty" style="grid-column:1/-1"><b>No resources yet</b>Save SOPs, scripts, templates, and handy links here.</div>';
  };
  ['r-q', 'r-cat', 'r-scope'].forEach((i) => { $(`#${i}`).addEventListener('input', draw); });
  $('#r-grid').onclick = async (e) => { const b = e.target.closest('[data-del]'); if (b && await confirmModal('Delete this resource?')) { await api('DELETE', `/api/resources/${b.dataset.del}`); route(); } };
  $('#r-add').onclick = () => formModal({
    title: 'Add resource', submit: 'Save resource',
    fields: [
      { name: 'title', label: 'Title', required: true, full: true },
      { name: 'category', label: 'Category', value: 'General', placeholder: 'SOPs, Scripts, Templates…' },
      { name: 'url', label: 'Link', placeholder: 'https://…' },
      { name: 'file', label: 'Or attach a file', type: 'file', full: true },
      { name: 'description', label: 'Description', type: 'textarea', full: true, rows: 2 },
      { name: 'shared', label: 'Share with the whole team', type: 'checkbox', value: isExec(), full: true },
    ],
    onSubmit: async (fd, close) => { await api('POST', '/api/resources', fd); close(); toast('Resource saved', 'ok'); route(); },
  });
  draw();
}

// ============================================================ task metrics
async function pageMetrics(page, _a, alive) {
  const ex = execView();
  setTitle(ex ? 'Task Metrics' : 'My Task Metrics', ex ? 'Completed work by week, month, and year' : 'The tasks you\'ve completed over time');
  let st = { period: 'week', client_id: '', assignee_id: '', table: false };
  try { st = { ...st, ...JSON.parse(sessionStorage.getItem('hh_metrics') || '{}') }; } catch (_) { /* ignore */ }
  page.innerHTML = `
    <div class="board-bar">
      <div class="seg" id="m-period">${[['week', 'Weekly'], ['month', 'Monthly'], ['year', 'Annual']].map(([v, l]) => `<button data-p="${v}">${l}</button>`).join('')}</div>
      <select class="input" id="m-client"><option value="">All clients</option>${S.clients.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      ${ex ? `<select class="input" id="m-user"><option value="">Whole team</option>${S.users.filter((u) => u.active).map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>` : ''}
    </div>
    <div id="m-body"><div class="empty">Loading…</div></div>`;
  $('#m-client').value = st.client_id; if ($('#m-user')) $('#m-user').value = st.assignee_id;

  const draw = async () => {
    try { sessionStorage.setItem('hh_metrics', JSON.stringify(st)); } catch (_) { /* ignore */ }
    $$('#m-period button').forEach((b) => b.classList.toggle('on', b.dataset.p === st.period));
    const qs = new URLSearchParams({ period: st.period, client_id: st.client_id, assignee_id: ex ? st.assignee_id : '' });
    const d = await api('GET', `/api/tasks/stats?${qs}`);
    if (!alive()) return;
    const B = d.buckets, cur = B[B.length - 1], prev = B[B.length - 2];
    const unit = { week: 'week', month: 'month', year: 'year' }[d.period];
    const label = (b, short) => d.period === 'year' ? b.start.slice(0, 4)
      : d.period === 'month' ? new Date(b.start + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', ...(short ? {} : { year: 'numeric' }) })
      : (short ? fmtDateShort(b.start) : `Week of ${fmtDate(b.start)}`);
    const delta = (a, b2) => {
      if (b2 === null || b2 === undefined || a === null) return '';
      const diff = a - b2; if (!diff) return `<span class="delta flat">Same as last ${unit}</span>`;
      return `<span class="delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)} vs last ${unit}</span>`;
    };
    const max = Math.max(1, ...B.map((b) => b.completed));
    const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
    const openTotal = Object.values(d.open_by_status).reduce((a, b) => a + b, 0);
    const bar = (rows, color) => {
      const m = Math.max(1, ...rows.map((r) => r.completed));
      return rows.length && rows.some((r) => r.completed) ? rows.map((r) => `<div class="hbar"><div class="row between small" style="margin-bottom:5px"><span class="row" style="gap:8px;flex-wrap:nowrap;min-width:0">${color(r)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name)}</span></span><b class="mono">${r.completed}</b></div>
        <div class="progress"><div style="width:${(r.completed / m) * 100}%"></div></div></div>`).join('')
        : `<div class="empty" style="padding:18px 0">Nothing completed this ${unit} yet.</div>`;
    };

    $('#m-body').innerHTML = `
      <div class="grid g4" style="margin-bottom:20px">
        <div class="card stat accent"><div class="label">Completed this ${unit}</div><div class="value">${cur.completed}</div><div class="foot">${delta(cur.completed, prev.completed)}</div></div>
        <div class="card stat"><div class="label">On-time rate</div><div class="value">${cur.on_time_rate === null ? '—' : cur.on_time_rate + '%'}</div><div class="foot">${cur.with_deadline ? `${cur.on_time} of ${cur.with_deadline} with a deadline` : 'No deadlines in this period'}</div></div>
        <div class="card stat"><div class="label">Avg. time to complete</div><div class="value">${cur.avg_days === null ? '—' : `${cur.avg_days}<span class="unit">days</span>`}</div><div class="foot">From created to done</div></div>
        <div class="card stat"><div class="label">Open right now</div><div class="value">${openTotal}</div><div class="foot">${d.overdue ? `<span style="color:var(--red);font-weight:600">${d.overdue} overdue</span> · ` : ''}${cur.created} created this ${unit}</div></div>
      </div>
      <div class="card" style="margin-bottom:20px">
        <div class="card-head"><div><h2>Tasks completed per ${unit}</h2><p class="small muted" style="margin-top:3px">${label(B[0])} – ${label(cur)}</p></div>
          <button class="btn sm ghost" id="m-table">${st.table ? 'Show chart' : 'Show table'}</button></div>
        ${st.table ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>${d.period === 'week' ? 'Week' : d.period === 'month' ? 'Month' : 'Year'}</th><th>Completed</th><th>Created</th><th>On-time</th><th>Avg. days</th></tr></thead><tbody>
            ${B.slice().reverse().map((b) => `<tr><td>${label(b)}</td><td class="mono"><b>${b.completed}</b></td><td class="mono">${b.created}</td><td class="mono">${b.on_time_rate === null ? '—' : b.on_time_rate + '%'}</td><td class="mono">${b.avg_days ?? '—'}</td></tr>`).join('')}
          </tbody></table></div>`
        : `<div class="vchart" role="img" aria-label="Tasks completed per ${unit}">
            <div class="vgrid">${ticks.slice().reverse().map((t) => `<div class="gl" style="bottom:${(t / max) * 100}%"><span>${t}</span></div>`).join('')}</div>
            <div class="vbars">${B.map((b, i) => `<div class="vcol ${i === B.length - 1 ? 'cur' : ''}" data-i="${i}" tabindex="0">
              <div class="vtrack">${b.completed ? `<div class="vbar" style="height:${(b.completed / max) * 100}%"></div>` : ''}${b.completed && (i === B.length - 1 || b.completed === max) ? `<span class="vval" style="bottom:calc(${(b.completed / max) * 100}% + 4px)">${b.completed}</span>` : ''}</div>
              <div class="vlab">${label(b, true)}</div></div>`).join('')}</div>
            <div class="vtip hidden" id="m-tip"></div>
          </div>`}
      </div>
      <div class="grid g3" style="margin-bottom:20px">
        ${ex && !st.assignee_id ? `<div class="card"><div class="card-head"><h2>By team member</h2><span class="small muted">this ${unit}</span></div>${bar(d.by_assignee, (r) => av(r.name, r.assignee_avatar, 'sm'))}</div>` : ''}
        <div class="card"><div class="card-head"><h2>By client</h2><span class="small muted">this ${unit}</span></div>${bar(d.by_client, (r) => `<span class="client-dot" style="background:${esc(r.client_color)}"></span>`)}</div>
        <div class="card"><div class="card-head"><h2>By priority</h2><span class="small muted">this ${unit}</span></div>${bar(d.by_priority, (r) => `<span class="client-dot" style="background:${PRIORITY_COLOR[r.name]}"></span>`)}</div>
        <div class="card"><div class="card-head"><h2>Still open</h2><span class="small muted">right now</span></div>
          ${Object.entries(d.open_by_status).map(([k, v]) => `<div class="row between" style="padding:7px 0;border-bottom:1px solid var(--line)"><span class="row" style="gap:8px"><span class="client-dot" style="background:${STATUS_META[k].c}"></span>${esc(k)}</span><b class="mono">${v}</b></div>`).join('')}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Completed this ${unit}</h2><span class="small muted">${d.completed_list.length} task${d.completed_list.length === 1 ? '' : 's'}</span></div>
        ${d.completed_list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Task</th><th>Client</th>${ex ? '<th>Done by</th>' : ''}<th>Priority</th><th>Completed</th><th>Deadline</th></tr></thead><tbody>
          ${d.completed_list.map((t) => `<tr class="clickable" data-task="${t.id}"><td><b>${esc(t.title)}</b></td>
            <td><span class="row" style="gap:6px;flex-wrap:nowrap"><span class="client-dot" style="background:${esc(t.client_color)}"></span>${esc(t.client_name)}</span></td>
            ${ex ? `<td>${t.assignee_name ? `<span class="row" style="gap:8px;flex-wrap:nowrap">${av(t.assignee_name, t.assignee_avatar, 'sm')}${esc(t.assignee_name)}</span>` : '<span class="muted">Unassigned</span>'}</td>` : ''}
            <td>${prioBadge(t.priority)}</td><td>${fmtDateTs(t.completed_at)}</td>
            <td>${t.deadline ? `${dueLong(t)} <span class="badge ${t.on_time ? 'b-green' : 'b-red'}">${t.on_time ? 'On time' : 'Late'}</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty"><b>Nothing completed yet this ${unit}</b>Tasks show up here when they're moved to Done.</div>`}
      </div>`;

    $('#m-table').onclick = () => { st.table = !st.table; draw(); };
    $$('[data-task]', page).forEach((r) => r.onclick = () => openTask(Number(r.dataset.task), draw));
    const tip = $('#m-tip');
    if (tip) {
      const show = (col) => {
        const b = B[Number(col.dataset.i)];
        tip.innerHTML = `<b>${esc(label(b))}</b><div class="row between"><span>Completed</span><b>${b.completed}</b></div><div class="row between"><span>Created</span><b>${b.created}</b></div><div class="row between"><span>On-time</span><b>${b.on_time_rate === null ? '—' : b.on_time_rate + '%'}</b></div>`;
        tip.classList.remove('hidden');
        const box = col.parentElement.parentElement.getBoundingClientRect(), r = col.getBoundingClientRect();
        tip.style.left = `${Math.min(Math.max(r.left - box.left + r.width / 2, 70), box.width - 70)}px`;
      };
      $$('.vcol', page).forEach((c) => { c.addEventListener('mouseenter', () => show(c)); c.addEventListener('focus', () => show(c)); c.addEventListener('mouseleave', () => tip.classList.add('hidden')); c.addEventListener('blur', () => tip.classList.add('hidden')); });
    }
  };
  $$('#m-period button').forEach((b) => b.onclick = () => { st.period = b.dataset.p; draw(); });
  $('#m-client').onchange = (e) => { st.client_id = e.target.value; draw(); };
  if ($('#m-user')) $('#m-user').onchange = (e) => { st.assignee_id = e.target.value; draw(); };
  await draw();
}

// ============================================================ archive
async function pageArchive(page, _a, alive) {
  setTitle('Archive', 'Finished and retired work — searchable, restorable, never lost');
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  const tabs = [['tasks', 'Tasks'], ...(isExec() ? [['clients', 'Clients'], ['team', 'Former team members']] : [])];
  let tab = qp.get('tab') || sessionStorage.getItem('hh_archive_tab') || 'tasks';
  if (!tabs.some(([k]) => k === tab)) tab = 'tasks';
  const f = { q: '', client_id: qp.get('client') || '', assignee_id: '', status: '' };
  const allClients = isExec() ? await api('GET', '/api/clients?archived=1') : S.clients;
  if (!alive()) return;
  page.innerHTML = `<div class="tabs" id="arch-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div><div id="arch-body"></div>`;

  const drawTasks = async () => {
    const box = $('#arch-body');
    box.innerHTML = `<div class="board-bar">
        <input class="input" id="a-q" placeholder="Search titles, descriptions, comments…" value="${esc(f.q)}" style="min-width:260px">
        <select class="input" id="a-client"><option value="">All clients</option>${allClients.map((c) => `<option value="${c.id}" ${String(c.id) === f.client_id ? 'selected' : ''}>${esc(c.name)}${c.archived ? ' (archived)' : ''}</option>`).join('')}</select>
        <select class="input" id="a-user"><option value="">Anyone</option>${S.users.map((u) => `<option value="${u.id}" ${String(u.id) === f.assignee_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
        <select class="input" id="a-status"><option value="">Done &amp; not done</option><option value="done" ${f.status === 'done' ? 'selected' : ''}>Completed</option><option value="open" ${f.status === 'open' ? 'selected' : ''}>Archived before done</option></select>
      </div><div class="card"><div id="a-list"><div class="empty">Loading…</div></div></div>`;
    let items = [], total = 0;
    const load = async (append) => {
      const qs = new URLSearchParams({ ...f, offset: append ? items.length : 0, limit: 50 });
      const r = await api('GET', `/api/archive/tasks?${qs}`);
      items = append ? items.concat(r.items) : r.items; total = r.total;
      $('#a-list').innerHTML = items.length ? `<div class="row between" style="margin-bottom:10px"><span class="small muted">${total} archived task${total === 1 ? '' : 's'}</span></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Task</th><th>Client</th><th>Status</th><th>Assignee</th><th>Completed</th><th>Archived</th><th></th></tr></thead><tbody>
        ${items.map((t) => `<tr class="clickable" data-open="${t.id}">
          <td><b>${esc(t.title)}</b>${t.comment_count ? `<span class="small muted" style="margin-left:8px">${I.chat.replace('width="18" height="18"', 'width="12" height="12" style="vertical-align:-1px"')} ${t.comment_count}</span>` : ''}${t.description ? `<div class="small muted clamp1">${esc(t.description)}</div>` : ''}</td>
          <td style="white-space:nowrap"><span class="row" style="gap:6px;flex-wrap:nowrap"><span class="client-dot" style="background:${esc(t.client_color)}"></span>${esc(t.client_name)}</span></td>
          <td>${statusBadge(t.status)}</td>
          <td style="white-space:nowrap">${t.assignee_name ? `<span class="row" style="gap:8px;flex-wrap:nowrap">${av(t.assignee_name, t.assignee_avatar, 'sm')}${esc(t.assignee_name)}</span>` : '<span class="muted">—</span>'}</td>
          <td class="small">${t.completed_at ? fmtDateTs(t.completed_at) : '<span class="muted">—</span>'}</td>
          <td class="small">${fmtDateTs(t.archived_at)}<div class="muted">${t.archived_by_name ? `by ${esc(t.archived_by_name)}` : 'automatically'}</div></td>
          <td style="white-space:nowrap"><button class="btn sm ghost" data-restore="${t.id}">${I.restore} Restore</button>${isExec() ? `<button class="icon-btn" data-delete="${t.id}" title="Delete permanently">${I.trash}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>${items.length < total ? '<div style="text-align:center;margin-top:14px"><button class="btn ghost" id="a-more">Load more</button></div>' : ''}`
        : `<div class="empty"><b>${f.q || f.client_id || f.assignee_id || f.status ? 'No matches' : 'Nothing archived yet'}</b>${f.q ? 'Try a different search.' : 'Done tasks are archived automatically after a while, or you can archive them from a task or the Done column.'}</div>`;
      if ($('#a-more')) $('#a-more').onclick = () => load(true);
    };
    let tmr;
    $('#a-q').oninput = (e) => { clearTimeout(tmr); tmr = setTimeout(() => { f.q = e.target.value.trim(); load(); }, 250); };
    $('#a-client').onchange = (e) => { f.client_id = e.target.value; load(); };
    $('#a-user').onchange = (e) => { f.assignee_id = e.target.value; load(); };
    $('#a-status').onchange = (e) => { f.status = e.target.value; load(); };
    $('#a-list').onclick = async (e) => {
      const rs = e.target.closest('[data-restore]'), dl = e.target.closest('[data-delete]'), row = e.target.closest('[data-open]');
      if (rs) { e.stopPropagation(); await api('POST', `/api/tasks/${rs.dataset.restore}/restore`, {}); toast('Restored to the board', 'ok'); load(); return; }
      if (dl) {
        e.stopPropagation();
        if (await confirmModal('Delete this task permanently? Its comments, files, and links will be gone for good.')) { await api('DELETE', `/api/tasks/${dl.dataset.delete}`); toast('Deleted permanently'); load(); }
        return;
      }
      if (row) openTask(Number(row.dataset.open), () => load());
    };
    load();
  };

  const drawClients = async () => {
    const rows = (await api('GET', '/api/clients?archived=1')).filter((c) => c.archived);
    $('#arch-body').innerHTML = `<div class="res-grid">${rows.length ? rows.map((c) => `<div class="card" style="border-top:4px solid ${esc(c.color)}">
        <div class="row between"><h2>${esc(c.name)}</h2><span class="badge b-gray">Archived</span></div>
        <p class="muted small" style="margin:6px 0 4px">${esc(c.description || 'No description')}</p>
        <p class="small muted" style="margin-bottom:14px">${c.total_tasks} task${c.total_tasks === 1 ? '' : 's'}${c.archived_at ? ` · archived ${fmtDateTs(c.archived_at)}` : ''}</p>
        <div class="row"><a class="btn sm ghost" href="#/board/${c.id}">View board</a><button class="btn sm" data-unarch="${c.id}">${I.restore} Restore client</button></div></div>`).join('')
      : '<div class="card empty" style="grid-column:1/-1"><b>No archived clients</b>When you archive a client from the Clients page, it moves here with all its tasks intact.</div>'}</div>`;
    $$('[data-unarch]').forEach((b) => b.onclick = async () => {
      await api('PUT', `/api/clients/${b.dataset.unarch}`, { archived: false }); await loadClients(); refreshClientNav(); toast('Client restored', 'ok'); drawClients();
    });
  };

  const drawTeam = async () => {
    await loadUsers();
    const rows = S.users.filter((u) => !u.active);
    $('#arch-body').innerHTML = `<div class="card">${rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Position</th><th>Started</th><th></th></tr></thead><tbody>
      ${rows.map((u) => `<tr><td><div class="row" style="gap:10px;flex-wrap:nowrap">${av(u.name, u.avatar_file_id)}<div><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)}</div></div></div></td>
        <td>${esc(u.position || '—')}</td><td>${u.start_date ? fmtDate(u.start_date) : '—'}</td>
        <td style="white-space:nowrap"><a class="btn sm ghost" href="#/profile/${u.id}">View profile</a><button class="btn sm" data-react="${u.id}">Reactivate</button></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><b>No former team members</b>Deactivated accounts show up here with their full history — EODs, timesheets, KPIs, and incidents.</div>'}</div>`;
    $$('[data-react]').forEach((b) => b.onclick = async () => {
      await api('PUT', `/api/users/${b.dataset.react}`, { active: true }); toast('Account reactivated', 'ok'); drawTeam();
    });
  };

  const show = (k) => {
    tab = k; sessionStorage.setItem('hh_archive_tab', k);
    $$('#arch-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    ({ tasks: drawTasks, clients: drawClients, team: drawTeam })[k]();
  };
  $$('#arch-tabs button').forEach((b) => b.onclick = () => show(b.dataset.tab));
  show(tab);
}

// Executive view of everyone's time blocks for a day — who is working on what, right now.
async function teamPlanCard(box, team, alive) {
  let day = todayStr();
  const draw = async () => {
    const r = await api('GET', `/api/schedule?date=${day}&user_id=all`);
    if (!alive()) return;
    const byPerson = team.map((m) => ({ key: m.id, label: `${av(m.name, m.avatar_file_id, 'sm')}<span>${esc(m.name.split(' ')[0])}</span>`, items: r.items.filter((t) => t.assignee_id === m.id) }))
      .filter((row) => row.items.length);
    const live = r.items.filter((t) => isBlockNow(t) && t.status !== 'Done');
    box.innerHTML = `<div class="card-head plan-head">
        <div><h2>${I.clock} ${day === todayStr() ? 'Team plan today' : `Team plan · ${dayWord(day)}`}</h2>
          <p class="small muted" style="margin-top:3px">${r.items.length ? `${r.items.length} time block${r.items.length === 1 ? '' : 's'} across ${byPerson.length} ${byPerson.length === 1 ? 'person' : 'people'}`
            + (live.length ? ` · <b class="now-text">${live.length} in progress now</b>` : '') : 'No one has planned time blocks for this day yet'}</p></div>
        <div class="seg day-nav"><button data-d="-1" aria-label="Previous day">‹</button><button data-d="0" class="${day === todayStr() ? 'on' : ''}">Today</button><button data-d="1" aria-label="Next day">›</button></div>
      </div>
      ${timelineHTML(byPerson, day, { showPeople: true, emptyText: '<b>No time blocks planned</b>Team members set time blocks on their tasks; they show up here so you can see who’s working on what.' })}`;
    $$('.day-nav button', box).forEach((b) => b.onclick = () => { day = b.dataset.d === '0' ? todayStr() : shiftDay(day, Number(b.dataset.d)); draw(); });
    $$('[data-task]', box).forEach((b) => b.onclick = () => openTask(Number(b.dataset.task), draw));
  };
  draw();
}

// ============================================================ executive: overview
async function pageOverview(page, _a, alive) {
  setTitle('Executive Overview', new Date().toLocaleDateString('en-US', { timeZone: TZ(), weekday: 'long', month: 'long', day: 'numeric' }));
  const o = await api('GET', '/api/exec/overview');
  if (!alive()) return;
  const on = o.team.filter((t) => t.status !== 'Off').length;
  const open = S.statuses.filter((s) => s !== 'Done').reduce((a, s) => a + o.task_counts[s], 0);
  const totalTasks = Object.values(o.task_counts).reduce((a, b) => a + b, 0) || 1;
  const accrualRate = o.team.filter((t) => t.status === 'On Shift').reduce((a, t) => a + t.hourly_rate / 3600, 0);
  page.innerHTML = `
    <div class="grid g4" style="margin-bottom:18px">
      <div class="card stat accent"><div class="label">Online now</div><div class="value">${on} <span class="muted" style="font-size:16px">/ ${o.team.length}</span></div><div class="foot">${o.team.filter((t) => t.status === 'On Break').length} on break</div></div>
      <div class="card stat"><div class="label">Payroll accrued</div><div class="value" ${liveAttrs('money', o.payroll_accrued, accrualRate)}>${money(o.payroll_accrued)}</div><div class="foot">Cutoff ${fmtDateShort(o.cutoff.start)} – ${fmtDateShort(o.cutoff.end)}</div></div>
      <div class="card stat"><div class="label">Open tasks</div><div class="value">${open}</div><div class="foot">${o.task_counts.Blocked} blocked · ${o.task_counts['For Revision']} for revision</div></div>
      <div class="card stat"><div class="label">Overdue tasks</div><div class="value" style="color:${o.overdue ? 'var(--red)' : 'var(--navy)'}">${o.overdue}</div><div class="foot">Past deadline, not done</div></div>
    </div>
    <div class="card" id="team-plan" style="margin-bottom:20px"></div>
    <div class="grid g3">
      <div class="card span2"><div class="card-head"><h2>Team right now</h2><a class="btn sm ghost" href="#/team">Manage team</a></div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Team member</th><th>Status</th><th>Since</th><th>Today</th><th>Earned this cutoff</th></tr></thead><tbody>
        ${o.team.map((t) => `<tr class="clickable" data-user="${t.id}"><td><div class="row" style="gap:10px;flex-wrap:nowrap">${av(t.name, t.avatar_file_id)}<div><b>${esc(t.name)}</b><div class="small muted">${esc(t.position || '')}</div></div></div></td>
          <td>${shiftBadge(t.status === 'On Break' ? 'On Break' : t.status)}${t.break_kind ? ` <span class="small muted">${esc(t.break_kind)}</span>` : ''}</td>
          <td>${t.since ? fmtTime(t.since) : '—'}</td>
          <td class="mono" ${liveAttrs('hrs', t.today_seconds, t.status === 'On Shift' ? 1 : 0)}>${hrs(t.today_seconds)}</td>
          <td class="mono"><b ${liveAttrs('money', t.earnings, t.status === 'On Shift' ? t.hourly_rate / 3600 : 0)}>${money(t.earnings)}</b> <span class="small muted">/ ${money(t.salary)}</span></td></tr>`).join('')}
        </tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>Tasks by status</h2></div>
        ${S.statuses.map((s) => `<div style="margin-bottom:12px"><div class="row between small" style="margin-bottom:5px"><span class="row" style="gap:6px"><span class="client-dot" style="background:${STATUS_META[s].c}"></span>${s}</span><b>${o.task_counts[s]}</b></div>
          <div class="progress"><div style="width:${(o.task_counts[s] / totalTasks) * 100}%;background:${STATUS_META[s].c}"></div></div></div>`).join('')}
        <a class="btn sm ghost" href="#/clients" style="margin-top:6px">View clients</a></div>
      <div class="card span2"><div class="card-head"><h2>Latest EOD reports</h2><a class="btn sm ghost" href="#/eods">See all</a></div>
        ${o.eods.length ? o.eods.map((e) => eodItemHTML(e, true)).join('') : '<div class="empty"><b>No EODs yet</b></div>'}</div>
      <div class="card"><div class="card-head"><h2>Recent incidents</h2></div>
        ${o.incidents.length ? o.incidents.map((i) => `<div class="list-item"><div><b>${esc(i.title)}</b><div class="small muted">${esc(i.user_name)} · ${fmtDate(i.incident_date)} · ${esc(i.severity)}</div></div></div>`).join('') : '<div class="empty"><b>No incidents</b>All clear.</div>'}</div>
    </div>`;
  $$('[data-user]', page).forEach((r) => r.onclick = () => { location.hash = `#/profile/${r.dataset.user}`; });
  const timer = setInterval(() => { if (!alive() || !location.hash.startsWith('#/overview')) return clearInterval(timer); if (!$('#modal-root .modal-bg')) route(); }, 60000);
  teamPlanCard($('#team-plan'), o.team, alive);
}

// ============================================================ executive: team
async function pageTeam(page, _a, alive) {
  setTitle('Team', 'Add team members, set pay, and open profiles');
  await loadUsers();
  if (!alive()) return;
  page.innerHTML = `<div class="card"><div class="card-head"><h2>${S.users.length} team members</h2><button class="btn red" id="add-user">${I.plus} Add team member</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Position</th><th>Access</th><th>Salary / cutoff</th><th>Shift</th><th>Bank QR</th><th>Status</th></tr></thead><tbody>
    ${S.users.map((u) => `<tr class="clickable" data-user="${u.id}"><td><div class="row" style="gap:10px;flex-wrap:nowrap">${av(u.name, u.avatar_file_id)}<div><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)}</div></div></div></td>
      <td>${esc(u.position || '—')}</td><td><span class="badge ${u.role === 'executive' ? 'b-navy' : 'b-gray'}">${u.role === 'executive' ? 'Executive' : 'Employee'}</span></td>
      <td class="mono">${money(u.salary_per_cutoff)}</td><td>${num(u.shift_hours)}h</td>
      <td>${u.qr_file_id ? '<span class="badge b-green">On file</span>' : '<span class="badge b-gray">Missing</span>'}</td>
      <td>${u.active ? '<span class="badge b-green">Active</span>' : '<span class="badge b-red">Deactivated</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  $$('[data-user]', page).forEach((r) => r.onclick = () => { location.hash = `#/profile/${r.dataset.user}`; });
  $('#add-user').onclick = () => formModal({
    title: 'Add team member', wide: true, submit: 'Create account', fields: employeeFields({}, true),
    onSubmit: async (d, close) => {
      const r = await api('POST', '/api/users', d);
      close(); await loadUsers(); route();
      passwordReveal('Account created', r.user.email, r.temp_password);
    },
  });
}

// ============================================================ executive: timesheets & payroll
async function pageTimesheets(page, _a, alive) {
  setTitle('Timesheets & Payroll', 'Semi-monthly cutoffs: 1st–15th and 16th–end of month');
  const opts = cutoffOptions();
  let ref = opts[0][0];
  let selUser = S.users.find((u) => u.active)?.id;
  page.innerHTML = `
    <div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Payroll summary</h2>
      <div class="row"><select class="input" id="p-cut" style="width:auto">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <a class="btn ghost" id="p-csv">${I.download} Export CSV</a></div></div><div id="p-body"><div class="empty">Loading…</div></div></div>
    <div class="card"><div class="card-head"><h2>Time entries</h2>
      <select class="input" id="t-user" style="width:auto">${S.users.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select></div>
      <div id="t-body"></div></div>`;
  const drawPayroll = async () => {
    $('#p-csv').href = `/api/payroll.csv?date=${ref}`;
    const r = await api('GET', `/api/payroll?date=${ref}`);
    if (!alive()) return;
    const total = r.rows.reduce((a, x) => a + x.earnings, 0);
    $('#p-body').innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Team member</th><th>Salary / cutoff</th><th>Expected</th><th>Worked</th><th>Hourly rate</th><th>Earned</th><th>Bank</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr class="clickable" data-pu="${x.user_id}"><td><b>${esc(x.name)}</b><div class="small muted">${esc(x.position || '')}</div></td><td class="mono">${money(x.salary)}</td>
        <td>${num(x.expected_hours)}h</td><td>${hrs(x.worked_seconds)}</td><td class="mono">${money(x.hourly_rate)}</td><td class="mono"><b>${money(x.earnings)}</b></td>
        <td>${esc(x.bank_name || '—')} ${x.has_qr ? '<span class="badge b-green">QR</span>' : ''}</td></tr>`).join('')}
      <tr><td><b>Total</b></td><td></td><td></td><td></td><td></td><td class="mono"><b style="color:var(--red)">${money(total)}</b></td><td></td></tr>
      </tbody></table></div>`;
    $$('[data-pu]', page).forEach((row) => row.onclick = () => { selUser = Number(row.dataset.pu); $('#t-user').value = selUser; drawEntries(); $('#t-body').scrollIntoView({ behavior: 'smooth' }); });
  };
  const drawEntries = () => renderTimesheetInto($('#t-body'), selUser, true, ref);
  $('#p-cut').onchange = (e) => { ref = e.target.value; drawPayroll(); drawEntries(); };
  $('#t-user').onchange = (e) => { selUser = Number(e.target.value); drawEntries(); };
  if (selUser) $('#t-user').value = selUser;
  await drawPayroll();
  if (selUser) drawEntries();
}

// ============================================================ executive: clients
async function pageClients(page, _a, alive) {
  setTitle('Clients', 'Each client gets its own kanban board');
  let rows = await api('GET', '/api/clients');
  if (!alive()) return;
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('hh_client_view') || '{}'); } catch (_) { return {}; } })();
  const v = { type: '', status: '', sort: 'custom', ...saved };
  const typeRank = (c) => S.clientTypes.indexOf(c.client_type);
  const statusRank = (c) => ['At Risk', 'Newly Onboarded', 'Stable'].indexOf(c.client_status);
  const SORTS = {
    custom: ['Custom order', null],
    name: ['Name A–Z', (a, b) => a.name.localeCompare(b.name)],
    type: ['Client type', (a, b) => typeRank(a) - typeRank(b) || a.name.localeCompare(b.name)],
    status: ['At risk first', (a, b) => statusRank(a) - statusRank(b) || a.name.localeCompare(b.name)],
    open: ['Most open tasks', (a, b) => b.open_tasks - a.open_tasks || a.name.localeCompare(b.name)],
  };
  page.innerHTML = `
    <div class="board-bar client-bar">
      <select class="input" id="c-type"><option value="">All types</option>${S.clientTypes.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
      <select class="input" id="c-status"><option value="">All statuses</option>${S.clientStatuses.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
      <select class="input" id="c-sort" title="Sort clients" aria-label="Sort clients">${Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <span style="flex:1"></span>
      <a class="btn ghost" href="#/archive?tab=clients">${I.archive} Archived</a>
      <button class="btn red" id="c-add">${I.plus} New client</button>
    </div>
    <p class="small muted" id="c-hint" style="margin:-6px 0 14px"></p>
    <div class="res-grid client-grid" id="c-grid"></div>`;
  $('#c-type').value = v.type; $('#c-status').value = v.status; $('#c-sort').value = v.sort;

  const draw = () => {
    sessionStorage.setItem('hh_client_view', JSON.stringify(v));
    const canArrange = v.sort === 'custom' && !v.type && !v.status;
    let list = rows.filter((c) => (!v.type || c.client_type === v.type) && (!v.status || c.client_status === v.status));
    if (SORTS[v.sort][1]) list = [...list].sort(SORTS[v.sort][1]);
    $('#c-hint').innerHTML = rows.length > 1 ? (canArrange ? `${I.grip.replace('width="18" height="18"', 'width="12" height="12" style="vertical-align:-2px"')} Drag cards to arrange your clients — the sidebar follows this order.`
      : 'Switch to “Custom order” with no filters to drag clients into place.') : '';
    $('#c-grid').innerHTML = list.length ? list.map((c) => `<div class="card client-card ${canArrange ? 'can-drag' : ''}" data-cid="${c.id}" ${canArrange ? 'draggable="true"' : ''} style="--client:${esc(c.color)}">
        <div class="row between" style="flex-wrap:nowrap;gap:8px">
          <h2 style="min-width:0"><span class="client-dot" style="background:${esc(c.color)}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span></h2>
          ${canArrange ? `<span class="drag-handle" title="Drag to arrange">${I.grip}</span>` : ''}
        </div>
        <div class="row" style="gap:6px;margin:10px 0 8px">${clientTypeBadge(c.client_type)}${clientHealthBadge(c.client_status)}<span class="badge b-gray">${c.open_tasks} open</span></div>
        <p class="muted small" style="margin:0 0 10px;min-height:18px">${esc(c.description || 'No description')}</p>
        <p class="small chat-dest">${I.chat}${c.chat_webhook ? 'Task alerts → <b>this client\'s Chat space</b>' : 'Task alerts → team default space'}</p>
        <div class="row"><a class="btn sm" href="#/board/${c.id}">Open board</a><button class="btn sm ghost" data-edit="${c.id}">Edit</button>
          <button class="btn sm ghost" data-arch="${c.id}">Archive</button></div>
      </div>`).join('')
      : `<div class="card empty" style="grid-column:1/-1"><b>${rows.length ? 'No clients match these filters' : 'No clients yet'}</b>${rows.length ? 'Try a different type or status.' : 'Create your first client to get a task board for them.'}</div>`;
  };
  $('#c-type').onchange = (e) => { v.type = e.target.value; draw(); };
  $('#c-status').onchange = (e) => { v.status = e.target.value; draw(); };
  $('#c-sort').onchange = (e) => { v.sort = e.target.value; draw(); };

  // Drag to arrange (custom order only)
  const grid = $('#c-grid');
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.client-card.can-drag'); if (!card) return;
    card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.cid);
  });
  grid.addEventListener('dragover', (e) => {
    const dragging = $('.client-card.dragging', grid); if (!dragging) return;
    e.preventDefault();
    const others = $$('.client-card:not(.dragging)', grid);
    const target = others.find((el) => { const r = el.getBoundingClientRect(); return e.clientY < r.bottom && (e.clientY < r.top + r.height / 2 || e.clientX < r.left + r.width / 2); });
    if (target) grid.insertBefore(dragging, target); else grid.appendChild(dragging);
  });
  grid.addEventListener('dragend', async (e) => {
    const card = e.target.closest('.client-card'); if (!card) return;
    card.classList.remove('dragging');
    const ids = $$('.client-card', grid).map((el) => Number(el.dataset.cid));
    if (ids.join() === rows.map((c) => c.id).join()) return;
    rows = ids.map((id) => rows.find((c) => c.id === id));
    try { await api('POST', '/api/clients/reorder', { ids }); await loadClients(); refreshClientNav(); toast('Client order saved', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });

  const fields = (c = {}) => [
    { name: 'name', label: 'Client name', required: true, full: true, value: c.name },
    { name: 'client_type', label: 'Client type', type: 'select', options: S.clientTypes, value: c.client_type || 'Stable Client' },
    { name: 'client_status', label: 'Status', type: 'select', options: S.clientStatuses, value: c.client_status || 'Newly Onboarded' },
    { name: 'color', label: 'Board color', type: 'color', full: true, value: c.color || CLIENT_COLORS[0] },
    { name: 'description', label: 'Description', type: 'textarea', full: true, rows: 3, value: c.description, placeholder: 'Market, deal type, point of contact…' },
    { name: 'chat_webhook', label: 'Google Chat space for this client (optional)', full: true, value: c.chat_webhook, placeholder: 'https://chat.googleapis.com/v1/spaces/…',
      hint: "Task alerts for this board post here. Leave blank to use the team's default task-alerts space (Settings)." },
  ];
  const testBtn = '<button class="btn ghost" type="button" data-test-hook>Send test message</button>';
  const wireTest = (m, c) => { $('[data-test-hook]', m.el).onclick = async () => {
    const url = $('[name=chat_webhook]', m.el).value.trim();
    if (!url) { toast('Paste a webhook URL first', 'err'); return; }
    if (!c) { toast('Create the client first, then send a test from Edit', 'err'); return; }
    try { const r = await api('POST', `/api/clients/${c.id}/test-webhook`, { url }); toast(r.message, 'ok'); } catch (err) { toast(err.message, 'err'); }
  }; };
  // Apply the server's reply directly: no extra round trips after a save.
  const applyClient = (c, { remove = false } = {}) => {
    rows = rows.filter((x) => x.id !== c.id); S.clients = S.clients.filter((x) => x.id !== c.id);
    if (!remove) {
      const at = (list) => { const i = list.findIndex((x) => (x.position ?? x.id) > (c.position ?? c.id)); return i < 0 ? list.length : i; };
      rows.splice(at(rows), 0, c); S.clients.splice(at(S.clients), 0, c);
    }
    refreshClientNav(); draw();
  };
  $('#c-add').onclick = () => formModal({ title: 'New client', fields: fields(), submit: 'Create client', onSubmit: async (d, close) => { const c = await api('POST', '/api/clients', d); close(); applyClient(c); toast(`${c.name} created`, 'ok'); } });
  page.addEventListener('click', async (e) => {
    const ed = e.target.closest('[data-edit]'); const ar = e.target.closest('[data-arch]');
    if (ed) { const c = rows.find((x) => x.id === Number(ed.dataset.edit)); wireTest(formModal({ title: `Edit ${c.name}`, fields: fields(c), extraFoot: testBtn, onSubmit: async (d, close) => { const u = await api('PUT', `/api/clients/${c.id}`, d); close(); applyClient(u); toast('Client updated', 'ok'); } }), c); }
    if (ar) { const c = rows.find((x) => x.id === Number(ar.dataset.arch)); if (await confirmModal(`Archive ${c.name}? Its board moves to the Archive — nothing is deleted and you can restore it any time.`, { okLabel: 'Archive', danger: false })) { const u = await api('PUT', `/api/clients/${c.id}`, { archived: true }); applyClient(u, { remove: true }); toast(`${c.name} archived`, 'ok'); } }
  });
  draw();
}

// ============================================================ executive: settings
async function pageSettings(page, _a, alive) {
  setTitle('Settings', 'Company preferences and Google Chat integrations');
  const s = await api('GET', '/api/settings');
  if (!alive()) return;
  const days = s.work_days.split(',').filter(Boolean).map(Number);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  page.innerHTML = `
    <form id="set-form" class="grid g2">
      <div class="card stack"><h2>Company</h2>
        <label class="field">Company name<input class="input" name="company_name" value="${esc(s.company_name)}"></label>
        <label class="field">Timezone <span class="hint">Used for shifts, cutoffs and Chat alerts</span><input class="input" name="timezone" value="${esc(s.timezone)}" list="tzs">
          <datalist id="tzs">${['Asia/Manila', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'UTC'].map((z) => `<option value="${z}">`).join('')}</datalist></label>
        <label class="field">Currency symbol<input class="input" name="currency" value="${esc(s.currency)}" style="max-width:120px"></label>
        <div class="field"><span>Work days <span class="hint">Used to compute the hourly rate from salary per cutoff</span></span>
          <div class="row">${dayNames.map((n, i) => `<label class="check"><input type="checkbox" name="wd" value="${i}" ${days.includes(i) ? 'checked' : ''}> ${n}</label>`).join('')}</div></div>
        <label class="field">Auto-archive done tasks after <span class="hint">Keeps boards clean. Archived tasks stay searchable and still count in Task Metrics. Use 0 to turn off.</span>
          <span class="row" style="flex-wrap:nowrap"><input class="input" type="number" min="0" max="365" name="auto_archive_days" value="${esc(s.auto_archive_days ?? '14')}" style="width:110px"><span class="muted">days</span></span></label>
        <label class="field">Company's current direction <span class="hint">Shown on every profile's Weekly Metrics so the team can align their results</span>
          <textarea class="input" name="company_direction" rows="5" placeholder="e.g. Q4 focus: 20 signed contracts in Dallas & Houston. Prioritize motivated-seller follow-ups.">${esc(s.company_direction)}</textarea></label>
      </div>
      <div class="card stack"><h2>Google Chat</h2>
        <div class="callout small">In Google Chat, open the space → <b>Apps &amp; integrations</b> → <b>Webhooks</b> → <b>Add webhook</b>, then paste the URL here. Use one space for shift alerts and one for EODs.</div>
        <label class="field">Shift alerts webhook<input class="input" name="chat_webhook_shift" value="${esc(s.chat_webhook_shift)}" placeholder="https://chat.googleapis.com/v1/spaces/…"></label>
        <div class="row"><button type="button" class="btn sm ghost" data-test="shift">Send test message</button></div>
        <label class="check"><input type="checkbox" name="notify_clock_out" ${s.notify_clock_out === '1' ? 'checked' : ''}> Also alert when someone clocks out</label>
        <label class="check"><input type="checkbox" name="notify_breaks" ${s.notify_breaks === '1' ? 'checked' : ''}> Also alert for breaks and lunch</label>
        <label class="field" style="margin-top:8px">EOD channel webhook<input class="input" name="chat_webhook_eod" value="${esc(s.chat_webhook_eod)}" placeholder="https://chat.googleapis.com/v1/spaces/…"></label>
        <div class="row"><button type="button" class="btn sm ghost" data-test="eod">Send test message</button></div>
      </div>
      <div class="card stack span2"><div class="row between"><h2>${I.chat} Google Chat · Task alerts</h2><span class="small muted">Per-client spaces can be set under Clients → Edit</span></div>
        <div class="grid g2" style="gap:18px">
          <div class="stack">
            <label class="field">Default task-alerts webhook <span class="hint">Used for every client that doesn't have its own Chat space</span>
              <input class="input" name="chat_webhook_tasks" value="${esc(s.chat_webhook_tasks)}" placeholder="https://chat.googleapis.com/v1/spaces/…"></label>
            <div class="row"><button type="button" class="btn sm ghost" data-test="tasks">Send test message</button></div>
            <label class="field">Completed tasks webhook <span class="hint">Optional. When set, every "Task completed" alert goes to this space instead (all clients).</span>
              <input class="input" name="chat_webhook_tasks_done" value="${esc(s.chat_webhook_tasks_done || '')}" placeholder="https://chat.googleapis.com/v1/spaces/…"></label>
            <div class="row"><button type="button" class="btn sm ghost" data-test="tasks_done">Send test message</button></div>
            <label class="field">Hub web address <span class="hint">Used for the "Open in Her Haus Hub" links in Chat messages</span>
              <input class="input" name="app_url" value="${esc(s.app_url || location.origin)}" placeholder="https://hub.yourdomain.com"></label>
          </div>
          <div class="stack">
            <div class="field"><span>Post to Chat when…</span></div>
            ${[['task_alert_created', 'A new task is created (including by automations)'], ['task_alert_assigned', 'A task is assigned or reassigned'],
               ['task_alert_done', 'A task is completed (with on-time / late)'], ['task_alert_status', 'A task moves to any other column'],
               ['task_alert_comment', 'Someone comments on a task']].map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}" ${s[k] === '1' ? 'checked' : ''}> ${l}</label>`).join('')}
            <div class="digest-row">
              <label class="check"><input type="checkbox" name="task_alert_digest" ${s.task_alert_digest === '1' ? 'checked' : ''}> Daily digest of overdue &amp; due-today tasks at</label>
              <input class="input" type="time" name="task_digest_time" value="${esc(s.task_digest_time || '09:00')}" style="width:130px">
            </div>
            <p class="small muted" style="margin-top:-4px">Sent on work days only, one message per Chat space, grouped by client.</p>
            <div class="row"><button type="button" class="btn sm ghost" id="send-digest">Send today's digest now</button></div>
          </div>
        </div>
      </div>
      <div class="span2"><button class="btn lg" type="submit">Save settings</button></div>
    </form>`;
  const collect = () => {
    const f = $('#set-form');
    return {
      company_name: f.company_name.value, timezone: f.timezone.value.trim(), currency: f.currency.value, company_direction: f.company_direction.value,
      chat_webhook_shift: f.chat_webhook_shift.value.trim(), chat_webhook_eod: f.chat_webhook_eod.value.trim(),
      notify_clock_out: f.notify_clock_out.checked ? '1' : '0', notify_breaks: f.notify_breaks.checked ? '1' : '0',
      work_days: $$('input[name=wd]:checked', f).map((x) => x.value).join(','),
      auto_archive_days: String(f.auto_archive_days.value || '0'),
      chat_webhook_tasks: f.chat_webhook_tasks.value.trim(), chat_webhook_tasks_done: f.chat_webhook_tasks_done.value.trim(), app_url: f.app_url.value.trim(), task_digest_time: f.task_digest_time.value || '09:00',
      ...Object.fromEntries(['task_alert_created', 'task_alert_assigned', 'task_alert_done', 'task_alert_status', 'task_alert_comment', 'task_alert_digest']
        .map((k) => [k, f[k].checked ? '1' : '0'])),
    };
  };
  $('#set-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/settings', collect()); const me = await api('GET', '/api/me'); S.settings = me.settings; toast('Settings saved', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  };
  $('#send-digest').onclick = async () => {
    try { await api('PUT', '/api/settings', collect()); const r = await api('POST', '/api/settings/send-digest', {}); toast(r.message, 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  };
  $$('[data-test]', page).forEach((b) => b.onclick = async () => {
    try { await api('PUT', '/api/settings', collect()); const r = await api('POST', '/api/settings/test-webhook', { which: b.dataset.test }); toast(r.message, 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });
}

// ============================================================ Google Chat (two-way sync — see google_chat.py)
const chatCache = { members: {} };
function personAv(p, cls = 'sm') {
  if (!p) return av('?', null, cls);
  if (p.avatar_file_id) return av(p.name, p.avatar_file_id, cls);
  if (p.photo) return `<img class="avatar ${cls}" src="${esc(p.photo)}" alt="${esc(p.name)}" title="${esc(p.name)}" referrerpolicy="no-referrer" loading="lazy">`;
  return av(p.name, null, cls);
}
const SPACE_COLORS = ['#1B4BA8', '#0C2E60', '#CB252B', '#2F855A', '#B7791F', '#6B46C1', '#2B6CB0', '#C05621'];
function spaceAv(s, cls = '') {
  if (s.type === 'DIRECT_MESSAGE' && s.partner) return personAv(s.partner, cls);
  const h = [...(s.title || '?')].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return `<span class="space-av ${cls} ${s.type === 'GROUP_CHAT' ? 'group' : ''}" style="background:${SPACE_COLORS[h % SPACE_COLORS.length]}">${s.type === 'GROUP_CHAT' ? I.users.replace('width="18" height="18"', 'width="16" height="16"') : esc(initials(s.title))}</span>`;
}
function chatClock(iso) {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
function chatDay(iso) {
  const d = new Date(iso); const now = new Date(); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
// Google Chat formatting: *bold* _italic_ ~strike~ `code` ```blocks``` <url|label> and plain links
function chatFmt(raw) {
  const codes = [];
  let s = esc(raw).replace(/```([\s\S]*?)```/g, (_m, c) => { codes.push(`<pre>${c.replace(/^\n/, '')}</pre>`); return `\u0000${codes.length - 1}\u0000`; })
    .replace(/`([^`\n]+)`/g, (_m, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/&lt;(https?:\/\/[^|\s]+?)\|([^\n]+?)&gt;/g, (_m, u, l) => { codes.push(`<a href="${u}" target="_blank" rel="noopener noreferrer">${l}</a>`); return `\u0000${codes.length - 1}\u0000`; })
    .replace(/(https?:\/\/[^\s<\u0000]+[^\s<.,;:!?)\]'"\u0000])/g, (u) => { codes.push(`<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`); return `\u0000${codes.length - 1}\u0000`; })
    .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=$|[\s.,!?:;)])/g, '$1<b>$2</b>')
    .replace(/(^|[\s(])_(?=\S)([^_\n]*?\S)_(?=$|[\s.,!?:;)])/g, '$1<i>$2</i>')
    .replace(/(^|[\s(])~(?=\S)([^~\n]*?\S)~(?=$|[\s.,!?:;)])/g, '$1<s>$2</s>')
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => codes[i]);
}
// Plain-text version for previews: drop formatting marks, show link labels.
const chatPlain = (s) => (s || '').replace(/<(https?:\/\/[^|\s>]+)\|([^>]+)>/g, '$2').replace(/<users\/[^>]+>/g, '@')
  .replace(/(^|[\s(])([*_~])(?=\S)([^*_~\n]*?\S)\2(?=$|[\s.,!?:;)])/g, '$1$3').replace(/```|`/g, '');
function chatTextHTML(m, myGid) {
  const text = m.text || '';
  const anns = (m.annotations || []).filter((a) => a.length > 0 && a.start >= 0).sort((a, b) => a.start - b.start);
  let out = '', i = 0;
  for (const a of anns) {
    if (a.start < i) continue;
    out += chatFmt(text.slice(i, a.start));
    out += `<span class="mention ${a.user === myGid || a.user === 'users/all' ? 'me' : ''}">${esc(text.slice(a.start, a.start + a.length))}</span>`;
    i = a.start + a.length;
  }
  return out + chatFmt(text.slice(i));
}
function chatMsgHTML(m, prev, opts = {}) {
  const grouped = prev && !opts.thread && prev.sender.gid === m.sender.gid && !prev.reply_count && !m.deleted
    && new Date(m.create_time) - new Date(prev.create_time) < 6 * 60000 && chatDay(prev.create_time) === chatDay(m.create_time);
  const imgs = m.attachments.filter((a) => a.is_image && !a.drive), files = m.attachments.filter((a) => !a.is_image || a.drive);
  const order = (e) => { const i = REACTION_EMOJI.indexOf(e); return i < 0 ? 99 : i; };
  const rx = [...m.reactions].sort((a, b) => order(a.emoji) - order(b.emoji));
  const full = new Date(m.create_time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return `<div class="cmsg ${grouped ? 'cont' : ''}" data-mid="${m.id}">
    <div class="cmsg-av">${grouped ? `<time class="cmsg-hover-time" title="${esc(full)}">${new Date(m.create_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>` : personAv(m.sender)}</div>
    <div class="cmsg-main">
      ${grouped ? '' : `<div class="cmsg-head"><b>${esc(m.sender.name)}</b>${m.sender.is_bot ? '<span class="bot-tag">App</span>' : ''}<time title="${esc(full)}">${chatClock(m.create_time)}${chatClock(m.create_time).includes(':') ? '' : `, ${new Date(m.create_time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}</time></div>`}
      ${m.deleted ? '<div class="cmsg-body deleted">Message deleted</div>'
        : `${m.text ? `<div class="cmsg-body">${chatTextHTML(m, opts.myGid)}${m.edited ? ' <span class="cmsg-edited">(edited)</span>' : ''}</div>` : ''}
      ${m.card_text ? `<div class="cmsg-card">${esc(m.card_text)}</div>` : ''}
      ${imgs.length ? `<div class="c-imgs ${imgs.length === 1 ? 'one' : ''}">${imgs.map((a) => `<button type="button" class="c-img" data-chat-img="${esc(a.url)}" title="${esc(a.name)}"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></button>`).join('')}</div>` : ''}
      ${files.length ? `<div class="cmsg-files">${files.map((a) => `<a class="cmsg-file" href="${esc(a.url)}${a.drive ? '' : '?download=1'}" target="_blank" rel="noopener">${I.clip.replace('width="18" height="18"', 'width="14" height="14"')}<span>${esc(a.name)}</span></a>`).join('')}</div>` : ''}`}
      ${rx.length ? `<div class="rx-row">${rx.map((r) => `<button type="button" class="rx ${r.mine ? 'mine' : ''}" data-react="${esc(r.emoji)}"><span class="rx-e">${esc(r.emoji)}</span><span>${r.count}</span></button>`).join('')}<button type="button" class="rx rx-add" data-react-add title="Add reaction">${I.smile}<span>+</span></button></div>` : ''}
      ${m.reply_count && !opts.thread ? `<button type="button" class="cmsg-replies" data-thread="${esc(m.thread)}">${I.chat.replace('width="18" height="18"', 'width="14" height="14"')}${m.reply_count} ${m.reply_count === 1 ? 'reply' : 'replies'}<span>· last ${timeAgo(m.last_reply.replace(/\.\d+Z$/, 'Z'))}</span></button>` : ''}
    </div>
    ${m.deleted ? '' : `<div class="cmsg-tools">
      <button type="button" data-react-add title="Add reaction">${I.smile}</button>
      ${opts.thread ? '' : `<button type="button" data-thread="${esc(m.thread)}" title="Reply in thread">${I.chat}</button>`}
      ${m.can_edit ? `<button type="button" data-cm-edit title="Edit">${I.edit || '✎'}</button><button type="button" data-cm-del title="Delete">${I.trash || '🗑'}</button>` : ''}
    </div>`}
  </div>`;
}
function chatListHTML(msgs, opts) {
  let out = '', prev = null, day = '';
  for (const m of msgs) {
    const d = chatDay(m.create_time);
    if (d !== day && !opts.thread) { out += `<div class="cday"><span>${esc(d)}</span></div>`; day = d; prev = null; }
    out += chatMsgHTML(m, prev, opts); prev = m;
  }
  return out;
}
function chatComposerHTML(id, placeholder) {
  return `<div class="ccomp" id="${id}">
    <div class="c-tray" hidden></div>
    <div class="ccomp-box"><textarea class="input" rows="1" placeholder="${esc(placeholder)}"></textarea><div class="mention-pop hidden"></div>
      <label class="icon-btn" title="Attach files (or paste / drop them)">${I.clip}<input type="file" multiple hidden></label>
      <button type="button" class="btn sm ccomp-send" title="Send (Enter)">${I.send}</button></div>
    <div class="ccomp-hint">Enter to send · Shift + Enter for a new line · @ to mention</div>
  </div>`;
}
// Wires a composer: files, paste/drop, @mentions of space members, Enter to send. send({text, files}) must return a promise.
function bindChatComposer(root, spaceId, send) {
  const ta = $('textarea', root), tray = $('.c-tray', root), pop = $('.mention-pop', root), btn = $('.ccomp-send', root);
  let files = [], picked = {}, matches = [], idx = 0, start = -1;
  const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`; };
  const drawTray = () => {
    tray.hidden = !files.length;
    tray.innerHTML = files.map((f, i) => f.url ? `<span class="c-thumb" title="${esc(f.file.name)}"><img src="${f.url}" alt=""><button type="button" data-unattach="${i}" aria-label="Remove">${I.x.replace('width="18" height="18"', 'width="11" height="11"')}</button></span>`
      : `<span class="c-filechip">${I.clip.replace('width="18" height="18"', 'width="13" height="13"')}<span>${esc(f.file.name)}</span><button type="button" data-unattach="${i}" aria-label="Remove">${I.x.replace('width="18" height="18"', 'width="11" height="11"')}</button></span>`).join('');
  };
  const add = (list) => {
    const arr = [...list].filter(Boolean); if (!arr.length) return false;
    for (const f of arr) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is over 25 MB`, 'err'); continue; }
      if (files.length >= 10) { toast('Up to 10 files per message', 'err'); break; }
      const name = f.name && f.name !== 'image.png' ? f.name : `Screenshot ${new Date().toLocaleString()}.png`.replace(/[/:]/g, '-');
      const file = name === f.name ? f : new File([f], name, { type: f.type });
      files.push({ file, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : '' });
    }
    drawTray(); return true;
  };
  tray.addEventListener('click', (e) => { const b = e.target.closest('[data-unattach]'); if (!b) return; const f = files.splice(Number(b.dataset.unattach), 1)[0]; if (f?.url) URL.revokeObjectURL(f.url); drawTray(); });
  $('input[type=file]', root).onchange = (e) => { add(e.target.files); e.target.value = ''; ta.focus(); };
  ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()); if (fs.length && add(fs)) e.preventDefault(); });
  root.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); root.classList.add('drop'); } });
  root.addEventListener('dragleave', () => root.classList.remove('drop'));
  root.addEventListener('drop', (e) => { root.classList.remove('drop'); if (e.dataTransfer?.files?.length) { e.preventDefault(); add(e.dataTransfer.files); } });
  // @mentions
  const closePop = () => { pop.classList.add('hidden'); matches = []; };
  const people = async () => chatCache.members[spaceId] || (chatCache.members[spaceId] = await api('GET', `/api/chat/spaces/${spaceId}/members`).catch(() => []));
  const update = async () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/(?:^|\s)@([^\s@]{0,30})$/);
    if (!m) return closePop();
    start = ta.selectionStart - m[1].length - 1;
    const qv = m[1].toLowerCase();
    const list = [{ gid: 'users/all', name: 'all', sub: 'Notify everyone in this space' }, ...(await people())];
    matches = list.filter((p) => !qv || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(qv)) || p.name.toLowerCase().startsWith(qv)).slice(0, 7);
    if (!matches.length) return closePop();
    idx = Math.min(idx, matches.length - 1);
    pop.innerHTML = matches.map((p, i) => `<button type="button" class="${i === idx ? 'on' : ''}" data-i="${i}">${p.gid === 'users/all' ? `<span class="avatar sm">@</span>` : personAv(p)}<span><b>${esc(p.name)}</b><small>${esc(p.sub || '')}</small></span></button>`).join('');
    pop.classList.remove('hidden');
  };
  const pick = (p) => {
    const after = ta.value.slice(ta.selectionStart);
    ta.value = `${ta.value.slice(0, start)}@${p.name} ${after}`;
    picked[`@${p.name}`] = p.gid;
    const caret = start + p.name.length + 2; ta.setSelectionRange(caret, caret); ta.focus(); closePop(); grow();
  };
  pop.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(matches[Number(b.dataset.i)]); } });
  ta.addEventListener('input', () => { idx = 0; update(); grow(); });
  ta.addEventListener('blur', () => setTimeout(closePop, 150));
  const doSend = async () => {
    let text = ta.value.trim();
    if (!text && !files.length) return;
    for (const [label, gid] of Object.entries(picked).sort((a, b) => b[0].length - a[0].length)) text = text.split(label).join(`<${gid}>`);
    btn.disabled = true;
    try {
      await send({ text, files: files.map((f) => f.file) });
      files.forEach((f) => f.url && URL.revokeObjectURL(f.url)); files = []; picked = {}; ta.value = ''; drawTray(); grow();
    } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; ta.focus(); }
  };
  ta.addEventListener('keydown', (e) => {
    if (!pop.classList.contains('hidden') && matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; update(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[idx]); return; }
      if (e.key === 'Escape') { e.stopPropagation(); closePop(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); doSend(); }
  });
  btn.onclick = doSend;
  return { focus: () => ta.focus() };
}
async function chatSend(spaceId, { text, files }, thread) {
  if (files.length) {
    const fd = new FormData(); fd.append('text', text); if (thread) fd.append('thread', thread);
    files.forEach((f) => fd.append('files', f, f.name));
    return api('POST', `/api/chat/spaces/${spaceId}/messages`, fd);
  }
  return api('POST', `/api/chat/spaces/${spaceId}/messages`, { text, thread: thread || '' });
}

async function pageChat(page, [sidParam], alive) {
  setTitle('Chat', 'Your Google Chat spaces and messages — synced both ways');
  const qp = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qp.get('error')) toast(qp.get('error'), 'err');
  if (qp.get('connected')) toast('Google Chat connected — bringing in your spaces now', 'ok');
  if (qp.toString()) history.replaceState(null, '', `#/chat${sidParam ? `/${sidParam}` : ''}`);
  const st = await api('GET', '/api/chat/status');
  if (!alive()) return;
  if (!st.configured) {
    page.innerHTML = `<div class="card chat-setup"><div class="chat-hero-ic">${I.chat}</div><h2>Google Chat isn't set up yet</h2>
      ${isExec() ? `<p class="muted">An admin needs to create the Google connection once. The steps are in the setup guide — when they're done, add <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b> on Render.</p>
        <p class="small muted">Authorized redirect URI to use: <code>${esc(st.redirect_uri || '')}</code></p>`
        : '<p class="muted">Ask an executive to finish the Google Chat setup — then you can connect your account here.</p>'}</div>`;
    return;
  }
  if (!st.connected) {
    page.innerHTML = `<div class="card chat-setup"><div class="chat-hero-ic">${I.chat}</div><h2>Bring your Google Chat into the hub</h2>
      <p class="muted">Connect your @herhauscompany.com Google account once. Your spaces, group chats and direct messages show up here, and anything you send from the hub appears in Google Chat as you.</p>
      <ul class="chat-points"><li>Everything stays in sync both ways</li><li>Your past messages are imported too</li><li>Mentions and DMs ping you here, with sound</li></ul>
      ${st.error ? `<p class="chat-err">${esc(st.error)}</p>` : ''}
      <a class="btn lg" href="/api/google/connect">${I.chat} Connect Google Chat</a>
      <p class="small muted" style="margin-top:12px">You'll be asked to allow access on Google's screen. You can disconnect anytime.</p></div>`;
    return;
  }
  page.classList.add('page-chat');
  page.innerHTML = `<div class="chat-wrap" id="chat-wrap">
    <aside class="chat-side">
      <div class="chat-side-head"><input class="input" id="cs-search" placeholder="Search chats" autocomplete="off"></div>
      <div class="chat-list" id="chat-list"><div class="empty">Loading…</div></div>
      <div class="chat-side-foot"><span title="${esc(st.email || '')}">${I.chat.replace('width="18" height="18"', 'width="13" height="13"')} ${esc(st.email || '')}</span><button class="linkbtn" id="gc-disconnect">Disconnect</button></div>
    </aside>
    <section class="chat-main" id="chat-main"></section>
    <aside class="chat-thread" id="chat-thread" hidden></aside>
  </div>`;
  const wrap = $('#chat-wrap'), listEl = $('#chat-list'), main = $('#chat-main'), threadEl = $('#chat-thread');
  let spaces = [], current = null, msgs = [], more = false, historyDone = true, loadingOlder = false, thread = null, threadMsgs = [];
  let myGid = '', search = '';
  const fit = () => { const top = wrap.getBoundingClientRect().top; wrap.style.height = `${Math.max(420, innerHeight - top - 18)}px`; };
  fit(); window.addEventListener('resize', fit);

  const drawList = () => {
    const f = search.toLowerCase();
    const shown = spaces.filter((s) => !f || s.title.toLowerCase().includes(f));
    const sec = (label, items) => items.length ? `<div class="cl-label">${label}</div>${items.map((s) => `
      <a class="cl-item ${current && s.id === current.id ? 'on' : ''} ${s.unread ? 'unread' : ''}" href="#/chat/${s.id}">
        <span class="cl-av">${spaceAv(s, 'sm')}</span>
        <span class="cl-main"><span class="cl-top"><b>${esc(s.title)}</b><time>${s.last_active ? chatClock(s.last_active) : ''}</time></span>
          <span class="cl-prev">${s.preview ? `${s.preview.who ? `${esc(s.preview.who)}: ` : ''}${esc(chatPlain(s.preview.text))}` : '<i>No messages yet</i>'}</span></span>
        ${s.unread ? `<span class="cl-badge">${s.unread > 99 ? '99+' : s.unread}</span>` : ''}</a>`).join('')}` : '';
    listEl.innerHTML = spaces.length
      ? (sec('Spaces', shown.filter((s) => s.type === 'SPACE')) + sec('Direct messages', shown.filter((s) => s.type !== 'SPACE')) || '<div class="empty">No matches</div>')
      : `<div class="empty">${st.syncing || !st.last_sync ? 'Bringing in your spaces…' : 'No Google Chat spaces found for this account.'}</div>`;
  };
  const loadSpaces = async () => {
    try { spaces = await api('GET', '/api/chat/spaces'); } catch (_) { return; }
    if (!alive()) return;
    if (current) current = spaces.find((s) => s.id === current.id) || current;
    drawList();
    if (!current && sidParam) openSpace(Number(sidParam));
  };
  $('#cs-search').oninput = (e) => { search = e.target.value; drawList(); };
  $('#gc-disconnect').onclick = async () => {
    if (!await confirmModal('Disconnect your Google account? Your Google Chat is not affected — the hub just stops syncing it for you.', { okLabel: 'Disconnect' })) return;
    await api('POST', '/api/google/disconnect', {}); route();
  };

  const msgBox = () => $('#cm-msgs', main);
  const atBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  const drawMsgs = (keep) => {
    const box = msgBox(); if (!box) return;
    const wasBottom = atBottom(box), fromBottom = box.scrollHeight - box.scrollTop;
    const top = more ? `<div class="cm-top">${loadingOlder ? 'Loading older messages…' : historyDone ? '<button class="linkbtn" data-older>Load older messages</button>' : 'Older history is still importing from Google Chat…'}</div>`
      : `<div class="cm-top start">${spaceAv(current, 'lg')}<b>${esc(current.title)}</b><span>This is the beginning of the conversation.</span></div>`;
    box.innerHTML = top + chatListHTML(msgs, { myGid });
    if (keep === 'older') box.scrollTop = box.scrollHeight - fromBottom;
    else if (keep === 'bottom' || wasBottom) box.scrollTop = box.scrollHeight;
    $$('img', box).forEach((img) => img.addEventListener('load', () => { if (keep === 'bottom' || wasBottom) box.scrollTop = box.scrollHeight; }, { once: true }));
  };
  const merge = (list, incoming) => {
    const byId = new Map(list.map((m) => [m.id, m]));
    incoming.forEach((m) => byId.set(m.id, m));
    return [...byId.values()].sort((a, b) => (a.create_time < b.create_time ? -1 : a.create_time > b.create_time ? 1 : a.id - b.id));
  };
  const markRead = () => { if (current && !document.hidden) api('POST', `/api/chat/spaces/${current.id}/read`, {}).then(() => { const s = spaces.find((x) => x.id === current.id); if (s && s.unread) { s.unread = 0; drawList(); } pollNotifications(); }).catch(() => {}); };

  async function openSpace(sid) {
    const s = spaces.find((x) => x.id === sid);
    if (!s) { if (spaces.length) toast('That conversation isn’t available', 'err'); return; }
    current = s; msgs = []; thread = null; threadEl.hidden = true; wrap.classList.add('has-open'); wrap.classList.remove('has-thread');
    drawList();
    main.innerHTML = `<header class="cm-head">
        <button class="icon-btn cm-back" id="cm-back" aria-label="Back to chats">‹</button>
        ${spaceAv(s, 'sm')}<div class="cm-title"><b>${esc(s.title)}</b><span>${s.type === 'SPACE' ? 'Space' : s.type === 'GROUP_CHAT' ? 'Group chat' : 'Direct message'}${s.client ? ` · <a href="#/board/${s.client.id}"><span class="client-dot" style="background:${esc(s.client.color)}"></span>${esc(s.client.name)}</a>` : ''}</span></div>
        <div class="cm-actions">
          ${isExec() && s.type !== 'DIRECT_MESSAGE' ? `<select class="input sm" id="cm-client" title="Link this chat to a client board"><option value="">Link to client…</option>${S.clients.map((c) => `<option value="${c.id}" ${s.client && s.client.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
          <a class="btn sm ghost cm-open" href="${esc(s.web_link)}" target="_blank" rel="noopener" title="Open in Google Chat">${I.ext || '↗'}<span>Google Chat</span></a></div></header>
      <div class="cm-msgs" id="cm-msgs"><div class="empty">Loading…</div></div>
      ${chatComposerHTML('cm-comp', `Message ${s.type === 'DIRECT_MESSAGE' ? s.title : s.title}`)}`;
    $('#cm-back').onclick = () => { wrap.classList.remove('has-open'); location.hash = '#/chat'; };
    if ($('#cm-client')) $('#cm-client').onchange = async (e) => {
      try { await api('PUT', `/api/chat/spaces/${s.id}/client`, { client_id: e.target.value || null }); toast(e.target.value ? 'Linked — the client board now has a Chat button' : 'Unlinked', 'ok'); loadSpaces(); } catch (err) { toast(err.message, 'err'); }
    };
    const comp = bindChatComposer($('#cm-comp', main), s.id, async (payload) => {
      const m = await chatSend(s.id, payload); msgs = merge(msgs, [m]); drawMsgs('bottom'); loadSpaces();
    });
    comp.focus();
    const r = await api('GET', `/api/chat/spaces/${s.id}/messages?live=1`);
    if (!alive() || current !== s) return;
    msgs = r.messages; more = r.more; historyDone = r.history_done !== false;
    myGid = (msgs.find((m) => m.sender.is_me) || {}).sender?.gid || myGid;
    drawMsgs('bottom'); markRead();
  }
  const loadOlder = async () => {
    if (loadingOlder || !more || !msgs.length || !historyDone) return;
    loadingOlder = true; drawMsgs('older');
    try {
      const r = await api('GET', `/api/chat/spaces/${current.id}/messages?before=${encodeURIComponent(msgs[0].create_time)}`);
      msgs = merge(msgs, r.messages); more = r.more; historyDone = r.history_done !== false;
    } finally { loadingOlder = false; drawMsgs('older'); }
  };
  async function openThread(name) {
    thread = name; threadEl.hidden = false; wrap.classList.add('has-thread');
    threadEl.innerHTML = `<header class="ct-head"><b>Thread</b><span class="muted small">${esc(current.title)}</span><button class="icon-btn" id="ct-close" aria-label="Close thread">${I.x}</button></header>
      <div class="ct-msgs" id="ct-msgs"><div class="empty">Loading…</div></div>${chatComposerHTML('ct-comp', 'Reply in thread')}`;
    $('#ct-close').onclick = () => { thread = null; threadEl.hidden = true; wrap.classList.remove('has-thread'); };
    bindChatComposer($('#ct-comp', threadEl), current.id, async (payload) => {
      const m = await chatSend(current.id, payload, name); threadMsgs = merge(threadMsgs, [m]); drawThread(true);
      const top = msgs.find((x) => x.thread === name && !x.thread_reply); if (top) { top.reply_count += 1; top.last_reply = m.create_time; drawMsgs(); }
    }).focus();
    await loadThread(true);
  }
  const drawThread = (bottom) => {
    const box = $('#ct-msgs', threadEl); if (!box) return;
    const wasBottom = atBottom(box);
    const [first, ...rest] = threadMsgs;
    box.innerHTML = first ? chatListHTML([first], { myGid, thread: true }) + `<div class="ct-sep"><span>${rest.length} ${rest.length === 1 ? 'reply' : 'replies'}</span></div>` + chatListHTML(rest, { myGid, thread: true }) : '<div class="empty">This thread is empty.</div>';
    if (bottom || wasBottom) box.scrollTop = box.scrollHeight;
  };
  const loadThread = async (bottom) => {
    if (!thread) return;
    const name = thread;
    const r = await api('GET', `/api/chat/spaces/${current.id}/messages?thread=${encodeURIComponent(name)}`).catch(() => null);
    if (!r || thread !== name || !alive()) return;
    threadMsgs = r.messages; drawThread(bottom);
  };

  // clicks inside the conversation and thread panes
  const onMsgClick = async (e, inThread) => {
    const node = e.target.closest('[data-mid]');
    const list = inThread ? threadMsgs : msgs;
    const m = node && list.find((x) => x.id === Number(node.dataset.mid));
    const img = e.target.closest('[data-chat-img]');
    if (img) { lightbox(img.dataset.chatImg, img.title, `${img.dataset.chatImg}?download=1`); return; }
    if (e.target.closest('[data-older]')) { loadOlder(); return; }
    const th = e.target.closest('[data-thread]');
    if (th && !inThread) { openThread(th.dataset.thread); return; }
    if (!m) return;
    const update = (u) => { const fix = (arr) => arr.map((x) => (x.id === u.id ? { ...u, reply_count: x.reply_count, last_reply: x.last_reply } : x)); msgs = fix(msgs); threadMsgs = fix(threadMsgs); drawMsgs(); drawThread(); };
    const react = async (emoji) => { try { update(await api('POST', `/api/chat/messages/${m.id}/reactions`, { emoji })); } catch (err) { toast(err.message, 'err'); } };
    const rx = e.target.closest('[data-react]'), add = e.target.closest('[data-react-add]');
    if (rx) { react(rx.dataset.react); return; }
    if (add) { emojiPicker(add, react); return; }
    if (e.target.closest('[data-cm-del]')) {
      if (!await confirmModal('Delete this message? It will be deleted in Google Chat too.')) return;
      try { await api('DELETE', `/api/chat/messages/${m.id}`); update({ ...m, deleted: true, text: '', attachments: [], reactions: [] }); } catch (err) { toast(err.message, 'err'); }
      return;
    }
    if (e.target.closest('[data-cm-edit]')) {
      const body = $('.cmsg-body', node) || $('.cmsg-main', node);
      body.innerHTML = `<div class="cm-edit"><textarea class="input" rows="2">${esc(m.text)}</textarea><div class="row" style="justify-content:flex-end;gap:6px;margin-top:6px"><button class="btn sm ghost" data-x>Cancel</button><button class="btn sm" data-ok>Save</button></div></div>`;
      const ta = $('textarea', body); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      $('[data-x]', body).onclick = (ev) => { ev.stopPropagation(); drawMsgs(); drawThread(); };
      $('[data-ok]', body).onclick = async (ev) => {
        ev.stopPropagation();
        try { update(await api('PUT', `/api/chat/messages/${m.id}`, { text: ta.value })); } catch (err) { toast(err.message, 'err'); }
      };
    }
  };
  main.addEventListener('click', (e) => onMsgClick(e, false));
  threadEl.addEventListener('click', (e) => onMsgClick(e, true));
  main.addEventListener('scroll', (e) => { if (e.target.id === 'cm-msgs' && e.target.scrollTop < 80) loadOlder(); }, true);

  // live updates: the open conversation every 4s (the server re-reads it from Google), the chat list every 10s
  let ticks = 0;
  const timer = setInterval(async () => {
    if (!alive()) { clearInterval(timer); window.removeEventListener('resize', fit); return; }
    if (document.hidden) return;
    ticks++;
    if (current) {
      const s = current;
      const r = await api('GET', `/api/chat/spaces/${s.id}/messages?live=1`).catch(() => null);
      if (r && current === s && !$('.cm-edit', main)) {
        const before = msgs.length ? msgs[msgs.length - 1].id : 0;
        const changed = JSON.stringify(r.messages) !== JSON.stringify(msgs.slice(-r.messages.length));
        msgs = merge(msgs, r.messages);
        if (!myGid) myGid = (msgs.find((m) => m.sender.is_me) || {}).sender?.gid || '';
        if (changed) { drawMsgs(); if (msgs.length && msgs[msgs.length - 1].id !== before) markRead(); }
      }
      if (thread && !$('.cm-edit', threadEl)) loadThread(false);
    }
    if (ticks % 3 === 0) loadSpaces();
  }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && alive()) markRead(); });

  await loadSpaces();
  if (sidParam && spaces.length) openSpace(Number(sidParam));
  else if (!sidParam) main.innerHTML = `<div class="cm-empty">${I.chat}<b>Pick a conversation</b><span>Your Google Chat spaces and direct messages are on the left.</span></div>`;
  if (!spaces.length) {   // first import still running: check again shortly
    const wait = setInterval(async () => { if (!alive()) return clearInterval(wait); await loadSpaces(); if (spaces.length) { clearInterval(wait); if (sidParam) openSpace(Number(sidParam)); } }, 3000);
  }
}

boot();
