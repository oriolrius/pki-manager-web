from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="GetCasIdDownloadResponse200")


@_attrs_define
class GetCasIdDownloadResponse200:
    """
    Attributes:
        data (str | Unset): Base64-encoded certificate data
        mime_type (str | Unset):
        filename (str | Unset):
    """

    data: str | Unset = UNSET
    mime_type: str | Unset = UNSET
    filename: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        data = self.data

        mime_type = self.mime_type

        filename = self.filename

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if data is not UNSET:
            field_dict["data"] = data
        if mime_type is not UNSET:
            field_dict["mimeType"] = mime_type
        if filename is not UNSET:
            field_dict["filename"] = filename

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        data = d.pop("data", UNSET)

        mime_type = d.pop("mimeType", UNSET)

        filename = d.pop("filename", UNSET)

        get_cas_id_download_response_200 = cls(
            data=data,
            mime_type=mime_type,
            filename=filename,
        )

        get_cas_id_download_response_200.additional_properties = d
        return get_cas_id_download_response_200

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
