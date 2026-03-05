from http import HTTPStatus
from typing import Any
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_domains_response_200 import GetDomainsResponse200
from ...models.get_domains_response_400 import GetDomainsResponse400
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    search: str | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["search"] = search

    json_ca_id: str | Unset = UNSET
    if not isinstance(ca_id, Unset):
        json_ca_id = str(ca_id)
    params["caId"] = json_ca_id

    params["limit"] = limit

    params["offset"] = offset

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/domains",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetDomainsResponse200 | GetDomainsResponse400 | None:
    if response.status_code == 200:
        response_200 = GetDomainsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetDomainsResponse400.from_dict(response.json())

        return response_400

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetDomainsResponse200 | GetDomainsResponse400]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    search: str | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetDomainsResponse200 | GetDomainsResponse400]:
    """List domains with filtering and pagination

    Args:
        search (str | Unset):
        ca_id (UUID | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetDomainsResponse200 | GetDomainsResponse400]
    """

    kwargs = _get_kwargs(
        search=search,
        ca_id=ca_id,
        limit=limit,
        offset=offset,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    search: str | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetDomainsResponse200 | GetDomainsResponse400 | None:
    """List domains with filtering and pagination

    Args:
        search (str | Unset):
        ca_id (UUID | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetDomainsResponse200 | GetDomainsResponse400
    """

    return sync_detailed(
        client=client,
        search=search,
        ca_id=ca_id,
        limit=limit,
        offset=offset,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    search: str | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetDomainsResponse200 | GetDomainsResponse400]:
    """List domains with filtering and pagination

    Args:
        search (str | Unset):
        ca_id (UUID | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetDomainsResponse200 | GetDomainsResponse400]
    """

    kwargs = _get_kwargs(
        search=search,
        ca_id=ca_id,
        limit=limit,
        offset=offset,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    search: str | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetDomainsResponse200 | GetDomainsResponse400 | None:
    """List domains with filtering and pagination

    Args:
        search (str | Unset):
        ca_id (UUID | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetDomainsResponse200 | GetDomainsResponse400
    """

    return (
        await asyncio_detailed(
            client=client,
            search=search,
            ca_id=ca_id,
            limit=limit,
            offset=offset,
        )
    ).parsed
