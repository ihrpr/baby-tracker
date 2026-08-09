/** Small time/text formatting helpers shared by the views. */

export function fmtMin(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDay(ms) {
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (ms >= today.getTime()) return 'Today';
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (ms >= yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function agoDur(ms, now = Date.now()) {
  const m = Math.floor((now - ms) / 60000);
  return m < 1 ? 'just now' : `${fmtMin(m)} ago`;
}

/** Minutes of an event that have elapsed so far (open events count to now). */
export function elapsedMin(e, now = Date.now()) {
  const end = e.endMs || now;
  return Math.max(0, Math.round((end - e.startMs) / 60000));
}

const pad = (n) => String(n).padStart(2, '0');

/** ms → value for an <input type="datetime-local">, in local time. */
export function toLocalInput(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ms, or null if empty/invalid. */
export function fromLocalInput(v) {
  if (!v) return null;
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? null : ms;
}
