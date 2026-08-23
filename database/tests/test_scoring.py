"""The scoring properties the model depends on.

Each test corresponds to a failure measured on real data before the model was
changed. They are regression tests for judgement, not only for code.
"""
import pytest

from twm.config import ModelParams
from twm.scoring import (
    distinctiveness,
    feasibility,
    landform_weight,
    linear_norm,
    score_country,
    tiered_sum,
)
from twm.types import Candidate


def _cand(name, **kw):
    base = dict(candidate_id=name, name=name, country="X", lat=0.0, lon=0.0)
    base.update(kw)
    return Candidate(**base)


def test_tier_saturates_but_does_not_swallow_the_pillar():
    """A tier's tail stops counting; the pillar as a whole must not.

    Discounting across the whole sorted asset list made a great capital and a
    mid-sized walled town score within 7% of each other.
    """
    assert tiered_sum({1.0: 10_000}) == pytest.approx(1.0 / (1 - 0.95), rel=1e-3)
    assert tiered_sum({1.0: 400}) == pytest.approx(tiered_sum({1.0: 1000}), rel=1e-3)

    capital = tiered_sum({10.0: 1, 3.0: 40, 2.0: 60, 1.0: 400})
    town = tiered_sum({10.0: 1, 3.0: 3, 2.0: 3, 1.0: 18})
    assert capital / town > 1.5, "heritage depth must remain visible"


def test_a_world_heritage_inscription_always_counts_fully():
    assert tiered_sum({10.0: 1}) == pytest.approx(10.0)


def test_rarity_is_capped_for_a_country_with_one_instance():
    """A country's single volcanic field must not outrank its capital."""
    assert landform_weight("volcano", country_instances=5) > 5.0
    assert landform_weight("volcano", country_instances=1) == 3.0
    assert landform_weight("coast", country_instances=9) == 1.0


def test_linear_normalisation_preserves_magnitude():
    assert linear_norm([100.0, 58.0, 10.0]) == [1.0, 0.58, 0.1]
    assert linear_norm([0.0, 0.0]) == [0.0, 0.0]


def test_power_mean_does_not_punish_a_specialist():
    specialist = _cand("park", tier_counts={"whs_natural": 1, "wdpa_iucn_i_ii": 1},
                       landforms=("mountain", "glacier"), relief_m=2500)
    generalist = _cand("town", tier_counts={"national_top": 4, "institution": 4,
                                            "market": 3, "national_other": 20},
                       landforms=("river",))
    a = {s.name: s.score for s in score_country([specialist, generalist],
                                                ModelParams(power=1.0))}
    p = {s.name: s.score for s in score_country([specialist, generalist],
                                                ModelParams(power=2.0))}
    gain = (p["park"] / p["town"]) / (a["park"] / a["town"])
    assert gain > 1.0, "p>1 must lift the specialist relative to the generalist"


def test_feasibility_can_only_penalise():
    assert feasibility(_cand("easy", reach="near", has_lodging=True)) == 1.0
    assert 0 < feasibility(_cand("hard", reach="remote", has_lodging=False)) < 1.0
    assert feasibility(_cand("shut", access="closed")) == 0.0


def test_distinctiveness_is_off_by_default():
    c = _cand("odd", profile={"language": "a:b", "religion": "r",
                              "vernacular": "v", "cuisine": "q"}, population=0.1)
    modes = {"language": "x:y", "religion": "s", "vernacular": "w", "cuisine": "z"}
    assert distinctiveness(c, modes, 0.5) == 1.0
    assert distinctiveness(c, modes, 0.5, ModelParams(beta=0.6)) > 1.0


def test_scoring_is_country_relative(candidates):
    """Each country's top pillar score is 1.0 by construction -- that is what
    keeps a national register from crossing a border."""
    for country in {c.country for c in candidates}:
        scored = score_country([c for c in candidates if c.country == country])
        assert max(s.h for s in scored) == pytest.approx(1.0)
        assert max(s.n for s in scored) == pytest.approx(1.0)
