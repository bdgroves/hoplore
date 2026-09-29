/**
 * brooks-anthropic-proxy  (v2)
 *
 * Cloudflare Worker that does two jobs:
 *   1. POST /                 — Relays requests to the Anthropic Messages API
 *                                (holds ANTHROPIC_API_KEY server-side).
 *                                Used by Nora Reader + Recipe Extractor.
 *   (+ HopLove: /hoplove/ping, /hoplove/save, and limits on POST / — see below)
 *   2. POST /save-recipe      — Appends a recipe object to recipes.json in
 *                                the bdgroves.github.io repo via the GitHub
 *                                API. Holds GITHUB_TOKEN server-side.
 *
 * Secrets (set in Cloudflare → Settings → Variables and Secrets):
 *   ANTHROPIC_API_KEY  — sk-ant-... (already set)
 *   GITHUB_TOKEN       — github_pat_... (fine-grained, Contents R+W, this repo)
 *
 *   HOPLOVE_GITHUB_TOKEN — github_pat_... (fine-grained, Issues R+W, bdgroves/hoplove)
 *   HOPLOVE_KEY          — HopLove owner password (see the HopLove section)
 *
 * KV binding: LIMITS — daily call counts for the Claude proxy limits.
 *
 * Optional plain vars:
 *   GITHUB_OWNER       — defaults to 'bdgroves'
 *   GITHUB_REPO        — defaults to 'bdgroves.github.io'
 *   GITHUB_BRANCH      — defaults to 'main'
 *   ALLOWED_ORIGINS    — comma-separated, defaults below
 */

const DEFAULT_ORIGINS = [
  'https://brooksgroves.com',
  'https://bdgroves.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

// Chunked base64 encoder for arbitrary-size strings.
// Avoids "Maximum call stack size exceeded" from the spread operator
// trick (String.fromCharCode(...bytes)) which blows up around tens of
// thousands of bytes — i.e. once the cookbook has more than a handful
// of recipes.
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const CHUNK = 0x8000; // 32 KB at a time
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Inverse of utf8ToBase64. atob() returns a "binary string" where each
// char code is a single byte; we need to decode those bytes as UTF-8 to
// recover the original string. The naive approach (atob alone) silently
// corrupts non-ASCII characters like em-dashes (—) and degree symbols (°).
function base64ToUtf8(b64) {
  // Strip any whitespace/newlines GitHub adds to the encoded blob
  const clean = b64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function buildCorsHeaders(origin, allowed) {
  const allow = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// ── Route 1: Anthropic API proxy ─────────────────────────────────────
async function handleAnthropic(request, env, cors) {
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: 'ANTHROPIC_API_KEY secret not set.' }, 500, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400, cors);
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (err) {
    return jsonResponse({ error: 'Upstream request failed', detail: String(err) }, 502, cors);
  }
}

// ── Route 2: Append recipe to recipes.json via GitHub API ────────────
async function handleSaveRecipe(request, env, cors) {
  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ error: 'GITHUB_TOKEN secret not set.' }, 500, cors);
  }

  const owner  = env.GITHUB_OWNER  || 'bdgroves';
  const repo   = env.GITHUB_REPO   || 'bdgroves.github.io';
  const branch = env.GITHUB_BRANCH || 'main';
  const path   = 'recipes.json';

  let recipe;
  try {
    const body = await request.json();
    recipe = body.recipe;
    if (!recipe || typeof recipe !== 'object') throw new Error('missing recipe');
    if (!recipe.slug || !recipe.title) throw new Error('recipe must have slug and title');
  } catch (e) {
    return jsonResponse({ error: 'Invalid request body. Expected { recipe: {...} }', detail: String(e) }, 400, cors);
  }

  const githubHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'brooks-anthropic-proxy',
  };

  try {
    // Step 1 — fetch current recipes.json (need its sha for the update)
    const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const getResp = await fetch(getUrl, { headers: githubHeaders });
    if (!getResp.ok) {
      const errText = await getResp.text();
      return jsonResponse({
        error: `Could not read ${path} from GitHub`,
        status: getResp.status,
        detail: errText.slice(0, 400),
      }, 502, cors);
    }
    const fileMeta = await getResp.json();
    const currentSha = fileMeta.sha;

    // Decode base64 content
    const currentJson = base64ToUtf8(fileMeta.content);
    let recipes;
    try {
      recipes = JSON.parse(currentJson);
    } catch (e) {
      return jsonResponse({
        error: 'Existing recipes.json is not valid JSON. Aborting to avoid corruption.',
        detail: String(e),
      }, 500, cors);
    }
    if (!Array.isArray(recipes)) {
      return jsonResponse({
        error: 'Existing recipes.json is not an array. Aborting.',
      }, 500, cors);
    }

    // Step 2 — duplicate-slug check
    const dupe = recipes.find((r) => r.slug === recipe.slug);
    if (dupe) {
      return jsonResponse({
        error: `A recipe with slug "${recipe.slug}" already exists. Edit the slug or remove the existing entry first.`,
        existing_title: dupe.title,
      }, 409, cors);
    }

    // Step 3 — append, re-stringify with the same indentation as the file
    recipes.push(recipe);
    const newJson = JSON.stringify(recipes, null, 2) + '\n';

    // Step 4 — base64-encode for the GitHub API
    // btoa requires latin-1; for safety we go through TextEncoder
    const encoded = utf8ToBase64(newJson);

    // Step 5 — PUT update
    const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const putResp = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...githubHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `feat: add ${recipe.title}`,
        content: encoded,
        sha: currentSha,
        branch,
        committer: {
          name: 'Recipe Extractor',
          email: 'recipes@brooksgroves.com',
        },
      }),
    });

    if (!putResp.ok) {
      const errText = await putResp.text();
      return jsonResponse({
        error: `GitHub commit failed`,
        status: putResp.status,
        detail: errText.slice(0, 400),
      }, 502, cors);
    }

    const result = await putResp.json();
    return jsonResponse({
      ok: true,
      title: recipe.title,
      slug: recipe.slug,
      total_recipes: recipes.length,
      commit_sha: result.commit?.sha,
      commit_url: result.commit?.html_url,
    }, 200, cors);
  } catch (err) {
    return jsonResponse({ error: 'save-recipe failed', detail: String(err) }, 500, cors);
  }
}

