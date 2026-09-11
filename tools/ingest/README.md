# Ingest tools

Python side of the project, run from the `data` pixi environment:

```bash
pixi run -e data python tools/ingest/<script>.py
```

Kept separate from the Node build on purpose. Adding a hop record by hand needs
nothing but a text editor; only bulk ingest needs pandas and a PDF parser.

## The rule these scripts must follow

An ingest script writes **observations**, never ranges. It reads a breeder sheet
and emits:

```yaml
- { source: hopsteiner, low: 10.0, high: 12.0, crop_year: 2024 }
```

It must never compute an average, merge two sources, or overwrite an existing
observation from a different source. Merging is `scripts/lib/rollup.js`'s job,
at build time, in public. If an ingest script ever starts doing arithmetic on
someone else's numbers, the auditability of the whole dataset is gone.

## Planned

- `breeder_sheet.py` — pull the published PDF data sheets into observation stubs
- `usda_crop.py` — crop-year alpha averages from the USDA National Hop Report
- `reconcile.py` — report where a new source disagrees with what's on file,
  for a human to look at before anything gets committed
