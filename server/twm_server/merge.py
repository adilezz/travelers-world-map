"""Last-write-wins per place_id by marked_at (doc 4 §8, doc 5 §6).

Visits are independent single facts, so this needs no conflict interface.
Signing in merges rather than replaces: a traveler who marked places before
registering must not lose them.
"""
from __future__ import annotations

from typing import Any


def merge_visits(remote: list[dict[str, Any]], local: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Symmetric last-write-wins. Local wins ties so offline marks are kept."""
    out: dict[str, dict[str, Any]] = {}
    for v in remote:
        pid = v.get("place_id")
        if not pid:
            continue
        out[pid] = dict(v)
    for v in local:
        pid = v.get("place_id")
        if not pid:
            continue
        cur = out.get(pid)
        if cur is None or str(v.get("marked_at") or "") >= str(cur.get("marked_at") or ""):
            merged = dict(cur) if cur else {}
            merged.update(v)
            out[pid] = merged
    return list(out.values())


def merge_trips(remote: list[dict[str, Any]], local: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Union by id. Local wins on a colliding id (the device that just signed in)."""
    out: dict[str, dict[str, Any]] = {}
    for t in remote:
        tid = t.get("id")
        if tid:
            out[tid] = dict(t)
    for t in local:
        tid = t.get("id")
        if tid:
            out[tid] = dict(t)
    return list(out.values())


def merge_profile(remote: dict[str, Any] | None, local: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(remote or {})
    for k, v in (local or {}).items():
        if v is not None and v != "":
            out[k] = v
    return out
