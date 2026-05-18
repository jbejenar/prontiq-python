# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Dict, List, Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = [
    "AddressEnrichResponse",
    "Alias",
    "AllGeocode",
    "Boundaries",
    "BoundariesCommonwealthElectorate",
    "BoundariesGccsa",
    "BoundariesLga",
    "BoundariesMeshBlock",
    "BoundariesSa2",
    "BoundariesSa3",
    "BoundariesSa4",
    "BoundariesStateElectorate",
    "BoundariesWard",
    "Components",
    "Debug",
    "Geocode",
    "Locality",
    "Location",
    "Secondary",
    "Street",
]


class Alias(BaseModel):
    """Alternative address label associated with the enriched address."""

    id: Optional[str] = None
    """Public identifier for the alternate address record when available."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Alternate display label for the address."""

    type: Optional[str] = None
    """Alias type label when available."""


class AllGeocode(BaseModel):
    """One geocode associated with an enriched address record.

    Enrich preserves the source order after filtering invalid coordinates.
    """

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

    reliability: Optional[float] = None
    """Source geocode reliability value when available.

    Lower values usually indicate more precise location evidence.
    """

    type: Optional[str] = None
    """Geocode method or level for this additional geocode when available."""


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


class BoundariesWard(BaseModel):
    """Council ward associated with an enriched address when available."""

    name: Optional[str] = None
    """Council ward name when available."""


class Boundaries(BaseModel):
    """Administrative, electoral, and ABS geography returned by Enrich.

    This is a strict superset of the standard address boundary object.
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

    sa1: Optional[str] = None
    """ABS Statistical Area Level 1 code when available.

    SA1 is useful for downstream statistical joins such as SEIFA.
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

    ward: Optional[BoundariesWard] = None
    """Council ward associated with an enriched address when available."""


class Components(BaseModel):
    """Structured address components when available for the enriched record."""

    address_site_name: Optional[str] = FieldInfo(alias="addressSiteName", default=None)
    """
    Site name associated with the address when available, such as a shopping centre,
    hospital, or campus.
    """

    building_name: Optional[str] = FieldInfo(alias="buildingName", default=None)
    """Building name associated with the address when available."""

    flat_number: Optional[str] = FieldInfo(alias="flatNumber", default=None)
    """Unit, flat, shop, or suite number without the type prefix."""

    flat_type: Optional[str] = FieldInfo(alias="flatType", default=None)
    """Unit, flat, shop, or suite type when the address has a subaddress component."""

    level_number: Optional[str] = FieldInfo(alias="levelNumber", default=None)
    """Level or floor number without the level type prefix."""

    level_type: Optional[str] = FieldInfo(alias="levelType", default=None)
    """Level type when the address has a floor or level component."""

    lot_number: Optional[str] = FieldInfo(alias="lotNumber", default=None)
    """Lot number for rural, unsubdivided, or lot-based addressing when available."""

    street_name: Optional[str] = FieldInfo(alias="streetName", default=None)
    """Street name without street type or suffix."""

    street_number_first: Optional[str] = FieldInfo(alias="streetNumberFirst", default=None)
    """First or only street number for the address."""

    street_number_last: Optional[str] = FieldInfo(alias="streetNumberLast", default=None)
    """Last street number when the address is represented as a range."""

    street_suffix: Optional[str] = FieldInfo(alias="streetSuffix", default=None)
    """Street suffix or directional suffix when available."""

    street_type: Optional[str] = FieldInfo(alias="streetType", default=None)
    """Street type in its expanded public form when available."""


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


class Locality(BaseModel):
    """Locality context when available for the enriched address."""

    id: Optional[str] = None
    """Public locality identifier when available."""

    aliases: Optional[List[str]] = None
    """Alternative locality names when available."""

    classification: Optional[str] = None
    """Locality classification label when available."""

    neighbours: Optional[List[str]] = None
    """Neighbouring locality names when available."""


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


class Secondary(BaseModel):
    """Secondary or child address associated with an enriched primary address."""

    id: Optional[str] = None
    """Public identifier for the secondary address record when available."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Display label for the secondary address."""


class Street(BaseModel):
    """Street context when available for the enriched address."""

    id: Optional[str] = None
    """Public street identifier when available."""

    aliases: Optional[List[str]] = None
    """Alternative street names when available."""

    classification: Optional[str] = None
    """Street classification or confirmation label when available."""


class AddressEnrichResponse(BaseModel):
    """
    Enrich-only address document with structured components, extra geocodes, locality and street context, aliases, secondaries, extended boundaries, and optional diagnostic metadata when debug=true.
    """

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

    address_role: Optional[Literal["PRIMARY", "SECONDARY"]] = FieldInfo(alias="addressRole", default=None)
    """Primary or secondary address role when available.

    Primary records are parent or building-level addresses; secondary records are
    child or unit-level addresses.
    """

    aliases: Optional[List[Alias]] = None
    """Alternative address labels associated with the enriched address."""

    all_geocodes: Optional[List[AllGeocode]] = FieldInfo(alias="allGeocodes", default=None)
    """Additional geocodes associated with the address.

    The array preserves source order after invalid coordinates are removed.
    """

    boundaries: Optional[Boundaries] = None
    """Administrative, electoral, and ABS geography returned by Enrich.

    This is a strict superset of the standard address boundary object.
    """

    components: Optional[Components] = None
    """Structured address components when available for the enriched record."""

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

    legal_parcel_id: Optional[str] = FieldInfo(alias="legalParcelId", default=None)
    """Parcel or legal-property reference when available for the address.

    Coverage varies by address and source data.
    """

    locality: Optional[Locality] = None
    """Locality context when available for the enriched address."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Official suburb or locality name associated with the address."""

    location: Optional[Location] = None
    """Compact latitude/longitude point used for proximity workflows and map display."""

    postcode: Optional[str] = None
    """Four-digit Australian postcode.

    Store postcodes as strings; integer coercion can remove leading zeroes used by
    some Australian postcodes.
    """

    secondaries: Optional[List[Secondary]] = None
    """Secondary or child addresses associated with the enriched address."""

    source_data_release: Optional[str] = FieldInfo(alias="sourceDataRelease", default=None)
    """
    Source data release or version used to produce the enriched address record when
    available. This is not the Prontiq API version.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are `NSW` New South Wales, `VIC` Victoria, `QLD` Queensland, `SA`
    South Australia, `WA` Western Australia, `TAS` Tasmania, `NT` Northern
    Territory, and `ACT` Australian Capital Territory.
    """

    street: Optional[Street] = None
    """Street context when available for the enriched address."""
