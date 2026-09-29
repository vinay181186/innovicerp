// Accountability vocabulary (ADR-197) — the ONE list of activity names and
// document types the activity log speaks.
//
// Before this file ~200 emitters each chose their own words: `EDIT` and
// `UPDATE` for the same thing, `SHORT_CLOSE` next to `BALANCE_CLOSE`,
// `Job Card` next to `JobCard`. New code writes ONLY the constants below;
// old rows stay as stored (the log is append-only) and are READ through
// `canonicalActivityAction` / `canonicalActivityEntity`, so a legacy `UPDATE`
// and a new `EDIT` show the same label and filter together.
//
// Rules (docs/AUDIT-TRAIL.md is the developer guide):
//   - `entity` + `entityId` name the DOCUMENT (the header row), never a line
//     or an op. A line / op is located by `lineRef` / `opRef` on the same row.
//   - An action in REASON_REQUIRED_ACTIONS must carry a `reason`; the service's
//     Zod input enforces it with `activityReasonSchema`.

import { z } from 'zod';
import type { AccessFormKey } from './access-control';
import type { GlobalSearchKind } from '../schemas/global-search';

// ── Actions ────────────────────────────────────────────────────────────────

/** Standard action names, stored in `activity_log.action` (UPPER_SNAKE). */
export const ActivityAction = {
  Create: 'CREATE',
  Edit: 'EDIT',
  Submit: 'SUBMIT',
  Approve: 'APPROVE',
  Reject: 'REJECT',
  /** An approval taken back (the document returns to draft / open). */
  Withdraw: 'WITHDRAW',
  /** A change asked for, waiting on someone's Approve (e.g. op time change). */
  Request: 'REQUEST',
  /** Production op started (no qty). */
  Start: 'START',
  /** Production op stopped / logged — good + reject qty. */
  Log: 'LOG',
  /** Any QC result: in-process, final, TPI, Incoming QC on a GRN. */
  QC: 'QC',
  /** Material leaves us: DC to vendor, outsource balance, dispatch out. */
  Send: 'SEND',
  /** Material comes back: DC receipt, RTV received. */
  Receive: 'RECEIVE',
  /** Store issue of material / tools. */
  Issue: 'ISSUE',
  /** Store / tool return. */
  Return: 'RETURN',
  /** Reached done by itself (auto roll-up: JC complete, DC complete). */
  Complete: 'COMPLETE',
  Close: 'CLOSE',
  /** Stopped before the full qty — NAMING "Short closed". */
  CloseShort: 'CLOSE_SHORT',
  Reopen: 'REOPEN',
  /** An opposite entry that cancels an earlier one; the original stays. */
  Reverse: 'REVERSE',
  Cancel: 'CANCEL',
  Delete: 'DELETE',
  Restore: 'RESTORE',
  /** NC disposition decided (Rework / Repair / Scrap / Use as is / RTV / Make fresh). */
  Dispose: 'DISPOSE',
  /** One row split into two (NC part-disposition, machine split). */
  Split: 'SPLIT',
  Payment: 'PAYMENT',
  /** A counted / drafted figure posted to the books (stock count). */
  Post: 'POST',
} as const;
export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction];
export const ACTIVITY_ACTIONS = Object.values(ActivityAction) as ActivityAction[];

/** The words a person reads for each standard action (past tense, one line). */
export const ACTIVITY_ACTION_LABEL: Record<ActivityAction, string> = {
  CREATE: 'Created',
  EDIT: 'Edited',
  SUBMIT: 'Submitted',
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  WITHDRAW: 'Approval withdrawn',
  REQUEST: 'Change requested',
  START: 'Started',
  LOG: 'Logged',
  QC: 'QC logged',
  SEND: 'Sent',
  RECEIVE: 'Received',
  ISSUE: 'Issued',
  RETURN: 'Returned',
  COMPLETE: 'Completed',
  CLOSE: 'Closed',
  CLOSE_SHORT: 'Short closed',
  REOPEN: 'Reopened',
  REVERSE: 'Reversed',
  CANCEL: 'Cancelled',
  DELETE: 'Deleted',
  RESTORE: 'Restored',
  DISPOSE: 'Disposition set',
  SPLIT: 'Split',
  PAYMENT: 'Payment recorded',
  POST: 'Posted',
};

