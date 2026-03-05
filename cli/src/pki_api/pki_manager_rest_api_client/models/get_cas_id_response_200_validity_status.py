from enum import Enum


class GetCasIdResponse200ValidityStatus(str, Enum):
    EXPIRED = "expired"
    NOT_YET_VALID = "not_yet_valid"
    VALID = "valid"

    def __str__(self) -> str:
        return str(self.value)
