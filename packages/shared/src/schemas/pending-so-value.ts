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

export const pendingSoValueFilterSchema = z.enum(['open', 'all', 'overdue', 'completed']);
export type PendingSoValueFilter = z.infer<typeof pendingSoValueFilterSchema>;

export const pendingSoValueQuerySchema = z.object({
  filter: pendingSoValueFilterSchema.default('open'),
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
  orderValue: z.string(),
  dispatchedValue: z.string(),
  pendingValue: z.string(),
  invoicedValue: z.string(),
  receivedValue: z.string(),
  outstandingValue: z.string(),
});
export type PendingSoValueRow = z.infer<typeof pendingSoValueRowSchema>;

/** Totals row at the bottom of the table + the 5-tile KPI strip data
 *  (legacy L19333–19340). */
export const pendingSoValueTotalsSchema = z.object({
  soCount: z.number().int().nonnegative(),
  orderValue: z.string(),
  dispatchedValue: z.string(),
  pendingValue: z.string(),
  invoicedValue: z.string(),
  receivedValue: z.string(),
  outstandingValue: z.string(),
});
export type PendingSoValueTotals = z.infer<typeof pendingSoValueTotalsSchema>;

export const pendingSoValueResponseSchema = z.object({
  generatedAt: z.string(),
  filter: pendingSoValueFilterSchema,
  rows: z.array(pendingSoValueRowSchema),
  totals: pendingSoValueTotalsSchema,
});
export type PendingSoValueResponse = z.infer<typeof pendingSoValueResponseSchema>;
