from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetCasIdResponse200Fingerprints")


@_attrs_define
class GetCasIdResponse200Fingerprints:
    """
    Attributes:
        sha256 (str | Unset):
        sha1 (str | Unset):
    """

    sha256: str | Unset = UNSET
    sha1: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        sha256 = self.sha256

        sha1 = self.sha1

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if sha256 is not UNSET:
            field_dict["sha256"] = sha256
        if sha1 is not UNSET:
            field_dict["sha1"] = sha1

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sha256 = d.pop("sha256", UNSET)

        sha1 = d.pop("sha1", UNSET)

        get_cas_id_response_200_fingerprints = cls(
            sha256=sha256,
            sha1=sha1,
        )

        get_cas_id_response_200_fingerprints.additional_properties = d
        return get_cas_id_response_200_fingerprints

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
