#!/usr/bin/env python3
"""
Pull brewing values from Yakima Chief Ranches brand pages into HopLore records.

    pixi run -e data python tools/ingest/yakima_chief.py --discover
    pixi run -e data python tools/ingest/yakima_chief.py citra
    pixi run -e data python tools/ingest/yakima_chief.py citra --apply
    pixi run -e data python tools/ingest/yakima_chief.py --all --apply

Dry run by default. Nothing touches data/hops/ without --apply.

WHY THIS SOURCE
---------------
YCR breeds and licenses the proprietary US hops Hopsteiner does not carry --
Citra, Mosaic, Simcoe, Talus, Ekuanot, Loral, Sabro -- and, unlike Hopsteiner,
publishes a full oil breakdown including **myrcene**, which is usually the
largest single component. Without myrcene an oil profile cannot be drawn at
all (see MIN_COVERAGE in scripts/lib/rollup.js), so this source is what turns
an oil chart on for the varieties it covers.

It also publishes storage stability -- alpha remaining after six months at
20 C -- which maps onto `alpha_retention_6mo_20c`, a metric the schema has
always defined and nothing has ever filled in.

WHAT THIS WILL NOT DO
---------------------
It writes observations and nothing else. It never computes an average, never
merges two sources, never edits or deletes an observation belonging to another
source. Merging happens in scripts/lib/rollup.js at build time where the
arithmetic is visible.

Where YCR disagrees with a figure already on file, that is reported for a human
to look at -- it is not a conflict to be resolved automatically. Two sources
disagreeing is data, not an error.

NOT SCRAPED, DELIBERATELY
-------------------------
yakimachief.com (the merchant arm, and the lot COA lookup at
tools.yakimachief.com) returns HTTP 429 to the very first request from this
client -- that is bot protection declining us outright, not real rate
limiting. It is an explicit no. The COA lookup was the most promising route
to `crop_year` observations; treat it as closed unless they publish a
documented API. Do not add a retry loop or rotate the user-agent to get
around it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

ROOT = Path(__file__).resolve().parents[2]
HOPS_DIR = ROOT / "data" / "hops"
CACHE_DIR = Path(__file__).parent / ".cache"
MAP_FILE = Path(__file__).parent / "yakima_chief_map.yml"

BASE = "https://yakimachiefranches.com/create/brands/"
SITEMAP = "https://yakimachiefranches.com/sitemap.xml"
SOURCE_ID = "ychr"

UA = "HopLore/0.1 (open hop dataset; +https://github.com/bdgroves/hoplore)"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


# --------------------------------------------------------------------- mapping

# YCR's row label -> (section, metric, unit).
#
# Labels are matched on a normalised prefix rather than the whole string,
# because the parenthetical suffixes carry units and wording that is likely to
# be edited ("Total Oils (Mls. per 100 grams dried hops)"). Matching the stem
# means a reworded unit note degrades to "unmapped and reported" rather than a
# silent miss.
FIELD_MAP = {
    "alpha acids": ("analytics", "alpha_acid", "percent"),
    "beta acids": ("analytics", "beta_acid", "percent"),
    "cohumulone": ("analytics", "cohumulone", "percent_of_alpha"),
    "total oils": ("analytics", "total_oil", "ml_per_100g"),
    "storage": ("analytics", "alpha_retention_6mo_20c", "percent"),
    "myrcene": ("oils", "myrcene", "percent_of_total_oil"),
    "humulene": ("oils", "humulene", "percent_of_total_oil"),
    "caryophyllene": ("oils", "caryophyllene", "percent_of_total_oil"),
    "farnesene": ("oils", "farnesene", "percent_of_total_oil"),
    "linalool": ("oils", "linalool", "percent_of_total_oil"),
    "geraniol": ("oils", "geraniol", "percent_of_total_oil"),
}

# Published, but deliberately not stored. Alpha-beta ratio is derived from two
# figures we already hold, so storing it would duplicate a number rather than
# record an observation; the build computes it. Yield is agronomics with no
# home in the schema yet -- see the open schema questions in the README.
IGNORED_PREFIXES = ("alpha-beta ratio", "yield")

CEILINGS = {
    "alpha_acid": 25,
    "beta_acid": 15,
    "cohumulone": 100,
    "total_oil": 6,
    "alpha_retention_6mo_20c": 100,
}


@dataclass
class Observation:
    metric: str
    section: str
    unit: str
    low: float
    high: float
    label: str


@dataclass
class Brand:
    slug: str
    brand: str
    url: str
    observations: list[Observation] = field(default_factory=list)
    summary: str | None = None
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
    '11-13'    -> (11.0, 13.0)
    '22-24%'   -> (22.0, 24.0)
    '0%'       -> (0.0, 0.0)
    '75%'      -> (75.0, 75.0)
    '2.2-2.8'  -> (2.2, 2.8)
    '1600-1800'-> (1600.0, 1800.0)
    ''         -> None
    """
    text = raw.replace(",", "").replace("%", "").strip()
    text = re.sub(r"[\u2013\u2014]", "-", text)  # en/em dash -> hyphen
    if not text or text.startswith(("<", ">")):
        return None

    # No leading minus in the pattern, on purpose. YCR writes ranges closed up
    # ("11-13") where Hopsteiner writes them spaced ("9.5 - 11.5"), so an
    # optional sign makes the hyphen read as a negative and "11-13" parses to
    # 11 and -13. None of these quantities can be negative, so refusing the
    # sign outright is both correct and simpler than special-casing separators.
    numbers = re.findall(r"\d+(?:\.\d+)?", text)
    if len(numbers) >= 2:
        low, high = float(numbers[0]), float(numbers[1])
        return (low, high) if low <= high else (high, low)
    if len(numbers) == 1:
        value = float(numbers[0])
        return (value, value)
    return None


