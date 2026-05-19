# Innovic ERP Style Guide

> **Status:** First slice shipped 2026-05-20 — tokens, theme CSS, Sidebar + TopBar layout shell, Tailwind extension. Per-screen polish + form-format alignment lands in subsequent commits.

This file is the reference for all visual work. The source of truth is `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` — every token + selector here ports directly from that file's `<style>` block. **Don't introduce new colours, spacing, or fonts that aren't already in this guide.**

---

## Design tokens

All tokens live in `apps/web/src/styles/tokens.css` (CSS variables) and `apps/web/tailwind.config.ts` (Tailwind utility expansion). Two access modes:

- **CSS:** `background: var(--bg2);`
- **Tailwind:** `<div className="bg-innovic-bg2 text-innovic-text">`

### Surfaces

| Token   | Hex       | Use                                                     |
| ------- | --------- | ------------------------------------------------------- |
| `--bg`  | `#f0f4f8` | App background (cool off-white)                         |
| `--bg2` | `#ffffff` | Card / panel / sidebar / topbar surface                 |
| `--bg3` | `#f5f7fa` | Table header, form input, modal header, even row stripe |
| `--bg4` | `#e8edf4` | Hover row, muted chip background                        |
| `--bg5` | `#dce3ed` | Pressed state, scrollbar thumb                          |

### Borders

| Token       | Hex       | Use                                             |
| ----------- | --------- | ----------------------------------------------- |
| `--border`  | `#d1d9e6` | Default panel / card / row separator            |
| `--border2` | `#c5cfe0` | Inputs, modal outlines, ghost-button outlines   |
| `--border3` | `#b0bed4` | Strongest — sparingly, for highlighted callouts |

### Text

| Token     | Hex       | Use                               |
| --------- | --------- | --------------------------------- |
| `--text`  | `#1a2235` | Body, primary headings            |
| `--text2` | `#4a5a72` | Secondary labels                  |
| `--text3` | `#7a8fa8` | Muted captions, table header text |

### Brand accents — 3-tier each

Every accent has three tiers: `*`, `*2` (darker), `*3` (pale wash for badges/chips).

| Family | Solid                | Dark                  | Pale                 |
| ------ | -------------------- | --------------------- | -------------------- |
| Cyan   | `--cyan` `#0088bb`   | `--cyan2` `#006694`   | `--cyan3` `#dff0f7`  |
| Amber  | `--amber` `#c47a00`  | `--amber2` `#a06200`  | `--amber3` `#fff4d6` |
| Green  | `--green` `#16a34a`  | `--green2` `#15803d`  | `--green3` `#dcfce7` |
| Red    | `--red` `#dc2626`    | `--red2` `#b91c1c`    | `--red3` `#fee2e2`   |
| Blue   | `--blue` `#2563eb`   | `--blue2` `#1d4ed8`   | `--blue3` `#dbeafe`  |
| Orange | `--orange` `#ea6c00` | `--orange2` `#c25a00` | _(no pale)_          |
| Purple | `--purple` `#7c3aed` | _(no dark)_           | _(no pale)_          |

### Department tints

Used for sidebar section borders + dashboard accents. Each has `-bg` pair for wash.

| Department                | Solid     | Wash      |
| ------------------------- | --------- | --------- |
| Planning / Design / Tasks | `#6d4ab8` | `#ede9f7` |
| Sales                     | `#128a3e` | `#dcf5e4` |
| Store                     | `#a96300` | `#fbeeda` |
| Production                | `#006f8f` | `#dff0f7` |
| QC                        | `#b83030` | `#fbe0e0` |
| Purchase                  | `#1e4db3` | `#e0e8f7` |
| Finance                   | `#0b776e` | `#d4ede9` |
| System                    | `#4b5563` | `#e5e7eb` |

### Signal colours

Reserved for **actionable meaning** — don't use them for general styling. Each has `-bg` (wash) + `-bd` (border).

| Signal   | Solid     | Wash      | Border    |
| -------- | --------- | --------- | --------- |
| Critical | `#dc2626` | `#fee2e2` | `#fecaca` |
| Warn     | `#c47a00` | `#fff4d6` | `#fde68a` |
| OK       | `#16a34a` | `#dcfce7` | `#bbf7d0` |
| Info     | `#2563eb` | `#dbeafe` | `#bfdbfe` |
| Neutral  | `#64748b` | `#f1f5f9` | `#e2e8f0` |

### Typography

