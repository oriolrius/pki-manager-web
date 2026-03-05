from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetDashboardStatsResponse200")


@_attrs_define
class GetDashboardStatsResponse200:
    """
    Attributes:
        total_c_as (int | Unset):
        active_c_as (int | Unset):
        total_certificates (int | Unset):
        active_certificates (int | Unset):
    """

    total_c_as: int | Unset = UNSET
    active_c_as: int | Unset = UNSET
    total_certificates: int | Unset = UNSET
    active_certificates: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        total_c_as = self.total_c_as

        active_c_as = self.active_c_as

        total_certificates = self.total_certificates

        active_certificates = self.active_certificates

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if total_c_as is not UNSET:
            field_dict["totalCAs"] = total_c_as
        if active_c_as is not UNSET:
            field_dict["activeCAs"] = active_c_as
        if total_certificates is not UNSET:
            field_dict["totalCertificates"] = total_certificates
        if active_certificates is not UNSET:
            field_dict["activeCertificates"] = active_certificates

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        total_c_as = d.pop("totalCAs", UNSET)

        active_c_as = d.pop("activeCAs", UNSET)

        total_certificates = d.pop("totalCertificates", UNSET)

        active_certificates = d.pop("activeCertificates", UNSET)

        get_dashboard_stats_response_200 = cls(
            total_c_as=total_c_as,
            active_c_as=active_c_as,
            total_certificates=total_certificates,
            active_certificates=active_certificates,
        )

        get_dashboard_stats_response_200.additional_properties = d
        return get_dashboard_stats_response_200

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
