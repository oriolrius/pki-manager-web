from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_cas_id_certificates_certificate_type import GetCasIdCertificatesCertificateType
from ...models.get_cas_id_certificates_response_200 import GetCasIdCertificatesResponse200
from ...models.get_cas_id_certificates_response_404 import GetCasIdCertificatesResponse404
from ...models.get_cas_id_certificates_response_500 import GetCasIdCertificatesResponse500
from ...models.get_cas_id_certificates_status import GetCasIdCertificatesStatus
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    status: GetCasIdCertificatesStatus | Unset = UNSET,
    certificate_type: GetCasIdCertificatesCertificateType | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    json_certificate_type: str | Unset = UNSET
    if not isinstance(certificate_type, Unset):
        json_certificate_type = certificate_type.value

    params["certificateType"] = json_certificate_type

    params["search"] = search

    params["limit"] = limit

    params["offset"] = offset

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/cas/{id}/certificates".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500 | None:
    if response.status_code == 200:
        response_200 = GetCasIdCertificatesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = GetCasIdCertificatesResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetCasIdCertificatesResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500]:
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
    status: GetCasIdCertificatesStatus | Unset = UNSET,
    certificate_type: GetCasIdCertificatesCertificateType | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500]:
    """List all certificates issued by a specific Certificate Authority

    Args:
        id (UUID):
        status (GetCasIdCertificatesStatus | Unset):
        certificate_type (GetCasIdCertificatesCertificateType | Unset):
        search (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        status=status,
        certificate_type=certificate_type,
        search=search,
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
    status: GetCasIdCertificatesStatus | Unset = UNSET,
    certificate_type: GetCasIdCertificatesCertificateType | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500 | None:
    """List all certificates issued by a specific Certificate Authority

    Args:
        id (UUID):
        status (GetCasIdCertificatesStatus | Unset):
        certificate_type (GetCasIdCertificatesCertificateType | Unset):
        search (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        status=status,
        certificate_type=certificate_type,
        search=search,
        limit=limit,
        offset=offset,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    status: GetCasIdCertificatesStatus | Unset = UNSET,
    certificate_type: GetCasIdCertificatesCertificateType | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500]:
    """List all certificates issued by a specific Certificate Authority

    Args:
        id (UUID):
        status (GetCasIdCertificatesStatus | Unset):
        certificate_type (GetCasIdCertificatesCertificateType | Unset):
        search (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        status=status,
        certificate_type=certificate_type,
        search=search,
        limit=limit,
        offset=offset,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    status: GetCasIdCertificatesStatus | Unset = UNSET,
    certificate_type: GetCasIdCertificatesCertificateType | Unset = UNSET,
    search: str | Unset = UNSET,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500 | None:
    """List all certificates issued by a specific Certificate Authority

    Args:
        id (UUID):
        status (GetCasIdCertificatesStatus | Unset):
        certificate_type (GetCasIdCertificatesCertificateType | Unset):
        search (str | Unset):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCasIdCertificatesResponse200 | GetCasIdCertificatesResponse404 | GetCasIdCertificatesResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            status=status,
            certificate_type=certificate_type,
            search=search,
            limit=limit,
            offset=offset,
        )
    ).parsed