| Token     | Family           | Use                                                                 |
| --------- | ---------------- | ------------------------------------------------------------------- |
| `--hfont` | Barlow Condensed | Headings, big numbers (`.section-hdr`, `.stat-val`, `.panel-title`) |
| `--bfont` | Barlow           | Body, labels, button text (DEFAULT for `<body>`)                    |
| `--mono`  | Source Code Pro  | Codes, IDs, table-header text, qty cells, sync indicator            |

Loaded via Google Fonts in `apps/web/index.html`.

| Size token     | Value | Use                                   |
| -------------- | ----- | ------------------------------------- |
| `--fs-mono`    | 10px  | Table header, tag, stat label         |
| `--fs-label`   | 11px  | Form labels, badge text, table header |
| `--fs-control` | 13px  | Button text, table body, input text   |
| `--fs-body`    | 14px  | Default body                          |
| `--fs-heading` | 17px  | Sidebar logo, modal title             |
| `--fs-section` | 22px  | Section header (`.section-hdr`)       |
| `--fs-stat`    | 32px  | KPI big number (`.stat-val`)          |

**Density rule:** Innovic is information-dense (14px body, 13px controls, tight padding). Don't substitute Tailwind's airier defaults.

### Radii + spacing

| Token             | Value | Use                                  |
| ----------------- | ----- | ------------------------------------ |
| `--radius`        | 8px   | Inputs, buttons, small chips         |
| `--radius2`       | 12px  | Panels, cards, modals, machine cards |
| `--sidebar-width` | 220px | Fixed sidebar width                  |
| `--topbar-height` | 54px  | Fixed topbar height                  |

### Shadows (Tailwind: `shadow-innovic-*`)

| Class                  | Use                                        |
| ---------------------- | ------------------------------------------ |
| `shadow-innovic-card`  | Default card / panel                       |
| `shadow-innovic-modal` | Modal lift (`0 24px 80px rgba(0,0,0,0.6)`) |
| `shadow-innovic-menu`  | Dropdown menus                             |

---

## Layout shell

`apps/web/src/routes/_authenticated.tsx` wraps every authenticated page in:

```
#app-shell    (flex, height: 100vh)
├── #sidebar  (220px, .sb-* classes)
└── #main     (flex column)
    ├── #topbar  (54px, .tb-* classes)
    └── #content (scrolling)
```

Class IDs are preserved verbatim from the legacy HTML (lines 50–55) so the CSS in `apps/web/src/styles/innovic-theme.css` lights them up.

### Sidebar

`apps/web/src/components/shared/sidebar.tsx` — collapsible department sections. Each section has a `sb-mod-<dept>` class that paints its left border + label with the department tint. Items use `.sb-item` (`.active` for current route). Hard-coded structure mirrors legacy lines 397–500.

### TopBar

`apps/web/src/components/shared/topbar.tsx` — page title derived from pathname via `TITLE_MAP`, sync status dot, sign-out button.

---

## Component patterns

### Panels (`.panel`, `.panel-hdr`, `.panel-title`, `.panel-body`)

Standard card-like container. Border + radius2, white surface, header has a subtle gradient stripe.

```tsx
<div className="panel">
  <div className="panel-hdr">
    <div className="panel-title">Sales orders</div>
    <button className="btn btn-primary btn-sm">New SO</button>
  </div>
  <div className="panel-body">{/* table or content */}</div>
</div>
```

### Stat cards (`.stat-card.cyan`, `.amber`, `.green`, `.red`)

Dashboard KPI tiles. Coloured top accent stripe.

```tsx
<div className="stat-card cyan">
  <div className="stat-label">Open SOs</div>
  <div className="stat-val">17</div>
  <div className="stat-sub">3 awaiting BOM</div>
</div>
```

Wrap multiples in `.stat-grid` (4-column responsive 2-up on mobile).

### Tables (`.tbl-wrap > .innovic-table`)

Sticky header with mono 10px uppercase labels, zebra striping (even rows in `bg3`), `bg4` hover. Optional `.tbl-frozen` for sticky first column.

### Badges (`.badge.b-green` / `.b-amber` / `.b-blue` / `.b-red` / `.b-grey` / `.b-cyan` / `.b-orange`)

Mono 10px uppercase pill. Per-module status badges (`JcStatusBadge` etc.) map status enum → one of these classes — see Innovic-specific patterns below.

### Buttons (`.btn`, `.btn-primary`, `.btn-success`, `.btn-danger`, `.btn-ghost`)

13px / 600 weight / 8px radius. Sizes: default + `.btn-sm`. Icon-only: `.btn-icon`.

### Forms (`.form-grid`, `.form-grid-3`, `.form-grp`, `.form-label`, `.innovic-input`)

2-col or 3-col grid. Labels are 11px / mono / uppercase / `text2`. Inputs are 13px / `bg3` background / `border2` outline / `radius`.

