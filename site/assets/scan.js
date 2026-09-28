// Scan a beer. Reads a photo or pasted text with Claude (through the site's
// Cloudflare Worker proxy, which holds the API key), matches the hop names to
// HopLove records, and can open a GitHub issue that adds the beer.

import { makeRater, isMe } from './rate.js';

const WORKER_URL = 'https://brooks-anthropic-proxy.bdgroves1970.workers.dev';
// Fastest first; if the Worker or the model turns it down, or the answer
// doesn't parse, the next one tries.
const MODELS = ['claude-sonnet-5', 'claude-opus-4-5'];
const REPO = 'bdgroves/hoplore';
const $ = (s) => document.querySelector(s);

const SYSTEM = `You read beer labels, cans, bottles, tap lists and brewery descriptions and report the hops.
Return ONLY raw JSON, no markdown fences, no commentary:
{
  "brewery": "brewery name as printed, or null",
  "city": "brewery city if printed or well known, or null",
  "state": "two-letter US state or country code if known, or null",
  "beer": "beer name as printed",
  "style": "style as printed, or null",
  "abv": number or null,
  "hops_as_written": "the hop text exactly as it appears, or null",
  "hops": ["one entry per hop, as written, keeping words like Cryo, CGX, fresh, or a farm name"],
  "error": null
}
The brewery is the company that made the beer: look for the logo, "Brewed by…" or "Brewed and canned by…" fine print, and the address. A slogan, a region or a collective on the can (for example "North Bank Brewers") is not the brewery. The beer is the beer's own name, usually the biggest words on the front; if you can't find it, use null rather than guessing.
Rules: list only hops that are actually named in the image or text. Never infer hops from the style, the brewery or your own knowledge of the beer. If no hops are named, return "hops": [] and put a short explanation in "error". If this is not a beer at all, say so in "error".`;

let photo = null; // { media_type, data }
let index = null; // normalized name -> hop
let last = null;

const norm = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = {
  nelson: 'nelson-sauvin', ekg: 'east-kent-golding', mthood: 'mount-hood', ctz: 'columbus', hbc586: 'krush',
  hbc1019: 'dolcita', hbc682: 'hbc-682', mosiac: 'mosaic', tettnanger: 'tettnang', hallertau: 'hallertau-mittelfrueh',
  mittelfruh: 'hallertau-mittelfrueh', hallertaumittelfruh: 'hallertau-mittelfrueh', eldorado: 'el-dorado', idaho7: 'idaho-7',
};
const FORMS = [['co2 extract', 'CO2 extract'], ['extract', 'extract'], ['hop kief', 'kief'], ['cryo', 'Cryo'], ['cgx', 'CGX'],
  ['lupomax', 'LupoMax'], ['incognito', 'Incognito'], ['hyperboost', 'HyperBoost'], ['dynaboost', 'DynaBoost'], ['t90', 'T90'], ['pellets', null]];
const ORIGIN = /^(german|gr|nz|us|usa|american|czech|oregon|washington|yakima|uk|english|slovenian)\s+/i;

async function loadIndex() {
  if (index) return index;
  const r = await fetch('../api/v1/index.json');
  const d = await r.json();
  index = new Map();
  for (const h of d.hops) for (const n of [h.name, h.slug, ...(h.aliases || [])]) index.set(norm(String(n)), h);
  for (const [k, slug] of Object.entries(ALIASES)) {
    const h = d.hops.find((x) => x.slug === slug);
    if (h && !index.has(k)) index.set(k, h);
  }
  return index;
}

function matchHop(token) {
  let text = token.trim();
  const item = { written: token, fresh: false, form: null, farm: null };
  const from = text.match(/\bfrom\s+(.+)$/i);
  if (from) { item.farm = from[1].trim(); text = text.slice(0, from.index).trim(); }
  // The seller isn't part of the name: "YCH Citra", "BarthHaas Mosaic".
  text = text.replace(/^(?:YCH|Yakima Chief(?: Hops)?|BarthHaas|Barth Haas|Hopsteiner|John I\.? Haas|Haas)\s+/i, '');
  // YCH Cryo Fresh: fresh hops frozen as lupulin pellets at the farm.
  const cryoFresh = text.match(/\bcryo[- ]?fresh\b/i);
  if (cryoFresh) { item.fresh = true; item.form = 'Cryo Fresh'; text = text.replace(cryoFresh[0], ' ').replace(/\s+/g, ' ').trim(); }
  const fresh = text.match(/^(?:(?:fresh(?:ly)?|wet)(?:[- ](?:picked|hop|hopped))?(?:,?\s+(?:and\s+)?))+/i);
  if (fresh) { item.fresh = true; text = text.slice(fresh[0].length); }
  text = text.replace(/\bhops?\b/gi, '').replace(/[™®()]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [w, label] of FORMS) {
    const re = new RegExp(`(^${w}\\s+|\\s+${w}$)`, 'i');
    if (re.test(text)) { item.form = label; text = text.replace(re, ' ').trim(); break; }
  }
  const bare = text.replace(ORIGIN, '');
  item.name = text;
  item.hop = index.get(norm(text)) || index.get(norm(bare)) || null;
  return item;
}

