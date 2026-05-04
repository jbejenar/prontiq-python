# File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

from __future__ import annotations

import os
from typing import Any, cast

import pytest

from prontiq import Prontiq, AsyncProntiq
from tests.utils import assert_matches_type
from prontiq.types.address import (
    LookupBySuburbResponse,
    LookupByPostcodeResponse,
)

base_url = os.environ.get("TEST_API_BASE_URL", "http://127.0.0.1:4010")


class TestLookup:
    parametrize = pytest.mark.parametrize("client", [False, True], indirect=True, ids=["loose", "strict"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_by_postcode(self, client: Prontiq) -> None:
        lookup = client.address.lookup.by_postcode(
            postcode="7321",
        )
        assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_by_postcode_with_all_params(self, client: Prontiq) -> None:
        lookup = client.address.lookup.by_postcode(
            postcode="7321",
            limit=1,
        )
        assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_raw_response_by_postcode(self, client: Prontiq) -> None:
        response = client.address.lookup.with_raw_response.by_postcode(
            postcode="7321",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        lookup = response.parse()
        assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_streaming_response_by_postcode(self, client: Prontiq) -> None:
        with client.address.lookup.with_streaming_response.by_postcode(
            postcode="7321",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            lookup = response.parse()
            assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_by_suburb(self, client: Prontiq) -> None:
        lookup = client.address.lookup.by_suburb(
            suburb="x",
        )
        assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_method_by_suburb_with_all_params(self, client: Prontiq) -> None:
        lookup = client.address.lookup.by_suburb(
            suburb="x",
            limit=1,
            state="state",
        )
        assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_raw_response_by_suburb(self, client: Prontiq) -> None:
        response = client.address.lookup.with_raw_response.by_suburb(
            suburb="x",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        lookup = response.parse()
        assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    def test_streaming_response_by_suburb(self, client: Prontiq) -> None:
        with client.address.lookup.with_streaming_response.by_suburb(
            suburb="x",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            lookup = response.parse()
            assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

        assert cast(Any, response.is_closed) is True


class TestAsyncLookup:
    parametrize = pytest.mark.parametrize(
        "async_client", [False, True, {"http_client": "aiohttp"}], indirect=True, ids=["loose", "strict", "aiohttp"]
    )

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_by_postcode(self, async_client: AsyncProntiq) -> None:
        lookup = await async_client.address.lookup.by_postcode(
            postcode="7321",
        )
        assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_by_postcode_with_all_params(self, async_client: AsyncProntiq) -> None:
        lookup = await async_client.address.lookup.by_postcode(
            postcode="7321",
            limit=1,
        )
        assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_raw_response_by_postcode(self, async_client: AsyncProntiq) -> None:
        response = await async_client.address.lookup.with_raw_response.by_postcode(
            postcode="7321",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        lookup = await response.parse()
        assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_streaming_response_by_postcode(self, async_client: AsyncProntiq) -> None:
        async with async_client.address.lookup.with_streaming_response.by_postcode(
            postcode="7321",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            lookup = await response.parse()
            assert_matches_type(LookupByPostcodeResponse, lookup, path=["response"])

        assert cast(Any, response.is_closed) is True

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_by_suburb(self, async_client: AsyncProntiq) -> None:
        lookup = await async_client.address.lookup.by_suburb(
            suburb="x",
        )
        assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_method_by_suburb_with_all_params(self, async_client: AsyncProntiq) -> None:
        lookup = await async_client.address.lookup.by_suburb(
            suburb="x",
            limit=1,
            state="state",
        )
        assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_raw_response_by_suburb(self, async_client: AsyncProntiq) -> None:
        response = await async_client.address.lookup.with_raw_response.by_suburb(
            suburb="x",
        )

        assert response.is_closed is True
        assert response.http_request.headers.get("X-Stainless-Lang") == "python"
        lookup = await response.parse()
        assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

    @pytest.mark.skip(reason="Mock server tests are disabled")
    @parametrize
    async def test_streaming_response_by_suburb(self, async_client: AsyncProntiq) -> None:
        async with async_client.address.lookup.with_streaming_response.by_suburb(
            suburb="x",
        ) as response:
            assert not response.is_closed
            assert response.http_request.headers.get("X-Stainless-Lang") == "python"

            lookup = await response.parse()
            assert_matches_type(LookupBySuburbResponse, lookup, path=["response"])

        assert cast(Any, response.is_closed) is True
