#!/usr/bin/env node
/**
 * Catches the "unquoted comma in a YAML flow mapping" bug before it reaches
 * the schema validator.
 *
 *   { source: x, note: Breeder figure, narrower than merchant }
 *
 * parses without a YAML syntax error — the comma just splits the mapping
 * early, so "narrower than merchant" becomes its own key with an implicit
 * null value. validate.js does catch this (ajv rejects the extra key as
 * "must NOT have additional properties"), but by then it just looks like a
 * schema error with no hint about the actual cause. This script names the
 * cause directly: no legitimate key in this dataset contains a space, so any
 * parsed key that does is almost certainly a phantom key from a stray comma.
 *
 * Runs against staged content (`git show :<path>`), not the working tree, so
 * it checks what is actually about to be committed. Intended as a pre-commit
 * hook — see .githooks/pre-commit — but safe to run by hand too:
 *
 *   node scripts/check-yaml-syntax.js
 */
import { execFileSync } from 'node:child_process';
import YAML from 'yaml';

function stagedYamlFiles() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter((f) => /\.ya?ml$/.test(f));
}

function stagedContent(path) {
  return execFileSync('git', ['show', `:${path}`], { encoding: 'utf8' });
}

// A real key in this dataset is a plain identifier: letters, digits, `_`, `-`.
// Anything with whitespace or punctuation in it is leftover sentence text
// that got split off as its own key.
const SUSPICIOUS_KEY = /[\s,]/;

function findPhantomKeys(node, path, hits) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => findPhantomKeys(item, `${path}[${i}]`, hits));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (SUSPICIOUS_KEY.test(key)) {
        hits.push({ path, key });
      }
      findPhantomKeys(value, `${path}.${key}`, hits);
    }
  }
}

const files = stagedYamlFiles();
let failed = false;

for (const file of files) {
  let parsed;
  try {
    parsed = YAML.parse(stagedContent(file));
  } catch (e) {
    console.error(`✗ ${file}: YAML syntax error — ${e.message}`);
    failed = true;
    continue;
  }

  const hits = [];
  findPhantomKeys(parsed, file, hits);
  for (const { path, key } of hits) {
    console.error(`✗ ${path}: suspicious key "${key}"`);
    console.error(`  Looks like an unquoted comma inside a flow mapping split a`);
    console.error(`  sentence into its own key. Quote any note/label string that`);
    console.error(`  contains a comma, e.g. note: "Breeder figure, narrower than merchant"`);
    failed = true;
  }
}

if (failed) {
  console.error('\nYAML check failed — commit blocked.\n');
  process.exit(1);
}

if (files.length) {
  console.log(`✓ ${files.length} staged YAML file(s) checked, no phantom keys found.`);
}
