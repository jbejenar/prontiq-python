# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = ["AddressAutocompleteResponse", "Suggestion"]


class Suggestion(BaseModel):
    id: str
    """G-NAF persistent identifier."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Street address (number + street name)."""

    confidence: Optional[int] = None
    """G-NAF confidence level (0-2)."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    postcode: Optional[str] = None
    """4-digit Australian postcode."""

    score: Optional[float] = None
    """Search relevance score."""

    state: Optional[str] = None
    """Australian state code."""


class AddressAutocompleteResponse(BaseModel):
    suggestions: List[Suggestion]

    total: int
    """Total matching addresses."""
