from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCasIdRevokeResponse200")


@_attrs_define
class PostCasIdRevokeResponse200:
    """
    Attributes:
        success (bool | Unset):
        ca_id (UUID | Unset):
        revocation_date (datetime.datetime | Unset):
        reason (str | Unset):
        cascade_revoked_count (int | Unset):
        crl_generated (bool | Unset):
        crl_id (UUID | Unset):
    """

    success: bool | Unset = UNSET
    ca_id: UUID | Unset = UNSET
    revocation_date: datetime.datetime | Unset = UNSET
    reason: str | Unset = UNSET
    cascade_revoked_count: int | Unset = UNSET
    crl_generated: bool | Unset = UNSET
    crl_id: UUID | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        success = self.success

        ca_id: str | Unset = UNSET
        if not isinstance(self.ca_id, Unset):
            ca_id = str(self.ca_id)

        revocation_date: str | Unset = UNSET
        if not isinstance(self.revocation_date, Unset):
            revocation_date = self.revocation_date.isoformat()

        reason = self.reason

        cascade_revoked_count = self.cascade_revoked_count

        crl_generated = self.crl_generated

        crl_id: str | Unset = UNSET
        if not isinstance(self.crl_id, Unset):
            crl_id = str(self.crl_id)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if success is not UNSET:
            field_dict["success"] = success
        if ca_id is not UNSET:
            field_dict["caId"] = ca_id
        if revocation_date is not UNSET:
            field_dict["revocationDate"] = revocation_date
        if reason is not UNSET:
            field_dict["reason"] = reason
        if cascade_revoked_count is not UNSET:
            field_dict["cascadeRevokedCount"] = cascade_revoked_count
        if crl_generated is not UNSET:
            field_dict["crlGenerated"] = crl_generated
        if crl_id is not UNSET:
            field_dict["crlId"] = crl_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        success = d.pop("success", UNSET)

        _ca_id = d.pop("caId", UNSET)
        ca_id: UUID | Unset
        if isinstance(_ca_id, Unset):
            ca_id = UNSET
        else:
            ca_id = UUID(_ca_id)

        _revocation_date = d.pop("revocationDate", UNSET)
        revocation_date: datetime.datetime | Unset
        if isinstance(_revocation_date, Unset):
            revocation_date = UNSET
        else:
            revocation_date = isoparse(_revocation_date)

        reason = d.pop("reason", UNSET)

        cascade_revoked_count = d.pop("cascadeRevokedCount", UNSET)

        crl_generated = d.pop("crlGenerated", UNSET)

        _crl_id = d.pop("crlId", UNSET)
        crl_id: UUID | Unset
        if isinstance(_crl_id, Unset):
            crl_id = UNSET
        else:
            crl_id = UUID(_crl_id)

        post_cas_id_revoke_response_200 = cls(
            success=success,
            ca_id=ca_id,
            revocation_date=revocation_date,
            reason=reason,
            cascade_revoked_count=cascade_revoked_count,
            crl_generated=crl_generated,
            crl_id=crl_id,
        )

        post_cas_id_revoke_response_200.additional_properties = d
        return post_cas_id_revoke_response_200

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
