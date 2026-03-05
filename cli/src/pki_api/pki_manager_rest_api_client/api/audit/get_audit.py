from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_audit_response_200 import GetAuditResponse200
from ...models.get_audit_response_400 import GetAuditResponse400
from ...models.get_audit_response_500 import GetAuditResponse500
from ...models.get_audit_status import GetAuditStatus
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    operation: str | Unset = UNSET,
    entity_type: str | Unset = UNSET,
    entity_id: str | Unset = UNSET,
    status: GetAuditStatus | Unset = UNSET,
    start_date: int | Unset = UNSET,
    end_date: int | Unset = UNSET,
    limit: int | Unset = 100,
    offset: int | Unset = 0,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["operation"] = operation

    params["entityType"] = entity_type

    params["entityId"] = entity_id

    json_status: str | Unset = UNSET
    if not isinstance(status, Unset):
        json_status = status.value

    params["status"] = json_status

    params["startDate"] = start_date

    params["endDate"] = end_date

    params["limit"] = limit

    params["offset"] = offset

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/audit",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500 | None:
    if response.status_code == 200:
        response_200 = GetAuditResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = GetAuditResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 500:
        response_500 = GetAuditResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
    operation: str | Unset = UNSET,
    entity_type: str | Unset = UNSET,
    entity_id: str | Unset = UNSET,
    status: GetAuditStatus | Unset = UNSET,
    start_date: int | Unset = UNSET,
    end_date: int | Unset = UNSET,
    limit: int | Unset = 100,
    offset: int | Unset = 0,
) -> Response[GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500]:
    """Get audit log entries with filtering

    Args:
        operation (str | Unset):
        entity_type (str | Unset):
        entity_id (str | Unset):
        status (GetAuditStatus | Unset):
        start_date (int | Unset):
        end_date (int | Unset):
        limit (int | Unset):  Default: 100.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500]
    """

    kwargs = _get_kwargs(
        operation=operation,
        entity_type=entity_type,
        entity_id=entity_id,
        status=status,
        start_date=start_date,
        end_date=end_date,
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
    operation: str | Unset = UNSET,
    entity_type: str | Unset = UNSET,
    entity_id: str | Unset = UNSET,
    status: GetAuditStatus | Unset = UNSET,
    start_date: int | Unset = UNSET,
    end_date: int | Unset = UNSET,
    limit: int | Unset = 100,
    offset: int | Unset = 0,
) -> GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500 | None:
    """Get audit log entries with filtering

    Args:
        operation (str | Unset):
        entity_type (str | Unset):
        entity_id (str | Unset):
        status (GetAuditStatus | Unset):
        start_date (int | Unset):
        end_date (int | Unset):
        limit (int | Unset):  Default: 100.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500
    """

    return sync_detailed(
        client=client,
        operation=operation,
        entity_type=entity_type,
        entity_id=entity_id,
        status=status,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
    operation: str | Unset = UNSET,
    entity_type: str | Unset = UNSET,
    entity_id: str | Unset = UNSET,
    status: GetAuditStatus | Unset = UNSET,
    start_date: int | Unset = UNSET,
    end_date: int | Unset = UNSET,
    limit: int | Unset = 100,
    offset: int | Unset = 0,
) -> Response[GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500]:
    """Get audit log entries with filtering

    Args:
        operation (str | Unset):
        entity_type (str | Unset):
        entity_id (str | Unset):
        status (GetAuditStatus | Unset):
        start_date (int | Unset):
        end_date (int | Unset):
        limit (int | Unset):  Default: 100.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500]
    """

    kwargs = _get_kwargs(
        operation=operation,
        entity_type=entity_type,
        entity_id=entity_id,
        status=status,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
    operation: str | Unset = UNSET,
    entity_type: str | Unset = UNSET,
    entity_id: str | Unset = UNSET,
    status: GetAuditStatus | Unset = UNSET,
    start_date: int | Unset = UNSET,
    end_date: int | Unset = UNSET,
    limit: int | Unset = 100,
    offset: int | Unset = 0,
) -> GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500 | None:
    """Get audit log entries with filtering

    Args:
        operation (str | Unset):
        entity_type (str | Unset):
        entity_id (str | Unset):
        status (GetAuditStatus | Unset):
        start_date (int | Unset):
        end_date (int | Unset):
        limit (int | Unset):  Default: 100.
        offset (int | Unset):  Default: 0.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAuditResponse200 | GetAuditResponse400 | GetAuditResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
            operation=operation,
            entity_type=entity_type,
            entity_id=entity_id,
            status=status,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset,
        )
    ).parsed
