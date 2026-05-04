# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Required, TypedDict

__all__ = ["LookupByPostcodeParams"]


class LookupByPostcodeParams(TypedDict, total=False):
    postcode: Required[str]
    """Australian 4-digit postcode."""

    limit: int
    """Maximum number of localities to return."""
