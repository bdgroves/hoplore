#!/usr/bin/env python3
"""
Untappd check-ins, kept as a growing history.

brooksgroves.com's own "Fetch Untappd Checkins" workflow writes the latest 20
check-ins to https://brooksgroves.com/beers.json every few days. This reads
that file and merges it into data/untappd/checkins.yml, keyed by check-in id,
so HopLove keeps every check-in it has ever seen rather than a rolling 20.

    pixi run -e data python tools/ingest/untappd.py                 # fetch and merge
    pixi run -e data python tools/ingest/untappd.py --from beers.json   # merge a local copy
    pixi run -e data python tools/ingest/untappd.py --export untappd.json  # a full Untappd export

The export (Untappd Insider > Account > Download History, JSON or CSV) is the
one place Untappd hands over every check-in *with* its rating, so importing
it fills in the whole history and every caps rating at once.

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
import os
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


class Blocked(Exception):
    pass


def from_export(row: dict) -> CommentedMap | None:
    """One check-in from an Untappd history export (JSON or CSV row)."""
    try:
        cid = int(row.get("checkin_id") or 0)
    except (TypeError, ValueError):
        return None
    if not cid or not row.get("beer_name") or not row.get("brewery_name"):
        return None
    item = CommentedMap()
    item["id"] = cid
    item["date"] = str(row.get("created_at") or "")[:10] or None
    item["beer"] = str(row["beer_name"]).strip()
    item["brewery"] = str(row["brewery_name"]).strip()
    if row.get("venue_name"):
        item["venue"] = str(row["venue_name"]).strip()
    if row.get("comment"):
        item["comment"] = str(row["comment"]).strip()
    if row.get("photo_url"):
        item["photo"] = str(row["photo_url"])
    item["link"] = str(row.get("checkin_url") or f"https://untappd.com/user/bdgroves/checkin/{cid}")
    try:
        stars = float(row.get("rating_score") or 0)
    except (TypeError, ValueError):
        stars = 0
    if 0.25 <= stars <= 5:
        item["rating"] = round(stars * 4) / 4
    return item


def fetch_rating(link: str) -> float | None:
    """The caps rating on a public check-in page, or None."""
    try:
        r = requests.get(link, headers={"User-Agent": BROWSER_UA, "Accept": "text/html"}, timeout=30)
    except requests.RequestException:
        return None
    if r.status_code in (403, 429):
        raise Blocked(f"untappd.com answered {r.status_code}")
    if r.status_code != 200:
        print(f"  {r.status_code} for {link}")
        return None
    m = RATING.search(r.text)
    return float(m.group(1)) if m and float(m.group(1)) > 0 else None


RSS = os.environ.get("UNTAPPD_RSS_URL") or "https://untappd.com/rss/user/Bdgroves"


def read_rss() -> list[dict]:
    """Check-ins from the Untappd RSS feed, in beers.json's shape."""
    import xml.etree.ElementTree as ET

    try:
        r = requests.get(RSS, headers={"User-Agent": "Mozilla/5.0 (compatible; brooksgroves-bot/1.0)"}, timeout=20)
        r.raise_for_status()
        channel = ET.fromstring(r.content).find("channel")
    except (requests.RequestException, ET.ParseError) as error:
        print(f"rss: {error}")
        return []
    out = []
    for item in channel.findall("item") if channel is not None else []:
        get = lambda name: (item.findtext(name) or "").strip()
        desc = get("description")
        img = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', desc)
        out.append({
            "title": get("title"),
            "description": re.sub(r"<[^>]+>", "", desc).strip(),
            "image": img.group(1) if img else "",
            "link": get("link"),
            "date": get("pubDate"),
        })
    print(f"rss: {len(out)} check-in(s)")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="source", help="read a local beers.json instead of fetching")
    ap.add_argument("--export", help="merge an Untappd history export (.json or .csv), ratings included")
    ap.add_argument("--ratings", action="store_true", help="read star ratings from recent check-in pages on untappd.com")
    args = ap.parse_args()

    if args.export:
        data = {"checkins": []}
    elif args.source:
        data = json.loads(Path(args.source).read_text(encoding="utf-8"))
    else:
        # Straight from Untappd's feed when it answers (fresh to the minute),
        # and brooksgroves.com/beers.json as well (refreshed every few days)
        # so a blocked feed never leaves HopLove empty-handed.
        data = {"checkins": read_rss()}
        try:
            r = requests.get(URL, headers={"User-Agent": UA}, timeout=30)
            r.raise_for_status()
            data["checkins"] += r.json().get("checkins", [])
        except requests.RequestException as error:
            print(f"beers.json: {error}")

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

    if args.export:
        path = Path(args.export)
        if path.suffix.lower() == ".csv":
            import csv
            rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
        else:
            rows = json.loads(path.read_text(encoding="utf-8-sig"))
        rated = 0
        for row in rows:
            item = from_export(row)
            if not item:
                continue
            if item["id"] in have:
                # Keep what's on file, but take the export's rating and photo.
                for key in ("rating", "photo", "venue", "comment"):
                    if key in item and have[item["id"]].get(key) is None:
                        have[item["id"]][key] = item[key]
            else:
                have[item["id"]] = item
                added += 1
            rated += "rating" in item
        print(f"export: {len(rows)} rows, {rated} rated")

    if args.ratings:
        # Only the last few weeks: once a rating is found it's kept, and an
        # old check-in Untappd wouldn't show us isn't worth asking about daily.
        since = (date.today() - timedelta(days=21)).isoformat()
        rated = 0
        for c in have.values():
            if c.get("rating") is None and str(c.get("date") or "") >= since and c.get("link"):
                try:
                    stars = fetch_rating(c["link"])
                except Blocked as e:
                    print(f"{e}; skipping ratings this run")
                    break
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
