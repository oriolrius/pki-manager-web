from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.bulk_download_certificates_request_format import BulkDownloadCertificatesRequestFormat
from ..types import UNSET, Unset

T = TypeVar("T", bound="BulkDownloadCertificatesRequest")


@_attrs_define
class BulkDownloadCertificatesRequest:
    """
    Attributes:
        certificate_ids (list[str]):
        format_ (BulkDownloadCertificatesRequestFormat | Unset):  Default: BulkDownloadCertificatesRequestFormat.PEM.
        password (str | Unset):
        encrypt_private_key (bool | Unset):  Default: True.
    """

    certificate_ids: list[str]
    format_: BulkDownloadCertificatesRequestFormat | Unset = BulkDownloadCertificatesRequestFormat.PEM
    password: str | Unset = UNSET
    encrypt_private_key: bool | Unset = True

    def to_dict(self) -> dict[str, Any]:
        certificate_ids = self.certificate_ids

        format_: str | Unset = UNSET
        if not isinstance(self.format_, Unset):
            format_ = self.format_.value

        password = self.password

        encrypt_private_key = self.encrypt_private_key

        field_dict: dict[str, Any] = {}

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
        certificate_ids = cast(list[str], d.pop("certificateIds"))

        _format_ = d.pop("format", UNSET)
        format_: BulkDownloadCertificatesRequestFormat | Unset
        if isinstance(_format_, Unset):
            format_ = UNSET
        else:
            format_ = BulkDownloadCertificatesRequestFormat(_format_)

        password = d.pop("password", UNSET)

        encrypt_private_key = d.pop("encryptPrivateKey", UNSET)

        bulk_download_certificates_request = cls(
            certificate_ids=certificate_ids,
            format_=format_,
            password=password,
            encrypt_private_key=encrypt_private_key,
        )

        return bulk_download_certificates_request
