from enum import Enum


class ListCasRequestType1SortBy(str, Enum):
    EXPIRYDATE = "expiryDate"
    ISSUEDDATE = "issuedDate"
    NAME = "name"

    def __str__(self) -> str:
        return str(self.value)