/** Actions that are refused without a reason (requirement §3.1 "Why"). */
export const REASON_REQUIRED_ACTIONS: readonly ActivityAction[] = [
  'REJECT',
  'REVERSE',
  'CLOSE_SHORT',
  'CANCEL',
  'DELETE',
];

/** The reason a person types for a reason-required action. */
export const activityReasonSchema = z.string().trim().min(1).max(500);

/**
 * Legacy stored action → standard action, for DISPLAY and filtering only.
 * Stored rows are never rewritten. A legacy name whose meaning is not one of
 * the standard actions (IMPORT, RESERVE, drawing_view, …) is absent and shows
 * in Title Case via `activityActionLabel`.
 */
export const LEGACY_ACTIVITY_ACTION: Record<string, ActivityAction> = {
  UPDATE: 'EDIT',
  EDITED: 'EDIT',
  edited: 'EDIT',
  CREATED: 'CREATE',
  created: 'CREATE',
  cancelled: 'CANCEL',
  CANCELLED: 'CANCEL',
  APPROVAL_WITHDRAWN: 'WITHDRAW',
  OP_START: 'START',
  'OP START': 'START',
  OP_STOP: 'LOG',
  OP_COMPLETE: 'LOG',
  'OP COMPLETE': 'LOG',
  OP_QC: 'QC',
  NC_RECOVERY_QC: 'QC',
  OP_OUTSOURCE_SENT: 'SEND',
  OP_OUTSOURCE_RECEIVED: 'RECEIVE',
  OP_OUTSOURCE_REVERSED: 'REVERSE',
  OP_LOG_TIME_CHANGE_REQUESTED: 'REQUEST',
  OP_LOG_TIME_EDIT: 'EDIT',
  DC_ISSUE: 'SEND',
  DC_RECEIVE: 'RECEIVE',
  DC_COMPLETE: 'COMPLETE',
  DC_CANCEL: 'CANCEL',
  NC_DISPOSE: 'DISPOSE',
  NC_SPLIT: 'SPLIT',
  NC_CLOSE: 'CLOSE',
  NC_RTV_RECEIVED: 'RECEIVE',
  NC_RTV_CHALLAN_CANCELLED: 'CANCEL',
  JC_COMPLETE: 'COMPLETE',
  SO_CLOSED: 'CLOSE',
  SO_LINE_CLOSED: 'CLOSE',
  SO_REOPENED: 'REOPEN',
  JW_CLOSED: 'CLOSE',
  JW_LINE_CLOSED: 'CLOSE',
  JW_RETURN_CANCEL: 'CANCEL',
  SHORT_CLOSE: 'CLOSE_SHORT',
  BALANCE_CLOSE: 'CLOSE_SHORT',
  'PERM DELETE': 'DELETE',
};

/** Stored action (standard or legacy) → the standard action, or null when it
 *  has no standard equivalent. */
export function canonicalActivityAction(action: string): ActivityAction | null {
  if ((ACTIVITY_ACTIONS as string[]).includes(action)) return action as ActivityAction;
  return LEGACY_ACTIVITY_ACTION[action] ?? null;
}

const LABEL_ABBR = new Set([
  'SO',
  'JC',
  'PR',
  'PO',
  'NC',
  'GRN',
  'DC',
  'QC',
  'JW',
  'JWSO',
  'BOM',
  'OSP',
  'TPI',
  'CAPA',
  'RTV',
]);

/** Legacy actions whose own words say more than their standard action's
 *  label ("SO Line Closed" vs "Closed") — kept so old rows read as before. */
