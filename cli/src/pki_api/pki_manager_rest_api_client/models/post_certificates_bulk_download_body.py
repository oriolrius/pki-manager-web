from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_certificates_bulk_download_body_format import PostCertificatesBulkDownloadBodyFormat
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostCertificatesBulkDownloadBody")


@_attrs_define
class PostCertificatesBulkDownloadBody:
    """
    Attributes:
        certificate_ids (list[UUID]): Array of certificate IDs to download
        format_ (PostCertificatesBulkDownloadBodyFormat | Unset): Download format Default:
            PostCertificatesBulkDownloadBodyFormat.PEM.
        password (str | Unset): Password for encrypted formats
        encrypt_private_key (bool | Unset): Whether to encrypt private key with password Default: True.
    """

    certificate_ids: list[UUID]
    format_: PostCertificatesBulkDownloadBodyFormat | Unset = PostCertificatesBulkDownloadBodyFormat.PEM
    password: str | Unset = UNSET
    encrypt_private_key: bool | Unset = True
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = []
        for certificate_ids_item_data in self.certificate_ids:
            certificate_ids_item = str(certificate_ids_item_data)
            certificate_ids.append(certificate_ids_item)

        format_: str | Unset = UNSET
        if not isinstance(self.format_, Unset):
            format_ = self.format_.value

        password = self.password

        encrypt_private_key = self.encrypt_private_key

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "certificateIds": certificate_ids,
            }
        )
        if format_ is not UNSET:
            field_dict["format"] = format_
        if password is not UNSET:
            field_dict["password"] = password
        if encrypt_private_key is not UNSET:
            field_dict["encryptPrivateKey"] = encrypt_private_key

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        certificate_ids = []
        _certificate_ids = d.pop("certificateIds")
        for certificate_ids_item_data in _certificate_ids:
            certificate_ids_item = UUID(certificate_ids_item_data)

            certificate_ids.append(certificate_ids_item)

        _format_ = d.pop("format", UNSET)
        format_: PostCertificatesBulkDownloadBodyFormat | Unset
        if isinstance(_format_, Unset):
            format_ = UNSET
        else:
            format_ = PostCertificatesBulkDownloadBodyFormat(_format_)

        password = d.pop("password", UNSET)

        encrypt_private_key = d.pop("encryptPrivateKey", UNSET)

        post_certificates_bulk_download_body = cls(
            certificate_ids=certificate_ids,
            format_=format_,
            password=password,
            encrypt_private_key=encrypt_private_key,
        )

        post_certificates_bulk_download_body.additional_properties = d
        return post_certificates_bulk_download_body

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
