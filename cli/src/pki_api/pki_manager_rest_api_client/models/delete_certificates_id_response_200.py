from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="DeleteCertificatesIdResponse200")


@_attrs_define
class DeleteCertificatesIdResponse200:
    """
    Attributes:
        id (UUID | Unset):
        deleted (bool | Unset):
        kms_key_destroyed (bool | Unset):
    """

    id: UUID | Unset = UNSET
    deleted: bool | Unset = UNSET
    kms_key_destroyed: bool | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        deleted = self.deleted

        kms_key_destroyed = self.kms_key_destroyed

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if deleted is not UNSET:
            field_dict["deleted"] = deleted
        if kms_key_destroyed is not UNSET:
            field_dict["kmsKeyDestroyed"] = kms_key_destroyed

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

        deleted = d.pop("deleted", UNSET)

        kms_key_destroyed = d.pop("kmsKeyDestroyed", UNSET)

        delete_certificates_id_response_200 = cls(
            id=id,
            deleted=deleted,
            kms_key_destroyed=kms_key_destroyed,
        )

        delete_certificates_id_response_200.additional_properties = d
        return delete_certificates_id_response_200

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
