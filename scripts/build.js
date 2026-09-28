#!/usr/bin/env node
/**
 * One build, three outputs, one source of truth:
 *   dist/api/v1/**   the free JSON API
 *   dist/*.html      the static site, rendered from that same JSON
 *   dist/api/v1/hops.csv  for people who just want a spreadsheet
 *
 * The site cannot drift from the API because it is built out of it.
 */
import { mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadDataset, DIST, ROOT, c } from './lib/load.js';
import { rollupHop } from './lib/rollup.js';
import { buildSimilarity } from './lib/similarity.js';
import { renderIndex, renderHop } from '../site/templates/render.js';
import { renderLandscape } from '../site/templates/landscape.js';
import { renderGrown, acreageFor } from '../site/templates/acreage.js';
import { renderBeer, renderBeers, beersByHop } from '../site/templates/beers.js';
import { renderScan } from '../site/templates/scan.js';
import { attachMine } from '../site/templates/mine.js';

const API_VERSION = 'v1';
const { sources, taxonomy, hops: raw, acreage, breweries, checkins, ratings } = loadDataset();
// Before beersByHop, so hop pages know which of their beers Brooks has had.
const recent = attachMine(breweries, checkins, ratings);
const inBeers = beersByHop(breweries);

rmSync(DIST, { recursive: true, force: true });

const hops = raw.map((h) => {
  const hop = rollupHop(h, sources);
  const grown = acreageFor(hop.slug, acreage);
  const withGrown = grown ? { ...hop, acreage: grown } : hop;
  return inBeers[hop.slug] ? { ...withGrown, beers: inBeers[hop.slug] } : withGrown;
});
const similar = buildSimilarity(hops, taxonomy.aromaTags);

const built = new Date().toISOString();
const meta = {
  built,
  version: API_VERSION,
  count: hops.length,
  sourceCount: Object.keys(sources).length,
  license: 'CC-BY-4.0',
  repository: 'https://github.com/bdgroves/hoplore',
  names: Object.fromEntries(hops.map((h) => [h.slug, h.name])),
};

const out = (p) => join(DIST, p);
const api = (p) => out(join('api', API_VERSION, p));

const write = (path, data) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

// ------------------------------------------------------------------- the API

const envelope = (payload) => ({
  meta: { built, version: API_VERSION, license: meta.license, source: meta.repository },
  ...payload,
});

write(
  api('index.json'),
  envelope({
    hops: hops.map((h) => ({
      slug: h.slug,
      name: h.name,
      aliases: h.aliases ?? [],
      purpose: h.purpose,
      country: h.country,
      alpha_acid: h.analytics?.alpha_acid
        ? { low: h.analytics.alpha_acid.low, high: h.analytics.alpha_acid.high, typical: h.analytics.alpha_acid.typical }
        : null,
      tags: h.aroma?.tags ?? [],
      verification: h.meta.verification,
      completeness: h.derived.completeness,
    })),
  })
);

write(api('hops.json'), envelope({ hops }));
write(api('sources.json'), envelope({ sources }));
write(api('taxonomy.json'), envelope({ taxonomy }));
write(api('similar.json'), envelope({ similar }));
if (acreage) write(api('acreage.json'), envelope({ acreage }));
if (breweries.length) write(api('beers.json'), envelope({ breweries: breweries.map(({ file, ...b }) => ({ ...b, beers: b.beers.map(({ mine, ...beer }) => beer) })) }));

for (const hop of hops) {
  write(api(`hops/${hop.slug}.json`), envelope({ hop, similar: similar[hop.slug] ?? [] }));
  write(api(`similar/${hop.slug}.json`), envelope({ slug: hop.slug, similar: similar[hop.slug] ?? [] }));
}

cpSync(join(ROOT, 'schema'), api('schema'), { recursive: true });

// ------------------------------------------------------------------- the CSV

