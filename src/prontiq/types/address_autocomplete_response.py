# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from typing import List, Optional
from typing_extensions import Literal

from pydantic import Field as FieldInfo

from .._models import BaseModel

__all__ = ["AddressAutocompleteResponse", "Suggestion"]


class Suggestion(BaseModel):
    """
    Autocomplete suggestion containing the fields needed to display and select an address.
    """

    id: str
    """Opaque G-NAF persistent identifier for this address record."""

    address_label: Optional[str] = FieldInfo(alias="addressLabel", default=None)
    """Formatted street address."""

    confidence: Optional[int] = None
    """G-NAF source-record confidence code from 0 to 2."""

    locality_name: Optional[str] = FieldInfo(alias="localityName", default=None)
    """Suburb or locality name."""

    postcode: Optional[str] = None
    """Four-digit Australian postcode.

    Postcodes are strings so leading zeroes are preserved.
    """

    score: Optional[float] = None
    """Search relevance score.

    Use it for display diagnostics only, not persisted business logic.
    """

    state: Optional[Literal["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]] = None
    """Uppercase Australian state or territory code returned by the Address API.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT.
    """


class AddressAutocompleteResponse(BaseModel):
    """Autocomplete suggestions for a partial address query."""

    suggestions: List[Suggestion]

    total: int
    """Total matching addresses."""
