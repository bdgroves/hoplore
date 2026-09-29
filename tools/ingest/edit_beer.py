#!/usr/bin/env python3
"""
Apply an "Edit this beer" issue to data/beers/overrides.yml.

Beer pages (for Brooks) have an Edit form: brewery name, town, state,
website, beer name, style, ABV and the hop list. Saving opens an issue
marked <!-- hoplove-beer-edit --> holding the changes as YAML; the "Add a
scanned beer" workflow runs this on it:

    EDIT_BODY="$(issue body)" python tools/ingest/edit_beer.py

Edits go to an overrides file rather than into data/beers/*.yml because the
crawler rewrites those files twice a week; scripts/lib/load.js lays the
overrides on top when the site builds, so a fix sticks. The beer keeps its
address (brewery and beer slugs never change here). Hops are re-read with
the same rules as everywhere else (beers.parse_hop), so "Fresh Centennial
from Carpenter Ranches" becomes a fresh Centennial with its farm.
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
from beers import parse_hop, record_index  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "beers" / "overrides.yml"
MARKER = "hoplove-beer-edit"
SLUG = re.compile(r"[a-z0-9-]+")

BREWERY_FIELDS = ("name", "city", "state", "url")
BEER_FIELDS = ("name", "style", "abv", "hops_as_written")


def clean(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def main() -> int:
    body = os.environ.get("EDIT_BODY", "")
    if MARKER not in body:
        print("not a HopLove edit issue")
        return 1
    m = re.search(r"```ya?ml\s*\n(.*?)```", body, re.S)
    if not m:
        print("no yaml block in the issue")
        return 1
    data = YAML(typ="safe").load(m.group(1)) or {}
    brewery, beer = clean(data.get("brewery_slug")), clean(data.get("beer_slug"))
    if not brewery or not beer or not SLUG.fullmatch(brewery) or not SLUG.fullmatch(beer):
        print("brewery_slug and beer_slug must be the slugs from the beer page's address")
        return 1

    yaml = YAML()
    yaml.width = 4096
    yaml.indent(mapping=2, sequence=4, offset=2)
    if OUT.exists():
        doc = yaml.load(OUT.read_text(encoding="utf-8"))
    else:
        doc = CommentedMap()
        doc["about"] = "Hand corrections from the Edit form on beer pages (tools/ingest/edit_beer.py), laid over data/beers/*.yml at build time."
        doc["breweries"] = CommentedMap()
        doc["beers"] = CommentedMap()

    changed = []
    b = doc["breweries"].get(brewery) or CommentedMap()
    for field in BREWERY_FIELDS:
        value = clean(data.get(f"brewery_{field}"))
        if value is not None:
            if field == "state":
                value = value.upper()[:2]
            if field == "url" and not re.match(r"https?://", value):
                value = "https://" + value
            b[field] = value
            changed.append(f"brewery {field}")
    if len(b):
        doc["breweries"][brewery] = b

    key = f"{brewery}/{beer}"
    e = doc["beers"].get(key) or CommentedMap()
    for field in BEER_FIELDS:
        value = clean(data.get(field))
        if value is None:
            continue
        if field == "abv":
            try:
                value = float(value)
            except ValueError:
                continue
            if not 0.5 <= value <= 18:
                continue
        e[field] = value
        changed.append(field)
    hops = [clean(h) for h in (data.get("hops") or []) if clean(h)]
    if hops:
        index = record_index()
        seq = CommentedSeq()
        for token in hops[:40]:
            item = parse_hop(token, index)
            if not item.get("name"):
                continue
            node = CommentedMap((k, item[k]) for k in ("hop", "name", "form", "product", "fresh", "farm", "as_written") if k in item)
            node.fa.set_flow_style()
            seq.append(node)
        e["hops"] = seq
        changed.append(f"{len(seq)} hops")
    e["edited"] = time.strftime("%Y-%m-%d", time.gmtime())
    doc["beers"][key] = e

    OUT.parent.mkdir(parents=True, exist_ok=True)
    buffer = io.StringIO()
    yaml.dump(doc, buffer)
    text = re.sub(r"\{(?=\S)", "{ ", buffer.getvalue())
    text = re.sub(r"(?<=\S)\}", " }", text)
    OUT.write_text(text, encoding="utf-8")

    summary = f"{data.get('name') or beer} ({data.get('brewery_name') or brewery}): {', '.join(changed) or 'nothing changed'}"
    print(f"edited {summary}")
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"page=beers/{brewery}/{beer}/\n")
            fh.write(f"summary={summary}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
