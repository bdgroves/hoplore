# HopLore

**An open hop database that shows its working.**

Every hop spec sheet on the internet hands you one confident number. `Alpha: 5.5–8.5%`. Cool. Says who? Measured when? In whose field, in what crop year, by the people who bred it or by a shop trying to move last season's crop?

Nobody says. So I built a database that does.

**132 cultivars. 67 with real breeder-tier citations. Every number traceable to whoever actually said it.**

---

## The thing that set me off

I went looking for Aramis data one night — a French aroma hop, Strisselspalt crossed with WGV back in 2002 — and found four sites giving four different alpha ranges. One of them was honest enough to admit in its own methodology page that its sources were *"different or blatantly contradictory"* and that the fix was to widen the range until everything fit inside it.

Which, fine. That is a reasonable thing to do. But it means the range you're reading is an artifact of an editorial decision made by a stranger, and you cannot see the decision, and you cannot check it, and you cannot disagree with it.

I brew on a 10-gallon system in the garage with a notebook full of crossed-out numbers. I am not going to pretend I need four-decimal precision on cohumulone. But I do want to know whether the 5.5% low end came from the breeder or from a shop trying to move last year's crop, because those two numbers mean completely different things when I'm building a bittering charge.

So: store the observations. Derive the range. Show both.

```yaml
alpha_acid:
  unit: percent
  observations:
    - { source: beermaverick, low: 5.5, high: 8.5, typical: 7.0 }
    - { source: hops-france,  low: 7.0, high: 8.5, note: 'Breeder figure, narrower than merchant spread.' }
```

That's the whole thesis. Nobody hand-writes a published range in this repo. You write down what each source actually said, and `pixi run build` rolls it up into `5.5–8.5%, typical 7.5, agreement 0.75, 2 sources` — and the site renders the breeder's number and the aggregator's number as two separate dots on the same bar so you can *see* them disagree.

---

## What's in the jar

```
data/hops/*.yml         one file per cultivar — the actual product
data/sources.yml        the source registry. no entry, no number.
data/taxonomy/          controlled vocabulary for aroma, styles, countries, breeders
schema/                 JSON Schema 2020-12. the contract.
scripts/validate.js     the bouncer
scripts/build.js        observations in, API + website out
site/                   templates and styles for the static site
tools/ingest/           scrapers that turn breeder sheets into observations
dist/                   generated. gitignored. never edit.
```

Three outputs from one build, which is the point — the website is rendered *from* the API JSON, so the site can't drift from the data:

| Output | What it is |
|---|---|
| `dist/api/v1/**` | A free JSON API. No key, no auth, no rate limit, CORS wide open. |
| `dist/index.html` + `dist/hops/<slug>/` | The static site. Works with JavaScript off. |
| `dist/api/v1/hops.csv` | For when you just want to open it in a spreadsheet like a normal person. |

---

## Run it

```bash
git clone git@github.com:bdgroves/hoplore.git
cd hoplore
pixi install

pixi run validate    # yells at you about the data
pixi run build       # writes dist/
pixi run serve       # http://localhost:4173
pixi run coverage    # what's missing, what's stale, what's still on placeholders
```

Node is pinned in `pixi.toml` and locked in `pixi.lock`, so a fresh clone on any
machine builds byte-identical output. That matters more than usual for a project
whose entire pitch is "you can check my work" — if the build isn't reproducible,
neither is the data.

There's a second environment for the Python side of things, installed only when
you ask for it, because nobody adding a hop record should have to download
pandas to do it:

```bash
pixi run -e data hopsteiner centennial
```

If you'd rather not use pixi, `npm install && npm run build` works fine — the
pixi tasks are thin wrappers around the npm scripts.

`pixi run validate` is the interesting one. It is deliberately hard to please.

It checks the schema, then it checks the things a schema can't: that every cited source exists in the registry, that every substitute points at a hop that actually has a record, that no aroma tag has been invented on the spot, that oil components sum to roughly 100%, that nobody typed a cohumulone of 420, that a record marked `published` isn't quietly resting on placeholder citations, and that substitution suggestions go both ways so the graph is walkable instead of full of dead ends.

Errors fail the build. Warnings don't — they print as a to-do list, because a visible gap beats an invisible guess.

```
HopLore data check
  132 cultivars, 12 sources, 63 aroma tags
  status: 118 stub, 1 published, 13 draft

122 warnings
  ~ chinook.yml oils: no myrcene figure, which is the one every sheet publishes
  ~ centennial.yml meta.verification: cites a placeholder source but is not marked unverified
  ...

All checks passed.
```

