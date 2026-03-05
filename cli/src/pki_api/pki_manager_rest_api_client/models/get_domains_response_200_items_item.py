from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetDomainsResponse200ItemsItem")


@_attrs_define
class GetDomainsResponse200ItemsItem:
    """
    Attributes:
        domain (str | Unset):
        is_wildcard (bool | Unset):
        base_domain (str | Unset):
        certificate_count (int | Unset):
        ca_count (int | Unset):
        first_certificate_date (datetime.datetime | Unset):
        last_certificate_date (datetime.datetime | Unset):
        active_certificate_count (int | Unset):
        revoked_certificate_count (int | Unset):
    """

    domain: str | Unset = UNSET
    is_wildcard: bool | Unset = UNSET
    base_domain: str | Unset = UNSET
    certificate_count: int | Unset = UNSET
    ca_count: int | Unset = UNSET
    first_certificate_date: datetime.datetime | Unset = UNSET
    last_certificate_date: datetime.datetime | Unset = UNSET
    active_certificate_count: int | Unset = UNSET
    revoked_certificate_count: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        domain = self.domain

        is_wildcard = self.is_wildcard

        base_domain = self.base_domain

        certificate_count = self.certificate_count

        ca_count = self.ca_count

        first_certificate_date: str | Unset = UNSET
        if not isinstance(self.first_certificate_date, Unset):
            first_certificate_date = self.first_certificate_date.isoformat()

        last_certificate_date: str | Unset = UNSET
        if not isinstance(self.last_certificate_date, Unset):
            last_certificate_date = self.last_certificate_date.isoformat()

        active_certificate_count = self.active_certificate_count

        revoked_certificate_count = self.revoked_certificate_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if domain is not UNSET:
            field_dict["domain"] = domain
        if is_wildcard is not UNSET:
            field_dict["isWildcard"] = is_wildcard
        if base_domain is not UNSET:
            field_dict["baseDomain"] = base_domain
        if certificate_count is not UNSET:
            field_dict["certificateCount"] = certificate_count
        if ca_count is not UNSET:
            field_dict["caCount"] = ca_count
        if first_certificate_date is not UNSET:
            field_dict["firstCertificateDate"] = first_certificate_date
        if last_certificate_date is not UNSET:
            field_dict["lastCertificateDate"] = last_certificate_date
        if active_certificate_count is not UNSET:
            field_dict["activeCertificateCount"] = active_certificate_count
        if revoked_certificate_count is not UNSET:
            field_dict["revokedCertificateCount"] = revoked_certificate_count

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        domain = d.pop("domain", UNSET)

        is_wildcard = d.pop("isWildcard", UNSET)

        base_domain = d.pop("baseDomain", UNSET)

        certificate_count = d.pop("certificateCount", UNSET)

        ca_count = d.pop("caCount", UNSET)

        _first_certificate_date = d.pop("firstCertificateDate", UNSET)
        first_certificate_date: datetime.datetime | Unset
        if isinstance(_first_certificate_date, Unset):
            first_certificate_date = UNSET
        else:
            first_certificate_date = isoparse(_first_certificate_date)

        _last_certificate_date = d.pop("lastCertificateDate", UNSET)
        last_certificate_date: datetime.datetime | Unset
        if isinstance(_last_certificate_date, Unset):
            last_certificate_date = UNSET
        else:
            last_certificate_date = isoparse(_last_certificate_date)

        active_certificate_count = d.pop("activeCertificateCount", UNSET)

        revoked_certificate_count = d.pop("revokedCertificateCount", UNSET)

        get_domains_response_200_items_item = cls(
            domain=domain,
            is_wildcard=is_wildcard,
            base_domain=base_domain,
            certificate_count=certificate_count,
            ca_count=ca_count,
            first_certificate_date=first_certificate_date,
            last_certificate_date=last_certificate_date,
            active_certificate_count=active_certificate_count,
            revoked_certificate_count=revoked_certificate_count,
        )

        get_domains_response_200_items_item.additional_properties = d
        return get_domains_response_200_items_item

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
