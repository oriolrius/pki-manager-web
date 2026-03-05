from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_certificates_id_renew_body import PostCertificatesIdRenewBody
from ...models.post_certificates_id_renew_response_201 import PostCertificatesIdRenewResponse201
from ...models.post_certificates_id_renew_response_404 import PostCertificatesIdRenewResponse404
from ...models.post_certificates_id_renew_response_409 import PostCertificatesIdRenewResponse409
from ...models.post_certificates_id_renew_response_500 import PostCertificatesIdRenewResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    body: PostCertificatesIdRenewBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/certificates/{id}/renew".format(
            id=quote(str(id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostCertificatesIdRenewResponse201
    | PostCertificatesIdRenewResponse404
    | PostCertificatesIdRenewResponse409
    | PostCertificatesIdRenewResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostCertificatesIdRenewResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 404:
        response_404 = PostCertificatesIdRenewResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostCertificatesIdRenewResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = PostCertificatesIdRenewResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostCertificatesIdRenewResponse201
    | PostCertificatesIdRenewResponse404
    | PostCertificatesIdRenewResponse409
    | PostCertificatesIdRenewResponse500
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
    body: PostCertificatesIdRenewBody | Unset = UNSET,
) -> Response[
    PostCertificatesIdRenewResponse201
    | PostCertificatesIdRenewResponse404
    | PostCertificatesIdRenewResponse409
    | PostCertificatesIdRenewResponse500
]:
    """Renew an existing certificate, optionally with new key or updated information

    Args:
        id (UUID):
        body (PostCertificatesIdRenewBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesIdRenewResponse201 | PostCertificatesIdRenewResponse404 | PostCertificatesIdRenewResponse409 | PostCertificatesIdRenewResponse500]
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
    body: PostCertificatesIdRenewBody | Unset = UNSET,
) -> (
    PostCertificatesIdRenewResponse201
    | PostCertificatesIdRenewResponse404
    | PostCertificatesIdRenewResponse409
    | PostCertificatesIdRenewResponse500
    | None
):
    """Renew an existing certificate, optionally with new key or updated information

    Args:
        id (UUID):
        body (PostCertificatesIdRenewBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesIdRenewResponse201 | PostCertificatesIdRenewResponse404 | PostCertificatesIdRenewResponse409 | PostCertificatesIdRenewResponse500
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
    body: PostCertificatesIdRenewBody | Unset = UNSET,
) -> Response[
    PostCertificatesIdRenewResponse201
    | PostCertificatesIdRenewResponse404
    | PostCertificatesIdRenewResponse409
    | PostCertificatesIdRenewResponse500
]:
    """Renew an existing certificate, optionally with new key or updated information

    Args:
        id (UUID):
        body (PostCertificatesIdRenewBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesIdRenewResponse201 | PostCertificatesIdRenewResponse404 | PostCertificatesIdRenewResponse409 | PostCertificatesIdRenewResponse500]
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
    body: PostCertificatesIdRenewBody | Unset = UNSET,
) -> (
    PostCertificatesIdRenewResponse201
    | PostCertificatesIdRenewResponse404
    | PostCertificatesIdRenewResponse409
    | PostCertificatesIdRenewResponse500
    | None
):
    """Renew an existing certificate, optionally with new key or updated information

    Args:
        id (UUID):
        body (PostCertificatesIdRenewBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesIdRenewResponse201 | PostCertificatesIdRenewResponse404 | PostCertificatesIdRenewResponse409 | PostCertificatesIdRenewResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
