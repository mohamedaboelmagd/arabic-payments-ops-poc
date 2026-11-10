import type { PaymentStatus } from './types.js';

const EDGES: Record<PaymentStatus, readonly PaymentStatus[]> = {
  initiated: ['validated', 'failed'],
  validated: ['screened', 'failed'],
  screened: ['submitted', 'failed'],
  submitted: ['settled', 'failed'],
  settled: ['reversed'],
  failed: [],
  reversed: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return EDGES[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`illegal transition ${from} -> ${to}`), { code: 'illegal_transition' });
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return status === 'failed' || status === 'reversed';
}

export function allowedTargets(from: PaymentStatus): readonly PaymentStatus[] {
  return EDGES[from];
}
