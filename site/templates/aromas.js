/**
 * Smell pages: /smells/ lists every aroma in data/taxonomy/aroma-tags.yml by
 * family, and /smells/<tag>/ lists every hop the growers and breeders say
 * smells of it, plus the beers on HopLove that lean that way. A family page
 * (Citrus) takes in its members (Grapefruit, Lime…).
 */
import { esc, shell, footer, tip } from './render.js';
import { hopBill } from './beers.js';
import { caps } from './mine.js';

const BEERS_SHOWN = 40;

/** tag -> Set of tags it covers (itself, plus members for a family). */
function coverage(aromaTags) {
  const cover = {};
  for (const [t, def] of Object.entries(aromaTags)) {
    (cover[t] ??= new Set()).add(t);
    if (def.parent) (cover[def.parent] ??= new Set()).add(t);
  }
  return cover;
}

/** Everything the pages need, worked out once: which hops and beers go with
 *  each smell. Tags no hop carries get no page (and no link). */
export function aromaIndex({ hops, breweries, taxonomy }) {
  const aromaTags = taxonomy.aromaTags;
  const cover = coverage(aromaTags);
  const bySlug = Object.fromEntries(hops.map((h) => [h.slug, h]));
  const result = {};
  for (const [tag, set] of Object.entries(cover)) {
    const tagHops = hops.filter((h) => (h.aroma?.tags ?? []).some((t) => set.has(t)));
    if (!tagHops.length) continue;
    const hopSet = new Set(tagHops.map((h) => h.slug));
    const beers = [];
    for (const b of breweries) {
      for (const beer of b.beers) {
        const bill = hopBill(beer).filter((e) => e.slug && bySlug[e.slug]);
        const hits = bill.filter((e) => hopSet.has(e.slug));
        if (hits.length) beers.push({ brewery: b.brewery, beer, hits: hits.map((e) => e.slug), of: bill.length });
      }
    }
    // Most of the bill smelling of it first, then the most hops, then Brooks's.
    beers.sort(
      (a, b) =>
        b.hits.length / b.of - a.hits.length / a.of ||
        b.hits.length - a.hits.length ||
        Number(Boolean(b.beer.mine)) - Number(Boolean(a.beer.mine)) ||
        a.beer.name.localeCompare(b.beer.name)
    );
    result[tag] = { tag, label: aromaTags[tag].label, hops: tagHops, beers };
  }
  return result;
}

/** A tag as a link to its page, or plain text when it has none. */
export function smellLink(tag, label, base, index, attrs = '') {
  return index?.[tag] ? `<a href="${base}smells/${tag}/"${attrs}>${esc(label)}</a>` : esc(label);
}

