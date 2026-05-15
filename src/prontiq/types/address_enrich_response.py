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
    """Official administrative, electoral, or statistical area name."""

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
    """Official administrative, electoral, or statistical area name."""

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
    """Official administrative, electoral, or statistical area name."""

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
    """ABS Mesh Block code.

    Mesh Blocks are the smallest Australian Bureau of Statistics geographic areas
    used to build larger statistical regions.
    """

    category: Optional[str] = None
    """
    ABS Mesh Block land-use category when available, such as Residential,
    Commercial, Parkland, or Education.
    """


class BoundariesSa2(BaseModel):
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    name: str
    """Official administrative, electoral, or statistical area name."""

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
    """Official administrative, electoral, or statistical area name."""

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
    """Official administrative, electoral, or statistical area name."""

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
    """Official administrative, electoral, or statistical area name."""

    code: Optional[str] = None
    """
    Official ABS, electoral, or administrative area code when supplied by the source
    dataset.
    """


class Boundaries(BaseModel):
    """
    Administrative, electoral, and ABS statistical geography linked to the address when supplied by G-NAF and ABS source data. Boundary values can change between official data releases without the address `id` changing.
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


class Geocode(BaseModel):
    """G-NAF geocoding metadata and decimal-degree coordinates for the address."""

    latitude: float
    """
    WGS84 decimal-degree coordinate used for Australian address locations and
    reverse-geocode queries.
    """

    longitude: float
    """
    WGS84 decimal-degree coordinate used for Australian address locations and
    reverse-geocode queries.
    """

    reliability: Optional[int] = None
    """
    G-NAF geocode reliability code from 0 to 6, where lower values indicate more
    precise location evidence. Treat this as geocode precision metadata, not address
    match quality.
    """

    type: Optional[str] = None
    """
    G-NAF geocoding method when supplied by the source record, such as a frontage,
    property centroid, or locality-level point.
    """


class Location(BaseModel):
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


class AddressEnrichResponse(BaseModel):
    """Public address document, with optional diagnostic metadata when debug=true."""

    id: str
    """Opaque G-NAF persistent identifier for this address record.

    Store it as a string and pass it to Enrich when you need the full public address
    document.
    """

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Formatted street-address line for display and form population.

    It usually contains the street number, street name, and any unit or building
    text available in the source record.
    """

    boundaries: Optional[Boundaries] = None
    """
    Administrative, electoral, and ABS statistical geography linked to the address
    when supplied by G-NAF and ABS source data. Boundary values can change between
    official data releases without the address `id` changing.
    """

    confidence: Optional[int] = None
    """G-NAF source-record confidence metadata.

    `-1` represents a retired record; `0`, `1`, and `2` indicate one, two, or three
    supporting contributor datasets. This is provenance metadata, not Prontiq match
    quality.
    """

    debug: Optional[Debug] = None
    """Optional diagnostic metadata returned only when `debug=true` is supplied.

    Debug values are for support and troubleshooting, not production
    decision-making.
    """

    geocode: Optional[Geocode] = None
    """G-NAF geocoding metadata and decimal-degree coordinates for the address."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Official suburb or locality name associated with the address."""

    location: Optional[Location] = None
    """Compact latitude/longitude point used for proximity workflows and map display."""

    postcode: Optional[str] = None
    """Four-digit Australian postcode.

    Store postcodes as strings; integer coercion can remove leading zeroes used by
    some Australian postcodes.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are `NSW` New South Wales, `VIC` Victoria, `QLD` Queensland, `SA`
    South Australia, `WA` Western Australia, `TAS` Tasmania, `NT` Northern
    Territory, and `ACT` Australian Capital Territory.
    """
