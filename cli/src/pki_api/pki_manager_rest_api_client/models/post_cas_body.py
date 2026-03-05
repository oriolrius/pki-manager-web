from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_cas_body_key_algorithm import PostCasBodyKeyAlgorithm
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_cas_body_subject import PostCasBodySubject


T = TypeVar("T", bound="PostCasBody")


@_attrs_define
class PostCasBody:
    """
    Attributes:
        subject (PostCasBodySubject):
        key_algorithm (PostCasBodyKeyAlgorithm):
        validity_years (int | Unset):  Default: 20.
        tags (list[str] | Unset):
    """

    subject: PostCasBodySubject
    key_algorithm: PostCasBodyKeyAlgorithm
    validity_years: int | Unset = 20
    tags: list[str] | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        subject = self.subject.to_dict()

        key_algorithm = self.key_algorithm.value

        validity_years = self.validity_years

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "subject": subject,
                "keyAlgorithm": key_algorithm,
            }
        )
        if validity_years is not UNSET:
            field_dict["validityYears"] = validity_years
        if tags is not UNSET:
            field_dict["tags"] = tags

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_cas_body_subject import PostCasBodySubject

        d = dict(src_dict)
        subject = PostCasBodySubject.from_dict(d.pop("subject"))

        key_algorithm = PostCasBodyKeyAlgorithm(d.pop("keyAlgorithm"))

        validity_years = d.pop("validityYears", UNSET)

        tags = cast(list[str], d.pop("tags", UNSET))

        post_cas_body = cls(
            subject=subject,
            key_algorithm=key_algorithm,
            validity_years=validity_years,
            tags=tags,
        )

        post_cas_body.additional_properties = d
        return post_cas_body

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
