from enum import Enum


class GetSearchResponse200ResultsCasItemType(str, Enum):
    CA = "ca"

    def __str__(self) -> str:
        return str(self.value)
