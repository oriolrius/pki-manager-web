from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetCrlRequest")


@_attrs_define
class GetCrlRequest:
    """
    Attributes:
        ca_id (str):
        crl_number (int | Unset):
    """

    ca_id: str
    crl_number: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        ca_id = self.ca_id

        crl_number = self.crl_number

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "caId": ca_id,
            }
        )
        if crl_number is not UNSET:
            field_dict["crlNumber"] = crl_number

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ca_id = d.pop("caId")

        crl_number = d.pop("crlNumber", UNSET)

        get_crl_request = cls(
            ca_id=ca_id,
            crl_number=crl_number,
        )

        return get_crl_request
