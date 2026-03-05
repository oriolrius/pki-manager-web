from enum import Enum


class GetCertificatesIdDownloadFormat(str, Enum):
    CHAIN_PEM = "chain-pem"
    CSR_PEM = "csr-pem"
    DER = "der"
    FULL_DER = "full-der"
    FULL_PEM = "full-pem"
    JKS_KEYSTORE = "jks-keystore"
    JKS_TRUSTSTORE = "jks-truststore"
    KEY_DER = "key-der"
    KEY_PEM = "key-pem"
    P12 = "p12"
    PEM = "pem"
    PFX = "pfx"
    PKCS8_DER = "pkcs8-der"
    PKCS8_ENCRYPTED = "pkcs8-encrypted"
    PKCS8_PEM = "pkcs8-pem"

    def __str__(self) -> str:
        return str(self.value)
