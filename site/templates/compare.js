/** Compare two hops side by side: /compare/?a=citra&b=mosaic. The page is a
 *  shell; site/assets/compare.js fills it from the per-hop API files. */

import { shell, footer } from './render.js';

export function renderCompare({ meta }) {
  const base = '../';
  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <nav class="nav" style="border-top:0;padding-top:0">
      <a href="${base}">All hops</a>
      <a href="${base}beers/">What's in the can</a>
      <a href="${base}scan/">Scan a beer 📷</a>
    </nav>
    <h1 class="page-title">Hop <em>vs</em> hop</h1>
    <p class="standfirst">Pick two hops and see them side by side: what each smells
    like, how hard it bitters, what brewers pair it with, and which beers use both.</p>
  </div>
</header>
<main id="main" class="wrap compare">
  <form class="cmp-pick" id="cmp-pick">
    <label><span class="scan-label">This hop</span><input id="cmp-a" list="cmp-names" autocomplete="off" placeholder="Citra"></label>
    <button type="button" class="chip cmp-swap" id="cmp-swap" aria-label="Swap the two hops">⇄</button>
    <label><span class="scan-label">That hop</span><input id="cmp-b" list="cmp-names" autocomplete="off" placeholder="Mosaic"></label>
    <datalist id="cmp-names"></datalist>
  </form>
  <p class="try">Try <button type="button" class="chip" data-pair="citra,mosaic">Citra vs Mosaic</button><button type="button" class="chip" data-pair="strata,nelson-sauvin">Strata vs Nelson</button><button type="button" class="chip" data-pair="simcoe,columbus">Simcoe vs Columbus</button><button type="button" class="chip" data-pair="saaz-cz,hallertau-mittelfrueh">Saaz vs Hallertau</button></p>
  <p class="fine" id="cmp-status" role="status"></p>
  <div id="cmp-out"></div>
</main>
${footer(base, meta)}
<script src="${base}assets/compare.js" type="module"></script>`;

  return shell({
    title: 'Compare two hops side by side | HopLove',
    description: 'Put any two hops next to each other: aroma, bitterness, oils, what brewers pair them with, and the beers that use both.',
    body,
    base,
  });
}
