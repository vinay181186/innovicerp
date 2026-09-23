# Innovic ERP — Design System

**Context document for Claude Design.** This describes the visual language of the Innovic ERP,
a manufacturing (job-shop) ERP used by ~20 staff on desktop, all day. Everything below is
extracted from the live application, not invented: the token values come from
`apps/web/src/styles/tokens.css`, the component rules from `apps/web/src/styles/innovic-theme.css`,
and the page patterns from three reference screens — **Job Cards list**, **Job Card detail**,
**Purchase Orders list** — which the team treats as the house style.

Anything new must look like it already belonged to this app.

---

## 1. What this product is

- **Audience:** production planners, purchase officers, QC inspectors, store keepers, directors.
  They live in this app 8 hours a day and read numbers, not marketing.
- **Device:** desktop first (1366–1920 px). Tablet tolerated, phone is a fallback.
- **Nature of the screens:** document registers (lists of Job Cards, Purchase Orders, Sales
  Orders…), document detail pages, and data-entry forms. Every screen is either *a list of
  documents*, *one document*, or *a form that creates one*.
- **Volume on screen:** a list shows 8–20 columns and 50+ rows without paging. Density is a
  feature, not a compromise.

## 2. Design principles (in priority order)

1. **Information density over whitespace.** A planner comparing 40 job cards must see them all.
   Compact rows, 11–14 px type, small controls. Never "breathe" a table into half the rows.
2. **The document code is the hero.** `IN-JC-26-00012`, `IN-PO-26-0031` — always monospace,
   700 weight, brand blue, never muted grey. Labels may be quiet; the value must not.
3. **One accent colour.** Innovic blue `#155EEF` carries every interactive meaning — buttons,
   links, active tab, focus ring, active filter underline. There is no second brand colour.
4. **Colour means status, nothing else.** Green/amber/red/blue on a page are always telling
   you the state of a document. Colour is never decoration.
5. **Flat and quiet.** No gradients, no glassmorphism, no animation beyond a hover tint.
   Panels carry **no shadow at all** — only modals and toasts do.
6. **Every surface is white or near-white.** The page is `#F5F7FA`, cards are pure white,
   interior bands are `#F8FAFC`. Dark mode does not exist.
7. **Nothing moves when something is added.** Layouts are grids; adding a field or column
   must not reflow the ones beside it.

### Deliberately NOT this app
Large hero cards · big rounded corners (nothing above 8 px) · drop shadows on cards · icon-led
dashboards · pastel illustration · centred single-column layouts · animated counters ·
sidebar navigation (it is a **top** nav) · dark mode · emoji as the only label.

---

## 3. Colour

The full token set is in `01-tokens.css` — that file is the source of truth, copy the values
from it. The shape of the system:

### Surfaces
| Token | Value | Used for |
|---|---|---|
| `--bg` | `#f5f7fa` | page background |
| `--bg2` | `#ffffff` | card / panel / top bar |
| `--bg3` | `#f8fafc` | table header band, panel header, modal header |
| `--bg4` | `#f2f4f7` | row hover, muted chip background |
| `--bg5` | `#eaecf0` | pressed state, progress track |

### Borders — three depths
`--border #d8e1ec` (default) · `--border2 #c8d3e0` (modal, section rule) · `--border3 #b3c1d1` (rare).

### Text — three weights
`--text #172b4d` (body + headings) · `--text2 #667085` (secondary labels, table headers) ·
`--text3 #7b8aa0` (muted captions, placeholders — deliberately darkened from the theme sheet's
`#98A2B3` so muted text still clears a 3.3:1 contrast floor).

### Accents — every hue is a trio
Each colour ships as **solid / dark / pale**, and which one you use is a rule, not a choice:

| Trio | Solid (fills only) | Dark (any text) | Pale (wash / badge bg) |
|---|---|---|---|
| Blue (primary) | `--blue #155eef` | `--blue2 #123b73` | `--blue3 #eff6ff` |
| Green (done) | `--green #12b76a` | `--green2 #027a48` | `--green3 #ecfdf3` |
| Amber (attention) | `--amber #f79009` | `--amber2 #b54708` | `--amber3 #fffaeb` |
| Red (critical) | `--red #f04438` | `--red2 #b42318` | `--red3 #fef3f2` |
| Purple (admin) | `--purple #7a5af8` | `--purple2 #5925dc` | `--purple3 #f4f3ff` |
| Teal, Orange | `--teal`, `--orange` | `--teal2`, `--orange2` | `--teal3`, `--orange3` |

> **The rule:** solid values are for *fills* — dots, bars, borders, big stat numbers.
> Any **text** in that hue uses the dark `2` variant, which is what clears 4.5:1 on white or
> on the pale wash. Using the solid value as text is a defect.

`--cyan` is an alias of `--blue` (same hex) kept for legacy class names — they are the same
Innovic blue on purpose; the app previously had two competing accents and that was fixed.

