# PARITY — Print Templates + Document Printing (`renderPrintTemplates` + all `printX` functions)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
> - **Template system (A):** infra L14439–14605, editor `renderPrintTemplates` L14660–14800, editor interactions L14884–15029, test print `_pteTestPrint` L15034–15110.
> - **Template-consuming prints (B):** `printPO` L25913, `printChallan` (OSP DC) L26133, `_jwdcPrint` (JW DC) L24611.
> - **Fixed-layout prints (C):** shared `printWindow(title, bodyHtml)` L10524, `printJobCard` L10582, `printRouteCard` L10629, `printMachineQueue` L10661 / `showPrintQueueDialog` L10695, `printDispatchRegister` L10789, `printDailyReport` L10918, `_printInvoice` L21314, `printDrawingFile` L10490.
> **React target:** ❌ **WHOLE FEATURE MISSING.** No `/print-templates` route; no `print_templates` / `print_template_revisions` tables; no `window.print()` anywhere in `apps/web/src`.
> **Status:** ❌ greenfield. Scope approved by user 2026-05-25 = **A+B+C (everything, incl. fixed-layout prints)**.

---

## 0. What this feature is — three parts

**(A) Print Templates editor + store.** An admin-only WYSIWYG screen that lets the operator customise the *editable text blocks* of three printable documents. The line-items table + meta rows are system-generated; only the surrounding prose (header note, special notes, terms, footer, signature) is editable. Stored per-block with last-5-version rollback.

**(B) Template-consuming prints.** The real Print actions on **PO**, **OSP DC**, **JW DC** that open a print window and inject the customised blocks via `{variable}` substitution. These are the docs vendors actually receive.

**(C) Fixed-layout prints.** Independent `printX()` functions for **Job Card, Route Card, Machine Queue, Dispatch Register, Daily Report, Invoice, Drawing**. These do **not** use the template editor — they are hard-coded layouts that open a print window. They share the `printWindow(title, bodyHtml)` helper (except invoice + the B docs, which roll their own window).

---

## 1. Template data model (A) — L14439–14605

Two legacy collections:

**`printTemplates[*]`** — one row per *edited* block (absent row ⇒ factory default used):
- `id`, `templateKey` (e.g. `po_terms`), `content` (plain text, `\n` line breaks), `lastEditedBy` (user name string), `lastEditedAt` (ISO).

**`printTemplateRevisions[*]`** — append-only history, capped at **last 5 per `templateKey`**:
- `id`, `templateKey`, `content` (the *previous* content before an edit), `editedBy`, `editedAt`.

`_loadTemplate(key)` → returns `printTemplates` row content if present, else `_PT_DEFAULTS[key]` (L14501).

---

## 2. The 15 templates — 3 docs × 5 blocks (`_PT_META` L14463, `_PT_DEFAULTS` L14439)

Doc types: **PO** (`po_`), **OSP DC** (`ospdc_`), **JW DC** (`jwdc_`). Blocks per doc (in order):

| key suffix | name | position |
|---|---|---|
| `header_note` | Header Note | Top of document, above line items |
| `special_notes` | Special Notes | Below totals, above Terms (blank by default) |
| `terms` | Terms & Conditions | Below Special Notes |
| `footer` | Footer | Bottom of page (jurisdiction, E.&O.E.) |
| `signature` | Signature Block | Bottom-right corner |

Factory defaults (verbatim) — port these into a `PRINT_TEMPLATE_DEFAULTS` const so the seedless system has sensible text:
- `po_header_note`: "Please supply the items as per specifications mentioned in this Purchase Order. Quote our PO number {poNo} on all correspondence, invoices and delivery challans."
- `po_special_notes`: "" (blank)
- `po_terms`: 6-point list (specs / payment `{paymentTerms}` / delivery / test certs / rejection replacement / V.U. Nagar jurisdiction) — see L14443.
- `po_footer`: "E. & O.E.   |   Subject to V.U. Nagar (Anand) Jurisdiction   |   This is a computer generated document."
- `po_signature`: "For Innovic Technology\n\n\n\nAuthorised Signatory"
- `ospdc_*` / `jwdc_*`: analogous returnable-material text — see L14448–14459 (port verbatim).

---

