from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.list_cas_request_type_1_algorithm import ListCasRequestType1Algorithm
from ..models.list_cas_request_type_1_sort_by import ListCasRequestType1SortBy
from ..models.list_cas_request_type_1_sort_order import ListCasRequestType1SortOrder
from ..models.list_cas_request_type_1_status import ListCasRequestType1Status
from ..types import UNSET, Unset

T = TypeVar("T", bound="ListCasRequestType1")


@_attrs_define
class ListCasRequestType1:
    """
    Attributes:
        status (ListCasRequestType1Status | Unset):
        algorithm (ListCasRequestType1Algorithm | Unset):
        search (str | Unset):
        sort_by (ListCasRequestType1SortBy | Unset):  Default: ListCasRequestType1SortBy.ISSUEDDATE.
        sort_order (ListCasRequestType1SortOrder | Unset):  Default: ListCasRequestType1SortOrder.DESC.
        limit (int | Unset):  Default: 50.
        offset (int | Unset):  Default: 0.
    """

    status: ListCasRequestType1Status | Unset = UNSET
    algorithm: ListCasRequestType1Algorithm | Unset = UNSET
    search: str | Unset = UNSET
    sort_by: ListCasRequestType1SortBy | Unset = ListCasRequestType1SortBy.ISSUEDDATE
    sort_order: ListCasRequestType1SortOrder | Unset = ListCasRequestType1SortOrder.DESC
    limit: int | Unset = 50
    offset: int | Unset = 0

    def to_dict(self) -> dict[str, Any]:
        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status.value

        algorithm: str | Unset = UNSET
        if not isinstance(self.algorithm, Unset):
            algorithm = self.algorithm.value

        search = self.search

        sort_by: str | Unset = UNSET
        if not isinstance(self.sort_by, Unset):
            sort_by = self.sort_by.value

        sort_order: str | Unset = UNSET
        if not isinstance(self.sort_order, Unset):
            sort_order = self.sort_order.value

        limit = self.limit

        offset = self.offset

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if status is not UNSET:
            field_dict["status"] = status
        if algorithm is not UNSET:
            field_dict["algorithm"] = algorithm
        if search is not UNSET:
            field_dict["search"] = search
        if sort_by is not UNSET:
            field_dict["sortBy"] = sort_by
        if sort_order is not UNSET:
            field_dict["sortOrder"] = sort_order
        if limit is not UNSET:
            field_dict["limit"] = limit
        if offset is not UNSET:
            field_dict["offset"] = offset

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _status = d.pop("status", UNSET)
        status: ListCasRequestType1Status | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = ListCasRequestType1Status(_status)

        _algorithm = d.pop("algorithm", UNSET)
        algorithm: ListCasRequestType1Algorithm | Unset
        if isinstance(_algorithm, Unset):
            algorithm = UNSET
        else:
            algorithm = ListCasRequestType1Algorithm(_algorithm)

        search = d.pop("search", UNSET)

        _sort_by = d.pop("sortBy", UNSET)
        sort_by: ListCasRequestType1SortBy | Unset
        if isinstance(_sort_by, Unset):
            sort_by = UNSET
        else:
            sort_by = ListCasRequestType1SortBy(_sort_by)

        _sort_order = d.pop("sortOrder", UNSET)
        sort_order: ListCasRequestType1SortOrder | Unset
        if isinstance(_sort_order, Unset):
            sort_order = UNSET
        else:
            sort_order = ListCasRequestType1SortOrder(_sort_order)

        limit = d.pop("limit", UNSET)

        offset = d.pop("offset", UNSET)

        list_cas_request_type_1 = cls(
            status=status,
            algorithm=algorithm,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
            limit=limit,
            offset=offset,
        )

        return list_cas_request_type_1
