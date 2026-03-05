from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="BulkCreateCertificatesRequest")


@_attrs_define
class BulkCreateCertificatesRequest:
    """
    Attributes:
        ca_id (str):
        csv_data (str):
        default_validity_days (int | Unset):
    """

    ca_id: str
    csv_data: str
    default_validity_days: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        ca_id = self.ca_id

        csv_data = self.csv_data

        default_validity_days = self.default_validity_days

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "caId": ca_id,
                "csvData": csv_data,
            }
        )
        if default_validity_days is not UNSET:
            field_dict["defaultValidityDays"] = default_validity_days

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ca_id = d.pop("caId")

        csv_data = d.pop("csvData")

        default_validity_days = d.pop("defaultValidityDays", UNSET)

        bulk_create_certificates_request = cls(
            ca_id=ca_id,
            csv_data=csv_data,
            default_validity_days=default_validity_days,
        )

        return bulk_create_certificates_request
