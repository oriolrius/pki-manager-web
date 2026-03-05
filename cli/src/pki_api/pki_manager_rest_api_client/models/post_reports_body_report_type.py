from enum import Enum


class PostReportsBodyReportType(str, Enum):
    CA_OPERATIONS = "ca_operations"
    CERTIFICATE_INVENTORY = "certificate_inventory"
    REVOCATION = "revocation"

    def __str__(self) -> str:
        return str(self.value)
