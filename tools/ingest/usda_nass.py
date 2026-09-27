#!/usr/bin/env python3
"""
USDA NASS National Hop Report: acreage by variety and state.

    pixi run -e data python tools/ingest/usda_nass.py --fetch    # download the reports
    pixi run -e data python tools/ingest/usda_nass.py            # parse -> data/acreage/

The fetch step saves each December report's plain-text release under
tools/ingest/raw/usda-nass/ so the numbers are on record in the repo and the
parse step runs offline.
"""
from __future__ import annotations

import argparse
import io
import re
import sys
import time
from pathlib import Path

import requests
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

RAW = Path(__file__).parent / "raw" / "usda-nass"
UA = "HopLore/0.1 (open hop dataset; +https://github.com/bdgroves/hoplore)"
ESMIS = "https://esmis.nal.usda.gov/sites/default/release-files/"

# Crop year -> plain-text release, from esmis.nal.usda.gov/publication/national-hop-report.
REPORTS = {
    2025: "795697/hopsan25_0.txt",
    2024: "s7526c41m/cj82n3552/3r076q47v/hopsan24.txt",
    2023: "s7526c41m/4b29ct10c/n5840f59r/hopsan23.txt",
    2022: "s7526c41m/5t34tw227/p2678654b/hopsan22.txt",
    2021: "s7526c41m/08613p220/dj52x637v/hopsan21.txt",
    2020: "s7526c41m/7m01cc012/z890sk89b/hopsan20.txt",
    2019: "s7526c41m/37720v08z/td96kj08v/hopsan19.txt",
    2018: "s7526c41m/2801pm326/c821gq12t/hopsan18.txt",
    2017: "s7526c41m/8910jx41k/j098zd724/hops-12-19-2017.txt",
}
EXTRA: dict[str, str] = {}


def fetch_all(delay: float) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for key, path in [*((str(y), p) for y, p in REPORTS.items()), *EXTRA.items()]:
        response = requests.get(ESMIS + path, headers={"User-Agent": UA}, timeout=60)
        response.raise_for_status()
        out = RAW / f"hopsan-{key}.txt"
        out.write_text(response.text, encoding="utf-8")
        print(f"wrote {out.name}: {len(response.text)} chars")
        time.sleep(delay)


# ---------------------------------------------------------------------- parsing

STATES = {"Idaho": "ID", "Oregon": "OR", "Washington": "WA", "United States": "US"}
MEASURES = {"area harvested": "acres", "yield per acre": "yield_lb_per_acre", "production": "production_klb"}
SEP = re.compile(r"^-{20,}\s*$")
MISSING = {"(D)": "withheld", "-": 0, "(NA)": None, "(X)": None, "(Z)": None}
TYPOS = {"Mosiac": "Mosaic", "Chinhook": "Chinook", "Williamette": "Willamette", "Elami": "Elani"}


def number(token: str):
    if token in MISSING:
        return MISSING[token]
    value = float(token.replace(",", ""))
    return int(value) if value.is_integer() and "." not in token else value


def canonical(label: str) -> str:
    """'Citra R, HBC 394 .......' -> 'Citra'; 'YCR-4 (Palisade R)' -> 'Palisade'."""
    text = re.sub(r"\s*\.{1,}\s*$", "", re.sub(r"\s*\.{2,}.*$", "", label)).strip()
    text = re.sub(r"\s+\d/\s*$", "", text)                      # footnote marker
    text = re.sub(r"(?<=[a-z])TM\b", "", text)                    # "AzaccaTM"
    text = re.sub(r"^(?:ADHA|YCR|HBC)-?\s*\d+\s+(?=[A-Z][a-z])", "", text)  # "ADHA-483 Azacca"
    if m := re.match(r"YCR-?\s*\d+\s*\((.*)\)", text):
        text = m.group(1)
    if re.fullmatch(r"C/T/Z\s*(R|TM)?", text):
        return "Columbus/Tomahawk"  # 2018-19 reports: "C/T/Z" beside a separate Zeus row
    if re.fullmatch(r"Columbus/Tomahawk\s*(R|TM)?\s*/\s*Zeus(\s*\(CTZ\))?(\s*(R|TM))?(\s+\d/)?", text):
        return "CTZ"
    if re.fullmatch(r"HBC\s*\d+", text):
        return re.sub(r"\s+", " ", text)
    text = re.split(r"\s*,|\s+(?=(?:HBC|YCR|YQH|ADHA|HS|OR|VGXP)(?:[\s-]?\d|$))", text)[0]
    text = re.sub(r"\b(R|TM)\b", "", text).replace("!", "")
    text = re.sub(r"\s+", " ", text).strip(" ,")
    return TYPOS.get(text, text)


