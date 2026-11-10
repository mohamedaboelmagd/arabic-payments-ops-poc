import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IBANS } from '../../../backend/src/domain/seed';
import type { Currency, PaymentKind, PaymentStatus } from '../../../backend/src/domain/types';
import { environment } from '../environments/environment';
import { BACKEND, type AuditEntry, type JournalEntry, type PaymentInstruction, type RuleHit, type Summary } from './backend';
import { DICT, type Lang, type MsgKey } from './i18n';
import { MoneyPipe } from './money.pipe';
import { currentActor, currentLang, demoUsers, setActor, setLang } from './session';

type Tab = 'queue' | 'approvals' | 'ledger' | 'rules' | 'audit';

@Component({
  selector: 'app-root',
  imports: [FormsModule, MoneyPipe],
  templateUrl: './app.html',
})
export class App implements OnInit {
  private api = inject(BACKEND);
  demo = environment.demo;
  repoUrl = environment.repoUrl;
  users = demoUsers;
  actor = currentActor;
  lang = currentLang;

  tab = signal<Tab>('queue');
  busy = signal(false);
  toast = signal<{ kind: 'ok' | 'err'; text: string } | null>(null);
  composing = signal(false);

  summary = signal<Summary | null>(null);
  payments = signal<PaymentInstruction[]>([]);
  journals = signal<JournalEntry[]>([]);
  balances = signal<Record<string, Record<string, number>>>({});
  hits = signal<Array<RuleHit & { payment: PaymentInstruction | null }>>([]);
  audit = signal<AuditEntry[]>([]);
  verified = signal<{ valid: boolean; entries: number } | null>(null);

  form = {
    kind: 'instant_credit' as PaymentKind,
    amount: '5000.00',
    currency: 'EGP' as Currency,
    debtorName: 'مكتب الخزانة — دلتا',
    debtorIban: IBANS.debtor,
    creditorName: 'آفاق للاستيراد',
    creditorIban: IBANS.horizon,
    reference: '',
    narrative: '',
  };

  t = computed(() => DICT[this.lang()]);
  user = computed(() => this.users.find((u) => u.username === this.actor()) ?? this.users[0]);
  pending = computed(() => this.payments().filter((p) => p.approvalStatus === 'pending'));
  displayName = (u: { nameAr: string; nameEn: string }) => (this.lang() === 'ar' ? u.nameAr : u.nameEn);

  tabs = computed(() => [
    { id: 'queue' as Tab, label: this.t().queue, count: this.payments().length },
    { id: 'approvals' as Tab, label: this.t().approvals, count: this.pending().length },
    { id: 'ledger' as Tab, label: this.t().ledger, count: this.journals().length },
    { id: 'rules' as Tab, label: this.t().rules, count: this.hits().length },
    { id: 'audit' as Tab, label: this.t().audit, count: this.verified()?.entries ?? this.audit().length },
  ]);

  ngOnInit() {
    void this.refresh();
  }

  msg(key: MsgKey): string {
    return this.t()[key];
  }

  labelKind(k: PaymentKind) {
    return this.t()[`kind_${k}`];
  }
  labelStatus(s: PaymentStatus) {
    return this.t()[`status_${s}`];
  }
  labelApproval(s: PaymentInstruction['approvalStatus']) {
    return this.t()[`approval_${s}`];
  }
  labelRole(role: string) {
    return this.t()[`role_${role}` as MsgKey] ?? role;
  }

  statusClass(s: PaymentStatus): string {
    switch (s) {
      case 'settled':
        return 'bg-emerald-50 text-emerald-800';
      case 'submitted':
        return 'bg-sky-50 text-sky-800';
      case 'screened':
        return 'bg-indigo-50 text-indigo-800';
      case 'initiated':
      case 'validated':
        return 'bg-slate-100 text-slate-700';
      case 'failed':
        return 'bg-rose-50 text-rose-800';
      case 'reversed':
        return 'bg-amber-50 text-amber-900';
    }
  }

