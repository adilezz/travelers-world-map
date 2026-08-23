"""Source adapters. See base.py for the contract every adapter follows."""
from twm.sources.base import LocalSource, Source, SourceError, registry

__all__ = ["Source", "LocalSource", "SourceError", "registry"]
