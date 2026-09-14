#!/usr/bin/env node
/**
 * Coverage report. Not a gate — CI does not fail on any of this, it is a
 * to-do list made visible. Three things:
 *
 *   1. Varieties in data/reference/varieties.yml with no record in data/hops/.
 *   2. Records whose meta.last_reviewed is more than 6 months old.
 *   3. Records still citing seed-general-knowledge (the placeholder tier).
 *
 * The reference list is deliberately not exhaustive and not schema-enforced
 * — see data/reference/varieties.yml for what it is and isn't.
 *
 *   pixi run coverage
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { DATA, loadDataset, c, allRefs } from './lib/load.js';

const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * (365.25 / 2);

const { hops } = loadDataset();

const reference = YAML.parse(readFileSync(join(DATA, 'reference', 'varieties.yml'), 'utf8')) ?? [];

const haveSlugs = new Set(hops.map((h) => h.slug));

// ---------------------------------------------------------------- missing

const missing = reference.filter((v) => !haveSlugs.has(v.slug));

// ------------------------------------------------------------------ stale

const now = Date.now();
const stale = [];
const neverReviewed = [];
for (const hop of hops) {
  const reviewed = hop.meta?.last_reviewed;
  if (!reviewed) {
    neverReviewed.push(hop);
    continue;
  }
  const age = now - new Date(reviewed).getTime();
  if (Number.isNaN(age)) {
    neverReviewed.push(hop);
    continue;
  }
  if (age > SIX_MONTHS_MS) {
    stale.push({ hop, reviewed, months: Math.floor(age / (SIX_MONTHS_MS / 6)) });
  }
}
stale.sort((a, b) => b.months - a.months);

// ------------------------------------------------------------- placeholder

const placeholder = hops.filter((h) => allRefs(h).includes('seed-general-knowledge'));

// ------------------------------------------------------------------- print

function table(rows, cols) {
  if (!rows.length) return;
  const widths = cols.map((col, i) => Math.max(col.label.length, ...rows.map((r) => String(col.get(r)).length)));
  const line = (cells) => '  ' + cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(cols.map((c) => c.label)));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) console.log(line(cols.map((c) => c.get(row))));
}

console.log(c.bold('\nHopLore coverage report'));
console.log(c.dim(`  ${hops.length} records against ${reference.length} known varieties in the reference list\n`));

console.log(c.bold(`Missing (${missing.length})`) + c.dim(' — in the reference list, no record in data/hops/'));
if (missing.length) {
  table(missing, [
    { label: 'slug', get: (v) => v.slug },
    { label: 'name', get: (v) => v.name },
    { label: 'country', get: (v) => v.country ?? '' },
    { label: 'note', get: (v) => v.note ?? '' },
  ]);
} else {
  console.log(c.dim('  none — every reference variety has a record'));
}

console.log(c.bold(`\nStale (${stale.length})`) + c.dim(' — meta.last_reviewed older than 6 months'));
if (stale.length) {
  table(stale, [
    { label: 'slug', get: (r) => r.hop.slug },
    { label: 'last_reviewed', get: (r) => r.reviewed },
    { label: 'status', get: (r) => r.hop.meta?.status ?? '' },
  ]);
} else {
  console.log(c.dim('  none'));
}

if (neverReviewed.length) {
  console.log(c.yellow(`\n  ${neverReviewed.length} record(s) with no meta.last_reviewed at all: `) +
    neverReviewed.map((h) => h.slug).join(', '));
}

console.log(c.bold(`\nStill on placeholder citations (${placeholder.length})`) + c.dim(' — cites seed-general-knowledge'));
if (placeholder.length) {
  console.log('  ' + placeholder.map((h) => h.slug).join(', '));
} else {
  console.log(c.dim('  none — the citation grind is done'));
}

console.log(c.dim('\nReport only. Nothing here fails the build.\n'));