## 3. Variables per doc type (`_PT_VARS` L14487)

- **PO:** `companyName, companyAddress, companyGSTIN, companyPhone, companyEmail, date, currentUser, poNo, poDate, paymentTerms, deliveryTerms, vendorName, vendorAddress, vendorGSTIN, vendorContact, totalValue, totalQty`
- **OSP DC** & **JW DC** (identical set): `companyName, companyAddress, companyGSTIN, date, currentUser, dcNo, dcDate, purpose, recipientName, recipientAddress, vehicleNo, driverName, linkedPONo, totalQty`

---

## 4. Substitution + validation rules (L14508–14541)

- `_substituteVariables(text, data)`: replace `/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g`. Known var → `String(value)` (null→`''`). **Unknown var → blank** (NOT the literal token).
- `_validateTemplateVars(text, allowed)`: returns list of `{vars}` not in the allowed set. Editor shows a non-blocking ⚠ warning; Save confirms "will print as blank. Save anyway?".
- `_renderTemplateBlock(key, data)` = `_loadTemplate` → `_substituteVariables` → escape HTML → `\n`→`<br>`. This is the single function both the editor preview and the real prints call.

---

## 5. Revisions + restore default (L14544–14597)

- On every save, the *old* content is pushed to revisions; trimmed to last 5 per key (`_saveTemplateRevision` L14544).
- Revisions modal (`_pteShowRevisions` L14989): table of #, date/time, editedBy, 150-char preview, Restore button. Restore loads the old content into the editor (still requires an explicit Save to commit — `_pteRestoreRev` L15017).
- Restore-to-default (`_pteRestoreDefault` L14977): saves a revision of current, then writes `_PT_DEFAULTS[key]`.
- **Admin-only** for all writes (`_ptSaveContent` guards `isAdmin()` L14566). Every save logs activity `UPDATE/PrintTemplate`.

---

## 6. Editor UI — `renderPrintTemplates` (L14660–14800)

- Admin gate: non-admin sees a 🔒 "Admin access required" panel.
- Toolbar: "📄 Print Templates — WYSIWYG Editor" + how-it-works info banner.
- Doc selector: 3 colour-coded buttons (PO `#1E4DB3`, OSP DC `#7c3aed`, JW DC `#c47a00`) + "🖨 Test Print".
- **Two-column grid (1fr / 240px):**
  - **Left — document mock** (white paper): company header (logo + name + address + GSTIN + email) → coloured title bar → meta row (PO: PO No/Date/Payment + Vendor block; DC: DC No/Date/Purpose + Recipient block) → **editable block 1 (header note)** → system-generated line-items table (NOT editable) → (PO only: amount-in-words) → **editable block 2 (special notes)** → **block 3 (terms)** → **block 4 (footer, small/centered)** → signature row (left: PAN/E.&O.E.; right: **block 5 (signature)**).
  - **Right — sticky variables panel:** chips of allowed vars; clickable only while a block is in edit mode (insert at cursor); + quick-tips legend.
- **Editable block states** (`_pteRenderBlock` L14819): VIEW (rendered with sample data, click to edit, footer shows position · last edit · N revisions · reset) / EDIT (textarea + Cancel/Save + unknown-var warning). Green border = customised, dashed grey = empty, amber = editing.
- Sample data: `_ptSampleData(docType)` L14619 (Innovic Technology / V.U. Nagar / sample PO-99999 / vendor / totals).

## 7. Test print — `_pteTestPrint` (L15034)

Opens a new window with a yellow "TEST PRINT — sample data" banner, renders the full doc using current (possibly unsaved-in-DB but saved) templates + sample data, Print/Close buttons.

---

## 8. Template-consuming prints (B)

All three open their own print window and call `_renderTemplateBlock('<doc>_<block>', data)` for the 5 blocks, injecting them around a real data-driven layout:

- **`printPO(poNo)`** L25913 → builds `_ptData` from the PO + vendor + company, calls `po_*` blocks (L25982–25986), renders header/meta/line-items+GST/amount-in-words/notes/terms/footer/signature. Print button L26012.
- **`printChallan(poNo)`** L26133 → OSP DC for a Job-Work PO (the "Print Challan" button on Job-Work POs, L25638). Uses `ospdc_*`.
- **`_jwdcPrint(id)`** L24611 → JW Delivery Challan. Builds `_ptData` (L24636–24640), uses `jwdc_*`. Triggered from JW DC list (L24463/24473) and auto after create (L24543).

