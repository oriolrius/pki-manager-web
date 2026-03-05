from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.post_certificates_id_revoke_response_200_status import PostCertificatesIdRevokeResponse200Status
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesIdRevokeResponse200")


@_attrs_define
class PostCertificatesIdRevokeResponse200:
    """
    Attributes:
        id (UUID | Unset):
        status (PostCertificatesIdRevokeResponse200Status | Unset):
        revocation_date (datetime.datetime | Unset):
        revocation_reason (str | Unset):
    """

    id: UUID | Unset = UNSET
    status: PostCertificatesIdRevokeResponse200Status | Unset = UNSET
    revocation_date: datetime.datetime | Unset = UNSET
    revocation_reason: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        revocation_date: str | Unset = UNSET
        if not isinstance(self.revocation_date, Unset):
            revocation_date = self.revocation_date.isoformat()

        revocation_reason = self.revocation_reason

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if status is not UNSET:
            field_dict["status"] = status
        if revocation_date is not UNSET:
            field_dict["revocationDate"] = revocation_date
        if revocation_reason is not UNSET:
            field_dict["revocationReason"] = revocation_reason

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

        _status = d.pop("status", UNSET)
        status: PostCertificatesIdRevokeResponse200Status | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = PostCertificatesIdRevokeResponse200Status(_status)

        _revocation_date = d.pop("revocationDate", UNSET)
        revocation_date: datetime.datetime | Unset
        if isinstance(_revocation_date, Unset):
            revocation_date = UNSET
        else:
            revocation_date = isoparse(_revocation_date)

        revocation_reason = d.pop("revocationReason", UNSET)

        post_certificates_id_revoke_response_200 = cls(
            id=id,
            status=status,
            revocation_date=revocation_date,
            revocation_reason=revocation_reason,
        )

        post_certificates_id_revoke_response_200.additional_properties = d
        return post_certificates_id_revoke_response_200

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
