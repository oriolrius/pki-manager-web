from enum import Enum


class GetSearchResponse200ResultsDomainsItemType(str, Enum):
    DOMAIN = "domain"

    def __str__(self) -> str:
        return str(self.value)
