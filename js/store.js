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
