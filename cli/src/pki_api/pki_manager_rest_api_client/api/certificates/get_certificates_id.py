from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_certificates_id_response_200 import GetCertificatesIdResponse200
from ...models.get_certificates_id_response_404 import GetCertificatesIdResponse404
from ...models.get_certificates_id_response_500 import GetCertificatesIdResponse500
from ...types import Response


def _get_kwargs(
    id: UUID,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/certificates/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500 | None:
    if response.status_code == 200:
        response_200 = GetCertificatesIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetCertificatesIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetCertificatesIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500]:
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
) -> Response[GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500]:
    """Get detailed information about a specific certificate

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
) -> GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500 | None:
    """Get detailed information about a specific certificate

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
) -> Response[GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500]:
    """Get detailed information about a specific certificate

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
) -> GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500 | None:
    """Get detailed information about a specific certificate

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCertificatesIdResponse200 | GetCertificatesIdResponse404 | GetCertificatesIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
