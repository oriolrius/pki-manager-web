#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
/**
 * pki-migrate: OFFLINE migration of PKI Manager v3 data (Cosmian KMS) to OpenBao.
 *
 * Not part of the backend image or runtime. Node >= 22.18 (type stripping,
 * node:sqlite), no dependencies. Guide: docs/operations/openbao-migration.md.
 *
 *   inventory        dry run: manifest of keys, references, certificates, problems
 *   approve-template approval template bound to the manifest and the target
 *   preflight        all checks of apply, changes nothing
 *   apply            transfer approved keys, write the target DB copy (idempotent)
 *   verify           check a migrated pair; --cutover is the gate (needs the frozen source);
 *                    --restore checks a restored backup pair: pair marker + database side
 *   backup           SQLite + OpenBao Raft snapshot pair, with digests and a pair marker
 *   check-backup     re-check a backup directory
 *   rotation-plan    steps for keys that cannot (or will not) migrate
 *
 * Exit codes: 0 ok, 1 checks failed, 2 usage, 3 error.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { CosmianKmipClient } from './lib/cosmian.ts';
import { exportCertificateBundle } from './lib/certificates.ts';
import { buildManifest, summarize } from './lib/inventory.ts';
import { OpenBaoClient } from './lib/openbao.ts';
import { approvalTemplate } from './lib/policy.ts';
import { openReadOnly } from './lib/sqlite.ts';
import { loadProfile } from './lib/target-db.ts';
import { apply, liveTarget, preflight } from './lib/transfer.ts';
import { verifyMigration, verifyRestore } from './lib/verify.ts';
import { backupPair, checkBackup } from './lib/backup.ts';
import { rotationPlan } from './lib/rotation.ts';
import type { Approval, Manifest } from './lib/types.ts';
import { MigrationError, documentDigest, log } from './lib/util.ts';

type Args = Record<string, string | boolean>;

function parse(argv: string[]): { cmd: string; args: Args } {
  const [cmd = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument ${a}`);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return { cmd, args };
}

class UsageError extends Error {}

function need(args: Args, key: string, env?: string): string {
  const v = args[key] ?? (env ? process.env[env] : undefined);
  if (typeof v !== 'string' || !v) throw new UsageError(`--${key}${env ? ` (or ${env})` : ''} is required`);
  return v;
}
const opt = (args: Args, key: string, env?: string): string | undefined => {
  const v = args[key] ?? (env ? process.env[env] : undefined);
  return typeof v === 'string' && v ? v : undefined;
};

function kmsFrom(args: Args): CosmianKmipClient | undefined {
  const url = opt(args, 'kms-url', 'KMS_URL');
  if (!url) return undefined;
  const keyFile = opt(args, 'kms-api-key-file');
  return new CosmianKmipClient(url, { apiKey: keyFile ? readFileSync(keyFile, 'utf8').trim() : undefined });
}

function storeFrom(args: Args): { store: OpenBaoClient; addr: string } {
  const addr = need(args, 'openbao-addr', 'OPENBAO_ADDR');
  return {
    addr,
    store: new OpenBaoClient({ addr, caFile: opt(args, 'openbao-cacert', 'OPENBAO_CACERT'), tokenFile: need(args, 'openbao-token-file', 'OPENBAO_TOKEN_FILE'), namespace: opt(args, 'openbao-namespace', 'OPENBAO_NAMESPACE') }),
  };
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
function writeNew(path: string, content: string, force: boolean): void {
  if (existsSync(path) && !force) throw new UsageError(`${path} exists (use --force to replace it)`);
  writeFileSync(path, content, { mode: 0o600 });
}

const HELP = `usage: pki-migrate <command> [options]   (guide: docs/operations/openbao-migration.md)

  inventory        --source-db FILE [--kms-url URL] [--kms-api-key-file F] [--target-profile F] --out manifest.json
                   [--certificates-out F]   (PEM bundle of the certificates whose PEM is only in the KMS)
  approve-template --manifest F --openbao-* --out approval.json
  preflight        --manifest F --approval F --source-db F --target-db F --openbao-* [--kms-url URL] [--target-profile F]
                   [--material-dir DIR]   (offline material: every file is checked against its approved digest)
                   [--certificates F]     (bundle of inventory --certificates-out: no source KMS needed)
  apply            (preflight options) --run-dir DIR --confirm DIGEST12 [--actor NAME]
  verify           --manifest F --approval F --target-db F --openbao-* [--openbao-ra-token-file F] [--source-db F]
                   [--target-profile F] [--cutover] [--ra-session-check] [--out report.json]
                   (--cutover needs --source-db: the frozen v3 copy, reconciled row by row;
                    RA mount calls use --openbao-ra-token-file when given: the v4 pki-manager-ra identity)
  verify --restore --target-db F --backup-dir DIR --openbao-operator-token-file F --openbao-*
                   [--openbao-ra-token-file F] [--source-db F] [--manifest F --approval F] [--target-profile F] [--out F]
                   a restored backup pair, before v4 starts: the restored OpenBao holds the pair marker of
                   DIR and the database has the content of DIR (else verified=false); every key the
                   database owns is in OpenBao with the same public key; with --source-db, the v3 audit
                   history is still there
  backup           --db FILE --out-dir DIR [--label TEXT]                 SQLite only (v3, or a copy)
  backup           --db FILE --out-dir DIR [--label TEXT] --openbao-* --quiesced
                   a pair: every writer stopped (--quiesced says so; a database change during the backup
                   fails it), operator token (Raft snapshot + pair marker)
  check-backup     --dir DIR
  rotation-plan    --manifest F [--approval F]

  --openbao-*: --openbao-addr URL --openbao-token-file FILE [--openbao-cacert FILE] [--openbao-namespace NS]
               (or OPENBAO_ADDR, OPENBAO_TOKEN_FILE, OPENBAO_CACERT, OPENBAO_NAMESPACE)
`;

async function main(argv: string[]): Promise<number> {
  const { cmd, args } = parse(argv);
  const force = args.force === true;
  switch (cmd) {
    case 'inventory': {
      const sourcePath = need(args, 'source-db');
      const db = openReadOnly(sourcePath);
      try {
        const kms = kmsFrom(args);
        const certsOut = opt(args, 'certificates-out');
        if (certsOut && !kms) throw new UsageError('--certificates-out needs --kms-url');
        const manifest = await buildManifest({ sourcePath, db, kms, mounts: loadProfile(opt(args, 'target-profile')).mounts });
        writeNew(need(args, 'out'), JSON.stringify(manifest, null, 2) + '\n', force);
        if (certsOut && kms) {
          const b = await exportCertificateBundle(manifest, kms);
          writeNew(certsOut, b.pem, force);
          process.stdout.write(`certificate bundle: ${b.count} certificate(s) whose PEM is only in the KMS\n`);
        }
        process.stdout.write(`${summarize(manifest)}\nmanifest digest ${documentDigest(manifest)}\n`);
        return manifest.problems.some(p => p.severity === 'blocker') ? 1 : 0;
      } finally { db.close(); }
    }
    case 'approve-template': {
      const manifest = readJson<Manifest>(need(args, 'manifest'));
      const { store, addr } = storeFrom(args);
      const template = approvalTemplate(manifest, await liveTarget(store, addr, manifest));
      writeNew(need(args, 'out'), JSON.stringify(template, null, 2) + '\n', force);
      process.stdout.write(`approval template written. Review every action, set approvedBy/approvedAt, acknowledgeSensitive per Sensitive key and allowSourceWrappingKeyRegistration.\nmanifest digest ${template.manifestSha256}\n`);
      return 0;
    }
    case 'preflight': {
      const manifest = readJson<Manifest>(need(args, 'manifest'));
      const approval = readJson<Approval>(need(args, 'approval'));
      const { store, addr } = storeFrom(args);
      const r = await preflight({ manifest, approval, sourceDbPath: need(args, 'source-db'), targetDbPath: need(args, 'target-db'), store, addr, kms: kmsFrom(args), profile: loadProfile(opt(args, 'target-profile')), online: !approval.material, materialDir: opt(args, 'material-dir'), certificatesFile: opt(args, 'certificates') });
      for (const c of r.checks) process.stdout.write(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` - ${c.detail}` : ''}\n`);
      return r.ok ? 0 : 1;
    }
    case 'apply': {
      const manifest = readJson<Manifest>(need(args, 'manifest'));
      const approval = readJson<Approval>(need(args, 'approval'));
      const { store, addr } = storeFrom(args);
      const faultSpec = process.env.PKI_MIGRATE_FAULT; // rehearsal only: simulate a crash
      const report = await apply({
        manifest, approval, sourceDbPath: need(args, 'source-db'), targetDbPath: need(args, 'target-db'), runDir: need(args, 'run-dir'),
        store, addr, kms: kmsFrom(args), profile: loadProfile(opt(args, 'target-profile')), materialDir: opt(args, 'material-dir'), certificatesFile: opt(args, 'certificates'),
        confirm: need(args, 'confirm'), actor: opt(args, 'actor') ?? 'pki-migrate',
        fault: faultSpec ? point => { if (point === faultSpec) { log(`FAULT injected at ${point}: exiting without cleanup`); process.exit(75); } } : undefined,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return 0;
    }
    case 'verify': {
      const restore = args.restore === true, cutover = args.cutover === true;
      // The gate compares the target with the frozen v3 copy; a later restore is not a cutover.
      if (restore && cutover) throw new UsageError('--restore and --cutover exclude each other: --cutover is the gate against the frozen v3 copy, --restore checks a later backup pair');
      if (cutover && !opt(args, 'source-db')) throw new UsageError('--cutover needs --source-db: the frozen v3 copy the manifest was made from (the gate reconciles the target with it)');
      const manifestPath = restore ? opt(args, 'manifest') : need(args, 'manifest');
      const approvalPath = restore ? opt(args, 'approval') : need(args, 'approval');
      const targetPath = need(args, 'target-db');
      const { store } = storeFrom(args);
      const manifest = manifestPath ? readJson<Manifest>(manifestPath) : undefined;
      const approval = approvalPath ? readJson<Approval>(approvalPath) : undefined;
      const backupDir = restore ? opt(args, 'backup-dir') : undefined;
      if (!restore && opt(args, 'backup-dir')) throw new UsageError('--backup-dir belongs to verify --restore');
      const operatorTokenFile = opt(args, 'openbao-operator-token-file', 'OPENBAO_OPERATOR_TOKEN_FILE');
      if (backupDir && !operatorTokenFile) throw new UsageError('--backup-dir needs --openbao-operator-token-file (or OPENBAO_OPERATOR_TOKEN_FILE): the pair marker is readable by an operator token only');
      const target = openReadOnly(targetPath);
      const sourcePath = opt(args, 'source-db');
      const source = sourcePath ? openReadOnly(sourcePath) : undefined;
      try {
        const raTokenFile = opt(args, 'openbao-ra-token-file', 'OPENBAO_RA_TOKEN_FILE');
        const raStore = raTokenFile ? new OpenBaoClient({ addr: need(args, 'openbao-addr', 'OPENBAO_ADDR'), caFile: opt(args, 'openbao-cacert', 'OPENBAO_CACERT'), tokenFile: raTokenFile, namespace: opt(args, 'openbao-namespace', 'OPENBAO_NAMESPACE') }) : undefined;
        const profile = loadProfile(opt(args, 'target-profile'));
        const evidence = backupDir && operatorTokenFile
          ? { dir: backupDir, operator: new OpenBaoClient({ addr: need(args, 'openbao-addr', 'OPENBAO_ADDR'), caFile: opt(args, 'openbao-cacert', 'OPENBAO_CACERT'), tokenFile: operatorTokenFile, namespace: opt(args, 'openbao-namespace', 'OPENBAO_NAMESPACE') }) }
          : undefined;
        const r = restore
          ? await verifyRestore({ target, store, raStore, profile, source, manifest, approval, evidence })
          : await verifyMigration({ manifest: manifest!, approval: approval!, target, store, raStore, profile, source, sourcePath, raSessionCheck: args['ra-session-check'] === true });
        for (const c of r.checks.filter(x => !x.ok)) process.stdout.write(`FAIL ${c.name}${c.detail ? ` - ${c.detail}` : ''}\n`);
        for (const w of r.warnings) process.stdout.write(`WARN ${w}\n`);
        process.stdout.write(`mode ${r.mode}; checks ${r.checks.length}, failed ${r.checks.filter(c => !c.ok).length}; counts ${JSON.stringify(r.counts)}\n`);
        process.stdout.write(restore ? `verified=${r.ok} pairBound=${r.pairBound === true} cosmianRequired=${r.cosmianRequired}\n` : `verified=${r.ok} reconciled=${r.reconciled} cutoverReady=${r.cutoverReady} cosmianRequired=${r.cosmianRequired}\n`);
        const out = opt(args, 'out');
        if (out) writeNew(out, JSON.stringify(r, null, 2) + '\n', force);
        return cutover ? (r.cutoverReady ? 0 : 1) : (r.ok ? 0 : 1);
      } finally { target.close(); source?.close(); }
    }
    case 'backup': {
      const withBao = !!opt(args, 'openbao-addr', 'OPENBAO_ADDR');
      if (args.quiesced !== undefined && args.quiesced !== true) throw new UsageError('--quiesced takes no value');
      if (withBao && args.quiesced !== true) throw new UsageError('a database + OpenBao backup needs --quiesced: stop every writer first (the v4 backend, its OpenBao Agents, scripts with runtime tokens)');
      const record = await backupPair({ dbPath: need(args, 'db'), outDir: need(args, 'out-dir'), label: opt(args, 'label') ?? 'migration', store: withBao ? storeFrom(args).store : undefined, quiesced: args.quiesced === true });
      process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
      return 0;
    }
    case 'check-backup': {
      const r = checkBackup(need(args, 'dir'));
      process.stdout.write(r.ok ? `backup ok: ${Object.keys(r.record.files).join(', ')}; ${r.pairEvidence ? `pair evidence: backup ${r.record.pair!.backupId}` : `no pair evidence (${r.record.format}${'openbao.snap' in r.record.files ? '' : ', SQLite only'})`}\n` : `backup FAILED: ${r.problems.join('; ')}\n`);
      return r.ok ? 0 : 1;
    }
    case 'rotation-plan': {
      const manifest = readJson<Manifest>(need(args, 'manifest'));
      const ap = opt(args, 'approval');
      process.stdout.write(`${rotationPlan(manifest, ap ? readJson<Approval>(ap) : undefined)}\n`);
      return 0;
    }
    case 'help': case '--help': case '-h':
      process.stdout.write(HELP);
      return 0;
    default:
      throw new UsageError(`unknown command ${cmd}`);
  }
}

main(process.argv.slice(2)).then(code => process.exit(code), (error: unknown) => {
  if (error instanceof UsageError) { process.stderr.write(`${error.message}\n\n${HELP}`); process.exit(2); }
  const code = error instanceof MigrationError ? error.code : 'ERROR';
  process.stderr.write(`pki-migrate: ${code}: ${(error as Error).message}\n`);
  process.exit(3);
});
