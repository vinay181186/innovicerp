# Baseline — before any UI change

Branch `ui-overhaul`, worktree `wt-ui-overhaul`, forked from `test` @ `227b1903`.
Rollback tag: `pre-ui-overhaul-20260923` (pushed to origin).

| Check | Result |
|---|---|
| `pnpm --filter web typecheck` | PASS — no output |
| `pnpm --filter web lint` | PASS — no output |
| `pnpm --filter web build` | PASS — built in 16.34s |

## Bundle sizes at baseline (compare after the overhaul)

| Asset | Raw | Gzip |
|---|---|---|
| `index.html` | 1.94 kB | 0.83 kB |
| `assets/index-*.css` | **44.76 kB** | **9.76 kB** |
| `vendor-sentry` | 0.04 kB | 0.06 kB |
| `vendor-icons` | 20.55 kB | 4.38 kB |
| `vendor-dates` | 23.40 kB | 6.90 kB |
| `vendor-forms` | 90.46 kB | 25.05 kB |
| `vendor-react` | 142.22 kB | 45.57 kB |
| `vendor-tanstack` | 187.74 kB | 56.17 kB |
| `vendor-supabase` | 205.96 kB | 53.21 kB |
| `vendor-xlsx` | 429.03 kB | 143.08 kB |
| `assets/index-*.js` | **2,448.72 kB** | **569.94 kB** |

## Pre-existing warnings (NOT caused by the overhaul — do not "fix" as part of it)
1. `lib/supabase.ts` is both dynamically imported (`modules/backup/routes/page.tsx`) and statically
   imported by 9 modules, so the dynamic import does not split a chunk.
2. Main `index` chunk exceeds the 1000 kB warning limit.

## Scale of the app
- 346 `.tsx` files under `apps/web/src`
- 145 route files under `modules/*/routes/`
- 82 modules
- 22 shared components
- Styles: `tokens.css` 190 lines, `innovic-theme.css` 1630 lines
