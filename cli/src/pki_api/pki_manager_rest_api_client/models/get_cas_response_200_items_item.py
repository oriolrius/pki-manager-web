from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_cas_response_200_items_item_status import GetCasResponse200ItemsItemStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetCasResponse200ItemsItem")


@_attrs_define
class GetCasResponse200ItemsItem:
    """
    Attributes:
        id (UUID | Unset):
        subject (str | Unset):
        serial_number (str | Unset):
        key_algorithm (None | str | Unset):
        not_before (datetime.datetime | Unset):
        not_after (datetime.datetime | Unset):
        status (GetCasResponse200ItemsItemStatus | Unset):
        certificate_count (int | Unset):
        created_at (datetime.datetime | Unset):
    """

    id: UUID | Unset = UNSET
    subject: str | Unset = UNSET
    serial_number: str | Unset = UNSET
    key_algorithm: None | str | Unset = UNSET
    not_before: datetime.datetime | Unset = UNSET
    not_after: datetime.datetime | Unset = UNSET
    status: GetCasResponse200ItemsItemStatus | Unset = UNSET
    certificate_count: int | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        subject = self.subject

        serial_number = self.serial_number

        key_algorithm: None | str | Unset
        if isinstance(self.key_algorithm, Unset):
            key_algorithm = UNSET
        else:
            key_algorithm = self.key_algorithm

        not_before: str | Unset = UNSET
        if not isinstance(self.not_before, Unset):
            not_before = self.not_before.isoformat()

        not_after: str | Unset = UNSET
        if not isinstance(self.not_after, Unset):
            not_after = self.not_after.isoformat()

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        certificate_count = self.certificate_count

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if subject is not UNSET:
            field_dict["subject"] = subject
        if serial_number is not UNSET:
            field_dict["serialNumber"] = serial_number
        if key_algorithm is not UNSET:
            field_dict["keyAlgorithm"] = key_algorithm
        if not_before is not UNSET:
            field_dict["notBefore"] = not_before
        if not_after is not UNSET:
            field_dict["notAfter"] = not_after
        if status is not UNSET:
            field_dict["status"] = status
        if certificate_count is not UNSET:
            field_dict["certificateCount"] = certificate_count
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

        subject = d.pop("subject", UNSET)

        serial_number = d.pop("serialNumber", UNSET)

        def _parse_key_algorithm(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        key_algorithm = _parse_key_algorithm(d.pop("keyAlgorithm", UNSET))

        _not_before = d.pop("notBefore", UNSET)
        not_before: datetime.datetime | Unset
        if isinstance(_not_before, Unset):
            not_before = UNSET
        else:
            not_before = isoparse(_not_before)

        _not_after = d.pop("notAfter", UNSET)
        not_after: datetime.datetime | Unset
        if isinstance(_not_after, Unset):
            not_after = UNSET
        else:
            not_after = isoparse(_not_after)

        _status = d.pop("status", UNSET)
        status: GetCasResponse200ItemsItemStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = GetCasResponse200ItemsItemStatus(_status)

        certificate_count = d.pop("certificateCount", UNSET)

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)

        get_cas_response_200_items_item = cls(
            id=id,
            subject=subject,
            serial_number=serial_number,
            key_algorithm=key_algorithm,
            not_before=not_before,
            not_after=not_after,
            status=status,
            certificate_count=certificate_count,
            created_at=created_at,
        )

        get_cas_response_200_items_item.additional_properties = d
        return get_cas_response_200_items_item

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
