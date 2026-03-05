from enum import Enum


class GetCasSortBy(str, Enum):
    EXPIRYDATE = "expiryDate"
    ISSUEDDATE = "issuedDate"
    NAME = "name"

    def __str__(self) -> str:
        return str(self.value)
