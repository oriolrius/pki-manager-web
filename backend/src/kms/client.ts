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
    issuerName?: string;
    subjectName?: string;
    daysValid?: number;
    tags?: string[];
    keySizeInBits?: number; // Key size for KMS to generate (default 4096)
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

    // Build Attributes structure for KMIP 2.1
    const attributes: KMIPElement[] = [];

    // Add CertificateType (required when Certificate Request Type is omitted)
    attributes.push({
      tag: "CertificateType",
      type: "Enumeration",
      value: "X509",
    });

    // Add cryptographic algorithm information (required for key pair generation)
    // When no key links are provided, Cosmian will generate a new key pair
    attributes.push({
      tag: "CryptographicAlgorithm",
      type: "Enumeration",
      value: "RSA",
    });
    attributes.push({
      tag: "CryptographicLength",
      type: "Integer",
      value: options.keySizeInBits || 4096, // Default to 4096 if not specified
    });

    // Add Link to issuer certificate (for non-self-signed)
    if (options.issuerCertificateId) {
      attributes.push({
        tag: "Link",
        value: [
          {
            tag: "LinkType",
            type: "Enumeration",
            value: "CertificateLink",
          },
          {
            tag: "LinkedObjectIdentifier",
            type: "TextString",
            value: options.issuerCertificateId,
          },
        ],
      });
    }

    // Add subject name using CertificateAttributes structure with individual fields
    if (options.subjectName) {
      // Parse the DN string into individual components
      const dnParts = options.subjectName.split(',').map(part => {
        const [key, ...valueParts] = part.trim().split('=');
        return { key: key.trim(), value: valueParts.join('=').trim() };
      });

      const certAttrs: KMIPElement[] = [];
      const isSelfSigned = !options.issuerCertificateId;

      for (const part of dnParts) {
        switch (part.key) {
          case 'CN':
            certAttrs.push({
              tag: "CertificateSubjectCn",
              type: "TextString",
              value: part.value,
            });
            if (isSelfSigned) {
              certAttrs.push({
                tag: "CertificateIssuerCn",
                type: "TextString",
                value: part.value,
              });
            }
            break;
          case 'O':
            certAttrs.push({
              tag: "CertificateSubjectO",
              type: "TextString",
              value: part.value,
            });
            if (isSelfSigned) {
              certAttrs.push({
                tag: "CertificateIssuerO",
                type: "TextString",
                value: part.value,
              });
            }
            break;
          case 'OU':
            certAttrs.push({
              tag: "CertificateSubjectOu",
              type: "TextString",
              value: part.value,
            });
            if (isSelfSigned) {
              certAttrs.push({
                tag: "CertificateIssuerOu",
                type: "TextString",
                value: part.value,
              });
            }
            break;
          case 'C':
            certAttrs.push({
              tag: "CertificateSubjectC",
              type: "TextString",
              value: part.value,
            });
            if (isSelfSigned) {
              certAttrs.push({
                tag: "CertificateIssuerC",
                type: "TextString",
                value: part.value,
              });
            }
            break;
          case 'ST':
            certAttrs.push({
              tag: "CertificateSubjectSt",
              type: "TextString",
              value: part.value,
            });
            if (isSelfSigned) {
              certAttrs.push({
                tag: "CertificateIssuerSt",
                type: "TextString",
                value: part.value,
              });
            }
            break;
          case 'L':
            certAttrs.push({
              tag: "CertificateSubjectL",
              type: "TextString",
              value: part.value,
            });
            if (isSelfSigned) {
              certAttrs.push({
                tag: "CertificateIssuerL",
                type: "TextString",
                value: part.value,
              });
            }
            break;
        }
      }

      // Add required empty fields for all X.509 subject components that Cosmian KMS expects
      // Based on X.509 DN attributes and Cosmian KMS requirements
      const requiredSubjectFields = [
        "CertificateSubjectOu",  // Organizational Unit
        "CertificateSubjectSt",  // State
        "CertificateSubjectL",   // Locality
        "CertificateSubjectEmail",
        "CertificateSubjectUid",
        "CertificateSubjectSerialNumber",
        "CertificateSubjectTitle",
        "CertificateSubjectGivenName",
        "CertificateSubjectInitials",
        "CertificateSubjectGenerationQualifier",
        "CertificateSubjectDnQualifier",
        "CertificateSubjectPseudonym",
        "CertificateSubjectDc",  // Domain Component
      ];

      for (const field of requiredSubjectFields) {
        const hasField = certAttrs.some(attr => attr.tag === field);
        if (!hasField) {
          certAttrs.push({
            tag: field,
            type: "TextString",
            value: "",
          });
        }
      }

      // For self-signed certificates, also add empty issuer fields
      if (isSelfSigned) {
        const requiredIssuerFields = [
          "CertificateIssuerOu",  // Organizational Unit
          "CertificateIssuerSt",  // State
          "CertificateIssuerL",   // Locality
          "CertificateIssuerEmail",
          "CertificateIssuerUid",
          "CertificateIssuerSerialNumber",
          "CertificateIssuerTitle",
          "CertificateIssuerGivenName",
          "CertificateIssuerInitials",
          "CertificateIssuerGenerationQualifier",
          "CertificateIssuerDnQualifier",
          "CertificateIssuerPseudonym",
          "CertificateIssuerDc",
        ];

        for (const field of requiredIssuerFields) {
          const hasField = certAttrs.some(attr => attr.tag === field);
          if (!hasField) {
            certAttrs.push({
              tag: field,
              type: "TextString",
              value: "",
            });
          }
        }
      }

      // For non-self-signed certificates with issuerName, parse and add issuer fields
      if (!isSelfSigned && options.issuerName) {
        const issuerParts = options.issuerName.split(',').map(part => {
          const [key, ...valueParts] = part.trim().split('=');
          return { key: key.trim(), value: valueParts.join('=').trim() };
        });

        for (const part of issuerParts) {
          switch (part.key) {
            case 'CN':
              certAttrs.push({
                tag: "CertificateIssuerCn",
                type: "TextString",
                value: part.value,
              });
              break;
            case 'O':
              certAttrs.push({
                tag: "CertificateIssuerO",
                type: "TextString",
                value: part.value,
              });
              break;
            case 'OU':
              certAttrs.push({
                tag: "CertificateIssuerOu",
                type: "TextString",
                value: part.value,
              });
              break;
            case 'C':
              certAttrs.push({
                tag: "CertificateIssuerC",
                type: "TextString",
                value: part.value,
              });
              break;
            case 'ST':
              certAttrs.push({
                tag: "CertificateIssuerSt",
                type: "TextString",
                value: part.value,
              });
              break;
            case 'L':
              certAttrs.push({
                tag: "CertificateIssuerL",
                type: "TextString",
                value: part.value,
              });
              break;
          }
        }

        // Add required empty issuer fields
        const requiredIssuerFields = [
          "CertificateIssuerOu",  // Organizational Unit
          "CertificateIssuerSt",  // State
          "CertificateIssuerL",   // Locality
          "CertificateIssuerEmail",
          "CertificateIssuerUid",
          "CertificateIssuerSerialNumber",
          "CertificateIssuerTitle",
          "CertificateIssuerGivenName",
          "CertificateIssuerInitials",
          "CertificateIssuerGenerationQualifier",
          "CertificateIssuerDnQualifier",
          "CertificateIssuerPseudonym",
          "CertificateIssuerDc",
        ];

        for (const field of requiredIssuerFields) {
          const hasField = certAttrs.some(attr => attr.tag === field);
          if (!hasField) {
            certAttrs.push({
              tag: field,
              type: "TextString",
              value: "",
            });
          }
        }
      }

      if (certAttrs.length > 0) {
        console.log('[KMS Client] Adding CertificateAttributes:', JSON.stringify(certAttrs, null, 2));
        attributes.push({
          tag: "CertificateAttributes",
          value: certAttrs,
        });
      } else {
        console.log('[KMS Client] WARNING: certAttrs is empty!');
      }
    }
    console.log('[KMS Client] Total attributes count:', attributes.length);

    // Add tags as vendor attribute
    if (options.tags && options.tags.length > 0) {
      attributes.push({
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

    // Add Attributes structure to request
    if (attributes.length > 0) {
      requestValue.push({
        tag: "Attributes",
        value: attributes,
      });
    }

    // Add subject name at request level for "Certify from Subject" mode
    if (options.subjectName) {
      requestValue.push({
        tag: "Subject",
        type: "TextString",
        value: options.subjectName,
      });
    }

    const request: KMIPRequest = {
      tag: "Certify",
      value: requestValue,
    };

    const response = await this.sendKMIPRequest(request);

    // Cosmian's Certify response only returns the certificate ID
    // We need to Get the certificate to retrieve its data and linked key IDs
    const certificateId = this.findElement(
      response.value,
      "UniqueIdentifier"
    );
    const certId = this.getStringValue(certificateId);

    // Fetch the certificate object to get its data and attributes
    const getRequest: KMIPRequest = {
      tag: "Get",
      value: [
        {
          tag: "UniqueIdentifier",
          type: "TextString",
          value: certId,
        },
      ],
    };

    const getResponse = await this.sendKMIPRequest(getRequest);

    // The Certificate is a structure containing CertificateType and CertificateValue
    const certificate = this.findElement(getResponse.value, "Certificate");
    const certificateValue = this.findElement((certificate as any).value, "CertificateValue");

    const result: CertificateInfo = {
      certificateId: certId,
      certificateData: this.getByteStringValue(certificateValue),
    };

    // Try to extract key IDs from the certificate's attributes or links
    // These might be in the Get response as links
    try {
      const attributes = this.findElement(getResponse.value, "Attributes");
      if (attributes && Array.isArray((attributes as any).value)) {
        for (const attr of (attributes as any).value) {
          if (attr.tag === "Link") {
            const linkType = this.findElement(attr.value, "LinkType");
            const linkId = this.findElement(attr.value, "LinkedObjectIdentifier");
            const linkTypeValue = this.getStringValue(linkType);

            if (linkTypeValue === "PrivateKeyLink") {
              result.privateKeyId = this.getStringValue(linkId);
            } else if (linkTypeValue === "PublicKeyLink") {
              result.publicKeyId = this.getStringValue(linkId);
            }
          }
        }
      }
    } catch (e) {
      // Key IDs not found in response - need to implement key discovery via Locate/Query operations
    }

    return result;
  }

  /**
   * Get certificate from KMS by ID and return PEM format
   */
  async getCertificate(certificateId: string): Promise<string> {
    const getRequest: KMIPRequest = {
      tag: "Get",
      value: [
        {
          tag: "UniqueIdentifier",
          type: "TextString",
          value: certificateId,
        },
      ],
    };

    const getResponse = await this.sendKMIPRequest(getRequest);

    // Extract certificate from response
    const certificate = this.findElement(getResponse.value, "Certificate");
    const certificateValue = this.findElement((certificate as any).value, "CertificateValue");
    const certDataHex = this.getByteStringValue(certificateValue);

    // Convert hex to PEM
    const certDataBuffer = Buffer.from(certDataHex, 'hex');
    const certBase64 = certDataBuffer.toString('base64');
    const certificatePem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`;

    return certificatePem;
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
