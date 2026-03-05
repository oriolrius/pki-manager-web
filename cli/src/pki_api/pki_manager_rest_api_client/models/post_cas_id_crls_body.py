from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCasIdCrlsBody")


@_attrs_define
class PostCasIdCrlsBody:
    """
    Attributes:
        next_update_days (int | Unset): Number of days until the CRL expires Default: 7.
    """

    next_update_days: int | Unset = 7
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        next_update_days = self.next_update_days

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if next_update_days is not UNSET:
            field_dict["nextUpdateDays"] = next_update_days

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        next_update_days = d.pop("nextUpdateDays", UNSET)

        post_cas_id_crls_body = cls(
            next_update_days=next_update_days,
        )

        post_cas_id_crls_body.additional_properties = d
        return post_cas_id_crls_body

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
