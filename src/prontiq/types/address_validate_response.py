# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = [
    "AddressValidateResponse",
    "Match",
    "MatchBoundaries",
    "MatchBoundariesCommonwealthElectorate",
    "MatchBoundariesGccsa",
    "MatchBoundariesLga",
    "MatchBoundariesMeshBlock",
    "MatchBoundariesSa2",
    "MatchBoundariesSa3",
    "MatchBoundariesSa4",
    "MatchBoundariesStateElectorate",
    "MatchGeocode",
    "MatchLocation",
]


class MatchBoundariesCommonwealthElectorate(BaseModel):
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


class MatchBoundariesGccsa(BaseModel):
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


class MatchBoundariesLga(BaseModel):
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


class MatchBoundariesMeshBlock(BaseModel):
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


class MatchBoundariesSa2(BaseModel):
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


class MatchBoundariesSa3(BaseModel):
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


class MatchBoundariesSa4(BaseModel):
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


class MatchBoundariesStateElectorate(BaseModel):
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


class MatchBoundaries(BaseModel):
    """
    Administrative, electoral, and ABS statistical geography linked to the address when supplied by G-NAF and ABS source data.
    """

    commonwealth_electorate: Optional[MatchBoundariesCommonwealthElectorate] = FieldInfo(
        alias="commonwealthElectorate", default=None
    )
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    gccsa: Optional[MatchBoundariesGccsa] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    lga: Optional[MatchBoundariesLga] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    mesh_block: Optional[MatchBoundariesMeshBlock] = FieldInfo(alias="meshBlock", default=None)
    """
    ABS Mesh Block identifier and optional land-use category for the address
    location.
    """

    sa2: Optional[MatchBoundariesSa2] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    sa3: Optional[MatchBoundariesSa3] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    sa4: Optional[MatchBoundariesSa4] = None
    """
    Named administrative, electoral, or statistical area associated with an address.
    """

    state_electorate: Optional[MatchBoundariesStateElectorate] = FieldInfo(alias="stateElectorate", default=None)
    """
    Named administrative, electoral, or statistical area associated with an address.
    """


class MatchGeocode(BaseModel):
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


class MatchLocation(BaseModel):
    """Compact latitude/longitude point used for proximity queries and map display."""

    lat: float
    """Decimal degree coordinate."""

    lon: float
    """Decimal degree coordinate."""


class Match(BaseModel):
    """
    Public address record returned by validate, enrich, and reverse geocode operations.
    """

    id: str
    """Opaque G-NAF persistent identifier for this address record."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Formatted street address, typically street number plus street name."""

    boundaries: Optional[MatchBoundaries] = None
    """
    Administrative, electoral, and ABS statistical geography linked to the address
    when supplied by G-NAF and ABS source data.
    """

    confidence: Optional[int] = None
    """G-NAF source-record confidence code from 0 to 2.

    This is source metadata, not validate match confidence.
    """

    geocode: Optional[MatchGeocode] = None
    """G-NAF geocoding metadata and decimal-degree coordinates for the address."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    location: Optional[MatchLocation] = None
    """Compact latitude/longitude point used for proximity queries and map display."""

    postcode: Optional[str] = None
    """Four-digit Australian postcode.

    Postcodes are strings so leading zeroes are preserved.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT.
    """


class AddressValidateResponse(BaseModel):
    """
    Best address match and match-confidence classification for a submitted address string.
    """

    confidence: Literal["high", "medium", "low", "none"]
    """
    Match confidence: high (score > 20), medium (10-20), low (< 10), or none (no
    match).
    """

    match: Optional[Match] = None
    """
    Public address record returned by validate, enrich, and reverse geocode
    operations.
    """
