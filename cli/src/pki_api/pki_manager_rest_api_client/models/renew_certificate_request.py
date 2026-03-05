from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.renew_certificate_request_subject import RenewCertificateRequestSubject


T = TypeVar("T", bound="RenewCertificateRequest")


@_attrs_define
class RenewCertificateRequest:
    """
    Attributes:
        id (str):
        generate_new_key (bool | Unset):  Default: True.
        validity_days (int | Unset):
        update_info (bool | Unset):  Default: False.
        subject (RenewCertificateRequestSubject | Unset):
        san_dns (list[str] | Unset):
        san_ip (list[str] | Unset):
        san_email (list[str] | Unset):
        revoke_original (bool | Unset):  Default: False.
    """

    id: str
    generate_new_key: bool | Unset = True
    validity_days: int | Unset = UNSET
    update_info: bool | Unset = False
    subject: RenewCertificateRequestSubject | Unset = UNSET
    san_dns: list[str] | Unset = UNSET
    san_ip: list[str] | Unset = UNSET
    san_email: list[str] | Unset = UNSET
    revoke_original: bool | Unset = False

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        generate_new_key = self.generate_new_key

        validity_days = self.validity_days

        update_info = self.update_info

        subject: dict[str, Any] | Unset = UNSET
        if not isinstance(self.subject, Unset):
            subject = self.subject.to_dict()

        san_dns: list[str] | Unset = UNSET
        if not isinstance(self.san_dns, Unset):
            san_dns = self.san_dns

        san_ip: list[str] | Unset = UNSET
        if not isinstance(self.san_ip, Unset):
            san_ip = self.san_ip

        san_email: list[str] | Unset = UNSET
        if not isinstance(self.san_email, Unset):
            san_email = self.san_email

        revoke_original = self.revoke_original

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
            }
        )
        if generate_new_key is not UNSET:
            field_dict["generateNewKey"] = generate_new_key
        if validity_days is not UNSET:
            field_dict["validityDays"] = validity_days
        if update_info is not UNSET:
            field_dict["updateInfo"] = update_info
        if subject is not UNSET:
            field_dict["subject"] = subject
        if san_dns is not UNSET:
            field_dict["sanDns"] = san_dns
        if san_ip is not UNSET:
            field_dict["sanIp"] = san_ip
        if san_email is not UNSET:
            field_dict["sanEmail"] = san_email
        if revoke_original is not UNSET:
            field_dict["revokeOriginal"] = revoke_original

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.renew_certificate_request_subject import RenewCertificateRequestSubject

        d = dict(src_dict)
        id = d.pop("id")

        generate_new_key = d.pop("generateNewKey", UNSET)

        validity_days = d.pop("validityDays", UNSET)

        update_info = d.pop("updateInfo", UNSET)

        _subject = d.pop("subject", UNSET)
        subject: RenewCertificateRequestSubject | Unset
        if isinstance(_subject, Unset):
            subject = UNSET
        else:
            subject = RenewCertificateRequestSubject.from_dict(_subject)

        san_dns = cast(list[str], d.pop("sanDns", UNSET))

        san_ip = cast(list[str], d.pop("sanIp", UNSET))

        san_email = cast(list[str], d.pop("sanEmail", UNSET))

        revoke_original = d.pop("revokeOriginal", UNSET)

        renew_certificate_request = cls(
            id=id,
            generate_new_key=generate_new_key,
            validity_days=validity_days,
            update_info=update_info,
            subject=subject,
            san_dns=san_dns,
            san_ip=san_ip,
            san_email=san_email,
            revoke_original=revoke_original,
        )

        return renew_certificate_request
