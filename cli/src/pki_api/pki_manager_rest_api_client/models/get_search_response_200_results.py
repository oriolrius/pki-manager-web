from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_search_response_200_results_cas_item import GetSearchResponse200ResultsCasItem
    from ..models.get_search_response_200_results_certificates_item import GetSearchResponse200ResultsCertificatesItem
    from ..models.get_search_response_200_results_domains_item import GetSearchResponse200ResultsDomainsItem


T = TypeVar("T", bound="GetSearchResponse200Results")


@_attrs_define
class GetSearchResponse200Results:
    """
    Attributes:
        cas (list[GetSearchResponse200ResultsCasItem] | Unset):
        certificates (list[GetSearchResponse200ResultsCertificatesItem] | Unset):
        domains (list[GetSearchResponse200ResultsDomainsItem] | Unset):
    """

    cas: list[GetSearchResponse200ResultsCasItem] | Unset = UNSET
    certificates: list[GetSearchResponse200ResultsCertificatesItem] | Unset = UNSET
    domains: list[GetSearchResponse200ResultsDomainsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        cas: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.cas, Unset):
            cas = []
            for cas_item_data in self.cas:
                cas_item = cas_item_data.to_dict()
                cas.append(cas_item)

        certificates: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.certificates, Unset):
            certificates = []
            for certificates_item_data in self.certificates:
                certificates_item = certificates_item_data.to_dict()
                certificates.append(certificates_item)

        domains: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.domains, Unset):
            domains = []
            for domains_item_data in self.domains:
                domains_item = domains_item_data.to_dict()
                domains.append(domains_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if cas is not UNSET:
            field_dict["cas"] = cas
        if certificates is not UNSET:
            field_dict["certificates"] = certificates
        if domains is not UNSET:
            field_dict["domains"] = domains

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_search_response_200_results_cas_item import GetSearchResponse200ResultsCasItem
        from ..models.get_search_response_200_results_certificates_item import (
            GetSearchResponse200ResultsCertificatesItem,
        )
        from ..models.get_search_response_200_results_domains_item import GetSearchResponse200ResultsDomainsItem

        d = dict(src_dict)
        _cas = d.pop("cas", UNSET)
        cas: list[GetSearchResponse200ResultsCasItem] | Unset = UNSET
        if _cas is not UNSET:
            cas = []
            for cas_item_data in _cas:
                cas_item = GetSearchResponse200ResultsCasItem.from_dict(cas_item_data)

                cas.append(cas_item)

        _certificates = d.pop("certificates", UNSET)
        certificates: list[GetSearchResponse200ResultsCertificatesItem] | Unset = UNSET
        if _certificates is not UNSET:
            certificates = []
            for certificates_item_data in _certificates:
                certificates_item = GetSearchResponse200ResultsCertificatesItem.from_dict(certificates_item_data)

                certificates.append(certificates_item)

        _domains = d.pop("domains", UNSET)
        domains: list[GetSearchResponse200ResultsDomainsItem] | Unset = UNSET
        if _domains is not UNSET:
            domains = []
            for domains_item_data in _domains:
                domains_item = GetSearchResponse200ResultsDomainsItem.from_dict(domains_item_data)

                domains.append(domains_item)

        get_search_response_200_results = cls(
            cas=cas,
            certificates=certificates,
            domains=domains,
        )

        get_search_response_200_results.additional_properties = d
        return get_search_response_200_results

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
