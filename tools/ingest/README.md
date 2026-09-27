# Ingest tools

Python side of the project. Run from the `data` pixi environment:

```bash
pixi run -e data hopsteiner-discover          # confirm known varieties against Hopsteiner's URLs
pixi run -e data hopsteiner centennial         # dry run, shows what it would do
pixi run -e data hopsteiner centennial --apply # write it
pixi run -e data hopsteiner --all --apply      # every mapped variety
pixi run -e data test-ingest                   # hopsteiner parser tests
pixi run -e data ych-discover                  # what YCR publishes
pixi run -e data ych citra                     # dry run
pixi run -e data test-ych                      # YCR parser tests
```

Kept separate from the Node build on purpose. Adding a hop record by hand needs
nothing but a text editor; only bulk ingest needs a PDF parser.

## The rule these scripts must follow

An ingest script writes **observations**, never ranges:

```yaml
- { source: hopsteiner, low: 10.0, high: 12.0 }
```

It must never compute an average, merge two sources, or modify an observation
belonging to a different source. Merging is `scripts/lib/rollup.js`'s job, at
build time, in public. If an ingest script starts doing arithmetic on someone
else's numbers, the auditability of the whole dataset is gone.

Where a new source disagrees with what is already on file, the script *reports*
it. It does not resolve it. Two sources disagreeing is data, not an error — it
is the thing this project exists to show.

## hopsteiner.py

Hopsteiner publishes variety data sheets as plain HTML tables at
`hopsteiner.us/variety-data-sheets/<Name>/`, with a "Last Changed" date on each.
The parser is label-driven rather than selector-driven, so a theme change on
their side degrades into "field not recognised" rather than a silent wrong parse.

**Dry run by default.** Nothing is written without `--apply`. Read the
disagreement report first — `!!` marks a conflict with a placeholder value
(almost always means the placeholder was wrong), `~` marks a conflict with a
real source (means you now have two legitimate numbers, which is fine and
correct to record).

Useful flags:

| flag | what it does |
|---|---|
| `--discover` | probe data/reference/varieties.yml against Hopsteiner's URLs — see below |
| `--json` | with `--discover`, machine-readable output instead of a printed list |
| `--apply` | actually write to `data/hops/` |
| `--force` | replace an existing hopsteiner observation instead of skipping |
| `--refresh` | ignore the local cache and re-fetch |
| `--from-file` | parse a saved HTML file instead of hitting the network |
| `--verbose` | show published fields we do not model |
| `--delay` | seconds between requests, default 2 |

Responses are cached in `tools/ingest/.cache/` (gitignored), so re-running the
script does not re-hit their server. The user agent identifies the project and
links back to the repo.

`tools/ingest/hopsteiner_map.yml` maps our slugs to their URL names. A value of
`false` means they do not carry that variety — proprietary HBC and YCR hops like
Citra, Mosaic and Simcoe are licensed elsewhere, so there is no sheet to fetch.

### How `--discover` finds their catalog

The variety-data-sheets index page renders its grid client-side and their
WordPress sitemap doesn't list the sheets (both checked by hand), so there's
no listing to read. But every sheet links to others: a **"NEXT HOP >"** link
that chains the whole catalog, plus "Hop Alternatives" links. `--discover`
walks those links breadth-first from Centennial and returns every sheet that
actually loads, keyed by the name in their URL (`Hallertauer-Tradition`) with
the display name taken from the link text.

`--catalog` does the same walk and writes the result to
`catalogs/hopsteiner.json`, so what they publish is on record in the repo.
The **Snapshot a source catalog** workflow runs it on GitHub's runners.

(This replaced an earlier approach that guessed URLs from the reference list.
Guessing could only confirm names we already knew, and it got their naming
wrong often enough — `Hallertau-Tradition` for `Hallertauer-Tradition` — that
62 guesses turned out false.)

**Gotcha already hit once:** the probe uses `GET`, not `HEAD`. An earlier
version used `HEAD` on the theory that it's cheaper (no response body), and
a manual test with `GET` confirmed the server tells real and fake slugs
apart correctly. But that test didn't check `HEAD` specifically — and on a
real batch of 118 candidates, `HEAD` returned `200` for every single one,
while the real `GET` during `--apply` minutes later 404'd on 60 of them.
This server does not validate the same way for both methods. If you're
tempted to switch back to `HEAD` for speed, don't, unless you've confirmed
agreement with `GET` on this specific site first.

