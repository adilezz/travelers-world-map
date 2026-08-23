"""
GHS Urban Centre Database -- the settlement candidate layer.

GHS-UCDB delineates urban centres from satellite-derived built-up surface and
population grids rather than from administrative boundaries, which is exactly
what this project needs: the unit is the place a traveler experiences, not the
municipal boundary a statistician draws.

Settlements below the UCDB threshold still enter as candidates when they carry a
World Heritage inscription or wide multilingual coverage -- that clause is what
admits a village of eight hundred that everyone has heard of.
"""
from __future__ import annotations

import csv
from collections.abc import Iterator

from twm.sources.base import LocalSource
from twm.types import Candidate

SMALL_SETTLEMENT_FLOOR = 5_000


class UrbanCentres(LocalSource):
    """GHS-UCDB R2024A, exported to CSV.

    Columns used: ID_UC_G0, GC_UCN_MAI_2025 (name), GC_CNT_GAD_2025 (country),
    GH_BUS_TOT_2025 (population), longitude/latitude of the centroid.
    Column names have changed between releases -- the adapter fails loudly rather
    than silently producing a database with no population.
    """

    name = "ghsl-ucdb"
    licence = "CC-BY-4.0 (European Commission JRC)"
    attribution = "European Commission JRC, GHSL"
    cross_country_safe = False
    instructions = (
        "Download GHS-UCDB R2024A from "
        "https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php "
        "and export the attribute table to CSV."
    )

    NAME_COLS = ("GC_UCN_MAI_2025", "UC_NM_MN", "name")
    COUNTRY_COLS = ("GC_CNT_GAD_2025", "CTR_MN_NM", "country")
    POP_COLS = ("GH_BUS_TOT_2025", "P15", "population")
    LAT_COLS = ("GC_UCA_LTC_2025", "latitude", "lat", "GCPNT_LAT")
    LON_COLS = ("GC_UCA_LNC_2025", "longitude", "lon", "GCPNT_LON")

    def load(self) -> Iterator[Candidate]:
        with open(self.fetch(), encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            cols = reader.fieldnames or []
            name_c = _pick(cols, self.NAME_COLS, "name")
            country_c = _pick(cols, self.COUNTRY_COLS, "country")
            pop_c = _pick(cols, self.POP_COLS, "population")
            lat_c = _pick(cols, self.LAT_COLS, "latitude")
            lon_c = _pick(cols, self.LON_COLS, "longitude")
            for i, row in enumerate(reader):
                try:
                    lat, lon = float(row[lat_c]), float(row[lon_c])
                    pop = float(row[pop_c] or 0.0)
                except (TypeError, ValueError):
                    continue
                if pop < SMALL_SETTLEMENT_FLOOR:
                    continue
                yield Candidate(
                    candidate_id=f"uc-{row.get('ID_UC_G0', i)}",
                    name=(row.get(name_c) or "").strip() or f"Urban centre {i}",
                    country=(row.get(country_c) or "").strip(),
                    lat=lat, lon=lon, is_site=False,
                    population=pop / 1_000_000.0,
                    sources={self.name},
                )


def _pick(columns: list[str], candidates: tuple[str, ...], label: str) -> str:
    for c in candidates:
        if c in columns:
            return c
    raise KeyError(
        f"ghsl-ucdb: no column for {label}. Tried {candidates}. "
        f"Release layouts differ -- inspect the CSV header and extend the adapter."
    )
