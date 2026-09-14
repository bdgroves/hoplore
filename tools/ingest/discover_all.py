#!/usr/bin/env python3
"""
Run every ingest scraper's discovery mode and report anything it lists that
HopLore does not have a record for yet.

    pixi run -e data python tools/ingest/discover_all.py
    pixi run -e data python tools/ingest/discover_all.py --out discovery-report.md

Read-only. Never touches data/hops/ or any scraper's own map file — this is
reporting, the same as scripts/coverage.js, just sourced from the live sites
instead of a hand-maintained reference list. The point is new hop releases
should find you rather than you having to remember to go check.

To add a second scraper here later: give it a discover_varieties(delay)
function returning {their-name-or-slug: display-name}, same contract as
hopsteiner.discover_varieties, and add it to SCRAPERS below.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import hopsteiner  # noqa: E402  (path insert must come first)

from ruamel.yaml import YAML

ROOT = Path(__file__).resolve().parents[2]
HOPS_DIR = ROOT / "data" / "hops"

yaml = YAML()

# Registered scrapers. Each entry needs a discover_varieties(delay) function
# that returns {their-key: display-name}.
SCRAPERS = {
    "hopsteiner": hopsteiner,
}


def normalize(name: str) -> str:
    """Loose match: case and punctuation vary between sites and our records."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def known_names() -> set[str]:
    """Every name a HopLore record already answers to."""
    names = set()
    for path in HOPS_DIR.glob("*.yml"):
        record = yaml.load(path.read_text(encoding="utf-8")) or {}
        for field in ("name",):
            if record.get(field):
                names.add(normalize(record[field]))
        for field in ("aliases", "previously_named"):
            for alt in record.get(field) or []:
                names.add(normalize(alt))
        if record.get("slug"):
            names.add(normalize(record["slug"]))
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--delay", type=float, default=2.0, help="seconds between requests")
    parser.add_argument("--out", help="also write the report to this file (for the GitHub issue body)")
    args = parser.parse_args()

    existing = known_names()
    lines: list[str] = []
    total_new = 0

    for source_id, module in SCRAPERS.items():
        try:
            varieties = module.discover_varieties(args.delay)
        except Exception as error:  # noqa: BLE001 — a scraper breaking should not kill the others
            lines.append(f"### {source_id}\n\n_discovery failed: {error}_\n")
            continue

        new = {
            key: display
            for key, display in varieties.items()
            if normalize(display) not in existing and normalize(key) not in existing
        }
        total_new += len(new)

        lines.append(f"### {source_id}")
        lines.append(f"{len(varieties)} varieties listed, {len(new)} not matched to an existing record.\n")
        if new:
            for key in sorted(new):
                lines.append(f"- **{new[key]}** (`{key}`)")
        else:
            lines.append("_nothing new._")
        lines.append("")

    header = f"## HopLore discovery report\n\n{total_new} possibly-new variety name(s) found across {len(SCRAPERS)} scraper(s).\n"
    report = header + "\n" + "\n".join(lines)

    print(report)
    if args.out:
        Path(args.out).write_text(report, encoding="utf-8")

    # Always exits 0 — this is a report, not a gate. The workflow decides
    # whether total_new > 0 is worth opening an issue over.
    return 0


if __name__ == "__main__":
    sys.exit(main())
