/**
 * Data layer: the spreadsheet schema and reads/writes via the Sheets API.
 *
 * Schema — one spreadsheet, two tabs:
 *   Log:      one row per event, columns HEADERS below.
 *   Settings: key/value pairs shared by everyone using the sheet.
 *
 * Times are stored as native spreadsheet datetime cells — the same format
 * the original Apps Script app writes. Reads use UNFORMATTED_VALUE, so
 * datetimes arrive as day-serial numbers and are converted locally; writes
 * (phase 2) will send serial numbers back. Serial numbers are used instead
 * of date strings deliberately: strings go through Sheets' locale-dependent
 * parsing (dd/MM vs MM/dd), which is a proven way to corrupt data.
 */

import { apiFetch } from './google.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const HEADERS = [
  'id', 'type', 'start_time', 'end_time', 'duration_min',
  'side', 'amount_ml', 'notes', 'logged_by', 'formula_ml',
];
export const TIMED_TYPES = ['feed', 'sleep', 'play'];
export const DEFAULT_SETTINGS = { breastfeed_ml: 60 };

export const sheetUrl = (spreadsheetId) =>
  `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

// ---------- time serialization ----------

const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

function serialToMs(serial) {
  // A serial is a timezone-naive wall-clock time; interpret it as local time.
  const asUtc = SHEETS_EPOCH_MS + serial * 86400000;
  return asUtc + new Date(asUtc).getTimezoneOffset() * 60000;
}

/** Inverse of serialToMs — for writing datetime cells (RAW, never strings). */
export function msToSerial(ms) {
  const asUtc = ms - new Date(ms).getTimezoneOffset() * 60000;
  return (asUtc - SHEETS_EPOCH_MS) / 86400000;
}

function parseTs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return serialToMs(v);
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

const numOrNull = (v) => (v == null || v === '' ? null : Number(v));

// ---------- reads ----------

function rowToEvent(row, rowNumber) {
  return {
    row: rowNumber, // 1-based sheet row, needed for edits later
    id: String(row[0] ?? ''),
    type: String(row[1] ?? ''),
    startMs: parseTs(row[2]),
    endMs: parseTs(row[3]),
    durationMin: numOrNull(row[4]),
    side: String(row[5] ?? ''),
    amountMl: numOrNull(row[6]),
    notes: String(row[7] ?? ''),
    loggedBy: String(row[8] ?? ''),
    formulaMl: numOrNull(row[9]),
  };
}

/**
 * Fetch the whole log and settings in one request.
 * Returns { events, settings } with events sorted newest first.
 */
export async function fetchState(spreadsheetId) {
  const ranges = ['Log!A2:J', 'Settings!A1:B']
    .map((r) => 'ranges=' + encodeURIComponent(r)).join('&');
  const res = await apiFetch(
    `${API}/${spreadsheetId}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE`);
  const [logRange, settingsRange] = res.valueRanges;

  const events = (logRange.values || [])
    .map((row, i) => rowToEvent(row, i + 2))
    .filter((e) => e.id);
  events.sort((a, b) => (b.startMs || 0) - (a.startMs || 0));

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of settingsRange.values || []) {
    if (row[0]) settings[String(row[0])] = row[1];
  }
  return { events, settings };
}

/**
 * Quick shape check for a picked spreadsheet: does it have a Log tab with
 * our header row? Returns 'ok' | 'empty' | 'foreign'.
 */
export async function inspectSheet(spreadsheetId) {
  const meta = await apiFetch(
    `${API}/${spreadsheetId}?fields=sheets.properties.title`);
  const titles = meta.sheets.map((s) => s.properties.title);
  if (!titles.includes('Log')) return titles.length === 1 ? 'empty' : 'foreign';
  const head = await apiFetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent('Log!A1:J1')}`);
  const row = (head.values || [])[0] || [];
  return row[0] === 'id' && row[1] === 'type' ? 'ok' : 'foreign';
}

// ---------- writes ----------

const blankOrNum = (v) => (v == null || v === '' || !isFinite(Number(v)) ? '' : Number(v));

// crypto.randomUUID needs Safari 15.4+ / secure context — fall back gracefully
const uuid = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    }));

const sheetIdCache = {};

async function logSheetId(spreadsheetId) {
  if (sheetIdCache[spreadsheetId] != null) return sheetIdCache[spreadsheetId];
  const meta = await apiFetch(`${API}/${spreadsheetId}?fields=sheets.properties`);
  const log = meta.sheets.find((s) => s.properties.title === 'Log');
  if (!log) throw new Error('The Log tab is missing from this spreadsheet.');
  sheetIdCache[spreadsheetId] = log.properties.sheetId;
  return log.properties.sheetId;
}

/**
 * Confirm a row still holds the given event id (rows shift when someone
 * deletes an entry on another device); falls back to scanning the id column.
 */
