from enum import Enum


class PostCertificatesBulkRevokeBodyReason(str, Enum):
    AFFILIATIONCHANGED = "affiliationChanged"
    CACOMPROMISE = "caCompromise"
    CERTIFICATEHOLD = "certificateHold"
    CESSATIONOFOPERATION = "cessationOfOperation"
    KEYCOMPROMISE = "keyCompromise"
    PRIVILEGEWITHDRAWN = "privilegeWithdrawn"
    SUPERSEDED = "superseded"
    UNSPECIFIED = "unspecified"

    def __str__(self) -> str:
        return str(self.value)
