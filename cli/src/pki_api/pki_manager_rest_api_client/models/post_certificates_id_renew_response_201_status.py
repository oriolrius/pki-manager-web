from enum import Enum


class PostCertificatesIdRenewResponse201Status(str, Enum):
    ACTIVE = "active"

    def __str__(self) -> str:
        return str(self.value)
