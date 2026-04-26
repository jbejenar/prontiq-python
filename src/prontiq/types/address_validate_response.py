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
    """Federal electoral district."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class MatchBoundariesGccsa(BaseModel):
    """Greater Capital City Statistical Area."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class MatchBoundariesLga(BaseModel):
    """Local Government Area."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class MatchBoundariesMeshBlock(BaseModel):
    """ABS smallest geographic unit."""

    code: str
    """ABS mesh block code."""

    category: Optional[str] = None
    """Land use category, e.g. Residential, Commercial."""


class MatchBoundariesSa2(BaseModel):
    """Statistical Area Level 2."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class MatchBoundariesSa3(BaseModel):
    """Statistical Area Level 3."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class MatchBoundariesSa4(BaseModel):
    """Statistical Area Level 4."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class MatchBoundariesStateElectorate(BaseModel):
    """State electoral district."""

    name: str
    """Area name."""

    code: Optional[str] = None
    """ABS area code."""


class MatchBoundaries(BaseModel):
    """Electoral, administrative, and statistical boundaries."""

    commonwealth_electorate: Optional[MatchBoundariesCommonwealthElectorate] = FieldInfo(
        alias="commonwealthElectorate", default=None
    )
    """Federal electoral district."""

    gccsa: Optional[MatchBoundariesGccsa] = None
    """Greater Capital City Statistical Area."""

    lga: Optional[MatchBoundariesLga] = None
    """Local Government Area."""

    mesh_block: Optional[MatchBoundariesMeshBlock] = FieldInfo(alias="meshBlock", default=None)
    """ABS smallest geographic unit."""

    sa2: Optional[MatchBoundariesSa2] = None
    """Statistical Area Level 2."""

    sa3: Optional[MatchBoundariesSa3] = None
    """Statistical Area Level 3."""

    sa4: Optional[MatchBoundariesSa4] = None
    """Statistical Area Level 4."""

    state_electorate: Optional[MatchBoundariesStateElectorate] = FieldInfo(alias="stateElectorate", default=None)
    """State electoral district."""


class MatchGeocode(BaseModel):
    """Physical location and geocoding metadata."""

    latitude: float
    """Latitude in decimal degrees."""

    longitude: float
    """Longitude in decimal degrees."""

    reliability: Optional[int] = None
    """G-NAF geocode reliability (0-6, lower is better)."""

    type: Optional[str] = None
    """Geocoding method, e.g. PROPERTY CENTROID."""


class MatchLocation(BaseModel):
    """OpenSearch geo_point format."""

    lat: float
    """Latitude."""

    lon: float
    """Longitude."""


class Match(BaseModel):
    """Best matching address, or null if no match."""

    id: str
    """G-NAF persistent identifier."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Street address (number + street name)."""

    boundaries: Optional[MatchBoundaries] = None
    """Electoral, administrative, and statistical boundaries."""

    confidence: Optional[int] = None
    """G-NAF confidence level (0-2)."""

    geocode: Optional[MatchGeocode] = None
    """Physical location and geocoding metadata."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    location: Optional[MatchLocation] = None
    """OpenSearch geo_point format."""

    postcode: Optional[str] = None
    """4-digit Australian postcode."""

    state: Optional[str] = None
    """Australian state code (NSW, VIC, QLD, SA, WA, TAS, NT, ACT)."""


class AddressValidateResponse(BaseModel):
    confidence: Literal["high", "medium", "low", "none"]
    """
    Match confidence: high (score > 20), medium (10-20), low (< 10), or none (no
    match).
    """

    match: Optional[Match] = None
    """Best matching address, or null if no match."""
