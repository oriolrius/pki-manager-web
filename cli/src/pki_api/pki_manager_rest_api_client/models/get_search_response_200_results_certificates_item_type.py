from enum import Enum


class GetSearchResponse200ResultsCertificatesItemType(str, Enum):
    CERTIFICATE = "certificate"

    def __str__(self) -> str:
        return str(self.value)
