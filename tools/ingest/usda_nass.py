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
import sys
import time
from pathlib import Path

import requests

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
EXTRA = {"2025-first-release": "795696/hopsan25.txt"}


def fetch_all(delay: float) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    for key, path in [*((str(y), p) for y, p in REPORTS.items()), *EXTRA.items()]:
        response = requests.get(ESMIS + path, headers={"User-Agent": UA}, timeout=60)
        response.raise_for_status()
        out = RAW / f"hopsan-{key}.txt"
        out.write_text(response.text, encoding="utf-8")
        print(f"wrote {out.name}: {len(response.text)} chars")
        time.sleep(delay)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()
    if args.fetch:
        fetch_all(args.delay)
        return 0
    print("parse step not written yet")
    return 1


if __name__ == "__main__":
    sys.exit(main())
