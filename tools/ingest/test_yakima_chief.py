#!/usr/bin/env python3
"""
Parser tests. Run with: pixi run -e data test-ych

These cover OUR logic against a saved fixture. They cannot tell you that YCR
has changed their markup — only a live run does that, which is why the scraper
defaults to a dry run.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from yakima_chief import parse_range, parse_brand, map_label  # noqa: E402

FIXTURE = Path(__file__).parent / "fixtures" / "ychr-citra.html"

failures = []


def check(label, actual, expected):
    if actual != expected:
        failures.append(f"{label}: expected {expected!r}, got {actual!r}")


# --- parse_range ------------------------------------------------------------
#
# The closed-up hyphen cases are the regression that matters. YCR writes
# "11-13" where Hopsteiner writes "9.5 - 11.5", and an earlier version of this
# parser allowed a leading minus in the number pattern, so "11-13" came back as
# (-13.0, 11.0) — silently inverted and negative.
check("range closed hyphen", parse_range("11-13"), (11.0, 13.0))
check("range closed decimal", parse_range("3.5-4.5"), (3.5, 4.5))
check("range en dash", parse_range("60\u201365%"), (60.0, 65.0))
check("range percent suffix", parse_range("22-24%"), (22.0, 24.0))
check("range single percent", parse_range("75%"), (75.0, 75.0))
check("range zero", parse_range("0%"), (0.0, 0.0))
check("range with comma", parse_range("1,600-1,800"), (1600.0, 1800.0))
check("range spaced", parse_range("2.2 - 2.8"), (2.2, 2.8))
check("range empty", parse_range(""), None)
check("range open ended", parse_range("> 0.46"), None)

# --- label mapping ----------------------------------------------------------
#
# Matched on a prefix so the parenthetical unit text can be reworded without
# silently dropping the field.
check("label alpha", map_label("Alpha Acids"), ("analytics", "alpha_acid", "percent"))
check(
    "label cohumulone with suffix",
    map_label("Cohumulone (% of alpha acids)"),
    ("analytics", "cohumulone", "percent_of_alpha"),
)
check(
    "label total oils with suffix",
    map_label("Total Oils (Mls. per 100 grams dried hops)"),
    ("analytics", "total_oil", "ml_per_100g"),
)
check(
    "label myrcene",
    map_label("Myrcene (as % of total oils)"),
    ("oils", "myrcene", "percent_of_total_oil"),
)
check(
    "label storage",
    map_label("Storage (% alpha acids remaining after 6 months storage at 20\u00b0 C)"),
    ("analytics", "alpha_retention_6mo_20c", "percent"),
)
check("label unknown", map_label("Bine Colour"), None)

# --- whole-page parse -------------------------------------------------------

brand = parse_brand(FIXTURE.read_text(encoding="utf-8"), "citra", "citra", "https://example/")
found = {f"{o.section}.{o.metric}": (o.low, o.high) for o in brand.observations}

check("citra alpha", found.get("analytics.alpha_acid"), (11.0, 13.0))
check("citra beta", found.get("analytics.beta_acid"), (3.5, 4.5))
check("citra cohumulone", found.get("analytics.cohumulone"), (22.0, 24.0))
check("citra total oil", found.get("analytics.total_oil"), (2.2, 2.8))
check("citra myrcene", found.get("oils.myrcene"), (60.0, 65.0))
check("citra humulene", found.get("oils.humulene"), (11.0, 13.0))
check("citra caryophyllene", found.get("oils.caryophyllene"), (6.0, 8.0))
check("citra farnesene", found.get("oils.farnesene"), (0.0, 0.0))
check("citra storage", found.get("analytics.alpha_retention_6mo_20c"), (75.0, 75.0))

# Derived and agronomic rows are deliberately not stored.
check("alpha-beta ratio not stored", "analytics.alpha_beta_ratio" in found, False)
check("yield not stored", any("yield" in k.lower() for k in found), False)
check("yield not reported as unmapped", any("Yield" in k for k in brand.unmapped), False)

# Everything on the page is either mapped or deliberately ignored.
check("nothing unmapped", brand.unmapped, {})

# Myrcene is the whole point of this source: without it an oil profile cannot
# clear MIN_COVERAGE in rollup.js and no chart is drawn.
oil_total = sum(
    (o.low + o.high) / 2 for o in brand.observations if o.section == "oils"
)
check("oil components clear the 60% coverage floor", oil_total > 60, True)

# --- report -----------------------------------------------------------------

if failures:
    print(f"\n{len(failures)} failure(s):")
    for f in failures:
        print(f"  x {f}")
    sys.exit(1)

print("\nAll yakima_chief parser tests passed.\n")
