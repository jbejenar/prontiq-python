# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Literal, Required, TypedDict

__all__ = ["AddressValidateParams"]


class AddressValidateParams(TypedDict, total=False):
    q: Required[str]
    """Free-text address to validate against G-NAF.

    Include suburb, state, and postcode when available for the strongest match
    signal.
    """

    debug: Literal["true", "false"]
    """Optional diagnostic flag.

    Send exactly `true` or `false`. Invalid values are rejected; debug diagnostics
    are for support only and must not be used for business decisions.
    """
