from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_cas_id_crls_response_200_items_item import GetCasIdCrlsResponse200ItemsItem
    from ..models.get_cas_id_crls_response_200_pagination import GetCasIdCrlsResponse200Pagination


T = TypeVar("T", bound="GetCasIdCrlsResponse200")


@_attrs_define
class GetCasIdCrlsResponse200:
    """
    Attributes:
        items (list[GetCasIdCrlsResponse200ItemsItem] | Unset):
        pagination (GetCasIdCrlsResponse200Pagination | Unset):
    """

    items: list[GetCasIdCrlsResponse200ItemsItem] | Unset = UNSET
    pagination: GetCasIdCrlsResponse200Pagination | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        items: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.items, Unset):
            items = []
            for items_item_data in self.items:
                items_item = items_item_data.to_dict()
                items.append(items_item)

        pagination: dict[str, Any] | Unset = UNSET
        if not isinstance(self.pagination, Unset):
            pagination = self.pagination.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if items is not UNSET:
            field_dict["items"] = items
        if pagination is not UNSET:
            field_dict["pagination"] = pagination

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_cas_id_crls_response_200_items_item import GetCasIdCrlsResponse200ItemsItem
        from ..models.get_cas_id_crls_response_200_pagination import GetCasIdCrlsResponse200Pagination

        d = dict(src_dict)
        _items = d.pop("items", UNSET)
        items: list[GetCasIdCrlsResponse200ItemsItem] | Unset = UNSET
        if _items is not UNSET:
            items = []
            for items_item_data in _items:
                items_item = GetCasIdCrlsResponse200ItemsItem.from_dict(items_item_data)

                items.append(items_item)

        _pagination = d.pop("pagination", UNSET)
        pagination: GetCasIdCrlsResponse200Pagination | Unset
        if isinstance(_pagination, Unset):
            pagination = UNSET
        else:
            pagination = GetCasIdCrlsResponse200Pagination.from_dict(_pagination)

        get_cas_id_crls_response_200 = cls(
            items=items,
            pagination=pagination,
        )

        get_cas_id_crls_response_200.additional_properties = d
        return get_cas_id_crls_response_200

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
