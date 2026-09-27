#!/usr/bin/env python3
"""
Pull brewing values from BarthHaas variety pages into HopLore records.

    pixi run -e data python tools/ingest/barthhaas.py --discover
    pixi run -e data python tools/ingest/barthhaas.py --catalog
    pixi run -e data python tools/ingest/barthhaas.py cascade
    pixi run -e data python tools/ingest/barthhaas.py cascade --apply

Dry run by default. Nothing touches data/hops/ without --apply.

WHY THIS SOURCE
---------------
BarthHaas (with John I. Haas in Yakima, one of the two biggest hop merchants
in the world) publishes 100+ varieties, each with the full oil breakdown --
myrcene, humulene, caryophyllene, farnesene, linalool, geraniol -- and states
that its figures are the range over the last four crop years. That's the
depth a Beer Maverick page has, with the provenance stated.

Same contract as the other scrapers: dry run by default, cached responses,
identified by user-agent, writes observations and nothing else, reconciles
against what's on file without resolving.

PARSING
-------
Pages lay the analytics out as "LABEL: value" pairs rather than a table, so
parse_page() reads label/value pairs from definition lists, table rows and
plain "LABEL: value" text, and maps them by label prefix. "up to X" values
are ceilings, not ranges, and are reported rather than recorded.
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
MAP_FILE = Path(__file__).parent / "barthhaas_map.yml"
CATALOG_FILE = Path(__file__).parent / "catalogs" / "barthhaas.json"
FIXTURES = Path(__file__).parent / "fixtures"

BASE = "https://www.barthhaas.com/hops-and-products/hops/"
OVERVIEW = "https://www.barthhaas.com/hops-and-products/hop-varieties-overview"
SITEMAP = "https://www.barthhaas.com/sitemap.xml"
SOURCE_ID = "barthhaas"

UA = "HopLore/0.1 (open hop dataset; +https://github.com/bdgroves/hoplore)"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


# --------------------------------------------------------------------- mapping

# BarthHaas label -> (section, metric, unit), matched on a lower-cased prefix
# so unit suffixes like "(% OF TOTAL OIL)" don't matter.
FIELD_MAP = {
    "alpha": ("analytics", "alpha_acid", "percent"),
    "beta": ("analytics", "beta_acid", "percent"),
    "cohumulone": ("analytics", "cohumulone", "percent_of_alpha"),
    "co-humulone": ("analytics", "cohumulone", "percent_of_alpha"),
    "total oil": ("analytics", "total_oil", "ml_per_100g"),
    "myrcene": ("oils", "myrcene", "percent_of_total_oil"),
    "humulene": ("oils", "humulene", "percent_of_total_oil"),
    "caryophyllene": ("oils", "caryophyllene", "percent_of_total_oil"),
    "farnesen": ("oils", "farnesene", "percent_of_total_oil"),  # BarthHaas spells it "farnesen"
    "linalool": ("oils", "linalool", "percent_of_total_oil"),
    "geraniol": ("oils", "geraniol", "percent_of_total_oil"),
}

# Published, but deliberately not stored. Alpha-beta ratio is derived from two
# figures we already hold, so storing it would duplicate a number rather than
# record an observation; the build computes it. Yield is agronomics with no
# home in the schema yet -- see the open schema questions in the README.
IGNORED_PREFIXES = ("alpha-beta ratio", "yield")

# Labels we know and deliberately don't store (no schema home yet), so they
# report as known-unmodelled rather than looking like a parse miss.
KNOWN_UNMODELLED = ("ketone", "isobutyrate", "thiols", "polyphenol", "xanthohumol")

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
    '4.5 - 7.9%'           -> (4.5, 7.9)
    '19.4 - 55%'           -> (19.4, 55.0)
    '0.8 - 1.4 ml/100 g'   -> (0.8, 1.4)    unit text stripped first: "100"
                                             is part of the unit, not a bound
    'up to 1.4 ml/100 g'   -> None          a ceiling is not a range
    '< 1' / '> 0.5' / ''   -> None
    """
    text = raw.lower().replace(",", ".")
    text = re.sub(r"ml\s*/\s*100\s*g|µg\s*/\s*kg|ug\s*/\s*kg|%", "", text)
    text = re.sub(r"[\u2013\u2014]", "-", text).strip()
    if not text or re.match(r"^(up to|max|<|>|approx)", text):
        return None
    numbers = re.findall(r"\d+(?:\.\d+)?", text)  # no sign: none of these can be negative
    if len(numbers) >= 2:
        low, high = float(numbers[0]), float(numbers[1])
        return (low, high) if low <= high else (high, low)
    if len(numbers) == 1:
        v = float(numbers[0])
        return (v, v)
    return None


