from enum import Enum


class PostCertificatesBodyKeyAlgorithm(str, Enum):
    RSA_2048 = "RSA-2048"
    RSA_4096 = "RSA-4096"

    def __str__(self) -> str:
        return str(self.value)
