from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.post_cas_response_201_status import PostCasResponse201Status
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCasResponse201")


@_attrs_define
class PostCasResponse201:
    """
    Attributes:
        id (UUID | Unset):
        subject (str | Unset):
        serial_number (str | Unset):
        not_before (datetime.datetime | Unset):
        not_after (datetime.datetime | Unset):
        status (PostCasResponse201Status | Unset):
    """

    id: UUID | Unset = UNSET
    subject: str | Unset = UNSET
    serial_number: str | Unset = UNSET
    not_before: datetime.datetime | Unset = UNSET
    not_after: datetime.datetime | Unset = UNSET
    status: PostCasResponse201Status | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        subject = self.subject

        serial_number = self.serial_number

        not_before: str | Unset = UNSET
        if not isinstance(self.not_before, Unset):
            not_before = self.not_before.isoformat()

        not_after: str | Unset = UNSET
        if not isinstance(self.not_after, Unset):
            not_after = self.not_after.isoformat()

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if subject is not UNSET:
            field_dict["subject"] = subject
        if serial_number is not UNSET:
            field_dict["serialNumber"] = serial_number
        if not_before is not UNSET:
            field_dict["notBefore"] = not_before
        if not_after is not UNSET:
            field_dict["notAfter"] = not_after
        if status is not UNSET:
            field_dict["status"] = status

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
        status: PostCasResponse201Status | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = PostCasResponse201Status(_status)

        post_cas_response_201 = cls(
            id=id,
            subject=subject,
            serial_number=serial_number,
            not_before=not_before,
            not_after=not_after,
            status=status,
        )

        post_cas_response_201.additional_properties = d
        return post_cas_response_201

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
