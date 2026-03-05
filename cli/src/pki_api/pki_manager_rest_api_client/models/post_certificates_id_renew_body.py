from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_certificates_id_renew_body_subject import PostCertificatesIdRenewBodySubject


T = TypeVar("T", bound="PostCertificatesIdRenewBody")


@_attrs_define
class PostCertificatesIdRenewBody:
    """
    Attributes:
        generate_new_key (bool | Unset): Generate a new key pair for the renewed certificate Default: True.
        validity_days (int | Unset): Validity period in days (defaults to original validity)
        update_info (bool | Unset): Update subject or SANs with new values Default: False.
        subject (PostCertificatesIdRenewBodySubject | Unset): New subject information (requires updateInfo=true)
        san_dns (list[str] | Unset): New DNS SANs (requires updateInfo=true)
        san_ip (list[str] | Unset): New IP SANs (requires updateInfo=true)
        san_email (list[str] | Unset): New Email SANs (requires updateInfo=true)
        revoke_original (bool | Unset): Revoke the original certificate after renewal Default: False.
    """

    generate_new_key: bool | Unset = True
    validity_days: int | Unset = UNSET
    update_info: bool | Unset = False
    subject: PostCertificatesIdRenewBodySubject | Unset = UNSET
    san_dns: list[str] | Unset = UNSET
    san_ip: list[str] | Unset = UNSET
    san_email: list[str] | Unset = UNSET
    revoke_original: bool | Unset = False
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
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
        field_dict.update(self.additional_properties)
        field_dict.update({})
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
        from ..models.post_certificates_id_renew_body_subject import PostCertificatesIdRenewBodySubject

        d = dict(src_dict)
        generate_new_key = d.pop("generateNewKey", UNSET)

        validity_days = d.pop("validityDays", UNSET)

        update_info = d.pop("updateInfo", UNSET)

        _subject = d.pop("subject", UNSET)
        subject: PostCertificatesIdRenewBodySubject | Unset
        if isinstance(_subject, Unset):
            subject = UNSET
        else:
            subject = PostCertificatesIdRenewBodySubject.from_dict(_subject)

        san_dns = cast(list[str], d.pop("sanDns", UNSET))

        san_ip = cast(list[str], d.pop("sanIp", UNSET))

        san_email = cast(list[str], d.pop("sanEmail", UNSET))

        revoke_original = d.pop("revokeOriginal", UNSET)

        post_certificates_id_renew_body = cls(
            generate_new_key=generate_new_key,
            validity_days=validity_days,
            update_info=update_info,
            subject=subject,
            san_dns=san_dns,
            san_ip=san_ip,
            san_email=san_email,
            revoke_original=revoke_original,
        )

        post_certificates_id_renew_body.additional_properties = d
        return post_certificates_id_renew_body

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
