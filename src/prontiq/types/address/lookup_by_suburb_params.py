# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Required, TypedDict

__all__ = ["LookupBySuburbParams"]


class LookupBySuburbParams(TypedDict, total=False):
    suburb: Required[str]
    """Suburb/locality name."""

    limit: int
    """Maximum number of postcodes to return."""

    state: str
    """Australian state code."""
