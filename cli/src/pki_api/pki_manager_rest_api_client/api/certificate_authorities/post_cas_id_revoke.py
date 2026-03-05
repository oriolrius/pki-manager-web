from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_cas_id_revoke_body import PostCasIdRevokeBody
from ...models.post_cas_id_revoke_response_200 import PostCasIdRevokeResponse200
from ...models.post_cas_id_revoke_response_404 import PostCasIdRevokeResponse404
from ...models.post_cas_id_revoke_response_409 import PostCasIdRevokeResponse409
from ...models.post_cas_id_revoke_response_500 import PostCasIdRevokeResponse500
from ...types import Response


def _get_kwargs(
    id: UUID,
    *,
    body: PostCasIdRevokeBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/cas/{id}/revoke".format(
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
    PostCasIdRevokeResponse200
    | PostCasIdRevokeResponse404
    | PostCasIdRevokeResponse409
    | PostCasIdRevokeResponse500
    | None
):
    if response.status_code == 200:
        response_200 = PostCasIdRevokeResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = PostCasIdRevokeResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = PostCasIdRevokeResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = PostCasIdRevokeResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostCasIdRevokeResponse200 | PostCasIdRevokeResponse404 | PostCasIdRevokeResponse409 | PostCasIdRevokeResponse500
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
    body: PostCasIdRevokeBody,
) -> Response[
    PostCasIdRevokeResponse200 | PostCasIdRevokeResponse404 | PostCasIdRevokeResponse409 | PostCasIdRevokeResponse500
]:
    """Revoke a Certificate Authority. This will also revoke all certificates issued by this CA.

    Args:
        id (UUID):
        body (PostCasIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCasIdRevokeResponse200 | PostCasIdRevokeResponse404 | PostCasIdRevokeResponse409 | PostCasIdRevokeResponse500]
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
    body: PostCasIdRevokeBody,
) -> (
    PostCasIdRevokeResponse200
    | PostCasIdRevokeResponse404
    | PostCasIdRevokeResponse409
    | PostCasIdRevokeResponse500
    | None
):
    """Revoke a Certificate Authority. This will also revoke all certificates issued by this CA.

    Args:
        id (UUID):
        body (PostCasIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCasIdRevokeResponse200 | PostCasIdRevokeResponse404 | PostCasIdRevokeResponse409 | PostCasIdRevokeResponse500
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
    body: PostCasIdRevokeBody,
) -> Response[
    PostCasIdRevokeResponse200 | PostCasIdRevokeResponse404 | PostCasIdRevokeResponse409 | PostCasIdRevokeResponse500
]:
    """Revoke a Certificate Authority. This will also revoke all certificates issued by this CA.

    Args:
        id (UUID):
        body (PostCasIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCasIdRevokeResponse200 | PostCasIdRevokeResponse404 | PostCasIdRevokeResponse409 | PostCasIdRevokeResponse500]
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
    body: PostCasIdRevokeBody,
) -> (
    PostCasIdRevokeResponse200
    | PostCasIdRevokeResponse404
    | PostCasIdRevokeResponse409
    | PostCasIdRevokeResponse500
    | None
):
    """Revoke a Certificate Authority. This will also revoke all certificates issued by this CA.

    Args:
        id (UUID):
        body (PostCasIdRevokeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCasIdRevokeResponse200 | PostCasIdRevokeResponse404 | PostCasIdRevokeResponse409 | PostCasIdRevokeResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
