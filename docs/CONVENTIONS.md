# CONVENTIONS.md — Coding Standards

## File Naming

- kebab-case for files: `job-cards.service.ts`
- PascalCase for React components: `JobCardForm.tsx`
- camelCase for variables/functions
- PascalCase for types/interfaces/classes/enums
- SCREAMING_SNAKE_CASE for constants

## TypeScript

- Strict mode mandatory.
- No `any` without `// any: <reason>` comment.
- Define data shapes in Zod, infer TS types from them.
- `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

## Backend Module Structure

Each module has exactly:

- `routes.ts` — Fastify routes only, no logic
- `service.ts` — All business logic
- `schema.ts` — Zod schemas (or re-export from `@innovic/shared`)
- `service.test.ts` — Unit tests
- `routes.test.ts` — Integration tests

## Routes Discipline

Routes ONLY: declare endpoint, validate input via Zod, call service, return response. NO business logic, NO database queries, NO conditionals beyond auth/validation.

## Service Discipline

- All business logic lives here.
- Always takes `(input, currentUser)` parameters.
- Always returns typed result.
- Wraps multi-table writes in transactions.
- Throws typed errors (not strings): `NotFoundError`, `ValidationError`, `AuthorizationError`, `ConflictError`.

## Error Handling

- API throws domain errors. Fastify error handler maps these to HTTP codes (404, 400, 403, 409).
- All errors logged via Pino with context (`user_id`, `request_id`, `company_id`).
- Frontend catches errors via TanStack Query `onError`, shows toast notifications.

## React Component Discipline

- Components are presentational. Logic in custom hooks.
- Forms use react-hook-form + Zod resolver.
- Server state via TanStack Query, NEVER `useEffect` + `fetch`.
- Local UI state in Zustand or component state.
- No prop drilling beyond 2 levels — use Zustand.

## Item pickers — code is the key, name auto-fills (system-wide rule)

`itemCode` is the unique, permanent key for an item. **Every place an item is
chosen, the user selects the _code_; the item _name_ is derived from the master
and must NOT be a hand-typed field at the point of use.**

- Selecting/typing a code that matches the Item Master **always** overwrites the
  name field from `master.name` (never a stale "fill-only-if-empty" edit), and
  the name renders **read-only** (greyed) — it is a snapshot of the code's master
  name, so it can't drift.
- Where a form legitimately accepts an **off-master** item (free-text
  `itemCodeText` with no master match — e.g. PO/PR/GRN/JWO buyer text), keep the
  name editable **only** while there is no master match; the moment a master code
  is picked, auto-fill + lock it. Clear `itemId` when the code goes off-master.
- Compliant forms: sales-orders, job-work-orders, purchase-orders,
  purchase-requests, plans, goods-receipt-notes, nc-register, job-cards, bom.
  New forms with an item picker MUST follow this pattern (don't add a raw,
  always-editable item-name input).
- Server is the source of truth: create/update services `resolveItem(code)` and
  snapshot the name from the resolved master row — never trust a client-supplied
  name for an on-master item.

## API Client (frontend)

- Single `apiClient` in `apps/web/src/lib/api.ts` (axios or ky).
- Adds auth header from Supabase session automatically.
- Refreshes token on 401.

## Logging

- API: Pino with request context (`req_id`, `user_id`, `company_id`).
- Frontend: a single `log()` helper, ships errors to Sentry.
- Never `console.log` in committed code.

## Imports

- Absolute imports via `@/` alias for in-package imports.
- Cross-package imports via `@innovic/shared`.
- No `../../` beyond two levels.

## Git Commits

Format: `<type>(<scope>): <subject>` where type is one of:

- `feat` — new feature
- `fix` — bug fix
- `chore` — tooling, dependencies, no behavior change
- `docs` — documentation only
- `refactor` — restructuring without behavior change
- `test` — test-only changes
- `perf` — performance improvement

Examples:

- `feat(job-cards): add op-entry endpoint`
- `fix(grn): correct quantity rollup on partial receipt`
- `chore: bump drizzle to 0.36.5`

## Branching

- `main` — protected; PR + CI required.
- `staging` — pre-prod; auto-deploys to staging environment.
- Feature branches: `<type>/<short-slug>` e.g. `feat/items-master`.

## Time

- All `timestamptz` stored UTC.
- All UI shows IST (`Asia/Kolkata`) via `date-fns-tz`.
- Server-side date math uses `date-fns` UTC primitives only.

## Document numbers (ADR-227 — the rule that keeps getting re-learned)

A document number is a **fact the server states**, never a value the browser
decides. This has been rebuilt three times (ADR-054, ADR-060/064, ADR-224)
because it was never written down. It is written down here.

**On a create screen the number is a PREVIEW. The browser never sends it.**

- The box is `readOnly`, with `title="Numbered automatically when you save"` and
  the help line "Numbered automatically when you save."
- No `★` on create — it marks a box nobody can fill.
- The create payload **omits the key entirely**. Not `''`, not the suggestion.
- The prefill **follows** the server's latest answer. Never latch it behind a
  `useRef` or an "only while blank" guard: a latch is what makes a stale number
  stick, and there is no typing to protect because the box is read-only.
- Nothing about the number may disable Save. It is not the user's to get wrong.
- A preview that goes stale costs nothing. The save takes the next free number
  and says nothing, because nothing went wrong.

**On the server, in this order, inside the SAME transaction as the insert:**

1. `await lockDocSeries(tx, companyId, '<table>')` — **first**, before reading
   anything. The series key is the TABLE the code lives in, not the prefix: two
   prefixes in one table share one unique index, so they must share one lock.
   Add the table to the `DocSeries` union in `apps/api/src/lib/doc-series-lock.ts`.
2. Read the highest number **counting deleted rows**. Every unique index on a
   code column is partial (`WHERE deleted_at IS NULL`), so excluding them does
   not fail loudly — Postgres accepts the duplicate and the register quietly
   holds two papers with one number, one of them in Trash. **One number, one
   document, for ever**; a deleted document leaves a permanent gap, and that is
   the intended trade (owner, 2026-10-09).
3. Anchor the scan on the prefix and parse the digits — never `replace(/\D/g,'')`
   over the whole code (`INV-0001/R2` reads as `12`), and never a text `MAX`
   (`ORDER BY length(code) DESC, code DESC` resets the series the first time
   someone hand-types a differently padded code).
4. A per-document series that is **not** company-wide may use a row lock at the
   right grain instead — `assembly_units` serialises on its sales order via
   `lockSoRow`, and is deliberately not in `DocSeries`.

**A number that is a pure system series must not be accepted from a caller at
all** — leave it out of the create schema, so an Excel import or a direct `POST`
cannot supply one either. A **master's** code may stay optional (the Excel import
matches rows by Code and a user may legitimately want `VND-ACME`); the screen
still must not send the preview.

**If a caller may supply one, check it under the same lock.** Three creates once
carried the comment "a typed number is checked under the same series lock" and
the next line did no check at all. A comment is not a check.

**Never build a document number in the browser.** Cost Centre derived `CC-NNN`
from a row count in a `limit: 1` list query — so any deleted cost centre made the
next one collide, and the box showed `CC-001` until the count arrived.

**Reserving a number when the screen opens is REJECTED** (ADR-224): it needs a
counter table, and then **every abandoned form** leaves a hole — someone who
opens New GRN and walks away has burnt a number. That is a different trade from
step 2, which burns a number only when a saved document is **deleted**: a rare,
deliberate act with an audit row behind it. Holes on deletion are accepted; holes
on browsing are not. Do not re-propose reservation.
