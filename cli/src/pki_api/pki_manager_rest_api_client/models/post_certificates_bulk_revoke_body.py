from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_certificates_bulk_revoke_body_reason import PostCertificatesBulkRevokeBodyReason
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesBulkRevokeBody")


@_attrs_define
class PostCertificatesBulkRevokeBody:
    """
    Attributes:
        certificate_ids (list[UUID]): Array of certificate IDs to revoke
        reason (PostCertificatesBulkRevokeBodyReason): Revocation reason
        details (str | Unset): Additional details about the revocation
        generate_crl (bool | Unset): Generate a new CRL after revocation Default: True.
    """

    certificate_ids: list[UUID]
    reason: PostCertificatesBulkRevokeBodyReason
    details: str | Unset = UNSET
    generate_crl: bool | Unset = True
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = []
        for certificate_ids_item_data in self.certificate_ids:
            certificate_ids_item = str(certificate_ids_item_data)
            certificate_ids.append(certificate_ids_item)

        reason = self.reason.value

        details = self.details

        generate_crl = self.generate_crl

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "certificateIds": certificate_ids,
                "reason": reason,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details
        if generate_crl is not UNSET:
            field_dict["generateCrl"] = generate_crl

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        certificate_ids = []
        _certificate_ids = d.pop("certificateIds")
        for certificate_ids_item_data in _certificate_ids:
            certificate_ids_item = UUID(certificate_ids_item_data)

            certificate_ids.append(certificate_ids_item)

        reason = PostCertificatesBulkRevokeBodyReason(d.pop("reason"))

        details = d.pop("details", UNSET)

        generate_crl = d.pop("generateCrl", UNSET)

        post_certificates_bulk_revoke_body = cls(
            certificate_ids=certificate_ids,
            reason=reason,
            details=details,
            generate_crl=generate_crl,
        )

        post_certificates_bulk_revoke_body.additional_properties = d
        return post_certificates_bulk_revoke_body

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
