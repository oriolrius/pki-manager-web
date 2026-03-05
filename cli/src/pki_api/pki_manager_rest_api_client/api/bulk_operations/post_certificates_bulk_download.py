from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_certificates_bulk_download_body import PostCertificatesBulkDownloadBody
from ...models.post_certificates_bulk_download_response_200 import PostCertificatesBulkDownloadResponse200
from ...models.post_certificates_bulk_download_response_400 import PostCertificatesBulkDownloadResponse400
from ...models.post_certificates_bulk_download_response_404 import PostCertificatesBulkDownloadResponse404
from ...models.post_certificates_bulk_download_response_500 import PostCertificatesBulkDownloadResponse500
from ...types import Response


def _get_kwargs(
    *,
    body: PostCertificatesBulkDownloadBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/certificates/bulk/download",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostCertificatesBulkDownloadResponse200
    | PostCertificatesBulkDownloadResponse400
    | PostCertificatesBulkDownloadResponse404
    | PostCertificatesBulkDownloadResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostCertificatesBulkDownloadResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = PostCertificatesBulkDownloadResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = PostCertificatesBulkDownloadResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PostCertificatesBulkDownloadResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostCertificatesBulkDownloadResponse200
    | PostCertificatesBulkDownloadResponse400
    | PostCertificatesBulkDownloadResponse404
    | PostCertificatesBulkDownloadResponse500
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesBulkDownloadBody,
) -> Response[
    PostCertificatesBulkDownloadResponse200
    | PostCertificatesBulkDownloadResponse400
    | PostCertificatesBulkDownloadResponse404
    | PostCertificatesBulkDownloadResponse500
]:
    """Bulk download certificates in various formats as a ZIP file

    Args:
        body (PostCertificatesBulkDownloadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesBulkDownloadResponse200 | PostCertificatesBulkDownloadResponse400 | PostCertificatesBulkDownloadResponse404 | PostCertificatesBulkDownloadResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesBulkDownloadBody,
) -> (
    PostCertificatesBulkDownloadResponse200
    | PostCertificatesBulkDownloadResponse400
    | PostCertificatesBulkDownloadResponse404
    | PostCertificatesBulkDownloadResponse500
    | None
):
    """Bulk download certificates in various formats as a ZIP file

    Args:
        body (PostCertificatesBulkDownloadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesBulkDownloadResponse200 | PostCertificatesBulkDownloadResponse400 | PostCertificatesBulkDownloadResponse404 | PostCertificatesBulkDownloadResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesBulkDownloadBody,
) -> Response[
    PostCertificatesBulkDownloadResponse200
    | PostCertificatesBulkDownloadResponse400
    | PostCertificatesBulkDownloadResponse404
    | PostCertificatesBulkDownloadResponse500
]:
    """Bulk download certificates in various formats as a ZIP file

    Args:
        body (PostCertificatesBulkDownloadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesBulkDownloadResponse200 | PostCertificatesBulkDownloadResponse400 | PostCertificatesBulkDownloadResponse404 | PostCertificatesBulkDownloadResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesBulkDownloadBody,
) -> (
    PostCertificatesBulkDownloadResponse200
    | PostCertificatesBulkDownloadResponse400
    | PostCertificatesBulkDownloadResponse404
    | PostCertificatesBulkDownloadResponse500
    | None
):
    """Bulk download certificates in various formats as a ZIP file

    Args:
        body (PostCertificatesBulkDownloadBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesBulkDownloadResponse200 | PostCertificatesBulkDownloadResponse400 | PostCertificatesBulkDownloadResponse404 | PostCertificatesBulkDownloadResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
