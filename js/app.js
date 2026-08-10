/**
 * View logic: sign-in, connect a spreadsheet, log/edit entries, day summary,
 * the today-and-yesterday list, and the stats tab.
 */

import * as g from './google.js';
import * as store from './store.js';
import { renderStats } from './stats.js';
import {
  fmtMin, fmtTime, fmtDay, agoDur, elapsedMin, toLocalInput, fromLocalInput,
} from './format.js';

const TYPES = {
  feed:   { label: 'Breastfeed',        short: 'Breast',  emoji: '🤱', timed: true },
  bottle: { label: 'Bottle',            short: 'Bottle',  emoji: '🍼', timed: false },
  sleep:  { label: 'Sleep',             short: 'Sleep',   emoji: '😴', timed: true },
  play:   { label: 'Play / tummy time', short: 'Play',    emoji: '🧸', timed: true },
  pump:   { label: 'Pump',              short: 'Pump',    emoji: '🥛', timed: false },
  wet:    { label: 'Wet nappy',         short: 'Wet',     emoji: '💧', timed: false },
  dirty:  { label: 'Dirty nappy',       short: 'Dirty',   emoji: '💩', timed: false },
};

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-config', 'view-signin', 'view-connect', 'view-app'];

const SHEET_KEY = 'bt.sheetId';
let sheetId = localStorage.getItem(SHEET_KEY) || '';
let events = [];
let settings = { ...store.DEFAULT_SETTINGS };
let userEmail = '';
let statsRange = 14;
let editing = null;
let tick = null;

function show(view) {
  VIEWS.forEach((v) => { $(v).hidden = v !== view; });
}

function setStatus(id, text, isError = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('error', isError);
}

const numVal = (el) => {
  const v = el.value.trim();
  return v === '' ? null : Number(v);
};

// ---------- demo mode: open index.html?demo for a design preview ----------

const DEMO = new URLSearchParams(location.search).has('demo');

function demoEvents() {
  const out = [];
  const now = Date.now();
  const h = 3600000;
  let id = 0;
  const add = (type, agoH, o = {}) => {
    const startMs = now - agoH * h;
    const durationMin = o.durationMin != null ? o.durationMin : null;
    out.push({
      row: 0, id: 'demo-' + (id++), type, startMs,
      endMs: o.open ? null : durationMin != null ? startMs + durationMin * 60000 : null,
      durationMin, side: o.side || '',
      amountMl: o.amountMl != null ? o.amountMl : null,
      notes: o.notes || '', loggedBy: 'demo@example.com',
      formulaMl: o.formulaMl != null ? o.formulaMl : null,
    });
  };
  add('feed', 0.3, { open: true, side: 'L' }); // running now
  for (let d = 0; d < 30; d++) {
    for (let t = 1; t < 24; t += 3) {
      const ago = d * 24 + t;
      add('feed', ago, { durationMin: 12 + ((t + d) % 4) * 6, side: t % 2 ? 'L' : 'R' });
      if (t % 6 === 1) add('wet', ago - 0.4);
      if (t % 9 === 4) add('dirty', ago - 0.6, { notes: d === 0 ? 'Mucus' : '' });
    }
    add('bottle', d * 24 + 9.5, { amountMl: 60, formulaMl: 30 });
    add('pump', d * 24 + 13, { amountMl: 40 + (d % 3) * 10 });
    add('sleep', d * 24 + 4, { durationMin: 150 });
    add('play', d * 24 + 11, { durationMin: 25 });
  }
  out.sort((a, b) => b.startMs - a.startMs);
  return out;
}

// ---------- boot ----------

async function boot() {
  if (DEMO) {
    events = demoEvents();
    show('view-app');
    $('sheetLink').hidden = true;
    render();
    if (new URLSearchParams(location.search).get('tab') === 'stats') switchTab('stats');
    if (!tick) tick = setInterval(render, 30000);
    return;
  }
  if (!g.isConfigured()) { show('view-config'); return; }
  show('view-signin');
  setStatus('signinStatus', 'Checking sign-in…');
  const token = await g.signInSilent();
  setStatus('signinStatus', '');
  if (token) afterSignIn();
}

