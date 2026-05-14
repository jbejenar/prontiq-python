# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

import httpx

from .lookup import (
    LookupResource,
    AsyncLookupResource,
    LookupResourceWithRawResponse,
    AsyncLookupResourceWithRawResponse,
    LookupResourceWithStreamingResponse,
    AsyncLookupResourceWithStreamingResponse,
)
from ...types import (
    address_enrich_params,
    address_validate_params,
    address_autocomplete_params,
    address_reverse_geocode_params,
)
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
from ...types.address_enrich_response import AddressEnrichResponse
from ...types.address_validate_response import AddressValidateResponse
from ...types.address_autocomplete_response import AddressAutocompleteResponse
from ...types.address_reverse_geocode_response import AddressReverseGeocodeResponse

__all__ = ["AddressResource", "AsyncAddressResource"]


class AddressResource(SyncAPIResource):
    """
    Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
    """

    @cached_property
    def lookup(self) -> LookupResource:
        """
        Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
        """
        return LookupResource(self._client)

    @cached_property
    def with_raw_response(self) -> AddressResourceWithRawResponse:
        """
        This property can be used as a prefix for any HTTP method call to return
        the raw response object instead of the parsed content.

        For more information, see https://www.github.com/jbejenar/prontiq-python#accessing-raw-response-data-eg-headers
        """
        return AddressResourceWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AddressResourceWithStreamingResponse:
        """
        An alternative to `.with_raw_response` that doesn't eagerly read the response body.

        For more information, see https://www.github.com/jbejenar/prontiq-python#with_streaming_response
        """
        return AddressResourceWithStreamingResponse(self)

    def autocomplete(
        self,
        *,
        q: str,
        limit: int | Omit = omit,
        state: str | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressAutocompleteResponse:
        """Suggest Australian addresses as a user types.

        Use this endpoint for typeahead UI
        flows, then pass the selected `id` to Enrich when you need the full address
        document. `suggestions[].confidence` is numeric G-NAF source-record metadata;
        autocomplete does not return Validate's top-level match-confidence label.

        Args:
          q: Partial address query.

          limit: Maximum number of suggestions to return.

          state: Australian state or territory filter. Allowed values are NSW, VIC, QLD, SA, WA,
              TAS, NT, and ACT. Input is case-insensitive and responses normalize state codes
              to uppercase.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get(
            "/v1/address/autocomplete",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform(
                    {
                        "q": q,
                        "limit": limit,
                        "state": state,
                    },
                    address_autocomplete_params.AddressAutocompleteParams,
                ),
            ),
            cast_to=AddressAutocompleteResponse,
        )

    def enrich(
        self,
        *,
        id: str,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressEnrichResponse:
        """
        Return the public address document for a known G-NAF address `id` returned by
        Autocomplete, Validate, or Reverse geocode.

        Args:
          id: G-NAF address document ID. Paste an id value returned from Autocomplete or
              Validate.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get(
            "/v1/address/enrich",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform({"id": id}, address_enrich_params.AddressEnrichParams),
            ),
            cast_to=AddressEnrichResponse,
        )

    def reverse_geocode(
        self,
        *,
        lat: float,
        lon: float,
        limit: int | Omit = omit,
        radius: float | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressReverseGeocodeResponse:
        """Find addresses near a latitude and longitude.

        Results are ordered by distance
        and include `distance_m` in meters.

        Args:
          lat: Latitude in decimal degrees.

          lon: Longitude in decimal degrees.

          limit: Maximum number of nearby addresses to return.

          radius: Search radius in metres.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get(
            "/v1/address/reverse",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform(
                    {
                        "lat": lat,
                        "lon": lon,
                        "limit": limit,
                        "radius": radius,
                    },
                    address_reverse_geocode_params.AddressReverseGeocodeParams,
                ),
            ),
            cast_to=AddressReverseGeocodeResponse,
        )

    def validate(
        self,
        *,
        q: str,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressValidateResponse:
        """
        Find the best G-NAF match for a submitted address string and classify the match
        quality. The top-level `confidence` field is a string match-quality label for
        the submitted query. If `match` is present, `match.confidence` is separate
        numeric G-NAF source-record metadata for the address record. A `high` top-level
        confidence result is suitable for accepting or pre-filling an address; lower
        confidence results should be confirmed by the user.

        Args:
          q: Full address string to validate.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return self._get(
            "/v1/address/validate",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=maybe_transform({"q": q}, address_validate_params.AddressValidateParams),
            ),
            cast_to=AddressValidateResponse,
        )


