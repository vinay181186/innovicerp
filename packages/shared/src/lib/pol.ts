import { z } from 'zod';

// POL — the CUSTOMER'S purchase-order line number (docs/NAMING.md). Never our
// own line number (`lineNo`, "Ln"): on live data our line 11 is their line 20.
//
// ADR-236: COMPULSORY on every Sales Order line and every Job Work Sales Order
// line. One rule for the web form and the API, so a client that skips the form
// is still refused:
//   - surrounding spaces trimmed; blank or spaces-only is refused;
//   - at most 64 characters; free text otherwise ("10", "20A", "1.2").
// Not unique within an order — a customer may repeat a line number.
//
// Stored as `sales_order_lines.client_po_line_no` and
// `job_work_order_lines.client_po_line_no`. Read models stay nullable: JWSO
// lines saved before ADR-236 have none and render "—".

export const POL_MAX = 64;

export const polInputSchema = z
  // A MISSING key says the same as a blank one, not zod's bare "Required".
  .string({ required_error: 'POL is required', invalid_type_error: 'POL is required' })
  .trim()
  .min(1, 'POL is required')
  .max(POL_MAX, `POL can be at most ${POL_MAX} characters`);

/** The plain-English problem with a typed POL, or null when it is fine —
 *  derived from polInputSchema, so the form and the API share one rule and
 *  one wording. */
export function polError(raw: string | null | undefined): string | null {
  const r = polInputSchema.safeParse(raw ?? '');
  return r.success ? null : (r.error.issues[0]?.message ?? 'POL is invalid');
}
