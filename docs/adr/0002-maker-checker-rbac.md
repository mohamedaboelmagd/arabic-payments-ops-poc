# ADR-0002: Maker-checker four-eyes and role checks inside the kernel

- Status: accepted
- Date: 2026-11-10

## Context

Above a value threshold, and whenever screening raises a warning, a second
person has to look at a payment instruction before it can be submitted to a
rail. Putting that rule only in the user interface — hiding the Approve
button — is not a control. A crafted API call would bypass it.

The squad also has distinct duties (maker, checker, auditor, admin, viewer)
that must be the same in the API and in the browser demo.

## Decision

- RBAC is enforced in the kernel, not in the route layer. Each transition
  names the roles that may perform it.
- A maker cannot approve or reject an instruction they created.
- Screening sets `approvalStatus` to `pending` when the amount is at or
  above the per-currency threshold or when any rule hit is `warn` or
  `block`. Submission requires `approved` or `not_required`, and refuses
  any outstanding `block` hit.
- Admin is reserved for rail simulations (settle / fail) and for reversals
  after settlement — the actions an operator would take when a scheme
  callback arrives, or when a return has to be booked.

## Consequences

- The static demo cannot offer a loophole the API would refuse; both call
  the same functions.
- Tests describe the control in plain language ("maker cannot approve their
  own instruction") and will break if a later refactor moves the check to
  the UI.
- Production would add four-eyes on reversals and on changes to the
  threshold itself, and would take the actor from a verified token rather
  than the `x-actor` demo header.
