from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_search_response_200 import GetSearchResponse200
from ...models.get_search_response_400 import GetSearchResponse400
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    query: str,
    limit: int | Unset = 10,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["query"] = query

    params["limit"] = limit

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/search",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetSearchResponse200 | GetSearchResponse400 | None:
    if response.status_code == 200:
        response_200 = GetSearchResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetSearchResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetSearchResponse200 | GetSearchResponse400]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    query: str,
    limit: int | Unset = 10,
) -> Response[GetSearchResponse200 | GetSearchResponse400]:
    """Global search across CAs, certificates, and domains

    Args:
        query (str):
        limit (int | Unset):  Default: 10.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSearchResponse200 | GetSearchResponse400]
    """

    kwargs = _get_kwargs(
        query=query,
        limit=limit,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    query: str,
    limit: int | Unset = 10,
) -> GetSearchResponse200 | GetSearchResponse400 | None:
    """Global search across CAs, certificates, and domains

    Args:
        query (str):
        limit (int | Unset):  Default: 10.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSearchResponse200 | GetSearchResponse400
    """

    return sync_detailed(
        client=client,
        query=query,
        limit=limit,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    query: str,
    limit: int | Unset = 10,
) -> Response[GetSearchResponse200 | GetSearchResponse400]:
    """Global search across CAs, certificates, and domains

    Args:
        query (str):
        limit (int | Unset):  Default: 10.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSearchResponse200 | GetSearchResponse400]
    """

    kwargs = _get_kwargs(
        query=query,
        limit=limit,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    query: str,
    limit: int | Unset = 10,
) -> GetSearchResponse200 | GetSearchResponse400 | None:
    """Global search across CAs, certificates, and domains

    Args:
        query (str):
        limit (int | Unset):  Default: 10.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSearchResponse200 | GetSearchResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            query=query,
            limit=limit,
        )
    ).parsed
