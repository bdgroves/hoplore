#!/usr/bin/env node
/**
 * Gatekeeper. Runs on every push and every pull request.
 *
 * Errors fail the build. Warnings do not — they are the to-do list, printed so
 * that a gap in the data is visible rather than quietly shipped.
 */
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadDataset, schemas, c, METRIC_KEYS, OIL_KEYS, allMetrics, allRefs } from './lib/load.js';

const { sources, taxonomy, hops } = loadDataset();
const schema = schemas();

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

// ---------------------------------------------------------------- schema pass

const validateHop = ajv.compile(schema.hop);
const validateSources = ajv.compile(schema.source);
const validateTaxonomy = ajv.compile(schema.taxonomy);

if (!validateSources(sources)) {
  for (const e of validateSources.errors) err('sources.yml', `${e.instancePath || '/'} ${e.message}`);
}

for (const [name, vocab] of Object.entries(taxonomy)) {
  if (!validateTaxonomy(vocab)) {
    for (const e of validateTaxonomy.errors) err(`taxonomy/${name}`, `${e.instancePath || '/'} ${e.message}`);
  }
}

for (const hop of hops) {
  const { file, expectedSlug, ...record } = hop;
  if (!validateHop(record)) {
    for (const e of validateHop.errors) err(file, `${e.instancePath || '/'} ${e.message}`);
  }
}

// -------------------------------------------------------- referential integrity

const slugs = new Set(hops.map((h) => h.slug));
const sourceIds = new Set(Object.keys(sources));

