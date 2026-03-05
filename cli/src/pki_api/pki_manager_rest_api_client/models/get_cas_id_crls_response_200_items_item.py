from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_cas_id_crls_response_200_items_item_validity_status import (
    GetCasIdCrlsResponse200ItemsItemValidityStatus,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetCasIdCrlsResponse200ItemsItem")


@_attrs_define
class GetCasIdCrlsResponse200ItemsItem:
    """
    Attributes:
        id (UUID | Unset):
        crl_number (int | Unset):
        this_update (datetime.datetime | Unset):
        next_update (datetime.datetime | Unset):
        validity_status (GetCasIdCrlsResponse200ItemsItemValidityStatus | Unset):
        revoked_count (int | Unset):
        created_at (datetime.datetime | Unset):
    """

    id: UUID | Unset = UNSET
    crl_number: int | Unset = UNSET
    this_update: datetime.datetime | Unset = UNSET
    next_update: datetime.datetime | Unset = UNSET
    validity_status: GetCasIdCrlsResponse200ItemsItemValidityStatus | Unset = UNSET
    revoked_count: int | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        crl_number = self.crl_number

        this_update: str | Unset = UNSET
        if not isinstance(self.this_update, Unset):
            this_update = self.this_update.isoformat()

        next_update: str | Unset = UNSET
        if not isinstance(self.next_update, Unset):
            next_update = self.next_update.isoformat()

        validity_status: str | Unset = UNSET
        if not isinstance(self.validity_status, Unset):
            validity_status = self.validity_status.value

        revoked_count = self.revoked_count

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if crl_number is not UNSET:
            field_dict["crlNumber"] = crl_number
        if this_update is not UNSET:
            field_dict["thisUpdate"] = this_update
        if next_update is not UNSET:
            field_dict["nextUpdate"] = next_update
        if validity_status is not UNSET:
            field_dict["validityStatus"] = validity_status
        if revoked_count is not UNSET:
            field_dict["revokedCount"] = revoked_count
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _id = d.pop("id", UNSET)
        id: UUID | Unset
        if isinstance(_id, Unset):
            id = UNSET
        else:
            id = UUID(_id)

        crl_number = d.pop("crlNumber", UNSET)

        _this_update = d.pop("thisUpdate", UNSET)
        this_update: datetime.datetime | Unset
        if isinstance(_this_update, Unset):
            this_update = UNSET
        else:
            this_update = isoparse(_this_update)

        _next_update = d.pop("nextUpdate", UNSET)
        next_update: datetime.datetime | Unset
        if isinstance(_next_update, Unset):
            next_update = UNSET
        else:
            next_update = isoparse(_next_update)

        _validity_status = d.pop("validityStatus", UNSET)
        validity_status: GetCasIdCrlsResponse200ItemsItemValidityStatus | Unset
        if isinstance(_validity_status, Unset):
            validity_status = UNSET
        else:
            validity_status = GetCasIdCrlsResponse200ItemsItemValidityStatus(_validity_status)

        revoked_count = d.pop("revokedCount", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)

        get_cas_id_crls_response_200_items_item = cls(
            id=id,
            crl_number=crl_number,
            this_update=this_update,
            next_update=next_update,
            validity_status=validity_status,
            revoked_count=revoked_count,
            created_at=created_at,
        )

        get_cas_id_crls_response_200_items_item.additional_properties = d
        return get_cas_id_crls_response_200_items_item

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
