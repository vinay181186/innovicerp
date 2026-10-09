// Multi-Level Plan — raising orders from the plan rows (ADR-225 phase 4).
//
// One request raises, per chosen row, the EXISTING document that row needs:
//
//   Manufacture row (part, sub-assembly or the top item)
//       → a Plan (route-card plan) that then goes the normal
//         Plan → Production Order → Job Card route.
//         The TOP row's plan carries the SO line (it is the line's own plan,
//         so SO coverage and caps work as today). Every OTHER row's plan has
//         no SO line and carries `ml_plan_node_id` instead — so a child plan
//         can never move the SO line's Planned figure.
//   Buy row → a Purchase Request (standard, vendor TBD, like a Planning PR),
//         no SO line, `ml_plan_node_id` set.
//   Outsource row → a full-outsource Plan (needs Vendor + Process), no SO line,
//         `ml_plan_node_id` set; finalised / executed on the Plan screen as
//         today.
//
// Raised    = live qty of the plans / PRs made from the row (a deleted plan,
//             a cancelled PR count 0; a short-closed PR counts what was ordered)
// To Raise  = Net Need − Raised, never below 0.
// A request may raise at most To Raise on a row — checked under the Multi-Level
// Plan's row lock, in the same transaction that inserts (CLAUDE.md §20.3).
// The whole request is one transaction: every row is raised, or none.
// The first order moves the plan Draft → Released (conditional update).

import { z } from 'zod';
import { expectedUpdatedAtSchema } from '../lib/edit-conflict';

export const ML_PLAN_ORDER_KINDS = ['plan', 'pr'] as const;
export type MlPlanOrderKind = (typeof ML_PLAN_ORDER_KINDS)[number];

/** One document raised from a plan row. */
export const mlPlanOrderSchema = z.object({
  nodeId: z.string().uuid(),
  kind: z.enum(ML_PLAN_ORDER_KINDS),
  docId: z.string().uuid(),
  /** PLN-… / IN-PR-… */
  docCode: z.string(),
  qty: z.string(),
  /** The document's own status code (plan_status / PR status). */
  docStatus: z.string(),
  /** false = deleted plan / cancelled PR — kept for the record, counts 0. */
  live: z.boolean(),
  createdAt: z.string(),
});
export type MlPlanOrder = z.infer<typeof mlPlanOrderSchema>;

export const raiseMlPlanOrderLineSchema = z.object({
  nodeId: z.string().uuid(),
  /** Manufacture rows: a whole number. Buy rows: up to 3 decimals. */
  qty: z.number().positive(),
  /** Outsource rows only — required there. */
  vendorId: z.string().uuid().nullable().optional(),
  process: z.string().trim().max(200).nullable().optional(),
  /** Optional for every row. */
  requiredDate: z.string().nullable().optional(),
});
export type RaiseMlPlanOrderLine = z.infer<typeof raiseMlPlanOrderLineSchema>;

export const raiseMlPlanOrdersInputSchema = z
  .object({
    lines: z.array(raiseMlPlanOrderLineSchema).min(1, 'Pick at least one row').max(500),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.nodeId)).size === v.lines.length,
    'The same row is listed twice',
  );
export type RaiseMlPlanOrdersInput = z.infer<typeof raiseMlPlanOrdersInputSchema>;
