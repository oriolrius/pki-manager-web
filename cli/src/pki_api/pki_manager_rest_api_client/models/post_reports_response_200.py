from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_reports_response_200_summary import PostReportsResponse200Summary


T = TypeVar("T", bound="PostReportsResponse200")


@_attrs_define
class PostReportsResponse200:
    """
    Attributes:
        report_name (str | Unset):
        format_ (str | Unset):
        content (str | Unset):
        summary (PostReportsResponse200Summary | Unset):
        generated_at (datetime.datetime | Unset):
        hash_ (str | Unset):
        record_count (int | Unset):
    """

    report_name: str | Unset = UNSET
    format_: str | Unset = UNSET
    content: str | Unset = UNSET
    summary: PostReportsResponse200Summary | Unset = UNSET
    generated_at: datetime.datetime | Unset = UNSET
    hash_: str | Unset = UNSET
    record_count: int | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        report_name = self.report_name

        format_ = self.format_

        content = self.content

        summary: dict[str, Any] | Unset = UNSET
        if not isinstance(self.summary, Unset):
            summary = self.summary.to_dict()

        generated_at: str | Unset = UNSET
        if not isinstance(self.generated_at, Unset):
            generated_at = self.generated_at.isoformat()

        hash_ = self.hash_

        record_count = self.record_count

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if report_name is not UNSET:
            field_dict["reportName"] = report_name
        if format_ is not UNSET:
            field_dict["format"] = format_
        if content is not UNSET:
            field_dict["content"] = content
        if summary is not UNSET:
            field_dict["summary"] = summary
        if generated_at is not UNSET:
            field_dict["generatedAt"] = generated_at
        if hash_ is not UNSET:
            field_dict["hash"] = hash_
        if record_count is not UNSET:
            field_dict["recordCount"] = record_count

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_reports_response_200_summary import PostReportsResponse200Summary

        d = dict(src_dict)
        report_name = d.pop("reportName", UNSET)

        format_ = d.pop("format", UNSET)

        content = d.pop("content", UNSET)

        _summary = d.pop("summary", UNSET)
        summary: PostReportsResponse200Summary | Unset
        if isinstance(_summary, Unset):
            summary = UNSET
        else:
            summary = PostReportsResponse200Summary.from_dict(_summary)

        _generated_at = d.pop("generatedAt", UNSET)
        generated_at: datetime.datetime | Unset
        if isinstance(_generated_at, Unset):
            generated_at = UNSET
        else:
            generated_at = isoparse(_generated_at)

        hash_ = d.pop("hash", UNSET)

        record_count = d.pop("recordCount", UNSET)

        post_reports_response_200 = cls(
            report_name=report_name,
            format_=format_,
            content=content,
            summary=summary,
            generated_at=generated_at,
            hash_=hash_,
            record_count=record_count,
        )

        post_reports_response_200.additional_properties = d
        return post_reports_response_200

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
