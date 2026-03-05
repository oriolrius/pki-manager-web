from enum import Enum


class CreateCertificateRequestCertificateType(str, Enum):
    CLIENT = "client"
    CODE_SIGNING = "code_signing"
    EMAIL = "email"
    SERVER = "server"

    def __str__(self) -> str:
        return str(self.value)