$('signinBtn').onclick = async () => {
  try {
    setStatus('signinStatus', 'Opening Google sign-in…');
    await g.signIn();
    setStatus('signinStatus', '');
    afterSignIn();
  } catch (err) {
    setStatus('signinStatus', 'Sign-in failed: ' + err.message, true);
  }
};

async function afterSignIn() {
  g.fetchUserEmail().then((email) => { userEmail = email; });
  if (sheetId) {
    show('view-app');
    loadData();
  } else {
    show('view-connect');
  }
}

// ---------- connect ----------

$('createBtn').onclick = async () => {
  try {
    setStatus('connectStatus', 'Creating your tracker sheet…');
    connectSheet(await store.createTrackerSheet());
  } catch (err) {
    setStatus('connectStatus', 'Could not create the sheet: ' + err.message, true);
  }
};

$('pickBtn').onclick = async () => {
  try {
    const picked = await g.pickSpreadsheet();
    if (!picked) return;
    setStatus('connectStatus', 'Checking the sheet…');
    const shape = await store.inspectSheet(picked);
    if (shape !== 'ok') {
      setStatus('connectStatus',
        "That spreadsheet doesn't look like a Baby Tracker sheet. " +
        'Pick the one shared with you, or create a new one instead.', true);
      return;
    }
    connectSheet(picked);
  } catch (err) {
    setStatus('connectStatus', err.message, true);
  }
};

function connectSheet(id) {
  sheetId = id;
  localStorage.setItem(SHEET_KEY, id);
  setStatus('connectStatus', '');
  show('view-app');
  loadData();
}

// ---------- data ----------

async function loadData() {
  if (DEMO) { render(); return; }
  $('sheetLink').href = store.sheetUrl(sheetId);
  if (!events.length) setStatus('appStatus', 'Loading…');
  try {
    const state = await store.fetchState(sheetId);
    events = state.events;
    settings = state.settings;
    setStatus('appStatus', events.length ? '' : 'Nothing logged yet — add the first entry above.');
    render();
    if (!tick) tick = setInterval(render, 30000); // keep timers and "ago" fresh
  } catch (err) {
    if (err instanceof g.NeedsSignIn) { show('view-signin'); return; }
    setStatus('appStatus', 'Failed to load: ' + err.message, true);
  }
}

/** Run a write, then refetch. Errors surface as alerts, state stays intact. */
async function busy(fn) {
  if (DEMO) { alert('Demo mode — changes are not saved.'); return false; }
  setStatus('appStatus', 'Saving…');
  try {
    await fn();
    await loadData();
    return true;
  } catch (err) {
    if (err instanceof g.NeedsSignIn) { show('view-signin'); return false; }
    setStatus('appStatus', '');
    alert(err.message || err);
    return false;
  }
}

$('refreshBtn').onclick = loadData;

$('switchBtn').onclick = () => {
  localStorage.removeItem(SHEET_KEY);
  sheetId = '';
  events = [];
  show('view-connect');
};

$('signoutBtn').onclick = () => {
  g.signOut();
  show('view-signin');
};

// ---------- tabs ----------

$('tabLog').onclick = () => switchTab('log');
$('tabStats').onclick = () => switchTab('stats');
function switchTab(which) {
  $('tabLog').classList.toggle('on', which === 'log');
  $('tabStats').classList.toggle('on', which === 'stats');
  $('logView').hidden = which !== 'log';
  $('statsView').hidden = which !== 'stats';
  if (which === 'stats') renderStats(events, settings, statsRange);
}

$('rangeSeg').querySelectorAll('button').forEach((b) => {
  b.onclick = () => {
    statsRange = Number(b.dataset.r);
    $('rangeSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderStats(events, settings, statsRange);
  };
});

// ---------- quick log ----------

$('mType').innerHTML = Object.entries(TYPES)
  .map(([k, t]) => `<option value="${k}">${t.emoji} ${t.label}</option>`).join('');

const ALL_TYPES = Object.keys(TYPES);

/** Activity types shown in the UI, from the shared enabled_types setting. */
function enabledTypes() {
  const raw = String(settings.enabled_types || '').trim();
  if (!raw) return new Set(ALL_TYPES);
  const set = new Set(raw.split(',').map((s) => s.trim()).filter((k) => TYPES[k]));
  return set.size ? set : new Set(ALL_TYPES);
}

let curType = 'feed';
function buildTypeGrid() {
  const en = enabledTypes();
  if (!en.has(curType)) curType = en.values().next().value;
  const grid = $('typeGrid');
  grid.innerHTML = Object.entries(TYPES)
    .filter(([k]) => en.has(k))
    .map(([k, t]) =>
      `<button class="type-btn${k === curType ? ' on' : ''}" data-type="${k}">` +
      `<span class="icn t-${k}">${t.emoji}</span><span>${t.short}</span></button>`).join('');
  grid.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { curType = b.dataset.type; buildTypeGrid(); syncForm(); };
  });
}
buildTypeGrid();

