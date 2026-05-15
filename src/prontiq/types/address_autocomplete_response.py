# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Dict, List, Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = ["AddressAutocompleteResponse", "Suggestion", "SuggestionDebug", "Debug"]


class SuggestionDebug(BaseModel):
    """Optional diagnostic metadata returned only when `debug=true` is supplied."""

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


class Suggestion(BaseModel):
    """
    Autocomplete suggestion containing display fields and Prontiq-computed match quality. G-NAF confidence and raw search score are not returned in default suggestions.
    """

    id: str
    """Opaque G-NAF persistent identifier for this address record."""

    prontiq_match_quality: Literal["high", "medium", "low", "none"] = FieldInfo(alias="prontiqMatchQuality")
    """
    Human-readable Prontiq match-quality bucket derived from prontiqMatchScore: high
    is 67-100, medium is 34-66, low is 1-33, and none is 0.
    """

    prontiq_match_score: int = FieldInfo(alias="prontiqMatchScore")
    """Prontiq-computed request match score from 0 to 100.

    Use this for thresholds, sorting, and analytics. It is not G-NAF source
    confidence, deliverability, or geocode precision.
    """

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Formatted street address."""

    debug: Optional[SuggestionDebug] = None
    """Optional diagnostic metadata returned only when `debug=true` is supplied."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    postcode: Optional[str] = None
    """Four-digit Australian postcode.

    Postcodes are strings so leading zeroes are preserved.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT.
    """


class Debug(BaseModel):
    """Optional diagnostic metadata returned only when `debug=true` is supplied."""

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


class AddressAutocompleteResponse(BaseModel):
    """Autocomplete suggestions for a partial address query.

    Suggestions include Prontiq-computed match quality; G-NAF confidence and raw search score are not returned in default responses.
    """

    suggestions: List[Suggestion]

    total: int
    """Total matching addresses."""

    debug: Optional[Debug] = None
    """Optional diagnostic metadata returned only when `debug=true` is supplied."""
