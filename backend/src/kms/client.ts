import { logger } from "../lib/logger.js";
import type {
  KMIPRequest,
  KMIPResponse,
  KMIPElement,
  KeyPairIds,
  CertificateInfo,
  KMIPError,
} from "./types.js";

export interface KMSClientConfig {
  url: string;
  apiKey?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class KMSClient {
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;

  constructor(config: KMSClientConfig) {
    this.url = config.url.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = config.apiKey;
    this.timeout = config.timeout || 30000; // 30 seconds default
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000; // 1 second
  }

  /**
   * Send a KMIP request to the KMS server
   */
  private async sendKMIPRequest(
    request: KMIPRequest
  ): Promise<KMIPResponse> {
    const endpoint = `${this.url}/kmip/2_1`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    logger.debug({ request }, "Sending KMIP request");

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(
            `KMS request failed: ${response.status} ${response.statusText} - ${errorText}`
          );

          // Don't retry on client errors (4xx) - they won't be fixed by retrying
          if (response.status >= 400 && response.status < 500) {
            throw error;
          }

          throw error;
        }

        const responseData = (await response.json()) as KMIPResponse;
        logger.debug({ response: responseData }, "Received KMIP response");

        return responseData;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(
          { attempt, error: lastError.message },
          `KMS request attempt ${attempt} failed`
        );

        if (attempt < this.retryAttempts) {
          await this.delay(this.retryDelay * attempt);
        }
      }
    }

    throw lastError || new Error("KMS request failed after all retries");
  }

  /**
   * Delay helper for retries
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract value from KMIP element by tag
   */
  private findElement(
    elements: KMIPElement[],
    tag: string
  ): KMIPElement | undefined {
    return elements.find((el) => el.tag === tag);
  }

  /**
   * Extract string value from KMIP element
   */
  private getStringValue(element: KMIPElement | undefined): string {
    if (!element || typeof element.value !== "string") {
      throw new Error(`Expected string value for ${element?.tag}`);
    }
    return element.value;
  }

  /**
   * Extract byte string value from KMIP element and convert to string
   */
  private getByteStringValue(element: KMIPElement | undefined): string {
    if (!element) {
      throw new Error("Element not found");
    }
    return element.value as string;
  }

  /**
   * Test connection to KMS
   */
  async testConnection(): Promise<boolean> {
    try {
      // Try a simple Query operation to test connection
      const request: KMIPRequest = {
        tag: "Query",
        value: [],
      };

      await this.sendKMIPRequest(request);
      logger.info("KMS connection test successful");
      return true;
    } catch (error) {
      logger.error({ error }, "KMS connection test failed");
      return false;
    }
  }

  /**
   * Create an RSA key pair
   */
  async createKeyPair(options: {
    sizeInBits?: number;
    tags?: string[];
  }): Promise<KeyPairIds> {
    const sizeInBits = options.sizeInBits || 4096;
    const tags = options.tags || [];

    const commonAttributes: KMIPElement[] = [
      {
        tag: "CryptographicAlgorithm",
        type: "Enumeration",
        value: "RSA",
      },
      {
        tag: "CryptographicLength",
        type: "Integer",
        value: sizeInBits,
      },
      {
        tag: "CryptographicUsageMask",
        type: "Integer",
        value: 2097152, // Sign/Verify
      },
      {
        tag: "KeyFormatType",
        type: "Enumeration",
        value: "TransparentRSAPrivateKey",
      },
      {
        tag: "ObjectType",
        type: "Enumeration",
        value: "PrivateKey",
      },
    ];

    // Add tags if provided
    if (tags.length > 0) {
      commonAttributes.push({
        tag: "Attribute",
        value: [
          {
            tag: "VendorIdentification",
            type: "TextString",
            value: "cosmian",
          },
          {
            tag: "AttributeName",
            type: "TextString",
            value: "tag",
          },
          {
            tag: "AttributeValue",
            type: "TextString",
            value: JSON.stringify(tags),
          },
        ],
      });
    }

    const request: KMIPRequest = {
      tag: "CreateKeyPair",
      value: [
        {
          tag: "CommonAttributes",
          value: commonAttributes,
        },
        {
          tag: "PrivateKeyAttributes",
          value: commonAttributes.filter((attr) => attr.tag !== "Attribute"),
        },
        {
          tag: "PublicKeyAttributes",
          value: commonAttributes.filter((attr) => attr.tag !== "Attribute"),
        },
      ],
    };

    const response = await this.sendKMIPRequest(request);

    const privateKeyId = this.findElement(
      response.value,
      "PrivateKeyUniqueIdentifier"
    );
    const publicKeyId = this.findElement(
      response.value,
      "PublicKeyUniqueIdentifier"
    );

    return {
      privateKeyId: this.getStringValue(privateKeyId),
      publicKeyId: this.getStringValue(publicKeyId),
    };
  }

  /**
   * Get a public key in PEM format
   */
  async getPublicKey(keyId: string): Promise<string> {
    const request: KMIPRequest = {
      tag: "Get",
      value: [
        {
          tag: "UniqueIdentifier",
          type: "TextString",
          value: keyId,
        },
        {
          tag: "KeyFormatType",
          type: "Enumeration",
          value: "PKCS8",
        },
        {
          tag: "KeyWrapType",
          type: "Enumeration",
          value: "AsRegistered",
        },
      ],
    };

    const response = await this.sendKMIPRequest(request);

    // Navigate to KeyMaterial
    const publicKeyElement = this.findElement(response.value, "PublicKey");
    if (!publicKeyElement || !Array.isArray(publicKeyElement.value)) {
      throw new Error("Invalid response structure: PublicKey not found");
    }

    const keyBlock = this.findElement(publicKeyElement.value, "KeyBlock");
    if (!keyBlock || !Array.isArray(keyBlock.value)) {
      throw new Error("Invalid response structure: KeyBlock not found");
    }

    const keyValue = this.findElement(keyBlock.value, "KeyValue");
    if (!keyValue || !Array.isArray(keyValue.value)) {
      throw new Error("Invalid response structure: KeyValue not found");
    }

    const keyMaterial = this.findElement(keyValue.value, "KeyMaterial");
    const keyMaterialBytes = this.getByteStringValue(keyMaterial);

    // Convert hex string to PEM format
    const derHex = keyMaterialBytes;
    const derBytes = Buffer.from(derHex, "hex");
    const base64 = derBytes.toString("base64");

    // Format as PEM
    const pem = `-----BEGIN PUBLIC KEY-----\n${base64.match(/.{1,64}/g)?.join("\n")}\n-----END PUBLIC KEY-----`;

    return pem;
  }

  /**
   * Certify a certificate signing request or public key
   */
  async certify(options: {
    csr?: string;
    publicKeyId?: string;
    issuerPrivateKeyId?: string;
    issuerCertificateId?: string;
    subjectName?: string;
    daysValid?: number;
    tags?: string[];
  }): Promise<CertificateInfo> {
    const requestValue: KMIPElement[] = [];

    // Add CSR if provided
    if (options.csr) {
      requestValue.push({
        tag: "CertificateRequest",
        type: "ByteString",
        value: Buffer.from(options.csr).toString("hex"),
      });
      requestValue.push({
        tag: "CertificateRequestType",
        type: "Enumeration",
        value: "PEM",
      });
    }

    // Add public key ID if provided
    if (options.publicKeyId) {
      requestValue.push({
        tag: "PublicKeyIdentifier",
        type: "TextString",
        value: options.publicKeyId,
      });
    }

    // Add issuer private key ID
    if (options.issuerPrivateKeyId) {
      requestValue.push({
        tag: "PrivateKeyIdentifier",
        type: "TextString",
        value: options.issuerPrivateKeyId,
      });
    }

    // Add issuer certificate ID
    if (options.issuerCertificateId) {
      requestValue.push({
        tag: "CertificateIdentifier",
        type: "TextString",
        value: options.issuerCertificateId,
      });
    }

    // Add subject name
    if (options.subjectName) {
      requestValue.push({
        tag: "CertificateRequestSubjectDN",
        type: "TextString",
        value: options.subjectName,
      });
    }

    // Add validity period
    if (options.daysValid) {
      requestValue.push({
        tag: "NotBefore",
        type: "DateTime",
        value: new Date().toISOString(),
      });
      const notAfter = new Date();
      notAfter.setDate(notAfter.getDate() + options.daysValid);
      requestValue.push({
        tag: "NotAfter",
        type: "DateTime",
        value: notAfter.toISOString(),
      });
    }

    // Add tags
    if (options.tags && options.tags.length > 0) {
      requestValue.push({
        tag: "Attribute",
        value: [
          {
            tag: "VendorIdentification",
            type: "TextString",
            value: "cosmian",
          },
          {
            tag: "AttributeName",
            type: "TextString",
            value: "tag",
          },
          {
            tag: "AttributeValue",
            type: "TextString",
            value: JSON.stringify(options.tags),
          },
        ],
      });
    }

    const request: KMIPRequest = {
      tag: "Certify",
      value: requestValue,
    };

    const response = await this.sendKMIPRequest(request);

    const certificateId = this.findElement(
      response.value,
      "UniqueIdentifier"
    );
    const certificate = this.findElement(response.value, "Certificate");

    return {
      certificateId: this.getStringValue(certificateId),
      certificateData: this.getByteStringValue(certificate),
    };
  }

  /**
   * Revoke a key
   */
  async revokeKey(keyId: string, reason?: string): Promise<void> {
    const request: KMIPRequest = {
      tag: "Revoke",
      value: [
        {
          tag: "UniqueIdentifier",
          type: "TextString",
          value: keyId,
        },
        {
          tag: "RevocationReason",
          value: [
            {
              tag: "RevocationReasonCode",
              type: "Enumeration",
              value: "Unspecified",
            },
            {
              tag: "RevocationMessage",
              type: "TextString",
              value: reason || "Revoked",
            },
          ],
        },
      ],
    };

    await this.sendKMIPRequest(request);
    logger.info({ keyId }, "Key revoked");
  }

  /**
   * Destroy a key (must be revoked first)
   */
  async destroyKey(keyId: string): Promise<void> {
    const request: KMIPRequest = {
      tag: "Destroy",
      value: [
        {
          tag: "UniqueIdentifier",
          type: "TextString",
          value: keyId,
        },
      ],
    };

    await this.sendKMIPRequest(request);
    logger.info({ keyId }, "Key destroyed");
  }

  /**
   * Revoke and destroy a key pair
   *
   * Note: KMS automatically revokes/destroys linked public keys when the
   * private key is revoked/destroyed, so we only need to operate on the
   * private key.
   */
  async destroyKeyPair(
    privateKeyId: string,
    publicKeyId: string
  ): Promise<void> {
    // Revoke the private key (KMS will automatically revoke the linked public key)
    await this.revokeKey(privateKeyId, "Key pair destroyed");
    logger.debug({ publicKeyId }, "Public key auto-revoked by KMS");

    // Destroy the private key (KMS will automatically destroy the linked public key)
    await this.destroyKey(privateKeyId);
    logger.debug({ publicKeyId }, "Public key auto-destroyed by KMS");

    logger.info({ privateKeyId, publicKeyId }, "Key pair destroyed");
  }
}
