-- Portable Postgres schema for the payments operations console.
-- The PoC also ships an in-memory store that implements the same shape
-- so the API can run with no database at all.

CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY,
  name        text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  username    text NOT NULL,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  role        text NOT NULL CHECK (role IN ('maker', 'checker', 'auditor', 'admin', 'viewer')),
  UNIQUE (tenant_id, username)
);

CREATE TABLE IF NOT EXISTS beneficiaries (
  tenant_id   text NOT NULL REFERENCES tenants(id),
  iban        text NOT NULL,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  PRIMARY KEY (tenant_id, iban)
);

CREATE TABLE IF NOT EXISTS payments (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES tenants(id),
  idempotency_key          text NOT NULL,
  kind                     text NOT NULL CHECK (kind IN ('credit_transfer', 'bill_payment', 'instant_credit')),
  status                   text NOT NULL CHECK (status IN ('initiated', 'validated', 'screened', 'submitted', 'settled', 'failed', 'reversed')),
  amount_minor             bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor                bigint NOT NULL CHECK (fee_minor >= 0),
  currency                 text NOT NULL CHECK (currency IN ('EGP', 'USD', 'SAR', 'AED')),
  debtor_name              text NOT NULL,
  debtor_iban              text NOT NULL,
  creditor_name            text NOT NULL,
  creditor_iban            text NOT NULL,
  creditor_name_normalized text NOT NULL,
  reference                text NOT NULL,
  narrative                text NOT NULL DEFAULT '',
  purpose                  text NOT NULL DEFAULT '',
  created_by               text NOT NULL,
  approved_by              text,
  rejected_by              text,
  approval_status          text NOT NULL CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected')),
  failure_reason           text,
  created_at               timestamptz NOT NULL,
  updated_at               timestamptz NOT NULL,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS payments_tenant_status_idx ON payments (tenant_id, status);
CREATE INDEX IF NOT EXISTS payments_tenant_created_idx ON payments (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS journal_entries (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id),
  payment_id  text NOT NULL REFERENCES payments(id),
  reason      text NOT NULL,
  posted_at   timestamptz NOT NULL,
  posted_by   text NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_lines (
  entry_id      text NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  line_no       int NOT NULL,
  account       text NOT NULL,
  debit_minor   bigint NOT NULL CHECK (debit_minor >= 0),
  credit_minor  bigint NOT NULL CHECK (credit_minor >= 0),
  currency      text NOT NULL,
  PRIMARY KEY (entry_id, line_no),
  CHECK (NOT (debit_minor > 0 AND credit_minor > 0)),
  CHECK (debit_minor > 0 OR credit_minor > 0)
);

CREATE TABLE IF NOT EXISTS rule_hits (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  payment_id   text NOT NULL REFERENCES payments(id),
  code         text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('info', 'warn', 'block')),
  message_ar   text NOT NULL,
  message_en   text NOT NULL,
  created_at   timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id),
  seq          int NOT NULL,
  actor        text NOT NULL,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL,
  hash         text NOT NULL,
  UNIQUE (tenant_id, seq)
);

-- Append-only: refuse updates and deletes on the audit trail.
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();

CREATE TABLE IF NOT EXISTS idempotency_keys (
  tenant_id   text NOT NULL REFERENCES tenants(id),
  key         text NOT NULL,
  payment_id  text NOT NULL REFERENCES payments(id),
  PRIMARY KEY (tenant_id, key)
);
