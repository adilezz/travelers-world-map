import json
from pathlib import Path

import pytest

from twm.pipeline import CountryFacts
from twm.types import Candidate

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "pilot.json"


@pytest.fixture(scope="session")
def pilot():
    return json.loads(FIXTURE.read_text("utf-8"))


@pytest.fixture
def candidates(pilot):
    return [Candidate(
        candidate_id=r["candidate_id"], name=r["name"], country=r["country"],
        lat=r["lat"], lon=r["lon"], is_site=r["is_site"],
        population=r["population"], tier_counts=dict(r["tier_counts"]),
        landforms=tuple(r["landforms"]), relief_m=r["relief_m"],
        coherence=r["coherence"], profile=dict(r["profile"]), reach=r["reach"],
        has_lodging=r["has_lodging"], access=r["access"],
        overtourism=r["overtourism"],
        historic_capital=r.get("historic_capital", False),
    ) for r in pilot["candidates"]]


@pytest.fixture
def countries(pilot):
    return {name: CountryFacts(name=name, area_km2=f["area_km2"])
            for name, f in pilot["countries"].items()}
