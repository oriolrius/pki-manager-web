from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetCertificatesIdResponse200IssuingCA")


@_attrs_define
class GetCertificatesIdResponse200IssuingCA:
    """
    Attributes:
        id (UUID | Unset):
        subject_dn (str | Unset):
        serial_number (str | Unset):
    """

    id: UUID | Unset = UNSET
    subject_dn: str | Unset = UNSET
    serial_number: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        subject_dn = self.subject_dn

        serial_number = self.serial_number

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if subject_dn is not UNSET:
            field_dict["subjectDn"] = subject_dn
        if serial_number is not UNSET:
            field_dict["serialNumber"] = serial_number

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

        subject_dn = d.pop("subjectDn", UNSET)

        serial_number = d.pop("serialNumber", UNSET)

        get_certificates_id_response_200_issuing_ca = cls(
            id=id,
            subject_dn=subject_dn,
            serial_number=serial_number,
        )

        get_certificates_id_response_200_issuing_ca.additional_properties = d
        return get_certificates_id_response_200_issuing_ca

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
