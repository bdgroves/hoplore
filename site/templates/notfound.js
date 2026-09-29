/** 404 for anything under /hoplove/ that isn't a page. GitHub Pages serves
 *  this for every missing path, so links use the absolute base. */

import { shell, footer } from './render.js';

export function renderNotFound({ meta }) {
  const base = '/hoplove/';
  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <h1 class="page-title">This one's <em>tapped out</em></h1>
    <p class="standfirst">Nothing lives at this address — maybe the link was mistyped, or the beer got renamed.
    Search for it instead:</p>
  </div>
</header>
<main id="main" class="wrap">
  <form class="nf-search" action="${base}beers/" method="get">
    <input name="q" id="nf-q" placeholder="A beer, a brewery or a hop" aria-label="Search beers" autocomplete="off">
    <button class="chip scan-go" type="submit">Search</button>
  </form>
  <p class="try">Or go to <a class="chip" href="${base}">All hops</a><a class="chip" href="${base}beers/">What's in the can</a><a class="chip" href="${base}scan/">Scan a beer</a></p>
  <script>
    // Turn the missing address into a guess: /hoplove/beers/fort-george/3-way-ipa-2027/ -> "3 way ipa 2027".
    (() => { const words = location.pathname.split('/').filter(Boolean).pop() || '';
      if (words && words !== 'hoplove') document.getElementById('nf-q').value = decodeURIComponent(words).replace(/[-_]+/g, ' '); })();
  </script>
</main>
${footer(base, meta)}`;
  return shell({ title: 'Page not found | HopLove', description: 'That page isn’t on HopLove.', body, base });
}