class AsyncAddressResource(AsyncAPIResource):
    """
    Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
    """

    @cached_property
    def lookup(self) -> AsyncLookupResource:
        """
        Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
        """
        return AsyncLookupResource(self._client)

    @cached_property
    def with_raw_response(self) -> AsyncAddressResourceWithRawResponse:
        """
        This property can be used as a prefix for any HTTP method call to return
        the raw response object instead of the parsed content.

        For more information, see https://www.github.com/jbejenar/prontiq-python#accessing-raw-response-data-eg-headers
        """
        return AsyncAddressResourceWithRawResponse(self)

    @cached_property
    def with_streaming_response(self) -> AsyncAddressResourceWithStreamingResponse:
        """
        An alternative to `.with_raw_response` that doesn't eagerly read the response body.

        For more information, see https://www.github.com/jbejenar/prontiq-python#with_streaming_response
        """
        return AsyncAddressResourceWithStreamingResponse(self)

    async def autocomplete(
        self,
        *,
        q: str,
        limit: int | Omit = omit,
        state: str | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressAutocompleteResponse:
        """Suggest Australian addresses as a user types.

        Use this endpoint for typeahead UI
        flows, then pass the selected `id` to Enrich when you need the full address
        document. `suggestions[].confidence` is numeric G-NAF source-record metadata;
        autocomplete does not return Validate's top-level match-confidence label.

        Args:
          q: Partial address query.

          limit: Maximum number of suggestions to return.

          state: Australian state or territory filter. Allowed values are NSW, VIC, QLD, SA, WA,
              TAS, NT, and ACT. Input is case-insensitive and responses normalize state codes
              to uppercase.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return await self._get(
            "/v1/address/autocomplete",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=await async_maybe_transform(
                    {
                        "q": q,
                        "limit": limit,
                        "state": state,
                    },
                    address_autocomplete_params.AddressAutocompleteParams,
                ),
            ),
            cast_to=AddressAutocompleteResponse,
        )

    async def enrich(
        self,
        *,
        id: str,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressEnrichResponse:
        """
        Return the public address document for a known G-NAF address `id` returned by
        Autocomplete, Validate, or Reverse geocode.

        Args:
          id: G-NAF address document ID. Paste an id value returned from Autocomplete or
              Validate.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return await self._get(
            "/v1/address/enrich",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=await async_maybe_transform({"id": id}, address_enrich_params.AddressEnrichParams),
            ),
            cast_to=AddressEnrichResponse,
        )

    async def reverse_geocode(
        self,
        *,
        lat: float,
        lon: float,
        limit: int | Omit = omit,
        radius: float | Omit = omit,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressReverseGeocodeResponse:
        """Find addresses near a latitude and longitude.

        Results are ordered by distance
        and include `distance_m` in meters.

        Args:
          lat: Latitude in decimal degrees.

          lon: Longitude in decimal degrees.

          limit: Maximum number of nearby addresses to return.

          radius: Search radius in metres.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return await self._get(
            "/v1/address/reverse",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=await async_maybe_transform(
                    {
                        "lat": lat,
                        "lon": lon,
                        "limit": limit,
                        "radius": radius,
                    },
                    address_reverse_geocode_params.AddressReverseGeocodeParams,
                ),
            ),
            cast_to=AddressReverseGeocodeResponse,
        )

    async def validate(
        self,
        *,
        q: str,
        # Use the following arguments if you need to pass additional parameters to the API that aren't available via kwargs.
        # The extra values given here take precedence over values defined on the client or passed to this method.
        extra_headers: Headers | None = None,
        extra_query: Query | None = None,
        extra_body: Body | None = None,
        timeout: float | httpx.Timeout | None | NotGiven = not_given,
    ) -> AddressValidateResponse:
        """
        Find the best G-NAF match for a submitted address string and classify the match
        quality. The top-level `confidence` field is a string match-quality label for
        the submitted query. If `match` is present, `match.confidence` is separate
        numeric G-NAF source-record metadata for the address record. A `high` top-level
        confidence result is suitable for accepting or pre-filling an address; lower
        confidence results should be confirmed by the user.

        Args:
          q: Full address string to validate.

          extra_headers: Send extra headers

          extra_query: Add additional query parameters to the request

          extra_body: Add additional JSON properties to the request

          timeout: Override the client-level default timeout for this request, in seconds
        """
        return await self._get(
            "/v1/address/validate",
            options=make_request_options(
                extra_headers=extra_headers,
                extra_query=extra_query,
                extra_body=extra_body,
                timeout=timeout,
                query=await async_maybe_transform({"q": q}, address_validate_params.AddressValidateParams),
            ),
            cast_to=AddressValidateResponse,
        )


class AddressResourceWithRawResponse:
    def __init__(self, address: AddressResource) -> None:
        self._address = address

        self.autocomplete = to_raw_response_wrapper(
            address.autocomplete,
        )
        self.enrich = to_raw_response_wrapper(
            address.enrich,
        )
        self.reverse_geocode = to_raw_response_wrapper(
            address.reverse_geocode,
        )
        self.validate = to_raw_response_wrapper(
            address.validate,
        )

    @cached_property
    def lookup(self) -> LookupResourceWithRawResponse:
        """
        Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
        """
        return LookupResourceWithRawResponse(self._address.lookup)


class AsyncAddressResourceWithRawResponse:
    def __init__(self, address: AsyncAddressResource) -> None:
        self._address = address

        self.autocomplete = async_to_raw_response_wrapper(
            address.autocomplete,
        )
        self.enrich = async_to_raw_response_wrapper(
            address.enrich,
        )
        self.reverse_geocode = async_to_raw_response_wrapper(
            address.reverse_geocode,
        )
        self.validate = async_to_raw_response_wrapper(
            address.validate,
        )

    @cached_property
    def lookup(self) -> AsyncLookupResourceWithRawResponse:
        """
        Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
        """
        return AsyncLookupResourceWithRawResponse(self._address.lookup)


class AddressResourceWithStreamingResponse:
    def __init__(self, address: AddressResource) -> None:
        self._address = address

        self.autocomplete = to_streamed_response_wrapper(
            address.autocomplete,
        )
        self.enrich = to_streamed_response_wrapper(
            address.enrich,
        )
        self.reverse_geocode = to_streamed_response_wrapper(
            address.reverse_geocode,
        )
        self.validate = to_streamed_response_wrapper(
            address.validate,
        )

    @cached_property
    def lookup(self) -> LookupResourceWithStreamingResponse:
        """
        Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
        """
        return LookupResourceWithStreamingResponse(self._address.lookup)


class AsyncAddressResourceWithStreamingResponse:
    def __init__(self, address: AsyncAddressResource) -> None:
        self._address = address

        self.autocomplete = async_to_streamed_response_wrapper(
            address.autocomplete,
        )
        self.enrich = async_to_streamed_response_wrapper(
            address.enrich,
        )
        self.reverse_geocode = async_to_streamed_response_wrapper(
            address.reverse_geocode,
        )
        self.validate = async_to_streamed_response_wrapper(
            address.validate,
        )

    @cached_property
    def lookup(self) -> AsyncLookupResourceWithStreamingResponse:
        """
        Australian address autocomplete, validation, enrichment, reverse geocoding, postcode lookup, and suburb lookup.
        """
        return AsyncLookupResourceWithStreamingResponse(self._address.lookup)
