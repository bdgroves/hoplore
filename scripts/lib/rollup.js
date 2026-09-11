import { METRIC_KEYS, OIL_KEYS } from './load.js';

/**
 * Turn a list of per-source observations into one published figure.
 *
 * The rule, stated plainly so nobody has to read the code to trust the number:
 *
 *   low       = the lowest value any source reported
 *   high      = the highest value any source reported
 *   typical   = trust-weighted mean of each source's own typical (or midpoint)
 *   agreement = how tightly the sources cluster, 0 to 1
 *
 * Widening to the union of all sources is a choice. A hop that one merchant
 * lists at 5.5% alpha and the breeder lists at 8.5% genuinely can arrive at
 * either number depending on crop and lot, and a brewer is better served by
 * seeing that than by seeing an average that matches no real sack of hops.
 */
export function rollupMetric(metric, sources) {
  if (!metric?.observations?.length) return null;

  const obs = metric.observations.map((o) => {
    const low = o.low ?? o.typical;
    const high = o.high ?? o.typical;
    const typical = o.typical ?? (low + high) / 2;
    const weight = sources[o.source]?.weight ?? 0.5;
    return { ...o, low, high, typical, weight };
  });

  const low = Math.min(...obs.map((o) => o.low));
  const high = Math.max(...obs.map((o) => o.high));

  const totalWeight = obs.reduce((s, o) => s + o.weight, 0);
  const typical = totalWeight
    ? obs.reduce((s, o) => s + o.typical * o.weight, 0) / totalWeight
    : (low + high) / 2;

  return {
    unit: metric.unit,
    low: round(low),
    high: round(high),
    typical: round(typical),
    agreement: agreementScore(obs, low, high),
    source_count: new Set(obs.map((o) => o.source)).size,
    sources: obs.map((o) => ({
      id: o.source,
      tier: sources[o.source]?.tier ?? 'unsourced',
      low: round(o.low),
      high: round(o.high),
      typical: round(o.typical),
      crop_year: o.crop_year,
      note: o.note,
    })),
  };
}

/**
 * 1.0 when every source reported the same thing, falling off as the spread of
 * their midpoints grows relative to the overall range. A single source scores
 * null, not 1.0 — one source agreeing with itself is not agreement.
 */
function agreementScore(obs, low, high) {
  if (obs.length < 2) return null;
  const span = high - low;
  if (span === 0) return 1;
  const mids = obs.map((o) => o.typical);
  const mean = mids.reduce((a, b) => a + b, 0) / mids.length;
  const sd = Math.sqrt(mids.reduce((s, m) => s + (m - mean) ** 2, 0) / mids.length);
  return round(Math.max(0, 1 - (sd / span) * 2), 3);
}

const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Roll an entire hop record. Returns a plain object ready to serialise as API JSON. */
export function rollupHop(hop, sources) {
  const analytics = {};
  for (const key of METRIC_KEYS) {
    const rolled = rollupMetric(hop.analytics?.[key], sources);
    if (rolled) analytics[key] = rolled;
  }

  const oils = {};
  for (const key of OIL_KEYS) {
    const rolled = rollupMetric(hop.oils?.[key], sources);
    if (rolled) oils[key] = rolled;
  }

  const citedSources = new Set();
  for (const bucket of [analytics, oils]) {
    for (const m of Object.values(bucket)) m.sources.forEach((s) => citedSources.add(s.id));
  }
  for (const ref of [...(hop.aroma?.refs ?? []), ...(hop.pedigree?.refs ?? [])]) citedSources.add(ref);

  const forms = (hop.forms ?? []).map((form) => {
    const rolled = {};
    for (const key of ['alpha_acid', 'beta_acid', 'cohumulone', 'total_oil']) {
      const m = rollupMetric(form.analytics?.[key], sources);
      if (m) rolled[key] = m;
    }
    (form.refs ?? []).forEach((r) => citedSources.add(r));
    for (const m of Object.values(rolled)) m.sources.forEach((s) => citedSources.add(s.id));

    // How much stronger this format is than the whole hop. This is the number a
    // brewer actually needs when swapping Cryo into a recipe written for T90.
    const base = analytics.alpha_acid?.typical;
    const here = rolled.alpha_acid?.typical;
    return {
      ...form,
      analytics: Object.keys(rolled).length ? rolled : null,
      alpha_factor: base && here ? round(here / base) : null,
    };
  });

  const { file, expectedSlug, ...rest } = hop;

  return {
    ...rest,
    forms: forms.length ? forms : null,
    kind: hop.kind ?? 'cultivar',
    analytics: Object.keys(analytics).length ? analytics : null,
    oils: Object.keys(oils).length ? oils : null,
    derived: {
      alpha_beta_ratio: alphaBetaRatio(analytics),
      oil_profile: oilProfile(oils),
      completeness: completeness(hop, analytics, oils),
      cited_sources: [...citedSources].sort(),
      relies_on_unsourced: [...citedSources].some((id) => sources[id]?.tier === 'unsourced'),
    },
  };
}

function alphaBetaRatio(analytics) {
  const a = analytics.alpha_acid?.typical;
  const b = analytics.beta_acid?.typical;
  if (!a || !b) return null;
  return { value: round(a / b), label: `${round(a / b, 1)}:1` };
}

/**
 * Normalise the oil breakdown to sum to 100 so two hops can be compared even
 * when their sheets total 94% and 103%. The raw numbers stay untouched above.
 */
function oilProfile(oils) {
  const keys = Object.keys(oils);
  if (!keys.length) return null;
  const raw = Object.fromEntries(keys.map((k) => [k, oils[k].typical]));
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  if (!sum) return null;
  return {
    raw_sum: round(sum, 1),
    normalized: Object.fromEntries(keys.map((k) => [k, round((raw[k] / sum) * 100, 1)])),
  };
}

/** A blunt 0-100 score, surfaced on the site so gaps are visible instead of invisible. */
function completeness(hop, analytics, oils) {
  const checks = [
    Boolean(hop.aroma?.summary),
    (hop.aroma?.tags?.length ?? 0) >= 3,
    Boolean(hop.pedigree?.released || hop.pedigree?.year_crossed),
    Boolean(hop.pedigree?.parents?.seed || hop.pedigree?.parents?.unknown),
    Boolean(analytics.alpha_acid),
    Boolean(analytics.beta_acid),
    Boolean(analytics.cohumulone),
    Boolean(analytics.total_oil),
    Object.keys(oils).length >= 4,
    (hop.usage?.beer_styles?.length ?? 0) >= 1,
    (hop.substitutes?.length ?? 0) >= 1,
    Boolean(hop.ownership?.mark),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
