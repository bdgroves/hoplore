// Hop vs hop. Reads api/v1/index.json for names, then the two hops' own
// API files, and lays them out row by row. The URL (?a=&b=) is the state,
// so a comparison can be shared.

const $ = (s) => document.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const label = (t) => t.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmt = (n) => (n == null ? '—' : Number.isInteger(n) ? String(n) : Number(n).toFixed(1));
const COUNTRY = { US: 'USA', NZ: 'New Zealand', AU: 'Australia', DE: 'Germany', CZ: 'Czechia', GB: 'England', SI: 'Slovenia', FR: 'France', PL: 'Poland', JP: 'Japan' };
const ROLE = { aroma: 'Aroma', bittering: 'Bittering', dual: 'Dual purpose' };
const OIL = { myrcene: '#c8922a', humulene: '#3f6b4f', caryophyllene: '#8b3a2a', farnesene: '#6f7f4a', linalool: '#a8823f', geraniol: '#7e6a3c', pinene: '#2f5a4a', selinene: '#8a6d55', other: '#bcb7a4' };

let index = [];
const bySlug = new Map();
const byName = new Map();
const cache = new Map();

const bite = (a) => {
  if (!a) return null;
  const mid = (a.low + a.high) / 2;
  return mid < 5 ? 'Gentle' : mid < 9 ? 'Moderate' : mid < 13 ? 'High' : 'Very high';
};

function slugOf(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (bySlug.has(t)) return t;
  return byName.get(t) ?? index.find((h) => h.name.toLowerCase().startsWith(t))?.slug ?? null;
}

async function hop(slug) {
  if (!cache.has(slug)) cache.set(slug, fetch(`../api/v1/hops/${slug}.json`).then((r) => (r.ok ? r.json() : null)));
  return cache.get(slug);
}

// Two ranges on one shared scale, so the bars can be compared by eye.
function ranges(a, b, unit) {
  const vals = [a, b].filter(Boolean);
  if (!vals.length) return '<span class="fine">Not on file</span>';
  const max = Math.max(...vals.map((v) => v.high)) * 1.15;
  const bar = (v, cls) =>
    v
      ? `<div class="cmp-range ${cls}" data-h="${esc(NAMES[cls === 'a' ? 0 : 1])}"><span class="cmp-track"><span class="cmp-span" style="left:${((v.low / max) * 100).toFixed(1)}%;width:${Math.max(1.5, ((v.high - v.low) / max) * 100).toFixed(1)}%"></span></span><b class="num">${fmt(v.low)}–${fmt(v.high)}${unit}</b></div>`
      : `<div class="cmp-range ${cls}" data-h="${esc(NAMES[cls === 'a' ? 0 : 1])}"><span class="fine">Not on file</span></div>`;
  return bar(a, 'a') + bar(b, 'b');
}

function oilStrip(h) {
  const p = h.derived?.oil_profile?.normalized;
  if (!p) return '<span class="fine">Not on file</span>';
  const parts = Object.entries(p).sort((x, y) => y[1] - x[1]);
  const top = parts.filter(([k]) => k !== 'other').slice(0, 2).map(([k, v]) => `${k} ${Math.round(v)}%`).join(', ');
  return `<span class="hc-strip" aria-hidden="true">${parts.map(([k, v]) => `<span style="flex:${v};background:${OIL[k] ?? '#bcb7a4'}"></span>`).join('')}</span><span class="fine">Mostly ${esc(top)}</span>`;
}

let NAMES = ['', ''];
function row(name, a, b, note = '') {
  return `<tr><th scope="row">${name}${note ? `<span class="fine">${note}</span>` : ''}</th><td data-h="${esc(NAMES[0])}">${a}</td><td data-h="${esc(NAMES[1])}">${b}</td></tr>`;
}

