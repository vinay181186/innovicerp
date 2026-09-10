# House rules — every Innovic ERP agent

The one copy. These rules used to be pasted into four agent files and retyped into
every prompt; four copies drift and the prompts went stale. Each agent now points
here instead. If a rule changes, it changes once, in this file.

---

## HARD BANS — no exceptions, no task overrides them

- **Never run any git command.** Not `add`, `commit`, `push`, `checkout`, `stash`,
  `rebase`. The user shares this git index with a second terminal in the same repo;
  a bare commit once swept 22 unrelated files into one commit. Git is the user's.
- **Never run `pnpm --filter @innovic/api test`.** Its `global-setup.ts` runs
  `DELETE FROM public.job_cards WHERE code LIKE 'T%-%'` against the **PRODUCTION**
  database, and the integration tests write real rows. **A path filter does NOT
  narrow it** — the argument is dropped and the whole suite still runs.
- **Never run `db:push` or `seed`.** `db:push` is drizzle-kit diffing the whole
  schema and deciding for itself what to change; it can drop things nobody asked
  about. `seed` rewrites data. (Hand-written numbered SQL is a different thing —
  see erp-backend, which is authorised for it.)
- **Never start a server and leave it running.**
- **Never "improve" code outside the task you were given.** Scope creep in a
  parallel agent lands in someone else's diff.

## THE ENVIRONMENT — why the bans are that strict

There are two stacks:

| | database | deployed from |
|---|---|---|
| **production** — innovicerp.com | the live one, real orders | `main` |
| **test** — innovic-erp.pages.dev | separate, safe to write | `test` |

`.env.local` at the repo root points at **PRODUCTION**. Anything you run locally
that reads it touches real data.

There is no staging for the *code*: the user deploys and eyeballs the live app.
That is why the checks below are the only safety net, and why your report is the
user's only record of what happened.

## VERIFICATION — you do NOT run the full checks

**`pnpm typecheck`, `pnpm lint` and `pnpm build` are run ONCE, by `erp-deploy-gate`,
after all agents have finished.** Do not run them yourself.

This is deliberate. Four parallel agents each running a full-tree typecheck is four
races over one `node_modules` for one answer, and the user then runs it again anyway
— five passes where one is needed.

What you owe instead: **say precisely what you changed**, so the gate can check the
blast radius, and **do not guess**. If you believe a change is risky, say so in your
report rather than half-verifying it.

### What you MAY run — scoped, on your own files

Measured in this repo, so these are facts rather than hopes:

| command | scope | time | verdict |
|---|---|---|---|
| `npx eslint src/modules/<x>` | one module | **~7s** | **use it** |
| `npx vitest run <one.test.ts>` | one file, no DB | ~7s | **use it** |
| `npx tsc --noEmit <one file>` | — | — | **NEVER — see below** |
| `pnpm typecheck` (full tree) | everything | **2m12s** | the gate's, not yours |

Run the scoped lint on the module you touched, from `apps/web` or `apps/api`. It uses the
project's own eslint config, so a clean result means something. It is cheap enough that
there is no excuse for skipping it.

**`tsc --noEmit <file>` is banned, and this is not a style preference.** Passing a filename
makes TypeScript ignore `tsconfig.json` entirely, so the path aliases (`@/lib/api`,
`@innovic/shared`) all fail to resolve and the `lib` target reverts — a single file produced
**six errors, every one of them false**, including "Cannot find module '@/lib/api'" and
"Property 'replaceAll' does not exist". An agent acting on that output would "fix" working
code. There is no incremental build cache either (`tsconfig.json` sets neither `incremental`
nor `composite`), so there is no cheap correct typecheck to be had.

**Type errors are therefore the gate's to find.** That is the accepted trade: one honest
2-minute pass beats four agents each acting on false errors.

`erp-test` runs its own Playwright spec — that is its whole job, not an exception.

**Known lint baseline: 28 warnings, 0 errors, app-wide.** Warnings are not yours to
chase. Errors are.

## CONTEXT — read narrowly, on purpose

You will be given a brief that already contains the trace: the file, the cause, the
exact paths you may touch. **Start from the brief, not from a survey of the repo.**

Do **not** read these end to end. They are 12,700 lines between them and reading
them costs more than the task:

| file | lines | how to use it |
|---|---|---|
| `docs/DECISIONS.md` | 7,800+ | **grep for the ADR numbers your brief names.** Never read whole. |
| `docs/page-registry.yaml` | 2,180 | grep for your page only |
| `docs/SCHEMA.md` | 1,750 | grep for your table only |
| `CLAUDE.md` | 940 | skim once if you have not this session |

If your brief does not name the ADRs and you think a behaviour might be deliberate,
`grep -n "ADR-" ` the module's own source first — the code cites its own ADRs in
comments, and that is a two-line lookup instead of a 7,800-line read.

**If the brief is not specific enough to start, say so and stop.** A vague brief is
the single most expensive thing in this workflow; asking costs a minute, guessing
costs an hour.

## FOLDER OWNERSHIP — what makes parallel work safe

| agent | owns |
|---|---|
| `erp-frontend` | `apps/web/src/` |
| `erp-backend` | `apps/api/` |
| `erp-test` | `apps/web/e2e/` |
| `erp-deploy-gate` | nothing — read-only by design |

You may **read** anything. You may **edit** only your own folder.

### Shared files are handled BEFORE you start

`packages/shared/**` and the cross-cutting app files — `apps/web/src/lib/print/doc-print.ts`,
`apps/web/src/styles/innovic-theme.css`, `apps/web/src/routes/_authenticated.tsx`,
`apps/web/src/components/shared/**` — are **frozen by the user before any agent is
dispatched**. They are not yours, in either direction.

If your task genuinely needs one of them changed:

1. **Stop.**
2. Report **the exact edit you would make** — file, anchor, before/after — not just
   "this file needs changing".

The second half matters. "Blocked on doc-print.ts" costs a whole round trip; the
exact patch lets the user apply it in seconds and re-dispatch you with it done.

## REPORTING

Plain English, no jargon — the user reads these to decide whether to deploy.

Every report ends with:

```
COULD NOT DO
  <anything blocked, and exactly why. Never silently shrink the task.>
```

Silently doing less than you were asked is the one failure the user cannot see.
