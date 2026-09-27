#!/usr/bin/env python3
"""
Save raw copies of source pages into the repo, so a parser can be written and
tested against what the source actually serves, and so every hand-keyed
figure can be checked against the page it came from.

    pixi run -e data python tools/ingest/snapshot.py

Reads URLs from tools/ingest/snapshot_urls.txt (one per line, # comments),
writes tools/ingest/raw/pages/<host>/<path>.html (or .pdf / .xml). Run on a
GitHub runner via the "Snapshot a source catalog" workflow -> snapshot, for
sites a sandbox can't reach. Read-only toward the sources; polite delay.
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

HERE = Path(__file__).parent
URLS = HERE / "snapshot_urls.txt"
OUT = HERE / "raw" / "pages"
UA = "HopLore/0.1 (open hop dataset; +https://github.com/bdgroves/hoplore)"


def target(url: str, content_type: str) -> Path:
    parts = urlparse(url)
    path = parts.path.strip("/") or "index"
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", path)
    ext = ".pdf" if "pdf" in content_type else ".xml" if "xml" in content_type else ".html"
    if not stem.endswith(ext):
        stem = re.sub(r"\.(html?|pdf|xml)$", "", stem) + ext
    return OUT / parts.netloc.removeprefix("www.") / stem


def main() -> int:
    urls = [l.split("#")[0].strip() for l in URLS.read_text(encoding="utf-8").splitlines()]
    urls = [u for u in urls if u.startswith("https://")]
    failed = 0
    for url in urls:
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
            r.raise_for_status()
        except requests.RequestException as error:
            print(f"FAIL {url}: {error}")
            failed += 1
            continue
        out = target(url, r.headers.get("content-type", ""))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(r.content)
        print(f"ok   {url} -> {out.relative_to(HERE)} ({len(r.content)} bytes)")
        time.sleep(1.5)
    print(f"\n{len(urls) - failed}/{len(urls)} saved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
