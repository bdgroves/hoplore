/** The hop landscape: every hop with published figures, on one chart.
 *
 *  x = alpha acid (bittering power), y = total oil (aroma intensity).
 *  Each hop is plotted at its trust-weighted typical value, with thin
 *  whiskers out to the widest range any source reported -- the same
 *  observations-not-conclusions idea as the range bars, one level up.
 *  A wide cross means the sources disagree or the crop varies; a tight
 *  one means everyone who published agrees.
 *
 *  Server-rendered SVG, so it works with JavaScript off (every mark is a
 *  link with a <title>). assets/landscape.js layers hover, filtering,
 *  search and #slug highlighting on top. */

import { esc, fmt, shell, footer } from './render.js';

const W = 960;
const H = 600;
const M = { top: 20, right: 28, bottom: 58, left: 64 };
const PW = W - M.left - M.right;
const PH = H - M.top - M.bottom;

// Hops worth a direct label, if they're plotted. Kept short on purpose --
// a label on every point is noise; these are the ones people look for.
const LABELLED = [
  'citra', 'mosaic', 'simcoe', 'saaz-cz', 'cascade', 'hallertau-mittelfrueh',
  'polaris', 'nelson-sauvin', 'apollo', 'fuggle', 'sorachi-ace', 'krush',
];

// Color = where the hop comes from. Brewing role would be the obvious
// encoding, but most records' role is still the scaffold's 'dual' default,
// so coloring by it would present a placeholder as a finding. Origin is
// recorded for every hop. Palette: dataviz reference slots 1/2/3/7,
// validated all-pairs on --paper (worst CVD dE 9.2, normal 16.3); the two
// low-contrast hues get relief from direct labels and the table view.
const REGION = {
  us: { label: 'United States', color: '#2a78d6', countries: ['US'] },
  eu: { label: 'Continental Europe', color: '#eb6834', countries: ['DE', 'CZ', 'SI', 'PL', 'FR'] },
  gb: { label: 'Britain', color: '#1baf7a', countries: ['GB'] },
  south: { label: 'Southern Hemisphere', color: '#4a3aa7', countries: ['NZ', 'AU', 'ZA'] },
  other: { label: 'Elsewhere', color: '#7b857c', countries: [] },
};
const regionOf = (iso) => Object.keys(REGION).find((k) => REGION[k].countries.includes(iso)) ?? 'other';

const ROLE_LABEL = { aroma: 'Aroma', dual: 'Dual purpose', bittering: 'Bittering' };
// The bulk stubs carry purpose: dual as an unconfirmed default, flagged in
// meta.notes. Say so rather than repeating the placeholder as fact.
const roleText = (hop) =>
  /purpose defaulted/.test(hop.meta?.notes ?? '') ? 'Role unconfirmed' : ROLE_LABEL[hop.purpose] ?? hop.purpose;

const niceMax = (v, step) => Math.ceil(v / step) * step;

