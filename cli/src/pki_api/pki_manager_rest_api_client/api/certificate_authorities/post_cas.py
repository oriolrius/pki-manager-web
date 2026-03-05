from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_cas_body import PostCasBody
from ...models.post_cas_response_201 import PostCasResponse201
from ...models.post_cas_response_400 import PostCasResponse400
from ...models.post_cas_response_500 import PostCasResponse500
from ...types import Response


def _get_kwargs(
    *,
    body: PostCasBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/cas/",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostCasResponse201 | PostCasResponse400 | PostCasResponse500 | None:
    if response.status_code == 201:
        response_201 = PostCasResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostCasResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 500:
        response_500 = PostCasResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostCasResponse201 | PostCasResponse400 | PostCasResponse500]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostCasBody,
) -> Response[PostCasResponse201 | PostCasResponse400 | PostCasResponse500]:
    """Create a new self-signed root Certificate Authority

    Args:
        body (PostCasBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCasResponse201 | PostCasResponse400 | PostCasResponse500]
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
    body: PostCasBody,
) -> PostCasResponse201 | PostCasResponse400 | PostCasResponse500 | None:
    """Create a new self-signed root Certificate Authority

    Args:
        body (PostCasBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCasResponse201 | PostCasResponse400 | PostCasResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostCasBody,
) -> Response[PostCasResponse201 | PostCasResponse400 | PostCasResponse500]:
    """Create a new self-signed root Certificate Authority

    Args:
        body (PostCasBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCasResponse201 | PostCasResponse400 | PostCasResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostCasBody,
) -> PostCasResponse201 | PostCasResponse400 | PostCasResponse500 | None:
    """Create a new self-signed root Certificate Authority

    Args:
        body (PostCasBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCasResponse201 | PostCasResponse400 | PostCasResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
