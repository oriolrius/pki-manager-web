from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.delete_cas_id_response_404_error_details_item import DeleteCasIdResponse404ErrorDetailsItem


T = TypeVar("T", bound="DeleteCasIdResponse404Error")


@_attrs_define
class DeleteCasIdResponse404Error:
    """
    Attributes:
        code (str):
        message (str):
        details (list[DeleteCasIdResponse404ErrorDetailsItem] | Unset):
    """

    code: str
    message: str
    details: list[DeleteCasIdResponse404ErrorDetailsItem] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        code = self.code

        message = self.message

        details: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.details, Unset):
            details = []
            for details_item_data in self.details:
                details_item = details_item_data.to_dict()
                details.append(details_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "code": code,
                "message": message,
            }
        )
        if details is not UNSET:
            field_dict["details"] = details

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.delete_cas_id_response_404_error_details_item import DeleteCasIdResponse404ErrorDetailsItem

        d = dict(src_dict)
        code = d.pop("code")

        message = d.pop("message")

        _details = d.pop("details", UNSET)
        details: list[DeleteCasIdResponse404ErrorDetailsItem] | Unset = UNSET
        if _details is not UNSET:
            details = []
            for details_item_data in _details:
                details_item = DeleteCasIdResponse404ErrorDetailsItem.from_dict(details_item_data)

                details.append(details_item)

        delete_cas_id_response_404_error = cls(
            code=code,
            message=message,
            details=details,
        )

        delete_cas_id_response_404_error.additional_properties = d
        return delete_cas_id_response_404_error

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