### Fields they publish that we do not model

`--verbose` lists these. Currently unmapped: xanthohumol, total polyphenols,
hard resins:alpha, beta-caryophyllene:humulene, linalool:alpha, yield, maturity,
acreage, and disease resistance. The ratios are derivable from figures we
already hold. Xanthohumol and the agronomic block would need new schema
sections — worth deciding before the next source gets a scraper, not after.

## yakima_chief.py

Yakima Chief Ranches breed and license the proprietary US hops Hopsteiner
doesn't carry — Citra, Mosaic, Simcoe, Talus, Ekuanot, Loral, Sabro — and,
unlike Hopsteiner, they publish a **full oil breakdown including myrcene**.
That matters more than it sounds: myrcene is usually the largest single
component, and without it an oil profile can't clear `MIN_COVERAGE` in
`rollup.js`, so no chart gets drawn at all. This source is what turns the oil
chart on.

They also publish storage stability (alpha remaining after six months at
20 °C), which maps onto `alpha_retention_6mo_20c` — a metric the schema has
always defined and nothing had ever filled in.

```bash
pixi run -e data ych-discover          # their sitemap lists every brand page
pixi run -e data ych citra             # dry run
pixi run -e data ych citra --apply     # write it
pixi run -e data ych --all --apply     # every mapped variety
pixi run -e data test-ych              # parser tests, offline
```

Same contract as `hopsteiner.py`: dry run by default, cached responses,
identifies itself in the user-agent, reconciles without resolving, writes
observations only.

**Discovery here is a real listing, not a guess.** Their `sitemap.xml`
enumerates every `/create/brands/` page, so `--discover` reads an actual
catalogue rather than probing URLs — which is how Dolcita, Krush, HBC-682 and
Terrasurge turned up as varieties HopLore has no record for yet.

### What is deliberately not scraped

`yakimachief.com` — the merchant arm, including the lot COA lookup at
`tools.yakimachief.com` — returns **HTTP 429 to the very first request** from
this client. That is bot protection declining us outright, not real rate
limiting. It is an explicit no, and it is respected.

That closes off the most promising route to `crop_year` observations, which
HANDOFF.md had flagged as lab-tier data with dates on it that nobody else
structures. Treat it as closed unless YCH publish a documented API. **Do not**
add a retry loop, back-off, or user-agent rotation to work around it.

### Gotcha: closed-up hyphens

YCR writes ranges closed up (`11-13`) where Hopsteiner writes them spaced
(`9.5 - 11.5`). The first version of this parser reused Hopsteiner's number
pattern, which allowed a leading minus — so `11-13` parsed as `11` and `-13`
and came out as the range `-13.0` to `11.0`. Silent, inverted, negative. The
pattern now refuses a sign outright, since none of these quantities can be
negative. `test_yakima_chief.py` pins that case.

## Planned

- `usda_crop.py` — crop-year alpha averages from the USDA National Hop Report
- `barthhaas_guide.py` — the annual Hop Harvest Guide, which is per-crop-year
  analytical data and the thing that makes `crop_year` worth having
- `patents.py` — plant patent records from Google Patents. Public domain,
  breeder-authored, and they carry pedigree and agronomics that the marketing
  sheets leave out.

## discover_all.py

Runs every scraper in `SCRAPERS` (currently just Hopsteiner) with its
`discover_varieties()` function and reports anything not matched to an
existing `data/hops/` record — by `name`, `aliases`, `previously_named`, or
`slug`, loosely normalized. Read-only, same as `scripts/coverage.js`. What
"discovery" actually means is source-specific — see "Why `--discover` probes
instead of lists" above for what it means for Hopsteiner today.

```bash
pixi run -e data discover-all
pixi run -e data python tools/ingest/discover_all.py --out discovery-report.md
```

Runs monthly via `.github/workflows/discover.yml`, which opens a GitHub issue
when it finds anything. Adding a second scraper here later just means giving
it a `discover_varieties(delay)` function returning `{key: value}` — value
just needs to be useful to read in an issue body, a name or a confirmed URL,
whatever fits that source — and adding it to the `SCRAPERS` dict.
