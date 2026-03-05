from enum import Enum


class GetCasIdDownloadFormat(str, Enum):
    CER = "cer"
    CRT = "crt"
    DER = "der"
    JKS_KEYSTORE = "jks-keystore"
    JKS_TRUSTSTORE = "jks-truststore"
    P12_KEYSTORE = "p12-keystore"
    P12_TRUSTSTORE = "p12-truststore"
    PEM = "pem"

    def __str__(self) -> str:
        return str(self.value)
