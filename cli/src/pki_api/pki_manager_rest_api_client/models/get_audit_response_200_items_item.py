from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.get_audit_response_200_items_item_status import GetAuditResponse200ItemsItemStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_audit_response_200_items_item_details_type_0 import GetAuditResponse200ItemsItemDetailsType0


T = TypeVar("T", bound="GetAuditResponse200ItemsItem")


@_attrs_define
class GetAuditResponse200ItemsItem:
    """
    Attributes:
        id (str | Unset):
        timestamp (datetime.datetime | Unset):
        operation (str | Unset):
        entity_type (str | Unset):
        entity_id (None | str | Unset):
        ip_address (None | str | Unset):
        status (GetAuditResponse200ItemsItemStatus | Unset):
        details (GetAuditResponse200ItemsItemDetailsType0 | None | Unset):
    """

    id: str | Unset = UNSET
    timestamp: datetime.datetime | Unset = UNSET
    operation: str | Unset = UNSET
    entity_type: str | Unset = UNSET
    entity_id: None | str | Unset = UNSET
    ip_address: None | str | Unset = UNSET
    status: GetAuditResponse200ItemsItemStatus | Unset = UNSET
    details: GetAuditResponse200ItemsItemDetailsType0 | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_audit_response_200_items_item_details_type_0 import GetAuditResponse200ItemsItemDetailsType0

        id = self.id

        timestamp: str | Unset = UNSET
        if not isinstance(self.timestamp, Unset):
            timestamp = self.timestamp.isoformat()

        operation = self.operation

        entity_type = self.entity_type

        entity_id: None | str | Unset
        if isinstance(self.entity_id, Unset):
            entity_id = UNSET
        else:
            entity_id = self.entity_id

        ip_address: None | str | Unset
        if isinstance(self.ip_address, Unset):
            ip_address = UNSET
        else:
            ip_address = self.ip_address

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        details: dict[str, Any] | None | Unset
        if isinstance(self.details, Unset):
            details = UNSET
        elif isinstance(self.details, GetAuditResponse200ItemsItemDetailsType0):
            details = self.details.to_dict()
        else:
            details = self.details

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if timestamp is not UNSET:
            field_dict["timestamp"] = timestamp
        if operation is not UNSET:
            field_dict["operation"] = operation
        if entity_type is not UNSET:
            field_dict["entityType"] = entity_type
        if entity_id is not UNSET:
            field_dict["entityId"] = entity_id
        if ip_address is not UNSET:
            field_dict["ipAddress"] = ip_address
        if status is not UNSET:
            field_dict["status"] = status
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_audit_response_200_items_item_details_type_0 import GetAuditResponse200ItemsItemDetailsType0

        d = dict(src_dict)
        id = d.pop("id", UNSET)

        _timestamp = d.pop("timestamp", UNSET)
        timestamp: datetime.datetime | Unset
        if isinstance(_timestamp, Unset):
            timestamp = UNSET
        else:
            timestamp = isoparse(_timestamp)

        operation = d.pop("operation", UNSET)

        entity_type = d.pop("entityType", UNSET)

        def _parse_entity_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        entity_id = _parse_entity_id(d.pop("entityId", UNSET))

        def _parse_ip_address(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        ip_address = _parse_ip_address(d.pop("ipAddress", UNSET))

        _status = d.pop("status", UNSET)
        status: GetAuditResponse200ItemsItemStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = GetAuditResponse200ItemsItemStatus(_status)

        def _parse_details(data: object) -> GetAuditResponse200ItemsItemDetailsType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                details_type_0 = GetAuditResponse200ItemsItemDetailsType0.from_dict(data)

                return details_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetAuditResponse200ItemsItemDetailsType0 | None | Unset, data)

        details = _parse_details(d.pop("details", UNSET))

        get_audit_response_200_items_item = cls(
            id=id,
            timestamp=timestamp,
            operation=operation,
            entity_type=entity_type,
            entity_id=entity_id,
            ip_address=ip_address,
            status=status,
            details=details,
        )

        get_audit_response_200_items_item.additional_properties = d
        return get_audit_response_200_items_item

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