const LEGACY_ACTIVITY_ACTION_LABEL: Record<string, string> = {
  DISPATCH: 'Dispatched',
  'PERM DELETE': 'Deleted Permanently',
  OP_START: 'Operation Started',
  'OP START': 'Operation Started',
  OP_STOP: 'Operation Stopped',
  OP_COMPLETE: 'Operation Completed',
  'OP COMPLETE': 'Operation Completed',
  PR_CONVERT: 'PR Converted to PO',
  NC_DISPOSE: 'NC Disposition Set',
  NC_CLOSE_REWORK: 'NC Closed after Rework',
  JC_COMPLETE: 'JC Completed',
  SO_LINE_CLOSED: 'SO Line Closed',
  SO_CLOSED: 'SO Closed',
  JW_LINE_CLOSED: 'JWSO Line Closed',
  JW_CLOSED: 'JWSO Closed',
};

/** What a person reads for any stored action — standard, legacy or ad-hoc. */
export function activityActionLabel(action: string): string {
  const legacy = LEGACY_ACTIVITY_ACTION_LABEL[action];
  if (legacy) return legacy;
  const std = canonicalActivityAction(action);
  if (std) return ACTIVITY_ACTION_LABEL[std];
  return action
    .split(/[_ ]+/)
    .filter(Boolean)
    .map((w) =>
      LABEL_ABBR.has(w.toUpperCase())
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(' ');
}

// ── Entities (document types) ──────────────────────────────────────────────

/** Standard document-type names, stored in `activity_log.entity`. */
export const ACTIVITY_ENTITIES = [
  'SalesOrder',
  'JobWorkOrder',
  'Plan',
  'ProductionOrder',
  'JobCard',
  'NonConformance',
  'PurchaseRequest',
  'PurchaseOrder',
  'GoodsReceiptNote',
  'DeliveryChallan',
  'JwDcOutward',
  'JwDcInward',
  'Dispatch',
  'Invoice',
  'JwInvoice',
  'JwReturnChallan',
  'PartyGrn',
  'PartyMaterial',
  'PartyMaterialIssue',
  'StoreIssue',
  'ToolIssue',
  'StockCount',
  'Item',
  'BOM',
  'RouteCard',
  'Vendor',
  'Client',
  'Machine',
  'Operator',
  'Task',
] as const;
export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];

export interface ActivityEntityMeta {
  /** Screen name of the document type. */
  label: string;
  /** Other spellings already stored by older emitters — read, never written. */
  aliases: readonly string[];
  /** Global-search kind, when the document opens through search / a detail page. */
  searchKind: GlobalSearchKind | null;
  /** Access Control form whose `view` gates this document's history. null →
   *  same gate as the global Activity Log. */
  viewForm: AccessFormKey | null;
}

