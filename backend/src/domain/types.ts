export type PaymentKind = 'credit_transfer' | 'bill_payment' | 'instant_credit';
export type PaymentStatus =
  | 'initiated'
  | 'validated'
  | 'screened'
  | 'submitted'
  | 'settled'
  | 'failed'
  | 'reversed';
export type Currency = 'EGP' | 'USD' | 'SAR' | 'AED';
export type Role = 'maker' | 'checker' | 'auditor' | 'admin' | 'viewer';
export type RuleSeverity = 'info' | 'warn' | 'block';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface User {
  id: string;
  username: string;
  nameAr: string;
  nameEn: string;
  role: Role;
}

export interface Beneficiary {
  iban: string;
  nameAr: string;
  nameEn: string;
}

export interface PaymentInstruction {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amountMinor: number;
  feeMinor: number;
  currency: Currency;
  debtorName: string;
  debtorIban: string;
  creditorName: string;
  creditorIban: string;
  creditorNameNormalized: string;
  reference: string;
  narrative: string;
  purpose: string;
  createdBy: string;
  approvedBy: string | null;
  rejectedBy: string | null;
  approvalStatus: ApprovalStatus;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalLine {
  account: string;
  debitMinor: number;
  creditMinor: number;
  currency: Currency;
}

export interface JournalEntry {
  id: string;
  tenantId: string;
  paymentId: string;
  reason: string;
  postedAt: string;
  postedBy: string;
  lines: JournalLine[];
}

export interface RuleHit {
  id: string;
  tenantId: string;
  paymentId: string;
  code: string;
  severity: RuleSeverity;
  messageAr: string;
  messageEn: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  seq: number;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  hash: string;
}

export interface World {
  tenantId: string;
  tenantName: string;
  users: User[];
  beneficiaries: Beneficiary[];
  payments: PaymentInstruction[];
  journals: JournalEntry[];
  hits: RuleHit[];
  audit: AuditEntry[];
  idempotency: Record<string, string>;
}

export interface CreatePaymentInput {
  idempotencyKey: string;
  kind: PaymentKind;
  amount: string;
  currency: Currency;
  debtorName: string;
  debtorIban: string;
  creditorName: string;
  creditorIban: string;
  reference: string;
  narrative?: string;
  purpose?: string;
}

export const APPROVAL_THRESHOLD_MINOR: Record<Currency, number> = {
  EGP: 50_000_00,
  USD: 5_000_00,
  SAR: 15_000_00,
  AED: 15_000_00,
};

export const HARD_LIMIT_MINOR: Record<Currency, number> = {
  EGP: 500_000_00,
  USD: 50_000_00,
  SAR: 150_000_00,
  AED: 150_000_00,
};

export const DAILY_LIMIT_MINOR: Record<Currency, number> = {
  EGP: 250_000_00,
  USD: 25_000_00,
  SAR: 80_000_00,
  AED: 80_000_00,
};

export const INSTANT_FEE_MINOR: Record<Currency, number> = {
  EGP: 200,
  USD: 50,
  SAR: 75,
  AED: 75,
};

export const LEDGER_ACCOUNTS = {
  customerDeposits: 'liability:customer_deposits',
  instantScheme: 'asset:instant_scheme',
  clearingNetwork: 'asset:clearing_network',
  feeIncome: 'income:scheme_fees',
  suspense: 'liability:suspense',
} as const;
