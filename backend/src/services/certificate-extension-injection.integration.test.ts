/**
 * Integration test against the real KMS: a SAN value of the request must not be
 * able to change the extension text that the KMS reads.
 *
 * Each case issues (or renews) a certificate through the tRPC procedures, which
 * call the same CertificateService methods as the REST routes. The test prints
 * what happened ("IMPACT ..." lines) and then requires that the request was
 * refused by validation, before the KMS was called.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import forge from 'node-forge';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { TRPCError } from '@trpc/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { appRouter } from '../trpc/router.js';
import { createContext } from '../trpc/context.js';
import { isKmsAvailable } from '../test/kms-helper.js';

type Caller = ReturnType<typeof appRouter.createCaller>;

let kmsAvailable = false;
let caller: Caller;
let caId = '';

const LF = String.fromCharCode(10);

/** What the certificate holds, read with node-forge (the keys are RSA). */
function describeCertificate(pem: string): string {
  const cert = forge.pki.certificateFromPem(pem);
  const bc = cert.getExtension('basicConstraints') as { cA?: boolean } | null;
  const ku = cert.getExtension('keyUsage') as Record<string, unknown> | null;
  const eku = cert.getExtension('extKeyUsage') as Record<string, unknown> | null;
  const san = cert.getExtension('subjectAltName') as { altNames?: Array<{ type: number; value?: string; ip?: string }> } | null;
  const flags = (ext: Record<string, unknown> | null) =>
    ext ? Object.keys(ext).filter((k) => ext[k] === true && k !== 'critical') : [];
  // A certificate can hold the same extension twice: report each one.
  const allBasicConstraints = (cert.extensions as Array<{ name?: string; cA?: boolean }>)
    .filter((e) => e.name === 'basicConstraints')
    .map((e) => e.cA === true);
  let opensslPurpose = 'openssl not available';
  try {
    const text = execFileSync('openssl', ['x509', '-noout', '-purpose'], { input: pem, encoding: 'utf8' });
    opensslPurpose = text.split(LF).filter((line) => / CA : /.test(line) && /SSL (client|server)|Any Purpose/.test(line)).join('; ');
  } catch (error) {
    opensslPurpose = `openssl refused the certificate: ${(error as Error).message.split(LF)[0].slice(0, 120)}`;
  }
  return JSON.stringify({
    basicConstraintsCA: bc ? bc.cA === true : null,
    allBasicConstraints,
    nodeCa: new X509Certificate(pem).ca,
    opensslPurpose,
    keyUsage: flags(ku),
    extKeyUsage: flags(eku),
    san: (san?.altNames ?? []).map((n) => `${n.type}:${n.ip ?? n.value}`),
    extensions: cert.extensions.map((e: { name?: string; id: string }) => e.name || e.id),
  });
}

async function attempt(name: string, run: () => Promise<{ certificatePem?: string }>): Promise<string> {
  let outcome: string;
  let detail: string;
  try {
    const result = await run();
    outcome = 'ISSUED';
    detail = describeCertificate(result.certificatePem ?? '');
  } catch (error) {
    if (error instanceof TRPCError && error.code === 'BAD_REQUEST') outcome = 'REFUSED_BY_VALIDATION';
    else outcome = 'ERROR_AFTER_VALIDATION';
    detail = error instanceof Error ? error.message.slice(0, 300) : String(error);
  }
  console.log(`IMPACT ${name}: ${outcome} ${detail}`);
  return outcome;
}

beforeAll(async () => {
  kmsAvailable = await isKmsAvailable();
  if (!kmsAvailable) return;
  caller = appRouter.createCaller(await createContext({ req: {} as FastifyRequest, res: {} as FastifyReply }));
  const ca = await caller.ca.create({
    subject: { commonName: `ext-text-${Date.now()}`, organization: 'Example Corp', country: 'ES' },
    keyAlgorithm: 'RSA-2048',
    validityYears: 2,
  } as never);
  caId = (ca as { id: string }).id;
}, 120_000);

const subject = { commonName: 'device-1', organization: 'Example Corp', country: 'ES' };

const cases: Array<[string, { sanDns?: string[]; sanIp?: string[] }]> = [
  ['line break: basicConstraints CA:TRUE', { sanDns: [`a.example${LF}basicConstraints=critical,CA:TRUE`] }],
  ['line break: keyUsage keyCertSign', { sanDns: [`a.example${LF}keyUsage=critical,keyCertSign,cRLSign`] }],
  ['line break: extendedKeyUsage serverAuth', { sanDns: [`a.example${LF}extendedKeyUsage=serverAuth`] }],
  ['line break: new extension (CRL distribution point)', { sanDns: [`a.example${LF}crlDistributionPoints=URI:http://attacker.example/crl`] }],
  ['line break: new extension (name constraints)', { sanDns: [`a.example${LF}nameConstraints=critical,permitted;DNS:.example`] }],
  ['line break: new section', { sanDns: [`a.example${LF}[ v3_ca ]${LF}basicConstraints=critical,CA:TRUE`] }],
  ['comma: one more DNS entry', { sanDns: ['a.example,DNS:admin.internal.example'] }],
  ['comma: one more IP entry, in sanIp', { sanIp: ['192.0.2.1,IP:10.0.0.1'] }],
  ['comma: other name types', { sanDns: ['a.example,URI:https://attacker.example/id,email:root@example.com'] }],
];

describe('SAN values and the KMS extension text (real KMS)', () => {
  it('baseline: a client certificate with a plain DNS name', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const outcome = await attempt('baseline', () =>
      caller.certificate.issue({ caId, subject, certificateType: 'client', validityDays: 1, sanDns: ['a.example'] } as never),
    );
    expect(outcome).toBe('ISSUED');
  }, 120_000);

  it.each(cases)('issue client certificate, %s', async (name, sans) => {
    if (!kmsAvailable) return;
    const outcome = await attempt(`issue client / ${name}`, () =>
      caller.certificate.issue({ caId, subject, certificateType: 'client', validityDays: 1, ...sans } as never),
    );
    expect(outcome).toBe('REFUSED_BY_VALIDATION');
  }, 120_000);

  it('renew with new SAN values (server certificate)', async (ctx) => {
    if (!kmsAvailable) return ctx.skip();
    const original = await caller.certificate.issue({
      caId,
      subject: { ...subject, commonName: 'portal.acme.example' },
      certificateType: 'server',
      validityDays: 1,
      sanDns: ['portal.acme.example'],
    } as never);
    const id = (original as { id: string }).id;
    const outcomes: string[] = [];
    for (const [name, sanDns] of [
      ['line break: new extension', [`portal.acme.example${LF}crlDistributionPoints=URI:http://attacker.example/crl`]],
      ['comma: one more DNS entry', ['portal.acme.example,DNS:admin.internal.example']],
    ] as const) {
      outcomes.push(
        await attempt(`renew server / ${name}`, () => caller.certificate.renew({ id, updateInfo: true, sanDns: [...sanDns] } as never)),
      );
    }
    expect(outcomes).toEqual(['REFUSED_BY_VALIDATION', 'REFUSED_BY_VALIDATION']);
  }, 180_000);
});
