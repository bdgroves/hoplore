// Hover/focus tooltip, role filters, search and #slug highlighting for the
// landscape. Everything here is an enhancement: the SVG is fully usable
// without it (each point is a link with a <title>).

const svg = document.getElementById('landscape');
const tip = document.getElementById('tip');
const points = [...svg.querySelectorAll('.pt')];
const labels = new Map([...svg.querySelectorAll('.lbl')].map((l) => [l.dataset.for, l]));
const search = document.getElementById('lq');
const hidden = new Set();

// Native <title> tooltips double up with ours; keep them for no-JS only.
const regionLabel = Object.fromEntries(
  [...document.querySelectorAll('.role-chip')].map((c) => [c.dataset.region, c.dataset.label])
);
for (const p of points) {
  p.querySelector('title')?.remove();
  p.dataset.regionLabel = regionLabel[p.dataset.region] ?? '';
}

function showTip(p) {
  const d = p.dataset;
  tip.innerHTML = `<b>${d.name}</b><span class="role" style="--mark:${p.style.getPropertyValue('--mark')}">${p.dataset.regionLabel}</span>
    <span class="role-note">${d.role}</span>
    <dl><dt>Alpha</dt><dd class="num">${d.a}%</dd><dt>Total oil</dt><dd class="num">${d.o} mL/100g</dd>
    <dt>Sources</dt><dd class="num">${d.src}</dd></dl>`;
  tip.hidden = false;
  const box = svg.getBoundingClientRect();
  const mk = p.querySelector('.mk').getBoundingClientRect();
  const fig = svg.parentElement.getBoundingClientRect();
  const scroller = svg.parentElement;
  let left = mk.left - fig.left + scroller.scrollLeft + mk.width / 2 + 14;
  let top = mk.top - fig.top - 10;
  const tw = tip.offsetWidth;
  if (left + tw > scroller.scrollLeft + fig.width) left = mk.left - fig.left + scroller.scrollLeft - tw - 14;
  if (fig.width < 600) {
    // Narrow screen: no room beside the point, so sit below it, kept on screen.
    left = mk.left - fig.left + scroller.scrollLeft + mk.width / 2 - tw / 2;
    top = mk.bottom - fig.top + 12;
  }
  left = Math.max(scroller.scrollLeft + 4, Math.min(left, scroller.scrollLeft + fig.width - tw - 4));
  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, top)}px`;
  p.classList.add('on');
}

function hideTip(p) {
  tip.hidden = true;
  p?.classList.remove('on');
}

for (const p of points) {
  p.addEventListener('pointerenter', () => showTip(p));
  p.addEventListener('pointerleave', () => hideTip(p));
  p.addEventListener('focus', () => showTip(p));
  p.addEventListener('blur', () => hideTip(p));
}

function apply() {
  const q = search.value.trim().toLowerCase();
  let matches = 0;
  for (const p of points) {
    const off = hidden.has(p.dataset.region);
    const hit = q && p.dataset.search.includes(q);
    if (hit && !off) matches++;
    p.classList.toggle('off', off);
    p.classList.toggle('hit', Boolean(hit) && !off);
    p.classList.toggle('dim', Boolean(q) && !hit && !off);
    p.setAttribute('tabindex', off ? '-1' : '0');
    const l = labels.get(p.dataset.slug);
    if (l) l.classList.toggle('off', off || (Boolean(q) && !hit));
  }
  svg.classList.toggle('searching', Boolean(q) && matches > 0);
}

for (const chip of document.querySelectorAll('.role-chip')) {
  chip.addEventListener('click', () => {
    const role = chip.dataset.region;
    const on = chip.getAttribute('aria-pressed') === 'true';
    chip.setAttribute('aria-pressed', String(!on));
    on ? hidden.add(role) : hidden.delete(role);
    apply();
  });
}
search.addEventListener('input', apply);

// Arriving from a hop page ("Where it sits in the landscape"), or a hash
// changed in place: light that hop up.
function fromHash() {
  const slug = decodeURIComponent(location.hash.slice(1));
  for (const p of points) p.classList.remove('hit');
  const target = slug && document.getElementById(`pt-${slug}`);
  svg.classList.toggle('searching', Boolean(target));
  if (!target) return;
  target.classList.add('hit');
  target.parentNode.appendChild(target); // draw on top
  svg.scrollIntoView({ block: 'center' });
  // On a phone the chart scrolls sideways: bring the hop into the middle.
  const sc = svg.parentElement;
  if (sc.scrollWidth > sc.clientWidth) {
    const m = target.querySelector('.mk').getBoundingClientRect();
    sc.scrollLeft += m.left - sc.getBoundingClientRect().left - sc.clientWidth / 2;
  }
  requestAnimationFrame(() => showTip(target));
}
fromHash();
window.addEventListener('hashchange', fromHash);
