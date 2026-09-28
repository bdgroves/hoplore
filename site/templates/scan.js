/** Scan a beer: photograph a can, a bottle, a tap list, or paste the
 *  brewery's text, and see its hops. The reading is done by Claude through
 *  the same Cloudflare Worker the cookbook's recipe extractor uses (the API
 *  key never reaches the browser). Keeping a scan opens a GitHub issue that
 *  the "Add a scanned beer" workflow turns into data. */

import { shell, footer } from './render.js';

export function renderScan({ meta }) {
  const base = '../';
  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <nav class="nav" style="border-top:0;padding-top:0">
      <a href="${base}">All hops</a>
      <a href="${base}beers/">What's in the can</a>
      <a href="${base}about/">How it works</a>
    </nav>
    <h1 class="page-title">Scan a <em>beer</em></h1>
    <p class="standfirst">Take a picture of the can, the bottle or the tap list —
    or paste the brewery's description — and HopLove reads the hops off it and
    opens each one up. If it's worth keeping, add it to the collection.</p>
  </div>
</header>

<main id="main" class="wrap scan">
  <p class="callout" id="from-checkin" hidden>From your Untappd check-in: <b></b>. Snap the can and HopLove reads the hops.</p>
  <section class="block scan-inputs">
    <div class="scan-grid">
      <div>
        <h2>A photo</h2>
        <label class="dropzone" id="drop">
          <input type="file" id="photo" accept="image/*" capture="environment" hidden>
          <span id="drop-text"><span class="drop-big">📷</span>Tap to take a picture — it reads as soon as you shoot.<br><span class="fine">Or drop / paste an image here.</span></span>
          <img id="preview" alt="" hidden>
        </label>
      </div>
      <div>
        <h2>Or the words</h2>
        <textarea id="text" rows="7" placeholder="Paste the brewery's description, a menu line, the back of the can…"></textarea>
        <label for="hint" class="scan-label">Brewery, if the picture doesn't say (optional)</label>
        <input id="hint" type="text" autocomplete="off" placeholder="e.g. Fremont Brewing">
      </div>
    </div>
    <p><button id="read" class="chip scan-go" type="button">Read the hops</button>
    <span id="status" class="fine" role="status"></span></p>
  </section>

  <section class="block" id="result" hidden>
    <div class="scan-names">
      <label><span class="scan-label">Brewery</span><input id="r-brewery" type="text" autocomplete="off"></label>
      <label><span class="scan-label">Beer</span><input id="r-beer" class="scan-beer" type="text" autocomplete="off" placeholder="The beer's name"></label>
    </div>
    <p class="fine" id="r-where"></p>
    <p class="fine" id="r-meta"></p>
    <p class="fine">As printed: <q id="r-written"></q></p>
    <ul class="hopcards" id="r-hops"></ul>
    <div class="scan-rate">
      <h3>Rate it <span class="fine">· like Untappd, 0.25–5</span></h3>
      <div id="scan-rater"></div>
      <label class="fine"><input type="checkbox" id="rate-on"> Save my rating with it</label>
      <textarea id="scan-note" rows="2" maxlength="600" placeholder="A note, if you like: dank pine resin, grapefruit…"></textarea>
    </div>
    <div class="scan-keep">
      <button id="keep" class="chip scan-go" type="button">Add to HopLove</button>
      <span class="fine" id="keep-note">Opens a GitHub issue with this beer filled in; submit it and the site
      adds the beer and rebuilds in a couple of minutes. Check the hop names first —
      the picture is read by a model, and a misread name is easy to fix in the issue.</span>
    </div>
    <p class="tip">Each photo costs Brooks a few cents to read. <a class="tip-btn" href="https://ko-fi.com/brooksgroves" rel="noopener">Buy him a beer 🍺</a></p>
  </section>
</main>
${footer(base, meta)}
<script src="${base}assets/scan.js" type="module"></script>`;

  return shell({
    title: 'Scan a beer — read the hops off a can | HopLove',
    description: 'Photograph a can, bottle or tap list and see every hop in the beer: aroma, alpha acid and where it was grown.',
    body,
    base,
  });
}