### Fixed colour meanings
green = done / accepted · blue = running / partial / informational · amber = waiting, needs
attention · red = overdue, rejected, critical · grey = cancelled, neutral · purple = admin or
special. These never vary by screen.

---

## 4. Typography

Three families, loaded from Google Fonts:

| Token | Family | Used for |
|---|---|---|
| `--hfont` | **Barlow Condensed** 700/800 | section headings, panel titles, ruled-sheet column names |
| `--bfont` | **Barlow** 400–800 | all body text, labels, buttons |
| `--mono` | **Source Code Pro** 400/600/700 | document codes, quantities, dates, table headers |

Size scale (all tokens, never a literal px in a component):

| Token | px | Used for |
|---|---|---|
| `--fs-stat` | 28 | KPI numbers |
| `--fs-section` | 22 | page heading |
| `--fs-heading` | 17 | panel title |
| `--fs-body` | 14 | body text |
| `--fs-control` | 13 | inputs, buttons, table cells |
| `--fs-label` / `--fs-mono` | 11 | uppercase labels, table headers |

**11 px is the floor.** Nothing smaller ships. Uppercase labels carry `letter-spacing: .06em`.

Numbers, codes, dates and quantities are **always** monospace — columns of figures must align
on the digit.

---

## 5. Shape, depth, spacing

- **Radii:** `--radius-sm 4px` (badges, chips) · `--radius 6px` (buttons, inputs, tabs) ·
  `--radius2 8px` (panels, cards, modals). Nothing is more rounded than 8 px; nothing is a pill
  except a status badge (12 px).
- **Shadow:** panels have **none**. Only `--shadow-modal` (`0 8px 24px rgba(23,43,77,.12)`),
  `--shadow-toast`, `--shadow-drawer` exist.
- **Focus:** a 2 px `--blue` outline plus `--focus-ring rgba(21,94,239,.15)` halo. Never removed.
- **Spacing rhythm:** 4 / 6 / 8 / 12 / 14 / 16 / 20 px. Page gutter is 20 px, panel body padding
  16 px, gap between panels 12–14 px, gap between controls in a row 8 px.
- **Control height:** buttons and inputs are the same height (~32 px) so they line up in a
  filter row.

---

## 6. The building blocks

### Panel — the only container
```html
<div class="panel">
  <div class="panel-hdr"><span class="panel-title">Operation Routing</span>
    <button class="btn btn-ghost btn-sm">+ Add Operation</button></div>
  <div class="panel-body"> … </div>
</div>
```
White, 1 px `--border`, 8 px radius, no shadow. A header band (`--bg3`) with a Barlow Condensed
title on the left and optional small action on the right. A document identity card adds a 3 px
left stripe: `style="border-left: 3px solid var(--cyan)"`.

### Buttons
`.btn` + one variant: `.btn-primary` (solid blue — one per screen, the main action) ·
`.btn-ghost` (white, bordered — everything else) · `.btn-success` / `.btn-danger` (solid, sit on
the *dark* `2` value and darken on hover) · `.btn-sm` (the size used inside table rows).
Hover **darkens**, never lightens. Disabled is faded, never hidden — except for permissions,
where the button is **absent**, not greyed.

### Status badge
```html
<span class="badge b-green">COMPLETED</span>
```
Uppercase, 10–11 px, 700, pale wash background, dark text of the same hue, 12 px radius.
Variants: `b-green b-blue b-amber b-red b-grey b-cyan b-orange b-teal b-purple`.

### Table — the heart of the app
```html
<div class="tbl-wrap"><table class="innovic-table"> … </table></div>
```
`.tbl-wrap` gives no-wrap cells and horizontal scroll for free. Rules:
- Header: `--bg3` band, 11 px uppercase mono, `--text2`, sticky on scroll.
- **Column headers and their values share one centre line** — everything is centred unless the
  column is free text, which is left-aligned in *both* header and cells.
- Codes: `mono fw-700`, brand blue. Quantities: mono, 700. Dates: mono, 11 px.
- Long free text truncates with ellipsis + `title`; short values (codes, dates, qty) never wrap.
- **Rows are clickable** and open the document; every in-row control calls `stopPropagation`.
- A hint line sits under the table: *"💡 Click a row to open the …"*.
- Action column: ghost small buttons — icon-only in a dense list, labelled on a detail page.

**Ruled-sheet variant** `.innovic-table.tbl-grid` (used by Purchase Orders and other registers
the user asked to look like a printed sheet): fixed layout so it fits with no side scroll,
2 px `--blue2` rules top and bottom, Barlow Condensed 800 blue column names on a `--bg4` band,
vertical gridlines between every cell, cream `#fffbf2` / white alternating rows, 13 px cells.

