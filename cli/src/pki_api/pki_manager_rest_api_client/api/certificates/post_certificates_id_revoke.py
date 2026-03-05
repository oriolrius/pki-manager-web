from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_certificates_id_revoke_body import PostCertificatesIdRevokeBody
from ...models.post_certificates_id_revoke_response_200 import PostCertificatesIdRevokeResponse200
from ...models.post_certificates_id_revoke_response_404 import PostCertificatesIdRevokeResponse404
from ...models.post_certificates_id_revoke_response_409 import PostCertificatesIdRevokeResponse409
from ...models.post_certificates_id_revoke_response_500 import PostCertificatesIdRevokeResponse500
from ...types import Response


def _get_kwargs(
    id: UUID,
    *,
    body: PostCertificatesIdRevokeBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/certificates/{id}/revoke".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostCertificatesIdRevokeResponse200
    | PostCertificatesIdRevokeResponse404
    | PostCertificatesIdRevokeResponse409
    | PostCertificatesIdRevokeResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostCertificatesIdRevokeResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PostCertificatesIdRevokeResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostCertificatesIdRevokeResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = PostCertificatesIdRevokeResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostCertificatesIdRevokeResponse200
    | PostCertificatesIdRevokeResponse404
    | PostCertificatesIdRevokeResponse409
    | PostCertificatesIdRevokeResponse500
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
    body: PostCertificatesIdRevokeBody,
) -> Response[
    PostCertificatesIdRevokeResponse200
    | PostCertificatesIdRevokeResponse404
    | PostCertificatesIdRevokeResponse409
    | PostCertificatesIdRevokeResponse500
]:
    """Revoke a certificate

    Args:
        id (UUID):
        body (PostCertificatesIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesIdRevokeResponse200 | PostCertificatesIdRevokeResponse404 | PostCertificatesIdRevokeResponse409 | PostCertificatesIdRevokeResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesIdRevokeBody,
) -> (
    PostCertificatesIdRevokeResponse200
    | PostCertificatesIdRevokeResponse404
    | PostCertificatesIdRevokeResponse409
    | PostCertificatesIdRevokeResponse500
    | None
):
    """Revoke a certificate

    Args:
        id (UUID):
        body (PostCertificatesIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesIdRevokeResponse200 | PostCertificatesIdRevokeResponse404 | PostCertificatesIdRevokeResponse409 | PostCertificatesIdRevokeResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesIdRevokeBody,
) -> Response[
    PostCertificatesIdRevokeResponse200
    | PostCertificatesIdRevokeResponse404
    | PostCertificatesIdRevokeResponse409
    | PostCertificatesIdRevokeResponse500
]:
    """Revoke a certificate

    Args:
        id (UUID):
        body (PostCertificatesIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesIdRevokeResponse200 | PostCertificatesIdRevokeResponse404 | PostCertificatesIdRevokeResponse409 | PostCertificatesIdRevokeResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesIdRevokeBody,
) -> (
    PostCertificatesIdRevokeResponse200
    | PostCertificatesIdRevokeResponse404
    | PostCertificatesIdRevokeResponse409
    | PostCertificatesIdRevokeResponse500
    | None
):
    """Revoke a certificate

    Args:
        id (UUID):
        body (PostCertificatesIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesIdRevokeResponse200 | PostCertificatesIdRevokeResponse404 | PostCertificatesIdRevokeResponse409 | PostCertificatesIdRevokeResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