def map_label(label: str) -> tuple[str, str, str] | None:
    key = label.lower().strip()
    for prefix, target in FIELD_MAP.items():
        if key.startswith(prefix):
            return target
    return None


LABEL_VALUE = re.compile(r"^\s*([A-Za-z][A-Za-z\- ()%/µ]{2,60}?)\s*\*?\s*:\s*(.+?)\s*$")


def label_value_pairs(soup: BeautifulSoup) -> list[tuple[str, str]]:
    """Every (label, value) the page offers, however it's marked up."""
    pairs: list[tuple[str, str]] = []
    for dt in soup.find_all("dt"):
        dd = dt.find_next_sibling("dd")
        if dd:
            pairs.append((dt.get_text(" ", strip=True), dd.get_text(" ", strip=True)))
    for row in soup.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]
        if len(cells) >= 2:
            pairs.append((cells[0], cells[1]))
    lines = [l.strip() for l in soup.get_text("\n").splitlines() if l.strip()]
    for i, line in enumerate(lines):
        if m := LABEL_VALUE.match(line):
            pairs.append((m.group(1), m.group(2)))
        elif map_label(line.rstrip("*: ")) and not re.search(r"\d", line) and i + 1 < len(lines):
            # label on one line, value on the next
            pairs.append((line.rstrip("*: "), lines[i + 1]))
    return pairs


def parse_brand(html: str, slug: str, brand: str, url: str) -> Brand:
    soup = BeautifulSoup(html, "lxml")
    record = Brand(slug=slug, brand=brand, url=url)
    seen: set[str] = set()

    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    period = re.search(r"(all values represent[^.]*\.)", text, re.I)
    record.summary = period.group(1).strip() if period else None  # the basis, carried as a note

    for label, value in label_value_pairs(soup):
        key = label.lower().strip().rstrip("*").strip()
        if not value or key.startswith(IGNORED_PREFIXES):
            continue
        target = map_label(key)
        if target is None:
            if key.startswith(KNOWN_UNMODELLED):
                record.unmapped[label] = f"{value} (no schema field yet)"
            continue
        section, metric, unit = target
        if metric in seen:
            continue  # same field reached through two markup paths
        bounds = parse_range(value)
        if bounds is None:
            record.unmapped[label] = f"{value} (not a range, skipped)"
            seen.add(metric)
            continue
        low, high = bounds
        ceiling = CEILINGS.get(metric)
        if ceiling and high > ceiling:
            record.unmapped[label] = f"{value} (exceeds plausible ceiling {ceiling}, skipped)"
            seen.add(metric)
            continue
        if metric in ("alpha_acid", "beta_acid", "total_oil") and low == 0:
            record.unmapped[label] = f"{value} (zero lower bound reads as unpublished, skipped)"
            seen.add(metric)
            continue
        seen.add(metric)
        record.observations.append(
            Observation(metric=metric, section=section, unit=unit, low=low, high=high, label=label)
        )
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
            changes.append(f"  skip  {obs.section}.{obs.metric}: barthhaas observation already present")
            continue
        if already and force:
            for old in already:
                metric["observations"].remove(old)
            changes.append(f"  replace  {obs.section}.{obs.metric}")

        entry = {"source": SOURCE_ID, "low": obs.low, "high": obs.high}
        if brand.summary and (m := re.search(r"last (\w+) years", brand.summary, re.I)):
            entry["note"] = f"Range over the last {m.group(1)} crop years."
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
    """Where BarthHaas disagrees with what is already on file, say so."""
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
                    f"barthhaas says {obs.low}-{obs.high}"
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
        print(f"\n  basis: {brand.summary}")

    if verbose and brand.unmapped:
        print("\n  published but not in our schema:")
        for label, value in brand.unmapped.items():
            print(f"    {label}: {value}")


# ---------------------------------------------------------------------- discover


VARIETY_URL = re.compile(r"/hops-and-products/hops/([a-z0-9][a-z0-9-]*)/?$")


