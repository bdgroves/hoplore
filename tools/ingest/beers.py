#!/usr/bin/env python3
"""
What's in the can: the hops a brewery says it used, linked to HopLove records.

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
    ("lupomax", "LupoMax"),
    ("pellets", None),
    ("abstrax", "Abstrax"),
    ("noble", None),
    ("dry hop", None),
    ("dry", None),
    ("extract", "extract"),
    ("t45", "T45"),
    ("cyo", "Cryo"),
    ("quantum brite", "Quantum"),
    ("whole cone", "whole cone"),
    ("whole leaf", "whole cone"),
]

# Words in front of a variety: a form, or where it was grown. The form is
# kept; the origin is dropped from the name so "German Tettnang" finds
# Tettnang.
PREFIX_FORMS = {"frozen": "frozen", "second-use": "second use", "cryo-": "Cryo", "cryo": "Cryo", "cgx": "CGX", "abstrax quantum:": "Quantum", "lupomax": "LupoMax", "lupuln2": "LupuLN2", "whole leaf": "whole cone", "whole cone": "whole cone"}
ORIGINS = r"(?:german|gr|nz|us|usa|american|czech|oregon|washington|yakima|aged|estate|local|hallertau|slovenian|uk|english|mi|michigan|new zealand|australian|yakima valley|willamette valley)"

# Not hops: malts, numbers and spec words that leak into a hop field.
NOT_HOPS = re.compile(r"^(two row|2-row|vienna|munich|pilsner|pils|wheat|oats?|malt|\d+ ?ibu|ibu|abv|lactic.*|euphorics.*|yeast.*|aged|none|caramel.*|carapils|black|ginger|lime juice|linc .*|mar+is otter|esb|honey malt|golden promise|rye|spelt|flaked .*)$", re.I)

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
    "mosiac": "mosaic",
    "moteuka": "motueka",
    "lorian": "lorien",
    "hbc 586": "krush",
    "586": "krush",
    "hbc 1019": "dolcita",
    "bhc 1019": "dolcita",
    "east kent goldings": "east-kent-golding",
    "east kent golding": "east-kent-golding",
    "goldings": "east-kent-golding",
    "mittelfruh": "hallertau-mittelfrueh",
    "hallertau": "hallertau-mittelfrueh",
    "hallertauer": "hallertau-mittelfrueh",
    "spalt": "spalt-spalter",
    "tettnanger": "tettnang",
    "el dorado": "el-dorado",
    "idaho 7": "idaho-7",
    "idaho7": "idaho-7",
    "hesrbrucker": "hersbrucker",
    "calista": "callista",
    "uk golding": "golding-uk",
    "haltetau mittelfruh": "hallertau-mittelfrueh",
    "mandarina baveria": "mandarina-bavaria",
    "luminosia": "luminosa",
    "sincoe": "simcoe",
    "styrian goldings": "styrian-golding",
    "styrin wolf": "styrian-wolf",
    "mandarina": "mandarina-bavaria",
    "huell melon": "huell-melon",
    "hull melon": "huell-melon",
    "spalt select": "spalter-select",
    "mt hood": "mount-hood",
    "whitbread golding variety": "whitbread-golding-variety",
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
    # Who sold it ("YCH Citra", "BarthHaas Mosaic Incognito") isn't part of the name.
    text = re.sub(r"^(?:YCH|Yakima Chief(?: Hops)?|BarthHaas|Barth Haas|Hopsteiner|John I\.? Haas|Haas)\s+", "", text, flags=re.I)
    # YCH Cryo Fresh: fresh hops, frozen as lupulin pellets at the farm.
    if m := re.search(r"\bcryo[- ]?fresh\b", text, re.I):
        item["fresh"] = True
        item["product"] = "Cryo Fresh"
        text = (text[: m.start()] + text[m.end():]).strip()
    if m := re.match(r"(?:(?:fresh(?:ly)?|wet)(?:[- ](?:picked|hop|hopped))?(?:,?\s+(?:and\s+)?))+", text, re.I):
        item["fresh"] = True  # "Fresh Strata", "freshly picked Simcoe", "wet hop Centennial", "fresh, wet Centennial"
        text = text[m.end():]
    text = re.sub(r"\bhops?\b", "", text, flags=re.I)
    text = re.sub(r"\s+", " ", re.sub(r"[™®]", " ", text)).strip()
    low = text.lower()
    for word, label in FORMS:
        if re.search(rf"\b{re.escape(word)}$", low):
            if label:
                item["form"] = label
            text = text[: len(text) - len(word)].strip()
            break
    for word, label in PREFIX_FORMS.items():
        if text.lower().startswith(word + " "):
            item["form"] = label
            text = text[len(word):].strip()
    if gm := re.search(r",?\s*grown by (.+)$", text, re.I):
        item.setdefault("farm", gm.group(1).strip())
        text = text[: gm.start()].strip()
    if fm := re.match(r"^(.+? (?:Farms?|Ranch|Agriculture)) (.+)$", text):
        item.setdefault("farm", fm.group(1).strip())
        text = fm.group(2).strip()
    if index.get(norm(re.sub(r"\s+\d{3}$", "", text))):
        text = re.sub(r"\s+\d{3}$", "", text)  # a lot or product number ("Citra 803")
    for farm_word, farm in FARMS.items():
        if text.lower().startswith(farm_word + " "):
            item.setdefault("farm", farm)
            text = text[len(farm_word):].strip()
    stripped = re.sub(rf"^{ORIGINS}(?:[- ]grown)?\s+", "", text, flags=re.I)
    if stripped != text and index.get(norm(re.sub(r"[™®]", "", stripped))):
        text = stripped
    name = re.sub(r"[™®]", "", text).strip(" .,-")
    slug = index.get(norm(name))
    item["name"] = name
    item["hop"] = slug
    return item


def split_hops(line: str) -> list[str]:
    line = re.sub(r"\s+", " ", line.replace("\xa0", " "))
    line = re.sub(r"\bMt\.\s*", "Mt ", line, flags=re.I)
    line = re.sub(r"\band\b|\bplus\b|&|\+|;|\.\s", ",", line, flags=re.I)
    line = re.sub(r"\s+(?=Fresh\b)", ", ", line)  # "Nelson Fresh Strata": a lost line break
    line = re.sub(r"Hallertauer,\s*Mittelfr", "Hallertauer Mittelfr", line)  # a stray comma on one page
    tokens = [t.strip(" .:-") for t in line.split(",")]
    return [t for t in tokens if t and not NOT_HOPS.match(t)]


# ------------------------------------------------------------------ helpers


def page_text(path: Path) -> tuple[BeautifulSoup, str | None, str]:
    """(soup, h1 text, whitespace-collapsed body text) for a saved page."""
    soup = BeautifulSoup(path.read_text(encoding="utf-8", errors="ignore"), "lxml")
    h1 = soup.find("h1")
    name = h1.get_text(" ", strip=True) if h1 else None
    if not name and soup.title and soup.title.string:
        name = re.split(r"\s[|\u2013\u2014-]\s", soup.title.string.strip())[0].strip() or None
    for tag in soup(["script", "style", "noscript", "nav", "footer"]):
        tag.decompose()
    return soup, name, re.sub(r"\s+", " ", soup.get_text(" "))


def between(text: str, start: str, stops: str) -> str | None:
    """Text after the label `start` up to the next label in `stops`."""
    m = re.search(rf"{start}\s*(.+?)(?=\s+(?:{stops})\b|$)", text)
    return m.group(1).strip(" :;-") if m else None


def abv_of(text: str) -> float | None:
    m = re.search(r"([\d.]+)\s*%\s*ABV", text) or re.search(r"ABV:?\s*([\d.]+)\s*%?", text)
    try:
        return float(m.group(1)) if m else None
    except ValueError:
        return None


# Variety names that are also ordinary words ("crystal malt", "the summit",
# "a triumph"). In prose they only count next to hop context: the word hop,
# or another variety named nearby.
AMBIGUOUS = {
    "comet", "crystal", "summit", "cluster", "galena", "glacier", "target", "challenger", "sterling", "liberty",
    "nugget", "magnum", "warrior", "triumph", "vista", "eclipse", "enigma", "delta", "horizon", "pilgrim",
    "progress", "phoenix", "admiral", "sovereign", "ultra", "vanguard", "eureka", "apollo", "bravo", "luna",
    "relax", "harmonie", "contessa", "zeus", "ella", "tango", "sultana", "titan", "topaz", "ariana", "aurora",
    "belma", "vera", "thora", "vital", "monroe", "chelan", "millennium", "newport", "lotus", "opal", "polaris",
    "mistral", "trident", "flint", "calypso", "atlas", "aramis", "endeavour", "godiva", "boadicea", "super galena",
    "pacifica", "southern cross", "green bullet", "first gold", "golding", "fuggle", "mackinac", "tahoma",
    "denali", "alora", "altus", "lemondrop", "teamaker", "santiam", "willamette", "saphir", "smaragd", "premiant",
}


def names_in(text: str, index: dict[str, str], field: bool = False) -> list[dict]:
    """For prose hop notes ("Simcoe and Centennial in the kettle, Cryo Simcoe
    in the dry hop, fresh hop Centennial from ..."): find every known variety
    name in the text, longest names first, and note Cryo / fresh next to it.
    Matching ignores case (breweries shout: "only brewed with... MOSAIC"),
    except for names that are also ordinary words, which need context."""
    candidates = sorted(NAME_FORMS, key=len, reverse=True)
    taken: list[tuple[int, int]] = []
    found: list[tuple[int, dict, bool]] = []
    for label in candidates:
        ambiguous = label.lower() in AMBIGUOUS
        flags = 0 if ambiguous else re.I
        for m in re.finditer(rf"(?<![A-Za-z]){re.escape(label)}(?![A-Za-z])", text, flags):
            a, b = m.span()
            if any(a < y and b > x for x, y in taken):
                continue
            if ambiguous and re.match(r"\s+malts?\b", text[b:b + 8], re.I):
                continue  # "Crystal malt"
            taken.append((a, b))
            before, after = text[max(0, a - 18):a].lower(), text[b:b + 12].lower()
            name = label  # the record's own spelling, not the brewery's capitals
            item = {"hop": NAME_FORMS[label], "name": name, "as_written": m.group(0)}
            if "cryo" in before.split()[-1:] or after.strip().startswith("cryo"):
                item["form"] = "Cryo"
            if re.search(r"(?:fresh|wet)(?:[- ]hop(?:ped)?)?\s*$", before):
                item["fresh"] = True
            if fm := re.match(r"\s*(?:hops?\s+)?from\s+([A-Z][\w'&.\s]{1,40}?(?:Farms?|Ranch|Agriculture|Hops))", text[b:b + 70]):
                item["farm"] = fm.group(1).strip()
            found.append((a, item, ambiguous))
    confident = [a for a, _, amb in found if not amb]
    out, seen = [], set()
    for a, item, amb in sorted(found, key=lambda x: x[0]):
        if amb and not field:
            near_hop = re.search(r"\bhop", text[max(0, a - 30):a + 40], re.I)
            near_variety = any(abs(a - c) < 60 for c in confident)
            if not (near_hop or near_variety):
                continue
        key = (item["hop"], item.get("form"), item.get("fresh"))
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


NAME_FORMS: dict[str, str] = {}


def load_name_forms() -> None:
    """Display names and aliases as they'd be written in prose -> slug."""
    safe = YAML(typ="safe")
    for path in sorted((ROOT / "data" / "hops").glob("*.yml")):
        rec = safe.load(path.read_text(encoding="utf-8"))
        for alt in [rec["name"], *(rec.get("aliases") or [])]:
            alt = str(alt)
            if len(alt) >= 4 and not alt.isdigit():
                NAME_FORMS.setdefault(alt, rec["slug"])
    for alias, slug in {"Nelson": "nelson-sauvin", "Mt. Hood": "mount-hood", "Mt Hood": "mount-hood",
                        "HBC 586": "krush", "HBC 1019": "dolcita", "HBC 682": "hbc-682", "Tettnang": "tettnang",
                        "El Dorado": "el-dorado", "Idaho 7": "idaho-7", "Brewer's Gold": "brewers-gold",
                        "Mittelfruh": "hallertau-mittelfrueh", "Hallertau": "hallertau-mittelfrueh",
                        "Mandarina": "mandarina-bavaria", "Huell Melon": "huell-melon", "Hull Melon": "huell-melon"}.items():
        NAME_FORMS.setdefault(alias, slug)


# One parser per brewery: saved page -> (name, abv, hops text, mode).
# mode "list" = the brewery writes a list ("A, B, C Cryo"); "prose" = the
# brewery writes sentences and names are found in them.


def parse_fort_george(path: Path) -> tuple | None:
    _, name, text = page_text(path)
    notes = text[text.find("Brewer's Notes"):] if "Brewer's Notes" in text else ""
    hops = None
    if m := re.search(r"\bHops?:\s*(.+?)(?=\s+[A-Z][a-z]+:|$)", notes):
        hops = m.group(1).strip()
    elif m := re.search(r"dry[- ]hopped with ([A-Z][\w\s-]+?) hops", text):
        hops = m.group(1).strip()
    return name, abv_of(text), hops, "list"


def parse_double_mountain(path: Path) -> tuple | None:
    _, name, text = page_text(path)
    # Some pages title the beer as an invitation: "Grab Yourself A Killer Green".
    name = re.sub(r"^grab yourself an?\s+", "", name, flags=re.I) if name else name
    hops = between(text, r"\bHops", r"Malts?|Yeast|Appearance|Aroma|Mouthfeel|Flavor|Food")
    m = re.search(r"\bABV\s*([\d.]+)", text)
    return name, float(m.group(1)) if m else None, hops, "field"


def parse_ex_novo(path: Path) -> tuple | None:
    _, name, text = page_text(path)
    m = re.search(r"(?:IBU \d+|Availability [\w-]+) Hops (.+?)(?= Yeasts?\b| Malts?\b| Back to all beers|$)", text)
    hops = m.group(1).strip() if m else None
    return name, abv_of(text), hops.replace(" / ", ", ") if hops else None, "list"


def parse_pfriem(path: Path) -> tuple | None:
    _, name, text = page_text(path)
    m = re.search(r"INGREDIENTS\b.{0,300}?\bHops (.{1,160}?)(?= Yeast| Adjuncts| Barrels| Special Ingredients| TASTING NOTES| Fruit| HISTORY|$)", text)
    hops = m.group(1).strip() if m else None
    return name, abv_of(text), hops, "list"


def parse_breakside(path: Path) -> tuple | None:
    soup, name, text = page_text(path)
    title = soup.title.string if soup.title else ""
    name = (title or "").split(" - Breakside")[0].strip() or name
    m = re.search(r"\bABV [\d.]+ Hops (.{1,200}?)(?= MALT\b| Packaging\b| UPC\b| Yeast\b|$)", text)
    abv = re.search(r"\bABV ([\d.]+)", text)
    return name, float(abv.group(1)) if abv else None, m.group(1).strip() if m else None, "list"


def parse_prose_generic(path: Path) -> tuple | None:
    """Breweries that describe hops in a sentence: take the sentences that
    talk about hops and find the variety names in them."""
    _, name, text = page_text(path)
    bits = re.findall(r"[^.]*\b(?:hops?|hopped|dry[- ]hop\w*)\b[^.]*\.", text, re.I)
    return name, abv_of(text), " ".join(bits) or None, "prose"


def parse_7seas(path: Path) -> tuple | None:
    """7 Seas announces beers as news posts ("Our 2026 Yakima Valley Fresh Hop
    IPA is here"); the hops are in the post's sentences."""
    soup, name, _ = page_text(path)
    body = soup.find("article") or soup.find(class_=re.compile("entry-content|post-content")) or soup
    text = re.sub(r"\s+", " ", body.get_text(" "))
    if name:
        name = re.sub(r"^Our (\d{4}) (.+?) is here$", r"\2 (\1)", name)
        name = re.sub(r" is (?:here|back)$", "", name, flags=re.I)
    bits = re.findall(r"[^.]*\b(?:hops?|hopped)\b[^.]*\.", text, re.I)
    bits = [b.strip() for b in bits if not re.search(r"Menu|Events & News", b)]
    return name, abv_of(text), " ".join(bits) or None, "prose"


def parse_elysian(path: Path) -> tuple | None:
    soup, name, text = page_text(path)
    m = re.search(r"\bHops ([A-Z].{1,160}?)(?= FIND\b| Yeast\b| ABV\b| IBU\b| Malts?\b|$)", text)
    title = soup.title.string.split("|")[0].strip() if soup.title and soup.title.string else name
    return title, abv_of(text), m.group(1).strip() if m else None, "field"


def parse_fair_isle(path: Path) -> tuple | None:
    # Fair Isle sets the value before its label: "... Saison Style Mandarina Bavaria Hops Copeland Pilsner Malt Grain"
    soup, name, text = page_text(path)
    m = re.search(r"\bStyle (.{1,160}?) Hops\b", text)
    return name, abv_of(text), m.group(1).strip() if m else None, "list"


def parse_aslan(path: Path) -> tuple | None:
    soup, name, text = page_text(path)
    m = re.search(r"\bHOPS?:\s*(.{1,200}?)(?=\s+[A-Z]{3,}\s*:|\s+Aslan Brewing|$)", text)
    title = soup.title.string.split("\u2014")[0].strip() if soup.title and soup.title.string else name
    return title, abv_of(text), m.group(1).strip() if m else None, "list"


def parse_description(path: Path) -> tuple | None:
    """Breweries that write a paragraph: the whole description is scanned for
    variety names (see names_in for how ordinary words are kept out)."""
    soup, name, text = page_text(path)
    body = soup.find("main") or soup.find("article") or soup
    desc = re.sub(r"\s+", " ", body.get_text(" "))
    desc = re.split(r"View all beers|Back to all beers|Beer Finder", desc)[0]
    title = soup.title.string.split("|")[0].strip() if soup.title and soup.title.string else name
    return title, abv_of(text), desc[-1500:] or None, "prose"


def parse_reubens(path: Path) -> tuple | None:
    soup, name, text = page_text(path)
    title = soup.title.string.split(" - Reubens")[0].strip() if soup.title and soup.title.string else name
    m = re.search(r"\bHops ([A-Z].{1,200}?)(?= Subscribe\b| Yeast\b| Malts?\b| Adjuncts?\b|$)", text)
    return title, abv_of(text), m.group(1).strip() if m else None, "list"


def parse_fremont_taplist(path: Path) -> list[tuple]:
    """Fremont's taplist is one page; only its fresh-hop beers name hops
    ("Field to Ferment: Pale Ale Made With Centennial Fresh Hops")."""
    _, _, text = page_text(path)
    out = []
    for m in re.finditer(r"([A-Z][\w'’ .&-]{2,40}?): ([\w -]{2,40}?) Made With ([A-Z][\w ,&]+?) (Fresh )?Hops", text):
        hops = ", ".join(("Fresh " if m.group(4) else "") + h.strip() for h in re.split(r",|&| and ", m.group(3)) if h.strip())
        out.append((m.group(1).strip(), None, hops, "list"))
    return out


PARSERS = {
    "fort-george": (parse_fort_george, "fortgeorgebrewery.com", "beer_*.html"),
    "double-mountain": (parse_double_mountain, "doublemountainbrewery.com", "beer_*.html"),
    "ex-novo": (parse_ex_novo, "exnovobrew.com", "beer_*.html"),
    "pfriem": (parse_pfriem, "pfriembeer.com", "beer_*.html"),
    "breakside": (parse_breakside, "breakside.com", "our_beer_*.html"),
    "ecliptic": (parse_prose_generic, "eclipticbrewing.com", "beer_*.html"),
    "7-seas": (parse_7seas, "7seasbrewing.com", "*.html"),
    "elysian": (parse_elysian, "elysianbrewing.com", "beer_*.html"),
    "fair-isle": (parse_fair_isle, "fairislebrewing.com", "beer_*.html"),
    "aslan": (parse_aslan, "aslanbrewing.com", "beers_*.html"),
    "holy-mountain": (parse_description, "holymountainbrewing.com", "beer_*.html"),
    "cloudburst": (parse_description, "cloudburstbrew.com", "beer_*.html"),
    "reubens": (parse_reubens, "reubensbrews.com", "beer_*.html"),
    "fremont": (parse_fremont_taplist, "fremontbrewing.com", "taplist.html"),
}


def build_beer(brewery: dict, path: Path, parsed: tuple, index: dict[str, str]) -> CommentedMap | None:
    name, abv, hops_line, mode = parsed
    if name and (not hops_line or hops_line.lower() in ("none", "n/a", "-")):
        # "Fresh Hop Simcoe IPA": the name is the hop list.
        if m := re.search(r"Fresh Hop ([A-Z][\w'. ]+?)(?= IPA| Pale| Pilsner| Lager| Ale| Red| Wanderlust|$)", name):
            if index.get(norm(m.group(1))):
                hops_line, mode = f"Fresh {m.group(1)}", "list"
    if not name or not hops_line or hops_line.lower() in ("none", "n/a", "-"):
        return None
    if name.lower() in ("beer releases", "beers", "our beers", "all beers", "events & news"):
        return None  # a listing page, not a beer
    items: list[dict] = []
    if mode == "list":
        farm = None
        for token in split_hops(hops_line):
            if norm(token) in FARMS:
                farm = FARMS[norm(token)]
                continue
            item = parse_hop(token, index)
            if farm:
                item.setdefault("farm", farm)
                farm = None
            items.append(item)
    else:
        items = names_in(hops_line, index, field=(mode == "field"))
        if m := re.search(r"from ([A-Z][\w'&.\s]{2,40}?(?:Farms?|Ranch|Hops|Agriculture))", hops_line):
            for item in items:
                if item.get("fresh"):
                    item.setdefault("farm", m.group(1).strip())
    items = [i for i in items if i.get("name")]
    # "Green Is My Favorite Color Wet Hop IPA" with one hop named: that hop is the fresh one.
    if re.search(r"\b(?:fresh|wet)[- ]hop", name, re.I) and len({i.get("hop") for i in items}) == 1:
        for i in items:
            i["fresh"] = True
    if not items:
        return None
    slug = re.sub(r"^(beer|our_beer|product)_", "", path.stem)
    slug = re.sub(r"_[A-Z0-9]{16,}$", "", slug).replace("_", "-").lower()
    slug = re.sub(r"-2$", "", slug)  # WordPress's "-2" on a reused title
    beer = CommentedMap()
    beer["slug"] = slug
    name = re.sub(r"\s+", " ", name).strip()
    if name.isupper():
        name = re.sub(r"\b(Ipa|Esb|Ipl|Dipa|Neipa|Wc|Xpa|Ddh)\b", lambda m: m.group(1).upper(), name.title())
    beer["name"] = name
    beer["url"] = source_url(path)
    if abv:
        beer["abv"] = abv
    beer["hops_as_written"] = hops_line if len(hops_line) <= 400 else hops_line[:397] + "..."
    hops = CommentedSeq()
    for item in items:
        node = CommentedMap((k, item[k]) for k in ("hop", "name", "form", "product", "fresh", "farm", "as_written") if k in item)
        node.fa.set_flow_style()
        hops.append(node)
    beer["hops"] = hops
    return beer


def source_url(path: Path) -> str:
    """Rebuild the page URL from the saved file's name (see snapshot.target)."""
    host = path.parent.name
    host = host if host.count(".") > 1 or host in ("breakside.com", "exnovobrew.com", "doublemountainbrewery.com",
                                                    "eclipticbrewing.com", "fortgeorgebrewery.com") else "www." + host
    return f"https://{host}/" + path.stem.replace("_", "/") + "/"


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
    load_name_forms()
    breweries = YAML(typ="safe").load((HERE / "breweries.yml").read_text(encoding="utf-8"))
    for brewery in breweries:
        if brewery["slug"] not in PARSERS:
            continue
        parse, folder, pattern = PARSERS[brewery["slug"]]
        pages = sorted((RAW / folder).glob(pattern))
        beers, seen = [], set()
        for path in pages:
            parsed = parse(path)
            # A taplist page holds many beers; everything else holds one.
            for one in parsed if isinstance(parsed, list) else [parsed]:
                beer = build_beer(brewery, path, one, index)
                if beer is None:
                    continue
                if isinstance(parsed, list):
                    beer["slug"] = re.sub(r"[^a-z0-9]+", "-", beer["name"].lower()).strip("-")
                    beer["url"] = brewery["url"]
                if beer["slug"] not in seen:
                    seen.add(beer["slug"])
                    beers.append(beer)
        if not beers:
            print(f"{brewery['slug']}: no beers with hop lists in {len(pages)} saved page(s)")
            continue
        meta = {k: brewery[k] for k in ("slug", "name", "city", "state", "url")}
        write(meta, beers)
        unlinked = sorted({h["name"] for b in beers for h in b["hops"] if not h["hop"]})
        print(f"wrote data/beers/{brewery['slug']}.yml: {len(beers)} of {len(pages)} pages list their hops")
        if unlinked:
            print(f"  unlinked: {', '.join(unlinked)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
