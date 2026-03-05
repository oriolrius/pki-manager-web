from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="DeleteCasIdResponse200")


@_attrs_define
class DeleteCasIdResponse200:
    """
    Attributes:
        success (bool | Unset):
        ca_id (UUID | Unset):
        key_destroyed (bool | Unset):
        crls_deleted (int | Unset):
    """

    success: bool | Unset = UNSET
    ca_id: UUID | Unset = UNSET
    key_destroyed: bool | Unset = UNSET
    crls_deleted: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        ca_id: str | Unset = UNSET
        if not isinstance(self.ca_id, Unset):
            ca_id = str(self.ca_id)

        key_destroyed = self.key_destroyed

        crls_deleted = self.crls_deleted

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if success is not UNSET:
            field_dict["success"] = success
        if ca_id is not UNSET:
            field_dict["caId"] = ca_id
        if key_destroyed is not UNSET:
            field_dict["keyDestroyed"] = key_destroyed
        if crls_deleted is not UNSET:
            field_dict["crlsDeleted"] = crls_deleted

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        success = d.pop("success", UNSET)

        _ca_id = d.pop("caId", UNSET)
        ca_id: UUID | Unset
        if isinstance(_ca_id, Unset):
            ca_id = UNSET
        else:
            ca_id = UUID(_ca_id)

        key_destroyed = d.pop("keyDestroyed", UNSET)

        crls_deleted = d.pop("crlsDeleted", UNSET)

        delete_cas_id_response_200 = cls(
            success=success,
            ca_id=ca_id,
            key_destroyed=key_destroyed,
            crls_deleted=crls_deleted,
        )

        delete_cas_id_response_200.additional_properties = d
        return delete_cas_id_response_200

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
