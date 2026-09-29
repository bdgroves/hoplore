// HopLove additions for the brooks-anthropic-proxy Cloudflare Worker.
//
// That Worker also runs the recipe box (/save-recipe, /update-recipe,
// /delete-recipe) and the Claude proxy the Recipe Extractor and Nora Reader
// use (POST /). This file ADDS to it; it doesn't replace anything.
//
// Two jobs:
//   1. Guard POST / (the Claude proxy): only brooksgroves.com may call it,
//      only known models, a reply-length ceiling, a size limit, a per-visitor
//      limit and a daily ceiling -- so a HopLove post that takes off can't
//      run up the Anthropic bill. The recipe routes are untouched.
//   2. /hoplove/save: one-tap saving for the scan page, "Rate it" and "Edit
//      this beer". With the owner key it files the issue the HopLove
//      workflows act on; for anyone else it files a suggestion they ignore.
//
// Install (Cloudflare dashboard -> Workers & Pages -> brooks-anthropic-proxy):
//   1. Settings -> Variables and Secrets, add two SECRETS (keep the existing ones):
//        HOPLOVE_GITHUB_TOKEN  fine-grained GitHub token, repository bdgroves/hoplove
//                              only, permission "Issues: Read and write"
//        HOPLOVE_KEY           the password you type on the site's 🔒 Brooks button
//   2. Storage & Databases -> KV -> create a namespace "hoplove-limits"; then
//      the Worker's Settings -> Bindings -> add KV namespace, variable name LIMITS.
//      (Without it the limits are simply skipped -- nothing breaks.)
//   3. Edit code: paste everything below this comment block at the very
//      bottom of the Worker's file, then add the three marked lines at the
//      top of its fetch handler (see "HOW TO WIRE IT IN" at the end). Deploy.

const ORIGINS = ['https://brooksgroves.com', 'https://www.brooksgroves.com'];
// Any Claude model: the Nora Reader and Recipe Extractor pick their own, and
// the per-visitor and daily caps are what hold the bill down.
const MODEL = /^claude-[a-z0-9.-]+$/;
const MAX_TOKENS = 4096; // the Recipe Extractor asks for 4096
const MAX_BODY = 6 * 1024 * 1024; // a 1400px JPEG is well under this
const PER_VISITOR_PER_DAY = 40;
const PER_DAY = 400; // every visitor together; roughly a few dollars at most
const REPO = 'bdgroves/hoplove';

const cors = (origin) => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(origin) || origin?.startsWith('http://localhost') ? origin : ORIGINS[0],
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-HopLove-Key',
  'Access-Control-Max-Age': '86400',
});
const json = (data, status, origin) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

async function count(env, key, limit) {
  // KV is eventually consistent, so this is a soft ceiling -- plenty for a
  // side project. Keys expire after two days on their own.
  if (!env.LIMITS) return true; // no KV bound yet: skip the limits rather than break
  const n = Number((await env.LIMITS.get(key)) || 0);
  if (n >= limit) return false;
  await env.LIMITS.put(key, String(n + 1), { expirationTtl: 172800 });
  return true;
}

/** Returns a Response to send instead (a refusal), or null to carry on. */
export async function guardClaude(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (!ORIGINS.includes(origin) && !origin.startsWith('http://localhost')) return json({ error: 'not from brooksgroves.com' }, 403, origin);
  if (request.method !== 'POST') return json({ error: 'POST only' }, 405, origin);
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return json({ error: 'that image is too big' }, 413, origin);
  let body;
  try {
    body = await request.clone().json();
  } catch {
    return json({ error: 'bad request' }, 400, origin);
  }
  if (!MODEL.test(String(body.model || ''))) return json({ error: `model ${body.model} not allowed` }, 400, origin);
  if (!(body.max_tokens > 0) || body.max_tokens > MAX_TOKENS) return json({ error: `max_tokens must be 1-${MAX_TOKENS}` }, 400, origin);
  const day = new Date().toISOString().slice(0, 10);
  const who = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await count(env, `v:${day}:${who}`, PER_VISITOR_PER_DAY))) return json({ error: 'that’s the limit for today — try again tomorrow' }, 429, origin);
  if (!(await count(env, `d:${day}`, PER_DAY))) return json({ error: 'HopLove’s reader is resting for today — try again tomorrow' }, 429, origin);
  return null;
}

/** /hoplove/ping and /hoplove/save */
export async function hoplove(request, env) {
  const origin = request.headers.get('Origin') || '';
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
  if (url.pathname === '/hoplove/ping') return json({ ok: true }, 200, origin);
  if (url.pathname !== '/hoplove/save' || request.method !== 'POST') return json({ error: 'not found' }, 404, origin);
  if (!ORIGINS.includes(origin) && !origin.startsWith('http://localhost')) return json({ error: 'not from brooksgroves.com' }, 403, origin);

  let d;
  try {
    d = await request.json();
  } catch {
    return json({ error: 'bad request' }, 400, origin);
  }
  const kind = ['rating', 'edit'].includes(d.kind) ? d.kind : 'scan';
  let title = String(d.title || '').slice(0, 200);
  let body = String(d.body || '').slice(0, 20000);
  const marker = { rating: 'hoplove-rating', edit: 'hoplove-beer-edit', scan: 'hoplove-beer-scan' }[kind];
  if (!title || !body.includes(marker)) return json({ error: 'not a HopLove save' }, 400, origin);

  const owner = Boolean(env.HOPLOVE_KEY) && request.headers.get('X-HopLove-Key') === env.HOPLOVE_KEY;
  const day = new Date().toISOString().slice(0, 10);
  const who = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!owner) {
    // A visitor's scan becomes a suggestion: the workflows only act on the
    // markers above, so swapping the marker keeps it out of the data until
    // Brooks looks. Ratings are Brooks's alone.
    if (kind !== 'scan') return json({ error: 'ratings and edits are Brooks’s' }, 403, origin);
    if (!(await count(env, `s:${day}:${who}`, 10))) return json({ error: 'that’s plenty of suggestions for today — thanks!' }, 429, origin);
    body = body.replace('<!-- hoplove-beer-scan -->', '<!-- hoplove-suggestion -->\nSuggested from the scan page by a visitor. To add it, edit this line to `<!-- hoplove-beer-scan -->` and save.');
    title = `Suggested: ${title.replace(/^Beer:\s*/, '')}`;
  }

  const r = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.HOPLOVE_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'hoplove-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body }),
  });
  if (!r.ok) return json({ error: `GitHub said ${r.status}` }, 502, origin);
  const issue = await r.json();
  return json({ ok: true, owner, url: issue.html_url }, 200, origin);
}

// HOW TO WIRE IT IN -- at the top of the existing handler, right after it
// works out the URL (async fetch(request, env) { const url = new URL(request.url); ...):
//
//     if (url.pathname.startsWith('/hoplove/')) return hoplove(request, env);
//     if (url.pathname === '/') { const refused = await guardClaude(request, env); if (refused) return refused; }
//
// (If the handler has no `url` variable yet, add `const url = new URL(request.url);`
// first -- that's the third line.) Everything after stays exactly as it was.
//
// If the pasted code complains about `export`, delete the word `export` in
// front of guardClaude and hoplove -- the Cloudflare editor accepts either.