That myrcene warning is a good example of the validator earning its keep. It's
not a bug in the pipeline — Hopsteiner's sheets genuinely don't publish myrcene,
which is usually the single biggest component of a hop's oil. So the tool tells
you the breakdown is incomplete instead of quietly drawing you a pie chart that
adds up to 4%.

---

## Substitution, done with math instead of vibes

"What can I use instead of Citra" is really three questions wearing a trenchcoat, so `scripts/lib/similarity.js` answers all three separately:

- **chemistry** — scaled distance across alpha, beta, cohumulone, total oil
- **oils** — distance across the normalised oil breakdown, so myrcene-bombs cluster with myrcene-bombs
- **aroma** — tag overlap, with partial credit where two tags share a parent family, because grapefruit and tangerine are not strangers

Then curated swaps — the ones a human vouched for in the YAML — get a bonus on top, because a brewer who has actually made the swap beats a distance metric every time.

```
Citra →  Mosaic         86   chem 0.91  oils 0.83  aroma 0.33  [brewer-tested]
         Simcoe         70   chem 0.84  oils 0.96  aroma 0.42
         Centennial     64   chem 0.83  oils 0.85  aroma 0.23
         Nelson Sauvin  49   chem 0.67  oils 0.24  aroma 0.41
```

Nelson scoring 49 is the system working. Nothing substitutes for Nelson Sauvin. The number agrees.

---

## A hop is not one product

Idaho 7 T-90 pellets and Idaho 7 Cryo are the same plant with different numbers.
Cryo is lupulin separated from the vegetal fraction, so alpha and oil roughly
double. Every hop database I've looked at models this as a checkbox — "Cryo
available: yes" — which tells you nothing you can brew with.

So formats are first-class:

```yaml
forms:
  - form: t90
    analytics:
      alpha_acid:
        observations: [{ source: ych, low: 10.0, high: 14.0 }]
  - form: cryo
    product_name: Cryo Hops / LupuLN2
    analytics:
      alpha_acid:
        observations: [{ source: ych, low: 20.0, high: 26.0 }]
```

The build derives an `alpha_factor` per format — Idaho 7 Cryo comes out at
**1.92×** the whole hop — because that is the number you need when dropping a
concentrate into a recipe written for pellets. Dose by alpha, not by grams.

The validator knows a concentrate cannot be weaker than the hop it came from,
and applies different plausibility ceilings to concentrated formats, because 24%
alpha is normal for Cryo and a typo on a leaf hop.

## Pulling data in

`tools/ingest/` holds scrapers. The first one reads Hopsteiner's variety data
sheets, which are plain HTML tables with a "last changed" date on each:

```bash
pixi run -e data hopsteiner-discover      # what do they actually publish?
pixi run -e data hopsteiner centennial     # dry run
pixi run -e data hopsteiner centennial --apply
```

Dry run by default. It prints what it found, then a reconciliation report
against what is already on file:

```
  !! cohumulone: on file 18-25 (seed-general-knowledge), hopsteiner says 18.0-28.0
```

`!!` means it disagrees with a placeholder — the placeholder was probably wrong.
`~` means it disagrees with a real source, which is not an error. Two sources
disagreeing is the thing this project exists to show.

An ingest script writes observations and nothing else. It never averages, never
merges, never touches an observation belonging to another source. All the
arithmetic stays in `rollup.js` at build time where it is visible.

## The API

Static JSON on a CDN, which means it costs nothing to run and can't go down independently of the site.

```
GET /api/v1/index.json            slim list, ~all you need for search
GET /api/v1/hops.json             everything
GET /api/v1/hops/citra.json       one hop, ranges + every underlying observation
GET /api/v1/similar/citra.json    ranked substitutes with component scores
GET /api/v1/sources.json          the source registry
GET /api/v1/taxonomy.json         aroma tags, styles, countries, breeders
GET /api/v1/hops.csv              the whole thing, flattened
GET /api/v1/schema/hop.schema.json
```

Every response carries a `meta` envelope with the build timestamp and license. `v1` will not break. If the shape needs to change, it becomes `v2` and `v1` keeps working.

Building something with it? Go ahead — it's CC BY 4.0, just credit it. I'd love to hear about it.

---

## Honest state of the data

Nobody gets to skip this section. Here's exactly where it stands:

