"""
Shared writing and reporting for scrapers that parse saved pages.

Same contract everywhere: add observations under one source id, never touch
another source's observation, report disagreement instead of resolving it.
"""
from __future__ import annotations

import time

from ruamel.yaml.comments import CommentedMap, CommentedSeq

from barthhaas import flow  # noqa: F401  (re-exported for callers)


def apply_observations(record: CommentedMap, observations, source_id: str, force: bool = False,
                       note: str | None = None) -> list[str]:
    changes: list[str] = []
    for obs in observations:
        section = record.setdefault(obs.section, CommentedMap())
        metric = section.setdefault(obs.metric, CommentedMap({"unit": obs.unit, "observations": CommentedSeq()}))
        metric.setdefault("observations", CommentedSeq())
        already = [o for o in metric["observations"] if o.get("source") == source_id]
        if already and not force:
            changes.append(f"  skip  {obs.section}.{obs.metric}: {source_id} observation already present")
            continue
        for old in already:
            metric["observations"].remove(old)
        entry = {"source": source_id, "low": obs.low, "high": obs.high}
        if note:
            entry["note"] = note
        metric["observations"].append(flow(entry))
        changes.append(f"  {'replace' if already else 'add'}   {obs.section}.{obs.metric}: {obs.low}-{obs.high}")

    if any(c.strip().startswith(("add", "replace")) for c in changes):
        meta = record.setdefault("meta", CommentedMap())
        meta["last_reviewed"] = time.strftime("%Y-%m-%d", time.gmtime())
        sources = {
            o.get("source")
            for sec in ("analytics", "oils")
            for m in (record.get(sec) or {}).values()
            for o in (m.get("observations") or [])
        }
        real = sources - {"seed-general-knowledge", None}
        meta["verification"] = "corroborated" if len(real) > 1 else "single-source"
        changes.append(f"  meta  verification -> {meta['verification']}")
    return changes


def reconcile(record: CommentedMap, observations, source_id: str) -> list[str]:
    notes = []
    for obs in observations:
        for existing in (record.get(obs.section) or {}).get(obs.metric, {}).get("observations", []) or []:
            src, low, high = existing.get("source"), existing.get("low"), existing.get("high")
            if src in (source_id, None) or low is None or high is None:
                continue
            tolerance = max(0.1, 0.05 * max(abs(high), abs(obs.high), 1.0))
            if abs(low - obs.low) > tolerance or abs(high - obs.high) > tolerance:
                marker = "!!" if src == "seed-general-knowledge" else " ~"
                notes.append(f"  {marker} {obs.metric}: on file {low}-{high} ({src}), {source_id} says {obs.low}-{obs.high}")
    return notes