// ── Route 3: Delete recipe from recipes.json via GitHub API ──────────
async function handleDeleteRecipe(request, env, cors) {
  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ error: 'GITHUB_TOKEN secret not set.' }, 500, cors);
  }

  const owner  = env.GITHUB_OWNER  || 'bdgroves';
  const repo   = env.GITHUB_REPO   || 'bdgroves.github.io';
  const branch = env.GITHUB_BRANCH || 'main';
  const path   = 'recipes.json';

  let slug;
  try {
    const body = await request.json();
    slug = body.slug;
    if (!slug || typeof slug !== 'string') throw new Error('missing slug');
  } catch (e) {
    return jsonResponse({ error: 'Invalid request body. Expected { slug: "..." }', detail: String(e) }, 400, cors);
  }

  const githubHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'brooks-anthropic-proxy',
  };

  try {
    // Step 1 — fetch current recipes.json
    const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const getResp = await fetch(getUrl, { headers: githubHeaders });
    if (!getResp.ok) {
      const errText = await getResp.text();
      return jsonResponse({
        error: `Could not read ${path} from GitHub`,
        status: getResp.status,
        detail: errText.slice(0, 400),
      }, 502, cors);
    }
    const fileMeta = await getResp.json();
    const currentSha = fileMeta.sha;
    const currentJson = base64ToUtf8(fileMeta.content);

    let recipes;
    try {
      recipes = JSON.parse(currentJson);
    } catch (e) {
      return jsonResponse({
        error: 'Existing recipes.json is not valid JSON. Aborting.',
        detail: String(e),
      }, 500, cors);
    }
    if (!Array.isArray(recipes)) {
      return jsonResponse({ error: 'Existing recipes.json is not an array. Aborting.' }, 500, cors);
    }

    // Step 2 — find and remove the recipe
    const idx = recipes.findIndex((r) => r.slug === slug);
    if (idx === -1) {
      return jsonResponse({ error: `No recipe with slug "${slug}" found.` }, 404, cors);
    }
    const removed = recipes[idx];
    recipes.splice(idx, 1);

    // Step 3 — re-stringify
    const newJson = JSON.stringify(recipes, null, 2) + '\n';
    const encoded = utf8ToBase64(newJson);

    // Step 4 — PUT update
    const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const putResp = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...githubHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore: remove ${removed.title}`,
        content: encoded,
        sha: currentSha,
        branch,
        committer: {
          name: 'Recipe Extractor',
          email: 'recipes@brooksgroves.com',
        },
      }),
    });

    if (!putResp.ok) {
      const errText = await putResp.text();
      return jsonResponse({
        error: 'GitHub commit failed',
        status: putResp.status,
        detail: errText.slice(0, 400),
      }, 502, cors);
    }

    const result = await putResp.json();
    return jsonResponse({
      ok: true,
      removed_title: removed.title,
      removed_slug: removed.slug,
      total_recipes: recipes.length,
      commit_sha: result.commit?.sha,
      commit_url: result.commit?.html_url,
    }, 200, cors);
  } catch (err) {
    return jsonResponse({ error: 'delete-recipe failed', detail: String(err) }, 500, cors);
  }
}

// ── Route 4: Update recipe in recipes.json via GitHub API ────────────
async function handleUpdateRecipe(request, env, cors) {
  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ error: 'GITHUB_TOKEN secret not set.' }, 500, cors);
  }

  const owner  = env.GITHUB_OWNER  || 'bdgroves';
  const repo   = env.GITHUB_REPO   || 'bdgroves.github.io';
  const branch = env.GITHUB_BRANCH || 'main';
  const path   = 'recipes.json';

  let originalSlug, recipe;
  try {
    const body = await request.json();
    originalSlug = body.original_slug;
    recipe = body.recipe;
    if (!originalSlug || typeof originalSlug !== 'string') throw new Error('missing original_slug');
    if (!recipe || typeof recipe !== 'object') throw new Error('missing recipe');
    if (!recipe.slug || !recipe.title) throw new Error('recipe must have slug and title');
  } catch (e) {
    return jsonResponse({
      error: 'Invalid request body. Expected { original_slug: "...", recipe: {...} }',
      detail: String(e),
    }, 400, cors);
  }

  const githubHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'brooks-anthropic-proxy',
  };

  try {
    // Fetch current file
    const getUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    const getResp = await fetch(getUrl, { headers: githubHeaders });
    if (!getResp.ok) {
      const errText = await getResp.text();
      return jsonResponse({
        error: `Could not read ${path} from GitHub`,
        status: getResp.status,
        detail: errText.slice(0, 400),
      }, 502, cors);
    }
    const fileMeta = await getResp.json();
    const currentSha = fileMeta.sha;
    const currentJson = base64ToUtf8(fileMeta.content);

    let recipes;
    try {
      recipes = JSON.parse(currentJson);
    } catch (e) {
      return jsonResponse({
        error: 'Existing recipes.json is not valid JSON. Aborting.',
        detail: String(e),
      }, 500, cors);
    }
    if (!Array.isArray(recipes)) {
      return jsonResponse({ error: 'Existing recipes.json is not an array. Aborting.' }, 500, cors);
    }

    // Find the recipe to update by its original slug
    const idx = recipes.findIndex((r) => r.slug === originalSlug);
    if (idx === -1) {
      return jsonResponse({ error: `No recipe with slug "${originalSlug}" found.` }, 404, cors);
    }

    // If the slug changed, make sure the new slug doesn't collide with another recipe
    if (recipe.slug !== originalSlug) {
      const collision = recipes.findIndex((r, i) => i !== idx && r.slug === recipe.slug);
      if (collision !== -1) {
        return jsonResponse({
          error: `Cannot rename slug to "${recipe.slug}" — another recipe already uses it.`,
        }, 409, cors);
      }
    }

    recipes[idx] = recipe;

    const newJson = JSON.stringify(recipes, null, 2) + '\n';
    const encoded = utf8ToBase64(newJson);

    const putUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const putResp = await fetch(putUrl, {
      method: 'PUT',
      headers: { ...githubHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore: edit ${recipe.title}`,
        content: encoded,
        sha: currentSha,
        branch,
        committer: {
          name: 'Recipe Extractor',
          email: 'recipes@brooksgroves.com',
        },
      }),
    });

    if (!putResp.ok) {
      const errText = await putResp.text();
      return jsonResponse({
        error: 'GitHub commit failed',
        status: putResp.status,
        detail: errText.slice(0, 400),
      }, 502, cors);
    }

    const result = await putResp.json();
    return jsonResponse({
      ok: true,
      title: recipe.title,
      slug: recipe.slug,
      total_recipes: recipes.length,
      commit_sha: result.commit?.sha,
      commit_url: result.commit?.html_url,
    }, 200, cors);
  } catch (err) {
    return jsonResponse({ error: 'update-recipe failed', detail: String(err) }, 500, cors);
  }
}