const CSV_COLUMNS = [
  ['slug', (h) => h.slug],
  ['name', (h) => h.name],
  ['purpose', (h) => h.purpose],
  ['country', (h) => h.country],
  ['alpha_low', (h) => h.analytics?.alpha_acid?.low],
  ['alpha_high', (h) => h.analytics?.alpha_acid?.high],
  ['alpha_typical', (h) => h.analytics?.alpha_acid?.typical],
  ['beta_low', (h) => h.analytics?.beta_acid?.low],
  ['beta_high', (h) => h.analytics?.beta_acid?.high],
  ['cohumulone_low', (h) => h.analytics?.cohumulone?.low],
  ['cohumulone_high', (h) => h.analytics?.cohumulone?.high],
  ['total_oil_low', (h) => h.analytics?.total_oil?.low],
  ['total_oil_high', (h) => h.analytics?.total_oil?.high],
  ['myrcene_pct', (h) => h.derived?.oil_profile?.normalized?.myrcene],
  ['humulene_pct', (h) => h.derived?.oil_profile?.normalized?.humulene],
  ['caryophyllene_pct', (h) => h.derived?.oil_profile?.normalized?.caryophyllene],
  ['aroma_tags', (h) => (h.aroma?.tags ?? []).join('|')],
  ['beer_styles', (h) => (h.usage?.beer_styles ?? []).join('|')],
  ['substitutes', (h) => (h.substitutes ?? []).map((s) => s.slug).join('|')],
  ['verification', (h) => h.meta.verification],
  ['completeness', (h) => h.derived.completeness],
];

const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

write(
  api('hops.csv'),
  [CSV_COLUMNS.map(([h]) => h).join(','), ...hops.map((h) => CSV_COLUMNS.map(([, fn]) => csvCell(fn(h))).join(','))].join('\n')
);

// ------------------------------------------------------------------ the site

write(out('index.html'), renderIndex({ hops, taxonomy, meta }));
write(out('landscape/index.html'), renderLandscape({ hops, meta }));
if (acreage) write(out('grown/index.html'), renderGrown({ acreage, hops, meta }));
write(out('scan/index.html'), renderScan({ meta }));
const bySlug = Object.fromEntries(hops.map((h) => [h.slug, h]));
const beerPaths = [];
if (breweries.length) {
  write(out('beers/index.html'), renderBeers({ breweries, bySlug, meta, recent }));
  for (const b of breweries) {
    for (const beer of b.beers) {
      const path = `beers/${b.brewery.slug}/${beer.slug}/`;
      beerPaths.push(path);
      write(out(`${path}index.html`), renderBeer({ brewery: b.brewery, beer, bySlug, taxonomy, meta }));
    }
  }
}

for (const hop of hops) {
  write(out(`hops/${hop.slug}/index.html`), renderHop({ hop, similar: similar[hop.slug] ?? [], taxonomy, sources, meta, acreageYears: acreage?.years }));
}

cpSync(join(ROOT, 'site', 'assets'), out('assets'), { recursive: true });

write(out('.nojekyll'), '');
write(out('robots.txt'), `User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n`);
write(
  out('sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ['', 'landscape/', ...(acreage ? ['grown/'] : []), 'scan/', ...(breweries.length ? ['beers/', ...beerPaths] : []), ...hops.map((h) => `hops/${h.slug}/`)]
      .map((p) => `  <url><loc>https://brooksgroves.com/hoplore/${p}</loc></url>`)
      .join('\n') +
    `\n</urlset>\n`
);

// ---------------------------------------------------------------- the report

const needsWork = hops.filter((h) => h.derived.relies_on_unsourced);
const avgCompleteness = Math.round(hops.reduce((s, h) => s + h.derived.completeness, 0) / hops.length);

console.log(c.bold('\nHopLove build'));
console.log(`  ${c.green('✓')} ${hops.length} hop pages`);
console.log(`  ${c.green('✓')} ${hops.length * 2 + 5} API files under api/${API_VERSION}/`);
console.log(`  ${c.green('✓')} hops.csv`);
console.log(c.dim(`\n  average completeness ${avgCompleteness}%`));
if (needsWork.length) {
  console.log(c.yellow(`  ${needsWork.length} record(s) still resting on placeholder citations:`));
  console.log(c.dim(`    ${needsWork.map((h) => h.slug).join(', ')}`));
}
console.log(c.dim(`\n  dist/ is ready. pixi run serve to look at it.\n`));
