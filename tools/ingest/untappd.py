#!/usr/bin/env python3
"""
Untappd check-ins, kept as a growing history.

brooksgroves.com's own "Fetch Untappd Checkins" workflow writes the latest 20
check-ins to https://brooksgroves.com/beers.json every few days. This reads
that file and merges it into data/untappd/checkins.yml, keyed by check-in id,
so HopLove keeps every check-in it has ever seen rather than a rolling 20.

    pixi run -e data python tools/ingest/untappd.py                 # fetch and merge
    pixi run -e data python tools/ingest/untappd.py --from beers.json   # merge a local copy

The RSS behind beers.json carries the beer, brewery, venue, comment and photo,
but not the star rating. With --ratings it also opens each recent check-in's
own public page on untappd.com and reads the caps rating from it, best effort:
if Untappd turns the request away the check-in simply stays unrated. Ratings
set on HopLove itself live in data/ratings.yml.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
from datetime import date, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "untappd" / "checkins.yml"
URL = "https://brooksgroves.com/beers.json"
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
UA = "Mozilla/5.0 (compatible; HopLove/0.1; +https://github.com/bdgroves/hoplore)"

TITLE = re.compile(r"^.+? is drinking an? (?P<beer>.+?) by\s+(?P<brewery>.+?)(?: at (?P<venue>.+))?$")


def parse(entry: dict) -> CommentedMap | None:
    m = TITLE.match(re.sub(r"\s+", " ", entry.get("title", "")).strip())
    link = entry.get("link", "")
    cid = re.search(r"/checkin/(\d+)", link)
    if not m or not cid:
        return None
    item = CommentedMap()
    item["id"] = int(cid.group(1))
    try:
        item["date"] = parsedate_to_datetime(entry.get("date", "")).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        item["date"] = None
    item["beer"] = m.group("beer").strip()
    item["brewery"] = m.group("brewery").strip()
    if m.group("venue"):
        item["venue"] = m.group("venue").strip()
    if entry.get("description"):
        item["comment"] = entry["description"].strip()
    if entry.get("image"):
        item["photo"] = entry["image"]
    item["link"] = link
    return item


RATING = re.compile(r'rating-serving.{0,400}?data-rating="([\d.]+)"', re.S)


def fetch_rating(link: str) -> float | None:
    """The caps rating on a public check-in page, or None."""
    try:
        r = requests.get(link, headers={"User-Agent": BROWSER_UA, "Accept": "text/html"}, timeout=30)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        print(f"  {r.status_code} for {link}")
        return None
    m = RATING.search(r.text)
    return float(m.group(1)) if m and float(m.group(1)) > 0 else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="source", help="read a local beers.json instead of fetching")
    ap.add_argument("--ratings", action="store_true", help="read star ratings from recent check-in pages on untappd.com")
    args = ap.parse_args()

    if args.source:
        data = json.loads(Path(args.source).read_text(encoding="utf-8"))
    else:
        r = requests.get(URL, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
        data = r.json()

    yaml = YAML()
    yaml.width = 4096
    yaml.indent(mapping=2, sequence=4, offset=2)
    have: dict[int, CommentedMap] = {}
    if OUT.exists():
        doc = yaml.load(OUT.read_text(encoding="utf-8")) or {}
        for c in doc.get("checkins") or []:
            have[int(c["id"])] = c

    added = 0
    for entry in data.get("checkins", []):
        item = parse(entry)
        if item and item["id"] not in have:
            have[item["id"]] = item
            added += 1

    if args.ratings:
        # Only the last few weeks: once a rating is found it's kept, and an
        # old check-in Untappd wouldn't show us isn't worth asking about daily.
        since = (date.today() - timedelta(days=21)).isoformat()
        rated = 0
        for c in have.values():
            if c.get("rating") is None and str(c.get("date") or "") >= since and c.get("link"):
                stars = fetch_rating(c["link"])
                if stars is not None:
                    c["rating"] = stars
                    rated += 1
                time.sleep(2)
        print(f"{rated} rating(s) read from untappd.com")

    doc = CommentedMap()
    doc["source"] = "Untappd, via https://brooksgroves.com/beers.json (tools/ingest/untappd.py) -- do not edit by hand"
    doc["checkins"] = CommentedSeq(sorted(have.values(), key=lambda c: (str(c.get("date") or ""), c["id"]), reverse=True))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    yaml.dump(doc, buffer)
    OUT.write_text(buffer.getvalue(), encoding="utf-8")
    print(f"{added} new check-in(s); {len(have)} on file")
    return 0


if __name__ == "__main__":
    sys.exit(main())
