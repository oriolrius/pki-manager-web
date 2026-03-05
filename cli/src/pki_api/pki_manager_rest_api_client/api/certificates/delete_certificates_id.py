from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_certificates_id_response_200 import DeleteCertificatesIdResponse200
from ...models.delete_certificates_id_response_404 import DeleteCertificatesIdResponse404
from ...models.delete_certificates_id_response_409 import DeleteCertificatesIdResponse409
from ...models.delete_certificates_id_response_500 import DeleteCertificatesIdResponse500
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    destroy_key: bool | Unset = False,
    remove_from_crl: bool | Unset = False,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["destroyKey"] = destroy_key

    params["removeFromCrl"] = remove_from_crl

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/certificates/{id}".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteCertificatesIdResponse200
    | DeleteCertificatesIdResponse404
    | DeleteCertificatesIdResponse409
    | DeleteCertificatesIdResponse500
    | None
):
    if response.status_code == 200:
        response_200 = DeleteCertificatesIdResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = DeleteCertificatesIdResponse404.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = DeleteCertificatesIdResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 500:
        response_500 = DeleteCertificatesIdResponse500.from_dict(response.json())

        return response_500

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteCertificatesIdResponse200
    | DeleteCertificatesIdResponse404
    | DeleteCertificatesIdResponse409
    | DeleteCertificatesIdResponse500
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
    destroy_key: bool | Unset = False,
    remove_from_crl: bool | Unset = False,
) -> Response[
    DeleteCertificatesIdResponse200
    | DeleteCertificatesIdResponse404
    | DeleteCertificatesIdResponse409
    | DeleteCertificatesIdResponse500
]:
    """Delete a revoked or expired certificate. Certificate must be revoked or expired for more than 90
    days.

    Args:
        id (UUID):
        destroy_key (bool | Unset):  Default: False.
        remove_from_crl (bool | Unset):  Default: False.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteCertificatesIdResponse200 | DeleteCertificatesIdResponse404 | DeleteCertificatesIdResponse409 | DeleteCertificatesIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        destroy_key=destroy_key,
        remove_from_crl=remove_from_crl,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    destroy_key: bool | Unset = False,
    remove_from_crl: bool | Unset = False,
) -> (
    DeleteCertificatesIdResponse200
    | DeleteCertificatesIdResponse404
    | DeleteCertificatesIdResponse409
    | DeleteCertificatesIdResponse500
    | None
):
    """Delete a revoked or expired certificate. Certificate must be revoked or expired for more than 90
    days.

    Args:
        id (UUID):
        destroy_key (bool | Unset):  Default: False.
        remove_from_crl (bool | Unset):  Default: False.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteCertificatesIdResponse200 | DeleteCertificatesIdResponse404 | DeleteCertificatesIdResponse409 | DeleteCertificatesIdResponse500
    """

    return sync_detailed(
        id=id,
        client=client,
        destroy_key=destroy_key,
        remove_from_crl=remove_from_crl,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    destroy_key: bool | Unset = False,
    remove_from_crl: bool | Unset = False,
) -> Response[
    DeleteCertificatesIdResponse200
    | DeleteCertificatesIdResponse404
    | DeleteCertificatesIdResponse409
    | DeleteCertificatesIdResponse500
]:
    """Delete a revoked or expired certificate. Certificate must be revoked or expired for more than 90
    days.

    Args:
        id (UUID):
        destroy_key (bool | Unset):  Default: False.
        remove_from_crl (bool | Unset):  Default: False.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteCertificatesIdResponse200 | DeleteCertificatesIdResponse404 | DeleteCertificatesIdResponse409 | DeleteCertificatesIdResponse500]
    """

    kwargs = _get_kwargs(
        id=id,
        destroy_key=destroy_key,
        remove_from_crl=remove_from_crl,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient | Client,
    destroy_key: bool | Unset = False,
    remove_from_crl: bool | Unset = False,
) -> (
    DeleteCertificatesIdResponse200
    | DeleteCertificatesIdResponse404
    | DeleteCertificatesIdResponse409
    | DeleteCertificatesIdResponse500
    | None
):
    """Delete a revoked or expired certificate. Certificate must be revoked or expired for more than 90
    days.

    Args:
        id (UUID):
        destroy_key (bool | Unset):  Default: False.
        remove_from_crl (bool | Unset):  Default: False.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteCertificatesIdResponse200 | DeleteCertificatesIdResponse404 | DeleteCertificatesIdResponse409 | DeleteCertificatesIdResponse500
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            destroy_key=destroy_key,
            remove_from_crl=remove_from_crl,
        )
    ).parsed