async function resolveRow(spreadsheetId, id, hintRow) {
  if (hintRow) {
    const res = await apiFetch(
      `${API}/${spreadsheetId}/values/${encodeURIComponent(`Log!A${hintRow}`)}`);
    if (((res.values || [])[0] || [])[0] === id) return hintRow;
  }
  const res = await apiFetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent('Log!A2:A')}`);
  const rows = res.values || [];
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] || [])[0] === id) return i + 2;
  }
  throw new Error('Entry not found — it may have been deleted.');
}

/**
 * p: {type, startMs?, durationMin?, side?, amountMl?, formulaMl?, notes?}
 * No startMs → starts now. durationMin given → closed event.
 */
export async function addEvent(spreadsheetId, p, userEmail) {
  const startMs = Number.isFinite(p.startMs) ? p.startMs : Date.now();
  const hasDur = Number.isFinite(p.durationMin);
  const row = [
    uuid(),
    p.type,
    msToSerial(startMs),
    hasDur ? msToSerial(startMs + p.durationMin * 60000) : '',
    hasDur ? p.durationMin : '',
    p.side || '',
    blankOrNum(p.amountMl),
    p.notes || '',
    userEmail || '',
    blankOrNum(p.formulaMl),
  ];
  await apiFetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent('Log!A2:J')}:append` +
    '?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { method: 'POST', body: JSON.stringify({ values: [row] }) });
}

export async function stopEvent(spreadsheetId, ev, endMs) {
  const row = await resolveRow(spreadsheetId, ev.id, ev.row);
  const end = Number.isFinite(endMs) ? endMs : Date.now();
  const durationMin = ev.startMs != null
    ? Math.max(1, Math.round((end - ev.startMs) / 60000)) : 1;
  await apiFetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent(`Log!D${row}:E${row}`)}` +
    '?valueInputOption=RAW',
    { method: 'PUT', body: JSON.stringify({ values: [[msToSerial(end), durationMin]] }) });
}

/** p: {id, row, type, startMs, durationMin?, side?, amountMl?, formulaMl?, notes?} */
export async function updateEvent(spreadsheetId, p) {
  if (!Number.isFinite(p.startMs)) throw new Error('Please set a valid start time.');
  const row = await resolveRow(spreadsheetId, p.id, p.row);
  const hasDur = Number.isFinite(p.durationMin);
  await apiFetch(`${API}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        {
          range: `Log!B${row}:H${row}`,
          values: [[
            p.type,
            msToSerial(p.startMs),
            hasDur ? msToSerial(p.startMs + p.durationMin * 60000) : '',
            hasDur ? p.durationMin : '',
            p.side || '',
            blankOrNum(p.amountMl),
            p.notes || '',
          ]],
        },
        { range: `Log!J${row}`, values: [[blankOrNum(p.formulaMl)]] },
      ],
    }),
  });
}

export async function deleteEvent(spreadsheetId, ev) {
  const row = await resolveRow(spreadsheetId, ev.id, ev.row);
  const sheetId = await logSheetId(spreadsheetId);
  await apiFetch(`${API}/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
        },
      }],
    }),
  });
}

export async function setSetting(spreadsheetId, key, value) {
  const res = await apiFetch(
    `${API}/${spreadsheetId}/values/${encodeURIComponent('Settings!A1:A')}`);
  const rows = res.values || [];
  const idx = rows.findIndex((r) => (r || [])[0] === key);
  if (idx === -1) {
    await apiFetch(
      `${API}/${spreadsheetId}/values/${encodeURIComponent('Settings!A1:B')}:append` +
      '?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: JSON.stringify({ values: [[key, value]] }) });
  } else {
    await apiFetch(
      `${API}/${spreadsheetId}/values/${encodeURIComponent(`Settings!B${idx + 1}`)}` +
      '?valueInputOption=RAW',
      { method: 'PUT', body: JSON.stringify({ values: [[value]] }) });
  }
}

/** Create a fresh tracker spreadsheet in the user's Drive; returns its ID. */
export async function createTrackerSheet() {
  const created = await apiFetch(API, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: 'Baby Tracker' },
      sheets: [
        { properties: { title: 'Log', gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: 'Settings' } },
      ],
    }),
  });
  await apiFetch(`${API}/${created.spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: 'Log!A1', values: [HEADERS] },
        { range: 'Settings!A1', values: [Object.entries(DEFAULT_SETTINGS)[0]] },
      ],
    }),
  });
  // datetime display format for the time columns (values are written as serials)
  const logSheetId = created.sheets[0].properties.sheetId;
  await apiFetch(`${API}/${created.spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [{
        repeatCell: {
          range: { sheetId: logSheetId, startColumnIndex: 2, endColumnIndex: 4, startRowIndex: 1 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'dd/MM/yyyy hh:mm:ss' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      }],
    }),
  });
  return created.spreadsheetId;
}
