# Violation Census — apps/web/src vs design-ref/

Date: 2026-09-23
Scope: `apps/web/src/**/*.{tsx,ts,css}` (346 .tsx, ~154 .ts, 3 .css files; 503 total source files)
Method: ripgrep/grep + two Python scripts for multi-value spacing/z-index parsing (all commands
quoted below so counts are reproducible). All counts exclude `design-ref/` itself; hex/rgb counts
also exclude `apps/web/src/styles/tokens.css` (the token source of truth) per instructions.

Rules read: `design-ref/README.md` ("Uniformity rule", "Type, spacing and sizing rules", "Field &
table rules"), `design-ref/guidelines/consistency.html` (canonical-elements divergence table),
`design-ref/guidelines/forms-field-width.html` (12-col FormGrid / `.fw-*` widths), the
`tables-*.html` cards, and `design-ref/_adherence.oxlintrc.json` (encodes: no raw hex literals, no
raw `px` literals, font-family restricted to the 5 design fonts, plus one prop-whitelist rule per
canonical component — i.e. once components exist, any extra/unlisted prop is a lint error).

---

## 1. Raw hex colours, rgb()/rgba(), named colours

**Commands:**
```
grep -rnoE '#[0-9a-fA-F]{3,8}\b' apps/web/src --include='*.tsx' --include='*.css' \
  | grep -v 'apps/web/src/styles/tokens.css'

grep -rnoE '\brgba?\([^)]*\)' apps/web/src --include='*.tsx' --include='*.css' \
  | grep -v 'apps/web/src/styles/tokens.css'
```

- **Raw hex literals: 323** occurrences across **74 files**
- **rgb()/rgba() literals: 289** occurrences across **75 files**
- **Combined: 612 occurrences, 120 distinct files** (hex ∪ rgba file sets barely overlap — most
  files pick one style or the other)
- Named CSS colours (`red`, `blue`, `grey`…) as color values: not materially present outside
  comments/strings — not counted as a separate material violation.

**Top files (hex + rgba combined, by count):**
| File | Hex | Rgba |
|---|---:|---:|
| `modules/print-templates/routes/editor.tsx` | 101 | — |
| `modules/bom-master/components/bom-form.tsx` | 69 | 4 |
| `modules/so-status/components/so-status-detail.tsx` | — | 29 |
| `modules/so-planning/components/edit-plan-modal.tsx` | 5 | 17 |
| `modules/qc-documents/routes/list.tsx` | — | 16 |
| `modules/tool-issues/components/tool-issue-register-view.tsx` | — | 13 |
| `modules/jc-ops/routes/list.tsx` | 4 | 11 |
| `styles/innovic-theme.css` (class vocab file, not tokens.css) | 10 | 4 |
| `index.css` | 10 | — |
| `modules/activity-log/routes/list.tsx` | 9 | — |
| `modules/route-cards/components/route-card-form.tsx` | — | 10 |
| `modules/design-tracker/routes/list.tsx` | — | 10 |
| `modules/reports/routes/list.tsx` | 8 | — |
| `modules/approval-config/routes/page.tsx` | — | 8 |
| `modules/sales-orders/components/sales-order-form.tsx` | 2 | 7 |
| `modules/purchase-orders/routes/detail.tsx` | 2 | 7 |
| `modules/design-projects/routes/detail.tsx` | 6 | 7 |
| `modules/capa/components/capa-view.tsx` | — | 7 |
| `modules/users/routes/edit.tsx` | 5 | — |
| `modules/qc-command/components/ParetoTab.tsx` | 5 | — |
| `modules/party-material-issues/components/party-material-issue-view.tsx` | — | 6 |
| `modules/job-work-orders/components/job-work-order-form.tsx` | 3 | 6 |
| `modules/job-cards/components/job-card-form.tsx` | 4 | 6 |
| `modules/job-cards/components/jc-status-content.tsx` | — | 6 |
| `modules/pending-so-value/routes/list.tsx` | 4 | — |

**Examples:**
- `apps/web/src/components/shared/related-docs-panel.tsx:275` — `#e5e7eb` (exactly the timeline-dot
  literal the design-ref README flags at line 25: "Timeline dots — `#e5e7eb` / `#9ca3af` literals" →
  canonical is `var(--border)` / `var(--text3)`)
- `apps/web/src/index.css:22` — `#f5f7fa`
- `apps/web/src/modules/access-control/components/configure-modal.tsx:520` — `rgba(0,0,0,.45)`
  (hand-rolled overlay tint instead of `.overlay`'s navy 45% + blur)

---

## 2. Inline pixel widths on controls

**Commands:**
```
grep -rnE '([^a-zA-Z]|^)width\s*:\s*[0-9]+[,}]' apps/web/src --include='*.tsx'      # exact `width:`
grep -rnE '(min|max)Width\s*:\s*[0-9]+' apps/web/src --include='*.tsx'              # minWidth/maxWidth
grep -rnE "width\s*:\s*['\"]?100%" apps/web/src --include='*.tsx'                   # width:'100%'
grep -rnoE 'w-\[[^\]]*\]' apps/web/src --include='*.tsx'                            # Tailwind arbitrary
```

- **Inline numeric `width:` (px, object literal): 159** occurrences
- **Inline `minWidth`/`maxWidth` numeric: 254** occurrences (same anti-pattern family — the ref's
  `.fw-xs/sm/md/lg` off-grid tokens are meant to replace all of these)
- **`width: '100%'` (not itself wrong, but shows fields aren't using FormGrid sizing): 81**
- **Tailwind `w-[…]` arbitrary values: 0** (none found — this specific escape hatch isn't used)
- **Combined numeric-width violations: 413, across 141 files**

**Top files (numeric `width:` count):**
| File | Count |
|---|---:|
| `modules/jw-dc/routes/list.tsx` | 8 |
| `modules/so-planning/routes/workflow.tsx` | 6 |
| `modules/print-templates/routes/editor.tsx` | 6 |
| `modules/so-planning/components/edit-plan-modal.tsx` | 5 |
| `modules/so-planning/components/bom-planning-modal.tsx` | 5 |
| `modules/outsource-jobs/components/outsource-jobs-view.tsx` | 5 |
| `modules/op-log/routes/list.tsx` | 5 |
| `modules/job-cards/routes/list.tsx` | 5 |
| `modules/sales-orders/routes/list.tsx` | 4 |
| `modules/qc-documents/routes/list.tsx` | 4 |
| `modules/purchase-orders/routes/list.tsx` | 4 |
| `modules/cost-centers/routes/list.tsx` | 4 |
| `modules/approval-config/routes/page.tsx` | 4 |
| `modules/access-control/components/configure-modal.tsx` | 4 |

**Examples:**
- `apps/web/src/modules/access-control/routes/list.tsx:112` — `<th style={{ width: 150 }}>Department</th>`
- `apps/web/src/modules/access-control/components/configure-modal.tsx:574` —
  `style={{ fontSize: 12, fontWeight: 700, width: 130, padding: '5px 8px' }}`
- `apps/web/src/components/shared/related-docs-panel.tsx:286` — `width: 8,` (an 8×8 dot, not a
  control, but still a raw px literal the oxlint rule would flag)

---

## 3. Font sizes off the 5-step scale (11/13/16/22/28)

**Commands:**
```
grep -rnE '([^a-zA-Z]|^)fontSize\s*:\s*[0-9]+' apps/web/src --include='*.tsx'
grep -rnoE 'font-size\s*:\s*[0-9.]+px' apps/web/src --include='*.css' | grep -v 'styles/tokens.css'
grep -rnoE 'text-\[[^\]]*\]' apps/web/src --include='*.tsx'   # Tailwind arbitrary text size
```

- **Inline `fontSize:` (tsx): 2,671** total declarations. Value distribution (top): 11px=898,
  12px=780, 10px=469, 9px=137, 14px=81, 16px=70, 13px=100, 18px=34, 22px=23, 20px=19, plus long
  tail down to 8/17/19/24/26/30/32/36/48px.
- **Off the 5-step scale (not 11/13/16/22/28): 1,575 of 2,671 (59%)** — the single biggest
  offender is **12px** (780 uses — a near-miss for 11 or 13 that shows the scale was never
  enforced) and **10px** (469 uses).
- **CSS `font-size:` outside `tokens.css`: 26**, all in `styles/innovic-theme.css`; **13 of 26 are
  off-scale** (that file is the "class vocabulary" file, i.e. even the canonical CSS itself has
  drifted from its own 5-step rule).
- **Tailwind `text-[…]` arbitrary: 0**
- **Files with at least one off-scale inline fontSize: 243** (70% of all .tsx files)

**Top files (off-scale fontSize count):**
| File | Count |
|---|---:|
| `modules/jc-ops/routes/list.tsx` | 42 |
| `modules/design-projects/routes/detail.tsx` | 41 |
| `modules/qc-documents/routes/list.tsx` | 37 |
| `modules/so-status/components/so-status-detail.tsx` | 33 |
| `modules/assembly/routes/detail.tsx` | 30 |
| `modules/print-templates/routes/editor.tsx` | 28 |
| `modules/sales-orders/routes/list.tsx` | 25 |
| `modules/design-work-log/routes/list.tsx` | 24 |
| `modules/so-planning/components/edit-plan-modal.tsx` | 22 |
| `modules/so-planning/components/create-plan-modal.tsx` | 22 |
| `modules/so-planning/components/bom-planning-modal.tsx` | 21 |
| `modules/so-planning/routes/workflow.tsx` | 19 |
| `modules/so-overview/routes/list.tsx` | 19 |
| `modules/job-cards/routes/list.tsx` | 19 |
| `modules/tpi/components/tpi-view.tsx` | 18 |
| `modules/job-cards/components/jc-stat-tiles.tsx` | 18 |
| `modules/saved-reports/components/builder.tsx` | 17 |
| `modules/so-qc-status/components/so-qc-status-view.tsx` | 16 |
| `modules/design-tracker/routes/list.tsx` | 16 |
| `modules/store-inventory/routes/list.tsx` | 15 |
| `modules/route-cards/routes/detail.tsx` | 15 |
| `modules/route-cards/components/route-card-form.tsx` | 15 |
| `modules/delivery-challans/routes/create.tsx` | 15 |
| `modules/daily-report/routes/list.tsx` | 15 |
| `modules/approval-config/routes/page.tsx` | 15 |

**Examples:**
- `apps/web/src/components/shared/file-preview-modal.tsx:221` —
  `<div style={{ fontSize: 30, marginBottom: 8 }}>📁</div>`
- `apps/web/src/components/shared/item-badge.tsx:90` —
  `style={{ width: THUMBNAIL_COL_WIDTH, padding: '8px 2px', fontSize: 10, overflow: 'hidden' }}`
- `apps/web/src/components/shared/machine-split.tsx:66` — `fontSize: 9,`
- This matches the guideline's own finding verbatim: `consistency.html` row "Font sizes" — *"17
  sizes in use (9–36px, incl. 12.5)"* → repo confirms **21 distinct pixel values** are actually in
  use today (8/9/10/11/12/13/14/15/16/17/18/19/20/22/24/26/28/30/32/36/48).

---

## 4. Spacing off the 4px scale (2/4/8/12/16/24/32)

**Method:** grep alone under/over-counts shorthand (`padding: '4px 0 4px 14px'` has one off-scale
number among three on-scale ones), so a Python scan parsed every `gap|rowGap|columnGap|padding*|
margin*` property value in every `.tsx` file and flagged any declaration containing **any** number
not in `{0,2,4,8,12,16,24,32}`.

**Script logic (reproducible):**
```python
prop_re = re.compile(r'\b(gap|rowGap|columnGap|padding|paddingTop|paddingBottom|paddingLeft|'
  r'paddingRight|paddingInline|paddingBlock|margin|marginTop|marginBottom|marginLeft|'
  r'marginRight)\s*:\s*([\'"`]?)([^,\}\'"`]+)\2')
scale = {0,2,4,8,12,16,24,32}
# for each match: nums = all integers in the value; off-scale if any(n not in scale for n in nums)
```

- **Total spacing declarations with a numeric value: 3,565**
- **Off-scale (contains at least one number not in {0,2,4,8,12,16,24,32}): 1,758 (49%)**
- **Files touched: 281 of 346 .tsx files; 269 of those (76%) have at least one off-scale value**
- Separately, `gap:` alone: 806 numeric declarations, 360 off-scale (most common off-scale gap
  values: 6px=200, 10px=105, 14px=19, 18px=6 — i.e. designers were eyeballing "close to 4/8/16")

**Top 25 files by off-scale spacing count:**
| File | Off-scale count |
|---|---:|
| `modules/print-templates/routes/editor.tsx` | 89 |
| `modules/jw-dc/routes/list.tsx` | 42 |
| `modules/design-projects/routes/detail.tsx` | 36 |
| `modules/design-work-log/routes/list.tsx` | 36 |
| `modules/access-control/components/configure-modal.tsx` | 26 |
| `modules/approval-config/routes/page.tsx` | 26 |
| `modules/sales-orders/components/sales-order-form.tsx` | 26 |
| `modules/bom-master/components/bom-form.tsx` | 25 |
| `modules/jc-ops/routes/list.tsx` | 24 |
| `modules/qc-documents/routes/list.tsx` | 23 |
| `modules/delivery-challans/routes/create.tsx` | 22 |
| `modules/so-planning/components/edit-plan-modal.tsx` | 22 |
| `modules/items/routes/list.tsx` | 21 |
| `modules/sales-orders/routes/list.tsx` | 21 |
| `modules/so-planning/routes/workflow.tsx` | 21 |
| `modules/job-work-orders/components/job-work-order-form.tsx` | 20 |
| `modules/production-schedule/routes/list.tsx` | 18 |
| `modules/so-status/components/so-status-detail.tsx` | 18 |
| `modules/production-dashboard/routes/index.tsx` | 17 |
| `modules/saved-reports/components/builder.tsx` | 17 |
| `modules/goods-receipt-notes/routes/list.tsx` | 16 |
| `modules/job-cards/components/jc-view-summary.tsx` | 16 |
| `modules/job-work-orders/routes/list.tsx` | 16 |
| `modules/sales-orders/routes/detail.tsx` | 15 |
| `modules/capa/components/capa-view.tsx` | 14 |

**Examples:**
- `apps/web/src/components/shared/doc-number-input.tsx:105,107,108` — `paddingRight: 30` (×3)
- `apps/web/src/components/shared/related-docs-panel.tsx:251` — `marginBottom: 18`
- `apps/web/src/components/shared/qc-report-attach.tsx:73` — `padding: '5px 12px'`

---

## 5. `window.confirm` / `window.alert` / bare `confirm(`/`alert(`

**Commands:**
```
grep -rn 'window\.confirm(' apps/web/src --include='*.tsx'
grep -rn '\bconfirm(' apps/web/src --include='*.tsx' | grep -v 'window\.confirm('
grep -rn 'window\.alert(' apps/web/src --include='*.tsx'
grep -rn '\balert(' apps/web/src --include='*.tsx' | grep -v 'window\.alert('
grep -rln 'ConfirmDialog' apps/web/src --include='*.tsx'
```

- `window.confirm(`: **18**
- bare `confirm(` (no `window.` prefix, same behaviour): **17**
- `window.alert(`: **29** (almost all are the "Allow popups to print" guard, or generic
  `catch (e) { window.alert(e.message) }` error surfacing)
- bare `alert(`: **0**
- **Total blocking browser dialogs: 64, across 42 files**
- **`ConfirmDialog` (the canonical replacement) is used in only 7 files** — i.e. for every 1 file
  using the design-system-correct pattern, 6 use the browser-native one.

**Examples:**
- `apps/web/src/modules/sales-orders/routes/list.tsx:663` —
  `onClick={() => { if (confirm(\`Delete SO ${so.code}?\`)) softDelete.mutate(so.id); }}` — the
  exact "inline Delete? Confirm" pattern the guideline calls out by name (`consistency.html` row
  "Delete confirm": *"window.confirm (lists), inline 'Delete? Confirm' (detail)"* → canonical
  `ConfirmDialog`).
- `apps/web/src/modules/bom-master/routes/detail.tsx:59` —
  `if (!window.confirm(\`Delete BOM "${detail.bomNo}"? This soft-deletes the record.\`)) return;`
- `apps/web/src/modules/purchase-requests/routes/list.tsx:125` —
  `if (!window.confirm(\`Approve ${pr.code}?\`)) return;` (confirm() used for an *approve*, not
  just delete — the blast radius of migrating this rule is wider than "delete buttons")

---

## 6. Table style split — `.innovic-table` with vs without `tbl-grid`

**Commands:**
```
grep -rl 'innovic-table' apps/web/src --include='*.tsx' | sort > has_innovictable.txt   # 131 files
grep -rl 'tbl-grid'      apps/web/src --include='*.tsx' | sort > has_tblgrid.txt        # 17 files
comm -23 has_innovictable.txt has_tblgrid.txt   # innovic-table WITHOUT tbl-grid (legacy)
comm -12 has_innovictable.txt has_tblgrid.txt   # innovic-table WITH tbl-grid (ref standard)
```

- **131 files** use `.innovic-table` at all.
- **17 files (13%)** use the ref-standard `.innovic-table.tbl-grid` sheet look.
- **114 files (87%)** use the legacy unruled `.innovic-table` look with `tbl-grid` nowhere in the
  file — this is the single largest structural gap in the whole census (list = original legacy
  port, per the README's own explanation of *why* they differ).

**WITH `tbl-grid` (17, the target look) — includes:** `bom-master/routes/list.tsx`,
`clients/routes/list.tsx`, `cost-centers/routes/list.tsx`, `incoming-qc/routes/index.tsx`,
`items/routes/list.tsx`, `job-cards/routes/list.tsx`, `machines/routes/list.tsx`,
`operators/routes/list.tsx`, `plans/routes/list.tsx`, `purchase-orders/components/po-sheet-table.tsx`,
`qc-call-register/components/qc-sheet.tsx`, `qc-processes/routes/list.tsx`,
`route-cards/routes/list.tsx`, `sales-orders/components/so-sheet-table.tsx`,
`tpi-masters/routes/list.tsx`, `users/routes/list.tsx`, `vendors/routes/list.tsx`.

**WITHOUT `tbl-grid` (114, legacy look) — largest/highest-traffic examples:**
`activity-log/routes/list.tsx`, `delivery-challans/routes/{create,detail,list}.tsx`,
`goods-receipt-notes/{routes,components}/*` (5 files), `job-cards/components/job-card-form.tsx`,
`job-work-orders/{routes,components}/*` (5 files), `jw-dc/routes/{list,detail}.tsx`,
`op-entry/components/*` (5 files), `purchase-orders/{routes,components}/*` (3 files),
`sales-orders/{routes,components}/*` (4 files — note `sales-orders` has BOTH looks: the
`so-sheet-table.tsx` component is on the ref standard, but `sales-orders/routes/list.tsx` and
`sales-orders/components/sales-order-form.tsx` are still legacy), `qc-command/components/*` (5
files), `store-inventory/*`, `tool-issues/*`, plus 90 more (full list in the raw grep output above
— every module not in the 17-file "WITH" set).

---

## 7. Tailwind utility usage vs `innovic-theme.css` vocabulary

**Commands:**
```
grep -rlE 'className=(\{[^}]*)?["'"'"'][^"'"'"']*(flex |grid |bg-|text-|p-[0-9]|px-|py-|gap-[0-9]|rounded-|border-|w-full|h-full|items-center|justify-)' apps/web/src --include='*.tsx'
grep -rlE 'className=(\{[^}]*)?["'"'"'][^"'"'"']*(panel|btn |btn-|badge|innovic-table|tn-|form-grp|form-label|section-hdr)' apps/web/src --include='*.tsx'
```

- Total `.tsx` files: **346**
- Files using Tailwind utility classes: **45 (13%)**
- Files using the `innovic-theme.css` vocabulary (`.panel`, `.btn`, `.badge`, `.innovic-table`,
  `.tn-*`, `.form-grp`, `.section-hdr`…): **278 (80%)**
- Files mixing **both** systems in the same file: **33 (10%)**
- Tailwind-**only** files (no innovic-theme vocabulary at all — genuinely un-migrated islands): **12**
- Files using **neither** heuristic (usually tiny wrapper/route files with no visible className): 56

**The 12 Tailwind-only files — every one of these is a full rebuild, not a token swap:**
```
components/shared/error-boundary.tsx
components/shared/searchable-select.tsx      ← flagged as a named risk file below
components/ui/card.tsx
components/ui/table.tsx
modules/dashboard/components/dashboard-tile.tsx
modules/dashboard/components/dashboard-tiles-grid.tsx
modules/saved-reports/components/result-table.tsx
modules/saved-reports/routes/list.tsx
modules/saved-reports/routes/run.tsx
routes/auth-callback.tsx
routes/login.tsx
routes/reset-password.tsx
```
Note: `so-planning`, `reports`, and several dashboard files are inside the "mixed" 33 — they
compose innovic-theme panels/tables around Tailwind flex/grid wrappers, which is the harder
half-migrated case (can't be codemodded as cleanly as pure-Tailwind or pure-vocab files).

---

## 8. Modals/overlays not on `.overlay`/`.modal`, and the z-index ladder

**Commands:**
```
grep -rnE '([^a-zA-Z]|^)zIndex\s*:\s*[0-9]+' apps/web/src --include='*.tsx'
grep -rnE 'z-index\s*:\s*[0-9]+' apps/web/src --include='*.css'
grep -rln "position:\s*'fixed'" apps/web/src --include='*.tsx'
find apps/web/src -iname '*modal*'
```

**z-index ladder compliance:**
- CSS (`innovic-theme.css`), 9 declarations: **4, 5, 6, 10, 60, 70, 200, 500, 9999 — every single
  one is exactly on the documented ladder.** The canonical CSS is fully compliant.
- Inline TSX `zIndex:`, 67 declarations across 61 files: values in use are
  `1, 2, 5, 8, 10, 11, 20(×22), 50(×6), 60(×11), 100(×14), 200(×4), 1000`.
  **50 of 67 (75%) are off the documented ladder** — `20` and `100` alone account for 36
  occurrences and aren't on the ladder at all; `searchable-select.tsx:344` uses `zIndex: 1000`
  (higher than the documented `toast` ceiling of `9999` only by coincidence of being under it, but
  arbitrary relative to every other layer).

**Hand-rolled overlays (no shared Modal/overlay component exists yet):**
- `position: 'fixed'` inline style: **32 files**
- Of those, **23 files (72%) never reference an `overlay` class at all** — they build the
  backdrop+centering from scratch (own `rgba()` tint, own centering flexbox, own z-index).
- There is **no shared `Modal` React component in the codebase today** — `find -iname '*modal*'`
  returns 26 files, every one a bespoke per-feature modal (`configure-modal.tsx`,
  `op-entry-modal.tsx`, `AssignModal.tsx`, `new-party-grn-modal.tsx`, `bom-planning-modal.tsx`,
  `edit-plan-modal.tsx`, etc.) — this is the component the ref's `Modal` is meant to replace
  wholesale, not patch.
- `className="modal"` (the nearest thing to a convention) appears in only 12 of those 26 files.

**Examples:**
- `apps/web/src/modules/access-control/components/configure-modal.tsx:520` —
  `background: rgba(0,0,0,.45)` (own overlay tint, not `.overlay`'s navy-45%+blur)
- `apps/web/src/components/shared/searchable-select.tsx:344` — `zIndex: 1000,` (dropdown popover,
  off-ladder)
- `apps/web/src/modules/bom-master/routes/list.tsx:108` — `zIndex: 20,` (off-ladder; ladder has
  nothing between table(4-6) and sidebar(10))

---

## 9. Required-field markers

**Commands:**
```
grep -rn '★' apps/web/src --include='*.tsx'
grep -rnE "required.*\*|\*</|'\*'|\"\*\"" apps/web/src --include='*.tsx'
grep -rin '(required)' apps/web/src --include='*.tsx'
```

- **`★` (the canonical marker): 224 occurrences across 84 files**
- **`*` as a literal required-marker glyph (not a comment/JSDoc `*`): 13 occurrences across 4
  files** — `bom-form.tsx` (6× `<span className="bomx-req">*</span>`), `assign-task-modal.tsx` (3×
  `<span className="req">*</span>`), `task-manage-modals.tsx` (3×), `todo-modal.tsx` (1×)
- **`(required)` text variant: 4 occurrences across 3 files** (`log-entry-approvals.tsx`,
  `op-log-history.tsx`, `tpi-view.tsx`)
- No shared `FormField` component exists yet — `find -iname '*form-field*'` returns nothing, so
  every form hand-renders its own label+marker (`doc-number-input.tsx` renders `★` inline at
  line 89 as one of the few consistent examples); `★` winning 224–13–4 is encouraging (the ref
  choice already dominates) but the 17 stragglers are worth a dedicated pass since they're
  concentrated in exactly the forms (`bom-form`, task modals) that also top the hex/spacing tables.

---

## 10. Emoji vs Lucide as control icons

**Commands:**
```
grep -rl "from 'lucide-react'" apps/web/src --include='*.tsx'
grep -rnoE '>\s*(✏|🖨|🗑|⬇|📄|🔄|✕|✅|👤|✖|📎|🔔|➕|✚|🔍|👁|⚙)' apps/web/src --include='*.tsx'
```

- **Lucide imported: 234 files** — Lucide is already the dominant icon source.
- **Emoji used as a control glyph (button/action content, not nav/module identity): 33 occurrences
  across ~20 files** — this is exactly the divergence the guideline names verbatim
  (`consistency.html` "Control icons: Emoji on buttons (✏ 🖨 🗑 ⬇ 📄 🔄 ✕) mixed with Lucide").
  `✅` (used as an inline approve action, not a status glyph) is the single most common offender
  (10 of the 33).
- This count is a **floor**, not a ceiling — the regex only catches the specific glyph set the
  README calls out; a manual per-file pass (especially `RowActions`-adjacent code) will find more,
  since the legacy emoji vocabulary (`nav-sections.ts`) is large and some of it leaks into buttons.

**Examples:**
- `apps/web/src/modules/access-control/routes/list.tsx:231,234` — `>✅` (approve button glyph)
- `apps/web/src/modules/job-work-orders/components/job-work-order-form.tsx:726` — `>⬇` (download
  action, should be `<Icon name="download">`)
- `apps/web/src/modules/dashboard/components/home-customize.tsx:67` — `>⚙` (a settings *action*,
  not a page-identity emoji — the borderline case the ref's "rule of thumb" is meant to resolve)

---

## 11. Hand-rolled `<button>`/`<input>` vs `.btn`/`.innovic-input`

**Commands:**
```
# button classification — Python, since className can be a template/expression
for <button ...> tag: has "btn" token in a literal className attr? count yes/no
grep -rno '<input\b' apps/web/src --include='*.tsx'
```

- **`<button>` tags: 798 total.** 723 (91%) carry a `.btn` class (literal or containing `btn`
  token); **75 (9%) across ~35 files have no `.btn` class** — smaller violation surface than
  expected, concentrated in toolbar/icon-only buttons (`bom-form.tsx` 5, `saved-reports/builder.tsx`
  4, `stat-strip.tsx` 3, `jc-op-card.tsx` 3).
- **`<input>` tags: 723 total.** 595 (82%) use `.innovic-input` directly; 89 (12%) have a
  className built from an expression (needs manual check, not a confirmed violation); ~29 use the
  **legacy `.pof-*` compact-PO palette classes** (`pof-in`, `pof-in pof-num`, `pof-in pof-in-sm`) —
  the README explicitly calls `.pof-*` "legacy, Create/Edit PO is [being] rebuilt on the standard
  form," so these 29 are pre-flagged debt, not new findings.
- Net: **buttons and inputs are the best-behaved rule in this census** — the `.btn`/`.innovic-input`
  convention is already close to universal; effort here is cleanup, not a rebuild.

---

## 12. Loading / empty / error state implementations

**Commands:**
```
find apps/web/src -iname '*page-state*'          # → no results, component doesn't exist yet
grep -rn 'className="empty-state"' apps/web/src --include='*.tsx'
grep -rln 'Loader2' apps/web/src --include='*.tsx'
grep -rnoE 'className="[a-z-]*(loading|empty|error|no-access|noaccess)[a-z-]*"' apps/web/src --include='*.tsx'
```

**No `PageState` component exists in the current code** — confirmed by `find -iname
'*page-state*'` returning nothing. At least **6 distinct implementations** are in active use doing
the job the ref's single `PageState` is meant to cover:

1. `className="empty-state"` bare div — **491 occurrences across 197 files** — used
   interchangeably for "loading", "empty", and "error" (no state-specific variant)
2. `<Loader2 className="... animate-spin" />` inline spinner — **213 files**, often combined with
   #1 (`<div className="empty-state"><Loader2 .../>Loading…</div>`)
3. Ad-hoc inline-styled loading text with no class at all — e.g.
   `so-planning/components/edit-plan-modal.tsx:871` — `<span style={{ color: 'var(--text3)' }}>Loading…</span>`
4. `.pof-empty` — legacy PO-palette empty state (1 file)
5. `.bomx-empty` — legacy BOM-form empty state (1 file)
6. `.form-error` (91 occurrences) — a distinct implementation again for field-level error text
   (arguably correct to stay separate from `PageState`, but currently has no single source either)

**Examples:**
- `apps/web/src/modules/job-work-orders/routes/list.tsx:181` —
  `<div className="panel"><div className="empty-state" style={{ padding: 20 }}><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading…</div></div>`
  (combines #1 Tailwind spinner classes + innovic `empty-state` + an inline `padding: 20` override
  — three violations stacked in one line)
- `apps/web/src/modules/sales-orders/components/so-drawing-history.tsx:102` —
  `if (isLoading) return <div className="empty-state">Loading drawing history…</div>;`
- `apps/web/src/modules/tasks/components/task-detail-modal.tsx:112` —
  `<div className="empty-state">Loading…</div>` (identical markup reused for the empty case
  elsewhere in the same file — no visual distinction between "loading" and "nothing here")

---

## SUMMARY TABLE

| # | Rule | Violations | Files affected | Effort | Codemod? |
|---|---|---:|---:|:---:|---|
| 1 | Raw hex / rgba colours | 612 (323 hex + 289 rgba) | 120 | **L** | Partial — mechanical token swap works for ~70% (known literals: `#e5e7eb`→`--border`, `#9ca3af`→`--text3`, `#8b5cf6`→`--purple`, `rgba(0,0,0,.6\|.45)`→`.overlay`); the long tail in `print-templates/editor.tsx` (101 hex) and `bom-form.tsx` (69 hex) is a user-facing colour picker, not decoration — cannot be blindly tokenized |
| 2 | Inline pixel widths | 413 (159 `width` + 254 `min/maxWidth`) | 141 | **M** | Yes for table `<th style={{width:N}}>` → `.fw-*`/`DataTableColumn width`; no for form-field widths, which need a `FormField size` judgment call per field (content-driven, not mechanical) |
| 3 | Font sizes off-scale | 1,575 of 2,671 inline + 13 of 26 CSS | 243 | **L** | Partial — a lookup table (10,12→11; 14,15→13; 18,20→16; 24,26→22; 30,32,36→28) covers most, but some 9px/48px uses are print-doc pt-scale (out of scope per README) and must be excluded by hand |
| 4 | Spacing off 4px-scale | 1,758 of 3,565 | 269 | **L** | Partial — same nearest-neighbour codemod as #3, same risk: some "6" and "10" are optically load-bearing (icon gaps) and rounding to 4/8 will visibly shift them |
| 5 | `window.confirm`/`alert` | 64 (35 confirm + 29 alert) | 42 | **M** | Yes — `confirm(msg)` → `<ConfirmDialog>` is a well-defined 1:1 transform per call site; `alert()` → `Toast`/`Banner` needs a tone decision (error vs info) per call site |
| 6 | `.innovic-table` w/o `tbl-grid` | 114 files legacy vs 17 on-standard | 114 | **XL** | No — this is the core rebuild, not a class rename; legacy tables have different column/markup assumptions (`.tbl-frozen`, `.tbl-auto`, `.tbl-compact`, `.tbl-edit` modifiers don't exist on them yet) |
| 7 | Tailwind vs innovic-theme split | 45 Tailwind files, 33 mixed | 45 (12 pure-Tailwind) | **L** (12 files) / **M** (33 mixed) | No for the 12 pure-Tailwind files (full rebuild each); the 33 mixed files are worse — partial codemod risks leaving broken half-Tailwind layouts |
| 8 | Modals not on `.overlay`, z-index off-ladder | 26 hand-rolled modals, 23 w/o `.overlay`, 50/67 z-index off-ladder | 32 (fixed-position) + 61 (zIndex) | **L** (z-index) / **XL** (modals) | z-index: yes, mechanical remap to the 9-value ladder. Modals: no — there is no shared `Modal` component today, so this is new-component adoption across 26 files, one review each |
| 9 | Required-marker inconsistency | 17 of 254 total markers (13 `*`, 4 "(required)") | 7 | **S** | Yes — trivial find/replace, small blast radius |
| 10 | Emoji as control icon | 33 (floor, not ceiling) | ~20 | **S–M** | Partial — needs a human per-glyph judgment (module-identity emoji must NOT be touched); a naive global swap would break the intentional legacy emoji vocabulary |
| 11 | Hand-rolled button/input | 75 buttons / ~29 legacy-class inputs | ~35 / ~15 | **S** | Yes — this rule is already 90%+ compliant; remaining cases are simple class additions |
| 12 | No unified loading/empty/error state | ≥6 distinct implementations, 491 `.empty-state` instances | 197 | **XL** | No — `PageState` doesn't exist yet; every one of the 197 call sites needs its `state` prop chosen (loading vs empty vs error vs noaccess) by reading the surrounding logic, which a codemod can't infer reliably |

**Read on effort:** S = <1 day mechanical, M = few days with judgment calls, L = 1–2 weeks with a
partial codemod + manual review of the long tail, XL = a genuine rebuild (new shared component
didn't exist before, every call site is a design decision, not a syntax rename).

---

## TOP 10 RISKS FOR THE OVERHAUL

**1. `searchable-select.tsx` is 100% outside the design system today — it's Tailwind-only, has no
`innovic-theme` classes at all, and is imported by 36 other files.**
Why risky: this is the literal implementation behind `SearchableSelect`/`SearchableOption` in the
ref — i.e. the ref *assumes* this component already looks right, but it doesn't. It also has the
single highest inline `zIndex: 1000` in the codebase (line 344) for its popover, off the documented
ladder, and is one of the 32 files using `position: 'fixed'` without an `.overlay` class. Every
master/document picker in the app depends on this file rendering identically after migration —
get the popover positioning/z-index wrong here and it silently breaks 36 downstream forms at once.
**Mitigation:** migrate this file first, in isolation, with a visual diff against the ref's
`SearchableSelect` card before touching any of its 36 callers; treat its z-index as a hard test
case for the new ladder (dropdown vs modal vs toast ordering).

**2. Dependent-field cascade logic is invisible to a grep-based census and lives inside form
components that are also the worst colour/spacing offenders (`bom-form.tsx`, `sales-order-form.tsx`,
`job-work-order-form.tsx`, `so-planning/edit-plan-modal.tsx`).**
Why risky: these files top *every* violation table in this census (69 hex + 25 off-scale spacing in
`bom-form.tsx` alone; 26 off-scale spacing + 3 hex + 7 rgba in `sales-order-form.tsx`). That's a
strong signal they're also the largest, most logic-dense files — restyling them means touching
`onChange` handlers, `useEffect` cascades (item→revision→UOM→rate refresh chains per
`CLAUDE.md` Section 17), and layout in the same diff. A pure "swap the JSX, don't touch the logic"
discipline is hard to hold in an 800+ line file.
**Mitigation:** for these specific files, refactor style and logic in *separate* commits even if
that means two passes — restyle first with logic untouched (verified via existing behaviour), then
a second logic-only pass if needed. Never combine them in one diff.

**3. `lib/print/*` documents are explicitly out of the design system's normal type/spacing rules
("Print documents keep their own pt scale for A4 output") — but 31 files import from `lib/print`,
and the census can't tell print-legitimate pt values apart from genuine off-scale violations.**
Why risky: a blind codemod against the 5-step font scale or 4px spacing scale will "fix" print
layouts that were correct on their own pt scale, breaking PO/DC print output — which the project's
own memory (`innovic-print-layout-standard.md`) calls "FINAL." `sheet-print.ts` is the canonical
print layout per that memory; `print-window.ts` and `doc-print.ts` are marked superseded but still
exist and are still imported by files in this census.
**Mitigation:** exclude `lib/print/**` and every file that only imports `sheet-print.ts` for print
rendering from the automated font/spacing codemod entirely; audit print call sites manually and
confirm against the "Innovic Sheet" standard before touching them.

**4. Permission-driven UI gating (`requireFormAccess`) is an API-side/service-layer gate referenced
only in code *comments* on the frontend (3 hits, all comments) — the actual frontend gating is
scattered across 46 files using ad-hoc `useAccessControl`/`canEdit`/`canApprove` hooks with no
single pattern.**
Why risky: `PageState`'s `noaccess` state and the whole "hide vs disable" question depends on
knowing exactly which of those 46 files currently render nothing, render disabled controls, or
render a a different message when access is denied — none of that is visible from a text census.
Restyling these pages risks silently changing an access-denied page from "hidden" to "visible but
broken," which is worse than the current legacy look.
**Mitigation:** before any of these 46 files get restyled, inventory their current denied-state
behaviour (screenshot or read each one) so the `PageState state="noaccess"` migration is a
faithful 1:1 swap, not a guess.

**5. `.innovic-table` legacy-vs-`tbl-grid` split (114 vs 17 files) is 87% of all tables — and 7 of
those legacy tables also use `.tbl-frozen`.**
Why risky: `tbl-frozen` (pin first column) files
(`activity-log/routes/list.tsx`, `delivery-challans/components/dc-card.tsx`,
`delivery-challans/routes/list.tsx`, `party-grn/components/party-grn-card.tsx`,
`party-grn/routes/list.tsx`, `production-orders/routes/list.tsx`,
`tasks/components/task-table.tsx`) are on the OLD unruled look per the ref's own note ("frozen…
were bolted onto the old look"), meaning the frozen-column CSS was hand-fitted to legacy markup.
Moving these to `tbl-grid` + the ref's `.tbl-frozen` modifier is not a class rename — the sticky
positioning math, border collapse, and z-index the frozen column needs may not carry over cleanly
to the ruled-sheet grid structure. This is the highest-complexity table migration in the app.
**Mitigation:** treat these 7 frozen-column files as their own workstream, in the ref's own
`tables-frozen.html` component (`DataTable` frozen variant) — do not attempt to hand-graft
`.tbl-frozen` onto the legacy markup as an intermediate step; go straight to `DataTable`.

**6. 197 files (57% of all `.tsx`) share one `.empty-state` class for loading/empty/error/no-access
states with zero visual differentiation, and there is no `PageState` component to replace it with.**
Why risky: this is both the widest blast radius in the census (491 occurrences) and the rule with
no codemod path — each call site needs a human to read the surrounding `isLoading`/`error`/`data`
logic and choose the correct `PageState state=` value. Getting this wrong at scale (e.g. mapping
every occurrence to `state="empty"` by default) will silently hide real error states behind a
generic "nothing here" message across the app.
**Mitigation:** don't attempt this as one sweep. Migrate `PageState` module-by-module alongside
whatever module is already being restyled for other reasons (tables, forms) — never as a
standalone global find/replace.

**7. Modal/overlay migration has no existing component to diff against (26 hand-rolled modals, no
shared `Modal.tsx` in the repo) and 75% of inline z-index values are off the documented ladder.**
Why risky: unlike tables (which at least have a 17-file "correct" reference set already in the
repo) or buttons (91% already compliant), modals are 0% migrated — every one of the 26 is a
from-scratch adoption of the ref's `Modal`/`ConfirmDialog`/`FilePreview` components. Combined with
the z-index chaos (values 1, 2, 5, 8, 11, 20, 100, 1000 in use, none matching the documented
4/5/6/10/60/70/200/500/9999 ladder), stacking order bugs (a modal's own dropdown appearing behind
its own overlay, a toast getting trapped under a modal) are the most likely category of
overhaul-introduced regression.
**Mitigation:** build/adopt `Modal` and `ConfirmDialog` first as standalone components, get their
z-index locked to the ladder, and smoke-test them against the *most* z-index-crowded existing
screen (`access-control/components/configure-modal.tsx`, which alone has 2 of the 67 inline
zIndex declarations plus a hand-rolled overlay) before rolling out to the other 25.

**8. The two largest single-file violation counts (`print-templates/routes/editor.tsx`: 101 hex +
89 off-scale spacing + 28 off-scale fontSize; `bom-master/components/bom-form.tsx`: 69 hex + 25
off-scale spacing) are both editor/builder UIs where colour and spacing are part of the *content
being edited*, not the chrome.**
Why risky: `print-templates/editor.tsx` almost certainly lets a user pick colours/sizes for a
print template block — those hex values may be legitimate user-facing data, not styling debt. A
codemod that treats every hex literal in this file as "replace with a token" would corrupt actual
template content.
**Mitigation:** hand-triage this file first, separating "chrome that should use tokens" from
"editable template properties that must stay literal, but should be exposed through a colour-swatch
control using the palette, not a free-text hex box" — this is a design decision, not a rename.

**9. `so-status/components/so-status-detail.tsx` has the highest raw rgba() count in the app (29)
with zero hex — meaning its whole colour system was hand-built in rgba, likely for opacity effects
that don't have an existing token.**
Why risky: unlike most files where hex→token is a 1:1 swap, 29 rgba() calls with alpha channels
suggests intentional translucency (hover states, disabled overlays, chart-like visualizations) that
the current 3-tier token system (`solid/2/3`) may not directly express. This file risks needing new
tokens rather than being migratable to existing ones — a scope risk if the plan assumes "every hex/
rgba maps to an existing var()".
**Mitigation:** audit this file's rgba() list against the token set in `_adherence.oxlintrc.json`
(`x-omelette.tokens`) before scoping the migration; flag any rgba pattern with no equivalent token
as a design-system gap to raise, not a migration bug to silently paper over.

**10. The 33 "mixed Tailwind + innovic-theme" files are worse than either pure-Tailwind or
pure-innovic-theme files for migration risk, because they're already in a half-converted state with
no record of which half is "new" and which is "legacy."**
Why risky: a file using both systems side-by-side (e.g. Tailwind flex utilities wrapping an
`innovic-table`) is easy to mistake for "already partially migrated, just finish it" when it may
instead be a Tailwind wrapper hastily bolted onto old markup, or vice versa. Without git-blame-level
archaeology per file, a migration pass risks treating Tailwind classes as the target state and
*removing* the innovic-theme classes instead of the other way around.
**Mitigation:** before restyling any of the 33 mixed files, grep each one individually for which
system governs the outermost layout container — that's almost always the "intended" system for
that file — and do not assume Tailwind-in / innovic-theme-out or vice versa as a blanket rule.

---

## Notes on methodology limits (for whoever picks this up)

- All counts are **grep/regex-based on source text**, not an AST parse — they will miss dynamic
  `style={computeStyle()}` calls, catch some false positives in template-literal comments (a small
  number were manually filtered, e.g. the `*` required-marker search initially matched JSDoc `*`
  lines and was filtered down from 17 raw hits to 13 real ones), and cannot distinguish
  "legitimately out of scope" (print pt-scale, user-editable template colours) from genuine
  violations without human review — flagged explicitly in risks #3 and #8 above.
- Rule 7's Tailwind/innovic-theme classification is a **heuristic** keyword match, not a full
  Tailwind-class dictionary — it will under-count Tailwind usage that relies on classes outside the
  matched prefix list (e.g. `shadow-`, `hover:`, `space-x-`) and is best read as a lower bound.
- The `apps/web/src` file totals used for percentages: 346 `.tsx`, 3 `.css`, 503 total matched
  source files (`.tsx`+`.ts`+`.css`).