```tsx
<div className="form-grid">
  <div className="form-grp">
    <label className="form-label">
      SO No.<span className="req">*</span>
    </label>
    <input className="innovic-input" />
  </div>
  <div className="form-grp">
    <label className="form-label">Date</label>
    <input className="innovic-input" type="date" />
  </div>
  <div className="form-grp form-full">
    <label className="form-label">Remarks</label>
    <textarea className="innovic-textarea" />
  </div>
</div>
```

### Modals (`.overlay > .modal`, `.modal-hdr`, `.modal-body`, `.modal-footer`)

Backdrop is `rgba(0,0,0,0.7)` + blur. Default `max-width: 560px`; use `.modal-lg` for `min(1140px, 96vw)`.

### Toasts (`#toast > .toast-item.toast-ok|err|info`)

Bottom-right stack, slide-in animation.

### Empty states (`.empty-state`)

40px padding, centered, `text3` colour. Use `.empty-icon` (36px emoji) above the message.

---

## Innovic-specific status colours

### JC (Job Card) status → badge class

| Status                       | Badge class | Hex hint  |
| ---------------------------- | ----------- | --------- |
| Open / Available             | `b-grey`    | grey wash |
| Material Pending / Pr Raised | `b-amber`   | amber     |
| Running / In Progress        | `b-blue`    | blue      |
| QC Pending                   | `b-amber`   | amber     |
| At Vendor / Outsource sent   | `b-orange`  | orange    |
| On Hold                      | `b-red`     | red       |
| Complete                     | `b-cyan`    | cyan      |
| Closed                       | `b-green`   | green     |
| Cancelled                    | `b-grey`    | dim grey  |

### SO (Sales Order) status → badge class

| Status      | Badge class |
| ----------- | ----------- |
| Draft       | `b-grey`    |
| Open        | `b-blue`    |
| In Progress | `b-cyan`    |
| Closed      | `b-green`   |
| Cancelled   | `b-grey`    |

### Sync indicator (TopBar)

| Class               | Dot colour  | When             |
| ------------------- | ----------- | ---------------- |
| `.sync-dot`         | green       | normal           |
| `.sync-dot.offline` | amber, glow | network gone     |
| `.sync-dot.error`   | red         | last save failed |

---

## What to do when

- **Adding a new screen?** Use `.section-hdr` for the H1, `.panel` for the data container, `.innovic-table` inside a `.tbl-wrap`, `.btn .btn-primary` for the primary action top-right.
- **Adding a new form?** Use `.form-grid` + `.form-grp` + `.form-label` + `.innovic-input`. Match the legacy form's field order exactly (open the legacy HTML, find the modal, copy the field sequence + labels verbatim).
- **Adding a new status enum?** Pick the closest existing badge class — don't invent a new colour.
- **Adding a new module to the sidebar?** Edit `SECTIONS` in `apps/web/src/components/shared/sidebar.tsx`. Put it under the right department's `modClass` so the tint matches.

---

## What NOT to do

- ❌ Invent new colours / hexes outside this guide.
- ❌ Use Tailwind's default greys / blues / etc. — they don't match Innovic's palette.
- ❌ Make spacing "airier" to match consumer SaaS patterns — Innovic is dense by design (shop-floor monitors).
- ❌ Use a different font — Barlow / Barlow Condensed / Source Code Pro are the only families.
- ❌ Add a `.dark` class — the legacy is light-only; dark mode is intentionally not supported.
- ❌ Rewrite shadcn primitives — they inherit Innovic colours via the HSL remap in `index.css`.

---

## Status — what's themed vs what's not

**Themed (this commit):**

- Tokens + theme CSS
- Sidebar + TopBar shell
- shadcn primitives via HSL remap (Button / Card / Badge / Input / Label / Textarea / Select / Table / Tabs / etc. — all inherit)
- Home / dashboard page chrome

**Still pending — fix per-screen as we hit them:**

- Module list pages (sales-orders, purchase-orders, job-cards, items, etc.) — they currently use Tailwind utility classes that need swap to legacy class names (`.panel` / `.innovic-table`) OR to inherit through the shadcn primitives (already retinted).
- Module forms (PO new, SO new, JC new, etc.) — same story.
- Status-badge components (`SoStatusBadge`, `JcStatusBadge`, `NcStatusBadge`, `PoStatusBadge`, `DcStatusBadge`) — currently use shadcn's `Badge` variants; consider switching to the `.badge .b-*` legacy class names for closer parity.

The smoke test for "this page is themed enough": open it next to the legacy HTML's same screen, confirm density / colours / fonts match within ~10%.
