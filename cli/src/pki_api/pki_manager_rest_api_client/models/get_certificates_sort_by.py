from enum import Enum


class GetCertificatesSortBy(str, Enum):
    CREATEDAT = "createdAt"
    NOTAFTER = "notAfter"
    SUBJECTDN = "subjectDn"

    def __str__(self) -> str:
        return str(self.value)
