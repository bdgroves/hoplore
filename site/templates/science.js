/** Hop science: the acids and oils, what they are and what they do, with the
 *  molecules drawn (tools/molecules.py) and the hops on file that carry the
 *  most of each. /science/ */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, footer, esc, tip } from './render.js';

const MOL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'molecules');

function mol(name, label, formula) {
  let svg = readFileSync(join(MOL_DIR, `${name}.svg`), 'utf8');
  svg = svg.replace(/width='\d+px' height='\d+px'/, `width='100%' role='img' aria-label='${label} molecule'`);
  return `<figure class="mol">
      ${svg}
      <figcaption><b>${label}</b> <span class="num">${formula.replace(/(\d+)/g, '<sub>$1</sub>')}</span>
      <button type="button" class="mol-3d" data-mol="${name}">Spin it in 3D</button></figcaption>
    </figure>`;
}

const pct = (v) => `${Math.round(v)}%`;

export function renderScience({ hops, meta }) {
  const base = '../';
  const link = (h) => `<a href="${base}hops/${h.slug}/">${esc(h.name)}</a>`;
  const withOils = hops.filter((h) => h.derived?.oil_profile?.normalized && !h.derived.oil_profile.insufficient);
  const topBy = (oil, n = 5) =>
    withOils
      .filter((h) => (h.derived.oil_profile.normalized[oil] ?? 0) > 0)
      .sort((a, b) => b.derived.oil_profile.normalized[oil] - a.derived.oil_profile.normalized[oil])
      .slice(0, n);
  const leaders = (oil) => {
    const list = topBy(oil);
    return list.length
      ? `<p class="leaders"><span>Most ${oil} on file:</span> ${list.map((h) => `${link(h)} <span class="num fine">${pct(h.derived.oil_profile.normalized[oil])}</span>`).join(' · ')}</p>`
      : '';
  };
  const alpha = hops.filter((h) => h.analytics?.alpha_acid?.typical != null);
  const bitterest = [...alpha].sort((a, b) => b.analytics.alpha_acid.typical - a.analytics.alpha_acid.typical).slice(0, 5);
  const gentlest = [...alpha].sort((a, b) => a.analytics.alpha_acid.typical - b.analytics.alpha_acid.typical).slice(0, 5);
  const coh = hops.filter((h) => h.analytics?.cohumulone?.typical != null);
  const lowCoh = [...coh].sort((a, b) => a.analytics.cohumulone.typical - b.analytics.cohumulone.typical).slice(0, 5);
  const list = (arr, key) => arr.map((h) => `${link(h)} <span class="num fine">${h.analytics[key].typical}%</span>`).join(' · ');

  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <h1 class="page-title">Hop <em>science</em></h1>
    <p class="standfirst">Crack open a hop cone and you'll find sticky yellow powder tucked between the petals.
    That's lupulin, and it's where all the action is: bitter acids that give a beer its bite, and oils that
    give it its smell. Here's what they are, what they look like up close, and what they do in your glass.</p>
    <nav class="sci-toc" aria-label="On this page">
      <a href="#lupulin">The cone</a><a href="#alpha">Alpha acids</a><a href="#beta">Beta acids</a>
      <a href="#oils">The oils</a><a href="#thiols">Thiols</a><a href="#kettle">In the brewhouse</a><a href="#numbers">Reading the numbers</a>
    </nav>
  </div>
</header>
<main id="main" class="wrap science">

  <section class="block" id="lupulin">
    <h2>Inside the cone</h2>
    <div class="sci-split">
      <div>
        <p>A hop cone is the flower of the female hop plant: papery green bracts stacked like shingles. At the base
        of each one sit tiny golden glands of <b>lupulin</b>. Rub a cone between your palms and that's the sticky,
        pungent stuff you smell.</p>
        <p>Lupulin holds two families of chemicals that matter to beer:</p>
        <ul class="sci-list">
          <li><b>Resins</b> — the alpha and beta acids. They make beer bitter, and they help keep it fresh.</li>
          <li><b>Essential oils</b> — a few drops per handful, hundreds of compounds. They make beer smell like
          citrus, pine, flowers or tropical fruit.</li>
        </ul>
        <p>Everything below is one of those two. Each molecule is drawn the way chemists draw them: every corner
        and line-end is a carbon atom, hydrogens are left off, and the red <b>O</b>s are oxygen. Tap
        <b>Spin it in 3D</b> to see the real shape.</p>
      </div>
      <div class="sci-cone" aria-hidden="true">
        <img src="${base}assets/hoplove-badge.png" alt="" width="220" height="220">
      </div>
    </div>
  </section>

  <section class="block" id="alpha">
    <h2>Alpha acids: the bite</h2>
    <p>Alpha acids are why beer is bitter — sort of. Fresh off the plant they're barely soluble and not very
    bitter at all. The magic happens in the boil: heat twists each alpha acid's six-sided ring into a five-sided one,
    making an <b>iso-alpha acid</b>. That new shape dissolves in beer and tastes properly bitter. Brewers call it
    isomerization, and it's the reason bittering hops go in early and boil for an hour.</p>
    <div class="mols">
      ${mol('humulone', 'Humulone', 'C21H30O5')}
      ${mol('isohumulone', 'Isohumulone (after the boil)', 'C21H30O5')}
      ${mol('cohumulone', 'Cohumulone', 'C20H28O5')}
    </div>
    <p>Same atoms, different shape: humulone and isohumulone have the identical formula. The boil just rearranges
    them. Even so, only a fraction of the alpha acids a brewer adds ends up in the beer as iso-alpha acids —
    commonly around a quarter to a third.</p>
    <ul class="sci-list">
      <li><b>Three siblings.</b> Humulone, cohumulone and adhumulone differ only in one small side chain. Hop sheets
      list <b>cohumulone as a % of the alpha</b> because brewers have long thought more of it means a harsher,
      rougher bitterness. The research on that is mixed, but low-cohumulone hops are still sold as "smooth".</li>
      <li><b>IBU</b> (International Bitterness Units) is roughly milligrams of iso-alpha acids per litre of beer.</li>
      <li><b>Skunked beer</b> is an alpha-acid story too: light breaks iso-alpha acids apart into a sulfur compound
      (3-methyl-2-butene-1-thiol, below) that smells like a skunk. It's why beer comes in brown bottles and cans.</li>
      <li>Iso-alpha acids also help beer foam hold up, and they fight off bacteria — the original reason hops went
      into beer at all.</li>
    </ul>
    <div class="mols">${mol('mbt', 'The skunk molecule (MBT)', 'C5H10S')}</div>
    <p class="leaders"><span>Hardest-biting hops on file:</span> ${list(bitterest, 'alpha_acid')}</p>
    <p class="leaders"><span>Gentlest:</span> ${list(gentlest, 'alpha_acid')}</p>
    ${lowCoh.length ? `<p class="leaders"><span>Lowest cohumulone:</span> ${lowCoh.map((h) => `${link(h)} <span class="num fine">${h.analytics.cohumulone.typical}% of alpha</span>`).join(' · ')}</p>` : ''}
  </section>

  <section class="block" id="beta">
    <h2>Beta acids: the slow burn</h2>
    <p>Beta acids (lupulone and its siblings) look a lot like alpha acids with one more side chain, but they don't
    isomerize in the boil and barely dissolve, so fresh they add little bitterness. As hops age and oxidize, beta
    acids break down into bitter compounds — which is partly why old hops still bitter a beer even as their alpha
    acids fade. They're also strongly antibacterial.</p>
    <div class="mols">${mol('lupulone', 'Lupulone', 'C26H38O4')}</div>
    <p>Hop sheets show the <b>alpha-to-beta ratio</b> because it hints at how a hop's bitterness holds up in
    storage.</p>
  </section>

  <section class="block" id="oils">
    <h2>The oils: the smell</h2>
    <p>Hop oil is only about 0.5–3 mL in every 100 g of hops, but it's where nearly all the aroma comes from.
    There are hundreds of compounds in it; a handful do most of the talking. They're volatile — they evaporate
    easily — which is why a long boil strips them out and why aroma hops go in late, in the whirlpool, or into
    the fermenter as a dry hop.</p>

    <div class="sci-oil">
      ${mol('myrcene', 'Myrcene', 'C10H16')}
      <div><h3>Myrcene <span class="swatch" style="--c:#c8922a"></span></h3>
      <p>Green and resinous — the "fresh-cut hop" smell (it's also in bay leaves and ripe mango). Usually the biggest share of the oil, especially in
      American aroma hops, and the most volatile — boil it and it's gone. It's a big part of why fresh hop and heavily
      dry-hopped beers smell so green and juicy.</p>
      ${leaders('myrcene')}</div>
    </div>

    <div class="sci-oil">
      ${mol('humulene', 'Humulene', 'C15H24')}
      <div><h3>Humulene <span class="swatch" style="--c:#3f6b4f"></span></h3>
      <p>Woody, herbal, earthy — the classic "noble hop" note of German and English hops. Named after the hop
      itself (<i>Humulus lupulus</i>). As hops age or cook, humulene oxidizes into compounds brewers describe as
      spicy and "hoppy".</p>
      ${leaders('humulene')}</div>
    </div>

    <div class="sci-oil">
      ${mol('caryophyllene', 'Caryophyllene', 'C15H24')}
      <div><h3>Caryophyllene <span class="swatch" style="--c:#8b3a2a"></span></h3>
      <p>Spicy, peppery, woody. The very same molecule gives black pepper and cloves part of their bite.
      Humulene's close cousin: both are built from the same 15-carbon starting block.</p>
      ${leaders('caryophyllene')}</div>
    </div>

    <div class="sci-oil">
      ${mol('farnesene', 'Farnesene', 'C15H24')}
      <div><h3>Farnesene <span class="swatch" style="--c:#6f7f4a"></span></h3>
      <p>Floral, green, a hint of green apple. Many American hops have almost none; a few European aroma hops —
      Saaz and its relatives especially — are known for it.</p>
      ${leaders('farnesene')}</div>
    </div>

    <div class="sci-oil">
      ${mol('linalool', 'Linalool', 'C10H18O')}
      <div><h3>Linalool <span class="swatch" style="--c:#a8823f"></span></h3>
      <p>Floral, citrusy, lavender-like — it's one of the main scents of lavender and coriander. A small share of
      the oil, but it dissolves into beer better than most, so it's one brewers watch.</p>
      ${leaders('linalool')}</div>
    </div>

    <div class="sci-oil">
      ${mol('geraniol', 'Geraniol', 'C10H18O')}
      <div><h3>Geraniol <span class="swatch" style="--c:#7e6a3c"></span></h3>
      <p>Rose and geranium. The fun part: yeast can convert geraniol into citronellol, which smells more like
      citrus. That's one example of <b>biotransformation</b> — yeast rewriting hop aroma during fermentation, and
      part of why dry-hopping during active fermentation tastes different.</p>
      ${leaders('geraniol')}</div>
    </div>

    <p class="fine">"Most on file" is the share of each hop's oil, from the breeders' and merchants' spec sheets
    HopLove cites. The coloured strip on every hop card uses these same colours.</p>
  </section>

  <section class="block" id="thiols">
    <h2>Thiols: the tiny ones that punch hardest</h2>
    <p>Some of the most powerful hop aromas come from sulfur compounds called thiols, present in parts per
    <i>trillion</i> yet easy to smell. The famous one is <b>4MMP</b>: blackcurrant and passionfruit when there's a
    little, and — honestly — cat pee when there's a lot. It's also in Sauvignon Blanc wine. Hops like Citra and
    Simcoe are known for it, and much of it sits locked up in the hop until yeast frees it during fermentation.</p>
    <div class="mols">${mol('4mmp', '4MMP', 'C6H12OS')}</div>
  </section>

  <section class="block" id="kettle">
    <h2>In the brewhouse: when the hops go in</h2>
    <ol class="kettle">
      <li><b>Boil, 60 minutes</b><span>Alpha acids isomerize into bitterness. The oils boil away. This is the
      bittering addition.</span></li>
      <li><b>Late boil, 5–15 minutes</b><span>Some bitterness, some flavour; a little of the oil survives.</span></li>
      <li><b>Whirlpool, hot but not boiling</b><span>Lots of oil stays in, a little bitterness. The big-flavour
      move in hazy IPAs.</span></li>
      <li><b>Dry hop, in the fermenter</b><span>Cold, no boiling: nearly all the oil makes it into the beer, and
      yeast can transform some of it. Almost no bitterness. This is the "juicy" aroma.</span></li>
      <li><b>Fresh hop</b><span>Hops straight off the bine, never dried, used within hours. Mostly water, so
      brewers use several times as much. Green, grassy, bright — and only once a year.
      <a href="${base}fresh-hop/">See this season's →</a></span></li>
    </ol>
  </section>

  <section class="block" id="numbers">
    <h2>Reading the numbers on a hop page</h2>
    <dl class="about-dl">
      <dt>Alpha acid, e.g. 11–14%</dt><dd>Percent of the dried cone's weight. More alpha, more potential bitterness.
      Under 5% is gentle; 13%+ is a bruiser.</dd>
      <dt>Beta acid</dt><dd>Also % of cone weight. Mostly about storage and aging, not the boil.</dd>
      <dt>Cohumulone, e.g. 22–26%</dt><dd>Not % of the cone — % <i>of the alpha acids</i>. Lower is traditionally
      called smoother.</dd>
      <dt>Total oil, e.g. 1.5–3 mL/100 g</dt><dd>How much aroma a hop packs. Above 2 is a lot.</dd>
      <dt>Myrcene 60%, humulene 15%…</dt><dd>Each oil as a share of the total oil — the coloured strip.</dd>
      <dt>Why ranges?</dt><dd>Every harvest, farm and lab gives slightly different numbers, and HopLove keeps each
      source's figures instead of picking one. The range is where they land.</dd>
    </dl>
  </section>
  ${tip('Nerded out a little?')}
</main>
<dialog class="mol-dialog" id="mol-dialog">
  <div class="mol-dialog-head"><b id="mol-title"></b><button type="button" id="mol-close" aria-label="Close">✕</button></div>
  <div id="mol-view" class="mol-view"></div>
  <p class="fine">Drag to turn it. Grey is carbon, white hydrogen, red oxygen, yellow sulfur. One likely shape,
  worked out with RDKit; real molecules flex.</p>
</dialog>
${footer(base, meta)}
<script src="${base}assets/science.js" type="module"></script>`;

  return shell({
    title: 'Hop science: alpha acids, beta acids and hop oils, explained | HopLove',
    description: 'What hop acids and oils are, what they do in beer, and what they look like at the molecular level — myrcene, humulene, humulone and more.',
    body,
    base,
    active: 'science',
  });
}
