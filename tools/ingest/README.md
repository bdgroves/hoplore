# Ingest tools

Python side of the project. Run from the `data` pixi environment:

```bash
pixi run -e data hopsteiner-discover          # what does Hopsteiner publish?
pixi run -e data hopsteiner centennial         # dry run, shows what it would do
pixi run -e data hopsteiner centennial --apply # write it
pixi run -e data hopsteiner --all --apply      # every mapped variety
pixi run -e data test-ingest                   # parser tests
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
| `--discover` | list every variety Hopsteiner publishes, to fill in the map |
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

### Fields they publish that we do not model

`--verbose` lists these. Currently unmapped: xanthohumol, total polyphenols,
hard resins:alpha, beta-caryophyllene:humulene, linalool:alpha, yield, maturity,
acreage, and disease resistance. The ratios are derivable from figures we
already hold. Xanthohumol and the agronomic block would need new schema
sections — worth deciding before the next source gets a scraper, not after.

## Planned

- `usda_crop.py` — crop-year alpha averages from the USDA National Hop Report
- `barthhaas_guide.py` — the annual Hop Harvest Guide, which is per-crop-year
  analytical data and the thing that makes `crop_year` worth having
- `patents.py` — plant patent records from Google Patents. Public domain,
  breeder-authored, and they carry pedigree and agronomics that the marketing
  sheets leave out.

## discover_all.py

Runs every scraper in `SCRAPERS` (currently just Hopsteiner) with its
`discover_varieties()` function and reports any name not matched to an
existing `data/hops/` record — by `name`, `aliases`, `previously_named`, or
`slug`, loosely normalized. Read-only, same as `scripts/coverage.js`, just
sourced from the live sites instead of the hand-maintained reference list.

```bash
pixi run -e data discover-all
pixi run -e data python tools/ingest/discover_all.py --out discovery-report.md
```

Runs monthly via `.github/workflows/discover.yml`, which opens a GitHub issue
when it finds anything. Adding a second scraper here later just means giving
it a `discover_varieties(delay)` function with the same contract and adding
it to the `SCRAPERS` dict — no other wiring needed.
