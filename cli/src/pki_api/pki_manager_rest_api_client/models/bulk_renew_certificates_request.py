from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="BulkRenewCertificatesRequest")


@_attrs_define
class BulkRenewCertificatesRequest:
    """
    Attributes:
        certificate_ids (list[str]):
        generate_new_key (bool | Unset):  Default: True.
        validity_days (int | Unset):
        revoke_original (bool | Unset):  Default: False.
    """

    certificate_ids: list[str]
    generate_new_key: bool | Unset = True
    validity_days: int | Unset = UNSET
    revoke_original: bool | Unset = False

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = self.certificate_ids

        generate_new_key = self.generate_new_key

        validity_days = self.validity_days

        revoke_original = self.revoke_original

        field_dict: dict[str, Any] = {}

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
        certificate_ids = cast(list[str], d.pop("certificateIds"))

        generate_new_key = d.pop("generateNewKey", UNSET)

        validity_days = d.pop("validityDays", UNSET)

        revoke_original = d.pop("revokeOriginal", UNSET)

        bulk_renew_certificates_request = cls(
            certificate_ids=certificate_ids,
            generate_new_key=generate_new_key,
            validity_days=validity_days,
            revoke_original=revoke_original,
        )

        return bulk_renew_certificates_request
