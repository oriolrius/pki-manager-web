#!/usr/bin/env tsx
/**
 * Backfill script to populate keyAlgorithm field for existing CAs
 *
 * This script:
 * 1. Finds all CAs with null/empty keyAlgorithm
 * 2. Fetches their certificates from KMS
 * 3. Parses the certificates to extract keyAlgorithm
 * 4. Updates the database with the keyAlgorithm value
 */

import { db } from '../db/client.js';
import { certificateAuthorities } from '../db/schema.js';
import { getKMSService } from '../kms/service.js';
import { parseCertificate } from '../crypto/x509.js';
import { logger } from '../lib/logger.js';
import { eq, isNull, or } from 'drizzle-orm';

async function backfillKeyAlgorithm() {
  logger.info('Starting keyAlgorithm backfill for existing CAs...');
  const kmsService = getKMSService();

  // Find all CAs without keyAlgorithm
  const casWithoutKeyAlgo = await db
    .select()
    .from(certificateAuthorities)
    .where(or(isNull(certificateAuthorities.keyAlgorithm), eq(certificateAuthorities.keyAlgorithm, '')));

  logger.info({ count: casWithoutKeyAlgo.length }, 'Found CAs without keyAlgorithm');

  if (casWithoutKeyAlgo.length === 0) {
    logger.info('No CAs to backfill. Exiting.');
    return;
  }

  let successCount = 0;
  let failureCount = 0;

  for (const ca of casWithoutKeyAlgo) {
    try {
      logger.info({ caId: ca.id, subject: ca.subjectDn }, 'Backfilling keyAlgorithm for CA');

      // Fetch certificate from KMS
      const certificatePem = await kmsService.getCertificate(ca.kmsCertificateId, ca.id);

      // Parse certificate to extract key algorithm
      const certMetadata = parseCertificate(certificatePem, 'PEM');

      // Update database
      await db
        .update(certificateAuthorities)
        .set({
          keyAlgorithm: certMetadata.keyAlgorithm,
          updatedAt: new Date(),
        } as any)
        .where(eq(certificateAuthorities.id, ca.id));

      logger.info(
        { caId: ca.id, keyAlgorithm: certMetadata.keyAlgorithm },
        'Successfully backfilled keyAlgorithm'
      );
      successCount++;
    } catch (error) {
      logger.error(
        { error, caId: ca.id, subject: ca.subjectDn },
        'Failed to backfill keyAlgorithm for CA'
      );
      failureCount++;
    }
  }

  logger.info(
    { total: casWithoutKeyAlgo.length, success: successCount, failures: failureCount },
    'Backfill complete'
  );
}

// Run the backfill
backfillKeyAlgorithm()
  .then(() => {
    logger.info('Backfill script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, 'Backfill script failed');
    process.exit(1);
  });
