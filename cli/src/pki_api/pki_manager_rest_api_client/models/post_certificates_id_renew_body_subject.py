from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesIdRenewBodySubject")


@_attrs_define
class PostCertificatesIdRenewBodySubject:
    """New subject information (requires updateInfo=true)

    Attributes:
        common_name (str | Unset):
        organization (str | Unset):
        organizational_unit (str | Unset):
        country (str | Unset):
        state (str | Unset):
        locality (str | Unset):
    """

    common_name: str | Unset = UNSET
    organization: str | Unset = UNSET
    organizational_unit: str | Unset = UNSET
    country: str | Unset = UNSET
    state: str | Unset = UNSET
    locality: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        common_name = self.common_name

        organization = self.organization

        organizational_unit = self.organizational_unit

        country = self.country

        state = self.state

        locality = self.locality

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if common_name is not UNSET:
            field_dict["commonName"] = common_name
        if organization is not UNSET:
            field_dict["organization"] = organization
        if organizational_unit is not UNSET:
            field_dict["organizationalUnit"] = organizational_unit
        if country is not UNSET:
            field_dict["country"] = country
        if state is not UNSET:
            field_dict["state"] = state
        if locality is not UNSET:
            field_dict["locality"] = locality

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        common_name = d.pop("commonName", UNSET)

        organization = d.pop("organization", UNSET)

        organizational_unit = d.pop("organizationalUnit", UNSET)

        country = d.pop("country", UNSET)

        state = d.pop("state", UNSET)

        locality = d.pop("locality", UNSET)

        post_certificates_id_renew_body_subject = cls(
            common_name=common_name,
            organization=organization,
            organizational_unit=organizational_unit,
            country=country,
            state=state,
            locality=locality,
        )

        post_certificates_id_renew_body_subject.additional_properties = d
        return post_certificates_id_renew_body_subject

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
