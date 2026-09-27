#!/usr/bin/env python3
"""
Pull brewing values from the Hop Breeding Company's brand page into HopLore.

    pixi run -e data python tools/ingest/hbc.py --discover
    pixi run -e data python tools/ingest/hbc.py --catalog
    pixi run -e data python tools/ingest/hbc.py citra talus
    pixi run -e data python tools/ingest/hbc.py --all --apply

Dry run by default. Nothing touches data/hops/ without --apply.

WHY THIS SOURCE
---------------
HBC is the Yakima breeding joint venture (Yakima Chief Ranches and John I.
Haas) behind Citra, Mosaic, Sabro, Talus and the rest -- the breeder of record
for most of the hops that put Washington on every craft label. Its site lists
every brand on one page, headed "BRAND - HBC ###", each with a short list of
"Alpha Acids: 11-13%" style values. It is the only source so far with numbers
for Talus.

PARSING
-------
One page, so no crawl: the page is split at every heading that carries an
"HBC ###" number, and each chunk is read for "LABEL: value" lines with the
same label map and range parser as the BarthHaas scraper. Brands are matched
to records by HBC number (hbc_map.yml), which survives restyled names and
trademark symbols that the brand text does not.

Same contract as the other scrapers: cached, identified by user-agent,
writes observations and nothing else, reports disagreement without resolving.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from ruamel.yaml.comments import CommentedMap, CommentedSeq

sys.path.insert(0, str(Path(__file__).parent))
from barthhaas import (  # noqa: E402  (shared parsing and writing helpers)
    CEILINGS,
    LABEL_VALUE,
    Observation,
    fetch,
    flow,
    load_record,
    map_label,
    parse_range,
    save_record,
    yaml,
)

ROOT = Path(__file__).resolve().parents[2]
MAP_FILE = Path(__file__).parent / "hbc_map.yml"
CATALOG_FILE = Path(__file__).parent / "catalogs" / "hbc.json"
FIXTURE_FILE = Path(__file__).parent / "fixtures" / "hbc.html"

PAGE = "https://www.hopbreeding.com/"
SOURCE_ID = "hbc"

HEADING = re.compile(r"^(.*?)\s*[-–—|]\s*HBC\s*(\d{3,4})\b", re.I)
SENTINEL = "␞HBC␟"


@dataclass
class Brand:
    number: str
    brand: str
    observations: list[Observation] = field(default_factory=list)
    prose: str = ""  # the brand's descriptive paragraph; aromas live here, not in a labelled list
    unmapped: dict[str, str] = field(default_factory=dict)


def clean_name(raw: str) -> str:
    name = re.sub(r"[®™©]", "", raw).strip(" -:")
    # "DOLCITA" -> "Dolcita"; leave mixed-case names ("TerraFlux") alone
    return name.title() if name.isupper() else name


# ---------------------------------------------------------------------- parsing


def split_brands(html: str) -> list[tuple[str, str, list[str]]]:
    """[(number, brand name, text lines under its heading)] in page order."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    for heading in soup.find_all(["h1", "h2", "h3", "h4"]):
        text = heading.get_text(" ", strip=True)
        if m := HEADING.match(text):
            heading.replace_with(f"\n{SENTINEL}{m.group(2)}|{clean_name(m.group(1))}\n")

    lines = [l.strip() for l in soup.get_text("\n").splitlines() if l.strip()]
    brands: list[tuple[str, str, list[str]]] = []
    for line in lines:
        if line.startswith(SENTINEL):
            number, name = line[len(SENTINEL):].split("|", 1)
            brands.append((number, name, []))
        elif brands:
            brands[-1][2].append(line)
    return brands


