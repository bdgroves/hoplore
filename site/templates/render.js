/** Plain string templates. No framework — the whole site is static HTML over
 *  the same JSON the API serves, so the site can never drift from the data. */

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

const fmt = (n) => (n == null ? '—' : Number(n).toFixed(Number.isInteger(n) ? 0 : 1));

const UNIT = {
  percent: '%',
  percent_of_alpha: '% of alpha',
  percent_of_total_oil: '% of oil',
  ml_per_100g: ' mL/100g',
  ratio: '',
};

const METRIC_LABEL = {
  alpha_acid: 'Alpha acid',
  beta_acid: 'Beta acid',
  cohumulone: 'Cohumulone',
  total_oil: 'Total oil',
  hsi: 'Hop storage index',
  alpha_retention_6mo_20c: 'Alpha retained, 6 months at 20°C',
};

const OIL_COLOR = {
  myrcene: '#c8901a',
  humulene: '#3b6b4c',
  caryophyllene: '#9a4a2b',
  farnesene: '#6c7f4a',
  linalool: '#a8823f',
  geraniol: '#7e6a3c',
  pinene: '#2f5a4a',
  selinene: '#8a6d55',
  other: '#bcb7a4',
};

function shell({ title, description, body, base = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,400..700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${base}assets/hoplore.css">
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${body}
</body>
</html>`;
}

const footer = (base, meta) => `
<footer class="foot">
  <div class="wrap">
    <p>HopLore is an open dataset first and a website second. Every figure on this
    site is rolled up from cited observations in
    <code>data/hops/</code>, and the same build that made this page wrote
    <code>${base}api/v1/hops.json</code> — free, no key, no rate limit.</p>
    <p>Built ${esc(meta.built)} from ${meta.count} cultivar records.
    Data under CC BY 4.0, code under MIT.
    <a href="https://github.com/bdgroves/hoplore">Source and corrections on GitHub</a>.
    Not affiliated with any hop breeder, farm or merchant; variety names are the
    marks of their owners.</p>
  </div>
</footer>`;

// ------------------------------------------------------------------- index

export function renderIndex({ hops, taxonomy, meta }) {
  const byCountry = new Map();
  for (const hop of hops) {
    if (!byCountry.has(hop.country)) byCountry.set(hop.country, []);
    byCountry.get(hop.country).push(hop);
  }

  const countries = [...byCountry.entries()].sort((a, b) =>
    (taxonomy.countries[a[0]]?.label ?? a[0]).localeCompare(taxonomy.countries[b[0]]?.label ?? b[0])
  );

  const ledger = countries
    .map(
      ([iso, list]) => `
  <section class="country" data-country="${iso}">
    <h2>${esc(taxonomy.countries[iso]?.label ?? iso)}<small>${list.length} ${list.length === 1 ? 'variety' : 'varieties'}</small></h2>
    <div class="rows">
      ${list.map((hop) => row(hop, taxonomy)).join('\n      ')}
    </div>
  </section>`
    )
    .join('\n');

  const withAlpha = hops.filter((h) => h.analytics?.alpha_acid);
  const corroborated = hops.filter((h) => h.meta.verification === 'corroborated').length;

  const body = `
<header class="masthead">
  <div class="wrap">
    <h1 class="wordmark">Hop<span>Lore</span></h1>
    <p class="standfirst">A hop database that shows its working. Every number
    here is a citation, not a claim — and when the breeder and the merchant
    disagree, you get to see both.</p>
    <div class="stats">
      <div><b>${hops.length}</b> cultivars</div>
      <div><b>${meta.sourceCount}</b> sources</div>
      <div><b>${corroborated}</b> corroborated</div>
      <div><b>${withAlpha.length}</b> with full acid data</div>
    </div>
    <nav class="nav">
      <a href="api/v1/hops.json">Download the data</a>
      <a href="api/v1/schema/hop.schema.json">Schema</a>
      <a href="https://github.com/bdgroves/hoplore">GitHub</a>
      <a href="https://github.com/bdgroves/hoplore/issues/new?template=data-correction.yml">Report a wrong number</a>
    </nav>
  </div>
</header>

<main id="main" class="wrap">
  <div class="finder">
    <div>
      <label for="q">Search varieties, aromas, styles</label>
      <input id="q" type="search" autocomplete="off" placeholder="citra, grapefruit, saison…">
    </div>
    <div>
      <label id="filter-label">Narrow by brewing role</label>
      <div class="filters" role="group" aria-labelledby="filter-label">
        <button class="chip" data-filter="aroma" aria-pressed="false">Aroma</button>
        <button class="chip" data-filter="bittering" aria-pressed="false">Bittering</button>
        <button class="chip" data-filter="dual" aria-pressed="false">Dual purpose</button>
        <button class="chip" data-filter="cryo" aria-pressed="false">Available as lupulin powder</button>
        <button class="chip" data-filter="corroborated" aria-pressed="false">Two or more sources</button>
      </div>
    </div>
  </div>

  <div class="ledger" id="ledger">
${ledger}
    <p class="empty" id="empty" hidden>Nothing matches that. Try an aroma
    instead of a name — <em>dank</em>, <em>gooseberry</em>, <em>noble</em> —
    or <a href="https://github.com/bdgroves/hoplore/issues/new?template=add-hop.yml">open an issue to add the hop you were looking for</a>.</p>
  </div>
</main>
${footer('', meta)}
<script src="assets/index.js" type="module"></script>`;

  return shell({
    title: 'HopLore — an open hop variety database that shows its sources',
    description: `Brewing values, oil breakdowns and substitutions for ${hops.length} hop cultivars. Open data, free JSON API, every number cited.`,
    body,
  });
}

function row(hop, taxonomy) {
  const aa = hop.analytics?.alpha_acid;
  const tags = (hop.aroma?.tags ?? []).slice(0, 5).map((t) => taxonomy.aromaTags[t]?.label ?? t);
  const search = [hop.name, ...(hop.aliases ?? []), ...(hop.aroma?.tags ?? []), ...(hop.usage?.beer_styles ?? [])]
    .join(' ')
    .toLowerCase();

  return `<a class="row" href="hops/${hop.slug}/"
     data-search="${esc(search)}"
     data-purpose="${hop.purpose}"
     data-cryo="${Boolean(hop.products?.cryo)}"
     data-verification="${hop.meta.verification}">
        <span class="row-name">${esc(hop.name)}${hop.aliases?.length ? ` <em>${esc(hop.aliases[0])}</em>` : ''}</span>
        <span class="purpose" data-purpose="${hop.purpose}">${hop.purpose === 'dual' ? 'dual' : hop.purpose}</span>
        <span class="row-tags">${esc(tags.join(', '))}</span>
        <span class="row-aa num">${aa ? `${fmt(aa.low)}–${fmt(aa.high)}%` : '—'}</span>
      </a>`;
}

// ---------------------------------------------------------------- hop sheet

export function renderHop({ hop, similar, taxonomy, sources, meta }) {
  const base = '../../';
  const country = taxonomy.countries[hop.country]?.label ?? hop.country;

  const idents = [
    ['Origin', country],
    hop.international_code && ['Code', hop.international_code],
    hop.cultivar_id && ['Selection', hop.cultivar_id],
    hop.pedigree?.released && ['Released', hop.pedigree.released],
    hop.pedigree?.breeder && ['Bred by', taxonomy.breeders[hop.pedigree.breeder]?.label ?? hop.pedigree.breeder],
    hop.ownership?.holder && ['Owner', hop.ownership.holder],
    hop.ownership?.plant_patent && ['Patent', hop.ownership.plant_patent],
  ].filter(Boolean);

  const parents = hop.pedigree?.parents;
  const pedigreeLine = parents?.unknown
    ? `Parentage unrecorded. ${esc(parents.note ?? '')}`
    : parents
      ? `${parents.seed ? parentLink(parents.seed) : '?'}${parents.pollen ? ` × ${parentLink(parents.pollen)}` : ''}${parents.note ? `. ${esc(parents.note)}` : ''}`
      : null;

  const body = `
<header class="masthead" style="padding-top:1.5rem">
  <div class="wrap">
    <nav class="nav" style="border-top:0;padding-top:0">
      <a href="${base}">All varieties</a>
      <a href="${base}api/v1/hops/${hop.slug}.json">This hop as JSON</a>
      <a href="https://github.com/bdgroves/hoplore/blob/main/data/hops/${hop.slug}.yml">Edit the source file</a>
    </nav>
  </div>
</header>

<main id="main" class="wrap sheet">
  <div class="sheet-head">
    <h1>${esc(hop.name)}</h1>
    ${hop.aroma?.summary ? `<p class="standfirst">${esc(hop.aroma.summary)}</p>` : ''}
    <div class="idents">
      <div class="purpose" data-purpose="${hop.purpose}"><b>${hop.purpose === 'dual' ? 'Dual purpose' : cap(hop.purpose)}</b></div>
      ${idents.map(([k, v]) => `<div>${esc(k)} <b>${esc(v)}</b></div>`).join('\n      ')}
      <span class="provenance" data-verification="${hop.meta.verification}">${verificationLabel(hop.meta.verification)}</span>
    </div>
  </div>

  <div class="cols">
    <div>
      ${hop.analytics ? analyticsBlock(hop, sources) : ''}
      ${hop.forms ? formsBlock(hop) : ''}
      ${hop.oils ? oilsBlock(hop) : ''}
    </div>
    <div>
      ${aromaBlock(hop, taxonomy)}
      ${usageBlock(hop, taxonomy)}
      ${substitutesBlock(hop, similar)}
      ${pedigreeLine ? `<section class="block"><h2>Pedigree</h2><p>${pedigreeLine}</p></section>` : ''}
      ${hop.meta.notes ? `<section class="block"><h2>Notes on this record</h2><p>${esc(hop.meta.notes)}</p></section>` : ''}
    </div>
  </div>
</main>
${footer(base, meta)}`;

  // A parent that has its own record gets a link; one that doesn't (the
  // pedigree graph always runs ahead of the dataset) gets a readable name
  // instead of a raw slug. `us`/`uk`/`nz` etc. are country suffixes on
  // disambiguated slugs like brewers-gold-us, so they uppercase rather
  // than title-case.
  function nameOf(slug) {
    if (meta.names[slug]) return meta.names[slug];
    const SUFFIXES = new Set(['us', 'uk', 'gb', 'nz', 'de', 'cz', 'au', 'fr', 'si', 'pl', 'jp', 'za']);
    return slug
      .split('-')
      .map((word) =>
        SUFFIXES.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)
      )
      .join(' ');
  }

  function parentLink(slug) {
    const name = esc(nameOf(slug));
    return meta.names[slug] ? `<a href="${base}hops/${slug}/">${name}</a>` : name;
  }

  return shell({
    title: `${hop.name} hop — brewing values, oils and substitutes | HopLore`,
    description: hop.aroma?.summary?.slice(0, 180) ?? `${hop.name}: a ${hop.purpose} hop from ${country}.`,
    body,
    base,
  });
}

function analyticsBlock(hop, sources) {
  const metrics = Object.entries(hop.analytics)
    .map(([key, m]) => rangeBar(key, m, sources))
    .join('\n');

  const ratio = hop.derived?.alpha_beta_ratio;

  return `<section class="block">
    <h2>Brewing values</h2>
    ${metrics}
    ${ratio ? `<p class="callout">Alpha to beta runs about <span class="num">${ratio.label}</span>, which is what governs how fast the bitterness fades in storage.</p>` : ''}
  </section>`;
}

function rangeBar(key, m, sources) {
  // Pad the axis so the bar never touches the edges of its own scale.
  const pad = Math.max((m.high - m.low) * 0.35, m.high * 0.08, 0.5);
  const min = Math.max(0, m.low - pad);
  const max = m.high + pad;
  const pos = (v) => ((v - min) / (max - min)) * 100;

  const dots = m.sources
    .map(
      (s) =>
        `<span class="bar-dot" data-tier="${s.tier}" style="left:${pos(s.typical).toFixed(2)}%" title="${esc(s.id)}: ${fmt(s.low)}–${fmt(s.high)}"></span>`
    )
    .join('');

  const unit = UNIT[m.unit] ?? '';
  const spread = m.high - m.low;
  const wide = m.source_count > 1 && m.agreement != null && m.agreement < 0.6;

  return `<div class="metric">
      <div class="metric-head">
        <h3>${METRIC_LABEL[key] ?? key}</h3>
        <p class="metric-value num"><b>${fmt(m.low)}–${fmt(m.high)}${unit}</b> <span>typical ${fmt(m.typical)}</span></p>
      </div>
      <div class="bar">
        <span class="bar-span" style="left:${pos(m.low).toFixed(2)}%;width:${(pos(m.high) - pos(m.low)).toFixed(2)}%"></span>
        <span class="bar-typical" style="left:${pos(m.typical).toFixed(2)}%"></span>
        ${dots}
      </div>
      <div class="bar-scale num"><span>${fmt(min)}</span><span>${fmt(max)}</span></div>
      <details class="sources">
        <summary>${m.source_count} ${m.source_count === 1 ? 'source' : 'sources'}${wide ? ', and they disagree' : ''}${spread > 0 ? `, spread of ${fmt(spread)}${unit}` : ''}</summary>
        <ul class="sourcelist">
          ${m.sources
            .map(
              (s) =>
                `<li><span>${esc(sources[s.id]?.publisher ?? s.id)}</span><span class="num">${fmt(s.low)}–${fmt(s.high)}</span>${s.note ? `<span>${esc(s.note)}</span>` : ''}</li>`
            )
            .join('\n          ')}
        </ul>
      </details>
    </div>`;
}

const FORM_LABEL = {
  leaf: 'Whole leaf',
  t90: 'T-90 pellets',
  t45: 'T-45 pellets',
  cryo: 'Cryo',
  lupomax: 'Lupomax',
  'hopsteiner-lupulin': 'Hopsteiner pellet lupulin',
  'co2-extract': 'CO2 extract',
  spectrum: 'Spectrum',
  other: 'Other',
};

/** Same plant, different products, different numbers. Dose by alpha, not weight. */
function formsBlock(hop) {
  const rows = hop.forms
    .map((form) => {
      const aa = form.analytics?.alpha_acid;
      const oil = form.analytics?.total_oil;
      return `<tr>
        <td>${esc(form.product_name ?? FORM_LABEL[form.form] ?? form.form)}</td>
        <td class="num">${aa ? `${fmt(aa.low)}–${fmt(aa.high)}%` : '—'}</td>
        <td class="num">${oil ? `${fmt(oil.low)}–${fmt(oil.high)}` : '—'}</td>
        <td class="num">${form.alpha_factor ? `${form.alpha_factor}×` : '—'}</td>
      </tr>${form.note ? `<tr class="form-note"><td colspan="4">${esc(form.note)}</td></tr>` : ''}`;
    })
    .join('\n      ');

  return `<section class="block">
    <h2>Product formats</h2>
    <table class="forms">
      <thead><tr><th>Format</th><th>Alpha</th><th>Oil mL/100g</th><th>vs whole hop</th></tr></thead>
      <tbody>
      ${rows}
      </tbody>
    </table>
    <p class="callout">Swap a concentrate into a recipe written for pellets at
    the same weight and the bitterness moves by the factor in the last column.
    Dose these by alpha, not by grams.</p>
  </section>`;
}

function oilsBlock(hop) {
  const profile = hop.derived?.oil_profile?.normalized;
  if (!profile) return '';

  const entries = Object.entries(profile).sort((a, b) => b[1] - a[1]);

  const segs = entries
    .map(
      ([key, pct]) =>
        `<div class="stack-seg" style="flex:${pct};background:${OIL_COLOR[key] ?? '#bcb7a4'}" title="${key} ${pct}%"></div>`
    )
    .join('');

  const keys = entries
    .map(
      ([key, pct]) =>
        `<li style="flex:${pct}"><span class="swatch" style="background:${OIL_COLOR[key] ?? '#bcb7a4'}"></span>${cap(key)}<span class="num">${pct}%</span></li>`
    )
    .join('\n        ');

  return `<section class="block">
    <h2>Oil composition</h2>
    <div class="oilstack">
      <div class="stack">${segs}</div>
      <ul class="stack-key">
        ${keys}
      </ul>
    </div>
    <p class="callout">Normalised to 100% so this hop can be compared like for like.
    The published components sum to <span class="num">${hop.derived.oil_profile.raw_sum}%</span>
    of total oil in the source data.</p>
  </section>`;
}

function aromaBlock(hop, taxonomy) {
  if (!hop.aroma?.tags?.length) return '';
  return `<section class="block">
    <h2>Aroma</h2>
    <ul class="tags">
      ${hop.aroma.tags
        .map((t) => {
          const tag = taxonomy.aromaTags[t];
          return `<li${tag?.parent ? ` data-family="${tag.parent}"` : ''}>${esc(tag?.label ?? t)}</li>`;
        })
        .join('\n      ')}
    </ul>
  </section>`;
}

function usageBlock(hop, taxonomy) {
  const timing = hop.usage?.timing ?? [];
  const styles = hop.usage?.beer_styles ?? [];
  if (!timing.length && !styles.length) return '';

  const products = Object.entries(hop.products ?? {})
    .filter(([k, v]) => v === true && k !== 'refs')
    .map(([k]) => ({ cryo: 'Cryo', lupomax: 'LupuLN2 / Lupomax', hopsteiner_pellet_lupulin: 'Hopsteiner pellet lupulin', spectrum_extract: 'Spectrum extract' }[k] ?? k));

  return `<section class="block">
    <h2>How it gets used</h2>
    ${timing.length ? `<p>Added at ${timing.map((t) => t.replace(/-/g, ' ')).join(', ')}.</p>` : ''}
    ${styles.length ? `<ul class="tags">${styles.map((s) => `<li>${esc(taxonomy.beerStyles[s]?.label ?? s)}</li>`).join('')}</ul>` : ''}
    <p class="callout">${products.length ? `Concentrated lupulin formats: ${products.join(', ')}.` : 'No concentrated lupulin format has been produced for this variety.'}</p>
  </section>`;
}

function substitutesBlock(hop, similar) {
  if (!similar?.length) return '';
  return `<section class="block">
    <h2>What to swap it for</h2>
    <ul class="subs">
      ${similar
        .slice(0, 6)
        .map(
          (s) => `<li>
        <div class="sub-head">
          <a href="../${s.slug}/">${esc(s.name)}</a>
          ${s.curated ? `<span class="badge">brewer-tested</span>` : ''}
          <span class="sub-score num">${Math.round(s.score * 100)}</span>
        </div>
        <div class="sub-meta num">aroma ${pct(s.parts.aroma)} · oils ${pct(s.parts.oils)} · chemistry ${pct(s.parts.chemistry)}${s.purpose_shift ? ` · shifts ${esc(s.purpose_shift)}` : ''}</div>
        ${s.note ? `<p class="sub-note">${esc(s.note)}</p>` : ''}
      </li>`
        )
        .join('\n      ')}
    </ul>
    <p class="callout">Scored on aroma overlap, oil composition and acid
    chemistry, then nudged up where a brewer has vouched for the swap by hand.
    Anything under 50 is a different beer, not a substitution.</p>
  </section>`;
}

const pct = (v) => (v == null ? '—' : Math.round(v * 100));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const verificationLabel = (v) =>
  ({ corroborated: 'Two or more independent sources', 'single-source': 'One source', unverified: 'Needs a citation' }[v] ?? v);
