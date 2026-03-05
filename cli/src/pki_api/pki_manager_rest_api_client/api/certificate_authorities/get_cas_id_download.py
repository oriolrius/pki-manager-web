from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_cas_id_download_format import GetCasIdDownloadFormat
from ...models.get_cas_id_download_response_200 import GetCasIdDownloadResponse200
from ...models.get_cas_id_download_response_400 import GetCasIdDownloadResponse400
from ...models.get_cas_id_download_response_404 import GetCasIdDownloadResponse404
from ...models.get_cas_id_download_response_500 import GetCasIdDownloadResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    format_: GetCasIdDownloadFormat,
    password: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_format_ = format_.value
    params["format"] = json_format_

    params["password"] = password

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/cas/{id}/download".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetCasIdDownloadResponse200
    | GetCasIdDownloadResponse400
    | GetCasIdDownloadResponse404
    | GetCasIdDownloadResponse500
    | None
):
    if response.status_code == 200:
        response_200 = GetCasIdDownloadResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetCasIdDownloadResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = GetCasIdDownloadResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = GetCasIdDownloadResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetCasIdDownloadResponse200
    | GetCasIdDownloadResponse400
    | GetCasIdDownloadResponse404
    | GetCasIdDownloadResponse500
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
    format_: GetCasIdDownloadFormat,
    password: str | Unset = UNSET,
) -> Response[
    GetCasIdDownloadResponse200
    | GetCasIdDownloadResponse400
    | GetCasIdDownloadResponse404
    | GetCasIdDownloadResponse500
]:
    """Download CA certificate in various formats.

    **Certificate Formats (public certificate only):**
    - `pem` - PEM text format (Base64-encoded with headers)
    - `crt` - CRT text certificate (same as PEM)
    - `der` - DER binary compact format
    - `cer` - CER Windows-compatible format (same as DER)

    **Truststore Formats (public certificate only, for trust validation):**
    - `p12-truststore` - PKCS#12 truststore containing only the CA certificate
    - `jks-truststore` - Java KeyStore truststore containing only the CA certificate

    **Keystore Formats (certificate + private key, for CA signing operations):**
    - `p12-keystore` - PKCS#12 keystore with CA certificate and private key
    - `jks-keystore` - Java KeyStore with CA certificate and private key

    **Security Note:** Keystore formats expose the CA's private key. Only use these for CA operations
    that require signing capability (e.g., offline CA scenarios).

    Args:
        id (UUID):
        format_ (GetCasIdDownloadFormat):
        password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCasIdDownloadResponse200 | GetCasIdDownloadResponse400 | GetCasIdDownloadResponse404 | GetCasIdDownloadResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        format_=format_,
        password=password,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    format_: GetCasIdDownloadFormat,
    password: str | Unset = UNSET,
) -> (
    GetCasIdDownloadResponse200
    | GetCasIdDownloadResponse400
    | GetCasIdDownloadResponse404
    | GetCasIdDownloadResponse500
    | None
):
    """Download CA certificate in various formats.

    **Certificate Formats (public certificate only):**
    - `pem` - PEM text format (Base64-encoded with headers)
    - `crt` - CRT text certificate (same as PEM)
    - `der` - DER binary compact format
    - `cer` - CER Windows-compatible format (same as DER)

    **Truststore Formats (public certificate only, for trust validation):**
    - `p12-truststore` - PKCS#12 truststore containing only the CA certificate
    - `jks-truststore` - Java KeyStore truststore containing only the CA certificate

    **Keystore Formats (certificate + private key, for CA signing operations):**
    - `p12-keystore` - PKCS#12 keystore with CA certificate and private key
    - `jks-keystore` - Java KeyStore with CA certificate and private key

    **Security Note:** Keystore formats expose the CA's private key. Only use these for CA operations
    that require signing capability (e.g., offline CA scenarios).

    Args:
        id (UUID):
        format_ (GetCasIdDownloadFormat):
        password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCasIdDownloadResponse200 | GetCasIdDownloadResponse400 | GetCasIdDownloadResponse404 | GetCasIdDownloadResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        format_=format_,
        password=password,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    format_: GetCasIdDownloadFormat,
    password: str | Unset = UNSET,
) -> Response[
    GetCasIdDownloadResponse200
    | GetCasIdDownloadResponse400
    | GetCasIdDownloadResponse404
    | GetCasIdDownloadResponse500
]:
    """Download CA certificate in various formats.

    **Certificate Formats (public certificate only):**
    - `pem` - PEM text format (Base64-encoded with headers)
    - `crt` - CRT text certificate (same as PEM)
    - `der` - DER binary compact format
    - `cer` - CER Windows-compatible format (same as DER)

    **Truststore Formats (public certificate only, for trust validation):**
    - `p12-truststore` - PKCS#12 truststore containing only the CA certificate
    - `jks-truststore` - Java KeyStore truststore containing only the CA certificate

    **Keystore Formats (certificate + private key, for CA signing operations):**
    - `p12-keystore` - PKCS#12 keystore with CA certificate and private key
    - `jks-keystore` - Java KeyStore with CA certificate and private key

    **Security Note:** Keystore formats expose the CA's private key. Only use these for CA operations
    that require signing capability (e.g., offline CA scenarios).

    Args:
        id (UUID):
        format_ (GetCasIdDownloadFormat):
        password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCasIdDownloadResponse200 | GetCasIdDownloadResponse400 | GetCasIdDownloadResponse404 | GetCasIdDownloadResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        format_=format_,
        password=password,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    format_: GetCasIdDownloadFormat,
    password: str | Unset = UNSET,
) -> (
    GetCasIdDownloadResponse200
    | GetCasIdDownloadResponse400
    | GetCasIdDownloadResponse404
    | GetCasIdDownloadResponse500
    | None
):
    """Download CA certificate in various formats.

    **Certificate Formats (public certificate only):**
    - `pem` - PEM text format (Base64-encoded with headers)
    - `crt` - CRT text certificate (same as PEM)
    - `der` - DER binary compact format
    - `cer` - CER Windows-compatible format (same as DER)

    **Truststore Formats (public certificate only, for trust validation):**
    - `p12-truststore` - PKCS#12 truststore containing only the CA certificate
    - `jks-truststore` - Java KeyStore truststore containing only the CA certificate

    **Keystore Formats (certificate + private key, for CA signing operations):**
    - `p12-keystore` - PKCS#12 keystore with CA certificate and private key
    - `jks-keystore` - Java KeyStore with CA certificate and private key

    **Security Note:** Keystore formats expose the CA's private key. Only use these for CA operations
    that require signing capability (e.g., offline CA scenarios).

    Args:
        id (UUID):
        format_ (GetCasIdDownloadFormat):
        password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCasIdDownloadResponse200 | GetCasIdDownloadResponse400 | GetCasIdDownloadResponse404 | GetCasIdDownloadResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            format_=format_,
            password=password,
        )
    ).parsed
