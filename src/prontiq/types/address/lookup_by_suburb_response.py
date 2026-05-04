# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional

from ..._models import BaseModel

__all__ = ["LookupBySuburbResponse", "Bounds", "BoundsBottomRight", "BoundsTopLeft"]


class BoundsBottomRight(BaseModel):
    """South-east corner of bounding box."""

    lat: float
    """Latitude."""

    lon: float
    """Longitude."""


class BoundsTopLeft(BaseModel):
    """North-west corner of bounding box."""

    lat: float
    """Latitude."""

    lon: float
    """Longitude."""


class Bounds(BaseModel):
    """Geographic bounding box of the suburb."""

    bottom_right: BoundsBottomRight
    """South-east corner of bounding box."""

    top_left: BoundsTopLeft
    """North-west corner of bounding box."""


class LookupBySuburbResponse(BaseModel):
    address_count: int
    """Total addresses in this suburb."""

    postcodes: List[str]
    """Postcodes covering this suburb."""

    suburb: str
    """Normalised suburb name (uppercase)."""

    bounds: Optional[Bounds] = None
    """Geographic bounding box of the suburb."""

    state: Optional[str] = None
    """State filter applied, if any."""
