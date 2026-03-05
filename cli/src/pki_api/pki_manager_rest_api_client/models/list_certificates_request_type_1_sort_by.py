from enum import Enum


class ListCertificatesRequestType1SortBy(str, Enum):
    CERTIFICATETYPE = "certificateType"
    CREATEDAT = "createdAt"
    NOTAFTER = "notAfter"
    NOTBEFORE = "notBefore"
    SERIALNUMBER = "serialNumber"
    STATUS = "status"
    SUBJECTDN = "subjectDn"

    def __str__(self) -> str:
        return str(self.value)
