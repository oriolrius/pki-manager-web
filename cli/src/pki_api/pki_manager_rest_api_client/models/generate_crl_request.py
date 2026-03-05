from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GenerateCrlRequest")


@_attrs_define
class GenerateCrlRequest:
    """
    Attributes:
        ca_id (str):
        next_update_days (int | Unset):  Default: 7.
    """

    ca_id: str
    next_update_days: int | Unset = 7

    def to_dict(self) -> dict[str, Any]:
        ca_id = self.ca_id

        next_update_days = self.next_update_days

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "caId": ca_id,
            }
        )
        if next_update_days is not UNSET:
            field_dict["nextUpdateDays"] = next_update_days

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ca_id = d.pop("caId")

        next_update_days = d.pop("nextUpdateDays", UNSET)

        generate_crl_request = cls(
            ca_id=ca_id,
            next_update_days=next_update_days,
        )

        return generate_crl_request
