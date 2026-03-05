from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_cas_id_crls_response_200 import GetCasIdCrlsResponse200
from ...models.get_cas_id_crls_response_404 import GetCasIdCrlsResponse404
from ...models.get_cas_id_crls_response_500 import GetCasIdCrlsResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["offset"] = offset

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/cas/{id}/crls".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500 | None:
    if response.status_code == 200:
        response_200 = GetCasIdCrlsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetCasIdCrlsResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetCasIdCrlsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500]:
    """List all Certificate Revocation Lists (CRLs) for a specific CA

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        offset=offset,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500 | None:
    """List all Certificate Revocation Lists (CRLs) for a specific CA

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        limit=limit,
        offset=offset,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500]:
    """List all Certificate Revocation Lists (CRLs) for a specific CA

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        offset=offset,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500 | None:
    """List all Certificate Revocation Lists (CRLs) for a specific CA

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCasIdCrlsResponse200 | GetCasIdCrlsResponse404 | GetCasIdCrlsResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            limit=limit,
            offset=offset,
        )
    ).parsed
