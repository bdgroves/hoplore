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
# Still says who we are; the "Mozilla/5.0 (compatible; ...)" form is the
# convention crawlers use, and some sites refuse bare tool user-agents.
UA = "Mozilla/5.0 (compatible; HopLove/0.1; +https://github.com/bdgroves/hoplore)"


def target(url: str, content_type: str) -> Path:
    parts = urlparse(url)
    path = parts.path.strip("/") or "index"
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", path)
    ext = ".pdf" if "pdf" in content_type else ".xml" if "xml" in content_type else ".html"
    if not stem.endswith(ext):
        stem = re.sub(r"\.(html?|pdf|xml)$", "", stem) + ext
    return OUT / parts.netloc.removeprefix("www.") / stem


def brewery_urls(brewery: dict) -> list[str]:
    """Beer page URLs for one brewery, from its sitemaps and listing pages."""
    pattern = re.compile(brewery["match"])
    found: list[str] = []

    def take(url: str) -> None:
        url = url.strip()
        if url.startswith("/") and brewery.get("base"):
            url = brewery["base"] + url
        url = url.replace("http://", "https://", 1)
        # Shopify links a product under each collection too; one URL per beer.
        url = re.sub(r"/collections/[^/]+(?=/products/)", "", url)
        if pattern.match(url) and url not in found:
            found.append(url)

    for sm in brewery.get("sitemaps", []):
        try:
            xml = requests.get(sm, headers={"User-Agent": UA}, timeout=60).text
        except requests.RequestException:
            continue
        for loc in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml):
            take(loc)
    if brewery.get("render_listing"):
        # The listing itself is drawn by JavaScript: render.mjs renders it,
        # saves it, and follows the links that match.
        return []
    for page in brewery.get("listing", []):
        try:
            r = requests.get(page, headers={"User-Agent": UA}, timeout=60)
            html = r.text
        except requests.RequestException:
            continue
        if brewery.get("keep_listing") and r.ok:
            # Some breweries describe every beer on the listing page itself.
            out = target(page, "text/html")
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(r.content)
        for href in re.findall(r'href="([^"#?]+)"', html):
            take(href)
    return found[: brewery.get("limit", 1000)]


def crawl_breweries() -> int:
    """Save every listed brewery's beer pages. Pages already saved are kept
    (a beer's hop list doesn't change once it's brewed), so re-runs only
    fetch what's new. JavaScript-drawn sites are queued for render.mjs."""
    from ruamel.yaml import YAML  # noqa: PLC0415

    breweries = YAML(typ="safe").load((HERE / "breweries.yml").read_text(encoding="utf-8"))
    render: list[str] = []
    listings: list[str] = []
    log: list[str] = []
    for brewery in breweries:
        if brewery.get("render_listing"):
            listings.extend(f"{brewery['match']}\t{page}" for page in brewery.get("listing", []))
        urls = brewery_urls(brewery)
        log.append(f"{brewery['slug']}: {len(urls)} beer page(s)")
        if brewery.get("render"):
            render.extend(urls)
            continue
        for url in urls:
            out = target(url, "text/html")
            if out.exists():
                continue
            fetch = url
            if brewery.get("fetch"):
                # The page is a shell; its content comes from an endpoint.
                fetch = brewery["fetch"].format(id=re.search(brewery["fetch_id"], url).group(1))
            try:
                r = requests.get(fetch, headers={"User-Agent": UA}, timeout=60)
                r.raise_for_status()
            except requests.RequestException as error:
                log.append(f"  FAIL {url}: {error}")
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(r.content)
            time.sleep(1.0)
    (OUT / "render_urls.txt").write_text("\n".join(render) + "\n", encoding="utf-8")
    (OUT / "render_listings.txt").write_text("\n".join(listings) + "\n", encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "breweries-run.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
    print("\n".join(log))
    return 0


def main() -> int:
    if "--breweries" in sys.argv:
        return crawl_breweries()
    urls = [l.split("#")[0].strip() for l in URLS.read_text(encoding="utf-8").splitlines()]
    urls = [u for u in urls if u.startswith("https://")]
    failed = 0
    log: list[str] = []
    for url in urls:
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
            r.raise_for_status()
        except requests.RequestException as error:
            print(f"FAIL {url}: {error}")
            log.append(f"FAIL {url}: {error}")
            failed += 1
            continue
        out = target(url, r.headers.get("content-type", ""))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(r.content)
        print(f"ok   {url} -> {out.relative_to(HERE)} ({len(r.content)} bytes)")
        log.append(f"ok   {url} ({r.status_code}, {len(r.content)} bytes)")
        time.sleep(1.5)
    print(f"\n{len(urls) - failed}/{len(urls)} saved")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "last-run.txt").write_text("\n".join(log) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
