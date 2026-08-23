"""
Shared plumbing for source adapters.

Every adapter follows the same shape:

    class Foo(Source):
        name = "foo"
        licence = "CC-BY-4.0"
        cross_country_safe = True
        def fetch(self) -> Path: ...      # download to cache, idempotent
        def load(self) -> Iterator[Asset | Candidate]: ...

Two rules the whole database depends on:

* Every record carries `source`, `source_url` and `retrieved`. Without a
  per-record provenance field, a later licence audit means rebuilding the
  database rather than filtering it.
* `cross_country_safe` marks whether a source may inform a comparison BETWEEN
  countries. National registers may not: they measure how well a country
  documented itself, not how much it has.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Iterator
from datetime import date
from pathlib import Path
from typing import Any

CACHE_DIR = Path(os.environ.get("TWM_CACHE", Path.home() / ".cache" / "twm"))
USER_AGENT = os.environ.get(
    "TWM_USER_AGENT",
    "TravelersWorldMap/1.0 (database build; contact: set TWM_USER_AGENT)",
)


class SourceError(RuntimeError):
    pass


class Source:
    """Base adapter."""

    name: str = "unnamed"
    licence: str = "unknown"
    attribution: str = ""
    cross_country_safe: bool = False
    requires_network: bool = True

    def __init__(self, cache_dir: Path | None = None):
        self.cache = Path(cache_dir or CACHE_DIR) / self.name
        self.cache.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ contract
    def fetch(self) -> Path:
        raise NotImplementedError

    def load(self) -> Iterator[Any]:
        raise NotImplementedError

    # ------------------------------------------------------------------- helpers
    @property
    def today(self) -> str:
        return date.today().isoformat()

    def _cached(self, url: str, suffix: str = "", max_age_days: int = 30) -> Path:
        """Download once, reuse until stale. Raises rather than returning partial
        data -- a half-downloaded source silently produces a wrong database."""
        key = hashlib.sha256(url.encode()).hexdigest()[:16]
        path = self.cache / f"{key}{suffix}"
        if path.exists():
            age_days = (time.time() - path.stat().st_mtime) / 86400
            if age_days < max_age_days and path.stat().st_size > 0:
                return path
        self._download(url, path)
        return path

    def _download(self, url: str, dest: Path, timeout: int = 120) -> None:
        import requests

        tmp = dest.with_suffix(dest.suffix + ".part")
        try:
            with requests.get(url, headers={"User-Agent": USER_AGENT},
                              stream=True, timeout=timeout) as r:
                r.raise_for_status()
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
            tmp.replace(dest)
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            raise SourceError(f"{self.name}: could not fetch {url}: {exc}") from exc

    def _json(self, url: str, max_age_days: int = 30) -> Any:
        return json.loads(self._cached(url, ".json", max_age_days).read_text("utf-8"))

    def manifest(self) -> dict:
        """Provenance block, written alongside every build."""
        return {
            "source": self.name,
            "licence": self.licence,
            "attribution": self.attribution,
            "cross_country_safe": self.cross_country_safe,
            "retrieved": self.today,
        }


class LocalSource(Source):
    """A source read from a file the operator supplies -- typically because the
    upstream requires registration, a click-through licence, or a bulk export
    that cannot be scripted."""

    requires_network = False
    instructions: str = ""

    def __init__(self, path: str | Path, cache_dir: Path | None = None):
        super().__init__(cache_dir)
        self.path = Path(path)

    def fetch(self) -> Path:
        if not self.path.exists():
            raise SourceError(
                f"{self.name}: expected a local file at {self.path}.\n{self.instructions}"
            )
        return self.path


def registry() -> dict[str, type[Source]]:
    """All adapters, for `twm sources` and for the build manifest."""
    from twm.sources import (
        cuisine,
        foursquare,
        ghsl,
        naturalearth,
        osm,
        protected,
        unesco,
        wikidata,
    )

    out: dict[str, type[Source]] = {}
    for mod in (unesco, wikidata, osm, ghsl, protected, foursquare, naturalearth, cuisine):
        for obj in vars(mod).values():
            if isinstance(obj, type) and issubclass(obj, Source) and obj not in (
                Source, LocalSource
            ):
                out[obj.name] = obj
    return out