const marker = (x, y, r = 5.5) => `<circle class="mk" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;

// Greedy label placement: try four spots around the point, keep the first
// that clears every label already placed and the fewest other points.
function placeLabels(items, points) {
  const placed = [];
  const out = [];
  const CH = 7.1; // ~px per character at 12.5px Plex Sans
  const spots = [
    [10, -8, 'start'], [10, 16, 'start'], [-10, -8, 'end'], [-10, 16, 'end'], [0, -14, 'middle'], [0, 24, 'middle'],
  ];
  for (const it of items) {
    const w = it.name.length * CH;
    let best = null;
    for (const [dx, dy, anchor] of spots) {
      const x0 = anchor === 'start' ? it.x + dx : anchor === 'end' ? it.x + dx - w : it.x - w / 2;
      const box = { x0, x1: x0 + w, y0: it.y + dy - 11, y1: it.y + dy + 3 };
      if (box.x0 < M.left || box.x1 > W - 4 || box.y0 < 2) continue;
      const hitsLabel = placed.some((b) => !(box.x1 < b.x0 || box.x0 > b.x1 || box.y1 < b.y0 || box.y0 > b.y1));
      if (hitsLabel) continue;
      const hitsPts = points.filter((p) => p.x > box.x0 - 5 && p.x < box.x1 + 5 && p.y > box.y0 - 5 && p.y < box.y1 + 5).length;
      if (!best || hitsPts < best.hitsPts) best = { box, hitsPts, x: it.x + dx, y: it.y + dy, anchor };
      if (hitsPts === 0) break;
    }
    if (!best) continue; // no clean spot: leave it to the tooltip
    placed.push(best.box);
    out.push({ ...it, ...best });
  }
  return out;
}

export function renderLandscape({ hops, meta }) {
  const base = '../';
  const plotted = hops
    .filter((h) => h.analytics?.alpha_acid?.typical != null && h.analytics?.total_oil?.typical != null)
    .map((h) => ({ hop: h, a: h.analytics.alpha_acid, o: h.analytics.total_oil }));

  const xMax = niceMax(Math.max(...plotted.map((p) => p.a.high ?? p.a.typical)), 4);
  const yMax = niceMax(Math.max(...plotted.map((p) => p.o.high ?? p.o.typical)), 1);
  const sx = (v) => M.left + (v / xMax) * PW;
  const sy = (v) => M.top + PH - (v / yMax) * PH;

  const xTicks = [];
  for (let v = 0; v <= xMax; v += 4) xTicks.push(v);
  const yTicks = [];
  for (let v = 0; v <= yMax; v += 1) yTicks.push(v);

  const grid = [
    ...xTicks.map((v) => `<line class="grid" x1="${sx(v)}" x2="${sx(v)}" y1="${M.top}" y2="${M.top + PH}"/>
      <text class="tick" x="${sx(v)}" y="${M.top + PH + 20}" text-anchor="middle">${v}%</text>`),
    ...yTicks.map((v) => `<line class="grid" x1="${M.left}" x2="${M.left + PW}" y1="${sy(v)}" y2="${sy(v)}"/>
      <text class="tick" x="${M.left - 10}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`),
  ].join('\n      ');

  // Draw the most-disputed hops first so tight, well-agreed ones sit on top.
  const order = [...plotted].sort(
    (p, q) => (q.a.high - q.a.low) / xMax + (q.o.high - q.o.low) / yMax - ((p.a.high - p.a.low) / xMax + (p.o.high - p.o.low) / yMax)
  );

  const marks = order
    .map(({ hop, a, o }) => {
      const x = sx(a.typical);
      const y = sy(o.typical);
      const region = regionOf(hop.country);
      const role = roleText(hop);
      const sources = Math.max(a.source_count ?? 1, o.source_count ?? 1);
      const title = `${hop.name} — ${REGION[region].label}, ${role}. Alpha ${fmt(a.low)}–${fmt(a.high)}%, total oil ${fmt(o.low)}–${fmt(o.high)} mL/100g. ${sources} source${sources === 1 ? '' : 's'}.`;
      return `<a class="pt" href="${base}hops/${hop.slug}/" id="pt-${hop.slug}" data-slug="${hop.slug}" data-name="${esc(hop.name)}" data-region="${region}" data-role="${esc(role)}" style="--mark:${REGION[region].color}"
         data-a="${fmt(a.low)}–${fmt(a.high)}" data-o="${fmt(o.low)}–${fmt(o.high)}" data-src="${sources}"
         data-search="${esc([hop.name, ...(hop.aliases ?? [])].join(' ').toLowerCase())}">
        <title>${esc(title)}</title>
        <line class="wh" x1="${sx(a.low).toFixed(1)}" x2="${sx(a.high).toFixed(1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>
        <line class="wh" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${sy(o.low).toFixed(1)}" y2="${sy(o.high).toFixed(1)}"/>
        <circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/>
        ${marker(x, y)}
      </a>`;
    })
    .join('\n      ');

  const pts = plotted.map((p) => ({ x: sx(p.a.typical), y: sy(p.o.typical) }));
  const labels = placeLabels(
    LABELLED.map((slug) => plotted.find((p) => p.hop.slug === slug))
      .filter(Boolean)
      .map(({ hop, a, o }) => ({ slug: hop.slug, name: hop.name, x: sx(a.typical), y: sy(o.typical) })),
    pts
  )
    .map((l) => `<text class="lbl" data-for="${l.slug}" x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" text-anchor="${l.anchor}">${esc(l.name)}</text>`)
    .join('\n      ');

  const legend = Object.entries(REGION)
    .map(([key, r]) => [key, r, plotted.filter((p) => regionOf(p.hop.country) === key).length])
    .filter(([, , n]) => n > 0)
    .map(
      ([key, r, n]) => `<button class="chip role-chip" data-region="${key}" data-label="${r.label}" aria-pressed="true" style="--mark:${r.color}">
          <svg viewBox="-8 -8 16 16" width="14" height="14" aria-hidden="true">${marker(0, 0, 5)}</svg>${r.label}
          <span class="num">${n}</span></button>`
    )
    .join('\n        ');

  const tableRows = [...plotted]
    .sort((p, q) => p.hop.name.localeCompare(q.hop.name))
    .map(
      ({ hop, a, o }) => `<tr><td><a href="${base}hops/${hop.slug}/">${esc(hop.name)}</a></td><td>${REGION[regionOf(hop.country)].label}</td><td>${roleText(hop)}</td>
        <td class="num">${fmt(a.typical)}</td><td class="num">${fmt(a.low)}–${fmt(a.high)}</td>
        <td class="num">${fmt(o.typical)}</td><td class="num">${fmt(o.low)}–${fmt(o.high)}</td></tr>`
    )
    .join('\n        ');

  const missing = hops.length - plotted.length;

  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <nav class="nav" style="border-top:0;padding-top:0">
      <a href="${base}">All varieties</a>
      <a href="${base}api/v1/hops.json">Download the data</a>
      <a href="https://github.com/bdgroves/hoplore">GitHub</a>
    </nav>
    <h1 class="page-title">The hop landscape</h1>
    <p class="standfirst">Every hop with published figures, on one sheet: how hard
    it bitters against how much aroma oil it carries. The cross on each hop runs
    out to the widest range any source reported — a big cross means the sources
    disagree or the crop swings year to year; a tight one means everyone agrees.</p>
  </div>
