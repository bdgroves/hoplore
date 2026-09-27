#!/usr/bin/env python3
"""
Aroma tags from the descriptors BarthHaas shows on each variety page
(captured in catalogs/barthhaas.json by `barthhaas.py --catalog`).

    pixi run -e data python tools/ingest/barthhaas_aromas.py           # dry run
    pixi run -e data python tools/ingest/barthhaas_aromas.py --apply

Fills aroma.tags only on records that have none -- it never overwrites tags
someone wrote or another source supplied. Descriptors are translated through
barthhaas_aroma_map.yml; the original words are kept in a note so nothing is
lost in translation.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from barthhaas import CATALOG_FILE, load_map, load_record, save_record, yaml  # noqa: E402
from ruamel.yaml.comments import CommentedMap, CommentedSeq  # noqa: E402

HERE = Path(__file__).parent
MAP = HERE / "barthhaas_aroma_map.yml"
TAXONOMY = HERE.parents[1] / "data" / "taxonomy" / "aroma-tags.yml"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    mapping = yaml.load(MAP.read_text(encoding="utf-8"))
    known = set(yaml.load(TAXONOMY.read_text(encoding="utf-8")))
    for tag in [*mapping["descriptors"].values(), *mapping["families"].values()]:
        if tag not in known:
            raise SystemExit(f"barthhaas_aroma_map.yml uses '{tag}', which is not in aroma-tags.yml")

    details = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))["details"]
    filled = 0
    for slug, theirs in load_map().items():
        if not theirs or theirs not in details:
            continue
        tastes = details[theirs].get("tastes") or []
        if not tastes:
            continue
        record = load_record(slug)
        if record is None or (record.get("aroma") or {}).get("tags"):
            continue
        tags: list[str] = []
        for family, word in tastes:
            tag = mapping["descriptors"].get(word) or mapping["families"].get(family.split()[0])
            if tag and tag not in tags:
                tags.append(tag)
        words = ", ".join(w for _, w in tastes)
        print(f"{slug:<24} {words}  ->  {', '.join(tags)}")
        if not args.apply:
            continue
        aroma = record.setdefault("aroma", CommentedMap())
        if not aroma.get("summary") or "Not yet written" in str(aroma.get("summary")):
            aroma["summary"] = f"BarthHaas describes it as {words.lower()}."
        seq = CommentedSeq(tags)
        seq.fa.set_flow_style()
        aroma["tags"] = seq
        refs = CommentedSeq(["barthhaas"])
        refs.fa.set_flow_style()
        aroma["refs"] = refs
        save_record(slug, record)
        filled += 1
    print(f"\n{filled} record(s) given aroma tags." if args.apply else "\nDry run. Add --apply to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
