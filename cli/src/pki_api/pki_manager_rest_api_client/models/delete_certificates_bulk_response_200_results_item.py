from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="DeleteCertificatesBulkResponse200ResultsItem")


@_attrs_define
class DeleteCertificatesBulkResponse200ResultsItem:
    """
    Attributes:
        certificate_id (UUID | Unset):
        success (bool | Unset):
        error (str | Unset):
    """

    certificate_id: UUID | Unset = UNSET
    success: bool | Unset = UNSET
    error: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        certificate_id: str | Unset = UNSET
        if not isinstance(self.certificate_id, Unset):
            certificate_id = str(self.certificate_id)

        success = self.success

        error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if certificate_id is not UNSET:
            field_dict["certificateId"] = certificate_id
        if success is not UNSET:
            field_dict["success"] = success
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _certificate_id = d.pop("certificateId", UNSET)
        certificate_id: UUID | Unset
        if isinstance(_certificate_id, Unset):
            certificate_id = UNSET
        else:
            certificate_id = UUID(_certificate_id)

        success = d.pop("success", UNSET)

        error = d.pop("error", UNSET)

        delete_certificates_bulk_response_200_results_item = cls(
            certificate_id=certificate_id,
            success=success,
            error=error,
        )

        delete_certificates_bulk_response_200_results_item.additional_properties = d
        return delete_certificates_bulk_response_200_results_item

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