def parse_report(path: Path) -> dict:
    """{(measure, state, name, year): value} plus state summary rows."""
    lines = path.read_text(encoding="utf-8").splitlines()
    cells: dict[tuple, object] = {}
    i = 0
    while i < len(lines):
        title = lines[i]
        if not title.startswith("Hop Area Harvested, Yield"):
            i += 1
            continue
        by_variety = "by Variety" in title
        # header: between the first two separators
        start = next(j for j in range(i, len(lines)) if SEP.match(lines[j]))
        end = next(j for j in range(start + 1, len(lines)) if SEP.match(lines[j]))
        header = lines[start + 1:end]
        year_line = next((h for h in header if re.search(r"\b20\d\d\b", h)), "")
        years = [int(y) for y in re.findall(r"\b(?:19|20)\d\d\b", year_line)]
        state_line = next(h for h in header if "State" in h)
        measures = [MEASURES.get(m.strip().lower()) for m in state_line.split(":")[1:] if m.strip()]
        body_end = next((j for j in range(end + 1, len(lines)) if SEP.match(lines[j])), len(lines))
        state = None
        for row in lines[end + 1:body_end]:
            if ":" not in row:
                continue
            label, values = row.split(":", 1)
            label = label.strip()
            tokens = values.split()
            if not label:
                continue
            if label in STATES and not tokens:
                state = STATES[label]
                continue
            if by_variety:
                if not measures or None in measures or not years:
                    continue
                name = canonical(label)
                if name.startswith("United States"):
                    row_state, name = "US", "Total"
                else:
                    row_state = state
                if len(years) == len(measures) * len(set(years)):   # "2015 : 2016 : 2017 : 2015 : ..."
                    per = len(set(years))
                    cols = [(measures[k // per], y) for k, y in enumerate(years)]
                else:
                    cols = [(m, y) for m in measures for y in years]
                if len(tokens) != len(cols):
                    cols = None
                if cols is None or row_state is None:
                    continue
                for (measure, year), token in zip(cols, tokens):
                    value = number(token)
                    if value is None:
                        continue  # (NA)/(X): not reported, so not recorded
                    # "Beginning in 2020, Zeus is included in Columbus/Tomahawk/Zeus"
                    # -- the same row's earlier years are Columbus/Tomahawk alone.
                    row_name = "Columbus/Tomahawk" if name == "CTZ" and year < 2020 else name
                    if name == "Zeus" and year >= 2020:
                        continue  # folded into CTZ from 2020; the leftover cell is noise
                    cells[(measure, row_state, row_name, year)] = value
            else:
                # state summary: "2025 ....: acres yield production price value"
                if m := re.match(r"((?:19|20)\d\d)", label):
                    if state and len(tokens) == 5:
                        year = int(m.group(1))
                        for key, token in zip(("acres", "yield_lb_per_acre", "production_klb", "price_per_lb", "value_kusd"), tokens):
                            cells[("state:" + key, state, "Total", year)] = number(token)
        i = body_end + 1
    return cells


def parse_all() -> dict:
    """Newest report wins for any year it covers: NASS revises the prior two."""
    merged: dict[tuple, object] = {}
    sources: dict[int, int] = {}
    for report_year in sorted(REPORTS):
        path = RAW / f"hopsan-{report_year}.txt"
        for key, value in parse_report(path).items():
            merged[key] = value
            sources[key[3]] = report_year
    return {"cells": merged, "from_report": sources}


# ---------------------------------------------------------------------- writing

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "acreage" / "usda-nass.yml"
MAP_FILE = Path(__file__).parent / "usda_nass_map.yml"
STATE_ORDER = ["WA", "OR", "ID"]
TRAILING = {"Experimental", "Other varieties"}


def norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


def record_names() -> dict[str, tuple[str, str]]:
    """normalized name/alias -> (slug, display name)"""
    safe = YAML(typ="safe")
    out: dict[str, tuple[str, str]] = {}
    for path in sorted((ROOT / "data" / "hops").glob("*.yml")):
        rec = safe.load(path.read_text(encoding="utf-8"))
        for alt in [rec["name"], rec["slug"], *(rec.get("aliases") or []), *(rec.get("previously_named") or [])]:
            out.setdefault(norm(alt), (rec["slug"], rec["name"]))
    return out


def resolve(name: str, overrides: dict, names: dict) -> tuple[tuple[str, ...], str]:
    """(slugs, display name). No slugs means the row stays unlinked."""
    if name in overrides:
        slugs = tuple(overrides[name] or ())
        if name == "CTZ":
            return slugs, "Columbus/Tomahawk/Zeus (CTZ)"
        if len(slugs) == 1 and norm(slugs[0]) in names and "/" not in name:
            return slugs, names[norm(slugs[0])][1]
        return slugs, name
    if hit := names.get(norm(name)):
        return (hit[0],), hit[1]
    return (), name


def flow(mapping: dict) -> CommentedMap:
    node = CommentedMap(mapping)
    node.fa.set_flow_style()
    return node


def flow_list(items) -> CommentedSeq:
    node = CommentedSeq(items)
    node.fa.set_flow_style()
    return node


def build_dataset(parsed: dict) -> CommentedMap:
    cells, from_report = parsed["cells"], parsed["from_report"]
    overrides = YAML(typ="safe").load(MAP_FILE.read_text(encoding="utf-8")) if MAP_FILE.exists() else {}
    names = record_names()
    years = sorted({k[3] for k in cells})

    states = CommentedMap()
    for st in [*STATE_ORDER, "US"]:
        block = CommentedMap()
        for key in ("acres", "yield_lb_per_acre", "production_klb", "price_per_lb", "value_kusd"):
            series = {y: cells[("state:" + key, st, "Total", y)] for y in years if ("state:" + key, st, "Total", y) in cells}
            if series:
                block[key] = flow(series)
        states[st] = block

    grouped: dict = {}
    for (measure, st, name, year), value in cells.items():
        if measure.startswith("state:") or name == "Total" or measure == "yield_lb_per_acre":
            continue
        slugs, display = resolve(name, overrides or {}, names)
        key = slugs or (name,)
        entry = grouped.setdefault(key, {"name": display, "slugs": list(slugs), "reported_as": set(), "data": {}})
        entry["reported_as"].add(name)
        slot = entry["data"].setdefault(measure, {}).setdefault(st, {})
        if year in slot and slot[year] != value:
            raise SystemExit(f"two NASS rows land on {key} {measure} {st} {year}: {slot[year]} vs {value}")
        slot[year] = value

    varieties = CommentedSeq()
    for key in sorted(grouped, key=lambda k: (grouped[k]["name"] in TRAILING, grouped[k]["name"].lower())):
        e = grouped[key]
        item = CommentedMap()
        item["name"] = e["name"]
        item["slugs"] = flow_list(e["slugs"])
        if e["reported_as"] - {e["name"]}:
            item["reported_as"] = flow_list(sorted(e["reported_as"]))
        for measure in ("acres", "production_klb"):
            per_state = CommentedMap()
            for st in STATE_ORDER:
                if st in e["data"].get(measure, {}):
                    per_state[st] = flow(dict(sorted(e["data"][measure][st].items())))
            item[measure] = per_state
        varieties.append(item)

    doc = CommentedMap()
    doc["source"] = "usda-nass"
    doc["generated_by"] = "tools/ingest/usda_nass.py -- do not edit by hand; fix usda_nass_map.yml and re-run"
    doc["years"] = flow_list(years)
    doc["from_report"] = flow({y: from_report[y] for y in years})
    doc["units"] = flow({"acres": "acres harvested", "production_klb": "1,000 pounds",
                         "yield_lb_per_acre": "pounds per acre", "price_per_lb": "US dollars",
                         "value_kusd": "1,000 US dollars"})
    doc["missing"] = "withheld means NASS withheld it to avoid disclosing a single operation; 0 means none; a missing year was not reported"
    doc["states"] = states
    doc["varieties"] = varieties
    return doc


def write_dataset(parsed: dict) -> None:
    doc = build_dataset(parsed)
    out = YAML()
    out.width = 4096
    out.indent(mapping=2, sequence=4, offset=2)
    buffer = io.StringIO()
    out.dump(doc, buffer)
    text = re.sub(r"\{(?=\S)", "{ ", buffer.getvalue())
    text = re.sub(r"(?<=\S)\}", " }", text)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("# USDA NASS National Hop Report, acreage and production by variety and state.\n" + text, encoding="utf-8")
    unlinked = sorted(v["name"] for v in doc["varieties"] if not v["slugs"])
    print(f"wrote {OUT.relative_to(ROOT)}: {len(doc['varieties'])} varieties, {doc['years'][0]}-{doc['years'][-1]}")
    print(f"  unlinked (no HopLore record): {', '.join(unlinked)}")


def main() -> int:

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()
    if args.fetch:
        fetch_all(args.delay)
        return 0
    write_dataset(parse_all())
    return 0


if __name__ == "__main__":
    sys.exit(main())
