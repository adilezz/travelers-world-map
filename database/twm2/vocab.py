"""Controlled vocabularies (document 1 sections 4, 6 and 7)."""
from __future__ import annotations

import re

KINDS = (
    "capital", "old_town", "coast", "mountain", "desert", "forest", "water",
    "volcanic", "wildlife", "sacred", "rural", "metropolis", "ruins",
)
TIERS = ("Local", "Notable", "Major", "Icon")  # ascending
TIER_RANK = {t: i for i, t in enumerate(TIERS)}
PLACE_TYPES = ("settlement", "site", "area", "route")
ROW_KINDS = ("positive", "negative", "optional")
RELATIONS = ("component_of", "not_above", "not_credited", "part_of")

# Crockford base32 without i, l, o, u; ten characters, opaque (document 6 section 3.1).
PLACE_ID_RE = re.compile(r"^pl_[0-9a-hjkmnp-tv-z]{10}$")

MAX_KINDS_PER_PLACE = 3
MAX_NAME_LENGTH = 60