function segSetup(segEl) {
  segEl.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const on = b.classList.contains('on');
      segEl.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      if (!on) b.classList.add('on');
    };
  });
}
const segValue = (segEl) => segEl.querySelector('button.on')?.dataset.side || '';
const segSet = (segEl, v) =>
  segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.side === v));
segSetup($('sideSeg'));
segSetup($('mSideSeg'));

function syncForm() {
  const type = curType;
  const t = TYPES[type];
  const earlier = $('earlier').checked;
  $('sideSeg').hidden = type !== 'feed';
  $('bottleExtras').hidden = type !== 'bottle';
  $('amountWrap').hidden = type !== 'pump';
  $('earlierFields').hidden = !earlier;
  $('durWrap').hidden = !t.timed;
  $('goBtn').textContent = earlier ? 'Save' : (t.timed ? 'Start ' + t.label.toLowerCase() : 'Log now');
}
$('earlier').onchange = () => {
  if ($('earlier').checked && !$('startInput').value) {
    $('startInput').value = toLocalInput(Date.now());
  }
  syncForm();
};
syncForm();

$('goBtn').onclick = async () => {
  const type = curType;
  const t = TYPES[type];
  const earlier = $('earlier').checked;
  const p = { type, notes: $('notes').value.trim() };
  if (type === 'feed') p.side = segValue($('sideSeg'));
  if (type === 'bottle') { p.amountMl = numVal($('bottleBm')); p.formulaMl = numVal($('bottleF')); }
  if (type === 'pump') p.amountMl = numVal($('amount'));
  if (earlier) {
    const startMs = fromLocalInput($('startInput').value);
    if (startMs == null) { alert('Please pick when it happened.'); return; }
    p.startMs = startMs;
    const dur = numVal($('durInput'));
    if (t.timed && (dur == null || !(dur > 0))) {
      alert('Please enter the duration in minutes.'); return;
    }
    if (dur != null) p.durationMin = dur;
  } else if (t.timed && events.some((e) => e.type === type && !e.endMs)) {
    if (!confirm(`A ${t.label.toLowerCase()} is already running. Start another?`)) return;
  }
  if (await busy(() => store.addEvent(sheetId, p, userEmail))) resetForm();
};

function resetForm() {
  segSet($('sideSeg'), '');
  ['bottleBm', 'bottleF', 'amount', 'notes', 'startInput', 'durInput']
    .forEach((id) => { $(id).value = ''; });
  $('earlier').checked = false;
  syncForm();
}

// ---------- render ----------

function render() {
  const now = Date.now();
  $('topDate').textContent = new Date().toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'long' });
  // the list covers today and the whole of yesterday
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoff = yesterday.getTime();
  const isTimed = (e) => (TYPES[e.type] || {}).timed;
  const recent = events.filter((e) =>
    e.startMs >= cutoff || (e.endMs && e.endMs >= cutoff) || (isTimed(e) && !e.endMs));
  buildTypeGrid(); // reflect the enabled-activities setting
  syncForm();
  renderOpen(recent.filter((e) => isTimed(e) && !e.endMs), now);
  renderSummary(now);
  renderList(recent, now);
  if (!$('statsView').hidden) renderStats(events, settings, statsRange);
}