def parse_lines(number: str, name: str, lines: list[str]) -> Brand:
    brand = Brand(number=number, brand=name)
    seen: set[str] = set()
    pairs: list[tuple[str, str]] = []
    brand.prose = " ".join(l for l in lines if not LABEL_VALUE.match(l) and l != "View Details")
    for i, line in enumerate(lines):
        if m := LABEL_VALUE.match(line):
            pairs.append((m.group(1), m.group(2)))
        elif map_label(line.rstrip("*: ")) and not re.search(r"\d", line) and i + 1 < len(lines):
            pairs.append((line.rstrip("*: "), lines[i + 1]))

    for label, value in pairs:
        key = label.lower().strip()
        target = map_label(key)
        if target is None:
            continue
        section, metric, unit = target
        if metric in seen:
            continue
        seen.add(metric)
        bounds = parse_range(value)
        if bounds is None:
            brand.unmapped[label] = f"{value} (not a range, skipped)"
            continue
        low, high = bounds
        if (ceiling := CEILINGS.get(metric)) and high > ceiling:
            brand.unmapped[label] = f"{value} (exceeds plausible ceiling {ceiling}, skipped)"
            continue
        if metric in ("alpha_acid", "beta_acid", "total_oil") and low == 0:
            brand.unmapped[label] = f"{value} (zero lower bound reads as unpublished, skipped)"
            continue
        brand.observations.append(Observation(metric, section, unit, low, high, label))
    return brand


def parse_page(html: str) -> dict[str, Brand]:
    """{HBC number: Brand}. A number that appears twice keeps its first,
    fuller block (pages sometimes repeat a brand in a teaser strip)."""
    out: dict[str, Brand] = {}
    for number, name, lines in split_brands(html):
        parsed = parse_lines(number, name, lines)
        current = out.get(number)
        if current is None or len(parsed.observations) > len(current.observations):
            out[number] = parsed
    return out


# ---------------------------------------------------------------------- writing


def apply_brand(record: CommentedMap, brand: Brand, force: bool) -> list[str]:
    changes: list[str] = []
    for obs in brand.observations:
        section = record.setdefault(obs.section, CommentedMap())
        metric = section.setdefault(obs.metric, CommentedMap({"unit": obs.unit, "observations": CommentedSeq()}))
        metric.setdefault("observations", CommentedSeq())
        already = [o for o in metric["observations"] if o.get("source") == SOURCE_ID]
        if already and not force:
            changes.append(f"  skip  {obs.section}.{obs.metric}: hbc observation already present")
            continue
        for old in already:
            metric["observations"].remove(old)
        metric["observations"].append(flow({"source": SOURCE_ID, "low": obs.low, "high": obs.high}))
        changes.append(f"  {'replace' if already else 'add'}   {obs.section}.{obs.metric}: {obs.low}-{obs.high}")

    if any(c.strip().startswith(("add", "replace")) for c in changes):
        meta = record.setdefault("meta", CommentedMap())
        meta["last_reviewed"] = time.strftime("%Y-%m-%d", time.gmtime())
        sources = {
            o.get("source")
            for sec in ("analytics", "oils")
            for m in (record.get(sec) or {}).values()
            for o in (m.get("observations") or [])
        }
        real_others = sources - {SOURCE_ID, "seed-general-knowledge", None}
        meta["verification"] = "corroborated" if real_others else "single-source"
        changes.append(f"  meta  verification -> {meta['verification']}")
    return changes


def reconcile(record: CommentedMap, brand: Brand) -> list[str]:
    notes = []
    for obs in brand.observations:
        for existing in (record.get(obs.section) or {}).get(obs.metric, {}).get("observations", []) or []:
            src, low, high = existing.get("source"), existing.get("low"), existing.get("high")
            if src in (SOURCE_ID, None) or low is None or high is None:
                continue
            tolerance = max(0.1, 0.05 * max(abs(high), abs(obs.high), 1.0))
            if abs(low - obs.low) > tolerance or abs(high - obs.high) > tolerance:
                marker = "!!" if src == "seed-general-knowledge" else " ~"
                notes.append(f"  {marker} {obs.metric}: on file {low}-{high} ({src}), hbc says {obs.low}-{obs.high}")
    return notes


# -------------------------------------------------------------------------- CLI


def load_map() -> dict:
    """{our slug: HBC number as a string}"""
    if not MAP_FILE.exists():
        return {}
    with MAP_FILE.open(encoding="utf-8") as handle:
        return {k: str(v) for k, v in (yaml.load(handle) or {}).items() if v}


