# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional
from typing_extensions import Literal

from ..._models import BaseModel

__all__ = ["LookupByPostcodeResponse", "Locality"]


class Locality(BaseModel):
    """Locality summary returned for a postcode lookup."""

    address_count: int
    """Number of addresses in this locality."""

    name: str
    """Locality/suburb name."""

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT.
    """


class LookupByPostcodeResponse(BaseModel):
    """Localities and address counts for an Australian postcode."""

    localities: List[Locality]

    postcode: str
    """Four-digit Australian postcode.

    Postcodes are strings so leading zeroes are preserved.
    """