for (const hop of hops) {
  const at = (path) => `${hop.file}${path ? ` ${path}` : ''}`;

  if (hop.slug !== hop.expectedSlug) {
    err(at(), `slug "${hop.slug}" does not match filename (expected "${hop.expectedSlug}")`);
  }

  if (!taxonomy.countries[hop.country]) {
    err(at('country'), `"${hop.country}" is not in taxonomy/countries.yml`);
  }
  for (const iso of hop.also_grown_in ?? []) {
    if (!taxonomy.countries[iso]) err(at('also_grown_in'), `"${iso}" is not in taxonomy/countries.yml`);
  }

  for (const tag of hop.aroma?.tags ?? []) {
    if (!taxonomy.aromaTags[tag]) err(at('aroma.tags'), `"${tag}" is not in taxonomy/aroma-tags.yml`);
  }
  for (const style of hop.usage?.beer_styles ?? []) {
    if (!taxonomy.beerStyles[style]) err(at('usage.beer_styles'), `"${style}" is not in taxonomy/beer-styles.yml`);
  }
  if (hop.pedigree?.breeder && !taxonomy.breeders[hop.pedigree.breeder]) {
    err(at('pedigree.breeder'), `"${hop.pedigree.breeder}" is not in taxonomy/breeders.yml`);
  }

  // Substitutes MUST resolve. This is the check a flat list of strings on a
  // web page cannot give you, and the reason substitution here is navigable.
  for (const sub of hop.substitutes ?? []) {
    if (!slugs.has(sub.slug)) err(at('substitutes'), `"${sub.slug}" has no record in data/hops/`);
    if (sub.slug === hop.slug) err(at('substitutes'), 'a hop cannot substitute for itself');
  }
  for (const part of hop.blend_of ?? []) {
    if (!slugs.has(part)) err(at('blend_of'), `"${part}" has no record in data/hops/`);
  }

  // Parents are allowed to point at hops we have not written up yet — the
  // pedigree graph is always ahead of the dataset — but say so out loud.
  for (const [role, parent] of Object.entries(hop.pedigree?.parents ?? {})) {
    if (role === 'unknown' || role === 'note') continue;
    if (!slugs.has(parent)) warn(at('pedigree.parents'), `${role} parent "${parent}" is not yet in the dataset`);
  }

  // A released hop cannot also be superseded, and the target must exist.
  if (hop.superseded_by) {
    if (!slugs.has(hop.superseded_by)) err(at('superseded_by'), `"${hop.superseded_by}" has no record in data/hops/`);
    if (hop.superseded_by === hop.slug) err(at('superseded_by'), 'a hop cannot supersede itself');
  }

  // Every cited source must exist.
  const refs = allRefs(hop);
  for (const ref of new Set(refs)) {
    if (!sourceIds.has(ref)) err(at(), `cites unknown source "${ref}" — add it to data/sources.yml`);
  }

  // ------------------------------------------------------------ sanity checks

  for (const [key, metric] of Object.entries(hop.analytics ?? {})) {
    for (const o of metric.observations) {
      if (o.low != null && o.high != null && o.low > o.high) {
        err(at(`analytics.${key}`), `low ${o.low} is greater than high ${o.high} (${o.source})`);
      }
      if (o.typical != null && o.low != null && o.high != null && (o.typical < o.low || o.typical > o.high)) {
        err(at(`analytics.${key}`), `typical ${o.typical} falls outside ${o.low}-${o.high} (${o.source})`);
      }
      const ceiling = { alpha_acid: 25, beta_acid: 15, cohumulone: 100, total_oil: 6 }[key];
      if (ceiling && Math.max(o.high ?? 0, o.typical ?? 0) > ceiling) {
        err(at(`analytics.${key}`), `${o.high ?? o.typical} exceeds the plausible ceiling of ${ceiling} (${o.source})`);
      }
    }
  }

  // Concentrated formats legitimately exceed the cone ceilings, so they get
  // their own. A Cryo alpha of 24% is normal; 24% on a leaf hop is a typo.
  const CONCENTRATED = new Set(['cryo', 'lupomax', 'hopsteiner-lupulin', 'co2-extract', 'spectrum']);
  for (const form of hop.forms ?? []) {
    const concentrated = CONCENTRATED.has(form.form);
    const ceilings = concentrated
      ? { alpha_acid: 65, beta_acid: 40, cohumulone: 100, total_oil: 30 }
      : { alpha_acid: 25, beta_acid: 15, cohumulone: 100, total_oil: 6 };

    for (const [key, metric] of Object.entries(form.analytics ?? {})) {
      for (const o of metric.observations) {
        if (o.low != null && o.high != null && o.low > o.high) {
          err(at(`forms.${form.form}.${key}`), `low ${o.low} is greater than high ${o.high} (${o.source})`);
        }
        if (Math.max(o.high ?? 0, o.typical ?? 0) > ceilings[key]) {
          err(at(`forms.${form.form}.${key}`), `${o.high ?? o.typical} exceeds the ceiling of ${ceilings[key]} for a ${form.form} product`);
        }
      }
    }

    // A concentrate weaker than the base pellet means the numbers got swapped.
    const baseAlpha = hop.analytics?.alpha_acid?.observations;
    const formAlpha = form.analytics?.alpha_acid?.observations;
    if (concentrated && baseAlpha?.length && formAlpha?.length) {
      const mid = (obs) => {
        const mids = obs.map((o) => o.typical ?? (o.low + o.high) / 2);
        return mids.reduce((a, b) => a + b, 0) / mids.length;
      };
      if (mid(formAlpha) <= mid(baseAlpha)) {
        err(at(`forms.${form.form}`), 'a concentrated format cannot have lower alpha than the whole hop — values likely swapped');
      }
    }
  }

  const formKinds = (hop.forms ?? []).map((f) => f.form);
  if (new Set(formKinds).size !== formKinds.length) {
    err(at('forms'), 'the same format is listed twice');
  }

  // An oil breakdown that does not roughly sum to 100 means a component is
  // missing or double-counted. Tolerant band because sheets genuinely vary.
  const oilKeys = Object.keys(hop.oils ?? {});
  if (oilKeys.length) {
    const sum = oilKeys.reduce((s, k) => {
      const o = hop.oils[k].observations;
      if (!o.length) return s;
      const mids = o.map((x) => x.typical ?? (x.low + x.high) / 2);
      return s + mids.reduce((a, b) => a + b, 0) / mids.length;
    }, 0);
    if (sum < 85 || sum > 115) {
      warn(at('oils'), `components sum to ${sum.toFixed(1)}% of total oil; expected roughly 100%`);
    }
    if (!oilKeys.includes('myrcene')) warn(at('oils'), 'no myrcene figure, which is the one every sheet publishes');
  }

  // A published record should not be resting on placeholder citations.
  const unsourced = new Set(
    refs.filter((r) => sources[r]?.tier === 'unsourced')
  );
  if (hop.meta.status === 'published' && unsourced.size) {
    err(at('meta.status'), `marked published but cites placeholder source(s): ${[...unsourced].join(', ')}`);
  }
  if (hop.meta.verification === 'corroborated') {
    const tiers = new Set(refs.map((r) => sources[r]?.tier));
    if (tiers.size < 2) warn(at('meta.verification'), 'claims corroborated but all citations share one tier');
  }
  if (unsourced.size && hop.meta.verification !== 'unverified') {
    warn(at('meta.verification'), `cites a placeholder source but is not marked unverified`);
  }
  if (!hop.aroma?.summary) warn(at(), 'no aroma summary');
}

