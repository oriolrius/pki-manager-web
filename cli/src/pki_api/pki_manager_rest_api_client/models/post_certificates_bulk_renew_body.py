from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesBulkRenewBody")


@_attrs_define
class PostCertificatesBulkRenewBody:
    """
    Attributes:
        certificate_ids (list[UUID]): Array of certificate IDs to renew
        generate_new_key (bool | Unset): Generate a new key pair for the renewed certificate Default: True.
        validity_days (int | Unset): Validity period in days (defaults to original validity)
        revoke_original (bool | Unset): Revoke the original certificate after renewal Default: False.
    """

    certificate_ids: list[UUID]
    generate_new_key: bool | Unset = True
    validity_days: int | Unset = UNSET
    revoke_original: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = []
        for certificate_ids_item_data in self.certificate_ids:
            certificate_ids_item = str(certificate_ids_item_data)
            certificate_ids.append(certificate_ids_item)

        generate_new_key = self.generate_new_key

        validity_days = self.validity_days

        revoke_original = self.revoke_original

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "certificateIds": certificate_ids,
            }
        )
        if generate_new_key is not UNSET:
            field_dict["generateNewKey"] = generate_new_key
        if validity_days is not UNSET:
            field_dict["validityDays"] = validity_days
        if revoke_original is not UNSET:
            field_dict["revokeOriginal"] = revoke_original

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        certificate_ids = []
        _certificate_ids = d.pop("certificateIds")
        for certificate_ids_item_data in _certificate_ids:
            certificate_ids_item = UUID(certificate_ids_item_data)

            certificate_ids.append(certificate_ids_item)

        generate_new_key = d.pop("generateNewKey", UNSET)

        validity_days = d.pop("validityDays", UNSET)

        revoke_original = d.pop("revokeOriginal", UNSET)

        post_certificates_bulk_renew_body = cls(
            certificate_ids=certificate_ids,
            generate_new_key=generate_new_key,
            validity_days=validity_days,
            revoke_original=revoke_original,
        )

        post_certificates_bulk_renew_body.additional_properties = d
        return post_certificates_bulk_renew_body

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
