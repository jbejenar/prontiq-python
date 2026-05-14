# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Required, TypedDict

__all__ = ["AddressAutocompleteParams"]


class AddressAutocompleteParams(TypedDict, total=False):
    q: Required[str]
    """Partial address query."""

    limit: int
    """Maximum number of suggestions to return."""

    state: str
    """Australian state or territory filter.

    Allowed values are NSW, VIC, QLD, SA, WA, TAS, NT, and ACT. Input is
    case-insensitive and responses normalize state codes to uppercase.
    """