async function render() {
  const a = slugOf($('#cmp-a').value);
  const b = slugOf($('#cmp-b').value);
  if (!a || !b) {
    $('#cmp-out').innerHTML = '';
    $('#cmp-status').textContent = a || b ? 'Pick a second hop.' : '';
    return;
  }
  history.replaceState(null, '', `?a=${a}&b=${b}`);
  $('#cmp-status').textContent = 'Loading…';
  const [da, db] = await Promise.all([hop(a), hop(b)]);
  if (!da || !db) return ($('#cmp-status').textContent = "Couldn't load one of those hops.");
  $('#cmp-status').textContent = '';
  const A = da.hop;
  const B = db.hop;
  document.title = `${A.name} vs ${B.name} | HopLove`;
  NAMES = [A.name, B.name];

  const tagsA = A.aroma?.tags ?? [];
  const tagsB = B.aroma?.tags ?? [];
  const both = new Set(tagsA.filter((t) => tagsB.includes(t)));
  const tags = (list) =>
    list.length
      ? `<ul class="tags">${list.map((t) => `<li${both.has(t) ? ' class="shared"' : ''}>${esc(label(t))}</li>`).join('')}</ul>`
      : '<span class="fine">No aroma notes on file</span>';

  const aa = A.analytics ?? {};
  const bb = B.analytics ?? {};
  const biteLine = (h) => (h.analytics?.alpha_acid ? `<b>${bite(h.analytics.alpha_acid)}</b>` : '<span class="fine">—</span>');

  // Beers that use both, from each hop's beer list.
  const inA = new Map((A.beers ?? []).map((x) => [`${x.brewery.slug}/${x.beer.slug}`, x]));
  const shared = (B.beers ?? []).filter((x) => inA.has(`${x.brewery.slug}/${x.beer.slug}`));
  const pairN = A.paired?.with?.find((p) => p.slug === b)?.n;
  const sim = da.similar?.find((s) => s.slug === b);

  const paired = (h) =>
    h.paired?.with?.length
      ? h.paired.with.slice(0, 4).map((p) => `<a href="../hops/${p.slug}/">${esc(bySlug.get(p.slug)?.name ?? p.slug)}</a>`).join(', ')
      : '<span class="fine">Not enough beers yet</span>';
  const swaps = (d) =>
    d.similar?.length ? d.similar.slice(0, 3).map((s) => `<a href="../hops/${s.slug}/">${esc(s.name)}</a>`).join(', ') : '<span class="fine">—</span>';

  const verdict = [
    both.size ? `Both lean ${[...both].slice(0, 3).map(label).join(', ').toLowerCase()}.` : 'They smell of different things entirely.',
    aa.alpha_acid && bb.alpha_acid
      ? bite(aa.alpha_acid) === bite(bb.alpha_acid)
        ? `Similar bite (${bite(aa.alpha_acid).toLowerCase()}).`
        : `${(aa.alpha_acid.typical ?? 0) > (bb.alpha_acid.typical ?? 0) ? A.name : B.name} bitters harder.`
      : '',
    shared.length ? `${shared.length} beer${shared.length === 1 ? '' : 's'} here use both.` : 'No beer here uses both yet.',
    sim ? `HopLove rates ${B.name} a ${Math.round(sim.score * 100)}/100 stand-in for ${A.name}.` : '',
  ].filter(Boolean).join(' ');

  $('#cmp-out').innerHTML = `
  <p class="cmp-verdict">${esc(verdict)}</p>
  <div class="cmp-scroll"><table class="cmp">
    <thead><tr><th></th><th scope="col"><a href="../hops/${A.slug}/">${esc(A.name)}</a></th><th scope="col"><a href="../hops/${B.slug}/">${esc(B.name)}</a></th></tr></thead>
    <tbody>
      ${row('Smells like', tags(tagsA), tags(tagsB), both.size ? 'shared notes in gold' : '')}
      ${row('In a word', esc(A.aroma?.summary ?? '—'), esc(B.aroma?.summary ?? '—'))}
      ${row('Used for', esc(ROLE[A.purpose] ?? A.purpose), esc(ROLE[B.purpose] ?? B.purpose))}
      ${row('From', esc(COUNTRY[A.country] ?? A.country), esc(COUNTRY[B.country] ?? B.country))}
      ${row('Bitterness', biteLine(A), biteLine(B), 'alpha acid')}
      <tr><th scope="row">Alpha acid<span class="fine">the bite</span></th><td colspan="2">${ranges(aa.alpha_acid, bb.alpha_acid, '%')}</td></tr>
      <tr><th scope="row">Aroma oil<span class="fine">mL per 100 g</span></th><td colspan="2">${ranges(aa.total_oil, bb.total_oil, ' mL')}</td></tr>
      ${row('Oil makeup', oilStrip(A), oilStrip(B))}
      ${row('Usually paired with', paired(A), paired(B), 'in beers here')}
      ${row('Swap it for', swaps(da), swaps(db))}
      ${row('In the glass', `<a href="../beers/?q=${encodeURIComponent(A.name.toLowerCase())}">${(A.beers ?? []).length} beers</a>`, `<a href="../beers/?q=${encodeURIComponent(B.name.toLowerCase())}">${(B.beers ?? []).length} beers</a>`)}
    </tbody>
  </table></div>
  ${shared.length ? `<section class="block"><h2>Beers with both <span class="fine">· ${shared.length}${pairN ? '' : ''}</span></h2>
    <ul class="beerlist compact">${shared
      .slice(0, 12)
      .map((x) => `<li><a href="../beers/${x.brewery.slug}/${x.beer.slug}/">${esc(x.beer.name)}</a> <span class="fine">${esc(x.brewery.name)}${x.fresh ? ' · <span class="fresh">fresh hop</span>' : ''}</span></li>`)
      .join('')}</ul>
    ${shared.length > 12 ? `<p class="fine"><a href="../beers/?q=${encodeURIComponent(`${A.name} ${B.name}`.toLowerCase())}">All ${shared.length} →</a></p>` : ''}</section>` : ''}`;
}

async function start() {
  const r = await fetch('../api/v1/index.json');
  index = (await r.json()).hops;
  for (const h of index) {
    bySlug.set(h.slug, h);
    byName.set(h.name.toLowerCase(), h.slug);
    for (const al of h.aliases ?? []) byName.set(String(al).toLowerCase(), h.slug);
  }
  $('#cmp-names').innerHTML = index.map((h) => `<option value="${esc(h.name)}">`).join('');
  const q = new URLSearchParams(location.search);
  $('#cmp-a').value = bySlug.get(q.get('a'))?.name ?? '';
  $('#cmp-b').value = bySlug.get(q.get('b'))?.name ?? '';
  render();
}

for (const id of ['#cmp-a', '#cmp-b']) $(id).addEventListener('change', render);
$('#cmp-swap').addEventListener('click', () => {
  [$('#cmp-a').value, $('#cmp-b').value] = [$('#cmp-b').value, $('#cmp-a').value];
  render();
});
$('#cmp-pick').addEventListener('submit', (e) => { e.preventDefault(); render(); });
for (const b of document.querySelectorAll('[data-pair]')) {
  b.addEventListener('click', () => {
    const [x, y] = b.dataset.pair.split(',');
    $('#cmp-a').value = bySlug.get(x)?.name ?? x;
    $('#cmp-b').value = bySlug.get(y)?.name ?? y;
    render();
  });
}
start();
