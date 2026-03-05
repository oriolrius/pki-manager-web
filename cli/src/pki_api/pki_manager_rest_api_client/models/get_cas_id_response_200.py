from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_cas_id_response_200_status import GetCasIdResponse200Status
from ..models.get_cas_id_response_200_validity_status import GetCasIdResponse200ValidityStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_cas_id_response_200_extensions import GetCasIdResponse200Extensions
    from ..models.get_cas_id_response_200_fingerprints import GetCasIdResponse200Fingerprints
    from ..models.get_cas_id_response_200_issuer import GetCasIdResponse200Issuer
    from ..models.get_cas_id_response_200_subject import GetCasIdResponse200Subject


T = TypeVar("T", bound="GetCasIdResponse200")


@_attrs_define
class GetCasIdResponse200:
    """
    Attributes:
        id (UUID | Unset):
        subject (GetCasIdResponse200Subject | Unset):
        subject_dn (str | Unset):
        issuer (GetCasIdResponse200Issuer | Unset):
        issuer_dn (str | Unset):
        serial_number (str | Unset):
        key_algorithm (str | Unset):
        not_before (datetime.datetime | Unset):
        not_after (datetime.datetime | Unset):
        validity_status (GetCasIdResponse200ValidityStatus | Unset):
        status (GetCasIdResponse200Status | Unset):
        extensions (GetCasIdResponse200Extensions | Unset):
        fingerprints (GetCasIdResponse200Fingerprints | Unset):
        certificate_pem (str | Unset):
        issued_certificate_count (int | Unset):
        revocation_date (datetime.datetime | None | Unset):
        revocation_reason (None | str | Unset):
        created_at (datetime.datetime | Unset):
        updated_at (datetime.datetime | Unset):
    """

    id: UUID | Unset = UNSET
    subject: GetCasIdResponse200Subject | Unset = UNSET
    subject_dn: str | Unset = UNSET
    issuer: GetCasIdResponse200Issuer | Unset = UNSET
    issuer_dn: str | Unset = UNSET
    serial_number: str | Unset = UNSET
    key_algorithm: str | Unset = UNSET
    not_before: datetime.datetime | Unset = UNSET
    not_after: datetime.datetime | Unset = UNSET
    validity_status: GetCasIdResponse200ValidityStatus | Unset = UNSET
    status: GetCasIdResponse200Status | Unset = UNSET
    extensions: GetCasIdResponse200Extensions | Unset = UNSET
    fingerprints: GetCasIdResponse200Fingerprints | Unset = UNSET
    certificate_pem: str | Unset = UNSET
    issued_certificate_count: int | Unset = UNSET
    revocation_date: datetime.datetime | None | Unset = UNSET
    revocation_reason: None | str | Unset = UNSET
    created_at: datetime.datetime | Unset = UNSET
    updated_at: datetime.datetime | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        subject: dict[str, Any] | Unset = UNSET
        if not isinstance(self.subject, Unset):
            subject = self.subject.to_dict()

        subject_dn = self.subject_dn

        issuer: dict[str, Any] | Unset = UNSET
        if not isinstance(self.issuer, Unset):
            issuer = self.issuer.to_dict()

        issuer_dn = self.issuer_dn

        serial_number = self.serial_number

        key_algorithm = self.key_algorithm

        not_before: str | Unset = UNSET
        if not isinstance(self.not_before, Unset):
            not_before = self.not_before.isoformat()

        not_after: str | Unset = UNSET
        if not isinstance(self.not_after, Unset):
            not_after = self.not_after.isoformat()

        validity_status: str | Unset = UNSET
        if not isinstance(self.validity_status, Unset):
            validity_status = self.validity_status.value

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        extensions: dict[str, Any] | Unset = UNSET
        if not isinstance(self.extensions, Unset):
            extensions = self.extensions.to_dict()

        fingerprints: dict[str, Any] | Unset = UNSET
        if not isinstance(self.fingerprints, Unset):
            fingerprints = self.fingerprints.to_dict()

        certificate_pem = self.certificate_pem

        issued_certificate_count = self.issued_certificate_count

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
        if subject is not UNSET:
            field_dict["subject"] = subject
        if subject_dn is not UNSET:
            field_dict["subjectDn"] = subject_dn
        if issuer is not UNSET:
            field_dict["issuer"] = issuer
        if issuer_dn is not UNSET:
            field_dict["issuerDn"] = issuer_dn
        if serial_number is not UNSET:
            field_dict["serialNumber"] = serial_number
        if key_algorithm is not UNSET:
            field_dict["keyAlgorithm"] = key_algorithm
        if not_before is not UNSET:
            field_dict["notBefore"] = not_before
        if not_after is not UNSET:
            field_dict["notAfter"] = not_after
        if validity_status is not UNSET:
            field_dict["validityStatus"] = validity_status
        if status is not UNSET:
            field_dict["status"] = status
        if extensions is not UNSET:
            field_dict["extensions"] = extensions
        if fingerprints is not UNSET:
            field_dict["fingerprints"] = fingerprints
        if certificate_pem is not UNSET:
            field_dict["certificatePem"] = certificate_pem
        if issued_certificate_count is not UNSET:
            field_dict["issuedCertificateCount"] = issued_certificate_count
        if revocation_date is not UNSET:
            field_dict["revocationDate"] = revocation_date
        if revocation_reason is not UNSET:
            field_dict["revocationReason"] = revocation_reason
        if created_at is not UNSET:
            field_dict["createdAt"] = created_at
        if updated_at is not UNSET:
            field_dict["updatedAt"] = updated_at

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_cas_id_response_200_extensions import GetCasIdResponse200Extensions
        from ..models.get_cas_id_response_200_fingerprints import GetCasIdResponse200Fingerprints
        from ..models.get_cas_id_response_200_issuer import GetCasIdResponse200Issuer
        from ..models.get_cas_id_response_200_subject import GetCasIdResponse200Subject

        d = dict(src_dict)
        _id = d.pop("id", UNSET)
        id: UUID | Unset
        if isinstance(_id, Unset):
            id = UNSET
        else:
            id = UUID(_id)

        _subject = d.pop("subject", UNSET)
        subject: GetCasIdResponse200Subject | Unset
        if isinstance(_subject, Unset):
            subject = UNSET
        else:
            subject = GetCasIdResponse200Subject.from_dict(_subject)

        subject_dn = d.pop("subjectDn", UNSET)

        _issuer = d.pop("issuer", UNSET)
        issuer: GetCasIdResponse200Issuer | Unset
        if isinstance(_issuer, Unset):
            issuer = UNSET
        else:
            issuer = GetCasIdResponse200Issuer.from_dict(_issuer)

        issuer_dn = d.pop("issuerDn", UNSET)

        serial_number = d.pop("serialNumber", UNSET)

        key_algorithm = d.pop("keyAlgorithm", UNSET)

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
        validity_status: GetCasIdResponse200ValidityStatus | Unset
        if isinstance(_validity_status, Unset):
            validity_status = UNSET
        else:
            validity_status = GetCasIdResponse200ValidityStatus(_validity_status)

        _status = d.pop("status", UNSET)
        status: GetCasIdResponse200Status | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = GetCasIdResponse200Status(_status)

        _extensions = d.pop("extensions", UNSET)
        extensions: GetCasIdResponse200Extensions | Unset
        if isinstance(_extensions, Unset):
            extensions = UNSET
        else:
            extensions = GetCasIdResponse200Extensions.from_dict(_extensions)

        _fingerprints = d.pop("fingerprints", UNSET)
        fingerprints: GetCasIdResponse200Fingerprints | Unset
        if isinstance(_fingerprints, Unset):
            fingerprints = UNSET
        else:
            fingerprints = GetCasIdResponse200Fingerprints.from_dict(_fingerprints)

        certificate_pem = d.pop("certificatePem", UNSET)

        issued_certificate_count = d.pop("issuedCertificateCount", UNSET)

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

        get_cas_id_response_200 = cls(
            id=id,
            subject=subject,
            subject_dn=subject_dn,
            issuer=issuer,
            issuer_dn=issuer_dn,
            serial_number=serial_number,
            key_algorithm=key_algorithm,
            not_before=not_before,
            not_after=not_after,
            validity_status=validity_status,
            status=status,
            extensions=extensions,
            fingerprints=fingerprints,
            certificate_pem=certificate_pem,
            issued_certificate_count=issued_certificate_count,
            revocation_date=revocation_date,
            revocation_reason=revocation_reason,
            created_at=created_at,
            updated_at=updated_at,
        )

        get_cas_id_response_200.additional_properties = d
        return get_cas_id_response_200

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
