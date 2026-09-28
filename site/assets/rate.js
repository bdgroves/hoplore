// Untappd-style caps: 0.25 to 5 in quarter steps. makeRater() is shared by
// beer pages ("Rate it") and the scan page; on a beer page this file also
// wires up the Save button, which opens a GitHub issue the "Add a scanned
// beer" workflow turns into data/ratings.yml.

const REPO = 'bdgroves/hoplore';

// Rating is Brooks's: the controls only show in a browser that has opened
// any HopLove page with ?me once (?me=0 forgets it). Anyone else's rating
// issue would be ignored by the workflow anyway; this just keeps the page
// from offering a button that does nothing for them.
export const isMe = (() => {
  try {
    const q = new URLSearchParams(location.search).get('me');
    if (q === '0') localStorage.removeItem('hoplove_me');
    else if (q !== null) localStorage.setItem('hoplove_me', '1');
    return localStorage.getItem('hoplove_me') === '1';
  } catch {
    return false;
  }
})();

// Saving. When Brooks's Worker has the /hoplove/save route (see
// tools/worker/), a scan or rating goes straight in with one tap and no
// GitHub account. Until then -- or if the Worker says no -- it opens the
// prefilled GitHub issue as before. The owner key (set once with ?key=…)
// is what makes a save Brooks's rather than a visitor's suggestion.
const WORKER = 'https://brooks-anthropic-proxy.bdgroves1970.workers.dev';
const ownerKey = (() => {
  try {
    const k = new URLSearchParams(location.search).get('key');
    if (k) localStorage.setItem('hoplove_key', k);
    return localStorage.getItem('hoplove_key') || '';
  } catch {
    return '';
  }
})();
export const oneTap = fetch(`${WORKER}/hoplove/ping`, { method: 'GET' })
  .then((r) => r.ok)
  .catch(() => false);
let canOneTap = false;
oneTap.then((ok) => { canOneTap = ok; });

/** Save a scan or rating. Returns a promise of { ok, url?, message }. */
export function save(kind, title, body) {
  if (!canOneTap) {
    window.open(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
    return Promise.resolve({ ok: true, message: 'Opened on GitHub — submit it there.' });
  }
  return fetch(`${WORKER}/hoplove/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ownerKey ? { 'X-HopLove-Key': ownerKey } : {}) },
    body: JSON.stringify({ kind, title, body }),
  })
    .then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `the save returned ${r.status}`);
      return { ok: true, url: d.url, message: d.owner ? 'Saved — it’ll be on the site in a couple of minutes.' : 'Sent to Brooks — thanks! He’ll look it over.' };
    })
    .catch((e) => ({ ok: false, message: `Couldn’t save: ${e.message}.` }));
}

export function makeRater(el, initial = 3.5) {
  el.classList.add('rater');
  el.innerHTML = `<span class="caps big" aria-hidden="true"><span class="caps-row">●●●●●</span><span class="caps-fill">●●●●●</span></span>
    <b class="num rater-val"></b>
    <input type="range" min="0.25" max="5" step="0.25" aria-label="Rating, out of 5">`;
  const input = el.querySelector('input');
  const fill = el.querySelector('.caps-fill');
  const val = el.querySelector('.rater-val');
  const set = (v) => {
    fill.style.width = `${(v / 5) * 100}%`;
    val.textContent = Number(v).toFixed(2).replace(/0$/, '').replace(/\.0$/, '');
  };
  input.value = initial;
  set(initial);
  input.addEventListener('input', () => set(Number(input.value)));
  // Tapping the caps themselves picks the nearest quarter.
  el.querySelector('.caps').addEventListener('click', (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const v = Math.min(5, Math.max(0.25, Math.round(((e.clientX - box.left) / box.width) * 20) / 4));
    input.value = v;
    set(v);
  });
  return { get value() { return Number(input.value); } };
}

const glass = document.querySelector('.my-glass');
if (glass && isMe) {
  glass.querySelector('.rate-it').hidden = false;
  const holder = glass.querySelector('.rater');
  const rater = makeRater(holder, Number(holder.dataset.stars) || 3.5);
  glass.querySelector('#rate-save').addEventListener('click', () => {
    const d = glass.dataset;
    const note = glass.querySelector('#rate-note').value.trim();
    const q = (v) => JSON.stringify(v ?? null);
    const yaml = [`brewery: ${d.brewery}`, `beer: ${d.beer}`, `name: ${q(d.name)}`, `brewery_name: ${q(d.breweryName)}`,
      `stars: ${rater.value}`, `note: ${q(note || null)}`].join('\n');
    const body = `<!-- hoplove-rating -->\nSubmit to record this rating on HopLove.\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
    const title = `Rating: ${d.name} (${d.breweryName}) ${rater.value}`;
    const btn = glass.querySelector('#rate-save');
    btn.disabled = true;
    save('rating', title, body).then((r) => {
      btn.disabled = false;
      btn.insertAdjacentHTML('afterend', `<span class="fine save-msg"> ${r.message}</span>`);
    });
  });
}
