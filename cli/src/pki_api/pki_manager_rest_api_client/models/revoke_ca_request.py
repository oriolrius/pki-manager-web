from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.revoke_ca_request_reason import RevokeCaRequestReason
from ..types import UNSET, Unset

T = TypeVar("T", bound="RevokeCaRequest")


@_attrs_define
class RevokeCaRequest:
    """
    Attributes:
        id (str):
        reason (RevokeCaRequestReason):
        details (str | Unset):
    """

    id: str
    reason: RevokeCaRequestReason
    details: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        reason = self.reason.value

        details = self.details

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "reason": reason,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        reason = RevokeCaRequestReason(d.pop("reason"))

        details = d.pop("details", UNSET)

        revoke_ca_request = cls(
            id=id,
            reason=reason,
            details=details,
        )

        return revoke_ca_request
