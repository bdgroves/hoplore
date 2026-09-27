// Filter the beer list by beer, brewery or hop name.
const input = document.getElementById('bq');
const count = document.getElementById('bq-count');
const rows = [...document.querySelectorAll('.beerlist li[data-search]')];
const sections = [...document.querySelectorAll('.beers section.block')];

function apply() {
  const q = input.value.trim().toLowerCase();
  let shown = 0;
  for (const li of rows) {
    const hit = !q || q.split(/\s+/).every((w) => li.dataset.search.includes(w));
    li.hidden = !hit;
    if (hit && !li.closest('.fresh-season')) shown++;
  }
  for (const s of sections) s.hidden = Boolean(q) && !s.querySelector('li[data-search]:not([hidden])');
  count.hidden = !q;
  count.textContent = `${shown} beer${shown === 1 ? '' : 's'} match “${input.value.trim()}”`;
}
input?.addEventListener('input', apply);
