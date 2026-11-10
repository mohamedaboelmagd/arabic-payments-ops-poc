# Engineering playbook — a squad of four to eight

This playbook is written the way I would run a squad that ships Arabic-first
payments software into regulated institutions. It is not a ceremony catalogue.
The job of an engineering manager here is that the squad ships, that the
releases are safe to explain to a control function, and that the people on
the squad are better engineers a year from now.

## Squad shape

A workable 6-person mix (scale the same ratios to 4 or 8):

| Seat | Focus |
|---|---|
| EM (this role) | Commitments, staffing, reviews, on-call health, customer go-lives |
| Product manager (partner, not a report) | Scope, sequencing, saying no |
| 2 backend engineers | Kernel, rails, ledger, integrations |
| 1 frontend engineer | Operations console, RTL, bilingual copy |
| 1 engineer spanning platform / QA | CI, environments, contract tests against rails |
| Optional 7th/8th | A second frontend or a specialist on a particular rail |

There is no hidden tech-lead layer. The EM reads design reviews and pull
requests, and has an opinion that can be defended. The EM does **not** take
the hardest tickets "to help" unless the alternative is a missed go-live —
otherwise the team never owns the scary parts.

## Rituals that earn their slot

- **Monday commit** (30 min): what we said last week vs what landed; what we
  will say this week, in writing. Slippage is raised the week it appears.
- **Daily pair of huddles, not a theatre standup**: backend and console each
  have a 10-minute check if they need it. The EM joins when a dependency is
  stuck, not by default.
- **Design review** before any change to the state machine, the journal
  planner, limits, or an external rail contract. One page, the state diagram,
  the failure modes, the audit events. Thirty minutes, decided in the room.
- **Weekly 1:1s** with every report. Growth plan visible to both people.
  Performance conversations are not saved for the cycle.
- **Fortnightly customer playback** during a go-live: the squad watches a
  real operator use the console, including the Arabic UI. RTL bugs found here
  are treated as escaped defects, not copy polish.
- **Monthly operations review**: change-failure rate, time-to-restore,
  approval wait time, on-call pages that were noise.

## Code review

Every PR answers four questions, and RTL / Arabic is one of them:

1. Does the kernel still refuse an illegal transition, an unbalanced journal,
   and a self-approval?
2. Is every new state change written to the audit log with an actor and a
   reason a reviewer can understand six months later?
3. If copy or layout changed, was the Arabic RTL path exercised (not just a
   screenshot in English)? IBANs, amounts and references stay `dir="ltr"`.
4. What is the rollback? A feature flag, a reversible migration, or a reason
   this change is safe without one.

Reviewers are expected to disagree on the merits. "Looks good to me" with no
evidence is not a review on a settlement path. The EM samples PRs every week,
including ones that already have approvals.

## CI / CD

The pipeline in `.github/workflows/ci.yml` is the minimum bar this repo
enforces: unit tests for the kernel, API tests via Fastify `inject`, a
typecheck, and a production build of the dashboard.

A production pipeline for a bank-bound service would add, in order:

1. Contract tests against each rail's sandbox (replay recorded fixtures).
2. Migration checks (forward and backward) on an ephemeral Postgres.
3. A bilingual visual check for the console (at least the queue and the
   approval screen, both `dir=rtl` and `dir=ltr`).
4. A signed change record: git SHA, ticket, approvers, risk class, rollback.
5. Progressive delivery: sandbox → a single institution's UAT → production
   with a one-instruction canary, not a Friday bulk cutover.

The EM owns whether this pipeline is actually required to merge, not whether
it exists in a wiki.

## On-call and incidents

- A primary and a secondary, weekly rotation, no more than one in three
  weeks on primary for anyone.
- Pages must be actionable at 2 a.m.: "scheme callbacks for instant credit
  are failing checksum verification", not "CPU high".
- Every page, including the ones we later classify as noise, gets a note.
  Recurring noise is a backlog item, not a personality test.
- Severity 1 (money in the wrong place, or a rail we cannot submit to) has a
  written first hour: who talks to the institution, who holds the kernel,
  who writes the timeline.
- The write-up is due within two working days. Actions have owners and
  dates. The EM checks the previous month's actions actually closed.

A defect in settlement logic is a phone call, not a ticket that waits for
the next sprint.

## Hiring rubric

The EM runs the loop and is accountable for the decision, including
rejections of people the team liked.

| Signal | What "yes" looks like | What is not enough |
|---|---|---|
| Technical depth | Can walk a state machine and a journal and find the hole | Syntax trivia, framework loyalty |
| Arabic / RTL care | Notices a concatenated string that will break in Arabic, or an IBAN that inherits RTL | "We can fix copy later" |
| Quality instincts | Talks about escaped defects and how they would measure them | "We had tests" with no mention of what they prove |
| Collaboration | Disagrees clearly, then commits | Silent in the room, vocal afterwards |
| Ownership | Has ended something that was not working — a design, a project, or a hiring yes they reversed | Only stories where they were the hero |

For a maker-checker domain I would include one design interview ("a retry
arrives with the same idempotency key and a different amount — what happens
and who can see it later?") and one review interview (a PR that looks fine
and hides an unbalanced fee line).

I will not hire someone the squad likes if those two interviews are weak. I
will explain why, in writing, to the people who recommended them.

## Absorbing compliance overhead

Access reviews, change records and audit evidence are part of the work, not
an after-hours tax. The EM's job is to make the *necessary* parts of that
overhead show up as checklists and pipeline gates, so engineers feel the
controls that protect them and none of the theatre.

What that means in practice:

- The audit log in this repo is the start of audit evidence, not a PDF
  someone fills in after the fact.
- Role changes go through the same four-eyes instinct as a large payment.
- Production access is time-boxed and logged. "I still have prod because I
  once did a go-live" is a finding.
- When a control cannot be automated yet, it is a dated exception with an
  owner, not a standing meeting.

## How this PoC maps to the playbook

The kernel, the four-eyes rule, the bilingual console and the CI workflow
are here so a reader can see the bar. The playbook is how I would keep that
bar after the third institution goes live and the original authors are no
longer the only people touching the code.