function card(item) {
  const h = item.hop;
  const how = [item.fresh ? `<span class="how fresh">Fresh hop${item.farm ? `, from ${esc(item.farm)}` : ''}</span>` : '',
    item.form ? `<span class="how">${esc(item.form)}</span>` : '', !item.fresh && item.farm ? `<span class="how">from ${esc(item.farm)}</span>` : ''].join('');
  if (!h) {
    return `<li class="hopcard missing"><div class="hc-head"><h3>${esc(item.name)}</h3></div><div class="hc-how">${how}</div>
      <p class="hc-none">Not in HopLove yet — or misread. Check the spelling before adding.</p></li>`;
  }
  const a = h.alpha_acid;
  return `<li class="hopcard"><div class="hc-head"><h3><a href="../hops/${h.slug}/">${esc(h.name)}</a></h3>
      <span class="hc-meta">${esc(h.country)} · ${esc(h.purpose)}</span></div>
      <div class="hc-how">${how}</div>
      ${h.tags?.length ? `<p class="hc-aroma">${esc(h.tags.slice(0, 6).map((t) => t.replace(/-/g, ' ')).join(', '))}</p>` : '<p class="hc-none">No aroma descriptors on file yet.</p>'}
      ${a ? `<p class="fine">Alpha <b class="num">${a.low}–${a.high}%</b></p>` : ''}
      <p class="fine"><a href="../hops/${h.slug}/">Everything on ${esc(h.name)} →</a></p></li>`;
}

const esc = (s = '') => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const status = (msg) => { $('#status').textContent = msg; };

function takeFile(file) {
  if (!file || !file.type.startsWith('image/')) return status("That isn't an image.");
  if (file.size > 25 * 1024 * 1024) return status('That image is over 25 MB; try a smaller one.');
  // Phone photos are 3-12 MB; the model needs a fraction of that. Shrink to
  // 1600px on the long side as JPEG before sending.
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.82);
    photo = { media_type: 'image/jpeg', data: url.split(',')[1] };
    $('#preview').src = url;
    $('#preview').hidden = false;
    $('#drop-text').hidden = true;
    URL.revokeObjectURL(img.src);
    // No second tap: a photo goes straight to the reader.
    read();
  };
  img.onerror = () => status("Couldn't open that image.");
  img.src = URL.createObjectURL(file);
}

async function ask(model, content) {
  const r = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error(`the reader returned ${r.status}`);
  const d = await r.json();
  const raw = (d.content || []).map((b) => b.text || '').join('').trim();
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  return JSON.parse(json);
}

let busy = false;
async function read() {
  const text = $('#text').value.trim();
  const hint = $('#hint').value.trim();
  if (!photo && !text) return status('Add a photo or paste some text first.');
  if (busy) return;
  busy = true;
  status('Reading the hops…');
  $('#read').disabled = true;
  document.body.classList.add('reading');
  const started = performance.now();
  try {
    const content = [];
    if (photo) content.push({ type: 'image', source: { type: 'base64', media_type: photo.media_type, data: photo.data } });
    content.push({ type: 'text', text: [hint && `Brewery: ${hint}.`, wanted && `It should be ${wanted}.`, text && `Text:\n${text.slice(0, 8000)}`, 'Report the hops as JSON.'].filter(Boolean).join('\n\n') });
    let got = null;
    let lastError = null;
    for (const model of MODELS) {
      try {
        got = await ask(model, content);
        break;
      } catch (e) {
        lastError = e;
      }
    }
    if (!got) throw lastError;
    await indexReady;
    if (!got.hops?.length) throw new Error(got.error || 'no hops are named on it');
    got.brewery = got.brewery || hint || null;
    got.beer = got.beer || params.get('beer')?.replace(/\s*\([^)]*\b(?:19|20)\d\d\b[^)]*\)/, '') || null;
    const items = got.hops.map(matchHop);
    last = { ...got, items, scanned_from: photo ? 'photo' : 'text' };
    show(last);
    status(`${items.length} hop${items.length === 1 ? '' : 's'} found, ${items.filter((i) => i.hop).length} matched, in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
  } catch (e) {
    status(`Couldn't read it: ${e.message}.`);
  } finally {
    $('#read').disabled = false;
    document.body.classList.remove('reading');
    busy = false;
  }
}

