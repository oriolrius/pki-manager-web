from http import HTTPStatus
from typing import Any
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_certificates_response_200 import GetCertificatesResponse200
from ...models.get_certificates_sort_by import GetCertificatesSortBy
from ...models.get_certificates_sort_order import GetCertificatesSortOrder
from ...models.get_certificates_status import GetCertificatesStatus
from ...models.get_certificates_type import GetCertificatesType
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    status: GetCertificatesStatus | Unset = UNSET,
    type_: GetCertificatesType | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    search: str | Unset = UNSET,
    sort_by: GetCertificatesSortBy | Unset = GetCertificatesSortBy.CREATEDAT,
    sort_order: GetCertificatesSortOrder | Unset = GetCertificatesSortOrder.DESC,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    json_type_: str | Unset = UNSET
    if not isinstance(type_, Unset):
        json_type_ = type_.value

    params["type"] = json_type_

    json_ca_id: str | Unset = UNSET
    if not isinstance(ca_id, Unset):
        json_ca_id = str(ca_id)
    params["caId"] = json_ca_id

    params["search"] = search

    json_sort_by: str | Unset = UNSET
    if not isinstance(sort_by, Unset):
        json_sort_by = sort_by.value

    params["sortBy"] = json_sort_by

    json_sort_order: str | Unset = UNSET
    if not isinstance(sort_order, Unset):
        json_sort_order = sort_order.value

    params["sortOrder"] = json_sort_order

    params["limit"] = limit

    params["offset"] = offset

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/certificates/",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetCertificatesResponse200 | None:
    if response.status_code == 200:
        response_200 = GetCertificatesResponse200.from_dict(response.json())

        return response_200

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetCertificatesResponse200]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    status: GetCertificatesStatus | Unset = UNSET,
    type_: GetCertificatesType | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    search: str | Unset = UNSET,
    sort_by: GetCertificatesSortBy | Unset = GetCertificatesSortBy.CREATEDAT,
    sort_order: GetCertificatesSortOrder | Unset = GetCertificatesSortOrder.DESC,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetCertificatesResponse200]:
    """List certificates with optional filtering, sorting, and pagination

    Args:
        status (GetCertificatesStatus | Unset):
        type_ (GetCertificatesType | Unset):
        ca_id (UUID | Unset):
        search (str | Unset):
        sort_by (GetCertificatesSortBy | Unset):  Default: GetCertificatesSortBy.CREATEDAT.
        sort_order (GetCertificatesSortOrder | Unset):  Default: GetCertificatesSortOrder.DESC.
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCertificatesResponse200]
    """

    kwargs = _get_kwargs(
        status=status,
        type_=type_,
        ca_id=ca_id,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
    status: GetCertificatesStatus | Unset = UNSET,
    type_: GetCertificatesType | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    search: str | Unset = UNSET,
    sort_by: GetCertificatesSortBy | Unset = GetCertificatesSortBy.CREATEDAT,
    sort_order: GetCertificatesSortOrder | Unset = GetCertificatesSortOrder.DESC,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetCertificatesResponse200 | None:
    """List certificates with optional filtering, sorting, and pagination

    Args:
        status (GetCertificatesStatus | Unset):
        type_ (GetCertificatesType | Unset):
        ca_id (UUID | Unset):
        search (str | Unset):
        sort_by (GetCertificatesSortBy | Unset):  Default: GetCertificatesSortBy.CREATEDAT.
        sort_order (GetCertificatesSortOrder | Unset):  Default: GetCertificatesSortOrder.DESC.
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCertificatesResponse200
    """

    return sync_detailed(
        client=client,
        status=status,
        type_=type_,
        ca_id=ca_id,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    status: GetCertificatesStatus | Unset = UNSET,
    type_: GetCertificatesType | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    search: str | Unset = UNSET,
    sort_by: GetCertificatesSortBy | Unset = GetCertificatesSortBy.CREATEDAT,
    sort_order: GetCertificatesSortOrder | Unset = GetCertificatesSortOrder.DESC,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> Response[GetCertificatesResponse200]:
    """List certificates with optional filtering, sorting, and pagination

    Args:
        status (GetCertificatesStatus | Unset):
        type_ (GetCertificatesType | Unset):
        ca_id (UUID | Unset):
        search (str | Unset):
        sort_by (GetCertificatesSortBy | Unset):  Default: GetCertificatesSortBy.CREATEDAT.
        sort_order (GetCertificatesSortOrder | Unset):  Default: GetCertificatesSortOrder.DESC.
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetCertificatesResponse200]
    """

    kwargs = _get_kwargs(
        status=status,
        type_=type_,
        ca_id=ca_id,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    status: GetCertificatesStatus | Unset = UNSET,
    type_: GetCertificatesType | Unset = UNSET,
    ca_id: UUID | Unset = UNSET,
    search: str | Unset = UNSET,
    sort_by: GetCertificatesSortBy | Unset = GetCertificatesSortBy.CREATEDAT,
    sort_order: GetCertificatesSortOrder | Unset = GetCertificatesSortOrder.DESC,
    limit: int | Unset = 50,
    offset: int | Unset = 0,
) -> GetCertificatesResponse200 | None:
    """List certificates with optional filtering, sorting, and pagination

    Args:
        status (GetCertificatesStatus | Unset):
        type_ (GetCertificatesType | Unset):
        ca_id (UUID | Unset):
        search (str | Unset):
        sort_by (GetCertificatesSortBy | Unset):  Default: GetCertificatesSortBy.CREATEDAT.
        sort_order (GetCertificatesSortOrder | Unset):  Default: GetCertificatesSortOrder.DESC.
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetCertificatesResponse200
    """

    return (
        await asyncio_detailed(
            client=client,
            status=status,
            type_=type_,
            ca_id=ca_id,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
            limit=limit,
            offset=offset,
        )
    ).parsed