function renderOpen(open, now) {
  const box = $('openList');
  box.innerHTML = '';
  open.forEach((e) => {
    const t = TYPES[e.type] || { label: e.type, emoji: '❓' };
    const card = document.createElement('div');
    card.className = 'open-card';
    card.innerHTML = `<span class="icn t-${e.type}">${t.emoji}</span>` +
      `<div class="grow"><div class="t-label">${t.label}${e.side ? ' · ' + e.side : ''}</div>` +
      `<div class="t-sub"><span class="live-dot"></span>started ${fmtTime(e.startMs)}</div></div>` +
      `<div class="t-elapsed">${fmtMin(elapsedMin(e, now))}</div>`;
    const btn = document.createElement('button');
    btn.className = 'stop-btn';
    btn.textContent = 'Stop';
    btn.onclick = () => busy(() => store.stopEvent(sheetId, e, Date.now()));
    card.appendChild(btn);
    box.appendChild(card);
  });
}

function overlapMin(e, fromMs, now) {
  const end = Math.min(e.endMs || now, now);
  const start = Math.max(e.startMs, fromMs);
  return Math.max(0, Math.round((end - start) / 60000));
}

function renderSummary(now) {
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  const isTimed = (e) => (TYPES[e.type] || {}).timed;
  const isToday = (e) => e.startMs >= dayStartMs ||
    (e.endMs && e.endMs >= dayStartMs) || (isTimed(e) && !e.endMs);
  const todayOf = (t) => events.filter((e) => e.type === t && isToday(e));
  const allOf = (t) => events.filter((e) => e.type === t); // newest first
  const openFeed = events.some((e) => e.type === 'feed' && !e.endMs);

  const rows = [];
  const pushRow = (emoji, label, ago, parts) => {
    const v = parts.filter(Boolean).join(' · ');
    if (!v && !ago) return;
    rows.push(`<div class="sum-row"><span>${emoji}</span><span class="lbl">${label}` +
      (ago ? ` <span class="ago">· ${ago}</span>` : '') +
      `</span><span class="v">${v}</span></div>`);
  };
  const pushSub = (label, v) => rows.push(
    `<div class="sum-row sub"><span class="lbl">${label}</span><span class="v">${v}</span></div>`);

  const assumedMl = Number(settings.breastfeed_ml) || 60;
  const en = enabledTypes();
  const feeds = todayOf('feed');
  const bottles = todayOf('bottle');

  // when were breasts last emptied (breastfeed or pump, whichever is later)
  if (en.has('feed') || en.has('pump')) {
    const lastEmpty = events.find((e) => e.type === 'feed' || e.type === 'pump');
    pushRow('🤱', 'Breasts emptied', '',
      [openFeed ? 'feeding now'
        : lastEmpty ? agoDur(lastEmpty.startMs, now) + (lastEmpty.type === 'pump' ? ' (pump)' : ' (feed)')
        : '—']);
  }

  // when the baby last ate (breastfeed or bottle, whichever is later)
  if (en.has('feed') || en.has('bottle')) {
    const lastAte = events.find((e) => e.type === 'feed' || e.type === 'bottle');
    pushRow('👶', 'Last ate', '',
      [openFeed ? 'feeding now'
        : lastAte ? agoDur(lastAte.startMs, now) + (lastAte.type === 'bottle' ? ' (bottle)' : ' (breast)')
        : '—']);
  }

  // total milk taken today, breastfeeds counted at the assumed amount
  const bmMl = bottles.reduce((a, e) => a + (e.amountMl || 0), 0);
  const formulaMl = bottles.reduce((a, e) => a + (e.formulaMl || 0), 0);
  const breastfedMl = feeds.length * assumedMl;
  const totalMl = bmMl + formulaMl + breastfedMl;
  pushRow('🍽️', 'Milk today', '', [totalMl ? `≈${totalMl}ml` : '']);
  if (feeds.length) pushSub('Breastfed', `${feeds.length}× · ≈${breastfedMl}ml`);
  if (bmMl) pushSub('Pumped milk', `${bmMl}ml`);
  if (formulaMl) pushSub('Formula', `${formulaMl}ml`);

  const sleeps = todayOf('sleep');
  if (en.has('sleep') || sleeps.length) {
    const sleepsAll = allOf('sleep');
    const sleepingNow = sleepsAll.some((e) => !e.endMs);
    const lastWake = sleepsAll.find((e) => e.endMs);
    const sleepMin = sleeps.reduce((a, e) => a + overlapMin(e, dayStartMs, now), 0);
    pushRow('😴', 'Sleep',
      sleepingNow ? 'sleeping now'
        : lastWake ? 'awake for ' + fmtMin(Math.max(0, Math.floor((now - lastWake.endMs) / 60000))) : '',
      [sleepMin ? fmtMin(sleepMin) : '']);
  }

  const plays = todayOf('play');
  if (en.has('play') || plays.length) {
    const lastPlay = allOf('play')[0];
    const playMin = plays.reduce((a, e) => a + overlapMin(e, dayStartMs, now), 0);
    pushRow('🧸', 'Play',
      lastPlay ? (!lastPlay.endMs ? 'playing now' : 'last ' + agoDur(lastPlay.startMs, now)) : '',
      [playMin ? fmtMin(playMin) : '']);
  }

  const pumps = todayOf('pump');
  if (en.has('pump') || pumps.length) {
    const lastPump = allOf('pump')[0];
    const pumpMl = pumps.reduce((a, e) => a + (e.amountMl || 0), 0);
    pushRow('🥛', 'Pumped',
      lastPump ? 'last ' + agoDur(lastPump.startMs, now) : '',
      [pumps.length ? `${pumps.length}×` : '', pumpMl ? `${pumpMl}ml` : '']);
  }

  const wet = todayOf('wet').length;
  const dirty = todayOf('dirty').length;
  if (en.has('wet') || en.has('dirty') || wet || dirty) {
    const lastNappy = events.find((e) => e.type === 'wet' || e.type === 'dirty');
    pushRow('💧💩', 'Nappies',
      lastNappy ? 'last ' + agoDur(lastNappy.startMs, now) : '',
      [(wet || dirty) ? `${wet} wet · ${dirty} dirty` : '']);
  }

  if (en.has('feed')) {
    rows.push(`<div class="sum-note" id="bfNote">1 breastfeed ≈ ${assumedMl}ml — tap to change</div>`);
  }
  $('summary').innerHTML = rows.join('');
  const note = $('bfNote');
  if (note) note.onclick = openSettings;
}

