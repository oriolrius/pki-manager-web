from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="DeleteCertificatesBulkBody")


@_attrs_define
class DeleteCertificatesBulkBody:
    """
    Attributes:
        certificate_ids (list[UUID]): Array of certificate IDs to delete
        destroy_key (bool | Unset): Also destroy the private key in KMS Default: True.
        remove_from_crl (bool | Unset): Remove from CRL (not recommended) Default: False.
    """

    certificate_ids: list[UUID]
    destroy_key: bool | Unset = True
    remove_from_crl: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = []
        for certificate_ids_item_data in self.certificate_ids:
            certificate_ids_item = str(certificate_ids_item_data)
            certificate_ids.append(certificate_ids_item)

        destroy_key = self.destroy_key

        remove_from_crl = self.remove_from_crl

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
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
        certificate_ids = []
        _certificate_ids = d.pop("certificateIds")
        for certificate_ids_item_data in _certificate_ids:
            certificate_ids_item = UUID(certificate_ids_item_data)

            certificate_ids.append(certificate_ids_item)

        destroy_key = d.pop("destroyKey", UNSET)

        remove_from_crl = d.pop("removeFromCrl", UNSET)

        delete_certificates_bulk_body = cls(
            certificate_ids=certificate_ids,
            destroy_key=destroy_key,
            remove_from_crl=remove_from_crl,
        )

        delete_certificates_bulk_body.additional_properties = d
        return delete_certificates_bulk_body

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
