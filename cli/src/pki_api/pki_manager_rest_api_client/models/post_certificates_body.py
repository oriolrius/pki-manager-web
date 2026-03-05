from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_certificates_body_certificate_type import PostCertificatesBodyCertificateType
from ..models.post_certificates_body_key_algorithm import PostCertificatesBodyKeyAlgorithm
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_certificates_body_subject import PostCertificatesBodySubject


T = TypeVar("T", bound="PostCertificatesBody")


@_attrs_define
class PostCertificatesBody:
    """
    Attributes:
        ca_id (UUID): ID of the issuing CA
        subject (PostCertificatesBodySubject):
        certificate_type (PostCertificatesBodyCertificateType):
        key_algorithm (PostCertificatesBodyKeyAlgorithm):
        validity_days (int): Validity period in days
        san_dns (list[str] | Unset): DNS Subject Alternative Names
        san_ip (list[str] | Unset): IP Subject Alternative Names
        san_email (list[str] | Unset): Email Subject Alternative Names
        tags (list[str] | Unset):
    """

    ca_id: UUID
    subject: PostCertificatesBodySubject
    certificate_type: PostCertificatesBodyCertificateType
    key_algorithm: PostCertificatesBodyKeyAlgorithm
    validity_days: int
    san_dns: list[str] | Unset = UNSET
    san_ip: list[str] | Unset = UNSET
    san_email: list[str] | Unset = UNSET
    tags: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ca_id = str(self.ca_id)

        subject = self.subject.to_dict()

        certificate_type = self.certificate_type.value

        key_algorithm = self.key_algorithm.value

        validity_days = self.validity_days

        san_dns: list[str] | Unset = UNSET
        if not isinstance(self.san_dns, Unset):
            san_dns = self.san_dns

        san_ip: list[str] | Unset = UNSET
        if not isinstance(self.san_ip, Unset):
            san_ip = self.san_ip

        san_email: list[str] | Unset = UNSET
        if not isinstance(self.san_email, Unset):
            san_email = self.san_email

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "caId": ca_id,
                "subject": subject,
                "certificateType": certificate_type,
                "keyAlgorithm": key_algorithm,
                "validityDays": validity_days,
            }
        )
        if san_dns is not UNSET:
            field_dict["sanDns"] = san_dns
        if san_ip is not UNSET:
            field_dict["sanIp"] = san_ip
        if san_email is not UNSET:
            field_dict["sanEmail"] = san_email
        if tags is not UNSET:
            field_dict["tags"] = tags

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_certificates_body_subject import PostCertificatesBodySubject

        d = dict(src_dict)
        ca_id = UUID(d.pop("caId"))

        subject = PostCertificatesBodySubject.from_dict(d.pop("subject"))

        certificate_type = PostCertificatesBodyCertificateType(d.pop("certificateType"))

        key_algorithm = PostCertificatesBodyKeyAlgorithm(d.pop("keyAlgorithm"))

        validity_days = d.pop("validityDays")

        san_dns = cast(list[str], d.pop("sanDns", UNSET))

        san_ip = cast(list[str], d.pop("sanIp", UNSET))

        san_email = cast(list[str], d.pop("sanEmail", UNSET))

        tags = cast(list[str], d.pop("tags", UNSET))

        post_certificates_body = cls(
            ca_id=ca_id,
            subject=subject,
            certificate_type=certificate_type,
            key_algorithm=key_algorithm,
            validity_days=validity_days,
            san_dns=san_dns,
            san_ip=san_ip,
            san_email=san_email,
            tags=tags,
        )

        post_certificates_body.additional_properties = d
        return post_certificates_body

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