// --------------------------------------------------------------- global checks

// Duplicate names are how a dataset ends up with two records for one plant.
const nameIndex = new Map();
for (const hop of hops) {
  for (const name of [hop.name, ...(hop.aliases ?? []), ...(hop.previously_named ?? [])]) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (nameIndex.has(key) && nameIndex.get(key) !== hop.slug) {
      err('names', `"${name}" is claimed by both ${nameIndex.get(key)} and ${hop.slug}`);
    }
    nameIndex.set(key, hop.slug);
  }
}

for (const [id, src] of Object.entries(sources)) {
  if (src.tier !== 'unsourced' && !src.url) warn('sources.yml', `"${id}" has no url`);
}

const cited = new Set(hops.flatMap((h) => allRefs(h)));
for (const id of sourceIds) {
  if (!cited.has(id)) warn('sources.yml', `"${id}" is registered but never cited`);
}

const tagUse = new Set(hops.flatMap((h) => h.aroma?.tags ?? []));
const orphanTags = Object.keys(taxonomy.aromaTags).filter(
  (t) => !tagUse.has(t) && !Object.values(taxonomy.aromaTags).some((v) => v.parent === t)
);
if (orphanTags.length > 20) {
  warn('taxonomy/aroma-tags', `${orphanTags.length} tags are defined but unused — fine early on, worth pruning later`);
}

// Substitution should be a graph you can walk, not a set of dead ends.
const oneWay = [];
for (const hop of hops) {
  for (const sub of hop.substitutes ?? []) {
    const other = hops.find((h) => h.slug === sub.slug);
    if (other && !(other.substitutes ?? []).some((s) => s.slug === hop.slug)) {
      oneWay.push(`${hop.slug} -> ${sub.slug}`);
    }
  }
}
if (oneWay.length) {
  warn('substitutes', `${oneWay.length} one-way suggestion(s), e.g. ${oneWay.slice(0, 3).join(', ')}`);
}

// ----------------------------------------------------------------- report out

const byStatus = hops.reduce((acc, h) => {
  acc[h.meta.status] = (acc[h.meta.status] ?? 0) + 1;
  return acc;
}, {});

console.log(c.bold(`\nHopLore data check`));
console.log(c.dim(`  ${hops.length} cultivars, ${sourceIds.size} sources, ${Object.keys(taxonomy.aromaTags).length} aroma tags`));
console.log(c.dim(`  status: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}`));

if (warnings.length) {
  console.log(c.yellow(`\n${warnings.length} warning${warnings.length === 1 ? '' : 's'}`));
  for (const w of warnings) console.log(`  ${c.yellow('~')} ${w}`);
}

if (errors.length) {
  console.log(c.red(`\n${errors.length} error${errors.length === 1 ? '' : 's'}`));
  for (const e of errors) console.log(`  ${c.red('x')} ${e}`);
  console.log(c.red(`\nData check failed.\n`));
  process.exit(1);
}

console.log(c.green(`\nAll checks passed.\n`));
