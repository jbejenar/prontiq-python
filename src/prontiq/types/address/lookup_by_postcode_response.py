# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Dict, List, Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from ..._models import BaseModel

__all__ = ["LookupByPostcodeResponse", "Locality", "Debug"]


class Locality(BaseModel):
    """Locality summary returned for a postcode lookup."""

    address_count: int
    """Number of address records in this locality for the requested postcode.

    This is dataset cardinality, not credit usage.
    """

    name: str
    """Official suburb or locality name associated with the postcode."""

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are `NSW` New South Wales, `VIC` Victoria, `QLD` Queensland, `SA`
    South Australia, `WA` Western Australia, `TAS` Tasmania, `NT` Northern
    Territory, and `ACT` Australian Capital Territory.
    """


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


class LookupByPostcodeResponse(BaseModel):
    """Localities and address counts for an Australian postcode."""

    localities: List[Locality]
    """
    Localities that contain address records for the requested postcode, ordered by
    the lookup implementation.
    """

    postcode: str
    """Four-digit Australian postcode.

    Store postcodes as strings; integer coercion can remove leading zeroes used by
    some Australian postcodes.
    """

    debug: Optional[Debug] = None
    """Optional diagnostic metadata returned only when `debug=true` is supplied.

    Debug values are for support and troubleshooting, not production
    decision-making.
    """