// ---------- settings ----------

let sSelected = new Set();

function openSettings() {
  $('sBfMl').value = Number(settings.breastfeed_ml) || 60;
  sSelected = enabledTypes();
  buildSettingsGrid();
  $('settingsOverlay').hidden = false;
}

function buildSettingsGrid() {
  const grid = $('sTypeGrid');
  grid.innerHTML = Object.entries(TYPES).map(([k, t]) =>
    `<button class="type-btn${sSelected.has(k) ? ' on' : ''}" data-type="${k}">` +
    `<span class="icn t-${k}">${t.emoji}</span><span>${t.short}</span></button>`).join('');
  grid.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.type;
      if (sSelected.has(k)) sSelected.delete(k); else sSelected.add(k);
      buildSettingsGrid();
    };
  });
}

$('settingsBtn').onclick = openSettings;
$('sCancel').onclick = () => { $('settingsOverlay').hidden = true; };
$('settingsOverlay').onclick = (ev) => {
  if (ev.target === $('settingsOverlay')) $('settingsOverlay').hidden = true;
};

$('sSave').onclick = async () => {
  const n = Number($('sBfMl').value);
  if (!(n > 0)) { alert('Please enter the nursing amount in ml.'); return; }
  if (!sSelected.size) { alert('Keep at least one activity visible.'); return; }
  const list = ALL_TYPES.filter((k) => sSelected.has(k)).join(',');
  const ok = await busy(async () => {
    await store.setSetting(sheetId, 'breastfeed_ml', n);
    await store.setSetting(sheetId, 'enabled_types', list);
  });
  if (ok) $('settingsOverlay').hidden = true;
};

function eventDetails(e) {
  const parts = [];
  if (e.side) parts.push(e.side === 'both' ? 'both sides' : (e.side === 'L' ? 'left' : e.side === 'R' ? 'right' : e.side));
  if (e.type === 'bottle') {
    if (e.amountMl) parts.push(`${e.amountMl}ml b`);
    if (e.formulaMl) parts.push(`${e.formulaMl}ml f`);
  } else if (e.amountMl) {
    parts.push(`${e.amountMl}ml`);
  }
  if (e.notes) parts.push(e.notes);
  if (e.loggedBy) parts.push('by ' + e.loggedBy.split('@')[0]);
  return parts.join(' · ');
}