  severityClass(s: string): string {
    if (s === 'block') return 'bg-rose-50 text-rose-800';
    if (s === 'warn') return 'bg-amber-50 text-amber-900';
    return 'bg-slate-100 text-slate-700';
  }

  can(action: 'create' | 'checks' | 'approve' | 'submit' | 'admin') {
    const role = this.user().role;
    if (action === 'create' || action === 'checks' || action === 'submit') return role === 'maker' || role === 'admin';
    if (action === 'approve') return role === 'checker' || role === 'admin';
    return role === 'admin';
  }

  toggleLang() {
    const next: Lang = this.lang() === 'ar' ? 'en' : 'ar';
    setLang(next);
  }

  switchActor(username: string) {
    setActor(username);
    void this.refresh();
  }

  async refresh() {
    const [summary, payments, ledger, hits, audit, verified] = await Promise.all([
      this.api.summary(),
      this.api.payments(),
      this.api.ledger(),
      this.api.rules(),
      this.api.audit(),
      this.api.verify(),
    ]);
    this.summary.set(summary);
    this.payments.set(payments);
    this.journals.set(ledger.journals);
    this.balances.set(ledger.balances);
    this.hits.set(hits);
    this.audit.set(audit);
    this.verified.set(verified);
  }

  private async act(fn: () => Promise<string>) {
    this.busy.set(true);
    try {
      const msg = await fn();
      await this.refresh();
      this.flash('ok', msg);
    } catch (e: any) {
      this.flash('err', e?.error?.message ?? e?.message ?? 'Request failed');
    } finally {
      this.busy.set(false);
    }
  }

  private flash(kind: 'ok' | 'err', text: string) {
    this.toast.set({ kind, text });
    setTimeout(() => this.toast.set(null), 4200);
  }

  runChecks(p: PaymentInstruction) {
    return this.act(async () => {
      const r = await this.api.checks(p.id);
      return r.payment.status === 'failed'
        ? `${this.labelStatus('failed')}: ${r.payment.failureReason}`
        : `${this.labelStatus(r.payment.status)} · ${r.hits.length} ${this.t().rules}`;
    });
  }
  approve(p: PaymentInstruction) {
    return this.act(async () => (await this.api.approve(p.id), this.t().approve));
  }
  reject(p: PaymentInstruction) {
    return this.act(async () => (await this.api.reject(p.id, 'rejected from dashboard'), this.t().reject));
  }
  submit(p: PaymentInstruction) {
    return this.act(async () => (await this.api.submit(p.id), this.t().submit));
  }
  settle(p: PaymentInstruction) {
    return this.act(async () => (await this.api.settle(p.id), this.t().settle));
  }
  fail(p: PaymentInstruction) {
    return this.act(async () => (await this.api.fail(p.id, 'simulated rail reject'), this.t().fail));
  }
  reverse(p: PaymentInstruction) {
    return this.act(async () => (await this.api.reverse(p.id, 'simulated post-settlement reversal'), this.t().reverse));
  }
  reset() {
    return this.act(async () => (await this.api.reset(), this.t().toastReset));
  }

  create() {
    return this.act(async () => {
      const reference = this.form.reference.trim() || `REF-${Date.now().toString().slice(-6)}`;
      const r = await this.api.create({ ...this.form, reference });
      this.composing.set(false);
      this.form.reference = '';
      this.form.narrative = '';
      return r.replayed ? `${reference} (idempotent replay)` : reference;
    });
  }

  balanceEntries() {
    return Object.entries(this.balances()).flatMap(([account, byCcy]) =>
      Object.entries(byCcy).map(([currency, signed]) => ({ account, currency, signed })),
    );
  }

  hitMessage(h: RuleHit) {
    return this.lang() === 'ar' ? h.messageAr : h.messageEn;
  }
}
