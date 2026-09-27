#!/usr/bin/env python3
"""
Star ratings set on HopLove, kept in data/ratings.yml.

Untappd-style: 0.25 to 5 caps in quarter steps, plus an optional note. A
rating comes from one of two places:

  * the "Rate it" button on a beer page, which opens a GitHub issue marked
    <!-- hoplove-rating --> holding brewery, beer, stars and note as YAML;
    the "Add a scanned beer" workflow runs this script on it:

        RATING_BODY="$(issue body)" python tools/ingest/rating.py

  * a scan (tools/ingest/scanned_beer.py) that was rated on the scan page,
    which calls add_rating() directly.

Rating the same beer again replaces the earlier rating; the date moves.
"""
from __future__ import annotations

import io
import os
import re
import sys
import time
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "ratings.yml"
MARKER = "hoplove-rating"


def clean_stars(value) -> float | None:
    try:
        stars = float(value)
    except (TypeError, ValueError):
        return None
    stars = round(stars * 4) / 4
    return stars if 0.25 <= stars <= 5 else None


def add_rating(brewery: str, beer: str, name: str, brewery_name: str, stars: float, note: str = "") -> None:
    yaml = YAML()
    yaml.width = 4096
    yaml.indent(mapping=2, sequence=4, offset=2)
    if OUT.exists():
        doc = yaml.load(OUT.read_text(encoding="utf-8"))
    else:
        doc = CommentedMap()
        doc["about"] = "Brooks's own ratings, set on HopLove (tools/ingest/rating.py). 0.25-5 caps, like Untappd."
        doc["ratings"] = CommentedSeq()
    ratings = doc["ratings"]
    for old in list(ratings):
        if old.get("brewery") == brewery and old.get("beer") == beer:
            ratings.remove(old)
    item = CommentedMap()
    item["brewery"] = brewery
    item["beer"] = beer
    item["name"] = f"{name} ({brewery_name})"
    item["stars"] = stars
    if note:
        item["note"] = note[:600]
    item["date"] = time.strftime("%Y-%m-%d", time.gmtime())
    ratings.insert(0, item)
    buffer = io.StringIO()
    yaml.dump(doc, buffer)
    OUT.write_text(buffer.getvalue(), encoding="utf-8")


def main() -> int:
    body = os.environ.get("RATING_BODY", "")
    if MARKER not in body:
        print("not a HopLove rating issue")
        return 1
    m = re.search(r"```ya?ml\s*\n(.*?)```", body, re.S)
    if not m:
        print("no yaml block in the issue")
        return 1
    data = YAML(typ="safe").load(m.group(1)) or {}
    brewery, beer = str(data.get("brewery") or "").strip(), str(data.get("beer") or "").strip()
    stars = clean_stars(data.get("stars"))
    if not re.fullmatch(r"[a-z0-9-]+", brewery) or not re.fullmatch(r"[a-z0-9-]+", beer):
        print("brewery and beer must be the slugs from the beer page's address")
        return 1
    if stars is None:
        print("stars must be between 0.25 and 5")
        return 1
    name = str(data.get("name") or beer).strip()
    brewery_name = str(data.get("brewery_name") or brewery).strip()
    add_rating(brewery, beer, name, brewery_name, stars, str(data.get("note") or "").strip())
    summary = f"{name} ({brewery_name}): {stars:g} caps"
    print(f"rated {summary}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"page=beers/{brewery}/{beer}/\n")
            fh.write(f"summary={summary}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
