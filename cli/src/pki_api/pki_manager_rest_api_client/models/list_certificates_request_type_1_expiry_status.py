from enum import Enum


class ListCertificatesRequestType1ExpiryStatus(str, Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    EXPIRING_SOON = "expiring_soon"

    def __str__(self) -> str:
        return str(self.value)
