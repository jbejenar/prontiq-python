# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional

from ..._models import BaseModel

__all__ = ["LookupByPostcodeResponse", "Locality"]


class Locality(BaseModel):
    address_count: int
    """Number of addresses in this locality."""

    name: str
    """Locality/suburb name."""

    state: Optional[str] = None
    """State code."""


class LookupByPostcodeResponse(BaseModel):
    localities: List[Locality]

    postcode: str
    """The queried postcode."""
