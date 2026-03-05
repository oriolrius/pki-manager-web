from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="BulkDeleteCertificatesRequest")


@_attrs_define
class BulkDeleteCertificatesRequest:
    """
    Attributes:
        certificate_ids (list[str]):
        destroy_key (bool | Unset):  Default: True.
        remove_from_crl (bool | Unset):  Default: False.
    """

    certificate_ids: list[str]
    destroy_key: bool | Unset = True
    remove_from_crl: bool | Unset = False

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = self.certificate_ids

        destroy_key = self.destroy_key

        remove_from_crl = self.remove_from_crl

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "certificateIds": certificate_ids,
            }
        )
        if destroy_key is not UNSET:
            field_dict["destroyKey"] = destroy_key
        if remove_from_crl is not UNSET:
            field_dict["removeFromCrl"] = remove_from_crl

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        certificate_ids = cast(list[str], d.pop("certificateIds"))

        destroy_key = d.pop("destroyKey", UNSET)

        remove_from_crl = d.pop("removeFromCrl", UNSET)

        bulk_delete_certificates_request = cls(
            certificate_ids=certificate_ids,
            destroy_key=destroy_key,
            remove_from_crl=remove_from_crl,
        )

        return bulk_delete_certificates_request
