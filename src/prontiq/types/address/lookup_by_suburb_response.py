# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional
from typing_extensions import Literal

from ..._models import BaseModel

__all__ = ["LookupBySuburbResponse", "Bounds", "BoundsBottomRight", "BoundsTopLeft"]


class BoundsBottomRight(BaseModel):
    """Compact latitude/longitude point used for proximity queries and map display."""

    lat: float
    """Decimal degree coordinate."""

    lon: float
    """Decimal degree coordinate."""


class BoundsTopLeft(BaseModel):
    """Compact latitude/longitude point used for proximity queries and map display."""

    lat: float
    """Decimal degree coordinate."""

    lon: float
    """Decimal degree coordinate."""


class Bounds(BaseModel):
    """Geographic bounding box of the suburb."""

    bottom_right: BoundsBottomRight
    """Compact latitude/longitude point used for proximity queries and map display."""

    top_left: BoundsTopLeft
    """Compact latitude/longitude point used for proximity queries and map display."""


class LookupBySuburbResponse(BaseModel):
    """Postcodes, bounds, and address count for a suburb or locality."""

    address_count: int
    """Total addresses in this suburb."""

    postcodes: List[str]
    """Postcodes covering this suburb."""

    suburb: str
    """Normalised suburb name (uppercase)."""

    bounds: Optional[Bounds] = None
    """Geographic bounding box of the suburb."""

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT.
    """
