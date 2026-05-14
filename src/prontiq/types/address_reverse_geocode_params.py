# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Literal, Required, TypedDict

__all__ = ["AddressReverseGeocodeParams"]


class AddressReverseGeocodeParams(TypedDict, total=False):
    lat: Required[float]
    """Latitude in decimal degrees."""

    lon: Required[float]
    """Longitude in decimal degrees."""

    debug: Literal["true", "false"]
    """Optional diagnostic flag.

    Send exactly `true` or `false`. Invalid values are rejected; debug diagnostics
    are for support only and must not be used for business decisions.
    """

    limit: int
    """Maximum number of nearby addresses to return."""

    radius: float
    """Search radius in metres."""