def discover_varieties(delay: float) -> dict[str, str]:
    """
    Every variety page, from the sitemap (following a sitemap index if that's
    what sitemap.xml is) plus the links on the overview page -- whichever
    lists them; both are read and merged. Returns {their-url-name: url}.
    """
    found: dict[str, str] = {}

    def take(url: str) -> None:
        if m := VARIETY_URL.search(url.split("?")[0].split("#")[0]):
            found.setdefault(m.group(1), url)

    try:
        xml = fetch(SITEMAP, delay)
        locs = re.findall(r"<loc>\s*(.*?)\s*</loc>", xml)
        children = [l for l in locs if l.endswith(".xml") or "sitemap" in l.rsplit("/", 1)[-1]]
        for loc in locs:
            take(loc)
        for child in children:
            try:
                for loc in re.findall(r"<loc>\s*(.*?)\s*</loc>", fetch(child, delay)):
                    take(loc)
            except requests.RequestException:
                continue
    except requests.RequestException:
        pass

    try:
        soup = BeautifulSoup(fetch(OVERVIEW, delay), "lxml")
        for a in soup.find_all("a", href=True):
            take(requests.compat.urljoin(OVERVIEW, a["href"]))
    except requests.RequestException:
        pass

    return dict(sorted(found.items()))


def discover(delay: float, as_json: bool) -> None:
    varieties = discover_varieties(delay)
    if as_json:
        print(json.dumps({"source": SOURCE_ID, "varieties": varieties}, indent=2))
        return
    mapped = {v for v in load_map().values() if v}
    print(f"\n{len(varieties)} variety page(s) found:\n")
    for name in varieties:
        flag = "" if name in mapped else "   <- not in barthhaas_map.yml"
        print(f"  {name}{flag}")
    print()


def page_identity(html: str) -> dict:
    """Name, international code and origin from the header block under the
    <h1>: a bold <p> with the code ("CAS") and a plain one with the origin."""
    soup = BeautifulSoup(html, "lxml")
    h1 = soup.find("h1")
    out = {"name": h1.get_text(" ", strip=True) if h1 else None, "code": None, "origin": None}
    if not h1:
        return out
    for p in h1.find_next_siblings("p", limit=4):
        classes = p.get("class") or []
        text = p.get_text(" ", strip=True)
        if "text-display-4-bold" in classes and out["code"] is None and re.fullmatch(r"[A-Z0-9]{2,6}", text):
            out["code"] = text
        elif "text-display-4" in classes and out["origin"] is None:
            out["origin"] = text
    return out


def write_catalog(delay: float, fixture: str | None) -> None:
    """Snapshot the catalog to catalogs/barthhaas.json; optionally save one raw
    page as a test fixture so the parser can be checked against real markup."""
    varieties = discover_varieties(delay)
    details = {}
    for name, url in varieties.items():
        try:
            details[name] = page_identity(fetch(url, delay))
        except requests.RequestException:
            details[name] = {"name": None, "code": None, "origin": None, "error": "page did not load"}
    CATALOG_FILE.parent.mkdir(exist_ok=True)
    CATALOG_FILE.write_text(
        json.dumps({"source": SOURCE_ID, "crawled": time.strftime("%Y-%m-%d"),
                    "count": len(varieties), "varieties": varieties, "details": details},
                   indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {CATALOG_FILE.relative_to(ROOT)}: {len(varieties)} varieties")
    if fixture:
        html = fetch(f"{BASE}{fixture}", delay)
        out = FIXTURES / f"barthhaas-{fixture}.html"
        out.write_text(html, encoding="utf-8")
        print(f"wrote {out.relative_to(ROOT)} (real page, {len(html)} bytes)")


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
    parser.add_argument("--catalog", action="store_true", help="write catalogs/barthhaas.json")
    parser.add_argument("--fixture", help="with --catalog, also save this variety's raw page as a fixture")
    parser.add_argument("--apply", action="store_true", help="write changes to data/hops/")
    parser.add_argument("--force", action="store_true", help="replace existing barthhaas observations")
    parser.add_argument("--refresh", action="store_true", help="ignore the local cache")
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between requests")
    parser.add_argument("--from-file", help="parse a saved HTML file instead of fetching")
    parser.add_argument("--verbose", action="store_true", help="show fields we do not model")
    args = parser.parse_args()

    if args.catalog:
        write_catalog(args.delay, args.fixture)
        return 0
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
            print(f"\n{slug}: not in barthhaas_map.yml — run --discover to see their catalogue")
            continue
        if brand is False:
            print(f"\n{slug}: mapped as not carried by BarthHaas, skipping")
            continue

        url = f"{BASE}{brand}"
        try:
            html = Path(args.from_file).read_text(encoding="utf-8") if args.from_file else fetch(
                url, args.delay, args.refresh
            )
        except requests.HTTPError as error:
            print(f"\n{slug}: {error} — check the name in barthhaas_map.yml")
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