| | count | what that means |
|---|---|---|
| Cultivars | **132** | every one has a record, a page and an API endpoint |
| Cite a real source | **67** | mostly Hopsteiner, tier `breeder`, weight 1.0 |
| Still cite a placeholder | **13** | the original seed pass, flagged everywhere |
| Bare stubs, no numbers yet | **60** | real varieties, no data pulled in yet |

I bootstrapped the first records from general brewing knowledge so there'd be
something to build the tooling against, and every one of those citations points
at a source called `seed-general-knowledge` with `tier: unsourced` and
`weight: 0.1`. The validator flags them. The build report lists them by name.
The site renders them with a red dot that says "needs a citation."

That's not modesty, it's the design. A dataset that can't tell you which of its
numbers to distrust is worse than no dataset. Replacing a
`seed-general-knowledge` citation with a real breeder sheet is the single most
useful thing anyone can do here, and it's a five-line diff.

The 60 bare stubs are the same principle pointed the other way. They're real
cultivars with real names and no invented numbers behind them — an empty record
that says "we don't have this yet" beats a full one padded out with plausible
guesses. They're waiting on a source that actually covers them.

Aramis is the fully-worked example for a single hop — copy its shape. Idaho 7
is the example for formats, and for the hard case in coverage: a hop bred by a
family farm in Wilder, Idaho, distributed by three separate companies, that no
breeder scraper will ever find.

Hallertau Mittelfrüh shows the machinery working. Hopsteiner's sheet puts
cohumulone at 18–28% against the placeholder's 18–25%, so the published range
widened and the typical shifted toward the breeder — Hopsteiner carries a trust
weight of 1.0, the placeholder 0.1.

---

## Contributing

Adding a hop is: copy `data/hops/aramis.yml`, change everything, cite your sources in `data/sources.yml`, run `pixi run validate`, open a PR. CI runs `pixi run check` — the same command, the same pinned Node — so if it's green locally it's green there.

Full instructions with the gotchas are in [CONTRIBUTING.md](CONTRIBUTING.md). The short version of the one rule that matters: **never write a range you calculated yourself.** Write what the source said. The build does the arithmetic, in public, the same way for every hop.

Found a wrong number? [Open an issue](../../issues/new?template=data-correction.yml) — there's a template, it takes a minute, and a correction with a source link is more valuable to this project than a new hop without one.

---

## Roadmap, roughly in order of how much I want it

- [x] `coverage.js` plus a scheduled workflow that diffs a reference variety
      list against `data/hops/` and opens an issue for anything missing — so new
      releases find me instead of the other way round
- [x] A Hopsteiner scraper, and 132 cultivars seeded off the back of it
- [ ] Replace the remaining 13 `seed-general-knowledge` citations with real sources
- [ ] Scrapers for the sources Hopsteiner cannot cover: Yakima Chief Ranches
      (Citra, Mosaic, Simcoe, Talus), NZ Hops, Hop Products Australia,
      Charles Faram — these are also the ones that publish **myrcene**, which
      Hopsteiner doesn't, so this is what fills in 60 half-empty oil breakdowns
- [ ] Plant patents as a source. Public domain, breeder-authored, and they carry
      pedigree the marketing sheets leave out
- [ ] Crop-year data from the BarthHaas Hop Harvest Guide, so you can watch
      alpha drift across harvests instead of reading one eternal average
- [ ] An IBU calculator wired straight to the dataset, format-aware
- [ ] BeerXML / BeerJSON import: paste a recipe, get told what's substitutable
- [ ] Storage stability curves, because nobody publishes them and everybody
      needs them

## Licensing, and a disclaimer

Code is **MIT**. Data is **CC BY 4.0** — use it, sell things built on it, just say where it came from. Two licenses because they are genuinely two different assets, and the data is the one that took the work.

Not affiliated with any hop breeder, farm, merchant, or the aggregators cited in `data/sources.yml`. Variety names are trademarks of their owners and are used here to identify the plants, which is what names are for. Measured properties of a plant are facts; facts don't belong to anybody. See [NOTICE.md](NOTICE.md).

---

Built in the Pacific Northwest — within a couple hours' drive of the Yakima
Valley, where something like three quarters of the American hop crop comes off
the bine every fall. Around here hops aren't an ingredient you order, they're a
harvest you can smell on the wind in September. Hard not to get curious about
what's actually in them.

Cheers. Go make something bitter.
