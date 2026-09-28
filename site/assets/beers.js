// Filter the beer list by beer, brewery or hop name. Long lists show their
// first dozen until "Show all"; a search looks through everything.
const input = document.getElementById('bq');
const count = document.getElementById('bq-count');
const rows = [...document.querySelectorAll('.beerlist li[data-search]')];
const sections = [...document.querySelectorAll('.beers section.block')];

function apply() {
  const q = input.value.trim().toLowerCase();
  document.body.classList.toggle('searching', Boolean(q));
  let shown = 0;
  for (const li of rows) {
    const hit = !q || q.split(/\s+/).every((w) => li.dataset.search.includes(w));
    li.hidden = !hit;
    if (hit && !li.closest('.fresh-season')) shown++;
  }
  // While searching, the fresh hop list would only repeat results.
  for (const s of sections) s.hidden = Boolean(q) && (s.classList.contains('fresh-season') || !s.querySelector('li[data-search]:not([hidden])'));
  count.hidden = !q;
  count.textContent = shown
    ? `${shown} beer${shown === 1 ? '' : 's'} match “${input.value.trim()}”`
    : `Nothing matches “${input.value.trim()}” yet. Got the can? Scan it and it’s in.`;
  if (!shown && q) count.innerHTML = `Nothing matches “${escapeHtml(input.value.trim())}” yet. Got the can? <a href="../scan/">Scan it</a> and it’s in.`;
}
const escapeHtml = (t) => t.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
input?.addEventListener('input', apply);

for (const b of document.querySelectorAll('.try [data-q]')) {
  b.addEventListener('click', () => {
    input.value = b.dataset.q;
    apply();
    input.focus();
  });
}
for (const b of document.querySelectorAll('.show-all')) {
  b.addEventListener('click', () => {
    b.closest('section').classList.add('open');
    b.remove();
  });
}
// Jumping to a brewery opens its whole list.
addEventListener('hashchange', () => document.getElementById(location.hash.slice(1))?.classList.add('open'));

// Links from hop pages arrive as /beers/?q=citra.
const q = new URLSearchParams(location.search).get('q');
if (q && input) { input.value = q; apply(); }
