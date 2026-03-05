from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_search_response_200_results import GetSearchResponse200Results


T = TypeVar("T", bound="GetSearchResponse200")


@_attrs_define
class GetSearchResponse200:
    """
    Attributes:
        query (str | Unset):
        results (GetSearchResponse200Results | Unset):
        total_count (int | Unset):
    """

    query: str | Unset = UNSET
    results: GetSearchResponse200Results | Unset = UNSET
    total_count: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        query = self.query

        results: dict[str, Any] | Unset = UNSET
        if not isinstance(self.results, Unset):
            results = self.results.to_dict()

        total_count = self.total_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if query is not UNSET:
            field_dict["query"] = query
        if results is not UNSET:
            field_dict["results"] = results
        if total_count is not UNSET:
            field_dict["totalCount"] = total_count

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_search_response_200_results import GetSearchResponse200Results

        d = dict(src_dict)
        query = d.pop("query", UNSET)

        _results = d.pop("results", UNSET)
        results: GetSearchResponse200Results | Unset
        if isinstance(_results, Unset):
            results = UNSET
        else:
            results = GetSearchResponse200Results.from_dict(_results)

        total_count = d.pop("totalCount", UNSET)

        get_search_response_200 = cls(
            query=query,
            results=results,
            total_count=total_count,
        )

        get_search_response_200.additional_properties = d
        return get_search_response_200

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
