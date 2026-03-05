from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesBulkIssueResponse201ResultsItem")


@_attrs_define
class PostCertificatesBulkIssueResponse201ResultsItem:
    """
    Attributes:
        row (int | Unset):
        success (bool | Unset):
        certificate_id (UUID | Unset):
        subject (str | Unset):
        serial_number (str | Unset):
        error (str | Unset):
    """

    row: int | Unset = UNSET
    success: bool | Unset = UNSET
    certificate_id: UUID | Unset = UNSET
    subject: str | Unset = UNSET
    serial_number: str | Unset = UNSET
    error: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        row = self.row

        success = self.success

        certificate_id: str | Unset = UNSET
        if not isinstance(self.certificate_id, Unset):
            certificate_id = str(self.certificate_id)

        subject = self.subject

        serial_number = self.serial_number

        error = self.error

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if row is not UNSET:
            field_dict["row"] = row
        if success is not UNSET:
            field_dict["success"] = success
        if certificate_id is not UNSET:
            field_dict["certificateId"] = certificate_id
        if subject is not UNSET:
            field_dict["subject"] = subject
        if serial_number is not UNSET:
            field_dict["serialNumber"] = serial_number
        if error is not UNSET:
            field_dict["error"] = error

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        row = d.pop("row", UNSET)

        success = d.pop("success", UNSET)

        _certificate_id = d.pop("certificateId", UNSET)
        certificate_id: UUID | Unset
        if isinstance(_certificate_id, Unset):
            certificate_id = UNSET
        else:
            certificate_id = UUID(_certificate_id)

        subject = d.pop("subject", UNSET)

        serial_number = d.pop("serialNumber", UNSET)

        error = d.pop("error", UNSET)

        post_certificates_bulk_issue_response_201_results_item = cls(
            row=row,
            success=success,
            certificate_id=certificate_id,
            subject=subject,
            serial_number=serial_number,
            error=error,
        )

        post_certificates_bulk_issue_response_201_results_item.additional_properties = d
        return post_certificates_bulk_issue_response_201_results_item

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
