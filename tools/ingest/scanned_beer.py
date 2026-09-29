#!/usr/bin/env python3
"""
Add a beer from a HopLove scan (the /scan/ page) to data/beers/scanned/.

The scan page reads a can, a bottle, a menu board or a brewery's own text
with Claude, shows the hops, and -- if you want to keep it -- opens a GitHub
issue with the beer as YAML. The "Add a scanned beer" workflow runs this on
that issue:

    SCAN_BODY="$(issue body)" python tools/ingest/scanned_beer.py

It re-matches every hop name itself (the same rules beers.py uses on brewery
websites), so nothing the browser decided is trusted, and appends the beer to
data/beers/scanned/<brewery>.yml. Exit 1 with a message if the issue doesn't
hold a usable beer.
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

sys.path.insert(0, str(Path(__file__).parent))
from beers import FARMS, parse_hop, record_index  # noqa: E402
from rating import add_rating, clean_stars  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "beers" / "scanned"
MARKER = "hoplove-beer-scan"


def slugify(text: str) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]


def main() -> int:
    body = os.environ.get("SCAN_BODY", "")
    if MARKER not in body:
        print("not a HopLove scan issue")
        return 1
    m = re.search(r"```ya?ml\s*\n(.*?)```", body, re.S)
    if not m:
        print("no yaml block in the issue")
        return 1
    data = YAML(typ="safe").load(m.group(1)) or {}

    brewery = str(data.get("brewery") or "").strip()
    beer_name = str(data.get("beer") or "").strip()
    written = [str(h).strip() for h in (data.get("hops") or []) if str(h).strip()]
    missing = [k for k, v in (("brewery", brewery), ("beer", beer_name), ("hops", written)) if not v or v == "None"]
    if missing:
        print(f"the {' and '.join(missing)} line{'s are' if len(missing) > 1 else ' is'} empty -- fill {'them' if len(missing) > 1 else 'it'} in")
        return 1

    index = record_index()
    hops = CommentedSeq()
    for token in written[:40]:
        item = parse_hop(token, index)
        if not item.get("name"):
            continue
        node = CommentedMap((k, item[k]) for k in ("hop", "name", "form", "product", "fresh", "farm", "as_written") if k in item)
        node.fa.set_flow_style()
        hops.append(node)

    # The model often lists bare names ("Centennial") while the can says
    # "fresh wet Centennial" or "Carpenter Sabro": read the words just before
    # each hop in the printed text for fresh and farm.
    printed = str(data.get("hops_as_written") or "")
    for node in hops:
        if node.get("fresh") and node.get("farm"):
            continue
        m = re.search(rf"((?:[\w&'.-]+\s+){{0,4}}){re.escape(str(node['name']))}\b", printed, re.I)
        if not m:
            continue
        before = m.group(1).lower()
        # "fresh wet Centennial" is fresh; "fresh kilned Sabro" was dried.
        if not node.get("fresh") and re.search(r"\b(?:fresh|wet)\b(?!\s+kilned)", before) and "kilned" not in before.split()[-3:]:
            node["fresh"] = True
        if not node.get("farm"):
            fm = re.search(r"([A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*\s+(?:Farms?|Ranch(?:es)?|Agriculture))\s*$", m.group(1).strip() + " ")
            if fm:
                node["farm"] = fm.group(1).strip()
            else:
                last = before.split()[-2:] if before.split() else []
                for n in (2, 1):
                    key = " ".join(last[-n:]) if len(last) >= n else None
                    if key and key in FARMS:
                        node["farm"] = FARMS[key]
                        break

    OUT.mkdir(parents=True, exist_ok=True)
    # "Fortside Brewing Company" -> fortside, like the crawled breweries.
    slug = slugify(re.sub(r"\b(?:brewing|brewery|brewers|brews|beer|company|co)\b\.?", "", brewery, flags=re.I)) or slugify(brewery)
    # A brewery HopLove already crawls keeps its slug, city and website, so a
    # scanned can lands in the same section as the brewery's other beers.
    known = YAML(typ="safe").load((Path(__file__).parent / "breweries.yml").read_text(encoding="utf-8")) or []
    squash = lambda t: re.sub(r"[^a-z0-9]", "", t.lower().replace("brewing", "").replace("brewery", "").replace("brews", ""))
    match = next((b for b in known if squash(b["name"]) == squash(brewery)), None)
    if match:
        slug = match["slug"]
        data.setdefault("city", match["city"])
        data["city"] = data.get("city") or match["city"]
        data["state"] = data.get("state") or match["state"]
        data["brewery_url"] = data.get("brewery_url") or match["url"]
    path = OUT / f"{slug}.yml"
    yaml = YAML()
    yaml.width = 4096
    yaml.indent(mapping=2, sequence=4, offset=2)
    if path.exists():
        doc = yaml.load(path.read_text(encoding="utf-8"))
    else:
        doc = CommentedMap()
        meta = CommentedMap()
        meta["slug"] = slug
        meta["name"] = brewery
        meta["city"] = str(data.get("city") or "").strip() or "Unknown"
        meta["state"] = str(data.get("state") or "").strip().upper()[:2] or "WA"
        meta["url"] = str(data.get("brewery_url") or "").strip() or None
        doc["brewery"] = meta
        doc["generated_by"] = "HopLove scans (/scan/): photographed or pasted by a person, hops matched by tools/ingest/scanned_beer.py"
        doc["retrieved"] = time.strftime("%Y-%m-%d", time.gmtime())
        doc["beers"] = CommentedSeq()

    beer_slug = slugify(beer_name)
    beers = doc["beers"]
    for existing in list(beers):
        if existing.get("slug") == beer_slug:
            beers.remove(existing)  # a re-scan replaces the old entry
    beer = CommentedMap()
    beer["slug"] = beer_slug
    beer["name"] = beer_name
    beer["url"] = str(data.get("source_url") or "").strip() or doc["brewery"].get("url")
    if str(data.get("style") or "").strip() not in ("", "None"):
        beer["style"] = str(data["style"]).strip()[:80]
    if data.get("abv") not in (None, ""):
        try:
            beer["abv"] = float(data["abv"])
        except (TypeError, ValueError):
            pass
    beer["hops_as_written"] = str(data.get("hops_as_written") or ", ".join(written))[:400]
    beer["scanned_from"] = str(data.get("scanned_from") or "photo")[:40]
    beer["scanned"] = time.strftime("%Y-%m-%d", time.gmtime())
    beer["hops"] = hops
    beers.append(beer)
    doc["retrieved"] = time.strftime("%Y-%m-%d", time.gmtime())

    buffer = io.StringIO()
    yaml.dump(doc, buffer)
    text = re.sub(r"\{(?=\S)", "{ ", buffer.getvalue())
    text = re.sub(r"(?<=\S)\}", " }", text)
    path.write_text(text, encoding="utf-8")

    linked = sum(1 for h in hops if h.get("hop"))
    print(f"added {beer_name} ({brewery}) to {path.relative_to(ROOT)}: {len(hops)} hops, {linked} matched")
    stars = clean_stars(data.get("stars"))
    rated = ""
    if stars is not None:
        add_rating(doc["brewery"]["slug"], beer_slug, beer_name, doc["brewery"]["name"], stars, str(data.get("note") or "").strip())
        rated = f", rated {stars:g} caps"
        print(f"rated {stars:g}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"page=beers/{slug}/{beer_slug}/\n")
            fh.write(f"summary={beer_name} by {brewery}: {len(hops)} hops, {linked} matched to HopLove records{rated}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
