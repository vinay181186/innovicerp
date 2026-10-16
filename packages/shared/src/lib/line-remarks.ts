import { z } from 'zod';

// ADR-236 — "Remarks": free text about ONE Sales Order / Job Work Sales Order
// line. OPTIONAL. Stored as `sales_order_lines.remarks` and
// `job_work_order_lines.remarks` (migration 0211). The whole-order note is a
// different fact and is labelled `SO Remarks` / `JWSO Remarks` (the GRN split:
// `GRN Remarks` vs the line's bare `Remarks`).
//
// One rule for the form and the API:
//   - surrounding spaces trimmed; blank (or spaces-only) is stored as null;
//   - at most 500 characters;
//   - an ABSENT key leaves the stored value alone, an explicit null / "" clears it.

export const LINE_REMARKS_MAX = 500;

export const lineRemarksInputSchema = z
  .string()
  .trim()
  .max(LINE_REMARKS_MAX, `Remarks can be at most ${LINE_REMARKS_MAX} characters`)
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();
