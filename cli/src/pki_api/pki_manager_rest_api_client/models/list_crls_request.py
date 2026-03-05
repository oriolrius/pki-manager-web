from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="ListCrlsRequest")


@_attrs_define
class ListCrlsRequest:
    """
    Attributes:
        ca_id (str):
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.
    """

    ca_id: str
    limit: int | Unset = 50
    offset: int | Unset = 0

    def to_dict(self) -> dict[str, Any]:
        ca_id = self.ca_id

        limit = self.limit

        offset = self.offset

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "caId": ca_id,
            }
        )
        if limit is not UNSET:
            field_dict["limit"] = limit
        if offset is not UNSET:
            field_dict["offset"] = offset

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ca_id = d.pop("caId")

        limit = d.pop("limit", UNSET)

        offset = d.pop("offset", UNSET)

        list_crls_request = cls(
            ca_id=ca_id,
            limit=limit,
            offset=offset,
        )

        return list_crls_request
