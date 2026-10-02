// Pending SO Value — sales revenue / cashflow rollup per SO.
//
// Mirrors legacy renderPendingSOValue (HTML L19272). The report aggregates
// per-line: orderValue = qty*rate, dispatchedValue from DC lines, invoicedValue
// from invoices, receivedValue from invoices.totalPaid. See
// docs/PARITY/pendingsovalue.md for the full legacy spec.
//
// Filter:
//   open      — SO is open OR pendingValue > 0
//   all       — every SO
//   overdue   — dueDate < today AND pendingValue > 0
//   completed — SO status in {closed, dispatched, cancelled}

import { z } from 'zod';
import { sfRawParamSchema } from './list-query';

export const pendingSoValueFilterSchema = z.enum(['open', 'all', 'overdue', 'completed']);
export type PendingSoValueFilter = z.infer<typeof pendingSoValueFilterSchema>;

export const pendingSoValueQuerySchema = z.object({
  filter: pendingSoValueFilterSchema.default('open'),
  /** SO No. / customer — matched on the server over every SO (ADR-201). */
  search: z.string().trim().max(100).optional(),
  /** Sort & Filter (ADR-200). */
  sf: sfRawParamSchema,
  /** Paging (ADR-201). No limit → every row. */
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type PendingSoValueQuery = z.infer<typeof pendingSoValueQuerySchema>;

/** Per-SO row in the report table. All money fields are stringified numerics
 *  to preserve precision; the UI formats with Intl.NumberFormat('en-IN'). */
export const pendingSoValueRowSchema = z.object({
  soId: z.string().uuid(),
  soCode: z.string(),
  customerName: z.string().nullable(),
  soDate: z.string(),
  dueDate: z.string().nullable(),
  status: z.string(),
  // Money — NULL when the viewer's access hides prices.
  orderValue: z.string().nullable(),
  dispatchedValue: z.string().nullable(),
  pendingValue: z.string().nullable(),
  invoicedValue: z.string().nullable(),
  receivedValue: z.string().nullable(),
  outstandingValue: z.string().nullable(),
});
export type PendingSoValueRow = z.infer<typeof pendingSoValueRowSchema>;

/** Totals row at the bottom of the table + the 5-tile KPI strip data
 *  (legacy L19333–19340). Summed on the server over EVERY SO matching the
 *  filter + search + Sort & Filter — never over the page on screen. */
export const pendingSoValueTotalsSchema = z.object({
  soCount: z.number().int().nonnegative(),
  // Money — NULL when the viewer's access hides prices.
  orderValue: z.string().nullable(),
  dispatchedValue: z.string().nullable(),
  pendingValue: z.string().nullable(),
  invoicedValue: z.string().nullable(),
  receivedValue: z.string().nullable(),
  outstandingValue: z.string().nullable(),
});
export type PendingSoValueTotals = z.infer<typeof pendingSoValueTotalsSchema>;

export const pendingSoValueResponseSchema = z.object({
  generatedAt: z.string(),
  filter: pendingSoValueFilterSchema,
  /** SOs matching every filter (the pager's total; rows holds one page). */
  total: z.number().int().nonnegative(),
  rows: z.array(pendingSoValueRowSchema),
  totals: pendingSoValueTotalsSchema,
  /** Told, not inferred. The server strips money it may not send and states it
   *  here, so a client never has to guess from a null value. A null money field
   *  also means "no value yet", and probing it made one unpriced row hide the
   *  money columns from a user fully entitled to see them. */
  priceVisible: z.boolean(),
});
export type PendingSoValueResponse = z.infer<typeof pendingSoValueResponseSchema>;
