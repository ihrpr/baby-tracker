/**
 * View logic. Phase 1: sign-in, connect a spreadsheet, and a read-only
 * tracker view (running activities, day summary, last 24 hours).
 */

import * as g from './google.js';
import * as store from './store.js';
import { fmtMin, fmtTime, fmtDay, agoDur, elapsedMin } from './format.js';

const TYPES = {
  feed:   { label: 'Breastfeed',        emoji: '🤱', timed: true },
  bottle: { label: 'Bottle',            emoji: '🍼', timed: false },
  sleep:  { label: 'Sleep',             emoji: '😴', timed: true },
  play:   { label: 'Play / tummy time', emoji: '🧸', timed: true },
  pump:   { label: 'Pump',              emoji: '🥛', timed: false },
  wet:    { label: 'Wet nappy',         emoji: '💧', timed: false },
  dirty:  { label: 'Dirty nappy',       emoji: '💩', timed: false },
};

const $ = (id) => document.getElementById(id);
const VIEWS = ['view-config', 'view-signin', 'view-connect', 'view-app'];

const SHEET_KEY = 'bt.sheetId';
let sheetId = localStorage.getItem(SHEET_KEY) || '';
let events = [];
let settings = { ...store.DEFAULT_SETTINGS };
let tick = null;

function show(view) {
  VIEWS.forEach((v) => { $(v).hidden = v !== view; });
}

function setStatus(id, text, isError = false) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('error', isError);
}

// ---------- boot ----------

async function boot() {
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

function afterSignIn() {
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

// ---------- tracker view ----------

async function loadData() {
  $('sheetLink').href = store.sheetUrl(sheetId);
  if (!events.length) setStatus('appStatus', 'Loading…');
  try {
    const state = await store.fetchState(sheetId);
    events = state.events;
    settings = state.settings;
    setStatus('appStatus', events.length ? '' : 'No entries yet — log the first one from the old app for now.');
    render();
    if (!tick) tick = setInterval(render, 30000); // keep timers and "ago" fresh
  } catch (err) {
    if (err instanceof g.NeedsSignIn) { show('view-signin'); return; }
    setStatus('appStatus', 'Failed to load: ' + err.message, true);
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

function render() {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const isTimed = (e) => (TYPES[e.type] || {}).timed;
  const recent = events.filter((e) =>
    e.startMs >= cutoff || (e.endMs && e.endMs >= cutoff) || (isTimed(e) && !e.endMs));
  renderOpen(recent.filter((e) => isTimed(e) && !e.endMs), now);
  renderSummary(now);
  renderList(recent, now);
}

function renderOpen(open, now) {
  $('openList').innerHTML = open.map((e) => {
    const t = TYPES[e.type] || { label: e.type, emoji: '❓' };
    return `<div class="open-card"><span>${t.emoji}</span>` +
      `<div class="grow"><div class="t-label">${t.label}${e.side ? ' · ' + e.side : ''}</div>` +
      `<div class="t-sub">started ${fmtTime(e.startMs)}</div></div>` +
      `<div class="t-elapsed">${fmtMin(elapsedMin(e, now))}</div></div>`;
  }).join('');
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
  const feeds = todayOf('feed');
  const bottles = todayOf('bottle');

  // when were breasts last emptied (breastfeed or pump, whichever is later)
  const lastEmpty = events.find((e) => e.type === 'feed' || e.type === 'pump');
  pushRow('🤱', 'Breasts emptied', '',
    [openFeed ? 'feeding now'
      : lastEmpty ? agoDur(lastEmpty.startMs, now) + (lastEmpty.type === 'pump' ? ' (pump)' : ' (feed)')
      : '—']);

  // when the baby last ate (breastfeed or bottle, whichever is later)
  const lastAte = events.find((e) => e.type === 'feed' || e.type === 'bottle');
  pushRow('👶', 'Last ate', '',
    [openFeed ? 'feeding now'
      : lastAte ? agoDur(lastAte.startMs, now) + (lastAte.type === 'bottle' ? ' (bottle)' : ' (breast)')
      : '—']);

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
  const sleepsAll = allOf('sleep');
  const sleepingNow = sleepsAll.some((e) => !e.endMs);
  const lastWake = sleepsAll.find((e) => e.endMs);
  const sleepMin = sleeps.reduce((a, e) => a + overlapMin(e, dayStartMs, now), 0);
  pushRow('😴', 'Sleep',
    sleepingNow ? 'sleeping now'
      : lastWake ? 'awake for ' + fmtMin(Math.max(0, Math.floor((now - lastWake.endMs) / 60000))) : '',
    [sleepMin ? fmtMin(sleepMin) : '']);

  const plays = todayOf('play');
  const lastPlay = allOf('play')[0];
  const playMin = plays.reduce((a, e) => a + overlapMin(e, dayStartMs, now), 0);
  pushRow('🧸', 'Play',
    lastPlay ? (!lastPlay.endMs ? 'playing now' : 'last ' + agoDur(lastPlay.startMs, now)) : '',
    [playMin ? fmtMin(playMin) : '']);

  const pumps = todayOf('pump');
  const lastPump = allOf('pump')[0];
  const pumpMl = pumps.reduce((a, e) => a + (e.amountMl || 0), 0);
  pushRow('🥛', 'Pumped',
    lastPump ? 'last ' + agoDur(lastPump.startMs, now) : '',
    [pumps.length ? `${pumps.length}×` : '', pumpMl ? `${pumpMl}ml` : '']);

  const wet = todayOf('wet').length;
  const dirty = todayOf('dirty').length;
  const lastNappy = events.find((e) => e.type === 'wet' || e.type === 'dirty');
  pushRow('💧💩', 'Nappies',
    lastNappy ? 'last ' + agoDur(lastNappy.startMs, now) : '',
    [(wet || dirty) ? `${wet} wet · ${dirty} dirty` : '']);

  rows.push(`<div class="sum-note">1 breastfeed ≈ ${assumedMl}ml</div>`);
  $('summary').innerHTML = rows.join('');
}

function eventDetails(e) {
  const parts = [];
  if (e.side) parts.push(e.side);
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
  const html = [];
  let lastDayLabel = '';
  for (const e of recent) {
    const dayLabel = fmtDay(e.startMs);
    if (dayLabel !== lastDayLabel) {
      html.push(`<div class="day-sep">${dayLabel}</div>`);
      lastDayLabel = dayLabel;
    }
    const t = TYPES[e.type] || { label: e.type, emoji: '❓', timed: false };
    const running = t.timed && !e.endMs;
    const dur = running ? fmtMin(elapsedMin(e, now)) + '…'
      : e.durationMin != null ? fmtMin(e.durationMin) : '';
    html.push(`<div class="evt"><span>${t.emoji}</span>` +
      `<div class="grow"><div class="e-label">${t.label}</div>` +
      `<div class="e-sub">${eventDetails(e)}</div></div>` +
      `<div class="e-time"><b>${fmtTime(e.startMs)}</b>${dur}</div></div>`);
  }
  $('todayList').innerHTML = html.join('');
}

boot();
