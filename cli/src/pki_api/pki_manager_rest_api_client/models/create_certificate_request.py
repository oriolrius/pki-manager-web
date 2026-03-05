from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.create_certificate_request_certificate_type import CreateCertificateRequestCertificateType
from ..models.create_certificate_request_key_algorithm import CreateCertificateRequestKeyAlgorithm
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_certificate_request_subject import CreateCertificateRequestSubject


T = TypeVar("T", bound="CreateCertificateRequest")


@_attrs_define
class CreateCertificateRequest:
    """
    Attributes:
        ca_id (str):
        subject (CreateCertificateRequestSubject):
        certificate_type (CreateCertificateRequestCertificateType):
        validity_days (int):
        key_algorithm (CreateCertificateRequestKeyAlgorithm | Unset):  Default:
            CreateCertificateRequestKeyAlgorithm.RSA_2048.
        san_dns (list[str] | Unset):
        san_ip (list[str] | Unset):
        san_email (list[str] | Unset):
        tags (list[str] | Unset):
    """

    ca_id: str
    subject: CreateCertificateRequestSubject
    certificate_type: CreateCertificateRequestCertificateType
    validity_days: int
    key_algorithm: CreateCertificateRequestKeyAlgorithm | Unset = CreateCertificateRequestKeyAlgorithm.RSA_2048
    san_dns: list[str] | Unset = UNSET
    san_ip: list[str] | Unset = UNSET
    san_email: list[str] | Unset = UNSET
    tags: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        ca_id = self.ca_id

        subject = self.subject.to_dict()

        certificate_type = self.certificate_type.value

        validity_days = self.validity_days

        key_algorithm: str | Unset = UNSET
        if not isinstance(self.key_algorithm, Unset):
            key_algorithm = self.key_algorithm.value

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

        field_dict.update(
            {
                "caId": ca_id,
                "subject": subject,
                "certificateType": certificate_type,
                "validityDays": validity_days,
            }
        )
        if key_algorithm is not UNSET:
            field_dict["keyAlgorithm"] = key_algorithm
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
        from ..models.create_certificate_request_subject import CreateCertificateRequestSubject

        d = dict(src_dict)
        ca_id = d.pop("caId")

        subject = CreateCertificateRequestSubject.from_dict(d.pop("subject"))

        certificate_type = CreateCertificateRequestCertificateType(d.pop("certificateType"))

        validity_days = d.pop("validityDays")

        _key_algorithm = d.pop("keyAlgorithm", UNSET)
        key_algorithm: CreateCertificateRequestKeyAlgorithm | Unset
        if isinstance(_key_algorithm, Unset):
            key_algorithm = UNSET
        else:
            key_algorithm = CreateCertificateRequestKeyAlgorithm(_key_algorithm)

        san_dns = cast(list[str], d.pop("sanDns", UNSET))

        san_ip = cast(list[str], d.pop("sanIp", UNSET))

        san_email = cast(list[str], d.pop("sanEmail", UNSET))

        tags = cast(list[str], d.pop("tags", UNSET))

        create_certificate_request = cls(
            ca_id=ca_id,
            subject=subject,
            certificate_type=certificate_type,
            validity_days=validity_days,
            key_algorithm=key_algorithm,
            san_dns=san_dns,
            san_ip=san_ip,
            san_email=san_email,
            tags=tags,
        )

        return create_certificate_request