function show(s) {
  $('#result').hidden = false;
  $('#r-brewery').value = s.brewery || '';
  $('#r-beer').value = s.beer || '';
  $('#r-where').textContent = [s.city, s.state].filter(Boolean).join(', ');
  $('#r-meta').textContent = [s.style, s.abv != null ? `${s.abv}% ABV` : null].filter(Boolean).join(' · ');
  $('#r-written').textContent = s.hops_as_written || s.hops.join(', ');
  $('#r-hops').innerHTML = s.items.map(card).join('');
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function keep() {
  if (!last) return;
  // What's in the boxes wins: the model's reading, or your fix to it.
  last.brewery = $('#r-brewery').value.trim() || null;
  last.beer = $('#r-beer').value.trim() || null;
  if (!last.brewery || !last.beer) {
    status(`Fill in the ${!last.beer ? 'beer' : 'brewery'} name first — it wasn't readable on the ${last.scanned_from}.`);
    $(!last.beer ? '#r-beer' : '#r-brewery').focus();
    return;
  }
  const q = (v) => JSON.stringify(v ?? null);
  const yaml = [
    `brewery: ${q(last.brewery)}`, `city: ${q(last.city)}`, `state: ${q(last.state)}`,
    `beer: ${q(last.beer)}`, `style: ${q(last.style)}`, `abv: ${last.abv ?? 'null'}`,
    `hops: [${last.hops.map(q).join(', ')}]`, `hops_as_written: ${q(last.hops_as_written)}`,
    `scanned_from: ${q(last.scanned_from)}`, 'brewery_url: null',
    ...(isMe && $('#rate-on').checked ? [`stars: ${rater.value}`, `note: ${q($('#scan-note').value.trim() || null)}`] : []),
  ].join('\n');
  const body = `<!-- hoplove-beer-scan -->\nFix anything misread below, then submit. Submitting adds the beer to HopLove.\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`;
  const title = `Beer: ${last.beer} (${last.brewery || 'unknown brewery'})${isMe && $('#rate-on').checked ? ` ${rater.value}` : ''}`;
  window.open(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`, '_blank', 'noopener');
}

const rater = makeRater($('#scan-rater'), 3.5);
// Visitors can read any beer; adding and rating are Brooks's (the workflow
// only acts on his issues), so they get a "suggest" button instead.
if (!isMe) {
  $('.scan-rate').hidden = true;
  $('#keep').textContent = 'Suggest it for HopLove';
  $('#keep-note').textContent = 'Opens a GitHub issue with this beer filled in, for Brooks to look over and add. You’ll need a GitHub account.';
}
// Touching the caps or the note means you want the rating kept.
$('#scan-rater').addEventListener('input', () => { $('#rate-on').checked = true; });
$('#scan-rater').addEventListener('click', () => { $('#rate-on').checked = true; });
$('#scan-note').addEventListener('input', () => { $('#rate-on').checked = true; });

// Arriving from an Untappd check-in on /beers/: ?brewery=…&beer=…
const params = new URLSearchParams(location.search);
const wanted = [params.get('beer'), params.get('brewery') && `by ${params.get('brewery')}`].filter(Boolean).join(' ');
if (params.get('brewery')) $('#hint').value = params.get('brewery');
if (wanted) {
  $('#from-checkin').hidden = false;
  $('#from-checkin b').textContent = wanted;
}
// Start fetching the hop list now, while the photo is being taken.
const indexReady = loadIndex().catch(() => { index = new Map(); });

$('#photo').addEventListener('change', (e) => takeFile(e.target.files[0]));
const drop = $('#drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); takeFile(e.dataTransfer.files[0]); });
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) takeFile(item.getAsFile());
});
$('#read').addEventListener('click', read);
$('#keep').addEventListener('click', keep);
