#!/usr/bin/env node
/**
 * Scaffolds a new hop record so nobody has to remember the shape.
 *   node scripts/new-hop.js "Mount Hood" US aroma
 */
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HOPS_DIR, c } from './lib/load.js';

const [name, country = 'US', purpose = 'aroma'] = process.argv.slice(2);

if (!name) {
  console.log(`\n  ${c.bold('Usage')}  node scripts/new-hop.js "Variety Name" [COUNTRY] [purpose]`);
  console.log(c.dim(`  purpose is one of: aroma, bittering, dual\n`));
  process.exit(1);
}

const slug = name
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const path = join(HOPS_DIR, `${slug}.yml`);
if (existsSync(path)) {
  console.log(c.red(`\n  ${slug}.yml already exists.\n`));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);

writeFileSync(
  path,
  `slug: ${slug}
name: ${name}
purpose: ${purpose}
country: ${country}
kind: cultivar

# Delete any block you do not have real data for. An absent field is honest;
# a guessed one is a bug. Register every source in data/sources.yml first.

ownership:
  mark: public
  public_domain: true

pedigree:
  breeder: unknown
  parents: { unknown: true }
  refs: []

aroma:
  summary: >
    What this hop actually does in a beer. Be specific, be willing to be
    negative, and skip the marketing adjectives.
  tags: []
  refs: []

analytics:
  alpha_acid:
    unit: percent
    observations:
      - { source: CHANGE_ME, low: 0, high: 0 }

usage:
  timing: []
  beer_styles: []

products: { cryo: false, lupomax: false }

substitutes: []

meta:
  status: stub
  verification: unverified
  last_reviewed: '${today}'
`
);

console.log(`\n  ${c.green('✓')} created ${c.bold(`data/hops/${slug}.yml`)}`);
console.log(c.dim(`  fill it in, then: npm run validate\n`));