// ══ HopLove (brooksgroves.com/hoplove) ═══════════════════════════════
// Added Sept 2026. Two jobs:
//   * guardClaude: limits on the Claude proxy (route 1) -- only these
//     origins, any claude-* model, replies up to 4096 tokens, 6 MB body,
//     40 calls per visitor per day and 400 per day in total (counted in the
//     LIMITS KV namespace; skipped if it isn't bound). The recipe routes
//     are not limited.
//   * GET /hoplove/ping and POST /hoplove/save: one-tap saves from the
//     HopLove site. They open an issue on bdgroves/hoplove with the
//     HOPLOVE_GITHUB_TOKEN secret (Issues R+W on that repo only); the
//     HOPLOVE_KEY secret marks a save as Brooks's.

const ORIGINS = ['https://brooksgroves.com', 'https://www.brooksgroves.com', 'https://bdgroves.github.io'];
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
async function guardClaude(request, env) {
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
async function hoplove(request, env) {
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

// ── Main entry ───────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const allowed = env.ALLOWED_ORIGINS
      ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
      : DEFAULT_ORIGINS;
    const origin = request.headers.get('Origin') || '';
    const cors = buildCorsHeaders(origin, allowed);

    // HopLove's routes answer GET and send their own CORS headers.
    if (new URL(request.url).pathname.startsWith('/hoplove/')) {
      return hoplove(request, env);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/save-recipe') {
      return handleSaveRecipe(request, env, cors);
    }

    if (path === '/delete-recipe') {
      return handleDeleteRecipe(request, env, cors);
    }

    if (path === '/update-recipe') {
      return handleUpdateRecipe(request, env, cors);
    }

    // Default: Anthropic proxy -- with HopLove's limits in front of it.
    const refused = await guardClaude(request, env);
    if (refused) return refused;
    return handleAnthropic(request, env, cors);
  },
};