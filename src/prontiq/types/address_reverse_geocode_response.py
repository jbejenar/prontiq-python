# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Dict, List, Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = [
    "AddressReverseGeocodeResponse",
    "Result",
    "ResultBoundaries",
    "ResultBoundariesCommonwealthElectorate",
    "ResultBoundariesGccsa",
    "ResultBoundariesLga",
    "ResultBoundariesMeshBlock",
    "ResultBoundariesSa2",
    "ResultBoundariesSa3",
    "ResultBoundariesSa4",
    "ResultBoundariesStateElectorate",
    "ResultGeocode",
    "ResultLocation",
    "Debug",
]


class ResultBoundariesCommonwealthElectorate(BaseModel):
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


class ResultBoundariesGccsa(BaseModel):
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


class ResultBoundariesLga(BaseModel):
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


class ResultBoundariesMeshBlock(BaseModel):
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


class ResultBoundariesSa2(BaseModel):
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


class ResultBoundariesSa3(BaseModel):
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


class ResultBoundariesSa4(BaseModel):
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


class ResultBoundariesStateElectorate(BaseModel):
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


class ResultBoundaries(BaseModel):
    """
    Administrative, electoral, and ABS statistical geography linked to the address when supplied by G-NAF and ABS source data. Boundary values can change between official data releases without the address `id` changing.
    """

    commonwealth_electorate: Optional[ResultBoundariesCommonwealthElectorate] = FieldInfo(
        alias="commonwealthElectorate", default=None
    )
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    gccsa: Optional[ResultBoundariesGccsa] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    lga: Optional[ResultBoundariesLga] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    mesh_block: Optional[ResultBoundariesMeshBlock] = FieldInfo(alias="meshBlock", default=None)
    """
    ABS Mesh Block identifier and optional land-use category for the address
    location.
    """

    sa2: Optional[ResultBoundariesSa2] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    sa3: Optional[ResultBoundariesSa3] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    sa4: Optional[ResultBoundariesSa4] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    state_electorate: Optional[ResultBoundariesStateElectorate] = FieldInfo(alias="stateElectorate", default=None)
    """
    Named administrative, electoral, or statistical area associated with an address.
    """


class ResultGeocode(BaseModel):
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


class ResultLocation(BaseModel):
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


class Result(BaseModel):
    """Address document plus distance from the reverse-geocode query point."""

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

    boundaries: Optional[ResultBoundaries] = None
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

    distance_m: Optional[float] = None
    """
    Distance from the submitted reverse-geocode coordinate to this address point,
    measured in metres.
    """

    geocode: Optional[ResultGeocode] = None
    """G-NAF geocoding metadata and decimal-degree coordinates for the address."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Official suburb or locality name associated with the address."""

    location: Optional[ResultLocation] = None
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


class AddressReverseGeocodeResponse(BaseModel):
    """Addresses nearest to the supplied latitude and longitude."""

    results: List[Result]
    """Nearby address documents sorted by distance from the submitted coordinate.

    The array may be empty when no address falls within the radius.
    """

    total: int
    """Total address records found within the requested radius."""

    debug: Optional[Debug] = None
    """Optional diagnostic metadata returned only when `debug=true` is supplied.

    Debug values are for support and troubleshooting, not production
    decision-making.
    """
