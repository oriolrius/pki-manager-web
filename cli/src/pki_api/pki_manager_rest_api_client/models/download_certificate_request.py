from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.download_certificate_request_format import DownloadCertificateRequestFormat
from ..types import UNSET, Unset

T = TypeVar("T", bound="DownloadCertificateRequest")


@_attrs_define
class DownloadCertificateRequest:
    """
    Attributes:
        id (str):
        format_ (DownloadCertificateRequestFormat | Unset):  Default: DownloadCertificateRequestFormat.PEM.
        password (str | Unset):
        encrypt_private_key (bool | Unset):  Default: True.
        alias (str | Unset):
    """

    id: str
    format_: DownloadCertificateRequestFormat | Unset = DownloadCertificateRequestFormat.PEM
    password: str | Unset = UNSET
    encrypt_private_key: bool | Unset = True
    alias: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        format_: str | Unset = UNSET
        if not isinstance(self.format_, Unset):
            format_ = self.format_.value

        password = self.password

        encrypt_private_key = self.encrypt_private_key

        alias = self.alias

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
            }
        )
        if format_ is not UNSET:
            field_dict["format"] = format_
        if password is not UNSET:
            field_dict["password"] = password
        if encrypt_private_key is not UNSET:
            field_dict["encryptPrivateKey"] = encrypt_private_key
        if alias is not UNSET:
            field_dict["alias"] = alias

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        _format_ = d.pop("format", UNSET)
        format_: DownloadCertificateRequestFormat | Unset
        if isinstance(_format_, Unset):
            format_ = UNSET
        else:
            format_ = DownloadCertificateRequestFormat(_format_)

        password = d.pop("password", UNSET)

        encrypt_private_key = d.pop("encryptPrivateKey", UNSET)

        alias = d.pop("alias", UNSET)

        download_certificate_request = cls(
            id=id,
            format_=format_,
            password=password,
            encrypt_private_key=encrypt_private_key,
            alias=alias,
        )

        return download_certificate_request