def discover_varieties(delay: float) -> dict[str, str]:
    """{'394': 'Citra (HBC 394)'} -- keyed by number, like hbc_map.yml's values."""
    return {n: f"{b.brand} (HBC {n})" for n, b in parse_page(fetch(PAGE, delay)).items()}


def write_catalog(delay: float) -> None:
    html = fetch(PAGE, delay, refresh=True)
    brands = parse_page(html)
    CATALOG_FILE.parent.mkdir(exist_ok=True)
    CATALOG_FILE.write_text(json.dumps({
        "source": SOURCE_ID, "crawled": time.strftime("%Y-%m-%d"), "url": PAGE, "count": len(brands),
        "varieties": {f"hbc-{n}": b.brand for n, b in brands.items()},
        "details": {f"hbc-{n}": {"name": b.brand, "description": b.prose,
                                 "values": {o.metric: [o.low, o.high] for o in b.observations}}
                    for n, b in brands.items()},
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    FIXTURE_FILE.parent.mkdir(exist_ok=True)
    FIXTURE_FILE.write_text(html, encoding="utf-8")
    print(f"wrote {CATALOG_FILE.relative_to(ROOT)}: {len(brands)} brands")
    print(f"wrote {FIXTURE_FILE.relative_to(ROOT)} (real page, {len(html)} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("slugs", nargs="*", help="HopLore slugs to update")
    parser.add_argument("--all", action="store_true", help="every mapped brand")
    parser.add_argument("--discover", action="store_true", help="list the brands on the page")
    parser.add_argument("--catalog", action="store_true", help="write catalogs/hbc.json and the page fixture")
    parser.add_argument("--apply", action="store_true", help="write changes to data/hops/")
    parser.add_argument("--force", action="store_true", help="replace existing hbc observations")
    parser.add_argument("--refresh", action="store_true", help="ignore the local cache")
    parser.add_argument("--delay", type=float, default=2.0, help="seconds before the request")
    parser.add_argument("--from-file", help="parse a saved HTML file instead of fetching")
    parser.add_argument("--verbose", action="store_true", help="show values skipped")
    args = parser.parse_args()

    if args.catalog:
        write_catalog(args.delay)
        return 0

    html = Path(args.from_file).read_text(encoding="utf-8") if args.from_file else fetch(PAGE, args.delay, args.refresh)
    brands = parse_page(html)

    if args.discover:
        mapped = set(load_map().values())
        print(f"\n{len(brands)} brand(s) on the page:\n")
        for n, b in brands.items():
            print(f"  HBC {n:<5} {b.brand}{'' if n in mapped else '   <- not in hbc_map.yml'}")
        return 0

    mapping = load_map()
    targets = list(mapping) if args.all else args.slugs
    if not targets:
        parser.print_help()
        return 1

    touched = 0
    for slug in targets:
        number = mapping.get(slug)
        if number is None:
            print(f"\n{slug}: not in hbc_map.yml")
            continue
        brand = brands.get(number)
        if brand is None:
            print(f"\n{slug}: HBC {number} not found on the page")
            continue
        record = load_record(slug)
        print(f"\n{brand.brand} (HBC {number})  ->  data/hops/{slug}.yml")
        if not brand.observations:
            print("  no recognised brewing values")
        for obs in brand.observations:
            print(f"  {obs.label:<40} {obs.low} - {obs.high}")
        if args.verbose:
            for label, value in brand.unmapped.items():
                print(f"    skipped: {label}: {value}")
        if record is None:
            print("  no record in data/hops/ — create it first")
            continue
        for note in reconcile(record, brand):
            print(note)
        if args.apply and brand.observations:
            changes = apply_brand(record, brand, args.force)
            if any(c.strip().startswith(("add", "replace")) for c in changes):
                save_record(slug, record)
                touched += 1
            print("  written:")
            for change in changes:
                print(change)

    if args.apply and touched:
        print(f"\n{touched} record(s) updated. Now run: pixi run validate\n")
    elif not args.apply:
        print("\nDry run. Nothing written. Add --apply when the numbers above look right.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