### KPI counts — ONE strip, never separate cards
A single `.panel` row divided by hairlines: uppercase 10 px label over a 22 px mono number.
Clicking a tile filters the list; the active tile shows a **2 px coloured underline** — never a
ring or a filled card. This is a hard rule; four separate KPI cards is the single most common
way a new screen looks wrong here.

### Forms — one 12-column grid
Every form body is one 12-column CSS grid. Every field is a wrapper `div` with an explicit
`grid-column: span N`; helper text lives inside the wrapper. **No flex rows, no pixel widths,
no `flex-grow`.** Standard spans: number / date / short select = **3**; searchable picker = **3**
(6 for long codes); textarea / remark = **9** or **12**; section label = **12**; below 768 px
everything spans 12. Adding a field must move nothing else.
Required fields are marked `★`. Labels are 11 px uppercase; inputs are 13 px.

### Modal
`.overlay` (dimmed `rgba(23,43,77,.45)` + 2 px blur, z-index 500 — above the 60 of the top nav)
holding `.modal` (white, 8 px, `--shadow-modal`, max 1100 px / `.modal-lg` 1320 px, internal
scroll) with `.modal-hdr` / `.modal-body` / `.modal-footer`. Footer actions are right-aligned:
ghost Cancel then primary Save. ESC and click-outside ask before discarding an unsaved form.

### Navigation
A **top** bar, not a sidebar: italic blue `INNOVIC` wordmark, then twelve module names
(Dashboard, Sales & CRM, Design, Planning, Production, Purchase, Quality, Store, Finance,
Tasks, Reports, Settings) each opening a mega-menu; a global search box, a sync dot and a
circular user initial on the right. Under it a breadcrumb line: `Home › Production › Job Cards`.

---

## 7. Page patterns

### A document list (Job Cards, Purchase Orders …)
1. Page header: `📋 <Title>` in Barlow Condensed 22 px on the left; actions right, with exactly
   one `.btn-primary` (`+ New …`) and ghost buttons beside it (Excel, Print).
2. KPI strip (one row) — optional; the Purchase Orders list deliberately has none and shows an
   active-filter chip instead (`Filtered: Open` + a `Show All` ghost button).
3. Filter row: search box first (flexible width, `🔍 Search <the columns>…`), then selects of
   ~150 px, then date inputs; view toggles pushed to the right.
4. The table in a `.panel`, then the click hint.
5. Masters and document lists **scroll in one fetch — no Prev/Next**. Only unbounded registers page.

### A document detail (Job Card)
1. Header row: code in mono next to the title, status badges beside it, actions on the right
   (labelled, not icons).
2. Identity panel with the 3 px left stripe: thumbnail on the left, then a grid of
   *tiny uppercase label over a 13 px value* facts.
3. KPI strip for this document (planned / cleared / rejected / balance …).
4. One panel per section (operations, documents, history), each with its own header band.

### Empty, loading, error
Empty: a centred muted line in the table body (`No job cards found`). Loading: a spinner plus
the word *Loading…* in the same place. Error: the message in `--red`, in the same slot — the
page chrome never disappears.

---

## 8. Hard rules — the things that make it look wrong if broken

1. Never a hard-coded hex. Every colour is a `var(--token)`.
2. Codes render strong (mono, 700, `--text` or blue) — never in the faint `--text3`.
3. Counts go in ONE strip. Never a row of separate cards.
4. Panels get no shadow.
5. Short values never wrap; long text ellipsis + `title`.
6. Column header and its values share one alignment.
7. Rows are clickable; in-row controls stop propagation.
8. Nothing below 11 px.
9. One `.btn-primary` per screen.
10. Text in a hue uses the dark `2` variant, fills use the solid one.
11. Forms are a 12-column grid of spanned wrappers; adding a field moves nothing.
12. Permission-hidden actions are absent, not disabled.

---

## 9. Files in this package

| File | What it is |
|---|---|
| `00-DESIGN-SYSTEM.md` | this document — the overview and the rules |
| `01-tokens.css` | the real token file, verbatim from the app — **the source of truth for values** |
| `02-innovic-theme.css` | the real component stylesheet, verbatim (1630 lines) |
| `03-component-reference.md` | class-by-class inventory with real markup snippets |
| `04-page-anatomy.md` | the three reference screens broken down column by column |
| `screenshots/01-job-card-list.png` | Job Cards list |
| `screenshots/02-job-card-detail.png` | Job Card detail |
| `screenshots/03-purchase-order-list.png` | Purchase Orders list (ruled-sheet variant) |
| `screenshots/04-components-board.png` | tokens, type scale, buttons, badges, form grid on one board |
| `renders/*.html` | the HTML that produced the screenshots — open any in a browser |

**About the screenshots:** they are rendered from the application's own `tokens.css` and
`innovic-theme.css` with representative sample data, so every colour, font, border and spacing
is the real thing. They are not photographs of the live site (the site needs a login), and the
sample rows are illustrative, not live records.
