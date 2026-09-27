#!/usr/bin/env python3
"""
What's in the can: the hops a brewery says it used, linked to HopLore records.

    pixi run -e data python tools/ingest/beers.py      # parse saved pages -> data/beers/

Reads the brewery's own beer pages from tools/ingest/raw/pages/ (saved by
snapshot.py) and writes data/beers/<brewery>.yml. Only what the brewery
publishes: the hop names as written, the ABV, the page URL. Each hop name is
matched to a record; one that doesn't match stays in the file unlinked, so a
missing record is visible rather than dropped.

Form words are kept apart from the variety ("Citra Cryo" is Citra, as Cryo
pellets), and fresh-hop additions keep the farm when the brewery names it.
"""
from __future__ import annotations

import io
import re
import sys
import time
from pathlib import Path

from bs4 import BeautifulSoup
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

HERE = Path(__file__).parent
ROOT = HERE.parents[1]
RAW = HERE / "raw" / "pages"
OUT = ROOT / "data" / "beers"

# Product and form words that follow a variety name. Order matters: the
# longest phrase wins.
FORMS = [
    ("co2 extract", "CO2 extract"),
    ("hop kief", "hop kief"),
    ("kief", "hop kief"),
    ("cryo", "Cryo"),
    ("lupuln2", "LupuLN2"),
    ("cgx", "CGX"),
    ("hyperboost", "HyperBoost"),
    ("dynaboost", "DynaBoost"),
    ("amplifier", "Amplifier"),
    ("incognito", "Incognito"),
    ("spectrum", "Spectrum"),
    ("t90", "T90"),
]

# Names breweries use that no record answers to directly.
ALIASES = {
    "nelson": "nelson-sauvin",
    "ekg": "east-kent-golding",
    "hallertau mittelfruh": "hallertau-mittelfrueh",
    "hallertauer mittelfruh": "hallertau-mittelfrueh",
    "tradition": "hallertau-tradition",
    "german saaz": "saaz-cz",
    "mt hood": "mount-hood",
    "ctz": "columbus",
}


def norm(text: str) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", text.lower())


# Farm names a brewery writes in front of a variety ("Crosby, Centennial").
FARMS = {"crosby": "Crosby Hop Farm", "coleman": "Coleman Farms"}


def record_index() -> dict[str, str]:
    safe = YAML(typ="safe")
    out: dict[str, str] = {}
    for path in sorted((ROOT / "data" / "hops").glob("*.yml")):
        rec = safe.load(path.read_text(encoding="utf-8"))
        for alt in [rec["name"], rec["slug"], *(rec.get("aliases") or []), *(rec.get("previously_named") or [])]:
            out.setdefault(norm(str(alt)), rec["slug"])
    for alias, slug in ALIASES.items():
        out.setdefault(norm(alias), slug)
    return out


def parse_hop(token: str, index: dict[str, str]) -> dict:
    """'Fresh Strata Hops from Coleman Farms' -> {hop: strata, fresh: True, farm: 'Coleman Farms'}"""
    item: dict = {"as_written": token}
    text = token.strip()
    if m := re.search(r"\bfrom\s+(.+)$", text, re.I):
        item["farm"] = m.group(1).strip()
        text = text[: m.start()].strip()
    if m := re.search(r"\(([^)]*)\)", text):
        item["product"] = m.group(1).strip()
        text = (text[: m.start()] + text[m.end():]).strip()
    if re.match(r"fresh\b", text, re.I):
        item["fresh"] = True
        text = re.sub(r"^fresh\s+", "", text, flags=re.I)
    text = re.sub(r"\bhops?\b", "", text, flags=re.I).strip()
    low = text.lower()
    for word, label in FORMS:
        if re.search(rf"\b{re.escape(word)}$", low):
            item["form"] = label
            text = text[: len(text) - len(word)].strip()
            break
    name = re.sub(r"[™®]", "", text).strip(" .,-")
    slug = index.get(norm(name))
    item["name"] = name
    item["hop"] = slug
    return item


