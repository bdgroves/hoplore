// Client-side filtering over the server-rendered ledger. No fetch, no
// hydration — the page works with JavaScript off, this only narrows it.

const q = document.getElementById('q');
const ledger = document.getElementById('ledger');
const empty = document.getElementById('empty');
const chips = [...document.querySelectorAll('.chip')];
const rows = [...ledger.querySelectorAll('.row')];
const sections = [...ledger.querySelectorAll('.country')];

const active = new Set();

function matches(row, needle) {
  if (needle && !row.dataset.search.includes(needle)) return false;

  const purposes = [...active].filter((f) => ['aroma', 'bittering', 'dual'].includes(f));
  if (purposes.length && !purposes.includes(row.dataset.purpose)) return false;

  if (active.has('cryo') && row.dataset.cryo !== 'true') return false;
  if (active.has('hasdata') && row.dataset.hasdata !== 'true') return false;
  if (active.has('corroborated') && row.dataset.verification !== 'corroborated') return false;

  return true;
}

function apply() {
  const needle = q.value.trim().toLowerCase();
  let shown = 0;

  for (const row of rows) {
    const ok = matches(row, needle);
    row.hidden = !ok;
    if (ok) shown++;
  }

  for (const section of sections) {
    section.hidden = ![...section.querySelectorAll('.row')].some((r) => !r.hidden);
  }

  empty.hidden = shown > 0;
}

q.addEventListener('input', apply);

for (const chip of chips) {
  chip.addEventListener('click', () => {
    const key = chip.dataset.filter;
    const on = !active.has(key);
    on ? active.add(key) : active.delete(key);
    chip.setAttribute('aria-pressed', String(on));
    apply();
  });
}

// "/" focuses search, the way every reference tool should.
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== q) {
    e.preventDefault();
    q.focus();
    q.select();
  }
});
