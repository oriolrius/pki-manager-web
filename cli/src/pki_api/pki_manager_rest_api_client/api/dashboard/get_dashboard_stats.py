from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_dashboard_stats_response_200 import GetDashboardStatsResponse200
from ...models.get_dashboard_stats_response_500 import GetDashboardStatsResponse500
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/dashboard/stats",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetDashboardStatsResponse200 | GetDashboardStatsResponse500 | None:
    if response.status_code == 200:
        response_200 = GetDashboardStatsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 500:
        response_500 = GetDashboardStatsResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetDashboardStatsResponse200 | GetDashboardStatsResponse500]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[GetDashboardStatsResponse200 | GetDashboardStatsResponse500]:
    """Get dashboard statistics (CA and certificate counts)

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetDashboardStatsResponse200 | GetDashboardStatsResponse500]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> GetDashboardStatsResponse200 | GetDashboardStatsResponse500 | None:
    """Get dashboard statistics (CA and certificate counts)

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetDashboardStatsResponse200 | GetDashboardStatsResponse500
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[GetDashboardStatsResponse200 | GetDashboardStatsResponse500]:
    """Get dashboard statistics (CA and certificate counts)

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetDashboardStatsResponse200 | GetDashboardStatsResponse500]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> GetDashboardStatsResponse200 | GetDashboardStatsResponse500 | None:
    """Get dashboard statistics (CA and certificate counts)

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetDashboardStatsResponse200 | GetDashboardStatsResponse500
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
