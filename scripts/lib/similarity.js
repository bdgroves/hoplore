/**
 * Data-driven hop substitution.
 *
 * "Find me something like Citra" is really three questions at once: does it
 * bitter the same, does it smell the same, and is it built the same underneath.
 * So the score is three sub-scores, reported separately as well as combined —
 * a brewer swapping a bittering charge cares about a different column than one
 * swapping a dry hop.
 *
 *   chemistry  cosine-ish distance across alpha, beta, cohumulone, total oil
 *   oils       distance across the normalised oil breakdown
 *   aroma      Jaccard overlap of aroma tags, with partial credit for tags
 *              that share a parent family (grapefruit ~ tangerine)
 *
 * Curated substitutes from the YAML files are blended in as a bonus, because a
 * brewer who has actually made the swap outranks a distance metric.
 */

const WEIGHTS = { chemistry: 0.3, oils: 0.3, aroma: 0.4 };
const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

// A score computed from one axis is not the same claim as a score computed
// from three, and must not outrank one. Scores are shrunk toward 0.5 ("we
// don't know") in proportion to how much of the hop is actually measured:
//
//   adjusted = 0.5 + (raw - 0.5) * coverage
//
// Without this, a record with only alpha/beta/cohumulone on file scores its
// bare chemistry number while a fully-measured hop carries the weight of a
// mediocre aroma match — so Simcoe's top substitute came back as Nugget
// (chemistry only, 81) ahead of brewer-tested Citra (all three axes, 75).
// Shrinkage is symmetric on purpose: a bad partial score is pulled up too,
// because one axis is equally weak evidence of a bad match.
const shrink = (raw, coverage) => 0.5 + (raw - 0.5) * coverage;

// Expected spread of each field across the whole hop world, used to normalise
// differences so 2% alpha does not get compared against 40% cohumulone.
const FIELD_SCALE = {
  alpha_acid: 14,
  beta_acid: 6,
  cohumulone: 25,
  total_oil: 3,
};

export function buildSimilarity(hops, aromaTags) {
  const index = new Map(hops.map((h) => [h.slug, h]));

  const results = {};
  for (const hop of hops) {
    const scored = hops
      .filter((other) => other.slug !== hop.slug)
      .map((other) => score(hop, other, aromaTags))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    // Fold in the human-asserted swaps so they always appear, ranked but marked.
    const curated = new Map((hop.substitutes ?? []).map((s) => [s.slug, s]));
    for (const row of scored) {
      const hit = curated.get(row.slug);
      if (hit) {
        row.curated = true;
        row.confidence = hit.confidence ?? null;
        row.note = hit.note ?? null;
        row.score = round(Math.min(1, row.score + confidenceBonus(hit.confidence)));
      }
    }

    results[hop.slug] = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => ({ ...r, name: index.get(r.slug).name }));
  }
  return results;
}

const confidenceBonus = (confidence) => ({ high: 0.2, medium: 0.12, low: 0.05 }[confidence] ?? 0.08);

function score(a, b, aromaTags) {
  const chemistry = chemistryScore(a, b);
  const oils = oilScore(a, b);
  const aroma = aromaScore(a, b, aromaTags);

  const parts = { chemistry, oils, aroma };
  let total = 0;
  let weight = 0;
  for (const [key, value] of Object.entries(parts)) {
    if (value === null) continue;
    total += value * WEIGHTS[key];
    weight += WEIGHTS[key];
  }

  const coverage = weight / TOTAL_WEIGHT;
  const raw = weight ? total / weight : 0;

  return {
    slug: b.slug,
    score: weight ? round(shrink(raw, coverage)) : 0,
    // What the axes on file actually said, before shrinkage. Kept so the
    // difference between "poor match" and "barely measured" stays visible.
    raw_score: weight ? round(raw) : 0,
    coverage: round(coverage, 2),
    parts: {
      chemistry: chemistry === null ? null : round(chemistry),
      oils: oils === null ? null : round(oils),
      aroma: aroma === null ? null : round(aroma),
    },
    // A swap that changes the brewing role is worth flagging even at high score.
    purpose_shift: a.purpose !== b.purpose ? `${a.purpose} to ${b.purpose}` : null,
    curated: false,
  };
}

function chemistryScore(a, b) {
  const fields = Object.keys(FIELD_SCALE).filter(
    (f) => a.analytics?.[f]?.typical != null && b.analytics?.[f]?.typical != null
  );
  if (!fields.length) return null;

  const penalty =
    fields.reduce((sum, f) => {
      const diff = Math.abs(a.analytics[f].typical - b.analytics[f].typical);
      return sum + Math.min(1, diff / FIELD_SCALE[f]) ** 2;
    }, 0) / fields.length;

  return Math.max(0, 1 - Math.sqrt(penalty));
}

function oilScore(a, b) {
  const pa = a.derived?.oil_profile?.normalized;
  const pb = b.derived?.oil_profile?.normalized;
  if (!pa || !pb) return null;

  const keys = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter((k) => k !== 'other');
  if (!keys.length) return null;

  // Manhattan distance over percentage points; 200 is the theoretical maximum.
  const distance = keys.reduce((s, k) => s + Math.abs((pa[k] ?? 0) - (pb[k] ?? 0)), 0);
  return Math.max(0, 1 - distance / 100);
}

function aromaScore(a, b, aromaTags) {
  const ta = a.aroma?.tags ?? [];
  const tb = b.aroma?.tags ?? [];
  if (!ta.length || !tb.length) return null;

  const family = (tag) => aromaTags[tag]?.parent ?? tag;
  const famA = new Set(ta.map(family));
  const famB = new Set(tb.map(family));

  const exact = ta.filter((t) => tb.includes(t)).length;
  const familyOverlap = [...famA].filter((f) => famB.has(f)).length;

  const union = new Set([...ta, ...tb]).size;
  const famUnion = new Set([...famA, ...famB]).size;

  // Exact tag matches count full, family matches count half.
  return round(Math.min(1, (exact / union) * 0.7 + (familyOverlap / famUnion) * 0.5));
}

const round = (n, places = 3) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};
