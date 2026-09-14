# Contributing to HopLore

Corrections are worth more than additions here. A new hop with no citations adds noise; a source link on an existing number makes the whole dataset more trustworthy.

## The one rule

**Never write down a range you worked out yourself.**

Record what each source said. The build derives the published figure. This is what makes the dataset auditable, and it is the only rule that is non-negotiable.

```yaml
# Yes — two sources, both preserved, build decides what to publish
alpha_acid:
  unit: percent
  observations:
    - { source: hopsteiner, low: 10.0, high: 12.0 }
    - { source: yvh, typical: 11.4, crop_year: 2024 }

# No — where did this come from? nobody can tell, ever again
alpha_acid: '10-12% (avg 11)'
```

If a value genuinely has one source, that's fine. One cited source beats three uncited ones.

## Adding a hop

1. Copy `data/hops/aramis.yml` — it is the reference record and exercises every field.
2. Name the file after the slug: `data/hops/mount-hood.yml` has `slug: mount-hood`. The validator enforces this.
3. Add any new source to `data/sources.yml` **first**, with a URL and a tier.
4. Use only aroma tags and beer styles that already exist in `data/taxonomy/`. If yours is missing, add it there in the same PR with a `parent` where one fits.
5. Leave fields out rather than guessing. A missing cohumulone is honest; an invented one is a bug that will outlive you.
6. Set `meta.status` and `meta.verification` truthfully:

   | verification | means |
   |---|---|
   | `unverified` | seeded from general knowledge, no real citation yet |
   | `single-source` | one real source |
   | `corroborated` | two or more independent sources, ideally different tiers |

   A record citing a `tier: unsourced` source cannot be `status: published`. CI will stop you.

7. `pixi run validate`, fix what it says, then `pixi run build` to eyeball the page.
8. Open the PR. Say where the numbers came from in the description.

## Source tiers

Tier drives how much a source is trusted when sources disagree:

| tier | weight | what it is |
|---|---|---|
| `breeder` | 1.0 | the people who bred or license the variety |
| `lab` | 1.0 | published GC/HPLC analysis |
| `literature` | 0.9 | books, papers, USDA reports |
| `merchant` | 0.6–0.7 | supplier spec sheets |
| `aggregator` | 0.4 | sites that themselves compiled from elsewhere |
| `unsourced` | 0.1 | placeholder. flagged everywhere. replace on sight. |

Aggregators are cited honestly rather than silently copied. If a number came from one, say so — that's what the tier is for.

## Correcting a number

Best contribution in the repo. Add your observation alongside the existing one instead of replacing it, unless the old one was simply wrong:

```yaml
observations:
  - { source: seed-general-knowledge, low: 4.0, high: 6.0 }   # remove this
  - { source: crosby, low: 4.5, high: 6.5, crop_year: 2024 }  # in favour of this
```

Then drop `meta.verification` from `unverified` to `single-source` and update `meta.last_reviewed`.

## Style

- YAML, two-space indent, no tabs.
- Flow mappings (`{ source: x, low: 1 }`) are fine for observations, but **quote any string containing a comma** or YAML will silently parse it as another key. This has already bitten this repo once.
- Prose fields (`aroma.summary`, `meta.notes`) get block scalars (`>`), and should read like a brewer talking, not a catalogue. Say what the hop actually does in a beer.
- Aroma summaries: be specific and be willing to be negative. "Polarising in quantity" is useful. "Complex and versatile" is not.

## What gets rejected

- Numbers with no source
- Bulk imports scraped from another site's database (their compilation is their work — cite it as an aggregator or read the underlying sheets yourself)
- Aroma tags invented inline instead of added to the taxonomy
- Marketing copy pasted into `aroma.summary`

## Running the checks

```bash
pixi install        # once, after cloning
pixi run validate   # schema + referential integrity + sanity. errors fail CI.
pixi run build      # writes dist/, prints a data-quality report
pixi run serve      # look at it
pixi run check      # exactly what CI runs
```

CI runs `pixi run check` on every push and PR against the same pinned Node
version you have locally, so green here means green there.

Not a pixi user? `npm install && npm run validate` does the same thing — the
pixi tasks just wrap the npm scripts.

## Pre-commit hook

Unquoted commas in a YAML flow mapping (see Style, above) have bitten this
repo more than once — the YAML parses fine, but a chunk of your note text
becomes a phantom key that only surfaces later as an opaque schema error.
A hook catches it before the commit happens:

```bash
git config core.hooksPath .githooks
```

One-time, per clone. After that, `git commit` runs `pixi run lint-yaml`
against whatever YAML you staged and blocks the commit if it finds a
suspicious key.
