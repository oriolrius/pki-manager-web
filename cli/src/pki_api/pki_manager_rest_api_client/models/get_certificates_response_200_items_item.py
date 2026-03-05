from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_certificates_response_200_items_item_certificate_type import (
    GetCertificatesResponse200ItemsItemCertificateType,
)
from ..models.get_certificates_response_200_items_item_expiry_status import (
    GetCertificatesResponse200ItemsItemExpiryStatus,
)
from ..models.get_certificates_response_200_items_item_status import GetCertificatesResponse200ItemsItemStatus
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetCertificatesResponse200ItemsItem")


@_attrs_define
class GetCertificatesResponse200ItemsItem:
    """
    Attributes:
        id (UUID | Unset):
        ca_id (UUID | Unset):
        subject_dn (str | Unset):
        serial_number (str | Unset):
        certificate_type (GetCertificatesResponse200ItemsItemCertificateType | Unset):
        not_before (datetime.datetime | Unset):
        not_after (datetime.datetime | Unset):
        status (GetCertificatesResponse200ItemsItemStatus | Unset):
        expiry_status (GetCertificatesResponse200ItemsItemExpiryStatus | Unset):
        san_dns (list[str] | None | Unset):
        san_ip (list[str] | None | Unset):
        san_email (list[str] | None | Unset):
        created_at (datetime.datetime | Unset):
    """

    id: UUID | Unset = UNSET
    ca_id: UUID | Unset = UNSET
    subject_dn: str | Unset = UNSET
    serial_number: str | Unset = UNSET
    certificate_type: GetCertificatesResponse200ItemsItemCertificateType | Unset = UNSET
    not_before: datetime.datetime | Unset = UNSET
    not_after: datetime.datetime | Unset = UNSET
    status: GetCertificatesResponse200ItemsItemStatus | Unset = UNSET
    expiry_status: GetCertificatesResponse200ItemsItemExpiryStatus | Unset = UNSET
    san_dns: list[str] | None | Unset = UNSET
    san_ip: list[str] | None | Unset = UNSET
    san_email: list[str] | None | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        ca_id: str | Unset = UNSET
        if not isinstance(self.ca_id, Unset):
            ca_id = str(self.ca_id)

        subject_dn = self.subject_dn

        serial_number = self.serial_number

        certificate_type: str | Unset = UNSET
        if not isinstance(self.certificate_type, Unset):
            certificate_type = self.certificate_type.value

        not_before: str | Unset = UNSET
        if not isinstance(self.not_before, Unset):
            not_before = self.not_before.isoformat()

        not_after: str | Unset = UNSET
        if not isinstance(self.not_after, Unset):
            not_after = self.not_after.isoformat()

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        expiry_status: str | Unset = UNSET
        if not isinstance(self.expiry_status, Unset):
            expiry_status = self.expiry_status.value

        san_dns: list[str] | None | Unset
        if isinstance(self.san_dns, Unset):
            san_dns = UNSET
        elif isinstance(self.san_dns, list):
            san_dns = self.san_dns

        else:
            san_dns = self.san_dns

        san_ip: list[str] | None | Unset
        if isinstance(self.san_ip, Unset):
            san_ip = UNSET
        elif isinstance(self.san_ip, list):
            san_ip = self.san_ip

        else:
            san_ip = self.san_ip

        san_email: list[str] | None | Unset
        if isinstance(self.san_email, Unset):
            san_email = UNSET
        elif isinstance(self.san_email, list):
            san_email = self.san_email

        else:
            san_email = self.san_email

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if ca_id is not UNSET:
            field_dict["caId"] = ca_id
        if subject_dn is not UNSET:
            field_dict["subjectDn"] = subject_dn
        if serial_number is not UNSET:
            field_dict["serialNumber"] = serial_number
        if certificate_type is not UNSET:
            field_dict["certificateType"] = certificate_type
        if not_before is not UNSET:
            field_dict["notBefore"] = not_before
        if not_after is not UNSET:
            field_dict["notAfter"] = not_after
        if status is not UNSET:
            field_dict["status"] = status
        if expiry_status is not UNSET:
            field_dict["expiryStatus"] = expiry_status
        if san_dns is not UNSET:
            field_dict["sanDns"] = san_dns
        if san_ip is not UNSET:
            field_dict["sanIp"] = san_ip
        if san_email is not UNSET:
            field_dict["sanEmail"] = san_email
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _id = d.pop("id", UNSET)
        id: UUID | Unset
        if isinstance(_id, Unset):
            id = UNSET
        else:
            id = UUID(_id)

        _ca_id = d.pop("caId", UNSET)
        ca_id: UUID | Unset
        if isinstance(_ca_id, Unset):
            ca_id = UNSET
        else:
            ca_id = UUID(_ca_id)

        subject_dn = d.pop("subjectDn", UNSET)

        serial_number = d.pop("serialNumber", UNSET)

        _certificate_type = d.pop("certificateType", UNSET)
        certificate_type: GetCertificatesResponse200ItemsItemCertificateType | Unset
        if isinstance(_certificate_type, Unset):
            certificate_type = UNSET
        else:
            certificate_type = GetCertificatesResponse200ItemsItemCertificateType(_certificate_type)

        _not_before = d.pop("notBefore", UNSET)
        not_before: datetime.datetime | Unset
        if isinstance(_not_before, Unset):
            not_before = UNSET
        else:
            not_before = isoparse(_not_before)

        _not_after = d.pop("notAfter", UNSET)
        not_after: datetime.datetime | Unset
        if isinstance(_not_after, Unset):
            not_after = UNSET
        else:
            not_after = isoparse(_not_after)

        _status = d.pop("status", UNSET)
        status: GetCertificatesResponse200ItemsItemStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = GetCertificatesResponse200ItemsItemStatus(_status)

        _expiry_status = d.pop("expiryStatus", UNSET)
        expiry_status: GetCertificatesResponse200ItemsItemExpiryStatus | Unset
        if isinstance(_expiry_status, Unset):
            expiry_status = UNSET
        else:
            expiry_status = GetCertificatesResponse200ItemsItemExpiryStatus(_expiry_status)

        def _parse_san_dns(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                san_dns_type_0 = cast(list[str], data)

                return san_dns_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        san_dns = _parse_san_dns(d.pop("sanDns", UNSET))

        def _parse_san_ip(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                san_ip_type_0 = cast(list[str], data)

                return san_ip_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        san_ip = _parse_san_ip(d.pop("sanIp", UNSET))

        def _parse_san_email(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                san_email_type_0 = cast(list[str], data)

                return san_email_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        san_email = _parse_san_email(d.pop("sanEmail", UNSET))

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)

        get_certificates_response_200_items_item = cls(
            id=id,
            ca_id=ca_id,
            subject_dn=subject_dn,
            serial_number=serial_number,
            certificate_type=certificate_type,
            not_before=not_before,
            not_after=not_after,
            status=status,
            expiry_status=expiry_status,
            san_dns=san_dns,
            san_ip=san_ip,
            san_email=san_email,
            created_at=created_at,
        )

        get_certificates_response_200_items_item.additional_properties = d
        return get_certificates_response_200_items_item

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
