# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

from typing_extensions import Literal

import httpx

from ..._types import Body, Omit, Query, Headers, NotGiven, omit, not_given
from ..._utils import maybe_transform, async_maybe_transform
from ..._compat import cached_property
from ..._resource import SyncAPIResource, AsyncAPIResource
from ..._response import (
    to_raw_response_wrapper,
    to_streamed_response_wrapper,
    async_to_raw_response_wrapper,
    async_to_streamed_response_wrapper,
)
from ..._base_client import make_request_options
from ...types.address import lookup_by_suburb_params, lookup_by_postcode_params
from ...types.address.lookup_by_suburb_response import LookupBySuburbResponse
from ...types.address.lookup_by_postcode_response import LookupByPostcodeResponse

__all__ = ["LookupResource", "AsyncLookupResource"]


class LookupResource(SyncAPIResource):
    """
    Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
    """

    @cached_property
    def with_raw_response(self) -> LookupResourceWithRawResponse:
        """
        This property can be used as a prefix for any HTTP method call to return
        the raw response object instead of the parsed content.

        For more information, see https://www.github.com/jbejenar/prontiq-python#accessing-raw-response-data-eg-headers
        """
        return LookupResourceWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> LookupResourceWithStreamingResponse:
        """
        An alternative to `.with_raw_response` that doesn't eagerly read the response body.

        For more information, see https://www.github.com/jbejenar/prontiq-python#with_streaming_response
        """
        return LookupResourceWithStreamingResponse(self)

    def by_postcode(
        self,
        *,
        postcode: str,
        debug: Literal["true", "false"] | Omit = omit,
        limit: int | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> LookupByPostcodeResponse:
        """
        List suburbs or localities that have address records in a four-digit Australian
        postcode, including address counts per locality.

        Args:
          postcode: Australian 4-digit postcode.

          debug: Optional diagnostic flag. Send exactly `true` or `false`. Invalid values are
              rejected; debug diagnostics are for support only and must not be used for
              business decisions.

          limit: Maximum number of localities to return.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get(
            "/v1/address/lookup/postcode",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform(
                    {
                        "postcode": postcode,
                        "debug": debug,
                        "limit": limit,
                    },
                    lookup_by_postcode_params.LookupByPostcodeParams,
                ),
            ),
            cast_to=LookupByPostcodeResponse,
        )

    def by_suburb(
        self,
        *,
        suburb: str,
        debug: Literal["true", "false"] | Omit = omit,
        limit: int | Omit = omit,
        state: str | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> LookupBySuburbResponse:
        """Find postcodes for an Australian suburb or locality.

        Add `state` to disambiguate
        common locality names that exist in multiple states.

        Args:
          suburb: Suburb/locality name.

          debug: Optional diagnostic flag. Send exactly `true` or `false`. Invalid values are
              rejected; debug diagnostics are for support only and must not be used for
              business decisions.

          limit: Maximum number of postcodes to return.

          state: Australian state or territory filter. Allowed values are NSW, VIC, QLD, SA, WA,
              TAS, NT, and ACT. Input is case-insensitive and responses normalize state codes
              to uppercase.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get(
            "/v1/address/lookup/suburb",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform(
                    {
                        "suburb": suburb,
                        "debug": debug,
                        "limit": limit,
                        "state": state,
                    },
                    lookup_by_suburb_params.LookupBySuburbParams,
                ),
            ),
            cast_to=LookupBySuburbResponse,
        )


class AsyncLookupResource(AsyncAPIResource):
    """
    Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
    """

    @cached_property
    def with_raw_response(self) -> AsyncLookupResourceWithRawResponse:
        """
        This property can be used as a prefix for any HTTP method call to return
        the raw response object instead of the parsed content.

        For more information, see https://www.github.com/jbejenar/prontiq-python#accessing-raw-response-data-eg-headers
        """
        return AsyncLookupResourceWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AsyncLookupResourceWithStreamingResponse:
        """
        An alternative to `.with_raw_response` that doesn't eagerly read the response body.

        For more information, see https://www.github.com/jbejenar/prontiq-python#with_streaming_response
        """
        return AsyncLookupResourceWithStreamingResponse(self)

    async def by_postcode(
        self,
        *,
        postcode: str,
        debug: Literal["true", "false"] | Omit = omit,
        limit: int | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> LookupByPostcodeResponse:
        """
        List suburbs or localities that have address records in a four-digit Australian
        postcode, including address counts per locality.

        Args:
          postcode: Australian 4-digit postcode.

          debug: Optional diagnostic flag. Send exactly `true` or `false`. Invalid values are
              rejected; debug diagnostics are for support only and must not be used for
              business decisions.

          limit: Maximum number of localities to return.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return await self._get(
            "/v1/address/lookup/postcode",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=await async_maybe_transform(
                    {
                        "postcode": postcode,
                        "debug": debug,
                        "limit": limit,
                    },
                    lookup_by_postcode_params.LookupByPostcodeParams,
                ),
            ),
            cast_to=LookupByPostcodeResponse,
        )

    async def by_suburb(
        self,
        *,
        suburb: str,
        debug: Literal["true", "false"] | Omit = omit,
        limit: int | Omit = omit,
        state: str | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> LookupBySuburbResponse:
        """Find postcodes for an Australian suburb or locality.

        Add `state` to disambiguate
        common locality names that exist in multiple states.

        Args:
          suburb: Suburb/locality name.

          debug: Optional diagnostic flag. Send exactly `true` or `false`. Invalid values are
              rejected; debug diagnostics are for support only and must not be used for
              business decisions.

          limit: Maximum number of postcodes to return.

          state: Australian state or territory filter. Allowed values are NSW, VIC, QLD, SA, WA,
              TAS, NT, and ACT. Input is case-insensitive and responses normalize state codes
              to uppercase.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return await self._get(
            "/v1/address/lookup/suburb",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=await async_maybe_transform(
                    {
                        "suburb": suburb,
                        "debug": debug,
                        "limit": limit,
                        "state": state,
                    },
                    lookup_by_suburb_params.LookupBySuburbParams,
                ),
            ),
            cast_to=LookupBySuburbResponse,
        )


class LookupResourceWithRawResponse:
    def __init__(self, lookup: LookupResource) -> None:
        self._lookup = lookup

        self.by_postcode = to_raw_response_wrapper(
            lookup.by_postcode,
        )
        self.by_suburb = to_raw_response_wrapper(
            lookup.by_suburb,
        )


class AsyncLookupResourceWithRawResponse:
    def __init__(self, lookup: AsyncLookupResource) -> None:
        self._lookup = lookup

        self.by_postcode = async_to_raw_response_wrapper(
            lookup.by_postcode,
        )
        self.by_suburb = async_to_raw_response_wrapper(
            lookup.by_suburb,
        )


class LookupResourceWithStreamingResponse:
    def __init__(self, lookup: LookupResource) -> None:
        self._lookup = lookup

        self.by_postcode = to_streamed_response_wrapper(
            lookup.by_postcode,
        )
        self.by_suburb = to_streamed_response_wrapper(
            lookup.by_suburb,
        )


class AsyncLookupResourceWithStreamingResponse:
    def __init__(self, lookup: AsyncLookupResource) -> None:
        self._lookup = lookup

        self.by_postcode = async_to_streamed_response_wrapper(
            lookup.by_postcode,
        )
        self.by_suburb = async_to_streamed_response_wrapper(
            lookup.by_suburb,
        )
