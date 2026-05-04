# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional

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
    """Federal electoral district."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class ResultBoundariesGccsa(BaseModel):
    """Greater Capital City Statistical Area."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class ResultBoundariesLga(BaseModel):
    """Local Government Area."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class ResultBoundariesMeshBlock(BaseModel):
    """ABS smallest geographic unit."""

    code: str
    """ABS mesh block code."""

    category: Optional[str] = None
    """Land use category, e.g. Residential, Commercial."""


class ResultBoundariesSa2(BaseModel):
    """Statistical Area Level 2."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class ResultBoundariesSa3(BaseModel):
    """Statistical Area Level 3."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class ResultBoundariesSa4(BaseModel):
    """Statistical Area Level 4."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class ResultBoundariesStateElectorate(BaseModel):
    """State electoral district."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class ResultBoundaries(BaseModel):
    """Electoral, administrative, and statistical boundaries."""

    commonwealth_electorate: Optional[ResultBoundariesCommonwealthElectorate] = FieldInfo(
        alias="commonwealthElectorate", default=None
    )
    """Federal electoral district."""

    gccsa: Optional[ResultBoundariesGccsa] = None
    """Greater Capital City Statistical Area."""

    lga: Optional[ResultBoundariesLga] = None
    """Local Government Area."""

    mesh_block: Optional[ResultBoundariesMeshBlock] = FieldInfo(alias="meshBlock", default=None)
    """ABS smallest geographic unit."""

    sa2: Optional[ResultBoundariesSa2] = None
    """Statistical Area Level 2."""

    sa3: Optional[ResultBoundariesSa3] = None
    """Statistical Area Level 3."""

    sa4: Optional[ResultBoundariesSa4] = None
    """Statistical Area Level 4."""

    state_electorate: Optional[ResultBoundariesStateElectorate] = FieldInfo(alias="stateElectorate", default=None)
    """State electoral district."""


class ResultGeocode(BaseModel):
    """Physical location and geocoding metadata."""

    latitude: float
    """Latitude in decimal degrees."""

    longitude: float
    """Longitude in decimal degrees."""

    reliability: Optional[int] = None
    """G-NAF geocode reliability (0-6, lower is better)."""

    type: Optional[str] = None
    """Geocoding method, e.g. PROPERTY CENTROID."""


class ResultLocation(BaseModel):
    """OpenSearch geo_point format."""

    lat: float
    """Latitude."""

    lon: float
    """Longitude."""


class Result(BaseModel):
    id: str
    """G-NAF persistent identifier."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Street address (number + street name)."""

    boundaries: Optional[ResultBoundaries] = None
    """Electoral, administrative, and statistical boundaries."""

    confidence: Optional[int] = None
    """G-NAF confidence level (0-2)."""

    distance_m: Optional[float] = None
    """Distance from query point in meters."""

    geocode: Optional[ResultGeocode] = None
    """Physical location and geocoding metadata."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    location: Optional[ResultLocation] = None
    """OpenSearch geo_point format."""

    postcode: Optional[str] = None
    """4-digit Australian postcode."""

    state: Optional[str] = None
    """Australian state code (NSW, VIC, QLD, SA, WA, TAS, NT, ACT)."""


class AddressReverseGeocodeResponse(BaseModel):
    results: List[Result]

    total: int
    """Total addresses within radius."""
