#!/usr/bin/env python3
"""
Read Brooks's Untappd "Beer History" page (copied from untappd.com as text)
into data/untappd/history.yml: one entry per beer with his caps rating and
first/last dates. Untappd's full export needs an Insider account; the
Beer History page doesn't, and it carries what HopLove shows -- the rating.

    python tools/ingest/untappd_history.py pasted.txt

Merges into what's on file (a beer already there takes the newer copy's
rating and dates). Venues and comments aren't on that page and aren't kept.
"""
from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "untappd" / "history.yml"
RATING = re.compile(r"^Your? Rating \(([\d.]+)\)$")
STATS = re.compile(r"First: (\d\d/\d\d/\d\d)Recent: (\d\d/\d\d/\d\d)Total: (\d+)")


def iso(mdy: str) -> str:
    return datetime.strptime(mdy, "%m/%d/%y").strftime("%Y-%m-%d")


def parse(text: str) -> list[dict]:
    lines = [l.strip() for l in text.splitlines()]
    out = []
    for i, line in enumerate(lines):
        m = RATING.match(line)
        if not m:
            continue
        # Walking back from the rating: style, brewery, beer name (blank lines between).
        before = [l for l in lines[max(0, i - 8):i] if l]
        if len(before) < 3:
            continue
        beer, brewery, style = before[-3], before[-2], before[-1]
        stats = next((STATS.search(l) for l in lines[i + 1:i + 8] if STATS.search(l)), None)
        stars = float(m.group(1))
        item = {"beer": beer, "brewery": brewery, "style": style}
        if 0.25 <= stars <= 5:
            item["rating"] = round(stars * 4) / 4
        if stats:
            item["first"], item["last"], item["total"] = iso(stats.group(1)), iso(stats.group(2)), int(stats.group(3))
        out.append(item)
    return out


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    found = parse(Path(sys.argv[1]).read_text(encoding="utf-8"))
    yaml = YAML()
    yaml.width = 4096
    yaml.indent(mapping=2, sequence=4, offset=2)
    doc = yaml.load(OUT.read_text(encoding="utf-8")) if OUT.exists() else CommentedMap()
    doc["source"] = "Brooks's Untappd Beer History page (tools/ingest/untappd_history.py) -- one entry per beer, with his rating"
    have = {(e["beer"].lower(), e["brewery"].lower()): e for e in doc.get("beers") or []}
    added = 0
    for item in found:
        key = (item["beer"].lower(), item["brewery"].lower())
        if key in have:
            if item.get("last", "") >= str(have[key].get("last", "")):
                have[key].update(item)
        else:
            have[key] = CommentedMap(item)
            added += 1
    doc["beers"] = sorted(have.values(), key=lambda e: str(e.get("last", "")), reverse=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    yaml.dump(doc, OUT.open("w", encoding="utf-8"))
    print(f"read {len(found)} beers ({sum('rating' in f for f in found)} rated); {added} new; {len(doc['beers'])} on file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
