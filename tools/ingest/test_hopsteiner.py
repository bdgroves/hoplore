#!/usr/bin/env python3
"""
Parser tests. Run with: pixi run -e data python tools/ingest/test_hopsteiner.py

These cover OUR logic against a saved fixture. They cannot tell you that
Hopsteiner has changed their markup — only a live run does that, which is why
the scraper defaults to a dry run.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hopsteiner import parse_range, parse_sheet  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "hallertauer-mittelfrueh.html"

failures = []


def check(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


check("range basic", parse_range("9.5 - 11.5"), (9.5, 11.5))
check("range integers", parse_range("29 - 30"), (29.0, 30.0))
check("range zero padded", parse_range("0.00 - 1.00"), (0.0, 1.0))
check("range with comma", parse_range("1,700 - 2,000"), (1700.0, 2000.0))
check("range single value", parse_range("723"), (723.0, 723.0))
check("range open ended", parse_range("> 0.46"), None)
check("range less than", parse_range("< 4.6"), None)
check("range empty", parse_range(""), None)
check("range text only", parse_range("Tolerant"), None)
check("range reversed", parse_range("11.5 - 9.5"), (9.5, 11.5))

sheet = parse_sheet(FIXTURE.read_text(encoding="utf-8"), "hallertau-mittelfrueh", "Hallertauer-Mittelfrueh", "http://x")

found = {o.metric: (o.low, o.high) for o in sheet.observations}
check("alpha", found.get("alpha_acid"), (3.0, 5.5))
check("beta", found.get("beta_acid"), (3.0, 5.0))
check("cohumulone", found.get("cohumulone"), (18.0, 28.0))
check("total oil", found.get("total_oil"), (0.7, 1.3))
check("farnesene", found.get("farnesene"), (0.0, 1.0))
check("linalool", found.get("linalool"), (0.7, 1.1))
check("metric count", len(sheet.observations), 6)
check("last changed", sheet.last_changed, "2020-01-09")
check("genetic origin", sheet.genetic_origin, "A landrace variety originating in Germany.")
check("alternatives", sheet.alternatives, ["Hallertauer Tradition", "Saphir"])

# Section headings must not be mistaken for data.
check("no section rows", [o for o in sheet.observations if o.label.lower() in ("growing", "bitter components")], [])

# Unbounded polyphenols are skipped, not guessed at.
check("polyphenols skipped", "Total Polyphenoles" in sheet.unmapped, True)

# Agronomics are reported as unmapped so they are visible, not silently lost.
check("yield surfaced", "Yield (kg/ha)" in sheet.unmapped, True)

if failures:
    print(f"\n{len(failures)} failure(s):")
    for f in failures:
        print(f"  x {f}")
    sys.exit(1)

print("\n  all parser tests passed\n")
