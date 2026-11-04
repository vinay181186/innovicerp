// One order picker: the SO / JWSO options behind the list-header dropdown and
// the QC Documents pickers. GET /order-options — any login may read it, because
// the dropdown sits on many departments' pages (owner 2026-11-04).

import { z } from 'zod';
import { qcDossierOrderKindSchema, type QcDossierOrderKind } from './qc-document';

export const orderOptionsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  /** Leave out for both SOs and JWSOs. */
  kind: qcDossierOrderKindSchema.optional(),
  /** Lists show documents of cancelled orders; the QC pickers leave them out. */
  cancelled: z.enum(['include', 'exclude']).default('include'),
  limit: z.coerce.number().int().positive().max(50).default(50),
});
export type OrderOptionsQuery = z.infer<typeof orderOptionsQuerySchema>;

export interface OrderOption {
  kind: QcDossierOrderKind;
  id: string;
  /** IN-SO-##### or IN-JW-#####. Filters a list by this exact value. */
  code: string;
  /** ADR-207: Internal SO No. (SO only; null otherwise). */
  internalSoNo: string | null;
  /** The customer's PO number: searchable, never shown in the row. */
  clientPoNo: string | null;
  /** The client master's name, else the name stored on the order. */
  customerName: string | null;
}
export interface OrderOptionsResponse {
  orders: OrderOption[];
}
