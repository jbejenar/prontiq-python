# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import Optional

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
    "Geocode",
    "Location",
]


class BoundariesCommonwealthElectorate(BaseModel):
    """Federal electoral district."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class BoundariesGccsa(BaseModel):
    """Greater Capital City Statistical Area."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class BoundariesLga(BaseModel):
    """Local Government Area."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class BoundariesMeshBlock(BaseModel):
    """ABS smallest geographic unit."""

    code: str
    """ABS mesh block code."""

    category: Optional[str] = None
    """Land use category, e.g. Residential, Commercial."""


class BoundariesSa2(BaseModel):
    """Statistical Area Level 2."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class BoundariesSa3(BaseModel):
    """Statistical Area Level 3."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class BoundariesSa4(BaseModel):
    """Statistical Area Level 4."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class BoundariesStateElectorate(BaseModel):
    """State electoral district."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class Boundaries(BaseModel):
    """Electoral, administrative, and statistical boundaries."""

    commonwealth_electorate: Optional[BoundariesCommonwealthElectorate] = FieldInfo(
        alias="commonwealthElectorate", default=None
    )
    """Federal electoral district."""

    gccsa: Optional[BoundariesGccsa] = None
    """Greater Capital City Statistical Area."""

    lga: Optional[BoundariesLga] = None
    """Local Government Area."""

    mesh_block: Optional[BoundariesMeshBlock] = FieldInfo(alias="meshBlock", default=None)
    """ABS smallest geographic unit."""

    sa2: Optional[BoundariesSa2] = None
    """Statistical Area Level 2."""

    sa3: Optional[BoundariesSa3] = None
    """Statistical Area Level 3."""

    sa4: Optional[BoundariesSa4] = None
    """Statistical Area Level 4."""

    state_electorate: Optional[BoundariesStateElectorate] = FieldInfo(alias="stateElectorate", default=None)
    """State electoral district."""


class Geocode(BaseModel):
    """Physical location and geocoding metadata."""

    latitude: float
    """Latitude in decimal degrees."""

    longitude: float
    """Longitude in decimal degrees."""

    reliability: Optional[int] = None
    """G-NAF geocode reliability (0-6, lower is better)."""

    type: Optional[str] = None
    """Geocoding method, e.g. PROPERTY CENTROID."""


class Location(BaseModel):
    """OpenSearch geo_point format."""

    lat: float
    """Latitude."""

    lon: float
    """Longitude."""


class AddressEnrichResponse(BaseModel):
    id: str
    """G-NAF persistent identifier."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Street address (number + street name)."""

    boundaries: Optional[Boundaries] = None
    """Electoral, administrative, and statistical boundaries."""

    confidence: Optional[int] = None
    """G-NAF confidence level (0-2)."""

    geocode: Optional[Geocode] = None
    """Physical location and geocoding metadata."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    location: Optional[Location] = None
    """OpenSearch geo_point format."""

    postcode: Optional[str] = None
    """4-digit Australian postcode."""

    state: Optional[str] = None
    """Australian state code (NSW, VIC, QLD, SA, WA, TAS, NT, ACT)."""
