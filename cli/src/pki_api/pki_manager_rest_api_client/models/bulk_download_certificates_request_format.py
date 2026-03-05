from enum import Enum


class BulkDownloadCertificatesRequestFormat(str, Enum):
    ALL = "all"
    CER = "cer"
    CRT = "crt"
    DER = "der"
    DOCKER_VOLUME = "docker-volume"
    JKS_KEYSTORE = "jks-keystore"
    JKS_TRUSTSTORE = "jks-truststore"
    P12 = "p12"
    P7B = "p7b"
    PEM = "pem"
    PEM_CHAIN = "pem-chain"
    PEM_KEY = "pem-key"
    PFX = "pfx"
    PKCS12 = "pkcs12"
    PKCS7 = "pkcs7"

    def __str__(self) -> str:
        return str(self.value)
