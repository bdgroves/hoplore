#!/usr/bin/env python3
"""
Spec sheets from sources too small or too irregular for a scraper of their
own: one page, one hop, read from the copy saved in tools/ingest/raw/pages/.

    pixi run -e data python tools/ingest/sheets.py             # dry run
    pixi run -e data python tools/ingest/sheets.py --apply
    pixi run -e data python tools/ingest/sheets.py strata --apply

sheets.yml lists each sheet: which hop, which source, which saved file. By
default the values are parsed from the saved page with the same label map as
the BarthHaas scraper. A sheet whose layout defeats the parser (a PDF with
the numbers in a grid under their headings) carries `values:` keyed in by
hand instead -- and every number keyed in must appear, as written, in the
saved file's text, or the run stops. Nothing is taken on trust from memory.

`exclude:` drops fields the source publishes but that can't be right (a
total oil of 20 mL/100g, an oil component over 100%), each with the reason,
which is printed on every run so the call stays visible.
"""
from __future__ import annotations

import argparse
import re
import sys
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from barthhaas import FIELD_MAP, Observation, load_record, parse_brand, save_record, yaml  # noqa: E402
from common import apply_observations, reconcile  # noqa: E402

HERE = Path(__file__).parent
RAW = HERE / "raw" / "pages"
CONFIG = HERE / "sheets.yml"

TARGETS = {metric: (section, unit) for section, metric, unit in FIELD_MAP.values()}
OIL_KEYS = {m for m, (s, _) in TARGETS.items() if s == "oils"}


def page_text(path: Path) -> tuple[str, str]:
    """(html for the parser, plain text for checking hand-keyed numbers)"""
    if path.suffix == ".pdf":
        import pdfplumber

        with pdfplumber.open(path) as pdf:
            text = "\n".join((page.extract_text() or "") for page in pdf.pages)
        return "<html><body>" + "".join(f"<p>{escape(l)}</p>" for l in text.splitlines()) + "</body></html>", text
    from bs4 import BeautifulSoup

    html = path.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "lxml")
    return html, soup.get_text(" ")


def number_on_page(value: float, text: str) -> bool:
    flat = text.replace(",", ".")
    candidates = {f"{value:g}", f"{value:.1f}", f"{value:.2f}"}
    return any(re.search(rf"(?<![\d.]){re.escape(c)}(?![\d])", flat) for c in candidates)


def observations_for(sheet: dict) -> tuple[list[Observation], list[str]]:
    path = RAW / sheet["file"]
    html, text = page_text(path)
    notes: list[str] = []

    if "values" in sheet:
        observations = []
        for metric, bounds in sheet["values"].items():
            low, high = (bounds, bounds) if not isinstance(bounds, list) else bounds
            for v in {low, high}:
                if not number_on_page(float(v), text):
                    raise SystemExit(f"{sheet['slug']}: {metric} {v} is not on the saved page {sheet['file']}")
            section, unit = TARGETS[metric]
            observations.append(Observation(metric, section, unit, float(low), float(high), metric))
        notes.append("values keyed by hand, each checked against the saved page")
    else:
        parsed = parse_brand(html, sheet["slug"], sheet["slug"], sheet["url"])
        observations = parsed.observations

    excluded = sheet.get("exclude") or {}
    kept = []
    for obs in observations:
        if obs.metric in excluded:
            notes.append(f"excluded {obs.metric} {obs.low}-{obs.high}: {excluded[obs.metric]}")
        elif obs.metric in OIL_KEYS and obs.high > 100:
            notes.append(f"excluded {obs.metric} {obs.low}-{obs.high}: over 100% of the oil")
        else:
            kept.append(obs)
    return kept, notes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slugs", nargs="*")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--force", action="store_true", help="replace existing observations from the same source")
    args = parser.parse_args()

    sheets = yaml.load(CONFIG.read_text(encoding="utf-8"))
    if args.slugs:
        sheets = [s for s in sheets if s["slug"] in args.slugs]

    touched = 0
    for sheet in sheets:
        observations, notes = observations_for(sheet)
        print(f"\n{sheet['slug']}  <-  {sheet['source']}  ({sheet['file']})")
        for obs in observations:
            print(f"  {obs.metric:<16} {obs.low} - {obs.high}")
        for note in notes:
            print(f"  · {note}")
        record = load_record(sheet["slug"])
        if record is None:
            print("  no record in data/hops/ -- create it first")
            continue
        for line in reconcile(record, observations, sheet["source"]):
            print(line)
        if args.apply and observations:
            changes = apply_observations(record, observations, sheet["source"], args.force, sheet.get("note"))
            if any(c.strip().startswith(("add", "replace")) for c in changes):
                save_record(sheet["slug"], record)
                touched += 1

    print(f"\n{touched} record(s) updated." if args.apply else "\nDry run. Add --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
