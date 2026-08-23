"""Travelers World Map -- place database construction.

    from twm.pipeline import build, CountryFacts
    from twm.store import export_app, export_printed

The model is documented in the place-model specification; the parameters live in
twm/config.py with the reasoning attached to each one.
"""
from twm.config import ARCHETYPES, PARAMS, ModelParams
from twm.types import Asset, Candidate, Place, Scored, Territory

__version__ = "1.0.0"
__all__ = ["PARAMS", "ModelParams", "ARCHETYPES",
           "Asset", "Candidate", "Place", "Scored", "Territory"]
