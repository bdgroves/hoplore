/** How HopLove works, in bar words, and what it is. /about/ */

import { shell, footer, esc, TIP_URL } from './render.js';

export function renderAbout({ meta, stats }) {
  const base = '../';
  const n = (x) => Number(x).toLocaleString('en-US');
  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <h1 class="page-title">How it <em>works</em></h1>
    <p class="standfirst">You're holding a beer. The can says Citra and Mosaic. What does
    that actually mean? HopLove tells you — what each hop smells like, how hard it
    bites, where it was grown, and what else it's in. Here's how to get around.</p>
  </div>
</header>
<main id="main" class="wrap about">

  <section class="block">
    <h2>Four ways in</h2>
    <ol class="ways">
      <li>
        <span class="ways-n">1</span>
        <div><h3><a href="${base}beers/">Find your beer</a></h3>
        <p>Type the beer, the brewery or a hop into the search box on <a href="${base}beers/">What's in the can</a>.
        Tap one and you get its hop bill: every hop in it, what it'll taste like, and similar beers.
        ${n(stats.beers)} beers from ${stats.breweries} breweries so far, most in Washington and Oregon.</p></div>
      </li>
      <li>
        <span class="ways-n">2</span>
        <div><h3><a href="${base}scan/">Snap the can</a></h3>
        <p>Beer not listed? Open <a href="${base}scan/">Scan a beer</a> on your phone and take a picture of the can,
        bottle or tap list (or paste the brewery's description). It reads the hops off it and opens each one up.
        You can suggest it for HopLove from there.</p></div>
      </li>
      <li>
        <span class="ways-n">3</span>
        <div><h3><a href="${base}">Look up a hop</a></h3>
        <p>Every hop has its own page. Start with the gold box at the top: what it smells like, how bitter it is,
        how many beers here use it, what brewers pair it with and what to swap it for. The charts further down are
        for the brewers — skip them if you like.</p></div>
      </li>
      <li>
        <span class="ways-n">4</span>
        <div><h3><a href="${base}compare/">Put two hops head to head</a></h3>
        <p><a href="${base}compare/?a=citra&b=mosaic">Hop vs hop</a> puts any two side by side: what they share,
        which one bites harder, and the beers that use both. Send the link to whoever you're arguing with.</p></div>
      </li>
    </ol>
  </section>

  <section class="block">
    <h2>Reading a beer page</h2>
    <dl class="about-dl">
      <dt>What it'll taste like</dt>
      <dd>The smells of all the hops in the beer, added up. Gold tags are the ones more than one hop shares — the
      beer's likely to lean that way. This comes from the growers' and breeders' notes on each hop, not the brewery's
      marketing.</dd>
      <dt>The hop bill</dt>
      <dd>One card per hop, in the order the brewery lists them. <b>Bitterness</b> says how much bite it brings
      (gentle, moderate, high, very high). <b>Aroma oil</b> is how much smell it packs. The coloured strip is what that
      oil is made of.</dd>
      <dt>Fresh hop</dt>
      <dd>Hops that went from the field into the beer the same day, never dried. Only around harvest, late August
      through October. Green tags mark them.</dd>
      <dt>Cryo, CGX, Incognito…</dt>
      <dd>The same hop, processed into powder or extract. More aroma, less grassy stuff.</dd>
      <dt>Beers like this one</dt>
      <dd>Other beers here with the closest hop bill. If you liked this one, start there.</dd>
    </dl>
  </section>

  <section class="block">
    <h2>Questions people ask</h2>
    <dl class="about-dl faq">
      <dt>Where do the hop lists come from?</dt>
      <dd>The breweries themselves — their own beer pages, read by a script that runs on a schedule. Scanned beers come
      from photos of the can. HopLove doesn't guess a beer's hops from its style.</dd>
      <dt>Why isn't my beer here?</dt>
      <dd>Either the brewery doesn't list hops on its website, or it's not one of the ${stats.breweries} breweries yet.
      <a href="${base}scan/">Scan the can</a> — that's the fastest way in.</dd>
      <dt>Where do the hop numbers come from?</dt>
      <dd>From the people who breed, grow and sell the hops: Yakima Chief, Hopsteiner, BarthHaas, the Hop Breeding
      Company, Indie Hops, Crosby, NZ Hops and more (${stats.sources} sources). When they disagree, HopLove shows the
      spread instead of picking one — that's why you'll see ranges.</dd>
      <dt>Is this Untappd?</dt>
      <dd>No. Brooks's own Untappd check-ins show up next to the beers he's had (that's the "In Brooks's glass" bits),
      but HopLove is its own thing and has nothing to do with Untappd.</dd>
      <dt>Something's wrong. How do I tell you?</dt>
      <dd><a href="https://github.com/bdgroves/hoplore/issues/new">Open an issue on GitHub</a> or
      <a href="mailto:contact@brooksgroves.com">email Brooks</a>. Say which beer or hop, and what you saw.</dd>
      <dt>Can I use the data?</dt>
      <dd>Yes. It's free: <a href="${base}api/v1/hops.json">every hop</a> and <a href="${base}api/v1/beers.json">every beer</a>
      as JSON, no key, under CC BY 4.0. Just say where you got it.</dd>
    </dl>
  </section>

  <section class="block tip-jar">
    <h2>Buy Brooks a beer</h2>
    <p>HopLove is free and staying that way. Keeping it running costs a little — mostly the camera, which pays
    per photo it reads. If it's saved you from a bad six-pack, or settled an argument at the bar, a beer's worth
    of thanks helps cover it.</p>
    <p><a class="tip-btn big" href="${TIP_URL}" rel="noopener">Buy Brooks a beer 🍺</a></p>
    <p class="fine">Through Ko-fi. One-off, any amount.</p>
  </section>

  <section class="block about-me">
    <h2>About HopLove</h2>
    <p>HopLove is a side project by <a href="https://brooksgroves.com/">Brooks Groves</a>, a GIS and data guy in
    Lakewood, Washington, who wanted to look at a can of fresh hop IPA and actually know what was in it. It started as
    a hop database that shows its sources (the working name was HopLore) and grew a beer list, a camera and a lot of
    fresh hop season.</p>
    <p>Nobody's selling you hops, and there are no ads. It isn't affiliated with any brewery, breeder, farm or
    merchant; the variety names belong to their owners. The code and data are on
    <a href="https://github.com/bdgroves/hoplore">GitHub</a>.</p>
    <p class="fine">${stats.hops} hops · ${n(stats.beers)} beers · ${stats.breweries} breweries · ${stats.sources} sources ·
    last built ${esc(meta.built.slice(0, 10))}</p>
  </section>
</main>
${footer(base, meta)}`;

  return shell({
    title: 'How HopLove works | HopLove',
    active: 'about',
    description: 'How to find a beer, read its hops, scan a can and compare hops on HopLove — and where it all comes from.',
    body,
    base,
  });
}