Data each needs is already available from our API detail endpoints (PO detail, JW DC detail). `totalValue` → Indian number format + amount-in-words.

---

## 9. Fixed-layout prints (C) — shared `printWindow(title, bodyHtml)` L10524

`printWindow` opens an 980×740 window, writes `<!DOCTYPE>` + a standard stylesheet (company header w/ logo, `.doc-title`, `table` th=`#1a3a6b`, `.badge` colour set, `.info-grid`, `.sign-row` 3-col signatures, `@media print{.no-print{display:none}}`) + Print/Close buttons + `companyBlock` + the caller's `bodyHtml`. Callers just build `bodyHtml`.

| Function | Line | Triggered from | Body content |
|---|---|---|---|
| `printJobCard(jcId)` | 10582 | JC detail/list | JC header info-grid + ops table + signature row |
| `printRouteCard(itemCode)` | 10629 | Route Card list 🖨 (L10117) | RC ops sequence table |
| `printMachineQueue(machineId)` | 10661 | Machine loading 🖨 (L10439/10467); `showPrintQueueDialog` L10695 picker | per-machine job queue table |
| `printDispatchRegister()` | 10789 | Dispatch register 🖨 (L10753) | dispatch rows for selected range |
| `printDailyReport(date,mach)` | 10918 | Daily report 🖨 (L10882/10895) | per-machine op-log summary for a date |
| `_printInvoice(invId)` | 21314 | Invoice list/detail 🖨 (L21129/21308) | **own window** (not `printWindow`) — tax invoice layout, print btn L21347 |
| `printDrawingFile(id,type)` | 10490 | Item list/detail 🖨 (L11493/11528) | opens stored drawing image/PDF in a print window |

> Detail of each C function's exact `bodyHtml` is read at its build step (the legacy lines are long minified strings). They depend on data our API already exposes (JC ops, route-card ops, machine queue, dispatch log, op-log, invoices, item drawing path).

---

## 10. DELTAs for our React + Supabase architecture

1. **Template store moves to Postgres** (`print_templates` + `print_template_revisions`), not a Firebase blob. Service-layer enforces admin-only writes + revision capping (CLAUDE.md Rule #1 — no logic in FE).
2. **Substitution + print-window HTML are presentation** → live in a web util (`@/lib/print`). Template *content* + *defaults* come from the API; the FE only renders. Defaults const is shared (`packages/shared`) so API seeds/falls back and FE can preview.
3. **Logo:** legacy embeds a base64 data-URI (L10527). We'll use a bundled asset or company-record logo; the company header pulls name/GSTIN/address from the `companies` row (Settings page already edits these), not hard-coded.
4. **Revisions = dedicated table** matching `route_card_revisions` / `bom_master_revisions` convention (manager/admin-insert policy), capped at 5 per key in the service.
5. **`window.open` popup** — same UX as legacy; show a toast "Allow popups to print" on null window.
6. **No new doc types beyond the legacy 3** for templates; fixed prints add their own pages' Print buttons.

---

## 11. Phased build plan (committable slices)

- **P1 — Foundation (A):** migration (`print_templates` + `print_template_revisions` + RLS + trigger) → `packages/shared` schemas + `PRINT_TEMPLATE_DEFAULTS` + `PRINT_TEMPLATE_VARS` + substitution util → api `print-templates` module (get-all-with-defaults, upsert+revision, list-revisions, restore-default; admin-only) → web admin `/print-templates` WYSIWYG editor + test print. Tests on service. **Commit.**
- **P2 — Template-consuming prints (B):** `@/lib/print` window util + per-doc body builders → Print buttons on PO detail + JW DC detail (+ OSP DC variant for Job-Work POs) consuming P1 templates. **Commit.**
- **P3 — Fixed-layout prints (C):** shared `printWindow` util + Job Card, Route Card, Machine Queue, Dispatch Register, Daily Report, Invoice, Drawing print buttons — one or two per commit, read each legacy fn at its step. **Commit(s).**
