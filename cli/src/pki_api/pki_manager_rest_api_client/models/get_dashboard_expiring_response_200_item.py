from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetDashboardExpiringResponse200Item")


@_attrs_define
class GetDashboardExpiringResponse200Item:
    """
    Attributes:
        id (str | Unset):
        type_ (str | Unset):
        cn (str | Unset):
        san (str | Unset):
        not_after (datetime.datetime | Unset):
        days_remaining (int | Unset):
    """

    id: str | Unset = UNSET
    type_: str | Unset = UNSET
    cn: str | Unset = UNSET
    san: str | Unset = UNSET
    not_after: datetime.datetime | Unset = UNSET
    days_remaining: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        cn = self.cn

        san = self.san

        not_after: str | Unset = UNSET
        if not isinstance(self.not_after, Unset):
            not_after = self.not_after.isoformat()

        days_remaining = self.days_remaining

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if type_ is not UNSET:
            field_dict["type"] = type_
        if cn is not UNSET:
            field_dict["cn"] = cn
        if san is not UNSET:
            field_dict["san"] = san
        if not_after is not UNSET:
            field_dict["notAfter"] = not_after
        if days_remaining is not UNSET:
            field_dict["daysRemaining"] = days_remaining

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id", UNSET)

        type_ = d.pop("type", UNSET)

        cn = d.pop("cn", UNSET)

        san = d.pop("san", UNSET)

        _not_after = d.pop("notAfter", UNSET)
        not_after: datetime.datetime | Unset
        if isinstance(_not_after, Unset):
            not_after = UNSET
        else:
            not_after = isoparse(_not_after)

        days_remaining = d.pop("daysRemaining", UNSET)

        get_dashboard_expiring_response_200_item = cls(
            id=id,
            type_=type_,
            cn=cn,
            san=san,
            not_after=not_after,
            days_remaining=days_remaining,
        )

        get_dashboard_expiring_response_200_item.additional_properties = d
        return get_dashboard_expiring_response_200_item

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
