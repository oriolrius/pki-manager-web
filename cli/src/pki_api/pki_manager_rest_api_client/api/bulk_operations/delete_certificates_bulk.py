from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_certificates_bulk_body import DeleteCertificatesBulkBody
from ...models.delete_certificates_bulk_response_200 import DeleteCertificatesBulkResponse200
from ...models.delete_certificates_bulk_response_400 import DeleteCertificatesBulkResponse400
from ...models.delete_certificates_bulk_response_500 import DeleteCertificatesBulkResponse500
from ...types import Response


def _get_kwargs(
    *,
    body: DeleteCertificatesBulkBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/certificates/bulk/",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500 | None:
    if response.status_code == 200:
        response_200 = DeleteCertificatesBulkResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = DeleteCertificatesBulkResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 500:
        response_500 = DeleteCertificatesBulkResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500
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
    body: DeleteCertificatesBulkBody,
) -> Response[
    DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500
]:
    """Bulk delete certificates (must be revoked or expired > 90 days)

    Args:
        body (DeleteCertificatesBulkBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500]
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
    body: DeleteCertificatesBulkBody,
) -> DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500 | None:
    """Bulk delete certificates (must be revoked or expired > 90 days)

    Args:
        body (DeleteCertificatesBulkBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    body: DeleteCertificatesBulkBody,
) -> Response[
    DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500
]:
    """Bulk delete certificates (must be revoked or expired > 90 days)

    Args:
        body (DeleteCertificatesBulkBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    body: DeleteCertificatesBulkBody,
) -> DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500 | None:
    """Bulk delete certificates (must be revoked or expired > 90 days)

    Args:
        body (DeleteCertificatesBulkBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteCertificatesBulkResponse200 | DeleteCertificatesBulkResponse400 | DeleteCertificatesBulkResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
