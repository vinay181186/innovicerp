# Innovic ERP

Manufacturing ERP for a job-shop environment. Migration of a 29,000-line single-HTML/Firebase Firestore app to a relational architecture: React + Fastify + Supabase Postgres, Mumbai region.

> **Read `CLAUDE.md` first.** It is the master spec. All sessions begin there.

## Layout

- `apps/api` — Fastify backend (TypeScript, Drizzle, Zod, Pino)
- `apps/web` — React frontend (Vite, Tailwind, shadcn/ui, TanStack Query/Router)
- `packages/shared` — Zod schemas + inferred types shared between api and web
- `migration/` — One-time Firestore → Supabase scripts
- `legacy/` — Original HTML spec source (do not modify)
- `docs/` — Living project memory: schema, decisions, tasks, conventions, runbook

## Setup (after cloning)

```
pnpm install
cp .env.example .env.local   # fill in real values
pnpm dev
```

## Conventions
See `docs/CONVENTIONS.md`. Schema lives in `docs/SCHEMA.md`. Tasks tracker is `docs/TASKS.md`. Architectural decisions are in `docs/DECISIONS.md`.
