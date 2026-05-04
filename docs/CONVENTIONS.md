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
