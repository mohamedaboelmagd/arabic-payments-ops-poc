import { Injectable } from '@angular/core';
import {
  accountBalances,
  approvePayment,
  createPayment,
  failPayment,
  rejectPayment,
  reversePayment,
  runChecks,
  seedWorld,
  settlePayment,
  submitPayment,
  verifyAudit,
  type CreatePaymentInput,
  type KernelCtx,
  type User,
  type World,
} from '../../../../backend/src/domain/index';
import type { Backend, Summary } from '../backend';
import { currentActor } from '../session';

const STORAGE = 'payments-ops-poc:v1:world';

function newId(prefix: string): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return `${prefix}_${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class BrowserBackend implements Backend {
  readonly mode = 'browser' as const;
  private world: World | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private async load(): Promise<World> {
    if (this.world) return this.world;
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      try {
        this.world = JSON.parse(raw) as World;
        return this.world;
      } catch {
        localStorage.removeItem(STORAGE);
      }
    }
    this.world = await seedWorld(sha256);
    localStorage.setItem(STORAGE, JSON.stringify(this.world));
    return this.world;
  }

  private persist() {
    if (this.world) localStorage.setItem(STORAGE, JSON.stringify(this.world));
  }

  private actor(world: World): User {
    return world.users.find((u) => u.username === currentActor()) ?? world.users[0];
  }

  private ctx(world: World): KernelCtx {
    return { world, actor: this.actor(world), now: () => new Date().toISOString(), id: newId, hash: sha256 };
  }

  private read<T>(fn: (w: World) => T | Promise<T>): Promise<T> {
    return this.queue.then(async () => fn(await this.load())) as Promise<T>;
  }

  private write<T>(fn: (w: World) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const w = await this.load();
      const draft = structuredClone(w);
      try {
        const out = await fn(draft);
        this.world = draft;
        this.persist();
        return out;
      } catch (e: any) {
        throw e?.statusCode ? e : e;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  me() {
    return this.read((w) => ({ user: this.actor(w), tenant: { id: w.tenantId, name: w.tenantName }, users: w.users }));
  }

  summary(): Promise<Summary> {
    return this.read((w) => {
      const count = (status: string) => w.payments.filter((p) => p.status === status).length;
      return {
        tenant: { id: w.tenantId, name: w.tenantName },
        totals: {
          payments: w.payments.length,
          initiated: count('initiated'),
          validated: count('validated'),
          screened: count('screened'),
          submitted: count('submitted'),
          settled: count('settled'),
          failed: count('failed'),
          reversed: count('reversed'),
          pendingApproval: w.payments.filter((p) => p.approvalStatus === 'pending').length,
          openRuleHits: w.hits.filter((h) => {
            const p = w.payments.find((x) => x.id === h.paymentId);
            return !!p && !['failed', 'reversed', 'settled'].includes(p.status);
          }).length,
        },
        balances: accountBalances(w.journals),
      };
    });
  }

  payments() {
    return this.read((w) => w.payments.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  create(input: Omit<CreatePaymentInput, 'idempotencyKey'>, key?: string) {
    return this.write((w) => createPayment(this.ctx(w), { ...input, idempotencyKey: key ?? newId('idem') }));
  }

  checks(id: string) {
    return this.write((w) => runChecks(this.ctx(w), id));
  }
  approve(id: string, note?: string) {
    return this.write((w) => approvePayment(this.ctx(w), id, note ?? ''));
  }
  reject(id: string, note?: string) {
    return this.write((w) => rejectPayment(this.ctx(w), id, note ?? ''));
  }
  submit(id: string) {
    return this.write((w) => submitPayment(this.ctx(w), id));
  }
  settle(id: string) {
    return this.write((w) => settlePayment(this.ctx(w), id));
  }
  fail(id: string, reason?: string) {
    return this.write((w) => failPayment(this.ctx(w), id, reason ?? ''));
  }
  reverse(id: string, reason?: string) {
    return this.write((w) => reversePayment(this.ctx(w), id, reason ?? ''));
  }
  ledger() {
    return this.read((w) => ({ journals: w.journals.slice().reverse(), balances: accountBalances(w.journals) }));
  }
  rules() {
    return this.read((w) => w.hits.map((h) => ({ ...h, payment: w.payments.find((p) => p.id === h.paymentId) ?? null })).reverse());
  }
  audit() {
    return this.read((w) => w.audit.slice().reverse());
  }
  verify() {
    return this.read((w) => verifyAudit(w, sha256));
  }
  async reset() {
    await this.write(async (w) => {
      const next = await seedWorld(sha256);
      Object.assign(w, next);
    });
  }
}
