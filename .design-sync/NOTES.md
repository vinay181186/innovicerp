# Design-sync notes (Innovic ERP)

- Build: `node .design-sync/prebuild.mjs`, then the converter with `--node-modules apps/web/node_modules --entry apps/web/.ds-dist/index.js`. Run from the worktree root. Never `cd` into ds-bundle: Windows then refuses to remove it.
- Prebuild supplies placeholders for VITE_* (`lib/env.ts` throws at load); designs never call the API, so real addresses never ship.
- Prebuild compiles the app's whole `src/index.css` with Tailwind: SearchableSelect's open list uses Tailwind classes and every card relies on its reset.
- esbuild on Windows fails reading a directory through tsconfig paths ("Incorrect function"), hence `.design-sync/tsconfig.json`.
- `componentSrcMap` is the component list (no shipped .d.ts). New shared component: add it there.
- `DesignProvider` (query cache) is what DataTable and ItemBadge need.
- After a good upload, write the synced commit to `.design-sync/last-sync-commit` and commit it. `check-behind.sh` compares against it (CLAUDE.md §25).

## Known render warns
- RowMenu: small PNG, the card is mostly one ⋯ button.
- ActionMenu open state sits slightly off its button: the card wrapper's transform re-bases position:fixed; not a component fault.

## Re-sync risks
- Preview cards hold invented sample data and hand-written props; a changed prop breaks only that card.
- Fonts load from Google Fonts at runtime.
- DocNumberInput, ToastStack, IdentSep, IdentCode, LinkSlot are deliberately not shipped.
- FileField `drawing` variant shows the browser's own file control: true to the app today, a small leftover against the one standard.
