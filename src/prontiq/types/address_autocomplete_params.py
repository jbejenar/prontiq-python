# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Literal, Required, TypedDict

__all__ = ["AddressAutocompleteParams"]


class AddressAutocompleteParams(TypedDict, total=False):
    q: Required[str]
    """Partial address text typed by the user.

    Send 1-200 characters; omit coordinates and use `state` when you already know
    the state.
    """

    debug: Literal["true", "false"]
    """Optional diagnostic flag.

    Send exactly `true` or `false`. Invalid values are rejected; debug diagnostics
    are for support only and must not be used for business decisions.
    """

    limit: int
    """Maximum number of suggestions to return."""

    state: str
    """Australian state or territory filter.

    Allowed values are `NSW`, `VIC`, `QLD`, `SA`, `WA`, `TAS`, `NT`, and `ACT`.
    Input is case-insensitive and responses normalize state codes to uppercase.
    """
