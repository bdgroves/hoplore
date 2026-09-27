#!/usr/bin/env python3
"""Checks the NASS parser against the saved reports in raw/usda-nass/."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import usda_nass as u  # noqa: E402

parsed = u.parse_all()
cells = parsed["cells"]
doc = u.build_dataset(parsed)


def test_varieties_sum_to_state_totals():
    # Withheld cells are folded into "Other varieties" by NASS, so the numeric
    # rows of every state and year must add up to that state's total exactly.
    for st in u.STATE_ORDER:
        for year in doc["years"]:
            total = doc["states"][st]["acres"][year]
            rows = [v["acres"].get(st, {}).get(year) for v in doc["varieties"]]
            assert sum(r for r in rows if isinstance(r, int)) == total, (st, year)


def test_states_sum_to_us():
    for year in doc["years"]:
        assert sum(doc["states"][s]["acres"][year] for s in u.STATE_ORDER) == doc["states"]["US"]["acres"][year]


def test_known_figures():
    # Straight from the December 2025 report's text.
    assert doc["states"]["WA"]["acres"][2025] == 31198
    assert doc["states"]["US"]["acres"][2025] == 41654
    citra = next(v for v in doc["varieties"] if v["name"] == "Citra")
    assert citra["acres"]["WA"][2025] == 5327 and citra["acres"]["OR"][2025] == 1525


def test_ctz_split_at_2020():
    ctz = next(v for v in doc["varieties"] if v["slugs"] == ["columbus", "zeus"])
    assert min(ctz["acres"]["WA"]) == 2020
    ct = next(v for v in doc["varieties"] if v["name"] == "Columbus/Tomahawk")
    assert max(ct["acres"]["WA"]) == 2019


def test_names_cleaned():
    for name in ("Azacca", "Equinox", "Super Galena", "Loral", "Mosaic", "Chinook"):
        assert any(k[2] == name for k in cells), name
    assert not any(("TM" in k[2] or "..." in k[2]) for k in cells)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok ", name)
