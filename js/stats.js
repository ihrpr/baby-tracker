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
      brief: d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
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
    const pumps = started('pump');
    d.pumpCount = pumps.length;
    d.pumpMl = pumps.reduce((a, e) => a + (e.amountMl || 0), 0);
  });

  // stacked columns: breastfed (bottom) / bottle milk / formula (top)
  const dense = range > 7 ? ' dense' : '';
  const labelStep = range === 7 ? 1 : range === 14 ? 2 : 5;
  const max = Math.max(...days.map((d) => d.totalMl), 1);
  const anyMilk = days.some((d) => d.totalMl > 0);
  $('milkChart').innerHTML = !anyMilk
    ? '<div class="empty-note">No feeds or bottles logged in this range yet.</div>'
    : `<div class="cols${dense}">` + days.map((d) => {
      const segs = [['s3', d.fMl], ['s2', d.bmMl], ['s1', d.bfMl]] // top-first in DOM
        .filter((sg) => sg[1] > 0)
        .map((sg) => [sg[0], Math.max(2, Math.round(sg[1] / max * 108))]);
      const title = `${d.full}: ≈${d.totalMl}ml — breastfed ${d.bfCount}× ≈${d.bfMl}ml, ` +
        `bottle milk ${d.bmMl}ml, formula ${d.fMl}ml`;
      // per-bar totals only at 7 days; denser ranges use tap/hover and the table
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
  bindBarTap('milkChart', 'milkCap');

  // pump output: single-series bars + a least-squares trend line
  const pMax = Math.max(...days.map((d) => d.pumpMl), 1);
  const CH = 108; // bar area height, must match the CSS
  const barsHtml = days.map((d) => {
    const h = d.pumpMl ? Math.max(2, Math.round(d.pumpMl / pMax * CH)) : 0;
    const title = `${d.full}: ${d.pumpMl}ml pumped` +
      (d.pumpCount ? ` (${d.pumpCount}×)` : '');
    return `<div class="col" title="${title}">` +
      (range === 7 ? `<div class="col-val">${d.pumpMl || ''}</div>` : '') +
      (h ? `<div class="col-bar s2 cap" style="height:${h}px"></div>` : '') +
      '</div>';
  }).join('');

  // least-squares fit over the daily totals (days with no pumping count as 0)
  const n = days.length;
  const meanX = (n - 1) / 2;
  const meanY = days.reduce((a, d) => a + d.pumpMl, 0) / n;
  let num = 0, den = 0;
  days.forEach((d, i) => { num += (i - meanX) * (d.pumpMl - meanY); den += (i - meanX) ** 2; });
  const slope = den ? num / den : 0; // ml per day
  const yAt = (i) => Math.min(pMax, Math.max(0, meanY + slope * (i - meanX)));
  const pt = (i) => `${((i + 0.5) / n * 100).toFixed(2)},${(CH - yAt(i) / pMax * CH).toFixed(1)}`;
  const trendSvg =
    `<svg class="trend" viewBox="0 0 100 ${CH}" preserveAspectRatio="none">` +
    `<line x1="${pt(0).split(',')[0]}" y1="${pt(0).split(',')[1]}"` +
    ` x2="${pt(n - 1).split(',')[0]}" y2="${pt(n - 1).split(',')[1]}"/></svg>`;

  const weekly = Math.round(slope * 7);
  const anyPump = days.some((d) => d.pumpMl > 0);
  $('pumpTrend').textContent = anyPump
    ? `avg ${Math.round(meanY)}ml/day · trend ${weekly > 0 ? '↗ +' : weekly < 0 ? '↘ ' : '→ '}` +
      `${weekly ? weekly + 'ml/week' : 'steady'}`
    : 'No pumping logged in this range';

  $('pumpChart').innerHTML =
    `<div class="chart-wrap"><div class="cols${dense}">${barsHtml}</div>${anyPump ? trendSvg : ''}</div>` +
    `<div class="days${dense}">` +
    days.map((d, i) =>
      `<span>${(days.length - 1 - i) % labelStep === 0 ? d.label : ''}</span>`).join('') +
    '</div>';
  bindBarTap('pumpChart', 'pumpCap');

  // table, newest first
  $('statTable').innerHTML =
    '<tr><th>Day</th><th>Feeds</th><th>Breast ≈</th><th>Bottle milk</th><th>Formula</th><th>Total</th><th>Pumped</th></tr>' +
    days.slice().reverse().map((d) =>
      `<tr><td title="${d.full}">${d.brief}</td><td>${d.feedCount || '–'}</td><td>${d.bfMl || '–'}</td>` +
      `<td>${d.bmMl || '–'}</td><td>${d.fMl || '–'}</td><td><b>${d.totalMl || '–'}</b></td>` +
      `<td>${d.pumpMl || '–'}</td></tr>`).join('');
}

/**
 * Title-attribute tooltips don't exist on touch — tapping a bar shows its
 * details in a caption under the chart instead. onclick assignment (not
 * addEventListener) so re-renders don't stack handlers.
 */
function bindBarTap(chartId, capId) {
  const chart = $(chartId);
  const note = $(capId);
  note.hidden = true;
  chart.onclick = (ev) => {
    const col = ev.target.closest('.col');
    if (!col || !col.title) return;
    chart.querySelectorAll('.col.sel').forEach((c) => c.classList.remove('sel'));
    col.classList.add('sel');
    note.textContent = col.title;
    note.hidden = false;
  };
}
