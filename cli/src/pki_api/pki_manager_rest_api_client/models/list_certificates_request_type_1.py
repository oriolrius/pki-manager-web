from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from dateutil.parser import isoparse

from ..models.list_certificates_request_type_1_certificate_type import ListCertificatesRequestType1CertificateType
from ..models.list_certificates_request_type_1_expiry_status import ListCertificatesRequestType1ExpiryStatus
from ..models.list_certificates_request_type_1_sort_by import ListCertificatesRequestType1SortBy
from ..models.list_certificates_request_type_1_sort_order import ListCertificatesRequestType1SortOrder
from ..models.list_certificates_request_type_1_status import ListCertificatesRequestType1Status
from ..types import UNSET, Unset

T = TypeVar("T", bound="ListCertificatesRequestType1")


@_attrs_define
class ListCertificatesRequestType1:
    """
    Attributes:
        ca_id (str | Unset):
        status (ListCertificatesRequestType1Status | Unset):
        certificate_type (ListCertificatesRequestType1CertificateType | Unset):
        domain (str | Unset):
        expiry_status (ListCertificatesRequestType1ExpiryStatus | Unset):
        issued_after (datetime.datetime | Unset):
        issued_before (datetime.datetime | Unset):
        expires_after (datetime.datetime | Unset):
        expires_before (datetime.datetime | Unset):
        search (str | Unset):
        sort_by (ListCertificatesRequestType1SortBy | Unset):  Default: ListCertificatesRequestType1SortBy.CREATEDAT.
        sort_order (ListCertificatesRequestType1SortOrder | Unset):  Default:
            ListCertificatesRequestType1SortOrder.DESC.
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.
    """

    ca_id: str | Unset = UNSET
    status: ListCertificatesRequestType1Status | Unset = UNSET
    certificate_type: ListCertificatesRequestType1CertificateType | Unset = UNSET
    domain: str | Unset = UNSET
    expiry_status: ListCertificatesRequestType1ExpiryStatus | Unset = UNSET
    issued_after: datetime.datetime | Unset = UNSET
    issued_before: datetime.datetime | Unset = UNSET
    expires_after: datetime.datetime | Unset = UNSET
    expires_before: datetime.datetime | Unset = UNSET
    search: str | Unset = UNSET
    sort_by: ListCertificatesRequestType1SortBy | Unset = ListCertificatesRequestType1SortBy.CREATEDAT
    sort_order: ListCertificatesRequestType1SortOrder | Unset = ListCertificatesRequestType1SortOrder.DESC
    limit: int | Unset = 50
    offset: int | Unset = 0

    def to_dict(self) -> dict[str, Any]:
        ca_id = self.ca_id

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        certificate_type: str | Unset = UNSET
        if not isinstance(self.certificate_type, Unset):
            certificate_type = self.certificate_type.value

        domain = self.domain

        expiry_status: str | Unset = UNSET
        if not isinstance(self.expiry_status, Unset):
            expiry_status = self.expiry_status.value

        issued_after: str | Unset = UNSET
        if not isinstance(self.issued_after, Unset):
            issued_after = self.issued_after.isoformat()

        issued_before: str | Unset = UNSET
        if not isinstance(self.issued_before, Unset):
            issued_before = self.issued_before.isoformat()

        expires_after: str | Unset = UNSET
        if not isinstance(self.expires_after, Unset):
            expires_after = self.expires_after.isoformat()

        expires_before: str | Unset = UNSET
        if not isinstance(self.expires_before, Unset):
            expires_before = self.expires_before.isoformat()

        search = self.search

        sort_by: str | Unset = UNSET
        if not isinstance(self.sort_by, Unset):
            sort_by = self.sort_by.value

        sort_order: str | Unset = UNSET
        if not isinstance(self.sort_order, Unset):
            sort_order = self.sort_order.value

        limit = self.limit

        offset = self.offset

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if ca_id is not UNSET:
            field_dict["caId"] = ca_id
        if status is not UNSET:
            field_dict["status"] = status
        if certificate_type is not UNSET:
            field_dict["certificateType"] = certificate_type
        if domain is not UNSET:
            field_dict["domain"] = domain
        if expiry_status is not UNSET:
            field_dict["expiryStatus"] = expiry_status
        if issued_after is not UNSET:
            field_dict["issuedAfter"] = issued_after
        if issued_before is not UNSET:
            field_dict["issuedBefore"] = issued_before
        if expires_after is not UNSET:
            field_dict["expiresAfter"] = expires_after
        if expires_before is not UNSET:
            field_dict["expiresBefore"] = expires_before
        if search is not UNSET:
            field_dict["search"] = search
        if sort_by is not UNSET:
            field_dict["sortBy"] = sort_by
        if sort_order is not UNSET:
            field_dict["sortOrder"] = sort_order
        if limit is not UNSET:
            field_dict["limit"] = limit
        if offset is not UNSET:
            field_dict["offset"] = offset

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        ca_id = d.pop("caId", UNSET)

        _status = d.pop("status", UNSET)
        status: ListCertificatesRequestType1Status | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = ListCertificatesRequestType1Status(_status)

        _certificate_type = d.pop("certificateType", UNSET)
        certificate_type: ListCertificatesRequestType1CertificateType | Unset
        if isinstance(_certificate_type, Unset):
            certificate_type = UNSET
        else:
            certificate_type = ListCertificatesRequestType1CertificateType(_certificate_type)

        domain = d.pop("domain", UNSET)

        _expiry_status = d.pop("expiryStatus", UNSET)
        expiry_status: ListCertificatesRequestType1ExpiryStatus | Unset
        if isinstance(_expiry_status, Unset):
            expiry_status = UNSET
        else:
            expiry_status = ListCertificatesRequestType1ExpiryStatus(_expiry_status)

        _issued_after = d.pop("issuedAfter", UNSET)
        issued_after: datetime.datetime | Unset
        if isinstance(_issued_after, Unset):
            issued_after = UNSET
        else:
            issued_after = isoparse(_issued_after)

        _issued_before = d.pop("issuedBefore", UNSET)
        issued_before: datetime.datetime | Unset
        if isinstance(_issued_before, Unset):
            issued_before = UNSET
        else:
            issued_before = isoparse(_issued_before)

        _expires_after = d.pop("expiresAfter", UNSET)
        expires_after: datetime.datetime | Unset
        if isinstance(_expires_after, Unset):
            expires_after = UNSET
        else:
            expires_after = isoparse(_expires_after)

        _expires_before = d.pop("expiresBefore", UNSET)
        expires_before: datetime.datetime | Unset
        if isinstance(_expires_before, Unset):
            expires_before = UNSET
        else:
            expires_before = isoparse(_expires_before)

        search = d.pop("search", UNSET)

        _sort_by = d.pop("sortBy", UNSET)
        sort_by: ListCertificatesRequestType1SortBy | Unset
        if isinstance(_sort_by, Unset):
            sort_by = UNSET
        else:
            sort_by = ListCertificatesRequestType1SortBy(_sort_by)

        _sort_order = d.pop("sortOrder", UNSET)
        sort_order: ListCertificatesRequestType1SortOrder | Unset
        if isinstance(_sort_order, Unset):
            sort_order = UNSET
        else:
            sort_order = ListCertificatesRequestType1SortOrder(_sort_order)

        limit = d.pop("limit", UNSET)

        offset = d.pop("offset", UNSET)

        list_certificates_request_type_1 = cls(
            ca_id=ca_id,
            status=status,
            certificate_type=certificate_type,
            domain=domain,
            expiry_status=expiry_status,
            issued_after=issued_after,
            issued_before=issued_before,
            expires_after=expires_after,
            expires_before=expires_before,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
            limit=limit,
            offset=offset,
        )

        return list_certificates_request_type_1
