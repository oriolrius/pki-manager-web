from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_certificates_id_response_200_status import GetCertificatesIdResponse200Status
from ..models.get_certificates_id_response_200_validity_status import GetCertificatesIdResponse200ValidityStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_certificates_id_response_200_basic_constraints_type_0 import (
        GetCertificatesIdResponse200BasicConstraintsType0,
    )
    from ..models.get_certificates_id_response_200_fingerprints import GetCertificatesIdResponse200Fingerprints
    from ..models.get_certificates_id_response_200_issuer import GetCertificatesIdResponse200Issuer
    from ..models.get_certificates_id_response_200_issuing_ca import GetCertificatesIdResponse200IssuingCA
    from ..models.get_certificates_id_response_200_key_usage_type_0 import GetCertificatesIdResponse200KeyUsageType0
    from ..models.get_certificates_id_response_200_renewed_to_type_0_item import (
        GetCertificatesIdResponse200RenewedToType0Item,
    )
    from ..models.get_certificates_id_response_200_subject import GetCertificatesIdResponse200Subject


T = TypeVar("T", bound="GetCertificatesIdResponse200")


@_attrs_define
class GetCertificatesIdResponse200:
    """
    Attributes:
        id (UUID | Unset):
        ca_id (UUID | Unset):
        serial_number (str | Unset):
        certificate_type (str | Unset):
        status (GetCertificatesIdResponse200Status | Unset):
        subject_dn (str | Unset):
        subject (GetCertificatesIdResponse200Subject | Unset):
        issuer_dn (str | Unset):
        issuer (GetCertificatesIdResponse200Issuer | Unset):
        not_before (datetime.datetime | Unset):
        not_after (datetime.datetime | Unset):
        validity_status (GetCertificatesIdResponse200ValidityStatus | Unset):
        remaining_days (int | None | Unset):
        key_usage (GetCertificatesIdResponse200KeyUsageType0 | None | Unset):
        extended_key_usage (list[str] | None | Unset):
        san_dns (list[str] | None | Unset):
        san_ip (list[str] | None | Unset):
        san_email (list[str] | None | Unset):
        basic_constraints (GetCertificatesIdResponse200BasicConstraintsType0 | None | Unset):
        fingerprints (GetCertificatesIdResponse200Fingerprints | Unset):
        issuing_ca (GetCertificatesIdResponse200IssuingCA | Unset):
        certificate_pem (str | Unset):
        kms_key_id (None | str | Unset):
        revocation_date (datetime.datetime | None | Unset):
        revocation_reason (None | str | Unset):
        renewed_from_id (None | Unset | UUID):
        renewed_to (list[GetCertificatesIdResponse200RenewedToType0Item] | None | Unset):
        created_at (datetime.datetime | Unset):
        updated_at (datetime.datetime | Unset):
    """

    id: UUID | Unset = UNSET
    ca_id: UUID | Unset = UNSET
    serial_number: str | Unset = UNSET
    certificate_type: str | Unset = UNSET
    status: GetCertificatesIdResponse200Status | Unset = UNSET
    subject_dn: str | Unset = UNSET
    subject: GetCertificatesIdResponse200Subject | Unset = UNSET
    issuer_dn: str | Unset = UNSET
    issuer: GetCertificatesIdResponse200Issuer | Unset = UNSET
    not_before: datetime.datetime | Unset = UNSET
    not_after: datetime.datetime | Unset = UNSET
    validity_status: GetCertificatesIdResponse200ValidityStatus | Unset = UNSET
    remaining_days: int | None | Unset = UNSET
    key_usage: GetCertificatesIdResponse200KeyUsageType0 | None | Unset = UNSET
    extended_key_usage: list[str] | None | Unset = UNSET
    san_dns: list[str] | None | Unset = UNSET
    san_ip: list[str] | None | Unset = UNSET
    san_email: list[str] | None | Unset = UNSET
    basic_constraints: GetCertificatesIdResponse200BasicConstraintsType0 | None | Unset = UNSET
    fingerprints: GetCertificatesIdResponse200Fingerprints | Unset = UNSET
    issuing_ca: GetCertificatesIdResponse200IssuingCA | Unset = UNSET
    certificate_pem: str | Unset = UNSET
    kms_key_id: None | str | Unset = UNSET
    revocation_date: datetime.datetime | None | Unset = UNSET
    revocation_reason: None | str | Unset = UNSET
    renewed_from_id: None | Unset | UUID = UNSET
    renewed_to: list[GetCertificatesIdResponse200RenewedToType0Item] | None | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    updated_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_certificates_id_response_200_basic_constraints_type_0 import (
            GetCertificatesIdResponse200BasicConstraintsType0,
        )
        from ..models.get_certificates_id_response_200_key_usage_type_0 import GetCertificatesIdResponse200KeyUsageType0

        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        ca_id: str | Unset = UNSET
        if not isinstance(self.ca_id, Unset):
            ca_id = str(self.ca_id)

        serial_number = self.serial_number

        certificate_type = self.certificate_type

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        subject_dn = self.subject_dn

        subject: dict[str, Any] | Unset = UNSET
        if not isinstance(self.subject, Unset):
            subject = self.subject.to_dict()

        issuer_dn = self.issuer_dn

        issuer: dict[str, Any] | Unset = UNSET
        if not isinstance(self.issuer, Unset):
            issuer = self.issuer.to_dict()

        not_before: str | Unset = UNSET
        if not isinstance(self.not_before, Unset):
            not_before = self.not_before.isoformat()

        not_after: str | Unset = UNSET
        if not isinstance(self.not_after, Unset):
            not_after = self.not_after.isoformat()

        validity_status: str | Unset = UNSET
        if not isinstance(self.validity_status, Unset):
            validity_status = self.validity_status.value

        remaining_days: int | None | Unset
        if isinstance(self.remaining_days, Unset):
            remaining_days = UNSET
        else:
            remaining_days = self.remaining_days

        key_usage: dict[str, Any] | None | Unset
        if isinstance(self.key_usage, Unset):
            key_usage = UNSET
        elif isinstance(self.key_usage, GetCertificatesIdResponse200KeyUsageType0):
            key_usage = self.key_usage.to_dict()
        else:
            key_usage = self.key_usage

        extended_key_usage: list[str] | None | Unset
        if isinstance(self.extended_key_usage, Unset):
            extended_key_usage = UNSET
        elif isinstance(self.extended_key_usage, list):
            extended_key_usage = self.extended_key_usage

        else:
            extended_key_usage = self.extended_key_usage

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

        basic_constraints: dict[str, Any] | None | Unset
        if isinstance(self.basic_constraints, Unset):
            basic_constraints = UNSET
        elif isinstance(self.basic_constraints, GetCertificatesIdResponse200BasicConstraintsType0):
            basic_constraints = self.basic_constraints.to_dict()
        else:
            basic_constraints = self.basic_constraints

        fingerprints: dict[str, Any] | Unset = UNSET
        if not isinstance(self.fingerprints, Unset):
            fingerprints = self.fingerprints.to_dict()

        issuing_ca: dict[str, Any] | Unset = UNSET
        if not isinstance(self.issuing_ca, Unset):
            issuing_ca = self.issuing_ca.to_dict()

        certificate_pem = self.certificate_pem

        kms_key_id: None | str | Unset
        if isinstance(self.kms_key_id, Unset):
            kms_key_id = UNSET
        else:
            kms_key_id = self.kms_key_id

        revocation_date: None | str | Unset
        if isinstance(self.revocation_date, Unset):
            revocation_date = UNSET
        elif isinstance(self.revocation_date, datetime.datetime):
            revocation_date = self.revocation_date.isoformat()
        else:
            revocation_date = self.revocation_date

        revocation_reason: None | str | Unset
        if isinstance(self.revocation_reason, Unset):
            revocation_reason = UNSET
        else:
            revocation_reason = self.revocation_reason

        renewed_from_id: None | str | Unset
        if isinstance(self.renewed_from_id, Unset):
            renewed_from_id = UNSET
        elif isinstance(self.renewed_from_id, UUID):
            renewed_from_id = str(self.renewed_from_id)
        else:
            renewed_from_id = self.renewed_from_id

        renewed_to: list[dict[str, Any]] | None | Unset
        if isinstance(self.renewed_to, Unset):
            renewed_to = UNSET
        elif isinstance(self.renewed_to, list):
            renewed_to = []
            for renewed_to_type_0_item_data in self.renewed_to:
                renewed_to_type_0_item = renewed_to_type_0_item_data.to_dict()
                renewed_to.append(renewed_to_type_0_item)

        else:
            renewed_to = self.renewed_to

        created_at: str | Unset = UNSET
        if not isinstance(self.created_at, Unset):
            created_at = self.created_at.isoformat()

        updated_at: str | Unset = UNSET
        if not isinstance(self.updated_at, Unset):
            updated_at = self.updated_at.isoformat()

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if ca_id is not UNSET:
            field_dict["caId"] = ca_id
        if serial_number is not UNSET:
            field_dict["serialNumber"] = serial_number
        if certificate_type is not UNSET:
            field_dict["certificateType"] = certificate_type
        if status is not UNSET:
            field_dict["status"] = status
        if subject_dn is not UNSET:
            field_dict["subjectDn"] = subject_dn
        if subject is not UNSET:
            field_dict["subject"] = subject
        if issuer_dn is not UNSET:
            field_dict["issuerDn"] = issuer_dn
        if issuer is not UNSET:
            field_dict["issuer"] = issuer
        if not_before is not UNSET:
            field_dict["notBefore"] = not_before
        if not_after is not UNSET:
            field_dict["notAfter"] = not_after
        if validity_status is not UNSET:
            field_dict["validityStatus"] = validity_status
        if remaining_days is not UNSET:
            field_dict["remainingDays"] = remaining_days
        if key_usage is not UNSET:
            field_dict["keyUsage"] = key_usage
        if extended_key_usage is not UNSET:
            field_dict["extendedKeyUsage"] = extended_key_usage
        if san_dns is not UNSET:
            field_dict["sanDns"] = san_dns
        if san_ip is not UNSET:
            field_dict["sanIp"] = san_ip
        if san_email is not UNSET:
            field_dict["sanEmail"] = san_email
        if basic_constraints is not UNSET:
            field_dict["basicConstraints"] = basic_constraints
        if fingerprints is not UNSET:
            field_dict["fingerprints"] = fingerprints
        if issuing_ca is not UNSET:
            field_dict["issuingCA"] = issuing_ca
        if certificate_pem is not UNSET:
            field_dict["certificatePem"] = certificate_pem
        if kms_key_id is not UNSET:
            field_dict["kmsKeyId"] = kms_key_id
        if revocation_date is not UNSET:
            field_dict["revocationDate"] = revocation_date
        if revocation_reason is not UNSET:
            field_dict["revocationReason"] = revocation_reason
        if renewed_from_id is not UNSET:
            field_dict["renewedFromId"] = renewed_from_id
        if renewed_to is not UNSET:
            field_dict["renewedTo"] = renewed_to
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_certificates_id_response_200_basic_constraints_type_0 import (
            GetCertificatesIdResponse200BasicConstraintsType0,
        )
        from ..models.get_certificates_id_response_200_fingerprints import GetCertificatesIdResponse200Fingerprints
        from ..models.get_certificates_id_response_200_issuer import GetCertificatesIdResponse200Issuer
        from ..models.get_certificates_id_response_200_issuing_ca import GetCertificatesIdResponse200IssuingCA
        from ..models.get_certificates_id_response_200_key_usage_type_0 import GetCertificatesIdResponse200KeyUsageType0
        from ..models.get_certificates_id_response_200_renewed_to_type_0_item import (
            GetCertificatesIdResponse200RenewedToType0Item,
        )
        from ..models.get_certificates_id_response_200_subject import GetCertificatesIdResponse200Subject

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

        serial_number = d.pop("serialNumber", UNSET)

        certificate_type = d.pop("certificateType", UNSET)

        _status = d.pop("status", UNSET)
        status: GetCertificatesIdResponse200Status | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = GetCertificatesIdResponse200Status(_status)

        subject_dn = d.pop("subjectDn", UNSET)

        _subject = d.pop("subject", UNSET)
        subject: GetCertificatesIdResponse200Subject | Unset
        if isinstance(_subject, Unset):
            subject = UNSET
        else:
            subject = GetCertificatesIdResponse200Subject.from_dict(_subject)

        issuer_dn = d.pop("issuerDn", UNSET)

        _issuer = d.pop("issuer", UNSET)
        issuer: GetCertificatesIdResponse200Issuer | Unset
        if isinstance(_issuer, Unset):
            issuer = UNSET
        else:
            issuer = GetCertificatesIdResponse200Issuer.from_dict(_issuer)

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

        _validity_status = d.pop("validityStatus", UNSET)
        validity_status: GetCertificatesIdResponse200ValidityStatus | Unset
        if isinstance(_validity_status, Unset):
            validity_status = UNSET
        else:
            validity_status = GetCertificatesIdResponse200ValidityStatus(_validity_status)

        def _parse_remaining_days(data: object) -> int | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(int | None | Unset, data)

        remaining_days = _parse_remaining_days(d.pop("remainingDays", UNSET))

        def _parse_key_usage(data: object) -> GetCertificatesIdResponse200KeyUsageType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                key_usage_type_0 = GetCertificatesIdResponse200KeyUsageType0.from_dict(data)

                return key_usage_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetCertificatesIdResponse200KeyUsageType0 | None | Unset, data)

        key_usage = _parse_key_usage(d.pop("keyUsage", UNSET))

        def _parse_extended_key_usage(data: object) -> list[str] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                extended_key_usage_type_0 = cast(list[str], data)

                return extended_key_usage_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | None | Unset, data)

        extended_key_usage = _parse_extended_key_usage(d.pop("extendedKeyUsage", UNSET))

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

        def _parse_basic_constraints(data: object) -> GetCertificatesIdResponse200BasicConstraintsType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                basic_constraints_type_0 = GetCertificatesIdResponse200BasicConstraintsType0.from_dict(data)

                return basic_constraints_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetCertificatesIdResponse200BasicConstraintsType0 | None | Unset, data)

        basic_constraints = _parse_basic_constraints(d.pop("basicConstraints", UNSET))

        _fingerprints = d.pop("fingerprints", UNSET)
        fingerprints: GetCertificatesIdResponse200Fingerprints | Unset
        if isinstance(_fingerprints, Unset):
            fingerprints = UNSET
        else:
            fingerprints = GetCertificatesIdResponse200Fingerprints.from_dict(_fingerprints)

        _issuing_ca = d.pop("issuingCA", UNSET)
        issuing_ca: GetCertificatesIdResponse200IssuingCA | Unset
        if isinstance(_issuing_ca, Unset):
            issuing_ca = UNSET
        else:
            issuing_ca = GetCertificatesIdResponse200IssuingCA.from_dict(_issuing_ca)

        certificate_pem = d.pop("certificatePem", UNSET)

        def _parse_kms_key_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        kms_key_id = _parse_kms_key_id(d.pop("kmsKeyId", UNSET))

        def _parse_revocation_date(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                revocation_date_type_0 = isoparse(data)

                return revocation_date_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        revocation_date = _parse_revocation_date(d.pop("revocationDate", UNSET))

        def _parse_revocation_reason(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        revocation_reason = _parse_revocation_reason(d.pop("revocationReason", UNSET))

        def _parse_renewed_from_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                renewed_from_id_type_0 = UUID(data)

                return renewed_from_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        renewed_from_id = _parse_renewed_from_id(d.pop("renewedFromId", UNSET))

        def _parse_renewed_to(data: object) -> list[GetCertificatesIdResponse200RenewedToType0Item] | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                renewed_to_type_0 = []
                _renewed_to_type_0 = data
                for renewed_to_type_0_item_data in _renewed_to_type_0:
                    renewed_to_type_0_item = GetCertificatesIdResponse200RenewedToType0Item.from_dict(
                        renewed_to_type_0_item_data
                    )

                    renewed_to_type_0.append(renewed_to_type_0_item)

                return renewed_to_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[GetCertificatesIdResponse200RenewedToType0Item] | None | Unset, data)

        renewed_to = _parse_renewed_to(d.pop("renewedTo", UNSET))

        _created_at = d.pop("createdAt", UNSET)
        created_at: datetime.datetime | Unset
        if isinstance(_created_at, Unset):
            created_at = UNSET
        else:
            created_at = isoparse(_created_at)

        _updated_at = d.pop("updatedAt", UNSET)
        updated_at: datetime.datetime | Unset
        if isinstance(_updated_at, Unset):
            updated_at = UNSET
        else:
            updated_at = isoparse(_updated_at)

        get_certificates_id_response_200 = cls(
            id=id,
            ca_id=ca_id,
            serial_number=serial_number,
            certificate_type=certificate_type,
            status=status,
            subject_dn=subject_dn,
            subject=subject,
            issuer_dn=issuer_dn,
            issuer=issuer,
            not_before=not_before,
            not_after=not_after,
            validity_status=validity_status,
            remaining_days=remaining_days,
            key_usage=key_usage,
            extended_key_usage=extended_key_usage,
            san_dns=san_dns,
            san_ip=san_ip,
            san_email=san_email,
            basic_constraints=basic_constraints,
            fingerprints=fingerprints,
            issuing_ca=issuing_ca,
            certificate_pem=certificate_pem,
            kms_key_id=kms_key_id,
            revocation_date=revocation_date,
            revocation_reason=revocation_reason,
            renewed_from_id=renewed_from_id,
            renewed_to=renewed_to,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_certificates_id_response_200.additional_properties = d
        return get_certificates_id_response_200

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
