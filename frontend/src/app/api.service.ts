import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AuditEntry, CreatePaymentInput, JournalEntry, PaymentInstruction, RuleHit, User } from '../../../backend/src/domain/types';
import type { Backend, Summary } from './backend';
import { currentActor } from './session';

export const apiKeyInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);
  return next(
    req.clone({
      setHeaders: {
        'x-api-key': 'demo_delta_ops_key',
        'x-actor': currentActor(),
      },
    }),
  );
};

@Injectable({ providedIn: 'root' })
export class HttpBackend implements Backend {
  readonly mode = 'http' as const;
  private http = inject(HttpClient);
  private get<T>(url: string) {
    return firstValueFrom(this.http.get<T>(url));
  }
  private post<T>(url: string, body: unknown = {}, headers: Record<string, string> = {}) {
    return firstValueFrom(this.http.post<T>(url, body, { headers }));
  }

  me() {
    return this.get<{ user: User; tenant: { id: string; name: string }; users: User[] }>('/api/v1/me');
  }
  summary() {
    return this.get<Summary>('/api/v1/summary');
  }
  async payments() {
    const r = await this.get<{ payments: PaymentInstruction[] }>('/api/v1/payments');
    return r.payments;
  }
  create(input: Omit<CreatePaymentInput, 'idempotencyKey'>, key?: string) {
    return this.post<{ payment: PaymentInstruction; replayed: boolean }>(
      '/api/v1/payments',
      input,
      key ? { 'idempotency-key': key } : {},
    );
  }
  checks(id: string) {
    return this.post<{ payment: PaymentInstruction; hits: RuleHit[] }>(`/api/v1/payments/${id}/checks`);
  }
  async approve(id: string, note?: string) {
    return (await this.post<{ payment: PaymentInstruction }>(`/api/v1/payments/${id}/approve`, { note })).payment;
  }
  async reject(id: string, note?: string) {
    return (await this.post<{ payment: PaymentInstruction }>(`/api/v1/payments/${id}/reject`, { note })).payment;
  }
  async submit(id: string) {
    return (await this.post<{ payment: PaymentInstruction }>(`/api/v1/payments/${id}/submit`)).payment;
  }
  async settle(id: string) {
    return (await this.post<{ payment: PaymentInstruction }>(`/api/v1/payments/${id}/settle`)).payment;
  }
  async fail(id: string, reason?: string) {
    return (await this.post<{ payment: PaymentInstruction }>(`/api/v1/payments/${id}/fail`, { reason })).payment;
  }
  async reverse(id: string, reason?: string) {
    return (await this.post<{ payment: PaymentInstruction }>(`/api/v1/payments/${id}/reverse`, { reason })).payment;
  }
  ledger() {
    return this.get<{ journals: JournalEntry[]; balances: Record<string, Record<string, number>> }>('/api/v1/ledger');
  }
  async rules() {
    return (await this.get<{ hits: Array<RuleHit & { payment: PaymentInstruction | null }> }>('/api/v1/rules')).hits;
  }
  async audit() {
    return (await this.get<{ entries: AuditEntry[] }>('/api/v1/audit')).entries;
  }
  verify() {
    return this.get<{ valid: boolean; entries: number }>('/api/v1/audit/verify');
  }
  async reset() {
    await this.post('/api/v1/demo/reset');
  }
}
