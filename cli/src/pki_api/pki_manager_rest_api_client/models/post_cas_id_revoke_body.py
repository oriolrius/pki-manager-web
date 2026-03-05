from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_cas_id_revoke_body_reason import PostCasIdRevokeBodyReason
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCasIdRevokeBody")


@_attrs_define
class PostCasIdRevokeBody:
    """
    Attributes:
        reason (PostCasIdRevokeBodyReason):
        details (str | Unset):
    """

    reason: PostCasIdRevokeBodyReason
    details: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        reason = self.reason.value

        details = self.details

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "reason": reason,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        reason = PostCasIdRevokeBodyReason(d.pop("reason"))

        details = d.pop("details", UNSET)

        post_cas_id_revoke_body = cls(
            reason=reason,
            details=details,
        )

        post_cas_id_revoke_body.additional_properties = d
        return post_cas_id_revoke_body

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
