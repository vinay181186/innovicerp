# Foundation Delta — design-ref vs current app

Scope: `design-ref/tokens/{base,colors,fonts,spacing,typography,components,po-compact,print}.css` +
`design-ref/styles.css` vs `apps/web/src/styles/tokens.css`, `apps/web/src/styles/innovic-theme.css`,
`apps/web/src/index.css`, `apps/web/tailwind.config.ts`, `apps/web/index.html`. Read-only audit, no
files outside this report were changed.

---

## 1. Token table — exact values

### 1.1 Colours — surfaces / borders / text

All values below are **byte-identical** between `design-ref/tokens/colors.css` and
`apps/web/src/styles/tokens.css` (the ref file's own header says it was "ported verbatim").

| Token | ref value | app value | Status |
|---|---|---|---|
| `--bg` | `#f5f7fa` | `#f5f7fa` | SAME |
| `--bg2` | `#ffffff` | `#ffffff` | SAME |
| `--bg3` | `#f8fafc` | `#f8fafc` | SAME |
| `--bg4` | `#f2f4f7` | `#f2f4f7` | SAME |
| `--bg5` | `#eaecf0` | `#eaecf0` | SAME |
| `--border` | `#d8e1ec` | `#d8e1ec` | SAME |
| `--border2` | `#c8d3e0` | `#c8d3e0` | SAME |
| `--border3` | `#b3c1d1` | `#b3c1d1` | SAME |
| `--text` | `#172b4d` | `#172b4d` | SAME |
| `--text2` | `#667085` | `#667085` | SAME |
| `--text3` | `#7b8aa0` | `#7b8aa0` | SAME |

### 1.2 Colours — brand accents (3-tier)

| Token | ref | app | Status |
|---|---|---|---|
| `--cyan` / `--blue` | `#155eef` | `#155eef` | SAME (both names alias the same Innovic blue in both files) |
| `--cyan2` / `--blue2` | `#123b73` | `#123b73` | SAME |
| `--cyan3` / `--blue3` | `#eff6ff` | `#eff6ff` | SAME |
| `--amber` | `#f79009` | `#f79009` | SAME |
| `--amber2` | `#b54708` | `#b54708` | SAME |
| `--amber3` | `#fffaeb` | `#fffaeb` | SAME |
| `--green` | `#12b76a` | `#12b76a` | SAME |
| `--green2` | `#027a48` | `#027a48` | SAME |
| `--green3` | `#ecfdf3` | `#ecfdf3` | SAME |
| `--green2-hover` | `#05603a` | `#05603a` | SAME |
| `--red` | `#f04438` | `#f04438` | SAME |
| `--red2` | `#b42318` | `#b42318` | SAME |
| `--red3` | `#fef3f2` | `#fef3f2` | SAME |
| `--red2-hover` | `#912018` | `#912018` | SAME |
| `--orange` | `#e04f16` | `#e04f16` | SAME |
| `--orange2` | `#b93815` | `#b93815` | SAME |
| `--orange3` | `#fff6ed` | `#fff6ed` | SAME |
| `--purple` | `#7a5af8` | `#7a5af8` | SAME |
| `--purple2` | `#5925dc` | `#5925dc` | SAME |
| `--purple3` | `#f4f3ff` | `#f4f3ff` | SAME |
| `--teal` | `#0e9384` | `#0e9384` | SAME |
| `--teal2` | `#107569` | `#107569` | SAME |
| `--teal3` | `#f0fdf9` | `#f0fdf9` | SAME |

### 1.3 Colours — department tints + signal colours

All identical, SAME in both:

| Token pair | Value | Status |
|---|---|---|
| `--dept-planning` / `-bg` | `#7a5af8` / `#f4f3ff` | SAME |
| `--dept-sales` / `-bg` | `#027a48` / `#ecfdf3` | SAME |
| `--dept-store` / `-bg` | `#b54708` / `#fffaeb` | SAME |
| `--dept-design` / `-bg` | `#7a5af8` / `#f4f3ff` | SAME |
| `--dept-production` / `-bg` | `#0e7490` / `#e0f2fe` | SAME |
| `--dept-qc` / `-bg` | `#b42318` / `#fef3f2` | SAME |
| `--dept-purchase` / `-bg` | `#123b73` / `#eff6ff` | SAME |
| `--dept-finance` / `-bg` | `#0b776e` / `#e6f6f4` | SAME |
| `--dept-tasks` / `-bg` | `#7a5af8` / `#f4f3ff` | SAME |
| `--dept-system` / `-bg` | `#667085` / `#f2f4f7` | SAME |
| `--sig-critical` / `-bg` / `-bd` | `#f04438` / `#fef3f2` / `#fecdca` | SAME |
| `--sig-warn` / `-bg` / `-bd` | `#f79009` / `#fffaeb` / `#fedf89` | SAME |
| `--sig-ok` / `-bg` / `-bd` | `#12b76a` / `#ecfdf3` / `#a6f4c5` | SAME |
| `--sig-info` / `-bg` / `-bd` | `#2e90fa` / `#eff8ff` / `#b2ddff` | SAME |
| `--sig-neutral` / `-bg` / `-bd` | `#667085` / `#f2f4f7` / `#eaecf0` | SAME |

| Token | ref | app | Status |
|---|---|---|---|
| `--sheet-cream` | `#fffbf2` | **not a token** — hard-coded literal `#fffbf2` at `innovic-theme.css:847` and `#fffbf2`-equivalent nowhere else declared | NEW-in-ref (app has the value but not as a variable) |

### 1.4 Colours — semantic aliases (ref colors.css lines 48–62)

None of these alias names exist in `apps/web/src/styles/tokens.css` at all.

| Token | ref value (resolves to) | app | Status |
|---|---|---|---|
| `--surface-page` | `var(--bg)` | absent | NEW-in-ref |
| `--surface-card` | `var(--bg2)` | absent | NEW-in-ref |
| `--surface-sunken` | `var(--bg3)` | absent | NEW-in-ref |
| `--surface-hover` | `var(--bg4)` | absent | NEW-in-ref |
| `--surface-pressed` | `var(--bg5)` | absent | NEW-in-ref |
| `--text-body` | `var(--text)` | absent | NEW-in-ref |
| `--text-secondary` | `var(--text2)` | absent | NEW-in-ref |
| `--text-muted` | `var(--text3)` | absent | NEW-in-ref |
| `--text-link` | `var(--blue)` | absent | NEW-in-ref |
| `--accent` | `var(--blue)` | absent | NEW-in-ref |
| `--accent-hover` | `var(--blue2)` | absent | NEW-in-ref |
| `--accent-wash` | `var(--blue3)` | absent | NEW-in-ref |
| `--border-default` | `var(--border)` | absent | NEW-in-ref |
| `--border-strong` | `var(--border2)` | absent | NEW-in-ref |

### 1.5 Typography — fonts

| Token | ref | app | Status |
|---|---|---|---|
| `--hfont` | `'Barlow Condensed', sans-serif` | `'Barlow Condensed', sans-serif` | SAME |
| `--bfont` | `'Barlow', sans-serif` | `'Barlow', sans-serif` | SAME |
| `--mono` | `'Source Code Pro', monospace` | `'Source Code Pro', monospace` | SAME |
| `--font-display` | `var(--hfont)` | absent | NEW-in-ref |
| `--font-body` | `var(--bfont)` | absent | NEW-in-ref |
| `--font-code` | `var(--mono)` | absent | NEW-in-ref |

Webfont `@import` URL in `design-ref/tokens/fonts.css:2` is byte-identical to the `<link href>` in
`apps/web/index.html:17` (same family list: Barlow 400/500/600/700/800, Barlow Condensed 700/800,
Source Code Pro 400/600/700, Public Sans 400/600/700, JetBrains Mono 400/600/700). SAME.

### 1.6 Typography — the 5-step scale (see §2 for the density analysis)

| Token | ref value | app equivalent | Status |
|---|---|---|---|
| `--fs-xs` | `11px` | no such named step exists in app tokens.css | NEW-in-ref |
| `--fs-sm` | `13px` | no such named step exists in app tokens.css | NEW-in-ref |
| `--fs-md` | `16px` | no such named step exists in app tokens.css | NEW-in-ref |
| `--fs-lg` | `22px` | no such named step exists in app tokens.css | NEW-in-ref |
| `--fs-xl` | `28px` | no such named step exists in app tokens.css | NEW-in-ref |
| `--fs-body` | `var(--fs-sm)` = `13px` | `14px` (literal) | **CHANGED (14→13)** |
| `--fs-control` | `var(--fs-sm)` = `13px` | `13px` (literal) | SAME value, different mechanism (literal vs. alias) |
| `--fs-label` | `var(--fs-xs)` = `11px` | `11px` (literal) | SAME value |
| `--fs-mono` | `var(--fs-xs)` = `11px` | `11px` (literal) | SAME value |
| `--fs-heading` | `var(--fs-md)` = `16px` | `17px` (literal) | **CHANGED (17→16)** |
| `--fs-section` | `var(--fs-lg)` = `22px` | `22px` (literal) | SAME value |
| `--fs-stat` | `var(--fs-xl)` = `28px` | `28px` (literal) | SAME value |

### 1.7 Spacing / control heights / field widths (design-ref/tokens/spacing.css)

None of the following exist as named tokens in `apps/web/src/styles/tokens.css`. The app has no
spacing scale, no control-height token, and no field-width tokens at all — every padding/height/width
in `innovic-theme.css` is a raw px literal (see §4).

| Token | ref value | app | Status |
|---|---|---|---|
| `--sp-0` | `2px` | absent | NEW-in-ref |
| `--sp-1` | `4px` | absent | NEW-in-ref |
| `--sp-2` | `8px` | absent | NEW-in-ref |
| `--sp-3` | `12px` | absent | NEW-in-ref |
| `--sp-4` | `16px` | absent | NEW-in-ref |
| `--sp-5` | `24px` | absent | NEW-in-ref |
| `--sp-6` | `32px` | absent | NEW-in-ref |
| `--control-h` | `28px` | absent (buttons/inputs sized by padding, not a height token) | NEW-in-ref |
| `--control-h-sm` | `24px` | absent | NEW-in-ref |
| `--field-xs` | `64px` | absent | NEW-in-ref |
| `--field-sm` | `104px` | absent | NEW-in-ref |
| `--field-md` | `144px` | absent | NEW-in-ref |
| `--field-lg` | `224px` | absent | NEW-in-ref |

### 1.8 Radii

| Token | ref | app | Status |
|---|---|---|---|
| `--radius-sm` | `4px` | `4px` | SAME |
| `--radius` | `6px` | `6px` | SAME |
| `--radius2` | `8px` | `8px` | SAME |
| `--radius-menu` | `10px` | absent — app hard-codes `border-radius: 10px` on `.tn-menu` (`innovic-theme.css:181`) instead of a token | NEW-in-ref |

### 1.9 Layout

| Token | ref | app | Status |
|---|---|---|---|
| `--sidebar-width` | `220px` | `220px` | SAME (value only — the sidebar itself is dead chrome in the current app, see §6) |
| `--topbar-height` | `48px` | `54px` | **CHANGED (54→48)** |
| `--content-pad` | `var(--sp-4)` = `16px` | absent — app hard-codes `padding: 0 20px 20px` on `#main > #content` (`innovic-theme.css:370`, duplicated in `index.css:103`) | NEW-in-ref, and the ref value (16px) is narrower than the app's shipped 20px |
| `--panel-gap` | `var(--sp-2)` = `8px` | absent — app hard-codes `.panel{margin-bottom:10px}` (`innovic-theme.css:606`, a deliberate density pass from 16px) | NEW-in-ref, and differs from the app's current 10px |

### 1.10 Effects / shadows

Byte-identical values in both files:

| Token | value | Status |
|---|---|---|
| `--focus-ring` | `rgba(21, 94, 239, 0.15)` | SAME |
| `--overlay-bg` | `rgba(23, 43, 77, 0.45)` | SAME |
| `--shadow-modal` | `0 8px 24px rgba(23, 43, 77, 0.12)` | SAME |
| `--shadow-toast` | `0 4px 12px rgba(23, 43, 77, 0.15)` | SAME |
| `--shadow-drawer` | `4px 0 20px rgba(23, 43, 77, 0.15)` | SAME |

Note: `innovic-theme.css:182` uses `var(--shadow-drawer, 0 10px 30px rgba(20, 28, 40, 0.16))` — a
CSS fallback value that is never actually exercised (the var is always defined) but the fallback
literal disagrees with the token itself. Cosmetic dead code, worth deleting when this file is touched.

### 1.11 Motion

| Token | ref | app | Status |
|---|---|---|---|
| `--ease-fast` | `0.15s` | absent — app hard-codes `0.15s`/`.15s` as a literal in at least 5 places: `innovic-theme.css:414` (`.sb-section` transition, dead code), `:474` (`.sb-item`, dead code), `:661/668` (`.dash-surface`, `.dash-link.dash-cell`), `:1099` (`.btn`), `:1206` (`.innovic-input`/select/textarea focus transition) | NEW-in-ref |

---

## 2. Typography scale change

The ref collapses every font-size in the system onto exactly 5 steps — `--fs-xs 11 / --fs-sm 13 /
--fs-md 16 / --fs-lg 22 / --fs-xl 28` — and every role alias (`--fs-body`, `--fs-control`, etc.) is
required to resolve to one of those 5 values. The app's `tokens.css` already has the same *role alias
names*, but each is a hand-set literal, and two of the seven disagree with what the 5-step scale would
produce:

- **`--fs-body`: `14px` → `13px`.** This is the single biggest density change in the whole
  audit — `--fs-body` drives `body{font-size:var(--fs-body)}` in both `index.css:73` and the (dead)
  `.innovic-body` rule in `innovic-theme.css:24`, i.e. it is the default text size for the entire
  app unless a component overrides it. Dropping it to 13px tightens every unstyled block of body
  copy by ~7%.
- **`--fs-heading`: `17px` → `16px`.** `--fs-heading` is not actually consumed anywhere as a
  variable in the current `innovic-theme.css` — `.panel-title` (line 619) and `.modal-title` (line
  1277) both hard-code `font-size: 16px` / `17px` respectively rather than referencing the token (see
  the mismatch below). The ref's `--fs-heading` becomes exactly what `.panel-title` already renders
  today (16px); `.modal-title`'s literal 17px would need to drop to 16px to comply.
- `--fs-control`, `--fs-label`, `--fs-mono`, `--fs-section`, `--fs-stat` are numerically unchanged
  (13 / 11 / 11 / 22 / 28 respectively) — only their *mechanism* changes, from a flat literal to an
  alias that resolves through the 5-step scale.

### Every hard-coded font-size in `innovic-theme.css` that is NOT one of the 5 allowed values (11 / 13 / 16 / 22 / 28)

| Line | Selector | Value | Note |
|---|---|---|---|
| 151 | `.tn-item` | `12.5px` | nav module buttons |
| 168 | `.tn-caret` | `9px` | dropdown caret glyph |
| 201 | `.tn-col-label` | `10px` | nav menu column heading |
| 261 | `.tn-avatar` | `12px` | header avatar initials |
| 308 | `.pgtab` | `12px` | open-page tab label |
| 350 | `.pgtab-close` | `14px` | tab close "×" |
| 502 | `.sb-icon` | `14px` | **dead code** — `.sb-*` sidebar classes are unreferenced by any `.tsx` (see §6) |
| 532 | `.sb-uname` | `12px` | **dead code** (sidebar) |
| 554 | `.tb-title` | `20px` | **dead code** — `.tb-*` topbar-split classes are unreferenced (superseded by `#topnav`, see §6) |
| 883 | `.td-code` | `12px` | mono code cell (ref's `.td-code` uses `var(--fs-sm)` = 13px instead — see §3) |
| 1277 | `.modal-title` | `17px` | would become 16px under the ref's `--fs-heading` |
| 1361 | `.empty-icon` | `36px` | empty-state glyph (ref's `.empty-icon` uses `var(--fs-xl)` = 28px instead — see §3) |
| 1519 | `.innovic-input.gs-input` | `12px` | header global-search box text |

Every other font-size in the file (11px / 13px / 16px / 20px-as-`.tb-title`-only-listed-above /
22px / 28px literal, plus every `var(--fs-*)` reference) already lands on an allowed step or is one
of the two role-alias values changing above.

---

## 3. Class-by-class diff — `design-ref/tokens/components.css` vs `apps/web/src/styles/innovic-theme.css`

`components.css` states in its own header (line 1) that it is a **"condensed port"** of
`innovic-theme.css` — so it is expected to be a subset. Line numbers below are `ref:L / app:L`.

### Panels

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.panel` | Y (5) | Y (599) | ref: `border-radius:var(--radius2);overflow:hidden;margin-bottom:8px`. app: **`margin-bottom:10px`** (10, not 8 — app comment at 604 calls this a deliberate "density pass" from an original 16px; ref's 8px is denser still). |
| `.panel-hdr` | Y (6) | Y (608) | ref: `padding:8px 12px`. app: **`padding:8px 14px`** (app comment at 612 notes this was intentionally widened from 12px). |
| `.panel-title` | Y (7) | Y (617) | ref: `font-size:var(--fs-md)` (token). app: **`font-size:16px`** (literal, same number, no token). |
| `.panel-body` | Y (8) | Y (627) | ref: `padding:12px`. app: **`padding:12px`** — SAME (app comment says this was already reduced from 16px). |
| `.section-hdr` | Y (9) | Y (1369) | ref: `font-size:var(--fs-section);margin-bottom:12px;line-height:1.2`. app: `font-size:var(--fs-section)` SAME token, but **`margin-bottom:16px`** (not 12) and **no `line-height`** declared at all. |

### Clickable surfaces (dash-link)

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.dash-link` | Y (12) | Y (641) | identical rules. |
| `.dash-link:focus-visible` | Y (13) | Y (647) | identical. |
| `.dash-link:hover .dash-surface, :focus-visible .dash-surface` | Y (14) | Y (653) | identical. |
| `.dash-surface` | Y (15) | Y (658) | identical (`transition:background .15s,border-color .15s`). |
| `.dash-link.dash-cell` (+ `:hover`) | Y (16-17) | Y (666-672) | identical. Ref drops the app's `@media (prefers-reduced-motion: reduce)` block (app:673-678) — not a visual diff, an a11y regression if dropped wholesale. |

### Stat cards

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.stat-grid` | Y (20) | Y (681) | ref: `gap:8px;margin-bottom:12px`. app: **`gap:12px;margin-bottom:16px`** — CHANGED, denser in ref. |
| `.stat-card` | Y (21) | Y (687) | ref: `padding:8px 12px`. app: **`padding:12px 14px`** — CHANGED, denser in ref. |
| `.stat-card::after` + `.cyan/.amber/.green/.red` | Y (22-23) | Y (695-714) | identical rules. Neither defines `.stat-card.blue` — app has a code comment (715-718) explicitly documenting this omission matches legacy; ref is silent but matches by omission too. |
| `.stat-label` | Y (24) | Y (719) | ref: `margin-bottom:4px`. app: **`margin-bottom:6px`** — CHANGED. |
| `.stat-val` | Y (25) | Y (727) | identical. |
| `.stat-sub` | Y (26) | Y (733) | identical (`margin-top:4px`). |

### Tables

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.tbl-wrap` | Y (29) | Y (740) | ref has no `max-height`. app adds **`max-height:calc(100vh - 220px)`** (740-743) — a real behavioural difference, not just a value tweak. |
| `.innovic-table` | Y (30) | Y (746) | identical. |
| `.innovic-table th` | Y (31) | Y (750) | ref: `padding:4px 8px`. app: **`padding:6px 10px`** — CHANGED, denser in ref (app comment at 756 says this was already reduced once from 9px 12px). |
| `.innovic-table th:hover` | Y (32) | Y (771) | identical. |
| `.innovic-table td` | Y (33) | Y (774) | ref: `padding:4px 8px;text-align:center`. app: **`padding:6px 10px`**, and app's base `.innovic-table td` has **no `text-align`** at all (centring is bolted on separately via the "TABLE-ALIGNMENT STANDARD" block at app:891-923, a `.innovic-table th,.innovic-table td{text-align:center}` rule). Ref folds that directly into the base rule. |
| `.innovic-table tbody tr:hover td` | Y (34) | Y (782) | identical. |
| `.innovic-table.tbl-grid` | Y (35) | Y (793) | identical. |
| `.innovic-table.tbl-grid.tbl-auto` | Y (37, `th{white-space:nowrap}`) | app has the auto-layout rule at 203 but table-layout switch differs slightly — see "unified table" block below | see UNIFIED TABLE section |
| `.innovic-table.tbl-grid th` | Y (36) | Y (798) | ref: `padding:4px 8px;border-bottom:1px solid var(--blue2);white-space:normal;line-height:1.25`. app: **`padding:8px 8px`**, **no `white-space`/`line-height` override** (headers stay `nowrap` from the base `.innovic-table th` rule, contradicting the sheet's own "wrap long header" intent), and app has no `.tbl-grid.tbl-auto th{white-space:nowrap}` companion rule (ref line 37) at all. |
| `.innovic-table.tbl-grid th:last-child` / `td:last-child` no border-right | Y (38, combined) | Y — split as 812 (`th:last-child`) and 828 (`td:last-child`) | ref merges into one selector `th:last-child,td:last-child`; app writes them as two separate rules with identical bodies — same effect. |
| `.innovic-table.tbl-grid td` | Y (39) | Y (815) | ref: `font-size:var(--fs-sm)` (token, 13px). app: **`font-size:13px`** literal — same number, no token. |
| `.innovic-table.tbl-grid tbody tr td` (base bg) | Y (40) | Y (843) | identical. |
| `.innovic-table.tbl-grid tbody tr:nth-child(odd) td` | Y (41, `var(--sheet-cream)`) | Y (846) | ref uses the **token** `var(--sheet-cream)`; app uses the **literal** `#fffbf2` — same colour, no token (see §1.3/§4). |
| `.innovic-table.tbl-grid tbody tr:hover td` | Y (42) | Y (849) | identical. |
| `.innovic-table.tbl-grid .td-code` | Y (43) | Y (852) | ref: `font-size:var(--fs-sm)`. app: **`font-size:13px`** literal. |
| `.innovic-table.tbl-grid .btn-sm` | Y (44) | Y (857) | identical values (`border:1px solid var(--border3);background:var(--bg2)`), but app additionally sets `padding:3px 9px;font-size:11px;font-weight:700` inline on the same rule rather than composing with the base `.btn-sm` — ref expresses `.btn-sm` overrides once at the base and expects `.tbl-grid .btn-sm` to only add `font-weight:700;border;background`. Functionally close, structurally different. App also has a `.tbl-grid .btn-sm.btn-primary` rule (864-868) the ref condensed file doesn't carry. |
| `.td-code` | Y (45) | Y (880) | ref: `font-size:var(--fs-sm)` (13px token). app: **`font-size:12px`** literal — **CHANGED value**, not just mechanism. |
| `.td-right` / `.td-ctr` | Y (46) | Y (885-890) | identical. |

### Unified table modifiers (`tbl-frozen` / `tbl-compact` / `tbl-edit` / `tbl-auto` / `row-selected` / `th-left`/`td-left` / `th-right`/`td-num`)

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.tbl-frozen ...` (4 rules) | Y (199-202) | Y — but as the OLDER, simpler `.tbl-frozen tbody td:first-child` / `thead th:first-child` pair (925-946), not composed with `.innovic-table.tbl-grid` | **app is missing** the ref's `.tbl-frozen .innovic-table.tbl-grid tbody tr td:first-child` / `:nth-child(odd) td:first-child` / `:hover td:first-child` / `thead th:first-child` selectors entirely — app's frozen-column rule does not account for the cream-row alternation inside `.tbl-grid`, so a frozen first column on a `.tbl-grid` sheet table would NOT pick up the odd-row cream background, only the plain table's white. |
| `.tbl-grid.tbl-auto` | Y (203-204) | **N** — app has no `.innovic-table.tbl-grid.tbl-auto{table-layout:auto}` rule at all | app only has the plain (non-grid) auto-width note at components.css:37 equivalent — **missing from app entirely.** |
| `.tbl-grid.tbl-compact` | Y (205-206) | **N** — absent | NEW-in-ref, no app equivalent. |
| `.tbl-grid.tbl-edit` | Y (207-208) | **N** — absent | NEW-in-ref, no app equivalent. |
| `.tbl-grid tbody tr.row-selected td` | Y (209) | **N** — absent | NEW-in-ref, no app equivalent. |
| `.tbl-grid tbody tr.qc-alert-blink td{background:transparent}` | Y (210) | **N** — absent (app's `.qc-alert-blink` at 1493 has no `.tbl-grid` interaction rule) | NEW-in-ref. |
| `.tbl-grid th.th-left/td.td-left` / `th.th-right/td.td-num` | Y (211-212) | **N** — absent | NEW-in-ref, app has no left/right column-alignment escape hatch for the centred-by-default sheet table. |

### Badges + tags

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.badge` | Y (49) | Y (1021) | identical property set, but ref explicitly writes `border:1px solid transparent` **on `.badge` itself** (line 49); app puts the `border:1px solid transparent` on **each `.b-*` variant individually** (1038, 1043, 1048, 1053, 1058, 1063, 1068, 1075, 1082) rather than once on the base class. Same rendered result, more repetition in app. |
| `.b-green` / `.b-amber` / `.b-blue` / `.b-red` / `.b-grey` / `.b-cyan` / `.b-orange` / `.b-teal` / `.b-purple` | Y (50-58) | Y (1035-1083) | identical colour pairs. |
| `.tag` | Y (59) | Y (979) | ref: `padding:2px 8px;font-size:var(--fs-xs)`. app: **`padding:1px 6px;font-size:11px`** literal — CHANGED padding, same font-size value via literal not token. |

### Buttons

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.btn` | Y (62) | Y (1086) | ref: `height:var(--control-h);padding:0 12px;gap:4px;line-height:1.3`. app: **no explicit `height`** at all (sized by `padding:7px 12px` implying a taller ~32px control), **`gap:6px`** (not 4), **no `line-height`** override. This is a real sizing change: ref buttons are a fixed 28px tall; app buttons float to whatever `7px 12px` + font produces (~30–32px). |
| `.btn-primary` (+`:hover`) | Y (63) | Y (1102-1108) | identical colours; ref's `:hover` rule also re-states `color:#fff`, app's hover rule omits it (inherits, same visual result). |
| `.btn-success` (+`:hover`) | Y (64) | Y (1109-1115) | identical. |
| `.btn-danger` (+`:hover`) | Y (65) | Y (1116-1122) | identical. |
| `.btn-ghost` (+`:hover`) | Y (66-67) | Y (1123-1132) | identical. |
| `.btn-sm` | Y (68) | Y (1133) | ref: `height:var(--control-h-sm);padding:0 8px;font-size:var(--fs-xs)`. app: **`padding:4px 10px;font-size:var(--fs-label)`** (11px, same numeric value as `--fs-xs` but via a different alias), **no explicit height** — same "floats vs. fixed 24px" gap as `.btn`. |
| `.btn-icon` | Y (69) | Y (1137) | ref: `padding:0 8px`. app: **`padding:6px 8px`** — CHANGED. |
| `.btn:disabled` | Y (70) | Y (1140) | identical. |

### Forms

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.form-grid-12`, `.f-xs/.f-sm/.f-md/.f-lg/.f-full`, the `@container` breakpoint | Y (73-80) | **N — entirely absent from app** and from every `.tsx` (grepped, zero matches for `form-grid-12`, `f-xs`, `f-sm`, `f-md`, `f-lg`, `f-full`) | **NEW-in-ref, not adopted anywhere.** This is the ref's replacement 12-column content-aware form grid; the app has never used it. |
| `.form-grid` (legacy 2-up) | Y (82, "LEGACY … read-only ReadGrid and un-migrated markup only") | Y (1146) | ref: `gap:8px 12px`. app: **`gap:12px`** (single value = 12px both axes) — CHANGED, ref is tighter vertically. |
| `.form-grid-3` | Y (83) | Y (1151) | same gap discrepancy as `.form-grid` (ref `8px 12px` vs app `12px`). |
| `.form-grid-4` | Y (84) | Y (1159) | same gap discrepancy. Ref does NOT carry the app's `@media (max-width:1100px){.form-grid-4{grid-template-columns:1fr 1fr}}` responsive fold (app:1169-1173) — dropped in the condensed ref, but likely still needed. |
| `.form-span-2` / `.form-full` | Y (85, combined line) | Y — split as `.form-span-2` (1164) and `.form-full` (1174) | same values, different formatting only. |
| `.form-grp` | Y (86) | Y (1177) | identical. |
| `.form-label` | Y (87) | Y (1182) | identical. |
| `.form-label .req` | Y (88) | Y (1190) | identical. |
| `.innovic-input, .innovic-select, .innovic-textarea` | Y (89) | Y (1194) | ref: `padding:0 8px;height:var(--control-h);box-sizing:border-box`. app: **`padding:7px 10px`, no explicit `height`, no `box-sizing` override** (inherits the global `*{box-sizing:border-box}` from `index.css`, so that part is equivalent) — but again the fixed-28px-height vs. floats-by-padding gap. |
| `.innovic-textarea` (separate override) | Y (90) | **N — app has no separate `.innovic-textarea` block**; textarea sizing is whatever the shared `.innovic-input,.innovic-select,.innovic-textarea` rule gives it | ref explicitly overrides textarea to `height:auto;min-height:calc(var(--control-h)*2);resize:vertical;max-height:240px` — **app textareas currently inherit the single-line `height` behaviour of inputs with no min/max-height or resize control.** Real functional gap. |
| `.fw-xs/.fw-sm/.fw-md/.fw-lg` | Y (91) | **N — absent, zero `.tsx` matches** | NEW-in-ref, unused today. |
| `.innovic-input:focus,...` | Y (92) | Y (1208) | identical. |
| `.innovic-input[readonly]` | Y (93) | Y (1214) | identical. |
| `.form-error` | Y (94) | Y (1218) | identical. |
| `.form-help` | Y (95) | Y (1223) | identical. |

### Modal

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.overlay` | Y (98) | Y (1230) | identical. |
| `.modal` | Y (99) | Y (1243) | identical (`max-width:min(1100px,96vw)`, `min-height:min(86vh,640px)`, `max-height:96vh`, `box-shadow:var(--shadow-modal)`). |
| `.modal-hdr` | Y (100) | Y (1267) | ref: `padding:8px 16px`. app: **`padding:12px 16px`** — CHANGED, denser in ref. |
| `.modal-title` | Y (101) | Y (1275) | ref: `font-size:var(--fs-md)` (16px token). app: **`font-size:17px`** literal — CHANGED value + no token. |
| `.modal-body` | Y (102) | Y (1280) | identical (`padding:16px`). |
| `.modal-footer` | Y (103) | Y (1283) | ref: `padding:8px 16px`. app: **`padding:12px 16px`** — CHANGED, denser in ref. |
| `.modal-lg` | Y (163, "additional product classes" section) | Y (1264) | identical (`max-width:min(1320px,96vw)`). |
| `.app-sheet` | Y (164) | Y (1257) | identical. |

### Toast

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.toast-item` | Y (106) | Y (1303) | ref: `padding:8px 12px`. app: **`padding:10px 16px`** — CHANGED, denser in ref. |
| `.toast-ok` / `.toast-err` / `.toast-info` | Y (107-109) | Y (1315-1328) | identical. |
| `@keyframes toastSlideIn` | Y (110) | Y (1330) | identical. |
| `#toast` (the fixed positioning wrapper) | **N — ref has no `#toast` rule at all** | Y (1293-1301) | app-only; **but** grepping `.tsx` for `id="toast"` returns zero matches — likely dead/replaced by a toast library (e.g. a `Toaster` component) already, so its absence from ref may be intentional cleanup rather than an oversight. |

### Progress, empty, divider

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.prog-wrap` | Y (113) | Y (1342) | identical. |
| `.prog-bar` | Y (114) | Y (1348) | identical. |
| `.empty-state` | Y (115) | Y (1355) | ref: `padding:32px`. app: **`padding:40px`** — CHANGED. |
| `.empty-icon` | Y (116) | Y (1360) | ref: `font-size:var(--fs-xl)` (28px token). app: **`font-size:36px`** literal — CHANGED value + no token. |
| `.divider` | Y (117) | Y (1364) | ref: `margin:12px 0`. app: **`margin:16px 0`** — CHANGED. |

### Sync dot

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.sync-dot` | Y (120) | Y (584) | identical. |
| `.sync-dot.offline` / `.sync-dot.error` | Y (121-122) | Y (590-596) | identical. |

### Nav / header chrome (`#topnav`, `.tn-*`)

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `#topnav,.topnav` | Y (125) | app has **`#topnav` only**, no `.topnav` class alias (102) | ref: `min-height:var(--topbar-height)` (48px), `padding:0 12px`. app: same min-height token but resolves to **54px** (§1.9), plus app adds `gap:0` explicitly (108, ref omits `gap` on this rule but sets it per-child). |
| `.tn-logo` (+`img`) | Y (126-127) | Y (126-136) | ref: `margin-right:8px`. app: **`margin-right:10px`** — CHANGED. |
| `.tn-sec` | Y (128) | Y (137) | identical. |
| `.tn-item` | Y (129) | Y (141) | ref: `gap:4px;height:32px;border-radius:var(--radius)` (6px), `font-size:var(--fs-sm)` (13px token). app: **`gap:5px;height:36px;border-radius:8px`** literal, **`font-size:12.5px`** literal — three simultaneous CHANGES (bigger pill, more rounded, smaller/off-scale text). |
| `.tn-item:hover` | Y (130) | Y (158) | identical. |
| `.tn-item.active` | Y (131) | Y (162) | identical. |
| `.tn-caret` | Y (132) | Y (167) | ref: `font-size:var(--fs-xs)` (11px token). app: **`font-size:9px`** literal — CHANGED + off-scale. |
| `.tn-menu` | Y (133) | Y (171) | ref: `padding:8px 4px;border-radius:10px` (raw, matches `--radius-menu` value but as a literal in ref too — the ref file itself doesn't consume its own `--radius-menu` token here). app: **`padding:10px 6px`** — CHANGED. |
| `.tn-menu.flip` | Y (134) | Y (189) | identical. |
| `.tn-col` | Y (135) | Y (193) | identical (`min-width:200px;padding:4px 8px`). |
| `.tn-col+.tn-col` | Y (136) | Y (197) | identical. |
| `.tn-col-label` | Y (137) | Y (200) | ref: `font-size:var(--fs-xs)` (11px token), `padding:4px 8px 4px`. app: **`font-size:10px`** literal (off-scale), **`padding:4px 10px 6px`** — CHANGED. |
| `.tn-link` | Y (138) | Y (208) | ref: `padding:4px 8px;min-height:var(--control-h)` (28px), `font-size:var(--fs-sm)` (13px token). app: **`padding:7px 10px`, no `min-height`**, **`font-size:13px`** literal — CHANGED padding/height mechanism. |
| `.tn-link:hover` | Y (139) | Y (219) | ref also sets `color:var(--text)` on hover; app's hover rule (219-221) only changes `background`, no explicit color change (relies on inherited `.tn-link{color:var(--text)}` already being the color, so same rendered result). |
| `.tn-link.on` | Y (140) | Y (222) | identical. |
| `.tn-link-icon` | Y (141) | Y (227) | identical. |
| `.tn-right` | Y (142) | Y (232) | identical. |
| `.tn-iconbtn` | Y (143) | Y (247) | identical. |
| `.tn-avatar` | Y (144) | Y (251) | ref: `font-size:var(--fs-xs)` (11px token). app: **`font-size:12px`** literal — CHANGED + off-scale. App also adds `cursor:default` (262) the ref doesn't carry — cosmetic only. |
| `.tn-sync` | **N — absent from ref entirely** | Y (242-246) | **app-only class, would lose all styling** (`display:inline-flex;align-items:center;padding:0 2px`) if `innovic-theme.css` were dropped in favour of the ref file verbatim — see §6. |

### Open-page tabs / breadcrumbs

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.pagetabs` (ref) vs `#pagetabs` (app) | Y, as **class** `.pagetabs` (147) | app renders it as **`id="pagetabs"`** (`open-tabs-bar.tsx:72`) styled via `#pagetabs` (292) | **Selector-type mismatch** — see §6, this is a real breakage risk, not just a value diff. Values: ref `padding:4px 16px 0`; app `padding:3px 20px 0` — CHANGED regardless. |
| `.pgtab` | Y (148) | Y (301) | ref: `gap:4px;padding:4px 4px 4px 8px;font-size:var(--fs-xs)` (11px token), `border-radius:6px 6px 0 0`. app: **`gap:6px;padding:3px 6px 3px 10px;font-size:12px`** literal (off-scale) — CHANGED. |
| `.pgtab:hover` | Y (149) | Y (323) | identical. |
| `.pgtab.active` | Y (150) | Y (327) | identical (`border-top:2px solid var(--blue);padding-top:2px`). |
| `.pgtab-label` | Y (151) | Y (334) | identical. |
| `.pgtab-icon` | **N — absent from ref** | Y (320-322, `flex-shrink:0` only) | app-only, minor; would lose its one declaration if swapped wholesale, low visual impact (`flex-shrink:0`). |
| `.pgtab-close` | Y (152) | Y (340) | ref: `width:16px;height:16px;font-size:var(--fs-sm)` (13px token). app: **`font-size:14px`** literal — CHANGED + off-scale. |
| `.pgtab-close:hover` | Y (153) | Y (355) | identical. |
| `.breadcrumbs` (ref) vs `#breadcrumbs` (app) | Y, as **class** (154) | app renders it as **`id="breadcrumbs"`** (`breadcrumbs.tsx:64`) styled via `#breadcrumbs` (276) | **Same selector-type mismatch as pagetabs** — see §6. Values: ref `padding:4px 16px 0`; app `padding:5px 20px 0` — CHANGED regardless. |
| `.breadcrumbs>*` | Y (155) | **N — no equivalent rule in app** (app relies on child elements' own layout, no explicit `white-space:nowrap;flex-shrink:0` on breadcrumb children) | ref-only addition. |

### Utilities

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.mono` | Y (158) | Y (1378) | identical. |
| `.fw-700` | Y (158) | Y (1381) | identical. |
| `.text2` / `.text3` | Y (159) | Y (1384-1389) | identical. |
| `.cyan` / `.amber` / `.green` / `.red` | Y (160) | Y (1390-1403) | identical (all use the dark "2" text-safe variants for `.amber/.green/.red`; `.cyan` alone stays solid — matches in both). |

### Misc / product-specific

| Class | in ref? | in app? | Differences |
|---|---|---|---|
| `.tbl-frozen ...` | see "Unified table modifiers" above | | |
| `table.tbl-ctr` | Y (168) | Y (909, combined into the alignment-standard selector list) | identical effect. |
| `.innovic-table td .innovic-input, .innovic-select` (centre text) | Y (169) | Y (916-922, combined with `.ops-routing`/`table.tbl-ctr` in one selector) | identical effect. |
| `.ops-routing` (+`th`/`td`) | Y (170-172) | Y (994-1018) | ref: `padding:4px 8px`. app: **`padding:8px 12px`** — CHANGED, denser in ref. |
| `.task-unread` | Y (173) | Y (954) | ref: `margin-right:4px`. app: **`margin-right:6px`** — CHANGED. |
| `.task-linked-ref` | Y (174) | Y (964) | ref: `font-size:var(--fs-xs)`, `padding:2px 4px`. app: **`font-size:11px`** literal (same value, off-token), **`padding:1px 6px`** — CHANGED padding. |
| `@keyframes qcBlink` / `.qc-alert-blink` | Y (175-176) | Y (1484-1496) | identical. |
| `.gs-wrap` | Y (177) | Y (1503) | identical. |
| `.gs-icon` | Y (178) | Y (1507) | ref: `left:8px`. app: **`left:9px`** — CHANGED (1px). |
| `.innovic-input.gs-input` | Y (179, `width:var(--field-lg);padding:0 8px 0 28px`) | Y (1515, `width:260px;height:32px;padding:6px 10px 6px 28px;font-size:12px`) | ref ties width to the new `--field-lg` token (224px) and has no explicit height/font-size override (inherits the 28px-tall base input). app hard-codes **`width:260px`** (not 224), **explicit `height:32px`**, **`font-size:12px`** literal (off-scale) — three simultaneous CHANGES. |
| `.innovic-input[type=file]` | Y (180) | **N — absent from app's `innovic-theme.css`** | ref-only addition (no evidence either way whether any `.tsx` renders a raw file input relying on this). |
| `.innovic-input:disabled, ...` | Y (181) | **N — absent** | ref-only addition; app has no disabled-state styling for inputs/selects/textareas at all today. |
| `.innovic-input.is-ok` / `.is-bad` | Y (182) | **N — absent** | ref-only addition. |
| `.innovic-input.is-derived` | Y (183) | **N — absent** | ref-only addition. |
| `input[type=checkbox],input[type=radio]` | Y (184) | **N — absent** | ref-only addition (no native checkbox/radio accent-color styling in app today). |
| `.check-row` | Y (185) | **N — absent** | ref-only addition. |
| `.ss-list` / `.ss-opt` / `.ss-opt.hl` / `.ss-muted` | Y (186-189) | **N — absent entirely** | These look like the searchable-dropdown/type-ahead component's option list (per the `dropdown`/`searchable-field` skills used elsewhere in this project) — **entirely new class vocabulary, no app equivalent at all.** High-impact if the searchable-field pattern is meant to adopt these. |

**Classes the ref DROPPED (present in app, absent from ref's condensed `components.css`):**
`.innovic-body`, `#app-shell`, `#sidebar` + every `.sb-*` (10 classes/groups), `#app-header`,
`@media (max-width:1350px)` topnav responsive rule, `#topbar`, `.tb-left`, `.tb-title`, `.tb-right`,
`.tb-sync`, `#toast`, `.tn-sync`, `.pgtab-icon`, `.breadcrumbs>*` is the only ADD not drop — see
list above for that one, `#content`/`#main` shell rules, the entire `@media (max-width:768px)`
mobile fallback block, `.gs-overlay`/`.gs-results` search-popup rules, `jc-row-acts` compound
selector. Most of the sidebar/topbar ones are already dead code in the live app (§6 confirms via
grep), so the ref dropping them tracks reality rather than losing anything live.

**Classes the ref ADDED (absent from app entirely):** `.form-grid-12`, `.f-xs/.f-sm/.f-md/.f-lg/.f-full`
+ its `@container` breakpoint, `.fw-xs/.fw-sm/.fw-md/.fw-lg`, `.innovic-textarea` dedicated block,
`.tbl-grid.tbl-auto/.tbl-compact/.tbl-edit`, `.row-selected`, `.th-left/.td-left/.th-right/.td-num`,
`.innovic-input[type=file]`, `:disabled` states, `.is-ok/.is-bad/.is-derived`,
`input[type=checkbox]/[type=radio]`, `.check-row`, `.ss-list/.ss-opt/.ss-opt.hl/.ss-muted`,
`.breadcrumbs>*`.

---

## 4. Hard-coded values in `innovic-theme.css` the ref replaces with a token

### 4.1 Raw hex colours (every literal hex in the file)

| Line | Selector | Value | Ref equivalent |
|---|---|---|---|
| 528 | `.sb-avatar` | `color: #fff` | white text on solid fill — no dedicated token in either file (both use bare `#fff` for on-accent text; not a gap). Flagged only because the block is dead code (§6). |
| 847 | `.innovic-table.tbl-grid tbody tr:nth-child(odd) td` | `background: #fffbf2` | **`var(--sheet-cream)`** (ref components.css:41) — token exists in ref's colors.css but not in app's tokens.css at all (§1.3). |
| 867 | `.btn-primary` | `color: #fff` | same as above, not a gap (both files use bare `#fff`). |
| 1104 | `.btn-success` | `color: #fff` | not a gap. |
| 1111 | `.btn-danger` | `color: #fff` | not a gap. |
| 1118 | `.btn-ghost` — *(comment only, not a rule — the actual hex hits at 1104/1111/1118/1317/1322/1327 are all `color:#fff` on solid-fill elements)* | | |
| 1317 | `.toast-ok` | `color: #fff` | not a gap. |
| 1322 | `.toast-err` | `color: #fff` | not a gap. |
| 1327 | `.toast-info` | `color: #fff` | not a gap. |

**Net finding: there is exactly one real "hard-coded hex that should be a token" gap in the whole
file — line 847's `#fffbf2`, which should be `var(--sheet-cream)`.** Every other raw hex in the file
is a `#fff`/`#000`-style literal for on-solid text/icons, which the ref file does the same way (not a
token gap in either direction).

### 4.2 Raw px font-sizes not routed through a token (superset of §2's "off-scale" list — this list is every literal px font-size regardless of whether it happens to land on an allowed step)

All lines already enumerated in §2's table (151, 168, 201, 261, 308, 350, 502, 532, 554, 883, 1277,
1361, 1519), **plus** these which happen to numerically match a scale step but are still written as a
bare literal instead of `var(--fs-*)`:

| Line | Selector | Value | Token it should be |
|---|---|---|---|
| 216 | `.tb-title` *(dead code block, tb-*)* | `13px` | `var(--fs-sm)` |
| 619 | `.panel-title` | `16px` | `var(--fs-md)` |
| 803 | `.innovic-table.tbl-grid th` | `11px` | `var(--fs-xs)` |
| 816 | `.innovic-table.tbl-grid td` | `13px` | `var(--fs-sm)` |
| 853 | `.innovic-table.tbl-grid .td-code` | `13px` | `var(--fs-sm)` |
| 859 | `.innovic-table.tbl-grid .btn-sm` | `11px` | `var(--fs-xs)` |
| 395 | `.sb-sub` *(dead code)* | `11px` | `var(--fs-xs)` |
| 490 | `.sb-section` *(dead code)* | `var(--fs-label)` already a token — no gap | — |
| 526 | `.sb-avatar` *(dead code)* | `11px` | `var(--fs-xs)` |
| 536 | `.sb-urole` *(dead code)* | `11px` | `var(--fs-xs)` |
| 967 | `.task-linked-ref` | `11px` | `var(--fs-xs)` |
| 983 | `.tag` | `11px` | `var(--fs-xs)` |

### 4.3 Raw px spacing that maps onto the ref's `--sp-*` scale (2/4/8/12/16/24/32)

The app has no spacing scale at all, so effectively **every** `padding`/`margin`/`gap` declaration in
`innovic-theme.css` is a candidate. The full grep (§ tool output, ~140 hits) is too long to reproduce
per-line here without exceeding what's useful; the table below groups by the raw value and gives
representative line numbers plus the `--sp-*` token it would become:

| Raw value | `--sp-*` equivalent | Representative lines |
|---|---|---|
| `2px` | `--sp-0` | 701 (`.stat-card::after` height), 836 (`.tbl-grid` `.btn-sm` margin), 968/981 (badge/tag padding-y), 1024 (`.badge` padding-y) |
| `4px` | `--sp-1` | 195, 283 (padding-y in `4px 10px 6px`/`5px 20px 0` — mixed), 345/346 (`.pgtab-close` w/h), 400, 468 (padding-y in `9px 16px`), 495, 725, 736, 757/775 (table cell padding-y before ×10 scale), 876/877, 973, 1180, 1192, 1221, 1226 |
| `6px` (not on scale — nearest `--sp-1`=4 or `--sp-2`=8) | none exact — **off-scale gap** | 145 (`.tn-item` height — n/a, height not spacing), 173, 178, 211, 236, 280, 304, 307, 512, 579, 725 (margin-bottom), 757/775 (`6px 10px` td/th padding), 830 (n/a), 960, 1138, 1180, 1285, 1300, 1310, 1345, 1518 |
| `8px` | `--sp-2` | 178 (padding-x), 195, 211, 236, 384 (padding-b), 407, 410, 468 (padding-x), 495, 506, 512-513, 574, 613 (padding-y in ref-8), 629, 684, 691 (padding-x/y in `12px 14px`), 999/1010 (padding-x), 1024 (padding-x), 1089, 1201 (padding-x), 1287/1271 (padding-x) |
| `10px` (not on scale) | none exact — **off-scale gap**, nearest `--sp-2`=8 | 178 (padding-y), 206, 212, 240 (n/a width), 307, 383 (padding-l/r), 407 (padding-x), 468 (n/a), 757/775 (padding-x), 1092 (padding-x), 1201 (padding-x), 1518 (padding-x) |
| `12px` | `--sp-3` | 129 (n/a margin), 270, 383 (n/a), 550, 574, 606 (n/a margin-bottom=10 not 12), 613 (padding-x), 629, 684, 691 (padding-x), 806/822 (n/a border), 999/1010 (padding-y), 1024 (n/a), 1092 (padding-x), 1149/1154/1162, 1271/1287 (padding-x), 1304 (padding-x) |
| `14px` | none exact (14 is not `--sp-*`; closest is `--sp-3`=12 or `--sp-4`=16) — **off-scale gap** | 383 (n/a size, not spacing — skip), 613 (padding-x), 691 (padding-x) |
| `16px` | `--sp-4` | 281 (n/a), 383 (padding-l), 606 (n/a), 629 (padding, all sides), 685 (n/a margin-bottom), 1271/1287 (padding-y), 1281, 1304 (padding-y), 1362, 1367 (margin), 1373 |
| `20px` | none exact (nearest `--sp-4`=16 or `--sp-5`=24) — **off-scale gap, and this is the app's PRIMARY content gutter** | 283, 296, 370 (`#main > #content{padding:0 20px 20px}` — the page's main gutter, see §1.9), 431/434 (mobile breadcrumb/pagetabs padding), 1449 (`#main > #content` mobile), 1451/1452 (`#topbar` mobile) |
| `24px` | `--sp-5` | 1295/1296 (`#toast` position — dead code) |
| `32px` | `--sp-6` | none found as spacing (32px doesn't appear as padding/margin/gap in this file) |
| `40px` | none exact (nearest `--sp-6`=32) — **off-scale gap** | 1357 (`.empty-state` padding) |

**Headline finding for §4.3:** the app's single biggest layout constant — the page content gutter,
`padding: 0 20px 20px` on `#main > #content` (line 370, duplicated in `index.css:103`) — does not
land on the ref's spacing scale at all (`--sp-4`=16 or `--sp-5`=24, never 20). Swapping to
`var(--content-pad)` (which the ref sets to `var(--sp-4)` = 16px) would visibly narrow every page's
side margins by 4px, and the app's own code comments (lines 83, 365-368, 1420-1429) explicitly warn
that at least two pages (`so-status/routes/index.tsx`, `purchase-orders/components/po-form-css.ts`)
rely on the exact 20px value via a hard-coded `margin: 0 -20px -20px` full-bleed trick — changing the
gutter token without also touching those two files would misalign their bleed.

---

## 5. Tailwind

### 5.1 How `tailwind.config.ts` and `index.css` relate to the tokens today

- `index.css` imports `tokens.css` then `innovic-theme.css` **before** the three `@tailwind` directives
  (lines 6-11), then re-declares a **second, independent** set of CSS variables under `@layer base
  :root` (lines 42-61) — the shadcn HSL slots (`--background`, `--primary`, `--muted`, `--input`,
  `--ring`, etc.) — as **hand-derived HSL literals**, not `var()` references to the hex tokens. The
  file's own comment block (lines 18-40) documents that this is deliberate and fragile: any future
  edit to a colour in `tokens.css` requires manually recomputing the matching HSL triplet here, and it
  explicitly calls out `--border`/`--radius` as **excluded on purpose** because Tailwind hoists this
  `@layer base :root` after the imported `tokens.css`, so redefining either name here would silently
  shadow the real token with an invalid HSL string and break every `border` and `rounded-*` utility
  app-wide (documented as a bug that actually shipped once).
- `tailwind.config.ts` layers a **third, separate palette**: the `colors.innovic.*` namespace (lines
  58-88) is a set of **hard-coded literal hex values that do not match `tokens.css` at all** —
  e.g. `innovic.bg:'#f0f4f8'` vs. the real `--bg:#f5f7fa`; `innovic.text:'#1a2235'` vs. real
  `--text:#172b4d`; `innovic.cyan:'#0088bb'` vs. real `--cyan:#155eef` (a completely different hue —
  teal-ish cyan vs. Innovic blue). Same divergence in `colors.dept.*` and `colors.sig.*`. This is a
  **third source of truth, already stale**, not just theoretical drift.
- `tailwind.config.ts`'s `fontSize.innovic-*` scale (lines 116-123) is likewise a hand-copied, already
  wrong mirror of the token role sizes: `innovic-stat: ['32px', '34px']` vs. the real `--fs-stat: 28px`
  — an 4px discrepancy nobody has been fixing because almost nothing consumes it (see 5.2).
- `borderRadius.lg/md/sm` (lines 126-128) DO correctly reference `var(--radius)` — this part is wired
  right and matches the warning comment in `tokens.css`.

### 5.2 Are Tailwind utilities actually used in components? (grepped counts)

Out of **346** `.tsx` files under `apps/web/src`:

- **31 files (~9%)** have a `className` containing a generic Tailwind utility pattern
  (`bg-`, `text-`, `flex`, `grid-cols-`, `px-N`, `py-N`, `rounded-`, `gap-N`, `shadow-`).
- **272 files (~79%)** reference the `innovic-theme.css` custom-class vocabulary directly
  (`panel`, `btn-primary`, `btn-ghost`, `innovic-table`, `badge`, `form-grid`, `innovic-input`,
  `innovic-select`).
- Only **7 files** import a shadcn primitive from `@/components/ui/{button,card,badge,input,table}`.
- Only **4 files** use a shadcn semantic utility class (`bg-primary`, `text-primary`, `bg-secondary`,
  `bg-muted`, `bg-accent`, `bg-destructive`).
- Only **2 files** use the Tailwind `innovic.*`/`dept.*`/`sig.*` namespace utilities
  (`bg-innovic-*`, `text-innovic-*`, `bg-dept-*`, `bg-sig-*`) at all — i.e. the entire custom Tailwind
  colour extension in `tailwind.config.ts` (30+ named colours) is used in **2 out of 346 files.**

**Conclusion: Tailwind is present in the build but is not the app's real styling system.** The actual
system of record is the hand-written class vocabulary in `innovic-theme.css`, consumed as literal
`className="panel"` / `className="btn btn-primary"` strings. Tailwind's utility classes are a thin,
inconsistently-used overlay, and its custom colour/fontSize extensions are almost entirely dead and
already numerically wrong versus `tokens.css`.

### 5.3 What a "tokens in tailwind.config + CSS variables, single source of truth" setup would require

1. Delete or regenerate `tailwind.config.ts`'s `colors.innovic.*`, `colors.dept.*`, `colors.sig.*`
   literal hex blocks (lines 58-107) and `fontSize.innovic-*` (lines 115-123) — replace every literal
   with `var(--token-name)` (or drop the Tailwind-namespace duplication entirely, since 5.2 shows
   almost nothing consumes it, and let component code keep using the `.innovic-theme.css` classes).
2. If the ref's new tokens (`--sp-*`, `--control-h*`, `--field-*`, `--radius-menu`, `--content-pad`,
   `--panel-gap`, `--ease-fast`, the `--fs-xs..xl` scale) are adopted, `tailwind.config.ts` needs
   matching `spacing`/`fontSize`/`borderRadius`/`transitionDuration` entries wired to `var()` so a page
   could legitimately reach for `p-sp-2` / `h-control-h` / `w-field-lg` Tailwind utilities instead of
   only the hand-written classes — today no such Tailwind entries exist for any of the ref's new
   tokens.
3. The shadcn HSL remap in `index.css` (lines 42-61) would need to be regenerated by hand for every
   colour value that changes (at minimum `--bg` stays the same, but if `--text3`/`--sheet-cream`-style
   *new* tokens are added, and especially if any existing hex actually changes during the rebuild, the
   HSL triplets must be recomputed — there is no automated derivation today).
4. The `--border`/`--radius` exclusion documented in `tokens.css:12-19` and re-explained in
   `index.css:33-40` **still applies and is not touched by the ref** — the ref never defines
   `--background`/`--primary`/`--muted`/`--input`/`--ring`/`--border`/`--radius` names, so there is no
   new collision risk from the ref itself, but the existing landmine (never let a shadcn slot name
   leak into `tokens.css`) remains exactly as real as it is today and must be preserved by whoever
   edits these files next.

---

## 6. Risk list — swapping `innovic-theme.css` for the ref's `components.css`

### High risk — would visibly break on a straight swap

1. **`#breadcrumbs` and `#pagetabs` would lose ALL styling.** The ref only defines `.breadcrumbs` and
   `.pagetabs` as **classes**; the live components render them as **`id="breadcrumbs"`**
   (`breadcrumbs.tsx:64`) and **`id="pagetabs"`** (`open-tabs-bar.tsx:72`). An ID selector and a class
   selector with the same spelling do not match each other — dropping in the ref file verbatim would
   silently unstyle the breadcrumb trail and the open-page tab strip (no padding, no border, no font
   sizing, tabs collapse to unstyled inline text) unless those two components are also changed to
   carry `className="breadcrumbs"` / `className="pagetabs"` (or the ref file is edited to add the ID
   selectors back, matching how it correctly did keep `#topnav,.topnav` as a dual selector, line 125).
2. **`.tn-sync`, the header "Connection status: synced" element (`top-nav.tsx:193`), has zero rules
   in the ref file.** It would render completely unstyled (no `inline-flex`, no padding) — a visible
   layout shift in the top-right header cluster next to the sync dot.
3. **`.btn` / `.btn-sm` / `.innovic-input` etc. lose their explicit `height:var(--control-h)` /
   `var(--control-h-sm)`** in the app today (app sizes them by padding only) — under a straight
   file-for-file swap this is actually a *fix* (adds the missing explicit height), but it changes the
   rendered height of every button and input app-wide (~28px/24px fixed vs. today's ~30–32px
   padding-derived height) — every page with a button/input row needs a visual re-check for
   misalignment against anything still sized the old way (e.g. `.tn-item` at 36px, `.tag`/`.badge`
   at their own heights) since those neighbours are NOT reduced by the same swap.
4. **`.innovic-textarea` currently has no dedicated rule** — the ref adds one
   (`height:auto;min-height:calc(var(--control-h)*2);resize:vertical;max-height:240px`). Any existing
   `.tsx` textarea that currently relies on the *shared* single-line input height (i.e. any textarea
   NOT already overridden inline) will suddenly grow to a 2-line minimum height and become resizable —
   needs a scan of every `<textarea class="innovic-textarea">` usage for layout assumptions.
5. **`.innovic-table.tbl-grid tbody tr:nth-child(odd) td` and `.innovic-table.tbl-grid .td-code` /
   `.td-code`** switch their font-size mechanism from a `13px`/`12px` literal to `var(--fs-sm)`. The
   base `.td-code` (non-`.tbl-grid`) specifically **changes value, 12px → 13px** — every plain
   `.innovic-table` (non-sheet) row using `.td-code` gets visibly larger mono text.
6. **`.tbl-frozen` does not compose with `.tbl-grid`'s cream-row alternation** in the app's current CSS
   (§3, "Unified table modifiers"). If the ref's more complete `.tbl-frozen .innovic-table.tbl-grid
   ...` rules are added, this is a fix, but any page currently combining `tbl-wrap tbl-frozen` with
   `innovic-table tbl-grid` will visually change (frozen column now alternates cream/white like the
   rest of the sheet, where today it stays flat white).

### Medium risk — quiet density/value shifts, not breakage

7. Every value flagged CHANGED in §3 (panel/stat-card/modal/toast/ops-routing padding & margins,
   `.tn-item`/`.tn-menu`/`.tn-col-label`/`.tag`/`.task-*` sizing) shifts pixel-for-pixel across the
   whole app the moment `components.css` replaces `innovic-theme.css` — none of these are
   catastrophic alone, but together they re-flow essentially every panel, table, badge, and nav
   element by a few px, so any page with fixed-height assumptions (sticky headers, `calc()` based
   `max-height`, the app's own `.tbl-wrap{max-height:calc(100vh - 220px)}` which the ref doesn't even
   define) needs a visual pass.
8. `--topbar-height` 54px → 48px (§1.9) directly changes `#topnav`'s `min-height` and every `calc()`
   or fixed-offset value elsewhere in the codebase that assumes 54px (e.g. `.gs-overlay{top:var(
   --topbar-height)}` at line 1526, and the mobile override at line 1608 which hard-codes `48px`
   already for `<768px` — meaning **mobile already expects 48px** and only desktop is out of step;
   adopting the ref's 48px everywhere actually *removes* an existing desktop/mobile inconsistency).
9. `--content-pad` (16px) vs. the app's actual 20px gutter — see §4.3's headline finding: two files
   (`so-status/routes/index.tsx`, `purchase-orders/components/po-form-css.ts`) hard-code
   `margin: 0 -20px -20px` full-bleed tricks that assume exactly 20px; adopting 16px without touching
   those breaks their bleed alignment by 4px on each edge.

### Classes used in app `.tsx` files but NOT present in the ref's `components.css`

Grepped every `.tsx` under `apps/web/src` for `className` usage of the app-only class names identified
in §3's "classes the ref dropped" list, to find live blast radius (dead code excluded):

| Class | Live in `.tsx`? | Files |
|---|---|---|
| `.sb-*` (all sidebar classes), `#sidebar` | **No** — zero matches | — confirmed dead; `_authenticated.tsx:44-59` shows the shell is `#app-shell > #main > (#app-header + #content)` with no `#sidebar` div at all (removed 2026-09-21 per the file's own comment) |
| `#topbar`, `.tb-left`, `.tb-right`, `.tb-sync`, `.tb-title` | **No** — zero matches | superseded by `#topnav`/`.tn-*`, same 2026-09-21 change |
| `.innovic-body`, `#toast` | **No** — zero matches | dead |
| `.tn-sync` | **Yes** | `top-nav.tsx:193` — **live, and missing from ref (High risk #2 above)** |
| `.pgtab-icon` | **Yes** | `open-tabs-bar.tsx:77` — live, missing from ref, low visual impact (only sets `flex-shrink:0`) |
| `jc-row-acts` (as `.jc-row-acts .btn-sm` compound selector in `innovic-theme.css:871`) | **Yes** | `job-cards/components/jc-row-write-actions.tsx` — live; the compound rule (`display:inline-flex;justify-content:center;padding:2px 6px;height:24px`) that makes the 2-across action-button block tidy would be lost entirely, since the ref's condensed file doesn't carry it |
| `.gs-overlay`, `.gs-results`, `.gs-col-*`, `.gs-ellipsis`, `.gs-lines` | **Yes** | `search-popup.tsx`, `results-table.tsx`, `search-results.tsx` (search module) — entire global-search popup layout (fixed column widths, flex-column scroll body, mobile fallback) is absent from the ref's condensed file and would need to be preserved/re-added, not dropped |
| `#breadcrumbs` / `#pagetabs` (ID selector mismatch) | **Yes** | `breadcrumbs.tsx`, `open-tabs-bar.tsx` — **High risk #1 above** |

**Bottom line:** a literal file-for-file swap of `innovic-theme.css` → ref's `components.css` is
**not safe as-is**. The ref file is an intentionally condensed reference (its own header says so) and
omits several class groups that are still live in the shipped app (`.tn-sync`, the ID-selector chrome,
`jc-row-acts`, the entire global-search popup vocabulary, `.pgtab-icon`). Any rebuild needs to either
(a) treat `components.css` as a token/value source and keep authoring the full app-specific class list
in `innovic-theme.css`, updated per the diffs in §3-§4, or (b) merge the ref's rules into
`innovic-theme.css` additively rather than replacing the file outright, and fix the two ID/class
selector mismatches as part of that merge.
