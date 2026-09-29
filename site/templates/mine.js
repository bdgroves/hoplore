/** Brooks's own glass: Untappd check-ins and HopLove ratings, joined to the
 *  beers HopLove knows, so a beer page can say "you had this, 4.25 caps" and
 *  a hop page can say "you've had 6 beers with it". */

import { esc } from './render.js';

const squashBrewery = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/&\s*cider(?:y|works)/g, '')
    .replace(/\b(?:brewing|brewery|brews|brewers|company|co|family|beer|ales?)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
// "Fresh Hop Junior (2026)", "Fresh Assassin (2026 Release)" -> the beer.
const squashBeer = (t) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/\([^)]*\b(?:19|20)\d\d\b[^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '');

// The same, without a trailing style: "Topcutter IPA" -> "topcutter".
const styleless = (t) =>
  squashBeer(
    String(t ?? '').replace(
      /(?:\s+(?:west coast|hazy|juicy|double|imperial|india|session|fresh hop|wet hop|american|northwest|nw|cold))*\s+(?:ipa|iipa|dipa|pale ale|pale|ale|lager|pilsner|pils|stout|porter|sour|saison)\s*$/i,
      ''
    )
  );

/** Adds beer.mine = { checkins, rating } to every beer Brooks has had or
 *  rated, and returns the check-ins (newest first) each with .match. */
export function attachMine(breweries, checkins = [], ratings = [], history = []) {
  const byBrewery = new Map();
  for (const b of breweries) {
    for (const key of [squashBrewery(b.brewery.name), squashBrewery(b.brewery.slug)]) if (key) byBrewery.set(key, b);
  }
  const findBrewery = (name) => {
    const key = squashBrewery(name);
    if (byBrewery.has(key)) return byBrewery.get(key);
    // "Double Mountain Brewery & Cidery" vs "Double Mountain": one name
    // containing the other, if it's long enough not to be a coincidence.
    for (const [k, b] of byBrewery) if (k.length >= 5 && key.length >= 5 && (k.startsWith(key) || key.startsWith(k))) return b;
    return null;
  };
  const mine = (beer) => (beer.mine ??= { checkins: [], rating: null });

  // Which HopLove beer an Untappd name is.
  const findBeer = (beerName, breweryName) => {
    const b = findBrewery(breweryName);
    const want = squashBeer(beerName);
    // "Field to Ferment: Centennial" is a release of "Field to Ferment".
    const series = beerName.includes(':') ? squashBeer(beerName.split(':')[0]) : null;
    const bare = styleless(beerName);
    const beer =
      b?.beers.find((x) => squashBeer(x.name) === want || squashBeer(x.slug) === want) ??
      (series ? b?.beers.find((x) => squashBeer(x.name) === series) : null) ??
      // "Fresh Hop Topcutter" is "Fresh Hop Topcutter IPA" on the brewery's site.
      (bare.length >= 4 ? b?.beers.find((x) => styleless(x.name) === bare) : null) ??
      // "Fresh Hop Static Shatter" is the fresh-hop beer the brewery calls "Static Shatter".
      (/^(?:fresh|wet)[- ]hop\s/i.test(beerName)
        ? b?.beers.find((x) => x.hops?.some((h) => h.fresh) && styleless(x.name) === styleless(beerName.replace(/^(?:fresh|wet)[- ]hop\s+/i, '')))
        : null) ??
      null;
    return { b, beer };
  };

  const out = [];
  for (const c of [...checkins].sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.id - a.id)) {
    const { b, beer } = findBeer(c.beer, c.brewery);
    if (beer) mine(beer).checkins.push(c);
    out.push({ ...c, match: beer ? { brewery: b.brewery, beer } : null, breweryMatch: b?.brewery ?? null });
  }

  // A rating set on HopLove beats the latest Untappd rating for the same beer.
  for (const b of breweries) {
    for (const beer of b.beers) {
      const rated = beer.mine?.checkins.find((c) => c.rating != null);
      if (rated) beer.mine.rating = { stars: rated.rating, note: rated.comment ?? null, date: rated.date, via: 'untappd' };
    }
  }
  // Untappd Beer History (data/untappd/history.yml): every beer Brooks has
  // had, with his rating -- fills in beers from before the check-in feed.
  for (const h of history) {
    const { beer } = findBeer(String(h.beer), String(h.brewery));
    if (!beer) continue;
    const m = mine(beer);
    m.history = { first: h.first, last: h.last, total: h.total };
    if (!m.rating && h.rating != null) m.rating = { stars: h.rating, note: null, date: h.last, via: 'untappd' };
  }
  for (const r of ratings) {
    const b = breweries.find((x) => x.brewery.slug === r.brewery);
    const beer = b?.beers.find((x) => x.slug === r.beer);
    if (beer) mine(beer).rating = { stars: r.stars, note: r.note ?? null, date: r.date, via: 'hoplove' };
  }
  return out;
}

