import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const DATA = join(ROOT, 'data');
export const HOPS_DIR = join(DATA, 'hops');
export const SCHEMA_DIR = join(ROOT, 'schema');
export const DIST = join(ROOT, 'dist');

const readYaml = (path) => YAML.parse(readFileSync(path, 'utf8')) ?? {};

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * Loads everything in data/ into one object. Deliberately does no validation and
 * no rolling up — validate.js and build.js each do their own thing with this.
 */
export function loadDataset() {
  const sources = readYaml(join(DATA, 'sources.yml'));

  const taxonomy = {
    aromaTags: readYaml(join(DATA, 'taxonomy', 'aroma-tags.yml')),
    beerStyles: readYaml(join(DATA, 'taxonomy', 'beer-styles.yml')),
    countries: readYaml(join(DATA, 'taxonomy', 'countries.yml')),
    breeders: readYaml(join(DATA, 'taxonomy', 'breeders.yml')),
  };

  const hops = readdirSync(HOPS_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((file) => ({
      file,
      expectedSlug: basename(file).replace(/\.ya?ml$/, ''),
      ...readYaml(join(HOPS_DIR, file)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { sources, taxonomy, hops };
}

export const schemas = () => ({
  hop: readJson(join(SCHEMA_DIR, 'hop.schema.json')),
  source: readJson(join(SCHEMA_DIR, 'source.schema.json')),
  taxonomy: readJson(join(SCHEMA_DIR, 'taxonomy.schema.json')),
});

/** Every metric key the schema knows about, so tooling never hardcodes a list. */
export const METRIC_KEYS = ['alpha_acid', 'beta_acid', 'cohumulone', 'total_oil', 'hsi', 'alpha_retention_6mo_20c'];
export const OIL_KEYS = ['myrcene', 'humulene', 'caryophyllene', 'farnesene', 'linalool', 'geraniol', 'pinene', 'selinene', 'other'];

export const c = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
