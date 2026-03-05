from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_certificates_bulk_renew_response_201_results_item import (
        PostCertificatesBulkRenewResponse201ResultsItem,
    )


T = TypeVar("T", bound="PostCertificatesBulkRenewResponse201")


@_attrs_define
class PostCertificatesBulkRenewResponse201:
    """
    Attributes:
        successful (int | Unset):
        failed (int | Unset):
        results (list[PostCertificatesBulkRenewResponse201ResultsItem] | Unset):
    """

    successful: int | Unset = UNSET
    failed: int | Unset = UNSET
    results: list[PostCertificatesBulkRenewResponse201ResultsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        successful = self.successful

        failed = self.failed

        results: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.results, Unset):
            results = []
            for results_item_data in self.results:
                results_item = results_item_data.to_dict()
                results.append(results_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if successful is not UNSET:
            field_dict["successful"] = successful
        if failed is not UNSET:
            field_dict["failed"] = failed
        if results is not UNSET:
            field_dict["results"] = results

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_certificates_bulk_renew_response_201_results_item import (
            PostCertificatesBulkRenewResponse201ResultsItem,
        )

        d = dict(src_dict)
        successful = d.pop("successful", UNSET)

        failed = d.pop("failed", UNSET)

        _results = d.pop("results", UNSET)
        results: list[PostCertificatesBulkRenewResponse201ResultsItem] | Unset = UNSET
        if _results is not UNSET:
            results = []
            for results_item_data in _results:
                results_item = PostCertificatesBulkRenewResponse201ResultsItem.from_dict(results_item_data)

                results.append(results_item)

        post_certificates_bulk_renew_response_201 = cls(
            successful=successful,
            failed=failed,
            results=results,
        )

        post_certificates_bulk_renew_response_201.additional_properties = d
        return post_certificates_bulk_renew_response_201

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
