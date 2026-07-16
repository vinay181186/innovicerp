# Document Numbers (Doc-Number Check)
**Module key:** `doc-numbers` · **Domain:** Master Data

## Purpose
A cross-cutting helper (not an entity master) that powers the document-number override UI on document forms. Given a document type, it returns the suggested next code (MAX+1 in the company series) and whether a user-typed code is already taken and format-valid. Phase 1 covers SO / PO / GRN; new types are added by extending `DOC_NUMBER_FORMATS` + the `TABLE_NAME` map only.

## Pages / Screens
No dedicated web routes (the `apps/web/src/modules/doc-numbers/` directory is empty). Surfaced inline as the `DocNumberInput` field (`apps/web/src/components/shared/doc-number-input.tsx`) driven by the `useDocNumber` hook (`apps/web/src/lib/use-doc-number.ts`), embedded in:
- `sales-orders` → `sales-order-form.tsx`
- `purchase-orders` → `purchase-order-form.tsx`
- `goods-receipt-notes` → `goods-receipt-note-form.tsx`

## Database Tables
Owns no table. **Reads** (via raw SQL `tx.execute`) the code columns of the target document tables per type (`DocNumberType` → table): `sales_order` → `sales_orders`, `purchase_order` → `purchase_orders`, `grn` → `goods_receipt_notes`. Uniqueness is per-company excluding soft-deleted rows, matching each table's `(company_id, code) WHERE deleted_at IS NULL` partial unique index. Runs inside `withUserContext` so RLS applies.

## API Endpoints
- `GET /doc-numbers/check?type=<docType>&code=<code?>` — returns `{ exists, nextCode, formatValid }`. Any authenticated user; company-scoped. When `code` is omitted, only `nextCode` is meaningful (`exists:false, formatValid:false`).

## Services / Key Functions
- `checkDocNumber(query, user)` → `{exists, nextCode, formatValid}` — computes next code, and if a code is supplied validates its strict format and checks existence.
- `computeNext(tx, type, companyId)` → next code string — MAX+1 across the company series using the type's prefix/digits (mirrors `nextSoCode`).
- `checkExists(tx, type, companyId, code)` → boolean — is the code held by an active row for the company.
- Shared config in `@innovic/shared` `schemas/doc-number.ts`: `DOC_NUMBER_FORMATS` (`IN-SO-`/`IN-PO-`/`IN-GRN-`, 5 digits each), `docNumberPattern`, `padDocNumber`, `evaluateDocNumber`, `docNumberError`, and the `checkDocNumberQuery/Response` schemas.

## Entry Points
No sidebar entry. Called by the SO / PO / GRN create forms while the user types (debounced) a manual document number, to warn on duplicates/format and to prefill the auto-suggested next number. Table/prefix identifiers are constants (never user input) → safe to splice via `sql.identifier`.

## Business Logic
- Next code = `prefix` + zero-padded `MAX(existing digits) + 1` for the type, per company.
- Format validity is a strict `^<prefix>\d{digits}$` regex (e.g. `/^IN-SO-\d{5}$/`).
- Existence check excludes soft-deleted rows and is company-scoped.
- Read-only: it never writes; the actual code is persisted by the owning document module on create (which also races/retries on the unique index).
- Frontend helpers (`padDocNumber`, `evaluateDocNumber`, `docNumberError`) zero-pad on blur and produce the inline "Invalid format…" / "Duplicate…" messages.

## Dependencies on Other Modules
- Reads the `sales_orders`, `purchase_orders`, `goods_receipt_notes` tables. Consumed by those three modules' create forms. Depends on the shared `DOC_NUMBER_FORMATS` config.

## User Roles / Access
- Any authenticated user in the company (read-only check). No write role and no access-control matrix key.

## Reports
None.

## Imports / Exports
None.

## Background Jobs
None.
