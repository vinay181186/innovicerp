// ADR-293 — the documents the AI chat may list / open, each through its own
// module's EXISTING read service and that module's own list-query schema.
import {
  listClientsQuerySchema,
  listItemsQuerySchema,
  listJobCardsQuerySchema,
  listJobWorkOrdersQuerySchema,
  listNcRegisterQuerySchema,
  listProductionOrdersQuerySchema,
  listPurchaseOrdersQuerySchema,
  listSalesOrdersQuerySchema,
  listStoreInventoryQuerySchema,
  listVendorsQuerySchema,
} from '@innovic/shared';
import type { z } from 'zod';
import type { AuthContext } from '../../db/with-user-context';
import { listClients } from '../clients/service';
import { listItems } from '../items/service';
import { getJobCard, listJobCards } from '../job-cards/service';
import { listJobWorkOrderLines } from '../job-work-orders/list-lines';
import { getJobWorkOrder, listJobWorkOrders } from '../job-work-orders/service';
import { getNcRegister, listNcRegister } from '../nc-register/service';
import { getProductionOrder, listProductionOrders } from '../production-orders/service';
import { listPurchaseOrderLines } from '../purchase-orders/list-lines';
import { getPurchaseOrder, listPurchaseOrders } from '../purchase-orders/service';
import { listSalesOrderLines } from '../sales-orders/list-lines';
import { getSalesOrder, listSalesOrders } from '../sales-orders/service';
import { listStoreInventory } from '../store-inventory/service';
import { listVendors } from '../vendors/service';
import { TOOL_ROW_CAP } from './compact';

export interface ListArgs {
  search?: string | undefined;
  status?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
  /** Set by get_document only: include cancelled JC / PRO. */
  includeCancelled?: boolean | undefined;
}

export interface ListKind {
  label: string;
  /** Status words the list's own schema accepts (null = no status filter). */
  statuses: readonly string[] | null;
  hasDates: boolean;
  run(args: ListArgs, user: AuthContext): Promise<unknown>;
}

type ZObj = z.AnyZodObject;

function enumOptions(field: unknown): readonly string[] | null {
  // .optional() / .default() wrap the enum one level deep.
  const f = field as { unwrap?: () => unknown; removeDefault?: () => unknown; options?: unknown };
  const inner = (f?.unwrap?.() ?? f?.removeDefault?.() ?? f) as { options?: unknown };
  return Array.isArray(inner?.options) ? (inner.options as string[]) : null;
}

/** One list kind: args → that module's own schema (bad input = a tool error,
 *  limit forced to 50) → that module's own list service. */
function listKind<S extends ZObj>(
  label: string,
  schema: S,
  list: (q: z.output<S>, user: AuthContext) => Promise<unknown>,
  statusKey = 'status',
): ListKind {
  const shape = schema.shape as Record<string, unknown>;
  return {
    label,
    statuses: enumOptions(shape[statusKey]),
    hasDates: 'fromDate' in shape,
    run: (args, user) =>
      list(
        schema.parse({
          search: args.search,
          [statusKey]: args.status,
          fromDate: args.fromDate,
          toDate: args.toDate,
          // get_document asks for cancelled ones too, so a cancelled JC / PRO
          // is reported as Cancelled, never as "not found".
          ...('includeCancelled' in shape && args.includeCancelled === true
            ? { includeCancelled: 'true' }
            : {}),
          limit: TOOL_ROW_CAP,
        }) as z.output<S>,
        user,
      ),
  };
}

export const LIST_KINDS = {
  sales_orders: listKind('Sales Orders list', listSalesOrdersQuerySchema, listSalesOrders),
  job_work_orders: listKind(
    'Job Work Orders list',
    listJobWorkOrdersQuerySchema,
    listJobWorkOrders,
  ),
  job_cards: listKind('Job Cards list', listJobCardsQuerySchema, listJobCards),
  purchase_orders: listKind(
    'Purchase Orders list',
    listPurchaseOrdersQuerySchema,
    listPurchaseOrders,
  ),
  nc: listKind('NC Register', listNcRegisterQuerySchema, listNcRegister),
  production_orders: listKind(
    'Production Orders list',
    listProductionOrdersQuerySchema,
    listProductionOrders,
  ),
  clients: listKind('Client Master', listClientsQuerySchema, listClients),
  vendors: listKind('Vendor Master', listVendorsQuerySchema, listVendors),
  items: listKind('Item Master', listItemsQuerySchema, listItems),
  store_inventory: listKind(
    'Store Inventory',
    listStoreInventoryQuerySchema,
    listStoreInventory,
    'filter',
  ),
} satisfies Record<string, ListKind>;
export type ListKindName = keyof typeof LIST_KINDS;

/** One row per order line — they carry Pending Qty and the line Due Date. */
export const LINE_KINDS = {
  sales_order_lines: listKind('Sales Order lines', listSalesOrdersQuerySchema, listSalesOrderLines),
  job_work_order_lines: listKind(
    'Job Work Order lines',
    listJobWorkOrdersQuerySchema,
    listJobWorkOrderLines,
  ),
  purchase_order_lines: listKind(
    'Purchase Order lines',
    listPurchaseOrdersQuerySchema,
    listPurchaseOrderLines,
  ),
} satisfies Record<string, ListKind>;
export type LineKindName = keyof typeof LINE_KINDS;

export interface DocKind {
  label: string;
  list: ListKind;
  /** Row keys that may hold the typed document number. */
  codeKeys: readonly string[];
  /** Row key holding the uuid the detail read takes. */
  idKey: string;
  get(id: string, user: AuthContext): Promise<unknown>;
}

export const DOC_KINDS = {
  sales_orders: {
    label: 'Sales Order',
    list: LIST_KINDS.sales_orders,
    codeKeys: ['code', 'internalSoNo'],
    idKey: 'id',
    get: getSalesOrder,
  },
  job_work_orders: {
    label: 'Job Work Order',
    list: LIST_KINDS.job_work_orders,
    codeKeys: ['code'],
    idKey: 'jwId',
    get: getJobWorkOrder,
  },
  job_cards: {
    label: 'Job Card',
    list: LIST_KINDS.job_cards,
    codeKeys: ['code'],
    idKey: 'id',
    get: getJobCard,
  },
  purchase_orders: {
    label: 'Purchase Order',
    list: LIST_KINDS.purchase_orders,
    codeKeys: ['code'],
    idKey: 'id',
    get: getPurchaseOrder,
  },
  nc: {
    label: 'NC',
    list: LIST_KINDS.nc,
    codeKeys: ['code'],
    idKey: 'id',
    get: getNcRegister,
  },
  production_orders: {
    label: 'Production Order',
    list: LIST_KINDS.production_orders,
    codeKeys: ['code'],
    idKey: 'id',
    get: getProductionOrder,
  },
} satisfies Record<string, DocKind>;
export type DocKindName = keyof typeof DOC_KINDS;

/** The rows array of any list response (items / clients / vendors / rows). */
export function rowsOf(res: unknown): Record<string, unknown>[] {
  if (!res || typeof res !== 'object') return [];
  for (const key of ['items', 'rows', 'clients', 'vendors']) {
    const v = (res as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v as Record<string, unknown>[];
  }
  return [];
}
