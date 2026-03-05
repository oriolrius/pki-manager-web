from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.revoke_certificate_request_reason import RevokeCertificateRequestReason
from ..types import UNSET, Unset

T = TypeVar("T", bound="RevokeCertificateRequest")


@_attrs_define
class RevokeCertificateRequest:
    """
    Attributes:
        id (str):
        reason (RevokeCertificateRequestReason):
        effective_date (int | Unset):
        details (str | Unset):
        generate_crl (bool | Unset):  Default: True.
    """

    id: str
    reason: RevokeCertificateRequestReason
    effective_date: int | Unset = UNSET
    details: str | Unset = UNSET
    generate_crl: bool | Unset = True

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        reason = self.reason.value

        effective_date = self.effective_date

        details = self.details

        generate_crl = self.generate_crl

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "reason": reason,
            }
        )
        if effective_date is not UNSET:
            field_dict["effectiveDate"] = effective_date
        if details is not UNSET:
            field_dict["details"] = details
        if generate_crl is not UNSET:
            field_dict["generateCrl"] = generate_crl

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        reason = RevokeCertificateRequestReason(d.pop("reason"))

        effective_date = d.pop("effectiveDate", UNSET)

        details = d.pop("details", UNSET)

        generate_crl = d.pop("generateCrl", UNSET)

        revoke_certificate_request = cls(
            id=id,
            reason=reason,
            effective_date=effective_date,
            details=details,
            generate_crl=generate_crl,
        )

        return revoke_certificate_request