export const ACTIVITY_ENTITY_META: Record<ActivityEntity, ActivityEntityMeta> = {
  SalesOrder: {
    label: 'Sales Order',
    aliases: ['Sales Order', 'SalesOrderLine'],
    searchKind: 'sales-order',
    viewForm: 'so_create',
  },
  JobWorkOrder: {
    label: 'JWSO',
    aliases: ['Job Work Order', 'JobWorkOrderLine'],
    searchKind: 'job-work-order',
    viewForm: 'jw_create',
  },
  Plan: { label: 'Plan', aliases: [], searchKind: 'plan', viewForm: 'plan_create' },
  ProductionOrder: {
    label: 'Production Order',
    aliases: ['Production Order'],
    searchKind: null,
    viewForm: 'prodorder_create',
  },
  JobCard: {
    label: 'Job Card',
    aliases: ['Job Card', 'JcOp', 'JC Operation', 'Op'],
    searchKind: 'job-card',
    viewForm: 'jc_create',
  },
  NonConformance: {
    label: 'NC',
    aliases: ['NC'],
    searchKind: 'nc',
    viewForm: 'nc_dispose',
  },
  PurchaseRequest: {
    label: 'Purchase Request',
    aliases: ['Purchase Request'],
    searchKind: 'purchase-request',
    viewForm: 'pr_create',
  },
  PurchaseOrder: {
    label: 'Purchase Order',
    aliases: ['Purchase Order', 'PurchaseOrderLine'],
    searchKind: 'purchase-order',
    viewForm: 'po_create',
  },
  GoodsReceiptNote: {
    label: 'GRN',
    aliases: ['GRN'],
    searchKind: 'grn',
    viewForm: 'grn_create',
  },
  DeliveryChallan: {
    label: 'OSP DC',
    aliases: ['Delivery Challan'],
    searchKind: 'delivery-challan',
    viewForm: 'ospdc_create',
  },
  JwDcOutward: {
    label: 'JW DC Out',
    aliases: ['JW DC Outward'],
    searchKind: 'jw-dc-outward',
    viewForm: 'ospdc_create',
  },
  JwDcInward: {
    label: 'JW DC In',
    aliases: ['JW DC Inward'],
    searchKind: 'jw-dc-inward',
    viewForm: 'ospdc_create',
  },
  Dispatch: {
    label: 'Dispatch',
    aliases: ['Customer Dispatch'],
    searchKind: 'customer-dispatch',
    viewForm: 'dispatch_create',
  },
  Invoice: { label: 'Invoice', aliases: [], searchKind: 'invoice', viewForm: 'invoice_create' },
  JwInvoice: {
    label: 'JW Invoice',
    aliases: [],
    searchKind: 'jw-invoice',
    viewForm: 'invoice_create',
  },
  JwReturnChallan: {
    label: 'JW Return',
    aliases: [],
    searchKind: 'jw-return',
    viewForm: 'dispatch_create',
  },
  PartyGrn: {
    label: 'Party GRN',
    aliases: ['Party GRN'],
    searchKind: 'party-grn',
    viewForm: 'party_create',
  },
  PartyMaterial: {
    label: 'Party Material',
    aliases: ['Party Material'],
    searchKind: null,
    viewForm: 'party_create',
  },
  PartyMaterialIssue: {
    label: 'Party Issue',
    aliases: [],
    searchKind: 'party-material-issue',
    viewForm: 'party_create',
  },
  StoreIssue: {
    label: 'Store Issue',
    aliases: ['Store Issue'],
    searchKind: 'store-issue',
    viewForm: 'issue_create',
  },
  ToolIssue: {
    label: 'Tool Issue',
    aliases: ['Tool Issue'],
    searchKind: 'tool-issue',
    viewForm: 'toolissue_create',
  },
  StockCount: {
    label: 'Stock Count',
    aliases: ['Stock Count'],
    searchKind: null,
    viewForm: 'stockcount_create',
  },
  Item: { label: 'Item', aliases: [], searchKind: 'item', viewForm: 'item_create' },
  BOM: { label: 'BOM', aliases: [], searchKind: 'bom-master', viewForm: 'bom_create' },
  RouteCard: {
    label: 'Route Card',
    aliases: ['Route Card'],
    searchKind: 'route-card',
    viewForm: 'routecard_create',
  },
  Task: { label: 'Task', aliases: [], searchKind: 'task', viewForm: null },
  Vendor: { label: 'Vendor', aliases: [], searchKind: null, viewForm: 'vendor_create' },
  Client: { label: 'Customer', aliases: ['Customer'], searchKind: null, viewForm: 'client_create' },
  Machine: { label: 'Machine', aliases: [], searchKind: null, viewForm: 'machine_create' },
  Operator: { label: 'Operator', aliases: [], searchKind: null, viewForm: 'operator_create' },
};

/** Stored entity (standard or legacy spelling) → the standard entity, or null
 *  for a type with no document page (users, Access Control, …). */
export function canonicalActivityEntity(entity: string): ActivityEntity | null {
  if ((ACTIVITY_ENTITIES as readonly string[]).includes(entity)) return entity as ActivityEntity;
  for (const e of ACTIVITY_ENTITIES) {
    if (ACTIVITY_ENTITY_META[e].aliases.includes(entity)) return e;
  }
  return null;
}

/** Every stored spelling of one document type — the history query's IN list. */
export function activityEntitySpellings(entity: string): string[] {
  const std = canonicalActivityEntity(entity);
  return std ? [std, ...ACTIVITY_ENTITY_META[std].aliases] : [entity];
}
