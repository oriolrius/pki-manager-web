from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.create_ca_request_key_algorithm import CreateCaRequestKeyAlgorithm
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_ca_request_subject import CreateCaRequestSubject


T = TypeVar("T", bound="CreateCaRequest")


@_attrs_define
class CreateCaRequest:
    """
    Attributes:
        subject (CreateCaRequestSubject):
        key_algorithm (CreateCaRequestKeyAlgorithm | Unset):  Default: CreateCaRequestKeyAlgorithm.RSA_4096.
        validity_years (int | Unset):  Default: 20.
        tags (list[str] | Unset):
    """

    subject: CreateCaRequestSubject
    key_algorithm: CreateCaRequestKeyAlgorithm | Unset = CreateCaRequestKeyAlgorithm.RSA_4096
    validity_years: int | Unset = 20
    tags: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        subject = self.subject.to_dict()

        key_algorithm: str | Unset = UNSET
        if not isinstance(self.key_algorithm, Unset):
            key_algorithm = self.key_algorithm.value

        validity_years = self.validity_years

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "subject": subject,
            }
        )
        if key_algorithm is not UNSET:
            field_dict["keyAlgorithm"] = key_algorithm
        if validity_years is not UNSET:
            field_dict["validityYears"] = validity_years
        if tags is not UNSET:
            field_dict["tags"] = tags

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_ca_request_subject import CreateCaRequestSubject

        d = dict(src_dict)
        subject = CreateCaRequestSubject.from_dict(d.pop("subject"))

        _key_algorithm = d.pop("keyAlgorithm", UNSET)
        key_algorithm: CreateCaRequestKeyAlgorithm | Unset
        if isinstance(_key_algorithm, Unset):
            key_algorithm = UNSET
        else:
            key_algorithm = CreateCaRequestKeyAlgorithm(_key_algorithm)

        validity_years = d.pop("validityYears", UNSET)

        tags = cast(list[str], d.pop("tags", UNSET))

        create_ca_request = cls(
            subject=subject,
            key_algorithm=key_algorithm,
            validity_years=validity_years,
            tags=tags,
        )

        return create_ca_request
