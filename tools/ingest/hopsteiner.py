#!/usr/bin/env python3
"""
Pull brewing values from Hopsteiner variety data sheets into HopLore records.

    pixi run -e data python tools/ingest/hopsteiner.py --discover
    pixi run -e data python tools/ingest/hopsteiner.py centennial
    pixi run -e data python tools/ingest/hopsteiner.py centennial --apply
    pixi run -e data python tools/ingest/hopsteiner.py --all --apply

Dry run by default. Nothing touches data/hops/ without --apply.

WHAT THIS WILL NOT DO
---------------------
It writes observations and nothing else. It never computes an average, never
merges two sources, never edits or deletes an observation belonging to another
source. Merging happens in scripts/lib/rollup.js at build time where the
arithmetic is visible. If this script ever starts doing maths on someone else's
numbers, the auditability of the whole dataset is gone.

Where Hopsteiner disagrees with a figure already on file, that is reported for a
human to look at — it is not a conflict to be resolved automatically. Two
sources disagreeing is data, not an error.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

ROOT = Path(__file__).resolve().parents[2]
HOPS_DIR = ROOT / "data" / "hops"
CACHE_DIR = Path(__file__).parent / ".cache"
MAP_FILE = Path(__file__).parent / "hopsteiner_map.yml"

BASE = "https://hopsteiner.us/variety-data-sheets/"
SOURCE_ID = "hopsteiner"

# Identify ourselves properly. A scraper that hides what it is deserves to be
# blocked, and this project has nothing to hide.
UA = "HopLore/0.1 (open hop dataset; +https://github.com/bdgroves/hoplore)"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


# --------------------------------------------------------------------- mapping

# Hopsteiner's label -> where it lands in our schema.
# Anything not listed here is reported as unmapped rather than silently dropped.
FIELD_MAP = {
    "alpha-acid %": ("analytics", "alpha_acid", "percent"),
    "beta-acid %": ("analytics", "beta_acid", "percent"),
    "co-humulone % rel.": ("analytics", "cohumulone", "percent_of_alpha"),
    "total oils (ml/100g)": ("analytics", "total_oil", "ml_per_100g"),
    "farnesene % of total oil": ("oils", "farnesene", "percent_of_total_oil"),
    "linalool % of total oil": ("oils", "linalool", "percent_of_total_oil"),
}

# Rows we deliberately ignore: section headings and figures with nowhere to go
# in the current schema. Listed explicitly so --verbose can show the difference
# between "we skipped this on purpose" and "we did not recognise this".
IGNORED = {
    "bitter components",
    "polyphenoles",
    "aroma components",
    "growing",
    "resistance against diseases",
    "chemical ingredients",
    "agronomic aspects",
}

CEILINGS = {"alpha_acid": 25, "beta_acid": 15, "cohumulone": 100, "total_oil": 6}


@dataclass
class Observation:
    metric: str
    section: str
    unit: str
    low: float
    high: float
    label: str


@dataclass
class Sheet:
    slug: str
    variety: str
    url: str
    last_changed: str | None = None
    observations: list[Observation] = field(default_factory=list)
    genetic_origin: str | None = None
    aroma: str | None = None
    alternatives: list[str] = field(default_factory=list)
    unmapped: dict[str, str] = field(default_factory=dict)


# --------------------------------------------------------------------- fetching


def fetch(url: str, delay: float, refresh: bool = False) -> str:
    """Cache on disk. Re-running the script should not re-hit their server."""
    CACHE_DIR.mkdir(exist_ok=True)
    key = hashlib.sha256(url.encode()).hexdigest()[:16]
    cached = CACHE_DIR / f"{key}.html"

    if cached.exists() and not refresh:
        return cached.read_text(encoding="utf-8")

    time.sleep(delay)
    response = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    response.raise_for_status()
    cached.write_text(response.text, encoding="utf-8")
    return response.text


# ---------------------------------------------------------------------- parsing


def parse_range(raw: str) -> tuple[float, float] | None:
    """
    '9.5 - 11.5'  -> (9.5, 11.5)
    '0.00 - 1.00' -> (0.0, 1.0)
    '29 - 30'     -> (29.0, 30.0)
    '> 0.46'      -> None   (open-ended; the schema wants a bounded figure)
    '1,700 - 2,000' -> (1700.0, 2000.0)
    """
    text = raw.replace(",", "").strip()
    if not text or text.startswith(("<", ">")):
        return None

    numbers = re.findall(r"-?\d+(?:\.\d+)?", text)
    if len(numbers) >= 2:
        low, high = float(numbers[0]), float(numbers[1])
        return (low, high) if low <= high else (high, low)
    if len(numbers) == 1:
        value = float(numbers[0])
        return (value, value)
    return None


def parse_sheet(html: str, slug: str, variety: str, url: str) -> Sheet:
    soup = BeautifulSoup(html, "lxml")
    sheet = Sheet(slug=slug, variety=variety, url=url)

    page_text = soup.get_text(" ", strip=True)
    if match := re.search(r"Last Changed:\s*(\d{2}/\d{2}/\d{4})", page_text):
        month, day, year = match.group(1).split("/")
        sheet.last_changed = f"{year}-{month}-{day}"

    # Walk every row in every table. Label-driven rather than selector-driven,
    # so a WordPress theme change does not silently break the parse.
    for row in soup.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) < 2:
            continue

        label, value = cells[0], cells[1]
        key = label.lower().strip()

        if not value or key in IGNORED:
            continue

        if key in FIELD_MAP:
            section, metric, unit = FIELD_MAP[key]
            bounds = parse_range(value)
            if bounds is None:
                sheet.unmapped[label] = f"{value} (unbounded, skipped)"
                continue
            low, high = bounds
            ceiling = CEILINGS.get(metric)
            if ceiling and high > ceiling:
                sheet.unmapped[label] = f"{value} (exceeds plausible ceiling {ceiling}, skipped)"
                continue
            sheet.observations.append(
                Observation(metric=metric, section=section, unit=unit, low=low, high=high, label=label)
            )
        else:
            sheet.unmapped[label] = value

    # Single-column prose tables.
    for table in soup.find_all("table"):
        heading = table.get_text(" ", strip=True).lower()
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        body = " ".join(r.get_text(" ", strip=True) for r in rows[1:]).strip()
        if heading.startswith("genetic origin"):
            sheet.genetic_origin = body
        elif heading.startswith("aroma specification"):
            sheet.aroma = body
        elif heading.startswith("hop alternatives"):
            sheet.alternatives = [
                a.get_text(strip=True) for a in table.find_all("a") if a.get_text(strip=True)
            ]

    return sheet


# ---------------------------------------------------------------------- writing


def load_record(slug: str) -> CommentedMap | None:
    path = HOPS_DIR / f"{slug}.yml"
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as handle:
        return yaml.load(handle)


def existing_observations(record: CommentedMap, section: str, metric: str) -> list[dict]:
    return list(record.get(section, {}).get(metric, {}).get("observations", []) or [])


def flow(mapping: dict) -> CommentedMap:
    """Emit `{ source: x, low: 1, high: 2 }` on one line, matching the house style."""
    node = CommentedMap(mapping)
    node.fa.set_flow_style()
    return node


def apply_sheet(record: CommentedMap, sheet: Sheet, force: bool) -> list[str]:
    """Insert observations. Returns a list of human-readable changes."""
    changes: list[str] = []

    for obs in sheet.observations:
        record.setdefault(obs.section, CommentedMap())
        section = record[obs.section]
        section.setdefault(obs.metric, CommentedMap({"unit": obs.unit, "observations": CommentedSeq()}))
        metric = section[obs.metric]
        metric.setdefault("observations", CommentedSeq())

        already = [o for o in metric["observations"] if o.get("source") == SOURCE_ID]
        if already and not force:
            changes.append(f"  skip  {obs.section}.{obs.metric}: hopsteiner observation already present")
            continue
        if already and force:
            for old in already:
                metric["observations"].remove(old)
            changes.append(f"  replace  {obs.section}.{obs.metric}")

        entry = {"source": SOURCE_ID, "low": obs.low, "high": obs.high}
        if sheet.last_changed:
            entry["note"] = f"Data sheet last changed {sheet.last_changed}."
        metric["observations"].append(flow(entry))
        changes.append(f"  add   {obs.section}.{obs.metric}: {obs.low}-{obs.high}")

    if changes:
        meta = record.setdefault("meta", CommentedMap())
        meta["last_reviewed"] = time.strftime("%Y-%m-%d")

        # Upgrade the verification tier only if this is genuinely a second voice.
        others = set()
        for section in ("analytics", "oils"):
            for metric in (record.get(section) or {}).values():
                for o in metric.get("observations", []) or []:
                    others.add(o.get("source"))
        others.discard(SOURCE_ID)
        real_others = others - {"seed-general-knowledge"}
        meta["verification"] = "corroborated" if real_others else "single-source"
        changes.append(f"  meta  verification -> {meta['verification']}")

    return changes


def save_record(slug: str, record: CommentedMap) -> None:
    """
    ruamel emits `{a: b}`; the repo writes `{ a: b }`. Left alone, every flow
    mapping in the file shows up in the diff whether or not it changed, which
    buries the one line a reviewer actually needs to look at.
    """
    import io

    buffer = io.StringIO()
    yaml.dump(record, buffer)
    text = buffer.getvalue()
    text = re.sub(r"\{(?=\S)", "{ ", text)
    text = re.sub(r"(?<=\S)\}", " }", text)

    (HOPS_DIR / f"{slug}.yml").write_text(text, encoding="utf-8")


# --------------------------------------------------------------------- reporting


def reconcile(record: CommentedMap, sheet: Sheet) -> list[str]:
    """
    Where Hopsteiner disagrees with what is already on file, say so. This is the
    output a human actually reads before deciding to --apply.
    """
    notes: list[str] = []
    for obs in sheet.observations:
        for existing in existing_observations(record, obs.section, obs.metric):
            src = existing.get("source")
            if src in (SOURCE_ID, None):
                continue
            low, high = existing.get("low"), existing.get("high")
            if low is None or high is None:
                continue
            # Tolerance has to scale with the metric, or a 0.2 mL/100g gap in
            # total oil (a real disagreement) hides under the same threshold
            # that correctly ignores a 0.2% wobble in cohumulone.
            tolerance = max(0.1, 0.05 * max(abs(high), abs(obs.high), 1.0))
            if abs(low - obs.low) > tolerance or abs(high - obs.high) > tolerance:
                marker = "!!" if src == "seed-general-knowledge" else " ~"
                notes.append(
                    f"  {marker} {obs.metric}: on file {low}-{high} ({src}), "
                    f"hopsteiner says {obs.low}-{obs.high}"
                )
    return notes


def report(sheet: Sheet, record: CommentedMap | None, verbose: bool) -> None:
    print(f"\n{sheet.variety}  ->  data/hops/{sheet.slug}.yml")
    print(f"  {sheet.url}")
    if sheet.last_changed:
        print(f"  sheet last changed {sheet.last_changed}")

    if not sheet.observations:
        print("  no recognised brewing values on this page")
        return

    for obs in sheet.observations:
        print(f"  {obs.label:<30} {obs.low} - {obs.high}")

    if record:
        if notes := reconcile(record, sheet):
            print("\n  disagreements with what is on file:")
            for note in notes:
                print(note)

    if sheet.genetic_origin:
        print(f"\n  genetic origin: {sheet.genetic_origin}")
    if sheet.alternatives:
        print(f"  they suggest: {', '.join(sheet.alternatives)}")

    if verbose and sheet.unmapped:
        print("\n  published but not in our schema:")
        for label, value in sheet.unmapped.items():
            print(f"    {label}: {value}")


# ---------------------------------------------------------------------- discover


def discover(delay: float) -> None:
    """Ask the site what it actually has, instead of guessing at URL slugs."""
    html = fetch(BASE, delay)
    soup = BeautifulSoup(html, "lxml")

    varieties = {}
    for link in soup.find_all("a", href=True):
        href = urljoin(BASE, link["href"])
        if "/variety-data-sheets/" not in href:
            continue
        name = href.rstrip("/").split("/")[-1]
        if name in ("variety-data-sheets", "") or "?" in name:
            continue
        varieties[name] = link.get_text(strip=True) or name

    print(f"\n{len(varieties)} varieties listed by Hopsteiner:\n")
    for name in sorted(varieties):
        print(f"  {name}")
    print("\nAdd the ones you want to tools/ingest/hopsteiner_map.yml as `our-slug: Their-Name`.\n")


# -------------------------------------------------------------------------- CLI


def load_map() -> dict:
    with MAP_FILE.open(encoding="utf-8") as handle:
        return yaml.load(handle) or {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slugs", nargs="*", help="HopLore slugs to update")
    parser.add_argument("--all", action="store_true", help="every mapped variety")
    parser.add_argument("--discover", action="store_true", help="list what Hopsteiner publishes")
    parser.add_argument("--apply", action="store_true", help="write changes to data/hops/")
    parser.add_argument("--force", action="store_true", help="replace existing hopsteiner observations")
    parser.add_argument("--refresh", action="store_true", help="ignore the local cache")
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between requests")
    parser.add_argument("--from-file", help="parse a saved HTML file instead of fetching")
    parser.add_argument("--verbose", action="store_true", help="show fields we do not model")
    args = parser.parse_args()

    if args.discover:
        discover(args.delay)
        return 0

    mapping = load_map()
    targets = list(mapping) if args.all else args.slugs

    if not targets:
        parser.print_help()
        return 1

    touched = 0
    for slug in targets:
        variety = mapping.get(slug)
        if variety is None:
            print(f"\n{slug}: not in hopsteiner_map.yml — run --discover to find its name")
            continue
        if variety is False:
            print(f"\n{slug}: mapped as not carried by Hopsteiner, skipping")
            continue

        url = f"{BASE}{variety}/"
        try:
            html = Path(args.from_file).read_text(encoding="utf-8") if args.from_file else fetch(
                url, args.delay, args.refresh
            )
        except requests.HTTPError as error:
            print(f"\n{slug}: {error} — check the name in hopsteiner_map.yml")
            continue

        sheet = parse_sheet(html, slug, variety, url)
        record = load_record(slug)

        if record is None:
            print(f"\n{slug}: no record in data/hops/ — create it first with npm run new-hop")
            continue

        report(sheet, record, args.verbose)

        if args.apply and sheet.observations:
            changes = apply_sheet(record, sheet, args.force)
            if any(c.strip().startswith(("add", "replace")) for c in changes):
                save_record(slug, record)
                touched += 1
            print("\n  written:")
            for change in changes:
                print(change)

    if args.apply and touched:
        print(f"\n{touched} record(s) updated. Now run: pixi run validate\n")
    elif not args.apply:
        print("\nDry run. Nothing written. Add --apply when the numbers above look right.\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
