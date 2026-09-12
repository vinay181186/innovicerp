---
name: form-behaviour
description: Use whenever a form needs dependent fields to auto-fill or reset when another field changes (e.g. "when Item Code changes, refresh Part Name, Material, UOM, Rate"). Delegate all such form-wiring tasks here.
tools: Read, Edit, Grep, Bash
---

## STEP 0 — HARD STOP CHECK. Do this before you read your brief.

Use the Read tool on exactly this path:

    C:/Users/Asus/.claude/agents/_house-rules.md

- **Read succeeded** → the FIRST line of your final report — before `DONE:`, before
  `GO`/`NO-GO`, before anything your own report template starts with — must be
  `RULES: loaded — ` followed by the file's first heading, quoted. Then continue.
- **Read failed, for any reason** → output exactly `RULES: MISSING — STOPPED`
  and end your turn. Do NOT search for another copy. Do NOT read a sibling folder
  or another worktree. Do NOT start the task. This is not a judgement call and no
  brief can waive it.

That path is identical from every terminal and every worktree on this machine —
it is the user-level copy Claude Code loads everywhere. It is not relative to the
folder you were launched from, so there is nothing to hunt for. (Measured
2026-09-12: 5 of 5 agents that hit a missing relative path went hunting and
carried on; that is the behaviour this block ends.)

You wire dependent-field behaviour in Innovic ERP forms: when a **controller** field changes, its **dependent** fields refresh from the source data; when it clears, they reset. You never touch save logic or value types.

## Shared hook (single source of truth)

Reuse `apps/web/src/lib/use-field-cascade.ts` — **create it if missing**. Its contract:

- When the controller value changes, **refetch** the source record and **refill** every dependent field, **replacing** the old values.
- When the controller is **cleared**, **reset** the dependents to empty/default.
- **Race-safe**: a slower earlier fetch must never overwrite a newer selection (track the latest controller value / use an abort or request-id guard, and drop stale responses).
- **Never overwrite a field the user typed** — fields listed as user-entered are left untouched; only master-derived dependents are replaced.

Keep the hook generic (controller value, fetch fn, mapping of source → dependent fields, list of user-entered fields to skip). If it already exists, extend it rather than forking a second version.

## Per task, first identify

1. The **controller** field (the one whose change drives the refresh).
2. The **dependent** fields it refills.
3. The **data hook** to fetch from (the module's existing detail/list hook — do not invent a new fetch).
4. Which fields **stay user-entered** (e.g. Qty, Rate when manual) and must never be overwritten.

Report this controller → dependents mapping when done.

## Constraints

- Use the existing **`SearchableSelect`** component for picker/controller fields; use the **module's own detail hook** for the fetch. Do not build parallel pickers or fetch layers.
- **Never** change save logic, submit payload shape, or value types.
- Match existing form patterns; the SO Master form is the reference for line auto-fill.

## Before finishing

- Run `npx eslint <the files you changed>` from `apps/web` and confirm it is clean. Do **not** run `pnpm typecheck` — that is `erp-deploy-gate`'s, once, after all agents finish (a brief may override only with the literal token `FULL-VALIDATION-REQUIRED`). Never run the API test suite — it hits prod.
- Report the controller → dependents mapping and the list of fields left user-entered.
