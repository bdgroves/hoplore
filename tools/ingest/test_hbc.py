#!/usr/bin/env python3
"""Checks the HBC parser against the real saved page (fixtures/hbc.html)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import hbc  # noqa: E402

brands = hbc.parse_page((Path(__file__).parent / "fixtures" / "hbc.html").read_text(encoding="utf-8"))


def values(number):
    return {o.metric: (o.low, o.high) for o in brands[number].observations}


def test_every_brand_found():
    assert set(brands) == {"1019", "586", "394", "369", "366", "291", "438", "682", "692", "1325"}
    assert brands["682"].brand == "TerraFlux" and brands["394"].brand == "Citra"


def test_teaser_strip_does_not_win():
    # Citra appears first as a "View Details" teaser with no numbers.
    assert values("394")["alpha_acid"] == (11.0, 13.0)
    assert values("394")["myrcene"] == (60.0, 65.0)


def test_units_stripped():
    assert values("394")["total_oil"] == (2.2, 2.8)  # "ml/100g": the 100 is not a bound
    assert values("394")["cohumulone"] == (22.0, 24.0)  # "% of alpha acids"


def test_talus():
    assert values("692") == {"alpha_acid": (8.9, 9.5), "beta_acid": (8.3, 10.2), "total_oil": (1.0, 2.2)}


def test_every_mapped_number_is_on_the_page():
    assert set(hbc.load_map().values()) <= set(brands)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
