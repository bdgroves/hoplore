// Save pages whose content is drawn by JavaScript (Square Online shops and
// the like), using a headless browser. Reads raw/pages/render_urls.txt,
// written by `snapshot.py --breweries`, and saves each rendered page where
// snapshot.py would have saved it. Runs on the GitHub runner, which has
// Chrome installed: `npm i --no-save playwright-core && node render.mjs`.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'raw', 'pages');
const list = join(OUT, 'render_urls.txt');
const urls = existsSync(list) ? readFileSync(list, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [];
// "match<TAB>listing url" lines: listing pages drawn by JavaScript. Each is
// rendered and saved, and its links that match are rendered too.
const listingsFile = join(OUT, 'render_listings.txt');
const listings = existsSync(listingsFile)
  ? readFileSync(listingsFile, 'utf8').split('\n').filter((l) => l.includes('\t')).map((l) => l.split('\t'))
  : [];

function target(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/+|\/+$/g, '') || 'index';
  const stem = path.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/\.(html?|pdf|xml)$/, '') + '.html';
  return join(OUT, u.host.replace(/^www\./, ''), stem);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (compatible; HopLove/0.1; +https://github.com/bdgroves/hoplore)' });
let saved = 0;
for (const [match, url] of listings) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    const out = target(url);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await page.content());
    saved++;
    const re = new RegExp(match);
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.href.split('#')[0]));
    let added = 0;
    for (const h of hrefs) if (re.test(h) && !urls.includes(h) && h !== url) { urls.push(h); added++; }
    console.log('listing', url, `+${added}`);
  } catch (e) {
    console.log('FAIL listing', url, e.message.split('\n')[0]);
  }
}
for (const url of urls) {
  const out = target(url);
  if (existsSync(out) && readFileSync(out, 'utf8').length > 5000) continue;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await page.content());
    saved++;
    console.log('rendered', url);
  } catch (e) {
    console.log('FAIL', url, e.message.split('\n')[0]);
  }
}
await browser.close();
console.log(`${saved} page(s) rendered`);
