# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Dict, List, Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from ..._models import BaseModel

__all__ = ["LookupBySuburbResponse", "Bounds", "BoundsBottomRight", "BoundsTopLeft", "Debug"]


class BoundsBottomRight(BaseModel):
    """Compact latitude/longitude point used for proximity workflows and map display."""

    lat: float
    """
    WGS84 decimal-degree coordinate used for Australian address locations and
    reverse-geocode queries.
    """

    lon: float
    """
    WGS84 decimal-degree coordinate used for Australian address locations and
    reverse-geocode queries.
    """


class BoundsTopLeft(BaseModel):
    """Compact latitude/longitude point used for proximity workflows and map display."""

    lat: float
    """
    WGS84 decimal-degree coordinate used for Australian address locations and
    reverse-geocode queries.
    """

    lon: float
    """
    WGS84 decimal-degree coordinate used for Australian address locations and
    reverse-geocode queries.
    """


class Bounds(BaseModel):
    """Approximate bounding box for the suburb or locality when available."""

    bottom_right: BoundsBottomRight
    """Compact latitude/longitude point used for proximity workflows and map display."""

    top_left: BoundsTopLeft
    """Compact latitude/longitude point used for proximity workflows and map display."""


class Debug(BaseModel):
    """Optional diagnostic metadata returned only when `debug=true` is supplied.

    Debug values are for support and troubleshooting, not production decision-making.
    """

    query_mode: Literal["autocomplete", "validate", "enrich", "reverse", "lookup"] = FieldInfo(alias="queryMode")
    """Address API operation mode that produced this diagnostic object."""

    scoring_version: Literal["address-match-v1"] = FieldInfo(alias="scoringVersion")
    """Version of the public Prontiq match-scoring algorithm used for diagnostics."""

    matched_components: Optional[Dict[str, Literal["exact", "prefix", "fuzzy", "none"]]] = FieldInfo(
        alias="matchedComponents", default=None
    )
    """Per-component match classification for diagnostics.

    Shape may evolve between scoring versions.
    """

    score_caps: Optional[List[str]] = FieldInfo(alias="scoreCaps", default=None)
    """
    Diagnostic list of caps applied to the score, such as explicit postcode or state
    mismatches.
    """

    search_score: Optional[float] = FieldInfo(alias="searchScore", default=None)
    """Internal search relevance score when available.

    This value is unstable and must not be stored, sorted by, or used for business
    decisions.
    """


class LookupBySuburbResponse(BaseModel):
    """Postcodes, bounds, and address count for a suburb or locality."""

    address_count: int
    """Total address records in this suburb or locality.

    This is dataset cardinality, not credit usage.
    """

    postcodes: List[str]
    """Postcodes associated with this suburb or locality."""

    suburb: str
    """Normalized suburb or locality name returned in uppercase."""

    bounds: Optional[Bounds] = None
    """Approximate bounding box for the suburb or locality when available."""

    debug: Optional[Debug] = None
    """Optional diagnostic metadata returned only when `debug=true` is supplied.

    Debug values are for support and troubleshooting, not production
    decision-making.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are `NSW` New South Wales, `VIC` Victoria, `QLD` Queensland, `SA`
    South Australia, `WA` Western Australia, `TAS` Tasmania, `NT` Northern
    Territory, and `ACT` Australian Capital Territory.
    """