/** Five caps, filled to the rating, like Untappd. */
export function caps(stars, { small = false } = {}) {
  if (stars == null) return '';
  const pct = ((stars / 5) * 100).toFixed(1);
  return `<span class="caps${small ? ' small' : ''}" role="img" aria-label="${stars} out of 5"><span class="caps-row" aria-hidden="true">●●●●●</span><span class="caps-fill" style="width:${pct}%" aria-hidden="true">●●●●●</span></span> <b class="num caps-num">${stars}</b>`;
}

const when = (d) => {
  const [y, m, day] = String(d).split('-').map(Number);
  if (!y) return '';
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

/** "In Brooks's glass" on a beer page: rating, check-ins, and a way to rate it. */
export function mineBlock(brewery, beer, base) {
  const m = beer.mine;
  const rating = m?.rating;
  const list = m?.checkins ?? [];
  const had = list.length
    ? `<ul class="checkins">
      ${list
        .map(
          (c) => `<li>${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy">` : ''}<div>
        <p class="ci-when">${when(c.date)}${c.rating != null ? ` · ${caps(c.rating, { small: true })}` : ''}</p>
        ${c.comment ? `<p class="ci-note">${esc(c.comment)}</p>` : ''}
        <p class="fine"><a href="${esc(c.link)}">Check-in on Untappd →</a></p></div></li>`
        )
        .join('\n      ')}
    </ul>`
    : '';
  const since = !list.length && m?.history?.total > 1 ? ` <span class="fine">· had it ${m.history.total} times</span>` : '';
  const head = rating
    ? `<p class="my-rating">${caps(rating.stars)} <span class="fine">${rating.via === 'hoplove' ? 'rated here' : 'on Untappd'}, ${when(rating.date)}</span>${since}</p>
    ${rating.via === 'hoplove' && rating.note ? `<p class="ci-note">${esc(rating.note)}</p>` : ''}`
    : list.length
      ? `<p class="fine">Checked in ${list.length === 1 ? 'once' : `${list.length} times`}, no rating yet.</p>`
      : m?.history
        ? `<p class="fine">Had it ${m.history.total > 1 ? `${m.history.total} times, first` : 'on'} ${when(m.history.first)}.</p>`
        : `<p class="fine">Brooks hasn’t had this one yet.</p>`;
  return `<section class="block my-glass" id="rate" data-brewery="${esc(brewery.slug)}" data-beer="${esc(beer.slug)}" data-name="${esc(beer.name)}" data-brewery-name="${esc(brewery.name)}">
    <h2>In Brooks’s glass</h2>
    ${head}
    ${had}
    <details class="rate-it" hidden><summary>${rating ? 'Re-rate it' : 'Rate it'}</summary>
      <div class="rater" data-stars="${rating?.stars ?? 3.5}"></div>
      <label for="rate-note" class="fine">A note, if you like</label>
      <textarea id="rate-note" rows="2" maxlength="600" placeholder="dank pine resin, grapefruit…"></textarea>
      <p><button type="button" class="chip scan-go" id="rate-save">Save rating</button>
      <span class="fine">Opens a GitHub issue; submitting it records the rating and rebuilds the page.</span></p>
    </details>
  </section>
  <script src="${base}assets/rate.js" type="module"></script>`;
}

/** Hop slug -> { beers, checkins, rated: [stars…] } across everything Brooks has had. */
export function hopsInMyGlass(breweries, hopBill) {
  const out = new Map();
  for (const b of breweries) {
    for (const beer of b.beers) {
      if (!beer.mine) continue;
      for (const e of hopBill(beer)) {
        if (!e.slug) continue;
        const row = out.get(e.slug) ?? { beers: 0, checkins: 0, rated: [] };
        row.beers += 1;
        row.checkins += beer.mine.checkins.length;
        if (beer.mine.rating) row.rated.push(beer.mine.rating.stars);
        out.set(e.slug, row);
      }
    }
  }
  return out;
}

export const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
