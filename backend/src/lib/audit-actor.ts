import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';

/**
 * Who performed an audited action (issue #27).
 * - user: OIDC subject + readable name (preferred_username, else email, else name)
 * - integration: external issuer service token (id + name)
 * - ssh_token: SSH fleet token (id + name)
 * - anonymous: OIDC disabled, nobody to identify
 */
export interface AuditActor {
  type: 'user' | 'integration' | 'ssh_token' | 'anonymous';
  id: string | null;
  name: string | null;
}

export const ANONYMOUS_ACTOR: AuditActor = { type: 'anonymous', id: null, name: 'anonymous' };

interface ActorStore {
  actor?: AuditActor;
}

const storage = new AsyncLocalStorage<ActorStore>();

/** Fastify onRequest hook: one mutable actor slot per request. */
export function installAuditActorContext(server: FastifyInstance): void {
  server.addHook('onRequest', (_req, _reply, done) => {
    storage.run({}, done);
  });
}

/** Record the actor of the current request. Auth code calls this once the caller is known. */
export function setAuditActor(actor: AuditActor): void {
  const store = storage.getStore();
  if (store) store.actor = actor;
  else storage.enterWith({ actor });
}

export function getAuditActor(): AuditActor | undefined {
  return storage.getStore()?.actor;
}

/** Run `fn` with a fixed actor (tests, background jobs). */
export function runWithAuditActor<T>(actor: AuditActor | undefined, fn: () => T): T {
  return storage.run({ actor }, fn);
}

export function userActor(user: {
  sub: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
}): AuditActor {
  return {
    type: 'user',
    id: user.sub,
    name: user.preferredUsername ?? user.email ?? user.name ?? null,
  };
}

export const integrationActor = (i: { id: string; name: string }): AuditActor => ({
  type: 'integration',
  id: i.id,
  name: i.name,
});

export const sshTokenActor = (t: { id: string; name: string }): AuditActor => ({
  type: 'ssh_token',
  id: t.id,
  name: t.name,
});
