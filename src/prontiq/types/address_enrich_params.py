# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Required, TypedDict

__all__ = ["AddressEnrichParams"]


class AddressEnrichParams(TypedDict, total=False):
    id: Required[str]
    """G-NAF address document ID.

    Paste an id value returned from Autocomplete or Validate.
    """
