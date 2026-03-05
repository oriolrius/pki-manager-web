from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.bulk_revoke_certificates_request_reason import BulkRevokeCertificatesRequestReason
from ..types import UNSET, Unset

T = TypeVar("T", bound="BulkRevokeCertificatesRequest")


@_attrs_define
class BulkRevokeCertificatesRequest:
    """
    Attributes:
        certificate_ids (list[str]):
        reason (BulkRevokeCertificatesRequestReason):
        details (str | Unset):
        generate_crl (bool | Unset):  Default: True.
    """

    certificate_ids: list[str]
    reason: BulkRevokeCertificatesRequestReason
    details: str | Unset = UNSET
    generate_crl: bool | Unset = True

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = self.certificate_ids

        reason = self.reason.value

        details = self.details

        generate_crl = self.generate_crl

        field_dict: dict[str, Any] = {}

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
        certificate_ids = cast(list[str], d.pop("certificateIds"))

        reason = BulkRevokeCertificatesRequestReason(d.pop("reason"))

        details = d.pop("details", UNSET)

        generate_crl = d.pop("generateCrl", UNSET)

        bulk_revoke_certificates_request = cls(
            certificate_ids=certificate_ids,
            reason=reason,
            details=details,
            generate_crl=generate_crl,
        )

        return bulk_revoke_certificates_request