function renderList(recent, now) {
  const box = $('todayList');
  box.innerHTML = '';
  let lastDayLabel = '';
  for (const e of recent) {
    const dayLabel = fmtDay(e.startMs);
    if (dayLabel !== lastDayLabel) {
      const sep = document.createElement('div');
      sep.className = 'day-sep';
      sep.textContent = dayLabel;
      box.appendChild(sep);
      lastDayLabel = dayLabel;
    }
    const t = TYPES[e.type] || { label: e.type, emoji: '❓', timed: false };
    const running = t.timed && !e.endMs;
    const dur = running ? fmtMin(elapsedMin(e, now)) + '…'
      : e.durationMin != null ? fmtMin(e.durationMin) : '';
    const item = document.createElement('div');
    item.className = 'evt';
    item.innerHTML = `<span class="icn t-${e.type}">${t.emoji}</span>` +
      `<div class="grow"><div class="e-label">${t.label}</div>` +
      `<div class="e-sub">${eventDetails(e)}</div></div>` +
      `<div class="e-time"><b>${fmtTime(e.startMs)}</b>${dur}</div>`;
    item.onclick = () => openEdit(e);
    box.appendChild(item);
  }
}

// ---------- edit modal ----------

function syncModal() {
  const type = $('mType').value;
  const t = TYPES[type] || { timed: false };
  $('mSideSeg').hidden = type !== 'feed';
  $('mBottleExtras').hidden = type !== 'bottle';
  $('mAmountWrap').hidden = type !== 'pump';
  $('mDurWrap').hidden = !t.timed;
}
$('mType').onchange = syncModal;

function openEdit(e) {
  editing = e;
  $('mType').value = e.type;
  segSet($('mSideSeg'), e.side || '');
  $('mBottleBm').value = e.type === 'bottle' && e.amountMl != null ? e.amountMl : '';
  $('mBottleF').value = e.formulaMl != null ? e.formulaMl : '';
  $('mAmount').value = e.type === 'pump' && e.amountMl != null ? e.amountMl : '';
  $('mStart').value = e.startMs != null ? toLocalInput(e.startMs) : '';
  $('mDur').value = e.durationMin != null ? e.durationMin : '';
  $('mNotes').value = e.notes || '';
  syncModal();
  $('overlay').hidden = false;
}

function closeModal() { $('overlay').hidden = true; editing = null; }
$('mCancel').onclick = closeModal;
$('overlay').onclick = (ev) => { if (ev.target === $('overlay')) closeModal(); };

$('mSave').onclick = async () => {
  if (!editing) return;
  const type = $('mType').value;
  const t = TYPES[type] || { timed: false };
  const startMs = fromLocalInput($('mStart').value);
  if (startMs == null) { alert('Please set a valid start time.'); return; }
  const dur = numVal($('mDur'));
  const p = {
    id: editing.id, row: editing.row, type, startMs,
    notes: $('mNotes').value.trim(),
    side: type === 'feed' ? segValue($('mSideSeg')) : '',
  };
  if (t.timed) {
    if (dur != null) p.durationMin = dur; // empty = reopen (running again)
  } else if (editing.type === type && editing.durationMin != null) {
    p.durationMin = editing.durationMin; // preserve legacy timed data
  }
  if (type === 'bottle') {
    p.amountMl = numVal($('mBottleBm'));
    p.formulaMl = numVal($('mBottleF'));
  } else if (type === 'pump') {
    p.amountMl = numVal($('mAmount'));
  } else if (editing.type === type) {
    p.amountMl = editing.amountMl; // e.g. legacy feed amounts
    p.formulaMl = editing.formulaMl;
  }
  const ok = await busy(() => store.updateEvent(sheetId, p));
  if (ok) closeModal();
};

$('mDelete').onclick = async () => {
  if (!editing || !confirm('Delete this entry?')) return;
  const ok = await busy(() => store.deleteEvent(sheetId, editing));
  if (ok) closeModal();
};

// ---------- PWA ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
