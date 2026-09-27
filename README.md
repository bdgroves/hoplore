# HopLore

**An open hop database that shows its working.**

### → [brooksgroves.com/hoplore](https://brooksgroves.com/hoplore/)

[Browse the hops](https://brooksgroves.com/hoplore/) ·
[The hop landscape](https://brooksgroves.com/hoplore/landscape/) ·
[The JSON API](https://brooksgroves.com/hoplore/api/v1/hops.json) ·
[Report a wrong number](../../issues/new?template=data-correction.yml)

Every hop spec sheet on the internet hands you one confident number. `Alpha: 5.5–8.5%`. Cool. Says who? Measured when? In whose field, in what crop year, by the people who bred it or by a shop trying to move last season's crop?

Nobody says. So I built a database that does.

**181 cultivars. 149 backed by real breeder and lab sources, 69 of them by two or more. Every number traceable to whoever actually said it.**

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

That's the whole thesis. Nobody hand-writes a published range in this repo. You write down what each source actually said, and the build rolls it up into `5.5–8.5%, typical 7.5, 2 sources` — and the site draws the breeder's number and the aggregator's number as two separate dots on the same bar so you can *see* them disagree.

---

## What you'll find on the site

- **A page per hop** — every source plotted on its own range bar, the oil breakdown, aroma, beer styles, pedigree, and ranked substitutes.
- **[The hop landscape](https://brooksgroves.com/hoplore/landscape/)** — every hop with published figures on one chart, bittering power against aroma oil. Each hop carries a cross out to the widest range any source reported, so a big cross means the sources disagree or the crop swings year to year. Every hop page links in with that hop lit up.
- **Honesty built into the page.** A hop with only a placeholder citation gets a red "needs a citation" badge. A stub with no numbers says *awaiting data*. A brewing role that hasn't been sourced says *role ?* instead of quietly guessing. An oil breakdown that doesn't account for enough of the oil isn't drawn at all — rather than scaling two trace compounds up to 100% and inventing the rest.

It all works with JavaScript off. JavaScript adds search, filters and tooltips on top.

---

## What's in the jar

```
data/hops/*.yml         one file per cultivar — the actual product
data/sources.yml        the source registry. no entry, no number.
data/taxonomy/          controlled vocabulary: aroma, styles, countries, breeders
data/reference/         the checklist of varieties that should have a record
schema/                 JSON Schema 2020-12. the contract.
scripts/validate.js     the bouncer
scripts/lib/rollup.js   observations -> published ranges. all the arithmetic lives here
scripts/build.js        observations in, API + website out
site/                   templates and styles for the static site
tools/ingest/           scrapers that turn breeder sheets into observations
dist/                   generated. gitignored. never edit.
```

One build, three outputs, and the website is rendered *from* the API JSON, so the site can't drift from the data:

| Output | What it is |
|---|---|
| `dist/api/v1/**` | A free JSON API. No key, no auth, no rate limit, CORS wide open. |
| `dist/index.html`, `dist/hops/<slug>/`, `dist/landscape/` | The static site. |
| `dist/api/v1/hops.csv` | For when you just want to open it in a spreadsheet like a normal person. |

Every push to `main` validates, builds and deploys to GitHub Pages.

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
pixi run check       # exactly what CI runs
```

Node is pinned in `pixi.toml` and locked in `pixi.lock`, so a fresh clone builds byte-identical output on any machine. That matters more than usual for a project whose entire pitch is "you can check my work" — if the build isn't reproducible, neither is the data. (No pixi? `npm install && npm run build` works; the pixi tasks are thin wrappers.)

`pixi run validate` is deliberately hard to please. Past the schema, it checks the things a schema can't: every cited source exists, every substitute points at a real record, no aroma tag was invented on the spot, oil components sum to something plausible, nobody typed a cohumulone of 420, a `published` record isn't quietly resting on placeholders, and substitutions go both ways so the graph is walkable.

Errors fail the build. Warnings don't — they print as a to-do list, because a visible gap beats an invisible guess. The most common warning right now is `no myrcene figure`: Hopsteiner's sheets don't publish myrcene, which is usually the single biggest component of a hop's oil, so the tool says the breakdown is incomplete instead of drawing you a pie chart that adds up to 4%.

---

## Pulling data in

Scrapers live in `tools/ingest/`, one per source, all under the same contract: **dry run by default, cached responses, identified by user-agent, and they write observations and nothing else.** They never average, never merge, never touch another source's observation. The arithmetic stays in `rollup.js` at build time where you can see it.

| Scraper | Covers | Notes |
|---|---|---|
| `hopsteiner` | ~100 varieties across the US, Europe, the Southern Hemisphere; the catalog is crawled, not guessed | acids and some oils; no myrcene |
| `ych` | Yakima Chief Ranches: Citra, Mosaic, Simcoe, Krush, Dolcita, Sabro… | full oil profiles **including myrcene**, plus storage stability |
| `barthhaas` | ~100 varieties worldwide, incl. Galaxy, Vic Secret, the Czech and Polish hops | full oil breakdown, stated as the range over the last four crop years |

```bash
pixi run -e data ych citra            # dry run: what it found, and where it disagrees
pixi run -e data ych citra --apply    # write it
pixi run -e data ych --all --apply
```

The reconciliation report is the useful part:

```
  !! alpha_acid: on file 10.0-15.0 (seed-general-knowledge), ychr says 11.0-13.0
```

`!!` means it disagrees with a placeholder — the placeholder was probably wrong. `~` means it disagrees with a real source, which is not an error. Two sources disagreeing is the thing this project exists to show.

**No local setup?** The **Run a scraper** workflow in the Actions tab runs any scraper on GitHub's runners, validates, commits the result and redeploys. Works from a phone.

**New releases find me.** On the 1st of every month a workflow lists what each source publishes, diffs it against `data/hops/`, and opens an issue for anything new. Its first run turned up Dolcita, Krush, HBC 682, Terrasurge and Ahtanum; all five are in now.

---

## Substitution, done with math instead of vibes

"What can I use instead of Citra" is really three questions wearing a trenchcoat, so `scripts/lib/similarity.js` answers all three separately:

- **chemistry** — scaled distance across alpha, beta, cohumulone, total oil
- **oils** — distance across the normalised oil breakdown, so myrcene-bombs cluster with myrcene-bombs
- **aroma** — tag overlap, with partial credit where two tags share a family, because grapefruit and tangerine are not strangers

An axis that hasn't been measured earns nothing. The score is how much *evidence* there is for the swap, not just how close the numbers you happen to have are — otherwise a hop known only by its acid numbers outranks one you actually know. Curated swaps a human vouched for in the YAML get a bonus on top, because a brewer who has made the swap beats a distance metric.

```
Citra →  Mosaic         83   [brewer-tested]
         Simcoe         72
         Centennial     64   [brewer-tested]
         Idaho 7        57
```

Nelson Sauvin's best match scores 50, right on the line where anything lower is a different beer. Nothing substitutes for Nelson Sauvin. The number agrees.

---

## A hop is not one product

Idaho 7 T-90 pellets and Idaho 7 Cryo are the same plant with different numbers. Cryo is lupulin separated from the vegetal fraction, so alpha and oil roughly double. Most hop databases model this as a checkbox — "Cryo available: yes" — which tells you nothing you can brew with.

So formats are first-class. Each `forms` entry carries its own observations, and the build derives an `alpha_factor` per format — Idaho 7 Cryo comes out at about **2×** the pellet — because that's the number you need when dropping a concentrate into a recipe written for pellets. Dose by alpha, not by grams. The validator knows a concentrate can't be weaker than the hop it came from, and that 24% alpha is normal for Cryo and a typo on a leaf hop.

---

## The API

Static JSON on a CDN: costs nothing to run, can't go down separately from the site.

```
GET /hoplore/api/v1/index.json            slim list, ~all you need for search
GET /hoplore/api/v1/hops.json             everything
GET /hoplore/api/v1/hops/citra.json       one hop: ranges + every underlying observation
GET /hoplore/api/v1/similar/citra.json    ranked substitutes with component scores
GET /hoplore/api/v1/sources.json          the source registry
GET /hoplore/api/v1/taxonomy.json         aroma tags, styles, countries, breeders
GET /hoplore/api/v1/hops.csv              the whole thing, flattened
GET /hoplore/api/v1/schema/hop.schema.json
```

All on `https://brooksgroves.com`. Every response carries a `meta` envelope with the build timestamp and license. `v1` will not break — if the shape needs to change it becomes `v2` and `v1` keeps working. Building something with it? Go ahead; it's CC BY 4.0, just credit it. I'd love to hear about it.

---

## Honest state of the data

Nobody gets to skip this section.

| | count | what that means |
|---|---|---|
| Cultivars | **181** | every one has a record, a page and an API endpoint |
| Backed by a real source | **149** | Hopsteiner, BarthHaas and Yakima Chief Ranches, tier `breeder` |
| With a full oil breakdown (myrcene) | **77** | the rest are waiting on a source that publishes it |
| Still citing a placeholder somewhere | **12** | mostly aroma prose and pedigree from the first seed pass |
| No numbers yet | **32** | real varieties, no source found that covers them |

I bootstrapped the first records from general brewing knowledge so there'd be something to build the tooling against. Every one of those citations points at `seed-general-knowledge`, tier `unsourced`, weight 0.1, and is flagged everywhere. When a real source arrives, the placeholder number it contradicts gets deleted rather than kept alongside — the rollup publishes the *union* of source ranges, so a padded guess would drag the published figure away from what the breeder measured. Citra went from a guessed 10–15% alpha to the breeder's 11–13% that way.

The 32 empty records are the same principle pointed the other way. An empty record that says "we don't have this yet" beats a full one padded out with plausible guesses.

Aramis is the fully-worked example of a single hop — copy its shape. Idaho 7 is the example for formats, and for the hardest coverage problem: bred by a family farm in Wilder, Idaho, distributed by three companies, found by no breeder's catalog.

---

## Contributing

Adding a hop: copy `data/hops/aramis.yml`, cite your sources in `data/sources.yml`, run `pixi run validate`, open a PR. CI runs `pixi run check` — same command, same pinned Node — so green locally means green there. Run `git config core.hooksPath .githooks` once per clone for the pre-commit check.

Full instructions and gotchas are in [CONTRIBUTING.md](CONTRIBUTING.md). The one rule that matters: **never write a range you calculated yourself.** Write what the source said. The build does the arithmetic, in public, the same way for every hop.

Found a wrong number? [Open an issue](../../issues/new?template=data-correction.yml). A correction with a source link is worth more to this project than a new hop without one.

---

## Roadmap

Done:

- [x] Hopsteiner, BarthHaas and Yakima Chief Ranches scrapers — real breeder data for 149 hops, and myrcene for the hops that matter most
- [x] Coverage report plus a monthly discovery workflow that opens an issue when a new variety shows up
- [x] The hop landscape
- [x] Run any scraper from the Actions tab

Next, roughly in order of how much I want it:

- [ ] **Aroma data at scale.** Only 14 hops have aroma descriptors, and aroma is 40% of the substitution score. The single biggest gap.
- [ ] **An IBU calculator that outputs a range** — because alpha is a range, your IBUs are too. Format-aware, so Cryo doses correctly. Nobody else can do this, because nobody else stores ranges.
- [ ] A mini landscape on every hop page, with that hop and its substitutes highlighted
- [ ] Side-by-side compare for 2–4 hops
- [ ] More sources: NZ Hops, Hop Products Australia, Charles Faram — for the ~30 hops no current source covers
- [ ] Washington acreage from the USDA National Hop Report: which hops the state actually grows, and how much
- [ ] Plant patents as a source: public domain, breeder-authored, and they carry the pedigree marketing sheets leave out
- [ ] Crop-year data, so you can watch alpha drift across harvests instead of reading one eternal average
- [ ] BeerXML / BeerJSON import: paste a recipe, get told what's substitutable

---

## Licensing, and a disclaimer

Code is **MIT**. Data is **CC BY 4.0** — use it, build things on it, just say where it came from. Two licenses because they're two different assets, and the data is the one that took the work.

Not affiliated with any hop breeder, farm, merchant, or the aggregators cited in `data/sources.yml`. Variety names are trademarks of their owners and are used here to identify the plants, which is what names are for. Measured properties of a plant are facts; facts don't belong to anybody. See [NOTICE.md](NOTICE.md).

---

Built in the Pacific Northwest — within a couple hours' drive of the Yakima Valley, where something like three quarters of the American hop crop comes off the bine every fall. Around here hops aren't an ingredient you order, they're a harvest you can smell on the wind in September. Hard not to get curious about what's actually in them.

Cheers. Go make something bitter.
