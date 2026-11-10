# Arabic-first payments operations console (PoC)

**Live demo: https://arabic-payments-ops-poc.web.app** (static browser build, fictional sample data)

An independent proof of concept by Mohamed Abo Elmagd for teams that run
payments software in Arabic, for Egypt and the wider MENA region: a treasury
operations desk that takes a payment instruction from draft to settlement
without losing the plot — or the audit trail.

The console is bilingual (**Arabic RTL by default**, English one click away).
The TypeScript kernel is shared between a Node.js API and the static demo.
**All data is fictional.**

![Payment queue](docs/live.png)

| Maker-checker approvals | Double-entry ledger |
|---|---|
| ![Approvals](docs/screenshot-approvals.png) | ![Ledger](docs/screenshot-ledger.png) |

### About the live demo

Firebase Hosting is static, so the live site is a **browser demo build** of
the same Angular app: the state machine, the double-entry planner, the
maker-checker rules and the Arabic/IBAN helpers are imported directly from
`backend/src/domain` and run in your browser. The desk's world lives in
`localStorage` (SHA-256 hash-chained audit log via Web Crypto). Switch roles
(maker, checker, auditor, admin, viewer), run checks, approve or reject,
submit, and simulate a rail settlement. **Reset demo** restores the sample
desk. The full Fastify API with Swagger UI is the real backend; run it
locally with one command (see [Run it](#run-it)).

## The problem

A payments operations squad sitting next to a bank-grade rail has to do more
than "call an API and hope". Instructions arrive as credit transfers, bill
payments and instant account-to-account credits. Names are typed in Arabic
or Latin, sometimes with tashkeel, sometimes with Arabic-Indic digits.
Amounts above a threshold need a second pair of eyes. A retry from a mobile
channel must not create a second transfer. When money moves, two ledger
lines have to move with it. When something fails after submit, those lines
have to move back. And someone will ask, months later, who approved what.

| Real-world mess | How the sample desk shows it |
|---|---|
| Arabic-Indic digits in a reference | `INV-٢٠٢٦-0441` stored next to a Latin normalised form |
| Alef / teh-marbuta variants of a name | `أحمد` and `احمد` compare as the same token |
| Name does not match the IBAN directory | `مكتب النور` sent to Horizon Imports' account → `NAME_IBAN_MISMATCH` |
| Value above the four-eyes threshold | EGP 75,000 sits in the approval queue for the checker |
| Watchlist-ish beneficiary | A fictional "Shadow Trading LLC" is blocked from submit |
| Bad IBAN checksum | Draft fails validation instead of reaching a rail |
| Instant-rail fee | EGP 2.00 booked to `income:scheme_fees` on submit |
| Return after settlement | Reversal posts the inverted journal so balances net to zero |

## What is in the box

- **Domain kernel** (`backend/src/domain`): pure TypeScript. State machine,
  idempotency, double-entry planner, RBAC, maker-checker, mock limit /
  velocity / watchlist / name-IBAN rules, Arabic normalisation. Jest tests.
- **API** (`backend/src`): Node.js 22+ / TypeScript / Fastify 5, OpenAPI 3 +
  Swagger UI at `/docs`. In-memory store by default; set `DATABASE_URL` to
  use Postgres with the SQL migrations in `backend/src/db/migrations`.
- **Dashboard** (`frontend`): Angular (standalone components, signals) +
  Tailwind CSS v4. Payment queue, maker-checker approvals, ledger, rule
  hits, hash-chained audit trail, Arabic/English toggle.
- **Sample desk**: "Delta Treasury Desk", five roles, ten seeded
  instructions in different states.
- **Docs**: [ARCHITECTURE.md](docs/ARCHITECTURE.md),
  [ENGINEERING_PLAYBOOK.md](docs/ENGINEERING_PLAYBOOK.md) (how I would run
  a squad of 4–8 on this kind of system), and two ADRs.

## Run it

Requirements: Node.js >= 22.13.

```bash
npm start          # installs, builds API + dashboard, starts http://localhost:3000
```

- Dashboard: http://localhost:3000/
- API docs:  http://localhost:3000/docs
- Demo API key: `demo_delta_ops_key`
- Demo actors (`x-actor`): `layla.maker`, `omar.checker`, `nora.auditor`,
  `ahmed.admin`, `sara.viewer`

Other scripts: `npm test` (Jest), `npm run dev:api` + `npm run dev:web`
(watch mode, dashboard on :4200 with a proxy), `npm run build:demo` (static
browser build into `frontend/dist/demo/browser`), `npm run deploy:demo`
(Firebase Hosting target `demo`), `npm run smoke:demo -- <url>`.

Postgres is optional:

```bash
docker compose up --build
# DATABASE_URL=postgres://payments:payments@localhost:5432/payments_ops
```

### Try the API with curl

```bash
K='x-api-key: demo_delta_ops_key'; A='x-actor: layla.maker'; B=http://localhost:3000/api/v1
curl -s $B/summary -H "$K" -H "$A"
curl -s $B/payments -H "$K" -H "$A" | head
curl -s -XPOST $B/payments -H "$K" -H "$A" -H 'content-type: application/json' \
  -H 'idempotency-key: demo-1' \
  -d '{"kind":"instant_credit","amount":"1500.00","currency":"EGP","debtorName":"Delta Treasury","debtorIban":"'"$(
      node -e "import('./backend/src/domain/arabic.ts').then(m=>console.log(m.makeIban('EG','0019001122334455667788999')))"
    )"'","creditorName":"Horizon Imports","creditorIban":"EG00","reference":"INV-1"}'
# easier: copy IBANs from GET /payments, then
curl -s -XPOST $B/payments/<id>/checks -H "$K" -H "$A"
curl -s -XPOST $B/payments/<id>/approve -H "$K" -H 'x-actor: omar.checker'
curl -s -XPOST $B/payments/<id>/submit -H "$K" -H "$A"
curl -s $B/ledger -H "$K" -H "$A"
curl -s $B/audit/verify -H "$K" -H "$A"
```

Valid IBANs for the sample desk are printed on every seeded instruction
(`GET /api/v1/payments`).

## Architecture

```mermaid
flowchart LR
  OP[Operations user] --> UI
  UI[Angular console<br/>AR / EN] -->|REST| API
  subgraph API["Payments API (Fastify + TypeScript)"]
    AUTH[API key + actor → role] --> R[Repository]
    R --> K{{Domain kernel}}
    K --> SM[State machine]
    K --> LEDGER[Journal planner]
    K --> RULES[Screening rules]
    K --> AUD[(Hash-chained audit log)]
  end
  R --> MEM[(In-memory World)]
  R --> PG[(Postgres)]
  UI -.demo build imports kernel.-> K
```

```
backend/
  src/domain/     types, machine, ledger, rules, arabic, engine, seed
  src/services/   store (memory | postgres), crypto
  src/db/migrations/001_init.sql
  src/routes/     OpenAPI / TypeBox
  test/           Jest: arabic, machine, ledger, engine, API
frontend/src/app/ backend.ts, api.service.ts, demo/browser-backend.ts
docs/             ARCHITECTURE, ENGINEERING_PLAYBOOK, adr/
```

## State machine, ledger, idempotency

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full tables. The
short version:

- States: `initiated → validated → screened → submitted → settled`, with
  `failed` from the first four and `reversed` from `settled`.
- Screening writes rule hits (`LIMIT_HARD`, `LIMIT_DAILY`, `VELOCITY`,
  `STRUCTURING`, `WATCHLIST`, `NAME_IBAN_MISMATCH`). A `block` hit cannot
  be submitted; a `warn` hit forces maker-checker.
- Submit posts a balanced double-entry journal; fail-after-submit and
  reverse post the inverted lines.
- Idempotency keys make create safe to retry. Same payload → replay; other
  payload → `409`.

## Engineering manager notes

This repo is also a statement of how I would run a squad of four to eight
engineers on a system like this: design reviews on anything that moves
money, RTL called out in every UI review, an on-call rota people are not
dreading, and a hiring loop the EM actually owns. That write-up lives in
[docs/ENGINEERING_PLAYBOOK.md](docs/ENGINEERING_PLAYBOOK.md).

## Stack choices

- **Fastify** over NestJS to keep the request path obvious and the kernel
  easy to call from tests and from the browser. The same layering maps 1:1
  onto NestJS modules if a team already standardised there.
- **In-memory `World` by default**, with a real Postgres schema when
  `DATABASE_URL` is set, so `npm start` has no native modules and Docker
  Compose can still show the production-shaped tables.
- **Two backends behind one interface** in the dashboard: `HttpBackend` and
  `BrowserBackend`. The `demo` build swaps the environment file; the kernel
  is shared, not copied.
- **Angular** because it is my strongest UI stack; the dashboard talks only
  to the documented REST API, so a production console in another library is
  a straight port. Arabic is the default locale, not an afterthought.
- **Jest** for the kernel and the API (Fastify `inject`), wired in GitHub
  Actions.

## Next steps for production

1. Incremental Postgres writes (not snapshot-per-request), RLS, and
   streamed audit export to WORM storage.
2. Real authentication: OIDC for operators, mTLS and rotated credentials
   for machine clients; drop the demo `x-actor` header.
3. Four-eyes on reversals and on changes to limits; maker-checker of the
   watchlist itself.
4. Outbox + retries + poison queues for rail adapters; scheme callbacks
   become the only writers of `settled` / `failed` after submit.
5. OpenTelemetry, SLOs, and a page-worthy on-call runbook (see the
   playbook).
6. A proper bilingual design system and keyboard-driven approval.

## Decision records

- [ADR-0001: Pure domain kernel behind memory, Postgres and the browser](docs/adr/0001-pure-domain-kernel.md)
- [ADR-0002: Maker-checker four-eyes and RBAC inside the kernel](docs/adr/0002-maker-checker-rbac.md)
