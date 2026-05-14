# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional
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
]


class ResultBoundariesCommonwealthElectorate(BaseModel):
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


class ResultBoundariesGccsa(BaseModel):
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


class ResultBoundariesLga(BaseModel):
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


class ResultBoundariesMeshBlock(BaseModel):
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


class ResultBoundariesSa2(BaseModel):
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


class ResultBoundariesSa3(BaseModel):
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


class ResultBoundariesSa4(BaseModel):
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


class ResultBoundariesStateElectorate(BaseModel):
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


class ResultBoundaries(BaseModel):
    """
    Administrative, electoral, and ABS statistical geography linked to the address when supplied by G-NAF and ABS source data.
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
    """Decimal degree coordinate."""

    longitude: float
    """Decimal degree coordinate."""

    reliability: Optional[int] = None
    """
    G-NAF geocode reliability code from 0 to 6, where lower values are more precise.
    """

    type: Optional[str] = None
    """G-NAF geocoding method, for example PROPERTY CENTROID."""


class ResultLocation(BaseModel):
    """Compact latitude/longitude point used for proximity queries and map display."""

    lat: float
    """Decimal degree coordinate."""

    lon: float
    """Decimal degree coordinate."""


class Result(BaseModel):
    """Address document plus distance from the reverse-geocode query point."""

    id: str
    """Opaque G-NAF persistent identifier for this address record."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Formatted street address, typically street number plus street name."""

    boundaries: Optional[ResultBoundaries] = None
    """
    Administrative, electoral, and ABS statistical geography linked to the address
    when supplied by G-NAF and ABS source data.
    """

    confidence: Optional[int] = None
    """G-NAF source-record confidence code from 0 to 2.

    This is source metadata, not validate match confidence.
    """

    distance_m: Optional[float] = None
    """Distance from query point in meters."""

    geocode: Optional[ResultGeocode] = None
    """G-NAF geocoding metadata and decimal-degree coordinates for the address."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    location: Optional[ResultLocation] = None
    """Compact latitude/longitude point used for proximity queries and map display."""

    postcode: Optional[str] = None
    """Four-digit Australian postcode.

    Postcodes are strings so leading zeroes are preserved.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT.
    """


class AddressReverseGeocodeResponse(BaseModel):
    """Addresses nearest to the supplied latitude and longitude."""

    results: List[Result]

    total: int
    """Total addresses within radius."""
