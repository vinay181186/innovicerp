# The workflow — requirement to deploy

Not an agent. This is the order the human (or, later, an orchestrator) runs things in.
Agents read `_house-rules.md`; this file is why they get what they get.

---

## The measured problem this order exists to fix

Twelve agent runs in one session: **~1.1M tokens, ~2h40m of agent wall-clock.**

| brief | tokens |
|---|---|
| exact file list + the cause, handed over | 24k – 53k |
| "find and fix every print button" | **180k** |
| "verify the print format end to end" | **214k** |

Same repo, same tools. The cost tracked **how precise the brief was**, not how big the task
was. Everything below follows from that one fact.

---

## 1. TRACE FIRST — before any brief is written

**Find the cause yourself. Do not dispatch an agent to find out why.**

Produce, in your own words:

- the **file and line** where the behaviour lives
- **why** it happens — the actual mechanism, not a guess
- the **exact list of files** that must change
- the **ADR numbers** that govern it, if any (`grep -n "ADR-" ` the module's source — the code
  cites its own decisions)
- what is **already true** and must not be re-derived (specificity rules, existing helpers,
  a fallback the agent will otherwise rediscover)

An hour of tracing has repeatedly saved three to four hours of agent time. Skipping it is the
single most expensive habit available.

**A brief with no trace in it is not ready to send.**

## 2. SHARED-FILE PRE-PASS — before fanning out

Agents own folders. These files belong to nobody and are needed by everybody:

- `packages/shared/**` — the contract both sides read
- `apps/web/src/lib/print/doc-print.ts` — five documents render through it
- `apps/web/src/styles/innovic-theme.css` — every page
- `apps/web/src/routes/_authenticated.tsx` — the shell every page sits in
- `apps/web/src/components/shared/**` — used across pages
- `apps/api/src/db/schema.ts` — read by services app-wide (erp-backend may add columns;
  never rename or drop)

**Make every change these need YOURSELF, first, and freeze them.** Then dispatch.

Freezing `packages/shared` was already being done and produced zero contract collisions across
twelve agents. The other files were *not* frozen, and every stall of the session was in them —
three separate round trips where an agent hit a forbidden file, stopped, and waited.

Same discipline, wider list. That is the whole change.

## 3. FAN OUT — one message, parallel

`erp-frontend` (`apps/web/src/`) and `erp-backend` (`apps/api/`) in a single message so they
run at once. Exclusive folder ownership is what makes that safe.

Each brief carries: the trace, the exact files, the named ADRs, the contract fields quoted from
`packages/shared`, and a pointer to `_house-rules.md` — **not** a paste of the rules.

For multi-page frontend work, fan out one agent per `modules/<x>/` folder rather than splitting
frontend from backend.

Single-page work does not need an agent at all. Do it inline.

## 4. ONE VERIFICATION PASS — `erp-deploy-gate`

Agents no longer run `typecheck` / `lint` / `build`. The gate runs them once, for everybody,
after all agents finish.

It also separates **your** files from the parallel terminal's, which is the thing that has
actually gone wrong here before — a bare commit once swept 22 unrelated files.

A failure at the gate is normal. It is the first time the combined work has been compiled.

## 5. FIX → RETEST

```
gate or test fails
   → the report names the file, the cause and the owning agent
   → re-brief THAT agent with the failure text (a trace, again — not "it's broken")
   → gate re-runs
   → push to test
   → erp-test re-runs the SAME spec against the deployed test site
```

The push is the step an agent cannot do. `erp-test` runs against a deployed site, so a fix it
dispatches cannot be re-verified until someone deploys. Keep that step visible rather than
letting the loop quietly stall.

## 6. DEPLOY

`test` branch → `https://innovic-erp.pages.dev`. Production (`main`) only on an explicit
instruction, and say what else rides along — the other terminal's commits usually do.

---

## Not yet: an orchestrator agent

An orchestrator would sit exactly here, doing steps 1, 2, 3, 4 and handing back for 6.

**Do not build it until steps 1–5 are habit.** It cannot rescue a vague brief; it would just
produce vague briefs faster, and it would need the whole codebase in context to trace properly —
rebuilding the very problem this order exists to avoid, one level up.
