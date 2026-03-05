from enum import Enum


class GetCasIdCrlsResponse200ItemsItemValidityStatus(str, Enum):
    EXPIRED = "expired"
    VALID = "valid"

    def __str__(self) -> str:
        return str(self.value)
