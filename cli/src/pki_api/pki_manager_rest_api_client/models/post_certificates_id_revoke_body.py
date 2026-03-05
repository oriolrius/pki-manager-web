from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_certificates_id_revoke_body_reason import PostCertificatesIdRevokeBodyReason
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesIdRevokeBody")


@_attrs_define
class PostCertificatesIdRevokeBody:
    """
    Attributes:
        reason (PostCertificatesIdRevokeBodyReason):
        details (str | Unset):
        effective_date (int | Unset): Unix timestamp for effective revocation date
        generate_crl (bool | Unset): Generate a new CRL after revocation Default: False.
    """

    reason: PostCertificatesIdRevokeBodyReason
    details: str | Unset = UNSET
    effective_date: int | Unset = UNSET
    generate_crl: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason.value

        details = self.details

        effective_date = self.effective_date

        generate_crl = self.generate_crl

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "reason": reason,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details
        if effective_date is not UNSET:
            field_dict["effectiveDate"] = effective_date
        if generate_crl is not UNSET:
            field_dict["generateCrl"] = generate_crl

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = PostCertificatesIdRevokeBodyReason(d.pop("reason"))

        details = d.pop("details", UNSET)

        effective_date = d.pop("effectiveDate", UNSET)

        generate_crl = d.pop("generateCrl", UNSET)

        post_certificates_id_revoke_body = cls(
            reason=reason,
            details=details,
            effective_date=effective_date,
            generate_crl=generate_crl,
        )

        post_certificates_id_revoke_body.additional_properties = d
        return post_certificates_id_revoke_body

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