const count = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function renderAromas({ index, taxonomy, meta }) {
  const base = '../';
  const aromaTags = taxonomy.aromaTags;
  const families = Object.entries(aromaTags).filter(([t, d]) => !d.parent && index[t]);
  const members = (fam) => Object.entries(aromaTags).filter(([t, d]) => d.parent === fam && index[t]);
  const chip = (t) => `<li><a href="${t}/">${esc(index[t].label)} <span class="num">${index[t].hops.length}</span></a></li>`;

  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <h1 class="page-title">What do you <em>smell?</em></h1>
    <p class="standfirst">Mango, pine, grapefruit, dank… Pick the smell you're after and see every hop that brings it,
    and the beers on HopLove that lean that way. The descriptors come from the hop breeders and growers
    themselves, not from the beers.</p>
  </div>
</header>
<main id="main" class="wrap smells">
  ${families
    .map(
      ([fam]) => `<section class="block smell-family" id="${fam}">
    <h2><a href="${fam}/">${esc(index[fam].label)}</a> <span class="fine">· ${count(index[fam].hops.length, 'hop')} · ${count(index[fam].beers.length, 'beer')}</span></h2>
    ${members(fam).length ? `<ul class="tags smell-tags">
      ${members(fam).map(([t]) => chip(t)).join('\n      ')}
    </ul>` : ''}
  </section>`
    )
    .join('\n  ')}
  <p class="fine">The number on each smell is how many hops carry it. A family (Citrus) takes in everything under it
  (Grapefruit, Lime…). Smells no hop on file carries yet are left out.</p>
  ${tip('Found your smell?')}
</main>
${footer(base, meta)}`;

  return shell({
    title: 'Hops by smell: citrus, tropical, pine and more | HopLove',
    active: 'smells',
    description: 'Pick a smell — mango, grapefruit, pine, berry — and see every hop that brings it and the Pacific Northwest beers that lean that way.',
    body,
    base,
  });
}

export function renderAroma({ entry, index, taxonomy, meta }) {
  const base = '../../';
  const aromaTags = taxonomy.aromaTags;
  const def = aromaTags[entry.tag];
  const parent = def.parent && index[def.parent] ? def.parent : null;
  const kids = Object.entries(aromaTags).filter(([t, d]) => d.parent === entry.tag && index[t]);
  const siblings = parent ? Object.entries(aromaTags).filter(([t, d]) => d.parent === parent && t !== entry.tag && index[t]) : [];
  const label = entry.label;
  const lower = label.toLowerCase();

  // Hops: the most-brewed first, so the familiar names lead.
  const hops = [...entry.hops].sort((a, b) => (b.beers?.length ?? 0) - (a.beers?.length ?? 0) || a.name.localeCompare(b.name));
  const nameOf = Object.fromEntries(entry.hops.map((h) => [h.slug, h.name]));
  const shown = entry.beers.slice(0, BEERS_SHOWN);
  const had = entry.beers.filter((x) => x.beer.mine);

  const hopRow = (h) => {
    const others = (h.aroma?.tags ?? []).filter((t) => t !== entry.tag).slice(0, 5);
    const n = h.beers?.length ?? 0;
    return `<li><a href="${base}hops/${h.slug}/"><b>${esc(h.name)}</b></a>
        <span class="fine">${others.length ? `also ${others.map((t) => smellLink(t, aromaTags[t]?.label ?? t, base, index)).join(', ')}` : ''}${n ? `${others.length ? ' · ' : ''}<a href="${base}hops/${h.slug}/#in-the-glass">${count(n, 'beer')}</a>` : ''}</span></li>`;
  };
  const beerRow = (x) => {
    const mine = x.beer.mine ? ` <span class="had">${x.beer.mine.rating ? caps(x.beer.mine.rating.stars, { small: true }) : '✓ Brooks had it'}</span>` : '';
    return `<li><a href="${base}beers/${x.brewery.slug}/${x.beer.slug}/"><b>${esc(x.beer.name)}</b></a>${mine}
        <span class="fine">${esc(x.brewery.name)} · ${x.hits.length === x.of ? (x.of === 1 ? 'its one hop' : `all ${x.of} hops`) : `${x.hits.length} of ${x.of} hops`}: <span class="smell-hits">${x.hits.map((s) => esc(nameOf[s] ?? s)).join(', ')}</span></span></li>`;
  };

  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <nav class="nav" style="border-top:0;padding-top:0">
      <a href="${base}smells/">All smells</a>
      ${parent ? `<a href="${base}smells/${parent}/">${esc(index[parent].label)}</a>` : ''}
    </nav>
    <p class="kicker">Hops that smell of</p>
    <h1 class="page-title">${esc(label)}</h1>
    <p class="standfirst">${count(hops.length, 'hop')} ${hops.length === 1 ? 'brings' : 'bring'} ${esc(lower)}${kids.length ? ` (or something under it: ${kids.map(([t]) => esc(aromaTags[t].label.toLowerCase())).join(', ')})` : ''},
    by their breeders' and growers' own notes. ${entry.beers.length ? `They turn up in ${count(entry.beers.length, 'beer')} on HopLove.` : ''}
    ${def.note ? esc(def.note) : ''}</p>
    ${had.length ? `<p class="had-it">Brooks has had ${had.length === 1 ? 'one of them' : `${had.length} of them`}</p>` : ''}
  </div>
</header>
<main id="main" class="wrap smells">
  ${kids.length ? `<section class="block">
    <h2>More exactly</h2>
    <ul class="tags smell-tags">
      ${kids.map(([t]) => `<li><a href="${base}smells/${t}/">${esc(index[t].label)} <span class="num">${index[t].hops.length}</span></a></li>`).join('\n      ')}
    </ul>
  </section>` : ''}
  <section class="block">
    <h2>The hops <span class="fine">· most brewed first</span></h2>
    <ul class="fh-list smell-hops">
      ${hops.map(hopRow).join('\n      ')}
    </ul>
  </section>
  ${entry.beers.length ? `<section class="block">
    <h2>Beers that lean ${esc(lower)} <span class="fine">· the more of the bill that smells of it, the higher up</span></h2>
    <ul class="fh-list smell-beers">
      ${shown.map(beerRow).join('\n      ')}
    </ul>
    ${entry.beers.length > shown.length ? `<p class="fine">Showing the ${shown.length} that lean hardest of ${entry.beers.length.toLocaleString('en-US')}. Every hop above links to all of its beers.</p>` : ''}
  </section>` : ''}
  ${siblings.length ? `<section class="block">
    <h2>Also under ${esc(index[parent].label.toLowerCase())}</h2>
    <ul class="tags smell-tags">
      ${siblings.map(([t]) => `<li><a href="${base}smells/${t}/">${esc(index[t].label)} <span class="num">${index[t].hops.length}</span></a></li>`).join('\n      ')}
    </ul>
  </section>` : ''}
  <p class="fine">A beer counts when any of its hops is said to smell of ${esc(lower)}. That's the hop talking, not a
  tasting note on the beer: malt, yeast and how the brewer used the hops all move it.</p>
  ${tip(`Found your ${lower}?`)}
</main>
${footer(base, meta)}`;

  return shell({
    title: `Hops that smell of ${lower}: ${hops.slice(0, 3).map((h) => h.name).join(', ')} and more | HopLove`,
    active: 'smells',
    description: `${hops.length} hops that bring ${lower} — ${hops.slice(0, 5).map((h) => h.name).join(', ')} — and ${entry.beers.length} Pacific Northwest beers that use them.`,
    body,
    base,
  });
}
