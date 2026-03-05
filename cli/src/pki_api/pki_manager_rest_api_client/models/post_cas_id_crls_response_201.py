from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCasIdCrlsResponse201")


@_attrs_define
class PostCasIdCrlsResponse201:
    """
    Attributes:
        id (UUID | Unset):
        crl_number (int | Unset):
        this_update (datetime.datetime | Unset):
        next_update (datetime.datetime | Unset):
        revoked_count (int | Unset):
        note (str | Unset):
    """

    id: UUID | Unset = UNSET
    crl_number: int | Unset = UNSET
    this_update: datetime.datetime | Unset = UNSET
    next_update: datetime.datetime | Unset = UNSET
    revoked_count: int | Unset = UNSET
    note: str | Unset = UNSET
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

        revoked_count = self.revoked_count

        note = self.note

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
        if revoked_count is not UNSET:
            field_dict["revokedCount"] = revoked_count
        if note is not UNSET:
            field_dict["note"] = note

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

        revoked_count = d.pop("revokedCount", UNSET)

        note = d.pop("note", UNSET)

        post_cas_id_crls_response_201 = cls(
            id=id,
            crl_number=crl_number,
            this_update=this_update,
            next_update=next_update,
            revoked_count=revoked_count,
            note=note,
        )

        post_cas_id_crls_response_201.additional_properties = d
        return post_cas_id_crls_response_201

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
