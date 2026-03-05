from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_certificates_id_download_format import GetCertificatesIdDownloadFormat
from ...models.get_certificates_id_download_response_200 import GetCertificatesIdDownloadResponse200
from ...models.get_certificates_id_download_response_400 import GetCertificatesIdDownloadResponse400
from ...models.get_certificates_id_download_response_404 import GetCertificatesIdDownloadResponse404
from ...models.get_certificates_id_download_response_500 import GetCertificatesIdDownloadResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    format_: GetCertificatesIdDownloadFormat,
    password: str | Unset = UNSET,
    encrypt_private_key: bool | Unset = False,
    include_chain: bool | Unset = True,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_format_ = format_.value
    params["format"] = json_format_

    params["password"] = password

    params["encryptPrivateKey"] = encrypt_private_key

    params["includeChain"] = include_chain

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/certificates/{id}/download".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetCertificatesIdDownloadResponse200
    | GetCertificatesIdDownloadResponse400
    | GetCertificatesIdDownloadResponse404
    | GetCertificatesIdDownloadResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetCertificatesIdDownloadResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetCertificatesIdDownloadResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = GetCertificatesIdDownloadResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetCertificatesIdDownloadResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetCertificatesIdDownloadResponse200
    | GetCertificatesIdDownloadResponse400
    | GetCertificatesIdDownloadResponse404
    | GetCertificatesIdDownloadResponse500
]:
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
    format_: GetCertificatesIdDownloadFormat,
    password: str | Unset = UNSET,
    encrypt_private_key: bool | Unset = False,
    include_chain: bool | Unset = True,
) -> Response[
    GetCertificatesIdDownloadResponse200
    | GetCertificatesIdDownloadResponse400
    | GetCertificatesIdDownloadResponse404
    | GetCertificatesIdDownloadResponse500
]:
    """Download certificate in various formats

    Args:
        id (UUID):
        format_ (GetCertificatesIdDownloadFormat):
        password (str | Unset):
        encrypt_private_key (bool | Unset):  Default: False.
        include_chain (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCertificatesIdDownloadResponse200 | GetCertificatesIdDownloadResponse400 | GetCertificatesIdDownloadResponse404 | GetCertificatesIdDownloadResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        format_=format_,
        password=password,
        encrypt_private_key=encrypt_private_key,
        include_chain=include_chain,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    format_: GetCertificatesIdDownloadFormat,
    password: str | Unset = UNSET,
    encrypt_private_key: bool | Unset = False,
    include_chain: bool | Unset = True,
) -> (
    GetCertificatesIdDownloadResponse200
    | GetCertificatesIdDownloadResponse400
    | GetCertificatesIdDownloadResponse404
    | GetCertificatesIdDownloadResponse500
    | None
):
    """Download certificate in various formats

    Args:
        id (UUID):
        format_ (GetCertificatesIdDownloadFormat):
        password (str | Unset):
        encrypt_private_key (bool | Unset):  Default: False.
        include_chain (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCertificatesIdDownloadResponse200 | GetCertificatesIdDownloadResponse400 | GetCertificatesIdDownloadResponse404 | GetCertificatesIdDownloadResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        format_=format_,
        password=password,
        encrypt_private_key=encrypt_private_key,
        include_chain=include_chain,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    format_: GetCertificatesIdDownloadFormat,
    password: str | Unset = UNSET,
    encrypt_private_key: bool | Unset = False,
    include_chain: bool | Unset = True,
) -> Response[
    GetCertificatesIdDownloadResponse200
    | GetCertificatesIdDownloadResponse400
    | GetCertificatesIdDownloadResponse404
    | GetCertificatesIdDownloadResponse500
]:
    """Download certificate in various formats

    Args:
        id (UUID):
        format_ (GetCertificatesIdDownloadFormat):
        password (str | Unset):
        encrypt_private_key (bool | Unset):  Default: False.
        include_chain (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCertificatesIdDownloadResponse200 | GetCertificatesIdDownloadResponse400 | GetCertificatesIdDownloadResponse404 | GetCertificatesIdDownloadResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        format_=format_,
        password=password,
        encrypt_private_key=encrypt_private_key,
        include_chain=include_chain,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    format_: GetCertificatesIdDownloadFormat,
    password: str | Unset = UNSET,
    encrypt_private_key: bool | Unset = False,
    include_chain: bool | Unset = True,
) -> (
    GetCertificatesIdDownloadResponse200
    | GetCertificatesIdDownloadResponse400
    | GetCertificatesIdDownloadResponse404
    | GetCertificatesIdDownloadResponse500
    | None
):
    """Download certificate in various formats

    Args:
        id (UUID):
        format_ (GetCertificatesIdDownloadFormat):
        password (str | Unset):
        encrypt_private_key (bool | Unset):  Default: False.
        include_chain (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCertificatesIdDownloadResponse200 | GetCertificatesIdDownloadResponse400 | GetCertificatesIdDownloadResponse404 | GetCertificatesIdDownloadResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            format_=format_,
            password=password,
            encrypt_private_key=encrypt_private_key,
            include_chain=include_chain,
        )
    ).parsed