def map_label(label: str) -> tuple[str, str, str] | None:
    key = label.lower().strip()
    for prefix, target in FIELD_MAP.items():
        if key.startswith(prefix):
            return target
    return None


def parse_brand(html: str, slug: str, brand: str, url: str) -> Brand:
    soup = BeautifulSoup(html, "lxml")
    record = Brand(slug=slug, brand=brand, url=url)

    # Field Notes is a plain two-column table. Walk every row in every table
    # and go by the label, not by position or CSS class, so a theme change
    # degrades into "unmapped" rather than a silent wrong parse.
    for row in soup.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) < 2:
            continue
        label, value = cells[0], cells[1]
        key = label.lower().strip()

        if not value or not label:
            continue
        if key.startswith(IGNORED_PREFIXES):
            continue

        target = map_label(label)
        if target is None:
            record.unmapped[label] = value
            continue

        section, metric, unit = target
        bounds = parse_range(value)
        if bounds is None:
            record.unmapped[label] = f"{value} (unparseable, skipped)"
            continue

        low, high = bounds
        ceiling = CEILINGS.get(metric)
        if ceiling and high > ceiling:
            record.unmapped[label] = f"{value} (exceeds plausible ceiling {ceiling}, skipped)"
            continue

        record.observations.append(
            Observation(metric=metric, section=section, unit=unit, low=low, high=high, label=label)
        )

    # The descriptive blurb. Reported for a human to rewrite into
    # aroma.summary by hand -- it is marketing copy, and CONTRIBUTING.md is
    # explicit that marketing copy does not get pasted into the dataset.
    body = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    # Prefer the sentence that actually describes flavour ("impart ... characters")
    # over the first one mentioning the word aroma, which is usually the headline.
    for pattern in (r"([^.]*\bimparts?\b[^.]*\.)", r"([^.]*\bcharacters?\b[^.]*\.)"):
        if match := re.search(pattern, body, re.I):
            record.summary = match.group(1).strip()
            break

    return record


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
    """Emit `{ source: x, low: 1, high: 2 }` on one line, matching house style."""
    node = CommentedMap(mapping)
    node.fa.set_flow_style()
    return node


