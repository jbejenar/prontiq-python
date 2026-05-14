# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Dict, List, Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = [
    "AddressEnrichResponse",
    "Boundaries",
    "BoundariesCommonwealthElectorate",
    "BoundariesGccsa",
    "BoundariesLga",
    "BoundariesMeshBlock",
    "BoundariesSa2",
    "BoundariesSa3",
    "BoundariesSa4",
    "BoundariesStateElectorate",
    "Debug",
    "Geocode",
    "Location",
]


class BoundariesCommonwealthElectorate(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class BoundariesGccsa(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class BoundariesLga(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class BoundariesMeshBlock(BaseModel):
    """
    ABS Mesh Block identifier and optional land-use category for the address location.
    """

    code: str
    """ABS Mesh Block code. Mesh Blocks are the smallest ABS geographic areas."""

    category: Optional[str] = None
    """
    ABS Mesh Block land-use category when available, for example Residential or
    Commercial.
    """


class BoundariesSa2(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class BoundariesSa3(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class BoundariesSa4(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class BoundariesStateElectorate(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class Boundaries(BaseModel):
    """
    Administrative, electoral, and ABS statistical geography linked to the address when supplied by G-NAF and ABS source data.
    """

    commonwealth_electorate: Optional[BoundariesCommonwealthElectorate] = FieldInfo(
        alias="commonwealthElectorate", default=None
    )
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    gccsa: Optional[BoundariesGccsa] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    lga: Optional[BoundariesLga] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    mesh_block: Optional[BoundariesMeshBlock] = FieldInfo(alias="meshBlock", default=None)
    """
    ABS Mesh Block identifier and optional land-use category for the address
    location.
    """

    sa2: Optional[BoundariesSa2] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    sa3: Optional[BoundariesSa3] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    sa4: Optional[BoundariesSa4] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    state_electorate: Optional[BoundariesStateElectorate] = FieldInfo(alias="stateElectorate", default=None)
    """
    Named administrative, electoral, or statistical area associated with an address.
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


class Geocode(BaseModel):
    """G-NAF geocoding metadata and decimal-degree coordinates for the address."""

    latitude: float
    """Decimal degree coordinate."""

    longitude: float
    """Decimal degree coordinate."""

    reliability: Optional[int] = None
    """
    G-NAF geocode reliability code from 0 to 6, where lower values are more precise.
    """

    type: Optional[str] = None
    """G-NAF geocoding method, for example PROPERTY CENTROID."""


class Location(BaseModel):
    """Compact latitude/longitude point used for proximity queries and map display."""

    lat: float
    """Decimal degree coordinate."""

    lon: float
    """Decimal degree coordinate."""


class AddressEnrichResponse(BaseModel):
    """Public address document, with optional diagnostic metadata when debug=true."""

    id: str
    """Opaque G-NAF persistent identifier for this address record."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Formatted street address, typically street number plus street name."""

    boundaries: Optional[Boundaries] = None
    """
    Administrative, electoral, and ABS statistical geography linked to the address
    when supplied by G-NAF and ABS source data.
    """

    confidence: Optional[int] = None
    """G-NAF source-record confidence metadata.

    -1 represents retired records; 0, 1, and 2 correspond to one, two, or three
    supporting contributor datasets. This is not Prontiq match quality.
    """

    debug: Optional[Debug] = None
    """Optional diagnostic metadata returned only when `debug=true` is supplied."""

    geocode: Optional[Geocode] = None
    """G-NAF geocoding metadata and decimal-degree coordinates for the address."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    location: Optional[Location] = None
    """Compact latitude/longitude point used for proximity queries and map display."""

    postcode: Optional[str] = None
    """Four-digit Australian postcode.

    Postcodes are strings so leading zeroes are preserved.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT.
    """
