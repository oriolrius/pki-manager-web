from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_search_response_200_results_domains_item_type import GetSearchResponse200ResultsDomainsItemType
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_search_response_200_results_domains_item_metadata import (
        GetSearchResponse200ResultsDomainsItemMetadata,
    )


T = TypeVar("T", bound="GetSearchResponse200ResultsDomainsItem")


@_attrs_define
class GetSearchResponse200ResultsDomainsItem:
    """
    Attributes:
        id (str | Unset):
        type_ (GetSearchResponse200ResultsDomainsItemType | Unset):
        title (str | Unset):
        subtitle (str | Unset):
        status (str | Unset):
        metadata (GetSearchResponse200ResultsDomainsItemMetadata | Unset):
    """

    id: str | Unset = UNSET
    type_: GetSearchResponse200ResultsDomainsItemType | Unset = UNSET
    title: str | Unset = UNSET
    subtitle: str | Unset = UNSET
    status: str | Unset = UNSET
    metadata: GetSearchResponse200ResultsDomainsItemMetadata | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_: str | Unset = UNSET
        if not isinstance(self.type_, Unset):
            type_ = self.type_.value

        title = self.title

        subtitle = self.subtitle

        status = self.status

        metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.metadata, Unset):
            metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if type_ is not UNSET:
            field_dict["type"] = type_
        if title is not UNSET:
            field_dict["title"] = title
        if subtitle is not UNSET:
            field_dict["subtitle"] = subtitle
        if status is not UNSET:
            field_dict["status"] = status
        if metadata is not UNSET:
            field_dict["metadata"] = metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_search_response_200_results_domains_item_metadata import (
            GetSearchResponse200ResultsDomainsItemMetadata,
        )

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        _type_ = d.pop("type", UNSET)
        type_: GetSearchResponse200ResultsDomainsItemType | Unset
        if isinstance(_type_, Unset):
            type_ = UNSET
        else:
            type_ = GetSearchResponse200ResultsDomainsItemType(_type_)

        title = d.pop("title", UNSET)

        subtitle = d.pop("subtitle", UNSET)

        status = d.pop("status", UNSET)

        _metadata = d.pop("metadata", UNSET)
        metadata: GetSearchResponse200ResultsDomainsItemMetadata | Unset
        if isinstance(_metadata, Unset):
            metadata = UNSET
        else:
            metadata = GetSearchResponse200ResultsDomainsItemMetadata.from_dict(_metadata)

        get_search_response_200_results_domains_item = cls(
            id=id,
            type_=type_,
            title=title,
            subtitle=subtitle,
            status=status,
            metadata=metadata,
        )

        get_search_response_200_results_domains_item.additional_properties = d
        return get_search_response_200_results_domains_item

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
