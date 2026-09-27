// Crosshair + tooltip for the server-rendered line charts (templates/acreage.js).
const fmt = (v) => (v == null ? 'not reported' : v === 'withheld' ? 'withheld' : Math.round(v).toLocaleString('en-US'));

for (const fig of document.querySelectorAll('.line-chart')) {
  const data = JSON.parse(fig.dataset.chart);
  const svg = fig.querySelector('svg');
  const zone = svg.querySelector('.hover-zone');
  const cross = svg.querySelector('.cross');
  const tip = fig.querySelector('.tip');

  const nearest = (clientX) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    const x = pt.matrixTransform(svg.getScreenCTM().inverse()).x;
    let best = 0;
    data.x.forEach((xx, i) => { if (Math.abs(xx - x) < Math.abs(data.x[best] - x)) best = i; });
    return best;
  };

  const show = (i) => {
    cross.setAttribute('x1', data.x[i]);
    cross.setAttribute('x2', data.x[i]);
    cross.hidden = false;
    tip.innerHTML = `<b>${data.years[i]}</b><dl>${data.series
      .map((s) => `<dt><span class="key" style="--mark:${s.color}"></span>${s.label}</dt><dd class="num">${fmt(s.values[i])}</dd>`)
      .join('')}</dl>`;
    tip.hidden = false;
    const box = svg.getBoundingClientRect();
    const scale = box.width / svg.viewBox.baseVal.width;
    const left = data.x[i] * scale + svg.getBoundingClientRect().left - fig.getBoundingClientRect().left + fig.scrollLeft;
    const flip = left > box.width * 0.6;
    tip.style.left = `${flip ? left - tip.offsetWidth - 14 : left + 14}px`;
    tip.style.top = '12px';
  };
  const hide = () => { cross.hidden = true; tip.hidden = true; };

  zone.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  zone.addEventListener('pointerleave', hide);
  // Keyboard: arrow through the years.
  svg.tabIndex = 0;
  let at = data.years.length - 1;
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') at = Math.max(0, at - 1);
    else if (e.key === 'ArrowRight') at = Math.min(data.years.length - 1, at + 1);
    else if (e.key === 'Escape') return hide();
    else return;
    e.preventDefault();
    show(at);
  });
  svg.addEventListener('blur', hide);
}
