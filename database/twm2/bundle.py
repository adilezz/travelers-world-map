"""The published bundle (document 6 section 6) and the registry (section 3.2)."""
from __future__ import annotations

import csv
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Bundle:
    root: Path
    manifest: dict
    places: list[dict]

    @classmethod
    def load(cls, root: str | Path) -> Bundle:
        root = Path(root)
        manifest_path = root / "manifest.json"
        if not manifest_path.is_file():
            raise FileNotFoundError(f"no manifest.json in {root}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        places: list[dict] = []
        for f in sorted((root / "places").glob("*.json")):
            doc = json.loads(f.read_text(encoding="utf-8"))
            for p in doc.get("places", []):
                p.setdefault("iso3", doc.get("iso3", f.stem))
                places.append(p)
        return cls(root, manifest, places)

    def active(self) -> list[dict]:
        return [p for p in self.places if p.get("status", "active") == "active"]

    def file_hashes(self) -> dict[str, str]:
        out = {}
        for f in sorted(self.root.rglob("*")):
            if f.is_file() and f.name != "manifest.json":
                out[f.relative_to(self.root).as_posix()] = hashlib.sha256(f.read_bytes()).hexdigest()
        return out


@dataclass
class Registry:
    rows: dict[str, dict] = field(default_factory=dict)

    @classmethod
    def load(cls, path: str | Path) -> Registry:
        path = Path(path)
        rows: dict[str, dict] = {}
        if path.suffix == ".parquet":
            import duckdb

            cur = duckdb.connect().execute("select * from read_parquet(?)", [str(path)])
            cols = [d[0] for d in cur.description]
            for rec in cur.fetchall():
                row = dict(zip(cols, rec, strict=True))
                rows[row["place_id"]] = row
        else:
            with open(path, encoding="utf-8", newline="") as fh:
                for row in csv.DictReader(fh):
                    rows[row["place_id"]] = row
        return cls(rows)

    def resolve(self, place_id: str) -> str | None:
        """Follow merged_into chains; None on a dangling or cyclic chain."""
        seen: set[str] = set()
        cur = place_id
        while cur in self.rows:
            if cur in seen:
                return None
            seen.add(cur)
            status = self.rows[cur].get("status") or ""
            if not status.startswith("merged_into:"):
                return cur
            cur = status.split(":", 1)[1]
        return None
