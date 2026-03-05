from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_certificates_bulk_issue_body import PostCertificatesBulkIssueBody
from ...models.post_certificates_bulk_issue_response_201 import PostCertificatesBulkIssueResponse201
from ...models.post_certificates_bulk_issue_response_400 import PostCertificatesBulkIssueResponse400
from ...models.post_certificates_bulk_issue_response_404 import PostCertificatesBulkIssueResponse404
from ...models.post_certificates_bulk_issue_response_500 import PostCertificatesBulkIssueResponse500
from ...types import Response


def _get_kwargs(
    *,
    body: PostCertificatesBulkIssueBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/certificates/bulk/issue",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostCertificatesBulkIssueResponse201
    | PostCertificatesBulkIssueResponse400
    | PostCertificatesBulkIssueResponse404
    | PostCertificatesBulkIssueResponse500
    | None
):
    if response.status_code == 201:
        response_201 = PostCertificatesBulkIssueResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostCertificatesBulkIssueResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = PostCertificatesBulkIssueResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 500:
        response_500 = PostCertificatesBulkIssueResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostCertificatesBulkIssueResponse201
    | PostCertificatesBulkIssueResponse400
    | PostCertificatesBulkIssueResponse404
    | PostCertificatesBulkIssueResponse500
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
    body: PostCertificatesBulkIssueBody,
) -> Response[
    PostCertificatesBulkIssueResponse201
    | PostCertificatesBulkIssueResponse400
    | PostCertificatesBulkIssueResponse404
    | PostCertificatesBulkIssueResponse500
]:
    """Bulk issue certificates from CSV data

    Args:
        body (PostCertificatesBulkIssueBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesBulkIssueResponse201 | PostCertificatesBulkIssueResponse400 | PostCertificatesBulkIssueResponse404 | PostCertificatesBulkIssueResponse500]
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
    body: PostCertificatesBulkIssueBody,
) -> (
    PostCertificatesBulkIssueResponse201
    | PostCertificatesBulkIssueResponse400
    | PostCertificatesBulkIssueResponse404
    | PostCertificatesBulkIssueResponse500
    | None
):
    """Bulk issue certificates from CSV data

    Args:
        body (PostCertificatesBulkIssueBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesBulkIssueResponse201 | PostCertificatesBulkIssueResponse400 | PostCertificatesBulkIssueResponse404 | PostCertificatesBulkIssueResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesBulkIssueBody,
) -> Response[
    PostCertificatesBulkIssueResponse201
    | PostCertificatesBulkIssueResponse400
    | PostCertificatesBulkIssueResponse404
    | PostCertificatesBulkIssueResponse500
]:
    """Bulk issue certificates from CSV data

    Args:
        body (PostCertificatesBulkIssueBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostCertificatesBulkIssueResponse201 | PostCertificatesBulkIssueResponse400 | PostCertificatesBulkIssueResponse404 | PostCertificatesBulkIssueResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: PostCertificatesBulkIssueBody,
) -> (
    PostCertificatesBulkIssueResponse201
    | PostCertificatesBulkIssueResponse400
    | PostCertificatesBulkIssueResponse404
    | PostCertificatesBulkIssueResponse500
    | None
):
    """Bulk issue certificates from CSV data

    Args:
        body (PostCertificatesBulkIssueBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostCertificatesBulkIssueResponse201 | PostCertificatesBulkIssueResponse400 | PostCertificatesBulkIssueResponse404 | PostCertificatesBulkIssueResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
