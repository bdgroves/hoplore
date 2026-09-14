#!/usr/bin/env python3
"""
Drop `seed-general-knowledge` observations that a real source has superseded.

    pixi run -e data drop-placeholders            # dry run
    pixi run -e data drop-placeholders --apply

WHY THIS IS A DELETION AND NOT A SECOND OPINION
-----------------------------------------------
CONTRIBUTING.md's rule is to add an observation alongside an existing one
rather than replace it -- "unless the old one was simply wrong". A
`seed-general-knowledge` figure was entered from general brewing knowledge to
have something to build tooling against. It is not a measurement, it is a
guess, and it is tier `unsourced` weight 0.1 precisely because it should not
survive contact with a real source.

Keeping it is not neutral. `rollup.js` publishes the UNION of all source
ranges -- `low`/`high` are the widest span anyone reported -- so a padded
guess actively widens the published figure away from what the breeder
measured. After the YCR pull, Citra had:

    seed-general-knowledge  10.0-15.0     <- invented, padded both ways
    ychr                    11.0-13.0     <- the breeder's own lab

and published 10-15%. The 0.1 trust weight only pulls the *typical*; it does
nothing to the bounds. So the guess was making the real number worse.

WHAT IT WILL NOT DO
-------------------
It only removes a placeholder observation from a metric where a real source
is also present. Where the placeholder is the ONLY thing on file it stays put,
flagged, exactly as designed -- a visible gap beats an invisible guess, and
silently deleting it would turn "we guessed this" into "we have no idea",
which is a different and less useful claim.

It touches nothing else: no other source's observations, no arithmetic, no
merging. Same contract as the ingest scripts.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path

from ruamel.yaml import YAML

ROOT = Path(__file__).resolve().parents[1]
HOPS_DIR = ROOT / "data" / "hops"

PLACEHOLDER = "seed-general-knowledge"

yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096
yaml.indent(mapping=2, sequence=4, offset=2)


def describe(obs) -> str:
    """Render an observation for the report. Not every one carries low/high —
    some placeholders were seeded with only a `typical`."""
    low, high = obs.get("low"), obs.get("high")
    typical = obs.get("typical")
    if low is not None and high is not None:
        return f"{low}-{high}" + (f" (typical {typical})" if typical is not None else "")
    if typical is not None:
        return f"typical {typical}"
    return "no value"


def save(path: Path, record) -> None:
    """Preserve the repo's `{ a: b }` flow-mapping spacing; see hopsteiner.py."""
    buffer = io.StringIO()
    yaml.dump(record, buffer)
    text = buffer.getvalue()
    text = re.sub(r"\{(?=\S)", "{ ", text)
    text = re.sub(r"(?<=\S)\}", " }", text)
    path.write_text(text, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write changes to data/hops/")
    args = parser.parse_args()

    touched = 0
    still_bare = []

    for path in sorted(HOPS_DIR.glob("*.yml")):
        with path.open(encoding="utf-8") as handle:
            record = yaml.load(handle)
        if record is None:
            continue

        removals: list[str] = []
        kept: list[str] = []

        for section in ("analytics", "oils"):
            for metric_name, metric in (record.get(section) or {}).items():
                observations = metric.get("observations") or []
                sources = [o.get("source") for o in observations]
                if PLACEHOLDER not in sources:
                    continue

                real = [s for s in sources if s and s != PLACEHOLDER]
                if not real:
                    kept.append(f"{section}.{metric_name}")
                    continue

                for obs in [o for o in observations if o.get("source") == PLACEHOLDER]:
                    observations.remove(obs)
                    shown = describe(obs)
                    removals.append(
                        f"    - {section}.{metric_name}: dropped {shown} "
                        f"(superseded by {', '.join(real)})"
                    )

        if not removals and not kept:
            continue

        print(f"\n{path.name}")
        for line in removals:
            print(line)
        if kept:
            print(f"    keeping placeholder on {', '.join(kept)} — no real source there yet")
            still_bare.append(path.stem)

        if removals:
            # Re-check the whole record: if nothing cites the placeholder any
            # more, the verification tier can move off `unverified`.
            remaining = set()
            for section in ("analytics", "oils"):
                for metric in (record.get(section) or {}).values():
                    for o in metric.get("observations") or []:
                        remaining.add(o.get("source"))

            if PLACEHOLDER not in remaining:
                real_sources = {s for s in remaining if s} - {PLACEHOLDER}
                meta = record.setdefault("meta", {})
                new_tier = "corroborated" if len(real_sources) > 1 else "single-source"
                if meta.get("verification") != new_tier:
                    print(f"    meta.verification: {meta.get('verification')} -> {new_tier}")
                    meta["verification"] = new_tier

            if args.apply:
                save(path, record)
            touched += 1

    print()
    if args.apply and touched:
        print(f"{touched} record(s) updated. Now run: pixi run validate\n")
    elif touched:
        print(f"Dry run. {touched} record(s) would change. Add --apply to write.\n")
    else:
        print("Nothing to do — no placeholder is sitting next to a real source.\n")

    if still_bare:
        print("Still resting entirely on placeholder citations (left alone, by design):")
        print(f"  {', '.join(sorted(set(still_bare)))}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
