# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

import os
from typing import Any, cast

import pytest

from prontiq import Prontiq, AsyncProntiq
from tests.utils import assert_matches_type
from prontiq.types import (
    AddressEnrichResponse,
    AddressValidateResponse,
    AddressAutocompleteResponse,
    AddressReverseGeocodeResponse,
)

base_url = os.environ.get("TEST_API_BASE_URL", "http://127.0.0.1:4010")


class TestAddress:
    parametrize = pytest.mark.parametrize("client", [False, True], indirect=True, ids=["loose", "strict"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_autocomplete(self, client: Prontiq) -> None:
        address = client.address.autocomplete(
            q="9 endeavour cou",
        )
        assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_autocomplete_with_all_params(self, client: Prontiq) -> None:
        address = client.address.autocomplete(
            q="9 endeavour cou",
            debug="false",
            limit=3,
            state="NSW",
        )
        assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_raw_response_autocomplete(self, client: Prontiq) -> None:
        response = client.address.with_raw_response.autocomplete(
            q="9 endeavour cou",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = response.parse()
        assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_streaming_response_autocomplete(self, client: Prontiq) -> None:
        with client.address.with_streaming_response.autocomplete(
            q="9 endeavour cou",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = response.parse()
            assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_enrich(self, client: Prontiq) -> None:
        address = client.address.enrich(
            id="F_GAVIC999000002",
        )
        assert_matches_type(AddressEnrichResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_enrich_with_all_params(self, client: Prontiq) -> None:
        address = client.address.enrich(
            id="F_GAVIC999000002",
            debug="false",
        )
        assert_matches_type(AddressEnrichResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_raw_response_enrich(self, client: Prontiq) -> None:
        response = client.address.with_raw_response.enrich(
            id="F_GAVIC999000002",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = response.parse()
        assert_matches_type(AddressEnrichResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_streaming_response_enrich(self, client: Prontiq) -> None:
        with client.address.with_streaming_response.enrich(
            id="F_GAVIC999000002",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = response.parse()
            assert_matches_type(AddressEnrichResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_reverse_geocode(self, client: Prontiq) -> None:
        address = client.address.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
        )
        assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_reverse_geocode_with_all_params(self, client: Prontiq) -> None:
        address = client.address.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
            debug="false",
            limit=3,
            radius=200,
        )
        assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_raw_response_reverse_geocode(self, client: Prontiq) -> None:
        response = client.address.with_raw_response.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = response.parse()
        assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_streaming_response_reverse_geocode(self, client: Prontiq) -> None:
        with client.address.with_streaming_response.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = response.parse()
            assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_validate(self, client: Prontiq) -> None:
        address = client.address.validate(
            q="9 endeavour court coffin bay sa 5607",
        )
        assert_matches_type(AddressValidateResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_validate_with_all_params(self, client: Prontiq) -> None:
        address = client.address.validate(
            q="9 endeavour court coffin bay sa 5607",
            debug="false",
        )
        assert_matches_type(AddressValidateResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_raw_response_validate(self, client: Prontiq) -> None:
        response = client.address.with_raw_response.validate(
            q="9 endeavour court coffin bay sa 5607",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = response.parse()
        assert_matches_type(AddressValidateResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_streaming_response_validate(self, client: Prontiq) -> None:
        with client.address.with_streaming_response.validate(
            q="9 endeavour court coffin bay sa 5607",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = response.parse()
            assert_matches_type(AddressValidateResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True


class TestAsyncAddress:
    parametrize = pytest.mark.parametrize(
        "async_client", [False, True, {"http_client": "aiohttp"}], indirect=True, ids=["loose", "strict", "aiohttp"]
    )

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_autocomplete(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.autocomplete(
            q="9 endeavour cou",
        )
        assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_autocomplete_with_all_params(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.autocomplete(
            q="9 endeavour cou",
            debug="false",
            limit=3,
            state="NSW",
        )
        assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_raw_response_autocomplete(self, async_client: AsyncProntiq) -> None:
        response = await async_client.address.with_raw_response.autocomplete(
            q="9 endeavour cou",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = await response.parse()
        assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_streaming_response_autocomplete(self, async_client: AsyncProntiq) -> None:
        async with async_client.address.with_streaming_response.autocomplete(
            q="9 endeavour cou",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = await response.parse()
            assert_matches_type(AddressAutocompleteResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_enrich(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.enrich(
            id="F_GAVIC999000002",
        )
        assert_matches_type(AddressEnrichResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_enrich_with_all_params(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.enrich(
            id="F_GAVIC999000002",
            debug="false",
        )
        assert_matches_type(AddressEnrichResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_raw_response_enrich(self, async_client: AsyncProntiq) -> None:
        response = await async_client.address.with_raw_response.enrich(
            id="F_GAVIC999000002",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = await response.parse()
        assert_matches_type(AddressEnrichResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_streaming_response_enrich(self, async_client: AsyncProntiq) -> None:
        async with async_client.address.with_streaming_response.enrich(
            id="F_GAVIC999000002",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = await response.parse()
            assert_matches_type(AddressEnrichResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_reverse_geocode(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
        )
        assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_reverse_geocode_with_all_params(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
            debug="false",
            limit=3,
            radius=200,
        )
        assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_raw_response_reverse_geocode(self, async_client: AsyncProntiq) -> None:
        response = await async_client.address.with_raw_response.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = await response.parse()
        assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_streaming_response_reverse_geocode(self, async_client: AsyncProntiq) -> None:
        async with async_client.address.with_streaming_response.reverse_geocode(
            lat=-33.8568,
            lon=151.2153,
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = await response.parse()
            assert_matches_type(AddressReverseGeocodeResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_validate(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.validate(
            q="9 endeavour court coffin bay sa 5607",
        )
        assert_matches_type(AddressValidateResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_validate_with_all_params(self, async_client: AsyncProntiq) -> None:
        address = await async_client.address.validate(
            q="9 endeavour court coffin bay sa 5607",
            debug="false",
        )
        assert_matches_type(AddressValidateResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_raw_response_validate(self, async_client: AsyncProntiq) -> None:
        response = await async_client.address.with_raw_response.validate(
            q="9 endeavour court coffin bay sa 5607",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        address = await response.parse()
        assert_matches_type(AddressValidateResponse, address, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_streaming_response_validate(self, async_client: AsyncProntiq) -> None:
        async with async_client.address.with_streaming_response.validate(
            q="9 endeavour court coffin bay sa 5607",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            address = await response.parse()
            assert_matches_type(AddressValidateResponse, address, path=["response"])

        assert cast(Any, response.is_closed) is True
