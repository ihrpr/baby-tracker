/**
 * Stats view: daily milk intake, stacked by source (breastfed at the assumed
 * ml per feed, pumped milk given by bottle, formula), plus a per-day table.
 */

const $ = (id) => document.getElementById(id);

export function renderStats(events, settings, range) {
  const assumedMl = Number(settings.breastfeed_ml) || 60;

  // range of calendar days, oldest first (DST-safe day boundaries)
  const days = [];
  for (let i = range - 1; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const e = new Date(d); e.setDate(e.getDate() + 1);
    days.push({
      start: d.getTime(), end: e.getTime(),
      label: range === 7
        ? d.toLocaleDateString(undefined, { weekday: 'short' })
        : String(d.getDate()),
      full: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    });
  }
  days.forEach((d) => {
    const started = (t) => events.filter((e) =>
      e.type === t && e.startMs >= d.start && e.startMs < d.end);
    const feeds = started('feed');
    const bottles = started('bottle');
    d.bfCount = feeds.length;
    d.feedCount = feeds.length + bottles.length;
    d.bfMl = feeds.length * assumedMl;
    d.bmMl = bottles.reduce((a, e) => a + (e.amountMl || 0), 0);
    d.fMl = bottles.reduce((a, e) => a + (e.formulaMl || 0), 0);
    d.totalMl = d.bfMl + d.bmMl + d.fMl;
  });

  // stacked columns: breastfed (bottom) / pumped milk / formula (top)
  const dense = range > 7 ? ' dense' : '';
  const labelStep = range === 7 ? 1 : range === 14 ? 2 : 5;
  const max = Math.max(...days.map((d) => d.totalMl), 1);
  $('milkChart').innerHTML = `<div class="cols${dense}">` + days.map((d) => {
    const segs = [['s3', d.fMl], ['s2', d.bmMl], ['s1', d.bfMl]] // top-first in DOM
      .filter((sg) => sg[1] > 0)
      .map((sg) => [sg[0], Math.max(2, Math.round(sg[1] / max * 108))]);
    const title = `${d.full}: ≈${d.totalMl}ml — breastfed ${d.bfCount}× ≈${d.bfMl}ml, ` +
      `pumped ${d.bmMl}ml, formula ${d.fMl}ml`;
    // per-bar totals only at 7 days; denser ranges rely on the tooltip and table
    return `<div class="col" title="${title}">` +
      (range === 7 ? `<div class="col-val">${d.totalMl || ''}</div>` : '') +
      segs.map((sg, i) =>
        `<div class="col-bar ${sg[0]}${i === 0 ? ' cap' : ''}` +
        `${i < segs.length - 1 ? ' gap' : ''}" style="height:${sg[1]}px"></div>`).join('') +
      '</div>';
  }).join('') + `</div><div class="days${dense}">` +
    days.map((d, i) =>
      `<span>${(days.length - 1 - i) % labelStep === 0 ? d.label : ''}</span>`).join('') +
    '</div>';

  // table, newest first
  $('statTable').innerHTML =
    '<tr><th>Day</th><th>Feeds</th><th>Breast ≈</th><th>Pumped</th><th>Formula</th><th>Total</th></tr>' +
    days.slice().reverse().map((d) =>
      `<tr><td>${d.full}</td><td>${d.feedCount || '–'}</td><td>${d.bfMl || '–'}</td>` +
      `<td>${d.bmMl || '–'}</td><td>${d.fMl || '–'}</td><td><b>${d.totalMl || '–'}</b></td></tr>`).join('');
}
