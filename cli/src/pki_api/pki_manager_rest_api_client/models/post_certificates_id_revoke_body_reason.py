from enum import Enum


class PostCertificatesIdRevokeBodyReason(str, Enum):
    AFFILIATIONCHANGED = "affiliationChanged"
    CACOMPROMISE = "caCompromise"
    CERTIFICATEHOLD = "certificateHold"
    CESSATIONOFOPERATION = "cessationOfOperation"
    KEYCOMPROMISE = "keyCompromise"
    REMOVEFROMCRL = "removeFromCRL"
    SUPERSEDED = "superseded"
    UNSPECIFIED = "unspecified"

    def __str__(self) -> str:
        return str(self.value)
