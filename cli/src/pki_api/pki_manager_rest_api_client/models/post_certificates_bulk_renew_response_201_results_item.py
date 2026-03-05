from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesBulkRenewResponse201ResultsItem")


@_attrs_define
class PostCertificatesBulkRenewResponse201ResultsItem:
    """
    Attributes:
        original_certificate_id (UUID | Unset):
        new_certificate_id (UUID | Unset):
        success (bool | Unset):
        error (str | Unset):
    """

    original_certificate_id: UUID | Unset = UNSET
    new_certificate_id: UUID | Unset = UNSET
    success: bool | Unset = UNSET
    error: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        original_certificate_id: str | Unset = UNSET
        if not isinstance(self.original_certificate_id, Unset):
            original_certificate_id = str(self.original_certificate_id)

        new_certificate_id: str | Unset = UNSET
        if not isinstance(self.new_certificate_id, Unset):
            new_certificate_id = str(self.new_certificate_id)

        success = self.success

        error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if original_certificate_id is not UNSET:
            field_dict["originalCertificateId"] = original_certificate_id
        if new_certificate_id is not UNSET:
            field_dict["newCertificateId"] = new_certificate_id
        if success is not UNSET:
            field_dict["success"] = success
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _original_certificate_id = d.pop("originalCertificateId", UNSET)
        original_certificate_id: UUID | Unset
        if isinstance(_original_certificate_id, Unset):
            original_certificate_id = UNSET
        else:
            original_certificate_id = UUID(_original_certificate_id)

        _new_certificate_id = d.pop("newCertificateId", UNSET)
        new_certificate_id: UUID | Unset
        if isinstance(_new_certificate_id, Unset):
            new_certificate_id = UNSET
        else:
            new_certificate_id = UUID(_new_certificate_id)

        success = d.pop("success", UNSET)

        error = d.pop("error", UNSET)

        post_certificates_bulk_renew_response_201_results_item = cls(
            original_certificate_id=original_certificate_id,
            new_certificate_id=new_certificate_id,
            success=success,
            error=error,
        )

        post_certificates_bulk_renew_response_201_results_item.additional_properties = d
        return post_certificates_bulk_renew_response_201_results_item

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
