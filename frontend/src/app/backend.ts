import { InjectionToken } from '@angular/core';
import type {
  AuditEntry,
  CreatePaymentInput,
  JournalEntry,
  PaymentInstruction,
  RuleHit,
  User,
  World,
} from '../../../backend/src/domain/types';

export interface Summary {
  tenant: { id: string; name: string };
  totals: {
    payments: number;
    initiated: number;
    validated: number;
    screened: number;
    submitted: number;
    settled: number;
    failed: number;
    reversed: number;
    pendingApproval: number;
    openRuleHits: number;
  };
  balances: Record<string, Record<string, number>>;
}

export interface Backend {
  readonly mode: 'browser' | 'http';
  me(): Promise<{ user: User; tenant: { id: string; name: string }; users: User[] }>;
  summary(): Promise<Summary>;
  payments(): Promise<PaymentInstruction[]>;
  create(input: Omit<CreatePaymentInput, 'idempotencyKey'>, key?: string): Promise<{ payment: PaymentInstruction; replayed: boolean }>;
  checks(id: string): Promise<{ payment: PaymentInstruction; hits: RuleHit[] }>;
  approve(id: string, note?: string): Promise<PaymentInstruction>;
  reject(id: string, note?: string): Promise<PaymentInstruction>;
  submit(id: string): Promise<PaymentInstruction>;
  settle(id: string): Promise<PaymentInstruction>;
  fail(id: string, reason?: string): Promise<PaymentInstruction>;
  reverse(id: string, reason?: string): Promise<PaymentInstruction>;
  ledger(): Promise<{ journals: JournalEntry[]; balances: Record<string, Record<string, number>> }>;
  rules(): Promise<Array<RuleHit & { payment: PaymentInstruction | null }>>;
  audit(): Promise<AuditEntry[]>;
  verify(): Promise<{ valid: boolean; entries: number }>;
  reset(): Promise<void>;
}

export const BACKEND = new InjectionToken<Backend>('BACKEND');
export type { AuditEntry, CreatePaymentInput, JournalEntry, PaymentInstruction, RuleHit, User, World };
