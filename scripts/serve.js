#!/usr/bin/env node
// Minimal static server for looking at dist/ locally. No dependency, no config.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { DIST } from './lib/load.js';

const PORT = process.env.PORT ?? 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let path = join(DIST, decodeURIComponent(req.url.split('?')[0]));
  try {
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found. Run npm run build first.');
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`\n  HopLore on http://localhost:${PORT}\n`));
