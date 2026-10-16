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
  .string()
  .trim()
  .min(1, 'POL is required')
  .max(POL_MAX, `POL can be at most ${POL_MAX} characters`);

/** The plain-English problem with a typed POL, or null when it is fine. */
export function polError(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return 'POL is required.';
  if (v.length > POL_MAX) return `POL can be at most ${POL_MAX} characters.`;
  return null;
}