def apply_brand(record: CommentedMap, brand: Brand, force: bool) -> list[str]:
    changes: list[str] = []

    for obs in brand.observations:
        record.setdefault(obs.section, CommentedMap())
        section = record[obs.section]
        section.setdefault(obs.metric, CommentedMap({"unit": obs.unit, "observations": CommentedSeq()}))
        metric = section[obs.metric]
        metric.setdefault("observations", CommentedSeq())

        already = [o for o in metric["observations"] if o.get("source") == SOURCE_ID]
        if already and not force:
            changes.append(f"  skip  {obs.section}.{obs.metric}: ychr observation already present")
            continue
        if already and force:
            for old in already:
                metric["observations"].remove(old)
            changes.append(f"  replace  {obs.section}.{obs.metric}")

        entry = {"source": SOURCE_ID, "low": obs.low, "high": obs.high}
        metric["observations"].append(flow(entry))
        changes.append(f"  add   {obs.section}.{obs.metric}: {obs.low}-{obs.high}")

    if changes:
        meta = record.setdefault("meta", CommentedMap())
        meta["last_reviewed"] = time.strftime("%Y-%m-%d")

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
    mapping in the file shows up in the diff whether or not it changed.
    """
    import io

    buffer = io.StringIO()
    yaml.dump(record, buffer)
    text = buffer.getvalue()
    text = re.sub(r"\{(?=\S)", "{ ", text)
    text = re.sub(r"(?<=\S)\}", " }", text)

    (HOPS_DIR / f"{slug}.yml").write_text(text, encoding="utf-8")


# -------------------------------------------------------------------- reporting


def reconcile(record: CommentedMap, brand: Brand) -> list[str]:
    """Where YCR disagrees with what is already on file, say so."""
    notes: list[str] = []
    for obs in brand.observations:
        for existing in existing_observations(record, obs.section, obs.metric):
            src = existing.get("source")
            if src in (SOURCE_ID, None):
                continue
            low, high = existing.get("low"), existing.get("high")
            if low is None or high is None:
                continue
            tolerance = max(0.1, 0.05 * max(abs(high), abs(obs.high), 1.0))
            if abs(low - obs.low) > tolerance or abs(high - obs.high) > tolerance:
                marker = "!!" if src == "seed-general-knowledge" else " ~"
                notes.append(
                    f"  {marker} {obs.metric}: on file {low}-{high} ({src}), "
                    f"ychr says {obs.low}-{obs.high}"
                )
    return notes


def report(brand: Brand, record: CommentedMap | None, verbose: bool) -> None:
    print(f"\n{brand.brand}  ->  data/hops/{brand.slug}.yml")
    print(f"  {brand.url}")

    if not brand.observations:
        print("  no recognised brewing values on this page")
        if verbose and brand.unmapped:
            for label, value in brand.unmapped.items():
                print(f"    unmapped: {label}: {value}")
        return

    for obs in brand.observations:
        print(f"  {obs.label:<52} {obs.low} - {obs.high}")

    if record:
        if notes := reconcile(record, brand):
            print("\n  disagreements with what is on file:")
            for note in notes:
                print(note)

    if brand.summary:
        print(f"\n  their description: {brand.summary}")
        print("  (marketing copy — rewrite in your own words for aroma.summary, don't paste)")

    if verbose and brand.unmapped:
        print("\n  published but not in our schema:")
        for label, value in brand.unmapped.items():
            print(f"    {label}: {value}")


# ---------------------------------------------------------------------- discover


def discover_varieties(delay: float) -> dict[str, str]:
    """
    Unlike Hopsteiner, YCR's sitemap enumerates every brand page, so discovery
    is a real listing rather than a guess: pull sitemap.xml and keep the
    /create/brands/ entries. No JS rendering and no URL probing involved.

    Returns {brand-slug-on-their-site: full-url}.
    """
    xml = fetch(SITEMAP, delay)
    locs = re.findall(r"<loc>(.*?)</loc>", xml)

    brands = {}
    for loc in locs:
        if "/create/brands/" not in loc:
            continue
        name = loc.rstrip("/").rsplit("/", 1)[-1]
        if not name or name == "brands":
            continue
        brands[name] = loc
    return brands


def discover(delay: float, as_json: bool) -> None:
    brands = discover_varieties(delay)

    if as_json:
        print(json.dumps({"source": SOURCE_ID, "varieties": brands}, indent=2))
        return

    mapping = load_map()
    mapped = {v for v in mapping.values() if v}

    print(f"\n{len(brands)} brand page(s) listed in YCR's sitemap:\n")
    for name in sorted(brands):
        flag = "" if name in mapped else "   <- not in yakima_chief_map.yml"
        print(f"  {name}{flag}")
    print("\nAdd the ones you want as `our-slug: their-name`.\n")


# -------------------------------------------------------------------------- CLI


def load_map() -> dict:
    if not MAP_FILE.exists():
        return {}
    with MAP_FILE.open(encoding="utf-8") as handle:
        return yaml.load(handle) or {}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slugs", nargs="*", help="HopLore slugs to update")
    parser.add_argument("--all", action="store_true", help="every mapped variety")
    parser.add_argument("--discover", action="store_true", help="list the brand pages in their sitemap")
    parser.add_argument("--json", action="store_true", help="with --discover, machine-readable output")
    parser.add_argument("--apply", action="store_true", help="write changes to data/hops/")
    parser.add_argument("--force", action="store_true", help="replace existing ychr observations")
    parser.add_argument("--refresh", action="store_true", help="ignore the local cache")
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between requests")
    parser.add_argument("--from-file", help="parse a saved HTML file instead of fetching")
    parser.add_argument("--verbose", action="store_true", help="show fields we do not model")
    args = parser.parse_args()

    if args.discover:
        discover(args.delay, args.json)
        return 0

    mapping = load_map()
    targets = list(mapping) if args.all else args.slugs

    if not targets:
        parser.print_help()
        return 1

    touched = 0
    for slug in targets:
        brand = mapping.get(slug)
        if brand is None:
            print(f"\n{slug}: not in yakima_chief_map.yml — run --discover to see their catalogue")
            continue
        if brand is False:
            print(f"\n{slug}: mapped as not carried by YCR, skipping")
            continue

        url = f"{BASE}{brand}"
        try:
            html = Path(args.from_file).read_text(encoding="utf-8") if args.from_file else fetch(
                url, args.delay, args.refresh
            )
        except requests.HTTPError as error:
            print(f"\n{slug}: {error} — check the name in yakima_chief_map.yml")
            continue

        parsed = parse_brand(html, slug, brand, url)
        record = load_record(slug)

        if record is None:
            print(f"\n{slug}: no record in data/hops/ — create it first with pixi run new-hop")
            continue

        report(parsed, record, args.verbose)

        if args.apply and parsed.observations:
            changes = apply_brand(record, parsed, args.force)
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
