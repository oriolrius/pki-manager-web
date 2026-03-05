from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesBodySubject")


@_attrs_define
class PostCertificatesBodySubject:
    """
    Attributes:
        common_name (str):
        organization (str):
        country (str):
        organizational_unit (str | Unset):
        state (str | Unset):
        locality (str | Unset):
    """

    common_name: str
    organization: str
    country: str
    organizational_unit: str | Unset = UNSET
    state: str | Unset = UNSET
    locality: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        common_name = self.common_name

        organization = self.organization

        country = self.country

        organizational_unit = self.organizational_unit

        state = self.state

        locality = self.locality

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "commonName": common_name,
                "organization": organization,
                "country": country,
            }
        )
        if organizational_unit is not UNSET:
            field_dict["organizationalUnit"] = organizational_unit
        if state is not UNSET:
            field_dict["state"] = state
        if locality is not UNSET:
            field_dict["locality"] = locality

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        common_name = d.pop("commonName")

        organization = d.pop("organization")

        country = d.pop("country")

        organizational_unit = d.pop("organizationalUnit", UNSET)

        state = d.pop("state", UNSET)

        locality = d.pop("locality", UNSET)

        post_certificates_body_subject = cls(
            common_name=common_name,
            organization=organization,
            country=country,
            organizational_unit=organizational_unit,
            state=state,
            locality=locality,
        )

        post_certificates_body_subject.additional_properties = d
        return post_certificates_body_subject

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
