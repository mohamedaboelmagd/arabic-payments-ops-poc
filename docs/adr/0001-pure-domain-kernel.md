# ADR-0001: A pure domain kernel behind memory, Postgres and the browser

- Status: accepted
- Date: 2026-11-10

## Context

The same payments rules need to run in three places in this proof of concept:
a Fastify API (optionally backed by Postgres), an in-memory store for local
development, and a static Firebase Hosting demo that cannot call a server.
They also need to be tested without spinning up infrastructure.

A defect in any of those rules — an illegal transition, an unbalanced
journal, a self-approval — is a settlement defect.

## Decision

- All state changes go through `backend/src/domain` as plain async
  functions over a `World` snapshot (`createPayment`, `runChecks`,
  `approvePayment`, `submitPayment`, …).
- The kernel receives a clock, an id factory and a hash function so it stays
  free of Node and browser APIs.
- Persistence is a `Store` port: `memoryStore` or `openPostgresStore`. The
  Postgres path applies a real SQL schema (payments, journals, rule hits,
  append-only audit log, idempotency keys) and snapshots the `World` in a
  transaction.
- The Angular demo imports the kernel directly and keeps the `World` in
  `localStorage`. It is not a rewritten copy of the rules.

## Consequences

- Unit tests cover the behaviour that matters without HTTP or Docker.
- The live demo cannot drift from the API.
- The Postgres adapter in the PoC rewrites a tenant snapshot rather than
  issuing incremental row updates; that is acceptable for a single-desk
  demo and would be replaced with incremental writes before any real load.