def split_hops(line: str) -> list[str]:
    line = re.sub(r"\band\b", ",", line)
    line = re.sub(r"Hallertauer,\s*Mittelfr", "Hallertauer Mittelfr", line)  # a stray comma on one page
    return [t.strip() for t in line.split(",") if t.strip()]


# ------------------------------------------------------------------ Fort George

FORT_GEORGE = {
    "slug": "fort-george",
    "name": "Fort George Brewery",
    "city": "Astoria",
    "state": "OR",
    "url": "https://fortgeorgebrewery.com/",
    "pages": "fortgeorgebrewery.com",
}


def fort_george_beer(path: Path, index: dict[str, str]) -> dict | None:
    soup = BeautifulSoup(path.read_text(encoding="utf-8"), "lxml")
    h1 = soup.find("h1")  # sits in the page <header>, so read it before stripping chrome
    name = h1.get_text(" ", strip=True) if h1 else None
    for tag in soup(["script", "style", "noscript", "nav", "footer"]):
        tag.decompose()
    body = soup.find("article") or soup
    text = re.sub(r"\s+", " ", body.get_text(" "))
    notes_at = text.find("Brewer's Notes")
    notes = text[notes_at:] if notes_at >= 0 else ""

    hops_line = None
    if m := re.search(r"\bHops?:\s*(.+?)(?=\s+[A-Z][a-z]+:|$)", notes):
        hops_line = m.group(1).strip()
    elif m := re.search(r"dry[- ]hopped with ([A-Z][\w\s-]+?) hops", text):
        hops_line = m.group(1).strip()
    if not name or not hops_line or hops_line.lower() in ("none", "n/a", "-"):
        return None

    abv = re.search(r"([\d.]+)\s*%\s*ABV", text)
    slug = path.stem.removeprefix("beer_")
    beer = CommentedMap()
    beer["slug"] = re.sub(r"-\d+$", "", slug) if slug.endswith("-2") else slug
    beer["name"] = name
    beer["url"] = f"https://fortgeorgebrewery.com/beer/{slug}/"
    if abv:
        beer["abv"] = float(abv.group(1))
    beer["hops_as_written"] = hops_line
    hops = CommentedSeq()
    farm = None
    for token in split_hops(hops_line):
        if norm(token) in FARMS:
            farm = FARMS[norm(token)]
            continue
        item = parse_hop(token, index)
        if farm:
            item.setdefault("farm", farm)
            farm = None
        node = CommentedMap((k, item[k]) for k in ("hop", "name", "form", "product", "fresh", "farm", "as_written") if k in item)
        node.fa.set_flow_style()
        hops.append(node)
    beer["hops"] = hops
    return beer


def write(brewery: dict, beers: list) -> None:
    doc = CommentedMap()
    doc["brewery"] = CommentedMap((k, v) for k, v in brewery.items() if k != "pages")
    doc["generated_by"] = "tools/ingest/beers.py from the brewery's own beer pages -- do not edit by hand"
    doc["retrieved"] = time.strftime("%Y-%m-%d", time.gmtime())
    doc["beers"] = CommentedSeq(sorted(beers, key=lambda b: b["name"].lower()))
    out = YAML()
    out.width = 4096
    out.indent(mapping=2, sequence=4, offset=2)
    buffer = io.StringIO()
    out.dump(doc, buffer)
    text = re.sub(r"\{(?=\S)", "{ ", buffer.getvalue())
    text = re.sub(r"(?<=\S)\}", " }", text)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{brewery['slug']}.yml").write_text(text, encoding="utf-8")


def main() -> int:
    index = record_index()
    pages = sorted((RAW / FORT_GEORGE["pages"]).glob("beer_*.html"))
    beers = [b for b in (fort_george_beer(p, index) for p in pages) if b]
    write(FORT_GEORGE, beers)
    unlinked = sorted({h["name"] for b in beers for h in b["hops"] if not h["hop"]})
    print(f"wrote data/beers/{FORT_GEORGE['slug']}.yml: {len(beers)} of {len(pages)} beers list their hops")
    print(f"  unlinked hop names: {', '.join(unlinked) or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