</header>

<main id="main" class="wrap landscape">
  <div class="finder">
    <div>
      <label for="lq">Find a hop</label>
      <input id="lq" type="search" autocomplete="off" placeholder="citra, nelson, saaz…">
    </div>
    <div>
      <label id="role-label">Where it's from — tap to hide or show</label>
      <div class="filters" role="group" aria-labelledby="role-label">
        ${legend}
      </div>
    </div>
  </div>

  <figure class="chart">
    <svg id="landscape" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="chart-title chart-desc">
      <title id="chart-title">Hop landscape: alpha acid against total oil</title>
      <desc id="chart-desc">${plotted.length} hops plotted. Horizontal axis alpha acid in percent, 0 to ${xMax}. Vertical axis total oil in millilitres per 100 grams, 0 to ${yMax}. A table of the same data follows the chart.</desc>
      ${grid}
      <line class="axis" x1="${M.left}" x2="${M.left + PW}" y1="${M.top + PH}" y2="${M.top + PH}"/>
      <text class="axis-title" x="${M.left + PW}" y="${H - 10}" text-anchor="end">Alpha acid, % — more bittering power →</text>
      <text class="axis-title" transform="translate(16 ${M.top}) rotate(-90)" text-anchor="end">↑ Total oil, mL/100g — more aroma</text>
      <g class="marks">
      ${marks}
      </g>
      <g class="labels" aria-hidden="true">
      ${labels}
      </g>
    </svg>
    <div class="tip" id="tip" role="status" hidden></div>
    <figcaption>Plotted at each hop's trust-weighted typical value; breeder and lab
    sources count most. ${missing} of ${hops.length} hops aren't shown because no
    source on file publishes both figures for them yet.</figcaption>
  </figure>

  <details class="as-table">
    <summary>Show as a table</summary>
    <table>
      <thead><tr><th>Hop</th><th>Origin</th><th>Role</th><th>Alpha, typical</th><th>Alpha range</th><th>Total oil, typical</th><th>Oil range</th></tr></thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </details>
</main>
${footer(base, meta)}
<script src="${base}assets/landscape.js" type="module"></script>`;

  return shell({
    title: 'The hop landscape — alpha acid vs total oil for every hop | HopLore',
    description: `${plotted.length} hop varieties plotted by bittering power and aroma oil, with the full range every source reported.`,
    body,
    base,
  });
}
