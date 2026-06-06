import {
  BOM_LINE_TYPES,
  BOM_STATUSES,
  CUSTOMER_DISPATCH_STATUSES,
  DAILY_REPORT_LINE_STATUSES,
  DC_STATUSES,
  GRN_QC_STATUSES,
  INVOICE_STATUSES,
  ITEM_TYPES,
  JC_PRIORITIES,
  NC_DISPOSITIONS,
  NC_REASON_CATEGORIES,
  NC_STATUSES,
  OP_LOG_TYPES,
  OP_TYPES,
  OUTSOURCE_STATUSES,
  PLAN_STATUSES,
  PLAN_TYPES,
  PO_STATUSES,
  PO_TYPES,
  PR_STATUSES,
  PR_TYPES,
  RUNNING_OP_STATUSES,
  SHIFTS,
  SO_STATUSES,
  SO_TYPES,
  STORE_TXN_SOURCE_TYPES,
  STORE_TXN_TYPES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  UOMS,
  USER_ROLES,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const uomEnum = pgEnum('uom', UOMS);
export const itemTypeEnum = pgEnum('item_type', ITEM_TYPES);

// ─── Phase 3 enums (T-024b) ───────────────────────────────────────────────
export const opTypeEnum = pgEnum('op_type', OP_TYPES);
export const opLogTypeEnum = pgEnum('op_log_type', OP_LOG_TYPES);
export const outsourceStatusEnum = pgEnum('outsource_status', OUTSOURCE_STATUSES);
export const runningOpStatusEnum = pgEnum('running_op_status', RUNNING_OP_STATUSES);
export const shiftEnum = pgEnum('shift', SHIFTS);
export const jcPriorityEnum = pgEnum('jc_priority', JC_PRIORITIES);

export const prTypeEnum = pgEnum('pr_type', PR_TYPES);

// ─── Phase 4 enums (T-029b) ───────────────────────────────────────────────
export const soTypeEnum = pgEnum('so_type', SO_TYPES);
export const soStatusEnum = pgEnum('so_status', SO_STATUSES);

// ─── Phase 5 enums (T-035b) ───────────────────────────────────────────────
export const poStatusEnum = pgEnum('po_status', PO_STATUSES);
export const prStatusEnum = pgEnum('pr_status', PR_STATUSES);
export const poTypeEnum = pgEnum('po_type', PO_TYPES);
export const grnQcStatusEnum = pgEnum('grn_qc_status', GRN_QC_STATUSES);
export const storeTxnTypeEnum = pgEnum('store_txn_type', STORE_TXN_TYPES);
export const storeTxnSourceTypeEnum = pgEnum('store_txn_source_type', STORE_TXN_SOURCE_TYPES);

// ─── Phase 6 enums (T-039) ────────────────────────────────────────────────
export const ncStatusEnum = pgEnum('nc_status', NC_STATUSES);
export const ncDispositionEnum = pgEnum('nc_disposition', NC_DISPOSITIONS);
export const ncReasonCategoryEnum = pgEnum('nc_reason_category', NC_REASON_CATEGORIES);
export const dcStatusEnum = pgEnum('dc_status', DC_STATUSES);

// ─── Phase 8 Finance enums (0050) ─────────────────────────────────────────
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const customerDispatchStatusEnum = pgEnum(
  'customer_dispatch_status',
  CUSTOMER_DISPATCH_STATUSES,
);

// ─── Phase 8 BOM Master enums (BOM-1) ─────────────────────────────────────
export const bomStatusEnum = pgEnum('bom_status', BOM_STATUSES);
export const bomLineTypeEnum = pgEnum('bom_line_type', BOM_LINE_TYPES);

// ─── Phase B Planning enums (PL-3) ───────────────────────────────────────
export const planStatusEnum = pgEnum('plan_status', PLAN_STATUSES);
export const planTypeEnum = pgEnum('plan_type', PLAN_TYPES);

// ─── Phase 8 Tasks enums (0051) ───────────────────────────────────────────
export const taskStatusEnum = pgEnum('task_status', TASK_STATUSES);
export const taskPriorityEnum = pgEnum('task_priority', TASK_PRIORITIES);
export const dailyReportLineStatusEnum = pgEnum(
  'daily_report_line_status',
  DAILY_REPORT_LINE_STATUSES,
);

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    gstNumber: text('gst_number'),
    phone: text('phone'),
    // Letterhead footer e-mail (migration 0054) — printed on outward docs.
    email: text('email'),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references((): AnyPgColumn => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references((): AnyPgColumn => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('companies_slug_uniq')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    index('companies_deleted_at_idx').on(t.deletedAt),
    pgPolicy('companies_company_self_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`id = current_company_id()`,
    }),
    pgPolicy('companies_admin_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() = 'admin' AND id = current_company_id()`,
      withCheck: sql`current_user_role() = 'admin' AND id = current_company_id()`,
    }),
  ],
).enableRLS();

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    companyId: uuid('company_id').references(() => companies.id),
    email: text('email').notNull(),
    fullName: text('full_name'),
    role: userRoleEnum('role').notNull().default('viewer'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(false),
    // Per-user PO approval limit (0046). NULL ⇒ fall back to
    // approval_config.po_manager_limit for non-admin approvers.
    // Admin is always unlimited per service-layer check.
    approvalLimit: numeric('approval_limit', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references((): AnyPgColumn => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references((): AnyPgColumn => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('users_company_id_idx')
      .on(t.companyId)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('users_email_uniq')
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('users_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('users_manager_update', {
      for: 'update',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    drawingNo: text('drawing_no'),
    revision: text('revision').notNull().default('A'),
    material: text('material'),
    uom: uomEnum('uom').notNull().default('NOS'),
    itemType: itemTypeEnum('item_type').notNull().default('component'),
    hsnCode: text('hsn_code'),
    drawingFilePath: text('drawing_file_path'),
    /** PL-SI-1 (migration 0028) — low-stock alert threshold per item.
     *  Drives the "Low Stock" tile + per-row red tint on Store/Inventory. */
    minStockQty: integer('min_stock_qty').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('items_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('items_company_id_idx')
      .on(t.companyId)
      .where(sql`${t.deletedAt} is null`),
    index('items_company_type_idx')
      .on(t.companyId, t.itemType)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('items_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('items_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 2 master data (T-014) ──────────────────────────────────────────
// Storage layer only. API/Web modules ship in T-022.
// All four tables follow the items pattern: company_id FK, code unique within
// company while not soft-deleted, audit columns, soft delete, BEFORE UPDATE
// trigger (added in 0002_phase2_master.sql), and the company_read /
// manager_write RLS policy pair.

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    email: text('email'),
    phone: text('phone'),
    gstNumber: text('gst_number'),
    addressLine1: text('address_line1'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('clients_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('clients_company_id_idx')
      .on(t.companyId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('clients_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('clients_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const vendors = pgTable(
  'vendors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    email: text('email'),
    phone: text('phone'),
    gstNumber: text('gst_number'),
    addressLine1: text('address_line1'),
    city: text('city'),
    state: text('state'),
    pincode: text('pincode'),
    materialsSupplied: text('materials_supplied'),
    rating: text('rating'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('vendors_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('vendors_company_id_idx')
      .on(t.companyId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('vendors_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('vendors_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const machines = pgTable(
  'machines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    machineType: text('machine_type'),
    capacityPerShift: integer('capacity_per_shift'),
    shiftsPerDay: integer('shifts_per_day').notNull().default(1),
    status: text('status').notNull().default('Idle'),
    // Hourly machine rate (₹/hr) for SO Costing machine-time (migration 0050).
    hourRate: numeric('hour_rate', { precision: 12, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('machines_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('machines_company_id_idx')
      .on(t.companyId)
      .where(sql`${t.deletedAt} is null`),
    index('machines_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('machines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('machines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const operators = pgTable(
  'operators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    department: text('department'),
    skills: text('skills'),
    isActive: boolean('is_active').notNull().default(true),
    userId: uuid('user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('operators_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('operators_company_id_idx')
      .on(t.companyId)
      .where(sql`${t.deletedAt} is null`),
    index('operators_user_id_idx')
      .on(t.userId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('operators_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('operators_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 6 tables — Quality + Dispatch (T-038, qc_processes only) ──────
// Per ADR-016. Master-data lookup only — per-inspection record table is
// deferred to T-040 (where the workflow UX drives the schema).

export const qcProcesses = pgTable(
  'qc_processes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    description: text('description'),
    defaultCycleTimeMin: numeric('default_cycle_time_min', { precision: 8, scale: 2 })
      .notNull()
      .default('0'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('qc_processes_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('qc_processes_company_active_idx')
      .on(t.companyId, t.isActive)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('qc_processes_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('qc_processes_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Cost Center Master (CC-1, Phase A item 4) ────────────────────────────
// Mirror of legacy renderCostCenters L17165. Sales orders already snapshot
// the code via sales_orders.cost_center (L912) — promoting that to FK is a
// future migration; this slice ships the master only.

export const costCenters = pgTable(
  'cost_centers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    department: text('department'),
    type: text('type'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('cost_centers_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('cost_centers_company_active_idx')
      .on(t.companyId, t.isActive)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('cost_centers_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('cost_centers_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 3 tables — Op Entry Chain (T-024b) ─────────────────────────────
// Per ADR-011 and SCHEMA.md §"Phase 3 Tables".
// Status columns deliberately absent from job_cards / jc_ops — derived via
// SQL views v_jc_op_status / v_jc_status (defined in 0005_phase3_views.sql).

export const routeCards = pgTable(
  'route_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    currentRevision: integer('current_revision').notNull().default(1),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('route_cards_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex('route_cards_company_item_uniq')
      .on(t.companyId, t.itemId)
      .where(sql`${t.deletedAt} is null`),
    index('route_cards_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('route_cards_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('route_cards_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const routeCardOps = pgTable(
  'route_card_ops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    routeCardId: uuid('route_card_id')
      .notNull()
      .references(() => routeCards.id, { onDelete: 'cascade' }),
    opSeq: integer('op_seq').notNull(),
    machineId: uuid('machine_id').references(() => machines.id),
    machineCodeText: text('machine_code_text'),
    operation: text('operation').notNull(),
    opType: opTypeEnum('op_type').notNull().default('process'),
    cycleTimeMin: numeric('cycle_time_min', { precision: 10, scale: 2 }).notNull().default('0'),
    program: text('program'),
    toolNo: text('tool_no'),
    toolDetails: text('tool_details'),
    qcRequired: boolean('qc_required').notNull().default(false),
    // OSP step fields (RC-1, migration 0022). Live FK + free-text
    // fallback + lead days. All nullable; only populated when
    // op_type = 'outsource'.
    ospVendorId: uuid('osp_vendor_id').references(() => vendors.id),
    ospVendorCodeText: text('osp_vendor_code_text'),
    ospLeadDays: integer('osp_lead_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('route_card_ops_card_seq_uniq')
      .on(t.routeCardId, t.opSeq)
      .where(sql`${t.deletedAt} is null`),
    index('route_card_ops_machine_idx')
      .on(t.machineId)
      .where(sql`${t.deletedAt} is null`),
    index('route_card_ops_osp_vendor_idx')
      .on(t.ospVendorId)
      .where(sql`${t.ospVendorId} is not null`),
    pgPolicy('route_card_ops_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('route_card_ops_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const routeCardRevisions = pgTable(
  'route_card_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    routeCardId: uuid('route_card_id')
      .notNull()
      .references(() => routeCards.id, { onDelete: 'cascade' }),
    revisionNo: integer('revision_no').notNull(),
    notes: text('notes'),
    opsSnapshot: jsonb('ops_snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex('route_card_revisions_card_rev_uniq').on(t.routeCardId, t.revisionNo),
    index('route_card_revisions_card_created_idx').on(t.routeCardId, t.createdAt),
    pgPolicy('route_card_revisions_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('route_card_revisions_manager_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const jobCards = pgTable(
  'job_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    jcDate: date('jc_date').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    orderQty: integer('order_qty').notNull(),
    priority: jcPriorityEnum('priority').notNull().default('normal'),
    dueDate: date('due_date'),
    drawingFilePath: text('drawing_file_path'),
    // Source SO/JW link — FKs landed in Phase 4 (0008_phase4_jc_alters.sql)
    // per ADR-012 #2-#4. source_jw_id renamed to source_jw_line_id; both
    // columns now FK-enforced (ON DELETE SET NULL — drop the SO/JW without
    // cascade-deleting JCs) + CHECK num_nonnulls(...) <= 1.
    sourceSoLineId: uuid('source_so_line_id').references((): AnyPgColumn => salesOrderLines.id, {
      onDelete: 'set null',
    }),
    sourceJwLineId: uuid('source_jw_line_id').references((): AnyPgColumn => jobWorkOrderLines.id, {
      onDelete: 'set null',
    }),
    sourceLegacyRef: text('source_legacy_ref'),
    // T-040b — supplementary JC traceability. Set when this JC was created
    // by an NC `make_fresh` disposition. Inherits the original JC's source
    // SO/JW link separately so the T-033 close cascade still works on the
    // supplementary; this column just records the NC origin for reports.
    parentNcId: uuid('parent_nc_id').references((): AnyPgColumn => ncRegister.id, {
      onDelete: 'set null',
    }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('job_cards_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('job_cards_company_item_idx')
      .on(t.companyId, t.itemId)
      .where(sql`${t.deletedAt} is null`),
    index('job_cards_company_due_idx')
      .on(t.companyId, t.dueDate)
      .where(sql`${t.deletedAt} is null AND ${t.closedAt} is null`),
    index('job_cards_company_date_idx')
      .on(t.companyId, t.jcDate)
      .where(sql`${t.deletedAt} is null`),
    index('job_cards_parent_nc_idx')
      .on(t.parentNcId)
      .where(sql`${t.parentNcId} is not null`),
    check('job_cards_order_qty_positive', sql`${t.orderQty} > 0`),
    check(
      'job_cards_source_check',
      sql`num_nonnulls(${t.sourceSoLineId}, ${t.sourceJwLineId}) <= 1`,
    ),
    pgPolicy('job_cards_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('job_cards_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const jcOps = pgTable(
  'jc_ops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jobCardId: uuid('job_card_id')
      .notNull()
      .references(() => jobCards.id, { onDelete: 'cascade' }),
    opSeq: integer('op_seq').notNull(),
    machineId: uuid('machine_id').references(() => machines.id),
    machineCodeText: text('machine_code_text'),
    operation: text('operation').notNull(),
    opType: opTypeEnum('op_type').notNull().default('process'),
    cycleTimeMin: numeric('cycle_time_min', { precision: 10, scale: 2 }).notNull().default('0'),
    program: text('program'),
    toolNo: text('tool_no'),
    toolDetails: text('tool_details'),
    qcRequired: boolean('qc_required').notNull().default(false),
    qcCallDate: date('qc_call_date'),
    qcAttendedDate: date('qc_attended_date'),
    reworkQty: integer('rework_qty').notNull().default(0),
    outsourceVendorId: uuid('outsource_vendor_id').references(() => vendors.id),
    outsourceVendorText: text('outsource_vendor_text'),
    outsourceCost: numeric('outsource_cost', { precision: 12, scale: 2 }).notNull().default('0'),
    outsourceStatus: outsourceStatusEnum('outsource_status'),
    // Phase 5 FK upgrade per ADR-015 #5. Forward-ref to the procurement
    // tables defined later in this file. The legacy text columns
    // (outsource_pr_no, outsource_po_no) these supersede were dropped by
    // 0014_phase5_jc_ops_drop_legacy.sql after T-035c backfill verified.
    outsourcePrId: uuid('outsource_pr_id').references((): AnyPgColumn => purchaseRequests.id, {
      onDelete: 'set null',
    }),
    outsourcePoLineId: uuid('outsource_po_line_id').references(
      (): AnyPgColumn => purchaseOrderLines.id,
      { onDelete: 'set null' },
    ),
    outsourceDcNo: text('outsource_dc_no'),
    outsourceSentQty: integer('outsource_sent_qty').notNull().default(0),
    outsourceSentDate: date('outsource_sent_date'),
    outsourceReturnedQty: integer('outsource_returned_qty').notNull().default(0),
    // Production-scheduling columns added by migration 0034 (Production
    // slices F + G). All nullable — NULL queue_position sorts to end.
    queuePosition: integer('queue_position'),
    plannedStart: date('planned_start'),
    plannedEnd: date('planned_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('jc_ops_card_seq_uniq')
      .on(t.jobCardId, t.opSeq)
      .where(sql`${t.deletedAt} is null`),
    index('jc_ops_machine_idx')
      .on(t.machineId)
      .where(sql`${t.deletedAt} is null`),
    index('jc_ops_company_type_idx')
      .on(t.companyId, t.opType)
      .where(sql`${t.deletedAt} is null`),
    index('jc_ops_outsource_vendor_idx')
      .on(t.outsourceVendorId)
      .where(sql`${t.deletedAt} is null AND ${t.opType} = 'outsource'`),
    index('jc_ops_outsource_pr_id_idx')
      .on(t.outsourcePrId)
      .where(sql`${t.outsourcePrId} is not null`),
    index('jc_ops_outsource_po_line_id_idx')
      .on(t.outsourcePoLineId)
      .where(sql`${t.outsourcePoLineId} is not null`),
    pgPolicy('jc_ops_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('jc_ops_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const opLog = pgTable(
  'op_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jcOpId: uuid('jc_op_id')
      .notNull()
      .references(() => jcOps.id, { onDelete: 'cascade' }),
    logNo: text('log_no').notNull(),
    logType: opLogTypeEnum('log_type').notNull(),
    logDate: date('log_date').notNull(),
    shift: shiftEnum('shift').notNull(),
    qty: integer('qty').notNull().default(0),
    rejectQty: integer('reject_qty').notNull().default(0),
    operatorId: uuid('operator_id').references(() => operators.id),
    operatorName: text('operator_name'),
    startTime: time('start_time'),
    remarks: text('remarks'),
    // TPI (Third Party Inspection) metadata — set on a QC log when it is a TPI
    // inspection (legacy renderTPI L21381 / _tpiSubmit). Migration 0037.
    isTpi: boolean('is_tpi').notNull().default(false),
    tpiInspector: text('tpi_inspector'),
    tpiOrganization: text('tpi_organization'),
    tpiCertNo: text('tpi_cert_no'),
    // QC report attachment — Supabase Storage path (qc-docs bucket) + original
    // file name for a report attached to this QC/TPI entry. Migration 0043.
    qcReportPath: text('qc_report_path'),
    qcReportName: text('qc_report_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index('op_log_company_op_date_idx').on(t.companyId, t.jcOpId, t.logDate),
    index('op_log_company_tpi_idx')
      .on(t.companyId, t.logDate)
      .where(sql`${t.isTpi} = true`),
    index('op_log_company_date_complete_idx')
      .on(t.companyId, t.logDate)
      .where(sql`${t.logType} = 'complete'`),
    index('op_log_operator_date_idx')
      .on(t.operatorId, t.logDate)
      .where(sql`${t.operatorId} is not null`),
    check('op_log_qty_nonneg', sql`${t.qty} >= 0`),
    check('op_log_reject_qty_nonneg', sql`${t.rejectQty} >= 0`),
    pgPolicy('op_log_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('op_log_operator_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() = 'operator' AND company_id = current_company_id() AND log_type IN ('start', 'complete')`,
    }),
    pgPolicy('op_log_qc_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() = 'qc' AND company_id = current_company_id() AND log_type = 'qc'`,
    }),
    pgPolicy('op_log_manager_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const runningOps = pgTable(
  'running_ops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jcOpId: uuid('jc_op_id')
      .notNull()
      .references(() => jcOps.id, { onDelete: 'cascade' }),
    machineId: uuid('machine_id').references(() => machines.id),
    isOsp: boolean('is_osp').notNull().default(false),
    operatorId: uuid('operator_id').references(() => operators.id),
    operatorName: text('operator_name'),
    startDate: date('start_date').notNull(),
    startTime: time('start_time').notNull(),
    shift: shiftEnum('shift').notNull(),
    status: runningOpStatusEnum('status').notNull().default('running'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex('running_ops_op_running_uniq')
      .on(t.companyId, t.jcOpId)
      .where(sql`${t.status} = 'running'`),
    uniqueIndex('running_ops_machine_running_uniq')
      .on(t.machineId)
      .where(sql`${t.status} = 'running' AND ${t.isOsp} = false`),
    index('running_ops_company_status_date_idx').on(t.companyId, t.status, t.startDate),
    pgPolicy('running_ops_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('running_ops_operator_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() = 'operator' AND company_id = current_company_id() AND created_by = (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid`,
      withCheck: sql`current_user_role() = 'operator' AND company_id = current_company_id()`,
    }),
    pgPolicy('running_ops_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 4 tables — Sales Chain (T-029b) ────────────────────────────────
// Per ADR-012 and SCHEMA.md §"Phase 4 Tables".
// Each legacy SO/JW doc was a LINE with header fields repeated; transforms
// group by code (soNo/jwNo) to derive headers. Both header+lines splits use
// the shared so_status enum (auto-close cascade rules are identical).

export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    soDate: date('so_date').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    customerName: text('customer_name'),
    clientPoNo: text('client_po_no'),
    type: soTypeEnum('type').notNull(),
    status: soStatusEnum('status').notNull().default('open'),
    gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull().default('18.00'),
    bomMasterId: text('bom_master_id'),
    bomStatus: text('bom_status'),
    costCenter: text('cost_center'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_orders_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('sales_orders_company_client_idx')
      .on(t.companyId, t.clientId)
      .where(sql`${t.deletedAt} is null`),
    index('sales_orders_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('sales_orders_company_date_idx')
      .on(t.companyId, t.soDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('sales_orders_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('sales_orders_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const salesOrderLines = pgTable(
  'sales_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').references(() => items.id),
    itemCodeText: text('item_code_text'),
    partName: text('part_name').notNull(),
    material: text('material'),
    drawingNo: text('drawing_no'),
    uom: uomEnum('uom').notNull().default('NOS'),
    orderQty: integer('order_qty').notNull(),
    rate: numeric('rate', { precision: 12, scale: 2 }).notNull().default('0'),
    dueDate: date('due_date'),
    // Cumulative customer-dispatched qty (migration 0050). Maintained by the
    // customer-dispatches service; drives pending-dispatch + invoice gating.
    dispatchedQty: integer('dispatched_qty').notNull().default(0),
    clientPoLineNo: text('client_po_line_no'),
    status: soStatusEnum('status').notNull().default('open'),
    // BOM-8 cascade source: when set, SO line creation walks the BOM lines
    // and spawns child JCs / PRs based on bom_type. Forward-ref to bomMasters
    // defined later in this file.
    sourceBomMasterId: uuid('source_bom_master_id').references((): AnyPgColumn => bomMasters.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_order_lines_so_line_uniq')
      .on(t.salesOrderId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('sales_order_lines_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    index('sales_order_lines_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('sales_order_lines_source_bom_idx')
      .on(t.sourceBomMasterId)
      .where(sql`${t.sourceBomMasterId} is not null`),
    check('sales_order_lines_order_qty_positive', sql`${t.orderQty} > 0`),
    pgPolicy('sales_order_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('sales_order_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const jobWorkOrders = pgTable(
  'job_work_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    jwDate: date('jw_date').notNull(),
    clientId: uuid('client_id').references(() => clients.id),
    customerName: text('customer_name'),
    clientPoNo: text('client_po_no'),
    status: soStatusEnum('status').notNull().default('open'),
    remarks: text('remarks'),
    // Client material details (header-level, migration 0053).
    clientMaterial: text('client_material'),
    clientMaterialQty: numeric('client_material_qty', { precision: 12, scale: 2 }),
    materialReceivedDate: date('material_received_date'),
    materialReceivedQty: numeric('material_received_qty', { precision: 12, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('job_work_orders_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('job_work_orders_company_client_idx')
      .on(t.companyId, t.clientId)
      .where(sql`${t.deletedAt} is null`),
    index('job_work_orders_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('job_work_orders_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('job_work_orders_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const jobWorkOrderLines = pgTable(
  'job_work_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jobWorkOrderId: uuid('job_work_order_id')
      .notNull()
      .references(() => jobWorkOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').references(() => items.id),
    itemCodeText: text('item_code_text'),
    partName: text('part_name').notNull(),
    material: text('material'),
    drawingNo: text('drawing_no'),
    uom: uomEnum('uom').notNull().default('NOS'),
    orderQty: integer('order_qty').notNull(),
    rate: numeric('rate', { precision: 12, scale: 2 }).notNull().default('0'),
    dueDate: date('due_date'),
    status: soStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('job_work_order_lines_jw_line_uniq')
      .on(t.jobWorkOrderId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('job_work_order_lines_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    check('job_work_order_lines_order_qty_positive', sql`${t.orderQty} > 0`),
    pgPolicy('job_work_order_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('job_work_order_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 5 tables — Procurement (T-035b) ────────────────────────────────
//
// 5 new tables: purchase_requests, purchase_orders, purchase_order_lines,
// goods_receipt_notes, goods_receipt_note_lines, store_transactions.
// Plus jc_ops gets two new FK columns (outsource_pr_id,
// outsource_po_line_id) defined inline above. The legacy text columns
// (outsource_pr_no, outsource_po_no) were dropped by
// 0014_phase5_jc_ops_drop_legacy.sql once T-035c backfill was verified.
// Forward references via AnyPgColumn handle the circular dep between
// jc_ops and PR/PO_line.

export const purchaseRequests = pgTable(
  'purchase_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    prDate: date('pr_date').notNull(),
    status: prStatusEnum('status').notNull().default('open'),
    prType: prTypeEnum('pr_type').notNull().default('standard'),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    vendorCodeText: text('vendor_code_text'),
    itemId: uuid('item_id').references(() => items.id),
    itemCodeText: text('item_code_text'),
    itemName: text('item_name'),
    qty: integer('qty').notNull(),
    estCost: numeric('est_cost', { precision: 12, scale: 2 }).notNull().default('0'),
    requiredDate: date('required_date'),
    sourceJcOpId: uuid('source_jc_op_id').references((): AnyPgColumn => jcOps.id, {
      onDelete: 'set null',
    }),
    sourceSoLineId: uuid('source_so_line_id').references(() => salesOrderLines.id, {
      onDelete: 'set null',
    }),
    operation: text('operation'),
    remarks: text('remarks'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    poId: uuid('po_id').references((): AnyPgColumn => purchaseOrders.id, {
      onDelete: 'set null',
    }),
    poCreatedAt: timestamp('po_created_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('purchase_requests_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_requests_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_requests_company_vendor_idx')
      .on(t.companyId, t.vendorId)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_requests_source_jc_op_idx')
      .on(t.sourceJcOpId)
      .where(sql`${t.sourceJcOpId} is not null AND ${t.deletedAt} is null`),
    check('purchase_requests_qty_positive', sql`${t.qty} > 0`),
    check(
      'purchase_requests_vendor_check',
      sql`num_nonnulls(${t.vendorId}, ${t.vendorCodeText}) >= 1`,
    ),
    check('purchase_requests_item_check', sql`num_nonnulls(${t.itemId}, ${t.itemCodeText}) >= 1`),
    pgPolicy('purchase_requests_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('purchase_requests_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    poDate: date('po_date').notNull(),
    poType: poTypeEnum('po_type').notNull().default('standard'),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    vendorCodeText: text('vendor_code_text'),
    status: poStatusEnum('status').notNull().default('draft'),
    dueDate: date('due_date'),
    taxType: text('tax_type'),
    sgstPct: numeric('sgst_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    cgstPct: numeric('cgst_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    igstPct: numeric('igst_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    prCodeText: text('pr_code_text'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvalRemarks: text('approval_remarks'),
    rejectedBy: uuid('rejected_by').references(() => users.id),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('purchase_orders_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_orders_company_vendor_idx')
      .on(t.companyId, t.vendorId)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_orders_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_orders_company_date_idx')
      .on(t.companyId, t.poDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('purchase_orders_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('purchase_orders_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').references(() => items.id),
    itemCodeText: text('item_code_text'),
    itemName: text('item_name').notNull(),
    qty: integer('qty').notNull(),
    rate: numeric('rate', { precision: 12, scale: 2 }).notNull().default('0'),
    receivedQty: integer('received_qty').notNull().default(0),
    dueDate: date('due_date'),
    sourceSoLineId: uuid('source_so_line_id').references(() => salesOrderLines.id, {
      onDelete: 'set null',
    }),
    sourceJcOpId: uuid('source_jc_op_id').references((): AnyPgColumn => jcOps.id, {
      onDelete: 'set null',
    }),
    lineRemarks: text('line_remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('purchase_order_lines_po_line_uniq')
      .on(t.purchaseOrderId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_order_lines_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    index('purchase_order_lines_so_line_idx')
      .on(t.sourceSoLineId)
      .where(sql`${t.sourceSoLineId} is not null`),
    index('purchase_order_lines_jc_op_idx')
      .on(t.sourceJcOpId)
      .where(sql`${t.sourceJcOpId} is not null`),
    check('purchase_order_lines_qty_positive', sql`${t.qty} > 0`),
    check(
      'purchase_order_lines_received_qty_check',
      // Allow up to 10% over-receipt (legitimate vendor over-shipments).
      sql`${t.receivedQty} >= 0 AND ${t.receivedQty} <= ${t.qty} + (${t.qty} * 0.1)::int`,
    ),
    pgPolicy('purchase_order_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('purchase_order_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const goodsReceiptNotes = pgTable(
  'goods_receipt_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    grnDate: date('grn_date').notNull(),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, {
      onDelete: 'set null',
    }),
    poCodeText: text('po_code_text'),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    vendorCodeText: text('vendor_code_text'),
    dcNo: text('dc_no'),
    invoiceNo: text('invoice_no'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('goods_receipt_notes_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('goods_receipt_notes_company_po_idx')
      .on(t.companyId, t.purchaseOrderId)
      .where(sql`${t.deletedAt} is null`),
    index('goods_receipt_notes_company_vendor_idx')
      .on(t.companyId, t.vendorId)
      .where(sql`${t.deletedAt} is null`),
    index('goods_receipt_notes_company_date_idx')
      .on(t.companyId, t.grnDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('goods_receipt_notes_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('goods_receipt_notes_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const goodsReceiptNoteLines = pgTable(
  'goods_receipt_note_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    goodsReceiptNoteId: uuid('goods_receipt_note_id')
      .notNull()
      .references(() => goodsReceiptNotes.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLines.id, {
      onDelete: 'set null',
    }),
    itemId: uuid('item_id').references(() => items.id),
    itemCodeText: text('item_code_text'),
    itemName: text('item_name').notNull(),
    receivedQty: integer('received_qty').notNull(),
    dcRefNo: text('dc_ref_no'),
    qcStatus: grnQcStatusEnum('qc_status').notNull().default('pending'),
    qcAcceptedQty: integer('qc_accepted_qty').notNull().default(0),
    qcRejectedQty: integer('qc_rejected_qty').notNull().default(0),
    qcDate: date('qc_date'),
    qcRemarks: text('qc_remarks'),
    qcInspectedBy: uuid('qc_inspected_by').references(() => users.id),
    // Incoming-QC report attachment — Storage path (qc-docs bucket) + file name
    // for the inspection report on this GRN line (legacy _viewQCReport). Mig 0043.
    qcReportPath: text('qc_report_path'),
    qcReportName: text('qc_report_name'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('goods_receipt_note_lines_grn_line_uniq')
      .on(t.goodsReceiptNoteId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('goods_receipt_note_lines_po_line_idx')
      .on(t.purchaseOrderLineId)
      .where(sql`${t.purchaseOrderLineId} is not null`),
    index('goods_receipt_note_lines_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    index('goods_receipt_note_lines_qc_status_idx')
      .on(t.companyId, t.qcStatus)
      .where(sql`${t.deletedAt} is null`),
    check('goods_receipt_note_lines_received_qty_nonneg', sql`${t.receivedQty} >= 0`),
    check('goods_receipt_note_lines_qc_accepted_qty_nonneg', sql`${t.qcAcceptedQty} >= 0`),
    check('goods_receipt_note_lines_qc_rejected_qty_nonneg', sql`${t.qcRejectedQty} >= 0`),
    check(
      'goods_receipt_note_lines_qc_total_check',
      sql`${t.qcAcceptedQty} + ${t.qcRejectedQty} <= ${t.receivedQty}`,
    ),
    pgPolicy('goods_receipt_note_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('goods_receipt_note_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
    // QC role may UPDATE only the QC fields. Forward-defined for Phase 6.
    // Drizzle's pgPolicy doesn't support column-level GRANT — we declare the
    // intent here and the hand-written 0011_phase5_qc_grants.sql migration
    // pins down the exact GRANT UPDATE (qc_status, ...) ON TABLE.
    pgPolicy('goods_receipt_note_lines_qc_update', {
      for: 'update',
      to: 'authenticated',
      using: sql`current_user_role() = 'qc' AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() = 'qc' AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const storeTransactions = pgTable(
  'store_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    txnDate: date('txn_date').notNull(),
    itemId: uuid('item_id').references(() => items.id),
    itemCodeText: text('item_code_text'),
    txnType: storeTxnTypeEnum('txn_type').notNull(),
    qty: integer('qty').notNull(),
    sourceType: storeTxnSourceTypeEnum('source_type').notNull(),
    sourceRef: text('source_ref').notNull(),
    stockBefore: integer('stock_before').notNull(),
    stockAfter: integer('stock_after').notNull(),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index('store_transactions_company_item_date_idx').on(t.companyId, t.itemId, t.txnDate),
    index('store_transactions_company_source_idx').on(t.companyId, t.sourceType, t.sourceRef),
    index('store_transactions_company_date_idx').on(t.companyId, t.txnDate),
    check('store_transactions_qty_positive', sql`${t.qty} > 0`),
    pgPolicy('store_transactions_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('store_transactions_manager_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
    // No UPDATE/DELETE policies — append-only, like op_log per ADR-011 #4.
  ],
).enableRLS();

// ─── T-042: item stock balance cache ─────────────────────────────────────
// Incrementally-maintained materialization of v_item_stock (which is now
// a view over this table). Updated by an AFTER INSERT trigger on
// store_transactions defined in migration 0020. No app-level writes —
// the trigger function runs with SECURITY DEFINER and is the only writer.
// Drizzle entry exists for type safety + future readers; nothing here
// inserts/updates directly.

export const itemStockBalances = pgTable(
  'item_stock_balances',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    onHandQty: integer('on_hand_qty').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.companyId, t.itemId] }),
    index('item_stock_balances_company_idx').on(t.companyId),
    pgPolicy('item_stock_balances_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    // No write policy — the SECURITY DEFINER trigger is the only writer.
  ],
).enableRLS();

// ─── Phase 6 tables — NC + Dispatch (T-039) ───────────────────────────────
// Per ADR-017. Three transactional tables. Legacy `dispatchLog`,
// `jwDCOutward`, `jwDCInward`, `partyMaterials`, `partyGrn`, `ospDC`,
// `outsourceJobs`, `storeIssues` are all doc_missing and intentionally not
// migrated — T-040+ workflows will design fresh tables when UX requirements
// are clear (matches the qcAssignments / qcDocUploads carve-out from ADR-016).

export const ncRegister = pgTable(
  'nc_register',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    ncDate: date('nc_date').notNull(),
    jobCardId: uuid('job_card_id')
      .notNull()
      .references((): AnyPgColumn => jobCards.id),
    jcOpId: uuid('jc_op_id').references((): AnyPgColumn => jcOps.id, {
      onDelete: 'set null',
    }),
    opSeq: integer('op_seq'),
    operationText: text('operation_text'),
    qcOperationText: text('qc_operation_text'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    itemCodeText: text('item_code_text').notNull(),
    itemNameText: text('item_name_text'),
    soCodeText: text('so_code_text'),
    machineCodeText: text('machine_code_text'),
    // Operator who ran the rejected op — legacy Report-NC captured this. Mig 0043.
    operatorText: text('operator_text'),
    rejectedQty: numeric('rejected_qty', { precision: 12, scale: 2 }).notNull(),
    reasonCategory: ncReasonCategoryEnum('reason_category').notNull().default('other'),
    reason: text('reason'),
    disposition: ncDispositionEnum('disposition'),
    dispositionDate: date('disposition_date'),
    dispositionByText: text('disposition_by_text'),
    dispositionRemarks: text('disposition_remarks'),
    reworkJcCodeText: text('rework_jc_code_text'),
    reworkOpSeq: integer('rework_op_seq'),
    reworkDoneQty: numeric('rework_done_qty', { precision: 12, scale: 2 }),
    scrapCost: numeric('scrap_cost', { precision: 12, scale: 2 }).notNull().default('0'),
    status: ncStatusEnum('status').notNull().default('pending'),
    reportedByText: text('reported_by_text'),
    timeLogged: timestamp('time_logged', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('nc_register_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('nc_register_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('nc_register_company_jc_idx')
      .on(t.companyId, t.jobCardId)
      .where(sql`${t.deletedAt} is null`),
    index('nc_register_company_date_idx')
      .on(t.companyId, t.ncDate)
      .where(sql`${t.deletedAt} is null`),
    index('nc_register_jc_op_idx')
      .on(t.jcOpId)
      .where(sql`${t.jcOpId} is not null`),
    index('nc_register_item_idx').on(t.itemId),
    check('nc_register_rejected_qty_positive', sql`${t.rejectedQty} > 0`),
    check(
      'nc_register_rework_done_qty_check',
      sql`${t.reworkDoneQty} is null OR ${t.reworkDoneQty} >= 0`,
    ),
    pgPolicy('nc_register_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('nc_register_entry_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager', 'operator') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager', 'operator') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const deliveryChallans = pgTable(
  'delivery_challans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    dcDate: date('dc_date').notNull(),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, {
      onDelete: 'set null',
    }),
    poCodeText: text('po_code_text').notNull(),
    vendorId: uuid('vendor_id')
      .notNull()
      .references(() => vendors.id),
    vendorCodeText: text('vendor_code_text').notNull(),
    salesOrderLineId: uuid('sales_order_line_id').references(() => salesOrderLines.id, {
      onDelete: 'set null',
    }),
    soRefText: text('so_ref_text'),
    transport: text('transport'),
    status: dcStatusEnum('status').notNull().default('issued'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('delivery_challans_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challans_company_date_idx')
      .on(t.companyId, t.dcDate)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challans_company_po_idx')
      .on(t.companyId, t.purchaseOrderId)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challans_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challans_so_line_idx')
      .on(t.salesOrderLineId)
      .where(sql`${t.salesOrderLineId} is not null`),
    pgPolicy('delivery_challans_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('delivery_challans_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const deliveryChallanLines = pgTable(
  'delivery_challan_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    deliveryChallanId: uuid('delivery_challan_id')
      .notNull()
      .references(() => deliveryChallans.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    itemCodeText: text('item_code_text').notNull(),
    itemNameText: text('item_name_text'),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull(),
    uom: uomEnum('uom').notNull(),
    materialText: text('material_text'),
    dcRemarks: text('dc_remarks'),
    purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLines.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('delivery_challan_lines_dc_line_uniq')
      .on(t.deliveryChallanId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challan_lines_item_idx').on(t.itemId),
    index('delivery_challan_lines_po_line_idx')
      .on(t.purchaseOrderLineId)
      .where(sql`${t.purchaseOrderLineId} is not null`),
    check('delivery_challan_lines_qty_positive', sql`${t.qty} > 0`),
    pgPolicy('delivery_challan_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('delivery_challan_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 6: DC receipts (T-059b — outsource receive-back) ───────────────
// Receipts are many-per-outward-line (partial receives over time). Each
// receipt line captures received + rejected qty against a specific
// delivery_challan_line, with reject_reason required when rejected_qty > 0.
// Auto-NC fires at the service layer on rejected_qty.

export const deliveryChallanReceipts = pgTable(
  'delivery_challan_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    deliveryChallanId: uuid('delivery_challan_id')
      .notNull()
      .references(() => deliveryChallans.id, { onDelete: 'cascade' }),
    receiptCode: text('receipt_code').notNull(),
    receiptDate: date('receipt_date').notNull(),
    vendorInvoiceText: text('vendor_invoice_text'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('delivery_challan_receipts_company_code_uniq')
      .on(t.companyId, t.receiptCode)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challan_receipts_dc_idx')
      .on(t.deliveryChallanId)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challan_receipts_company_date_idx')
      .on(t.companyId, t.receiptDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('delivery_challan_receipts_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('delivery_challan_receipts_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const deliveryChallanReceiptLines = pgTable(
  'delivery_challan_receipt_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => deliveryChallanReceipts.id, { onDelete: 'cascade' }),
    deliveryChallanLineId: uuid('delivery_challan_line_id')
      .notNull()
      .references(() => deliveryChallanLines.id, { onDelete: 'cascade' }),
    receivedQty: numeric('received_qty', { precision: 12, scale: 2 }).notNull(),
    rejectedQty: numeric('rejected_qty', { precision: 12, scale: 2 }).notNull().default('0'),
    rejectReason: text('reject_reason'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('delivery_challan_receipt_lines_receipt_idx')
      .on(t.receiptId)
      .where(sql`${t.deletedAt} is null`),
    index('delivery_challan_receipt_lines_dc_line_idx')
      .on(t.deliveryChallanLineId)
      .where(sql`${t.deletedAt} is null`),
    check('dcr_lines_qty_nonneg', sql`${t.receivedQty} >= 0 AND ${t.rejectedQty} >= 0`),
    check('dcr_lines_qty_positive_sum', sql`${t.receivedQty} + ${t.rejectedQty} > 0`),
    check(
      'dcr_lines_reject_reason_when_rejected',
      sql`${t.rejectedQty} = 0 OR ${t.rejectReason} IS NOT NULL`,
    ),
    pgPolicy('delivery_challan_receipt_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('delivery_challan_receipt_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 8 BOM Master (BOM-1, ports legacy renderBOMMaster L8438) ───────
// Three tables: header + lines + append-only revisions log. Revisions
// store the previous lines[] as jsonb so the diff trail survives even
// after the underlying line rows are replaced on update. sales_order_lines
// gets a source_bom_master_id FK (above) that the BOM-8 cascade walks
// to spawn child JCs / PRs per bom_type. Status (draft/active/obsolete)
// + revision integer auto-bumped on edit.

export const bomMasters = pgTable(
  'bom_masters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    bomNo: text('bom_no').notNull(),
    bomName: text('bom_name').notNull(),
    revision: integer('revision').notNull().default(1),
    status: bomStatusEnum('status').notNull().default('draft'),
    revisionDate: date('revision_date').notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('bom_masters_company_no_uniq')
      .on(t.companyId, t.bomNo)
      .where(sql`${t.deletedAt} is null`),
    index('bom_masters_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('bom_masters_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('bom_masters_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const bomMasterLines = pgTable(
  'bom_master_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    bomMasterId: uuid('bom_master_id')
      .notNull()
      .references(() => bomMasters.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    childItemId: uuid('child_item_id')
      .notNull()
      .references(() => items.id),
    qtyPerSet: numeric('qty_per_set', { precision: 12, scale: 2 }).notNull(),
    bomType: bomLineTypeEnum('bom_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('bom_master_lines_bom_item_uniq')
      .on(t.bomMasterId, t.childItemId)
      .where(sql`${t.deletedAt} is null`),
    index('bom_master_lines_bom_idx')
      .on(t.bomMasterId)
      .where(sql`${t.deletedAt} is null`),
    index('bom_master_lines_item_idx')
      .on(t.childItemId)
      .where(sql`${t.deletedAt} is null`),
    check('bom_master_lines_qty_positive', sql`${t.qtyPerSet} > 0`),
    pgPolicy('bom_master_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('bom_master_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const bomMasterRevisions = pgTable(
  'bom_master_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    bomMasterId: uuid('bom_master_id')
      .notNull()
      .references(() => bomMasters.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    changedByText: text('changed_by_text').notNull(),
    notes: text('notes'),
    itemsSnapshot: jsonb('items_snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex('bom_master_revisions_bom_rev_uniq').on(t.bomMasterId, t.revision),
    index('bom_master_revisions_bom_idx').on(t.bomMasterId),
    pgPolicy('bom_master_revisions_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    // Append-only: only INSERT policy, no UPDATE/DELETE.
    pgPolicy('bom_master_revisions_manager_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 7: saved (ad-hoc) reports (T-041b) ─────────────────────────────
// User-composed report definitions. The `spec` jsonb stores the AdHocSpec
// (sourceKey + columns + filters + groupBy + sumCol + sumFn + sort) — see
// packages/shared/src/schemas/saved-report.ts for the schema. The runner
// validates each spec against a whitelisted source catalog before building
// SQL with bind-vars only — values from `spec` are never interpolated.
//
// RLS:
//   read   — anyone in the company (service filters by owner_id + is_shared)
//   write  — admin/manager OR the owner via service-layer ownership check
//
// The service layer is responsible for filtering shared vs private and for
// enforcing owner-only edits — RLS provides the company isolation floor.

export const savedReports = pgTable(
  'saved_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    sourceKey: text('source_key').notNull(),
    spec: jsonb('spec').notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('saved_reports_company_owner_name_uniq')
      .on(t.companyId, t.ownerId, t.name)
      .where(sql`${t.deletedAt} is null`),
    index('saved_reports_company_shared_idx')
      .on(t.companyId, t.isShared)
      .where(sql`${t.deletedAt} is null`),
    index('saved_reports_owner_idx')
      .on(t.ownerId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('saved_reports_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('saved_reports_company_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
      withCheck: sql`company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 7: alert config (T-041d Phase A) ───────────────────────────────
// Per-company per-rule on/off toggle for the hard-coded alert registry
// (apps/api/src/modules/alerts/definitions/*.ts). Mirrors legacy
// `alertConfig` Firestore collection per ADR-024 — only user overrides of
// the default `active` flag are persisted; rule definitions live in code.
//
// No soft-delete: a row IS the override. If a rule code disappears from
// the registry the orphaned row is harmless leftover.

export const alertConfig = pgTable(
  'alert_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    active: boolean('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex('alert_config_company_code_uniq').on(t.companyId, t.code),
    pgPolicy('alert_config_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('alert_config_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 7: alert subscriptions + deliveries (T-041d Phase B) ───────────
// Per-user opt-in to email delivery of alert digests, plus an append-only
// audit log of dispatch attempts. Per ADR-024:
//   - alert_subscriptions: row IS the subscription. No soft-delete; an
//     unsubscribe is a DELETE. Self or admin/manager can write.
//   - alert_deliveries: append-only (no updated_at / no soft-delete, same
//     shape as activity_log). The (code, user_id, window_start, channel)
//     unique index is the worker's idempotency key — a second tick in the
//     same window hits unique_violation and skips the dispatch.

export const alertSubscriptions = pgTable(
  'alert_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    channel: text('channel').notNull().default('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex('alert_subs_company_user_code_channel_uniq').on(
      t.companyId,
      t.userId,
      t.code,
      t.channel,
    ),
    index('alert_subs_company_code_idx').on(t.companyId, t.code),
    pgPolicy('alert_subs_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('alert_subs_self_or_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))`,
      withCheck: sql`company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))`,
    }),
  ],
).enableRLS();

export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    channel: text('channel').notNull().default('email'),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    messageId: text('message_id').notNull(),
    recordCount: integer('record_count').notNull().default(0),
    realSend: boolean('real_send').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('alert_deliv_idem_uniq').on(t.code, t.userId, t.windowStart, t.channel),
    index('alert_deliv_company_created_idx').on(t.companyId, t.createdAt),
    pgPolicy('alert_deliv_manager_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id() AND current_user_role() IN ('admin','manager')`,
    }),
    pgPolicy('alert_deliv_self_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`company_id = current_company_id() AND user_id = current_user_id()`,
    }),
  ],
).enableRLS();

// ─── Phase 8: activity log (T-051) ────────────────────────────────────────
// Append-only audit trail. Per ADR-019, no soft-delete + no updated_at —
// rows are immutable once written. `action` is text not enum because the
// legacy app emits ad-hoc strings (CREATE / EDIT / DELETE / OP START /
// OP COMPLETE / DISPATCH / IMPORT / RESTORE / PERM DELETE / ...). user_id
// is nullable so legacy "System" / unmapped-user-name rows can survive
// migration; user_name snapshot keeps display intact even if the user is
// hard-deleted later.

export const activityLog = pgTable(
  'activity_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: text('user_name').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    detail: text('detail').notNull().default(''),
    refId: text('ref_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => [
    index('activity_log_company_ts_idx').on(t.companyId, t.ts),
    index('activity_log_company_action_idx').on(t.companyId, t.action),
    index('activity_log_company_user_idx').on(t.companyId, t.userId),
    pgPolicy('activity_log_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('activity_log_manager_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
    // No UPDATE/DELETE policies — append-only.
  ],
).enableRLS();

// ─── Phase B Planning module (PL-3) ──────────────────────────────────────
// Per ADR-030. Wide nullable shape — DP / FO / manufacture / assembly type
// columns coexist; service-layer Zod refines enforce which are required per
// plan_type. DB CHECK constraints (defined in 0024_phase8_plans.sql) lock
// down (type, status) legal combinations + status→FK requirements.

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    planDate: date('plan_date').notNull(),
    planStatus: planStatusEnum('plan_status').notNull().default('in_planning'),
    planType: planTypeEnum('plan_type').notNull(),

    // SO/JW source link
    soLineId: uuid('so_line_id').references(() => salesOrderLines.id, {
      onDelete: 'set null',
    }),
    soCodeText: text('so_code_text'),
    lineNo: integer('line_no'),

    // Item under plan
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text'),
    itemNameText: text('item_name_text'),

    orderQty: integer('order_qty').notNull(),
    planQty: integer('plan_qty').notNull(),

    plannedStartDate: date('planned_start_date'),
    plannedEndDate: date('planned_end_date'),

    bomMasterId: uuid('bom_master_id').references((): AnyPgColumn => bomMasters.id, {
      onDelete: 'set null',
    }),
    bomParentCode: text('bom_parent_code'),
    bomChildCode: text('bom_child_code'),

    jcId: uuid('jc_id').references(() => jobCards.id, { onDelete: 'set null' }),

    dpVendorId: uuid('dp_vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    dpVendorCodeText: text('dp_vendor_code_text'),
    dpCost: numeric('dp_cost', { precision: 12, scale: 2 }),
    dpRemarks: text('dp_remarks'),
    dpPrId: uuid('dp_pr_id').references(() => purchaseRequests.id, { onDelete: 'set null' }),

    foVendorId: uuid('fo_vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    foVendorCodeText: text('fo_vendor_code_text'),
    foProcess: text('fo_process'),
    foRate: numeric('fo_rate', { precision: 12, scale: 2 }),
    foMaterialSrc: text('fo_material_src'),
    foDeliveryDate: date('fo_delivery_date'),
    foCostCenter: text('fo_cost_center'),
    foRemarks: text('fo_remarks'),
    foPrId: uuid('fo_pr_id').references(() => purchaseRequests.id, { onDelete: 'set null' }),
    foMatPrId: uuid('fo_mat_pr_id').references(() => purchaseRequests.id, {
      onDelete: 'set null',
    }),

    materialPrId: uuid('material_pr_id').references(() => purchaseRequests.id, {
      onDelete: 'set null',
    }),

    requiredDocs: jsonb('required_docs').notNull().default(sql`'[]'::jsonb`),

    remarks: text('remarks'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('plans_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('plans_company_status_idx')
      .on(t.companyId, t.planStatus)
      .where(sql`${t.deletedAt} is null`),
    index('plans_so_line_idx')
      .on(t.soLineId)
      .where(sql`${t.soLineId} is not null`),
    index('plans_jc_id_idx')
      .on(t.jcId)
      .where(sql`${t.jcId} is not null`),
    index('plans_item_idx')
      .on(t.itemId)
      .where(sql`${t.itemId} is not null AND ${t.deletedAt} is null`),
    index('plans_company_date_idx')
      .on(t.companyId, t.planDate)
      .where(sql`${t.deletedAt} is null`),
    check('plans_order_qty_positive', sql`${t.orderQty} > 0`),
    check('plans_plan_qty_positive', sql`${t.planQty} > 0`),
    // (type, status) + status→FK CHECKs live in 0024_phase8_plans.sql.
    pgPolicy('plans_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('plans_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const planOps = pgTable(
  'plan_ops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    opSeq: integer('op_seq').notNull(),
    machineId: uuid('machine_id').references(() => machines.id),
    machineCodeText: text('machine_code_text'),
    operation: text('operation').notNull(),
    opType: opTypeEnum('op_type').notNull().default('process'),
    cycleTimeMin: numeric('cycle_time_min', { precision: 10, scale: 2 }).notNull().default('0'),
    program: text('program'),
    toolDetails: text('tool_details'),
    qcRequired: boolean('qc_required').notNull().default(false),
    outsourceVendorId: uuid('outsource_vendor_id').references(() => vendors.id, {
      onDelete: 'set null',
    }),
    outsourceVendorText: text('outsource_vendor_text'),
    outsourceCost: numeric('outsource_cost', { precision: 12, scale: 2 }).notNull().default('0'),
    outsourcePrId: uuid('outsource_pr_id').references(() => purchaseRequests.id, {
      onDelete: 'set null',
    }),
    outsourceLeadDays: integer('outsource_lead_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('plan_ops_plan_seq_uniq')
      .on(t.planId, t.opSeq)
      .where(sql`${t.deletedAt} is null`),
    index('plan_ops_machine_idx')
      .on(t.machineId)
      .where(sql`${t.deletedAt} is null`),
    index('plan_ops_outsource_pr_idx')
      .on(t.outsourcePrId)
      .where(sql`${t.outsourcePrId} is not null`),
    pgPolicy('plan_ops_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('plan_ops_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Phase B Assembly Tracker (PL-5) ─────────────────────────────────────
// Per ADR-030. assembly_units = one row per assembled equipment unit;
// assembly_tracking = manual override per (so_id, child_item_code) for the
// component readiness rollup.

export const assemblyUnits = pgTable(
  'assembly_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    soCodeText: text('so_code_text').notNull(),
    unitNo: integer('unit_no').notNull(),
    serialNo: text('serial_no'),
    assemblyDate: date('assembly_date').notNull(),
    assembledBy: text('assembled_by'),
    remarks: text('remarks'),
    bomMasterId: uuid('bom_master_id').references((): AnyPgColumn => bomMasters.id, {
      onDelete: 'set null',
    }),
    partNoText: text('part_no_text'),
    customerText: text('customer_text'),
    dispatched: boolean('dispatched').notNull().default(false),
    dispatchDate: date('dispatch_date'),
    dispatchedBy: text('dispatched_by'),
    dispatchRemarks: text('dispatch_remarks'),
    deductions: jsonb('deductions'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('assembly_units_so_unit_uniq')
      .on(t.salesOrderId, t.unitNo)
      .where(sql`${t.deletedAt} is null`),
    index('assembly_units_company_dispatch_idx')
      .on(t.companyId, t.dispatched)
      .where(sql`${t.deletedAt} is null`),
    index('assembly_units_serial_idx')
      .on(t.serialNo)
      .where(sql`${t.serialNo} is not null AND ${t.deletedAt} is null`),
    check('assembly_units_unit_no_positive', sql`${t.unitNo} > 0`),
    pgPolicy('assembly_units_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('assembly_units_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const assemblyTracking = pgTable(
  'assembly_tracking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    childItemCode: text('child_item_code').notNull(),
    childItemId: uuid('child_item_id').references(() => items.id, { onDelete: 'set null' }),
    readyQtyOverride: integer('ready_qty_override').notNull().default(0),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('assembly_tracking_so_child_uniq')
      .on(t.salesOrderId, t.childItemCode)
      .where(sql`${t.deletedAt} is null`),
    index('assembly_tracking_company_so_idx')
      .on(t.companyId, t.salesOrderId)
      .where(sql`${t.deletedAt} is null`),
    check('assembly_tracking_override_nonneg', sql`${t.readyQtyOverride} >= 0`),
    pgPolicy('assembly_tracking_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('assembly_tracking_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── PL-TI-1 (migration 0029) — tool_issues + tool_issue_returns ────────
// Returnable items register: tools / inserts / fixtures issued and tracked
// until returned. Multiple returns can land against one issue (partial).
// Only Good qty restores stock; Damaged + Consumed are permanent removals.

export const toolIssues = pgTable(
  'tool_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    issueDate: date('issue_date').notNull(),
    expectedReturnDate: date('expected_return_date'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text'),
    itemName: text('item_name').notNull(),
    qty: integer('qty').notNull(),
    issuedTo: text('issued_to').notNull(),
    refType: text('ref_type'),
    refNo: text('ref_no'),
    purpose: text('purpose'),
    remarks: text('remarks'),
    returnStatus: text('return_status').notNull().default('issued'),
    returnGoodQty: integer('return_good_qty').notNull().default(0),
    returnDamagedQty: integer('return_damaged_qty').notNull().default(0),
    returnConsumedQty: integer('return_consumed_qty').notNull().default(0),
    storeTransactionId: uuid('store_transaction_id').references(
      (): AnyPgColumn => storeTransactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tool_issues_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('tool_issues_company_date_idx')
      .on(t.companyId, t.issueDate)
      .where(sql`${t.deletedAt} is null`),
    index('tool_issues_company_status_idx')
      .on(t.companyId, t.returnStatus)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('tool_issues_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('tool_issues_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const toolIssueReturns = pgTable(
  'tool_issue_returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    toolIssueId: uuid('tool_issue_id')
      .notNull()
      .references((): AnyPgColumn => toolIssues.id, { onDelete: 'cascade' }),
    returnDate: date('return_date').notNull(),
    returnedBy: text('returned_by'),
    goodQty: integer('good_qty').notNull().default(0),
    damagedQty: integer('damaged_qty').notNull().default(0),
    consumedQty: integer('consumed_qty').notNull().default(0),
    remarks: text('remarks'),
    storeTransactionId: uuid('store_transaction_id').references(
      (): AnyPgColumn => storeTransactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('tool_issue_returns_issue_idx')
      .on(t.toolIssueId, t.returnDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('tool_issue_returns_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('tool_issue_returns_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── PL-II-1 (migration 0028) — store_issues ──────────────────────────────
// Daily-use consumable register (legacy renderIssueRegister HTML L23874).
// Write cascades into store_transactions (existing append-only ledger);
// item.stockQty decrements via the same service helper used by GRN.

export const storeIssues = pgTable(
  'store_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    issueDate: date('issue_date').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text'),
    itemName: text('item_name').notNull(),
    qty: integer('qty').notNull(),
    issuedTo: text('issued_to').notNull(),
    refType: text('ref_type'),
    refNo: text('ref_no'),
    purpose: text('purpose'),
    remarks: text('remarks'),
    storeTransactionId: uuid('store_transaction_id').references(
      (): AnyPgColumn => storeTransactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('store_issues_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('store_issues_company_date_idx')
      .on(t.companyId, t.issueDate)
      .where(sql`${t.deletedAt} is null`),
    index('store_issues_company_item_idx')
      .on(t.companyId, t.itemId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('store_issues_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('store_issues_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Store slice 1 (migration 0030) — party_materials ────────────────────
// Catalogue of raw materials supplied by clients for Job Work orders.
// Distinct from `items` master — these belong to the client. Stock is
// tracked separately (issued/received/on-hand) and feeds Party Material
// GRN + JW DC workflows. Legacy `db.partyMaterials` (renderPartyMaterial
// HTML L24129). See docs/PARITY/party-material.md.

export const partyMaterials = pgTable(
  'party_materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    material: text('material'),
    uom: text('uom').notNull().default('NOS'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    clientCodeText: text('client_code_text'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text'),
    stockQty: integer('stock_qty').notNull().default(0),
    issuedQty: integer('issued_qty').notNull().default(0),
    receivedQty: integer('received_qty').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('party_materials_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('party_materials_company_client_idx')
      .on(t.companyId, t.clientId)
      .where(sql`${t.deletedAt} is null`),
    index('party_materials_company_item_idx')
      .on(t.companyId, t.itemId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('party_materials_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('party_materials_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Store slice 2 (migration 0031) — party_grn + party_grn_lines ────────
// Records client-supplied raw material received against a JW order.
// Mirrors legacy db.partyGrn (renderPartyGRN HTML L24251) + addPartyGRN
// (L24298). Numbering: PGRN-NNNNN.

export const partyGrn = pgTable(
  'party_grn',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    grnDate: date('grn_date').notNull(),
    jobWorkOrderId: uuid('job_work_order_id').references(() => jobWorkOrders.id, {
      onDelete: 'set null',
    }),
    jwCodeText: text('jw_code_text'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    clientCodeText: text('client_code_text'),
    clientPoNo: text('client_po_no'),
    dcNo: text('dc_no'),
    remarks: text('remarks'),
    receivedByText: text('received_by_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('party_grn_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('party_grn_company_date_idx')
      .on(t.companyId, t.grnDate)
      .where(sql`${t.deletedAt} is null`),
    index('party_grn_company_jw_idx')
      .on(t.companyId, t.jobWorkOrderId)
      .where(sql`${t.deletedAt} is null`),
    index('party_grn_company_client_idx')
      .on(t.companyId, t.clientId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('party_grn_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('party_grn_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const partyGrnLines = pgTable(
  'party_grn_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    partyGrnId: uuid('party_grn_id')
      .notNull()
      .references((): AnyPgColumn => partyGrn.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    partyMaterialId: uuid('party_material_id').references((): AnyPgColumn => partyMaterials.id, {
      onDelete: 'set null',
    }),
    partyMaterialCodeText: text('party_material_code_text').notNull(),
    partyMaterialName: text('party_material_name'),
    receivedQty: integer('received_qty').notNull(),
    jwLineNoText: text('jw_line_no_text'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('party_grn_lines_grn_idx')
      .on(t.partyGrnId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('party_grn_lines_material_idx')
      .on(t.partyMaterialId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('party_grn_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('party_grn_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Store slice 3 (migration 0032) — JW Delivery Challan (4 tables) ────
// Outward = Returnable Gate Pass (material sent to JW vendor). Inward =
// material received back (with OK/Rejected split). Mirrors legacy
// renderJWDC (HTML L24434). Numbering: JWDC-OUT-NNNN / JWIN-NNNN.

export const jwDcOutward = pgTable(
  'jw_dc_outward',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    dcDate: date('dc_date').notNull(),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, {
      onDelete: 'set null',
    }),
    jwpoCodeText: text('jwpo_code_text'),
    vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
    vendorCodeText: text('vendor_code_text'),
    vendorNameText: text('vendor_name_text'),
    vehicleNo: text('vehicle_no'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('jw_dc_outward_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('jw_dc_outward_company_date_idx')
      .on(t.companyId, t.dcDate)
      .where(sql`${t.deletedAt} is null`),
    index('jw_dc_outward_company_po_idx')
      .on(t.companyId, t.purchaseOrderId)
      .where(sql`${t.deletedAt} is null`),
    index('jw_dc_outward_company_vendor_idx')
      .on(t.companyId, t.vendorId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('jw_dc_outward_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('jw_dc_outward_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const jwDcOutwardLines = pgTable(
  'jw_dc_outward_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jwDcOutwardId: uuid('jw_dc_outward_id')
      .notNull()
      .references((): AnyPgColumn => jwDcOutward.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    purchaseOrderLineId: uuid('purchase_order_line_id').references(
      () => purchaseOrderLines.id,
      { onDelete: 'set null' },
    ),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text').notNull(),
    itemNameText: text('item_name_text'),
    processText: text('process_text'),
    poQty: integer('po_qty').notNull().default(0),
    sentQty: integer('sent_qty').notNull(),
    storeTransactionId: uuid('store_transaction_id').references(
      (): AnyPgColumn => storeTransactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('jw_dc_outward_lines_dc_idx')
      .on(t.jwDcOutwardId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('jw_dc_outward_lines_po_line_idx')
      .on(t.purchaseOrderLineId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('jw_dc_outward_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('jw_dc_outward_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const jwDcInward = pgTable(
  'jw_dc_inward',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    inwardDate: date('inward_date').notNull(),
    jwDcOutwardId: uuid('jw_dc_outward_id')
      .notNull()
      .references((): AnyPgColumn => jwDcOutward.id, { onDelete: 'restrict' }),
    dcCodeText: text('dc_code_text'),
    vendorChallanNo: text('vendor_challan_no'),
    vehicleNo: text('vehicle_no'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('jw_dc_inward_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('jw_dc_inward_company_date_idx')
      .on(t.companyId, t.inwardDate)
      .where(sql`${t.deletedAt} is null`),
    index('jw_dc_inward_company_dc_idx')
      .on(t.companyId, t.jwDcOutwardId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('jw_dc_inward_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('jw_dc_inward_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const jwDcInwardLines = pgTable(
  'jw_dc_inward_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jwDcInwardId: uuid('jw_dc_inward_id')
      .notNull()
      .references((): AnyPgColumn => jwDcInward.id, { onDelete: 'cascade' }),
    jwDcOutwardLineId: uuid('jw_dc_outward_line_id')
      .notNull()
      .references((): AnyPgColumn => jwDcOutwardLines.id, { onDelete: 'restrict' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text').notNull(),
    itemNameText: text('item_name_text'),
    processText: text('process_text'),
    sentQty: integer('sent_qty').notNull().default(0),
    receivedQty: integer('received_qty').notNull(),
    okQty: integer('ok_qty').notNull().default(0),
    rejectedQty: integer('rejected_qty').notNull().default(0),
    remarks: text('remarks'),
    storeTransactionId: uuid('store_transaction_id').references(
      (): AnyPgColumn => storeTransactions.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('jw_dc_inward_lines_inward_idx')
      .on(t.jwDcInwardId)
      .where(sql`${t.deletedAt} is null`),
    index('jw_dc_inward_lines_outward_line_idx')
      .on(t.jwDcOutwardLineId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('jw_dc_inward_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('jw_dc_inward_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Design Section (migration 0033) — 8 tables ─────────────────────────
// Mirrors legacy renderDesignTracker L7259 + renderDesignProjects L7570 +
// renderDesignIssuesPage L7890 + renderDesignWorkLog L7935.
// See docs/PARITY/design-section.md.

export const designTracker = pgTable(
  'design_tracker',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, {
      onDelete: 'set null',
    }),
    soCodeText: text('so_code_text'),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text'),
    itemNameText: text('item_name_text'),
    designer: text('designer').notNull(),
    estimatedHours: numeric('estimated_hours', { precision: 8, scale: 2 }).notNull().default('0'),
    startDate: date('start_date').notNull(),
    targetDate: date('target_date').notNull(),
    status: text('status').notNull().default('In Progress'),
    revision: integer('revision').notNull().default(0),
    remarks: text('remarks'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByText: text('approved_by_text'),
    reviewSubmittedAt: timestamp('review_submitted_at', { withTimezone: true }),
    revisionHistory: jsonb('revision_history').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('design_tracker_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('design_tracker_company_so_idx')
      .on(t.companyId, t.salesOrderId)
      .where(sql`${t.deletedAt} is null`),
    index('design_tracker_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_tracker_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_tracker_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const designTimeLog = pgTable(
  'design_time_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    designTrackerId: uuid('design_tracker_id')
      .notNull()
      .references((): AnyPgColumn => designTracker.id, { onDelete: 'cascade' }),
    logDate: date('log_date').notNull(),
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
    workerText: text('worker_text').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('design_time_log_tracker_idx')
      .on(t.designTrackerId, t.logDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_time_log_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_time_log_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const designProjects = pgTable(
  'design_projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    projectName: text('project_name').notNull(),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, {
      onDelete: 'set null',
    }),
    soCodeText: text('so_code_text'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    clientText: text('client_text'),
    leadText: text('lead_text'),
    engineers: jsonb('engineers').notNull().default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('Design Active'),
    startDate: date('start_date').notNull(),
    targetDate: date('target_date').notNull(),
    description: text('description'),
    checklist: jsonb('checklist').notNull().default(sql`'{}'::jsonb`),
    releasedDate: date('released_date'),
    releasedByText: text('released_by_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('design_projects_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('design_projects_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_projects_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_projects_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const designTasks = pgTable(
  'design_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    designProjectId: uuid('design_project_id')
      .notNull()
      .references((): AnyPgColumn => designProjects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    partText: text('part_text'),
    assigneeText: text('assignee_text'),
    priority: text('priority').notNull().default('Medium'),
    status: text('status').notNull().default('Not Started'),
    dueDate: date('due_date'),
    description: text('description'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    discussions: jsonb('discussions').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('design_tasks_project_idx')
      .on(t.designProjectId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_tasks_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_tasks_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const designIssues = pgTable(
  'design_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    designProjectId: uuid('design_project_id')
      .notNull()
      .references((): AnyPgColumn => designProjects.id, { onDelete: 'cascade' }),
    designTaskId: uuid('design_task_id').references((): AnyPgColumn => designTasks.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    partText: text('part_text'),
    severity: text('severity').notNull().default('Major'),
    status: text('status').notNull().default('Open'),
    raisedByText: text('raised_by_text'),
    assignedToText: text('assigned_to_text'),
    raisedDate: date('raised_date').notNull(),
    resolvedDate: date('resolved_date'),
    description: text('description'),
    discussions: jsonb('discussions').notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('design_issues_project_idx')
      .on(t.designProjectId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('design_issues_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_issues_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_issues_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const designWorkLog = pgTable(
  'design_work_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    logDate: date('log_date').notNull(),
    engineerText: text('engineer_text').notNull(),
    designProjectId: uuid('design_project_id').references((): AnyPgColumn => designProjects.id, {
      onDelete: 'set null',
    }),
    taskText: text('task_text'),
    category: text('category').notNull().default('Design'),
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('design_work_log_company_date_idx')
      .on(t.companyId, t.logDate)
      .where(sql`${t.deletedAt} is null`),
    index('design_work_log_engineer_date_idx')
      .on(t.companyId, t.engineerText, t.logDate)
      .where(sql`${t.deletedAt} is null`),
    index('design_work_log_project_idx')
      .on(t.designProjectId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_work_log_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_work_log_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const designDcrs = pgTable(
  'design_dcrs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    designProjectId: uuid('design_project_id')
      .notNull()
      .references((): AnyPgColumn => designProjects.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    changeType: text('change_type').notNull().default('Other'),
    partAffected: text('part_affected'),
    priority: text('priority').notNull().default('Normal'),
    status: text('status').notNull().default('Submitted'),
    requestedByText: text('requested_by_text'),
    requestDate: date('request_date').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('design_dcrs_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('design_dcrs_project_idx')
      .on(t.designProjectId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_dcrs_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_dcrs_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const designDcns = pgTable(
  'design_dcns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    designProjectId: uuid('design_project_id')
      .notNull()
      .references((): AnyPgColumn => designProjects.id, { onDelete: 'cascade' }),
    linkedDcrId: uuid('linked_dcr_id').references((): AnyPgColumn => designDcrs.id, {
      onDelete: 'set null',
    }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('Draft'),
    description: text('description'),
    releasedDate: date('released_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('design_dcns_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('design_dcns_project_idx')
      .on(t.designProjectId, t.status)
      .where(sql`${t.deletedAt} is null`),
    index('design_dcns_dcr_idx')
      .on(t.linkedDcrId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('design_dcns_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('design_dcns_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── PL-PSV-1 (migration 0027) — invoices + invoice_lines ────────────────
// Sales-side revenue / cashflow tracking. Drives the Pending SO Value report
// (legacy renderPendingSOValue HTML L19272). See docs/PARITY/pendingsovalue.md.

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    soCodeText: text('so_code_text'),
    // Client snapshot (migration 0050) — invoice prints from these even if the
    // client master later changes. clientId for the live link.
    clientId: uuid('client_id').references(() => clients.id),
    clientNameText: text('client_name_text'),
    clientCodeText: text('client_code_text'),
    clientGstText: text('client_gst_text'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    gstPercent: numeric('gst_percent', { precision: 5, scale: 2 }).notNull().default('18'),
    gstAmount: numeric('gst_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    grandTotal: numeric('grand_total', { precision: 14, scale: 2 }).notNull().default('0'),
    totalPaid: numeric('total_paid', { precision: 14, scale: 2 }).notNull().default('0'),
    paymentTermsDays: integer('payment_terms_days').notNull().default(45),
    dueDate: date('due_date'),
    status: invoiceStatusEnum('status').notNull().default('unpaid'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('invoices_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('invoices_company_so_idx')
      .on(t.companyId, t.salesOrderId)
      .where(sql`${t.deletedAt} is null`),
    index('invoices_company_date_idx')
      .on(t.companyId, t.invoiceDate)
      .where(sql`${t.deletedAt} is null`),
    index('invoices_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('invoices_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('invoices_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text'),
    itemName: text('item_name').notNull(),
    qty: integer('qty').notNull(),
    rate: numeric('rate', { precision: 12, scale: 2 }).notNull().default('0'),
    lineAmount: numeric('line_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    salesOrderLineId: uuid('sales_order_line_id').references(() => salesOrderLines.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('invoice_lines_invoice_line_uniq')
      .on(t.invoiceId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('invoice_lines_so_line_idx')
      .on(t.salesOrderLineId)
      .where(sql`${t.salesOrderLineId} is not null and ${t.deletedAt} is null`),
    pgPolicy('invoice_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('invoice_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Finance: invoice payments (migration 0050) ───────────────────────────
// One row per receipt against an invoice. invoices.total_paid + status are
// maintained by the invoices service on payment insert/cancel.
export const invoicePayments = pgTable(
  'invoice_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    paymentDate: date('payment_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    mode: text('mode').notNull().default('NEFT'),
    refNo: text('ref_no'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('invoice_payments_invoice_idx')
      .on(t.invoiceId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('invoice_payments_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('invoice_payments_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Customer dispatch (migration 0050) ───────────────────────────────────
// Records dispatch of ready (produced + QC-accepted) qty against SO lines —
// the customer Dispatch Register. The line service maintains
// sales_order_lines.dispatched_qty (increment on create, decrement on cancel).
export const customerDispatches = pgTable(
  'customer_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    dispatchDate: date('dispatch_date').notNull(),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id),
    soCodeText: text('so_code_text'),
    customerText: text('customer_text'),
    transport: text('transport'),
    vehicleNo: text('vehicle_no'),
    status: customerDispatchStatusEnum('status').notNull().default('dispatched'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('customer_dispatches_company_code_uq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('customer_dispatches_company_so_idx')
      .on(t.companyId, t.salesOrderId)
      .where(sql`${t.deletedAt} is null`),
    index('customer_dispatches_company_date_idx')
      .on(t.companyId, t.dispatchDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('customer_dispatches_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('customer_dispatches_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export const customerDispatchLines = pgTable(
  'customer_dispatch_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    customerDispatchId: uuid('customer_dispatch_id')
      .notNull()
      .references(() => customerDispatches.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    salesOrderLineId: uuid('sales_order_line_id').references(() => salesOrderLines.id, {
      onDelete: 'set null',
    }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    itemCodeText: text('item_code_text'),
    itemName: text('item_name').notNull(),
    qty: integer('qty').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('customer_dispatch_lines_line_uq')
      .on(t.customerDispatchId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('customer_dispatch_lines_so_line_idx')
      .on(t.salesOrderLineId)
      .where(sql`${t.salesOrderLineId} is not null and ${t.deletedAt} is null`),
    check('customer_dispatch_lines_qty_positive', sql`${t.qty} > 0`),
    pgPolicy('customer_dispatch_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('customer_dispatch_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

// ─── Tasks: Task Board (migration 0051) ───────────────────────────────────
// Mirror of legacy taskAllocations / renderTaskBoard. Overdue is DERIVED
// (status != 'completed' && due_date < today), never stored.
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    assignedBy: uuid('assigned_by').references(() => users.id),
    priority: taskPriorityEnum('priority').notNull().default('medium'),
    dueDate: date('due_date').notNull(),
    status: taskStatusEnum('status').notNull().default('todo'),
    startedDate: date('started_date'),
    completedDate: date('completed_date'),
    // Contextual link to a source record (PR/PO/SO/NC/CAPA/JC/GRN/DESIGN).
    linkedRefType: text('linked_ref_type'),
    linkedRefId: text('linked_ref_id'),
    linkedRefDisplay: text('linked_ref_display'),
    linkedRefNavPage: text('linked_ref_nav_page'),
    // Null = unread by the assignee. Stamped when the assignee opens the board.
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('tasks_company_code_uq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('tasks_company_assignee_idx')
      .on(t.companyId, t.assignedTo)
      .where(sql`${t.deletedAt} is null`),
    index('tasks_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('tasks_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    // Assignee may update their own task (status/comments keep assigned_to
    // unchanged); admin/manager may assign/edit anything.
    pgPolicy('tasks_self_or_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`company_id = current_company_id() AND (assigned_to = current_user_id() OR current_user_role() IN ('admin','manager'))`,
      withCheck: sql`company_id = current_company_id() AND (assigned_to = current_user_id() OR current_user_role() IN ('admin','manager'))`,
    }),
  ],
).enableRLS();

export const taskComments = pgTable(
  'task_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    commentDate: date('comment_date').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('task_comments_task_idx')
      .on(t.taskId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('task_comments_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('task_comments_self_or_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager'))`,
      withCheck: sql`company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager'))`,
    }),
  ],
).enableRLS();

// ─── Tasks: Daily Task Reports (migration 0051) ───────────────────────────
// Mirror of legacy dailyReports / renderDailyReports. User-submitted "what I
// did today" reports. DISTINCT from the production op-log daily report.
export const dailyReports = pgTable(
  'daily_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    reportDate: date('report_date').notNull(),
    shift: shiftEnum('shift').notNull().default('day'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('daily_reports_company_user_idx')
      .on(t.companyId, t.userId)
      .where(sql`${t.deletedAt} is null`),
    index('daily_reports_company_date_idx')
      .on(t.companyId, t.reportDate)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('daily_reports_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('daily_reports_self_or_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))`,
      withCheck: sql`company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))`,
    }),
  ],
).enableRLS();

export const dailyReportLines = pgTable(
  'daily_report_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    dailyReportId: uuid('daily_report_id')
      .notNull()
      .references(() => dailyReports.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    description: text('description').notNull(),
    ref: text('ref'),
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull().default('0'),
    status: dailyReportLineStatusEnum('status').notNull().default('completed'),
    remarks: text('remarks'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('daily_report_lines_line_uq')
      .on(t.dailyReportId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('daily_report_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('daily_report_lines_self_or_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager'))`,
      withCheck: sql`company_id = current_company_id() AND (created_by = current_user_id() OR current_user_role() IN ('admin','manager'))`,
    }),
  ],
).enableRLS();

// ─── Dashboard: per-user home layout preference (migration 0052) ───────────
// Mirror of legacy db.dashboardConfig = [{userId, widgets:[keys], quickLinks:
// [pages]}]. widgets/quick_links are ordered lists of UI keys (layout
// preference) — jsonb, not the entity-blob anti-pattern. null = show all.
export const dashboardConfig = pgTable(
  'dashboard_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    widgets: jsonb('widgets').$type<string[]>(),
    quickLinks: jsonb('quick_links').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('dashboard_config_company_user_uq')
      .on(t.companyId, t.userId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('dashboard_config_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('dashboard_config_self_or_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))`,
      withCheck: sql`company_id = current_company_id() AND (user_id = current_user_id() OR current_user_role() IN ('admin','manager'))`,
    }),
  ],
).enableRLS();

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
export type Machine = typeof machines.$inferSelect;
export type NewMachine = typeof machines.$inferInsert;
export type Operator = typeof operators.$inferSelect;
export type NewOperator = typeof operators.$inferInsert;
export type RouteCard = typeof routeCards.$inferSelect;
export type NewRouteCard = typeof routeCards.$inferInsert;
export type RouteCardOp = typeof routeCardOps.$inferSelect;
export type NewRouteCardOp = typeof routeCardOps.$inferInsert;
export type RouteCardRevision = typeof routeCardRevisions.$inferSelect;
export type NewRouteCardRevision = typeof routeCardRevisions.$inferInsert;
export type JobCard = typeof jobCards.$inferSelect;
export type NewJobCard = typeof jobCards.$inferInsert;
export type JcOp = typeof jcOps.$inferSelect;
export type NewJcOp = typeof jcOps.$inferInsert;
export type OpLog = typeof opLog.$inferSelect;
export type NewOpLog = typeof opLog.$inferInsert;
export type RunningOp = typeof runningOps.$inferSelect;
export type NewRunningOp = typeof runningOps.$inferInsert;
export type SalesOrder = typeof salesOrders.$inferSelect;
export type NewSalesOrder = typeof salesOrders.$inferInsert;
export type SalesOrderLine = typeof salesOrderLines.$inferSelect;
export type NewSalesOrderLine = typeof salesOrderLines.$inferInsert;
export type JobWorkOrder = typeof jobWorkOrders.$inferSelect;
export type NewJobWorkOrder = typeof jobWorkOrders.$inferInsert;
export type JobWorkOrderLine = typeof jobWorkOrderLines.$inferSelect;
export type NewJobWorkOrderLine = typeof jobWorkOrderLines.$inferInsert;
export type PurchaseRequest = typeof purchaseRequests.$inferSelect;
export type NewPurchaseRequest = typeof purchaseRequests.$inferInsert;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderLine = typeof purchaseOrderLines.$inferSelect;
export type NewPurchaseOrderLine = typeof purchaseOrderLines.$inferInsert;
export type GoodsReceiptNote = typeof goodsReceiptNotes.$inferSelect;
export type NewGoodsReceiptNote = typeof goodsReceiptNotes.$inferInsert;
export type GoodsReceiptNoteLine = typeof goodsReceiptNoteLines.$inferSelect;
export type NewGoodsReceiptNoteLine = typeof goodsReceiptNoteLines.$inferInsert;
export type StoreTransaction = typeof storeTransactions.$inferSelect;
export type NewStoreTransaction = typeof storeTransactions.$inferInsert;
export type NcRegister = typeof ncRegister.$inferSelect;
export type NewNcRegister = typeof ncRegister.$inferInsert;
export type DeliveryChallan = typeof deliveryChallans.$inferSelect;
export type NewDeliveryChallan = typeof deliveryChallans.$inferInsert;
export type DeliveryChallanLine = typeof deliveryChallanLines.$inferSelect;
export type NewDeliveryChallanLine = typeof deliveryChallanLines.$inferInsert;
export type SavedReport = typeof savedReports.$inferSelect;
export type NewSavedReport = typeof savedReports.$inferInsert;
export type AlertConfig = typeof alertConfig.$inferSelect;
export type NewAlertConfig = typeof alertConfig.$inferInsert;
export type AlertSubscription = typeof alertSubscriptions.$inferSelect;
export type NewAlertSubscription = typeof alertSubscriptions.$inferInsert;
export type AlertDelivery = typeof alertDeliveries.$inferSelect;
export type NewAlertDelivery = typeof alertDeliveries.$inferInsert;
export type ActivityLog = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;
export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type PlanOp = typeof planOps.$inferSelect;
export type NewPlanOp = typeof planOps.$inferInsert;
export type AssemblyUnit = typeof assemblyUnits.$inferSelect;
export type NewAssemblyUnit = typeof assemblyUnits.$inferInsert;
export type AssemblyTracking = typeof assemblyTracking.$inferSelect;
export type NewAssemblyTracking = typeof assemblyTracking.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLine = typeof invoiceLines.$inferSelect;
export type NewInvoiceLine = typeof invoiceLines.$inferInsert;
export type StoreIssue = typeof storeIssues.$inferSelect;
export type NewStoreIssue = typeof storeIssues.$inferInsert;
export type ToolIssue = typeof toolIssues.$inferSelect;
export type NewToolIssue = typeof toolIssues.$inferInsert;
export type ToolIssueReturn = typeof toolIssueReturns.$inferSelect;
export type NewToolIssueReturn = typeof toolIssueReturns.$inferInsert;
export type PartyMaterial = typeof partyMaterials.$inferSelect;
export type NewPartyMaterial = typeof partyMaterials.$inferInsert;
export type PartyGrn = typeof partyGrn.$inferSelect;
export type NewPartyGrn = typeof partyGrn.$inferInsert;
export type PartyGrnLine = typeof partyGrnLines.$inferSelect;
export type NewPartyGrnLine = typeof partyGrnLines.$inferInsert;
export type JwDcOutward = typeof jwDcOutward.$inferSelect;
export type NewJwDcOutward = typeof jwDcOutward.$inferInsert;
export type JwDcOutwardLine = typeof jwDcOutwardLines.$inferSelect;
export type NewJwDcOutwardLine = typeof jwDcOutwardLines.$inferInsert;
export type JwDcInward = typeof jwDcInward.$inferSelect;
export type NewJwDcInward = typeof jwDcInward.$inferInsert;
export type JwDcInwardLine = typeof jwDcInwardLines.$inferSelect;
export type NewJwDcInwardLine = typeof jwDcInwardLines.$inferInsert;
export type DesignTracker = typeof designTracker.$inferSelect;
export type NewDesignTracker = typeof designTracker.$inferInsert;
export type DesignTimeLog = typeof designTimeLog.$inferSelect;
export type NewDesignTimeLog = typeof designTimeLog.$inferInsert;
export type DesignProject = typeof designProjects.$inferSelect;
export type NewDesignProject = typeof designProjects.$inferInsert;
export type DesignTask = typeof designTasks.$inferSelect;
export type NewDesignTask = typeof designTasks.$inferInsert;
export type DesignIssue = typeof designIssues.$inferSelect;
export type NewDesignIssue = typeof designIssues.$inferInsert;
export type DesignWorkLog = typeof designWorkLog.$inferSelect;
export type NewDesignWorkLog = typeof designWorkLog.$inferInsert;
export type DesignDcr = typeof designDcrs.$inferSelect;
export type NewDesignDcr = typeof designDcrs.$inferInsert;
export type DesignDcn = typeof designDcns.$inferSelect;
export type NewDesignDcn = typeof designDcns.$inferInsert;

// ─── CAPA (Corrective & Preventive Action) — migration 0036 ───────────────
// Mirrors legacy renderCAPA L22779 + _capaNew/_capaEdit (5-step process).
export const capaRecords = pgTable(
  'capa_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    code: text('code').notNull(), // CAPA-NNNN
    type: text('type').notNull().default('Corrective'), // Corrective | Preventive
    capaDate: date('capa_date').notNull(),
    ncRefs: jsonb('nc_refs').notNull().default(sql`'[]'::jsonb`), // [ncNo, ...]
    jcNo: text('jc_no'),
    soNo: text('so_no'),
    itemCode: text('item_code'),
    operation: text('operation'),
    problem: text('problem').notNull(),
    rootCauseMethod: text('root_cause_method'),
    rootCause: text('root_cause'),
    correctiveAction: text('corrective_action'),
    responsible: text('responsible'),
    targetDate: date('target_date'),
    verification: text('verification'),
    verifiedBy: text('verified_by'),
    verifiedDate: date('verified_date'),
    preventiveAction: text('preventive_action'),
    effectiveness: text('effectiveness'), // Effective | Not Effective | ''
    reviewDate: date('review_date'),
    status: text('status').notNull().default('Open'), // Open | In Progress | Verified | Closed
    department: text('department'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('capa_records_company_code_uniq')
      .on(t.companyId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index('capa_records_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('capa_records_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('capa_records_qc_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type CapaRecord = typeof capaRecords.$inferSelect;
export type NewCapaRecord = typeof capaRecords.$inferInsert;

// ─── Report / Document Master — migration 0038 ────────────────────────────
// Mirrors legacy renderReportMaster L23677. Report/document types that appear
// as QC document-requirement options in SO/JW Planning.
export const reportTypes = pgTable(
  'report_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    description: text('description'),
    defaultMandatory: boolean('default_mandatory').notNull().default(false),
    status: text('status').notNull().default('Active'), // Active | Inactive
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('report_types_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('report_types_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('report_types_qc_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type ReportType = typeof reportTypes.$inferSelect;
export type NewReportType = typeof reportTypes.$inferInsert;

// ─── QC Documents — migration 0039 ────────────────────────────────────────
// File repository (MIR/MCR/inspection/TPI reports) per JC/SO. Files live in
// the `qc-docs` Supabase Storage bucket; this table registers the metadata.
// Mirrors legacy renderQCDocuments L23039.
export const qcDocuments = pgTable(
  'qc_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jobCardId: uuid('job_card_id').references((): AnyPgColumn => jobCards.id, {
      onDelete: 'set null',
    }),
    jcCodeText: text('jc_code_text'),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'set null' }),
    soCodeText: text('so_code_text'),
    category: text('category').notNull().default('qc-docs'),
    docType: text('doc_type').notNull(),
    fileName: text('file_name').notNull(),
    storagePath: text('storage_path').notNull(),
    uploadedByText: text('uploaded_by_text'),
    // QC-completion matrix link (migration 0043): which JC QC op this doc
    // certifies + the piece serial-range it covers. Drives the SO-pivoted
    // matrix in renderQCDocuments (per-op column cells + serial tracking).
    jcOpId: uuid('jc_op_id').references((): AnyPgColumn => jcOps.id),
    qcOpName: text('qc_op_name'),
    srFrom: integer('sr_from'),
    srTo: integer('sr_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('qc_documents_company_jc_idx')
      .on(t.companyId, t.jobCardId)
      .where(sql`${t.deletedAt} is null`),
    index('qc_documents_company_cat_idx')
      .on(t.companyId, t.category)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('qc_documents_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('qc_documents_qc_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type QcDocument = typeof qcDocuments.$inferSelect;
export type NewQcDocument = typeof qcDocuments.$inferInsert;

// ─── QC Assignments — migration 0040 ──────────────────────────────────────
// Pick-Up / Assign for the QC Command Center queue (legacy db.qcAssignments,
// _qccPickUp / _qccAssign L18719-18755). One ACTIVE assignment per jc_op
// (unique partial index). Pick-Up assigns to self (any QC writer); assigning
// to *another* inspector is admin-only — enforced in the service, not RLS.
// inspector_name is a display snapshot alongside the FK so the queue renders
// without a join and survives a later user rename.
export const qcAssignments = pgTable(
  'qc_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    jcOpId: uuid('jc_op_id')
      .notNull()
      .references(() => jcOps.id, { onDelete: 'cascade' }),
    inspectorUserId: uuid('inspector_user_id').references(() => users.id),
    inspectorName: text('inspector_name').notNull(),
    note: text('note'),
    assignedByText: text('assigned_by_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('qc_assignments_company_op_uq')
      .on(t.companyId, t.jcOpId)
      .where(sql`${t.deletedAt} is null`),
    index('qc_assignments_company_inspector_idx')
      .on(t.companyId, t.inspectorUserId)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('qc_assignments_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('qc_assignments_qc_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager', 'qc') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type QcAssignment = typeof qcAssignments.$inferSelect;
export type NewQcAssignment = typeof qcAssignments.$inferInsert;

// ── Print Templates (0042) ──────────────────────────────────────────
// Admin-customisable editable text blocks for PO / OSP DC / JW DC prints.
// One active row per (company, template_key); absent ⇒ factory default
// (PRINT_TEMPLATE_DEFAULTS in @innovic/shared). Admin-only writes.
// Mirror of legacy db.printTemplates (renderPrintTemplates L14660).
export const printTemplates = pgTable(
  'print_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    templateKey: text('template_key').notNull(),
    content: text('content').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('print_templates_company_key_uq')
      .on(t.companyId, t.templateKey)
      .where(sql`${t.deletedAt} is null`),
    pgPolicy('print_templates_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('print_templates_admin_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type PrintTemplateRow = typeof printTemplates.$inferSelect;
export type NewPrintTemplateRow = typeof printTemplates.$inferInsert;

// Append-only revision history; service trims to last 5 per key.
export const printTemplateRevisions = pgTable(
  'print_template_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    templateKey: text('template_key').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index('print_template_revisions_company_key_created_idx').on(
      t.companyId,
      t.templateKey,
      t.createdAt,
    ),
    pgPolicy('print_template_revisions_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('print_template_revisions_admin_insert', {
      for: 'insert',
      to: 'authenticated',
      withCheck: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type PrintTemplateRevisionRow = typeof printTemplateRevisions.$inferSelect;
export type NewPrintTemplateRevisionRow = typeof printTemplateRevisions.$inferInsert;

// ── Access Control matrix (0045) ────────────────────────────────────
// Per-user fine-grained permissions on top of the role enum. One row per
// user with `full_access` flag, `departments` map (sidebar gates), and
// `forms` map of { form_key: { view, entry, edit } }. Mirror of legacy
// db.userAccess (renderAccessControl L13861). Admin-only writes; self +
// admin read. ADR-035: matrix is UI-only enforcement in this slice.
export const userAccess = pgTable(
  'user_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    fullAccess: boolean('full_access').notNull().default(false),
    departments: jsonb('departments').notNull().default({}),
    forms: jsonb('forms').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('user_access_user_uq').on(t.userId).where(sql`${t.deletedAt} is null`),
    index('user_access_company_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
    pgPolicy('user_access_self_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`user_id = current_user_id()`,
    }),
    pgPolicy('user_access_admin_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
    }),
    pgPolicy('user_access_admin_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type UserAccessRow = typeof userAccess.$inferSelect;
export type NewUserAccessRow = typeof userAccess.$inferInsert;

// ── Approval Configuration (0046) ───────────────────────────────────
// One row per company. PO/PR/Invoice approval toggles + manager amount
// limit + explicit approvers list. Mirror of legacy db.approvalConfig
// (renderApprovalConfig L21608). Admin-only writes; everyone in the
// company reads (PO list needs to know which users can approve).
export const approvalConfig = pgTable(
  'approval_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    poApproval: boolean('po_approval').notNull().default(true),
    poManagerLimit: numeric('po_manager_limit', { precision: 14, scale: 2 })
      .notNull()
      .default('100000'),
    prApproval: boolean('pr_approval').notNull().default(true),
    invoiceApproval: boolean('invoice_approval').notNull().default(false),
    poApprovers: jsonb('po_approvers').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('approval_config_company_uq').on(t.companyId).where(sql`${t.deletedAt} is null`),
    pgPolicy('approval_config_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('approval_config_admin_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() = 'admin' AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type ApprovalConfigRow = typeof approvalConfig.$inferSelect;
export type NewApprovalConfigRow = typeof approvalConfig.$inferInsert;

// ── OSP Process Configuration (0047) ────────────────────────────────
// Outside-process name → preferred vendor + auto-PO + lead-time.
// When an op_seq name matches one of these (case-insensitive substring
// per legacy _isOspOperation), the system auto-creates a JW PR (and
// optionally a draft PO if vendor + autoPO). Manager/admin writes.
export const ospProcesses = pgTable(
  'osp_processes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    processName: text('process_name').notNull(),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    autoPo: boolean('auto_po').notNull().default(false),
    leadDays: integer('lead_days').notNull().default(5),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('osp_processes_company_name_uq')
      .on(t.companyId, sql`lower(${t.processName})`)
      .where(sql`${t.deletedAt} is null`),
    index('osp_processes_company_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
    pgPolicy('osp_processes_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('osp_processes_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type OspProcessRow = typeof ospProcesses.$inferSelect;
export type NewOspProcessRow = typeof ospProcesses.$inferInsert;

// ── Service POs (0049) ──────────────────────────────────────────────
// Non-inventory purchase orders (labour / maintenance / calibration /
// consultancy). Mirror of legacy db.servicePOs (renderServicePO L27504).
// Manager/admin writes; admin approves.
export const servicePoStatusEnum = pgEnum('service_po_status', [
  'draft',
  'pending',
  'approved',
  'completed',
  'cancelled',
]);
export const servicePoCostCenterEnum = pgEnum('service_po_cost_center', ['so', 'general']);
export const servicePoTaxTypeEnum = pgEnum('service_po_tax_type', ['sgst_cgst', 'igst']);

export const servicePos = pgTable(
  'service_pos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    spoNo: text('spo_no').notNull(),
    spoDate: date('spo_date').notNull(),
    vendorId: uuid('vendor_id').references(() => vendors.id),
    vendorCodeText: text('vendor_code_text'),
    expenseHead: text('expense_head').notNull().default('Other'),
    costCenter: servicePoCostCenterEnum('cost_center').notNull().default('so'),
    soRefId: uuid('so_ref_id').references((): AnyPgColumn => salesOrders.id),
    soNoText: text('so_no_text'),
    subtotal: numeric('subtotal', { precision: 14, scale: 2 }).notNull().default('0'),
    taxType: servicePoTaxTypeEnum('tax_type').notNull().default('sgst_cgst'),
    gstPct: numeric('gst_pct', { precision: 5, scale: 2 }).notNull().default('18'),
    taxAmount: numeric('tax_amount', { precision: 14, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    paymentTerms: text('payment_terms').notNull().default('Immediate'),
    remarks: text('remarks'),
    status: servicePoStatusEnum('status').notNull().default('draft'),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('service_pos_company_no_uq').on(t.companyId, t.spoNo).where(sql`${t.deletedAt} is null`),
    index('service_pos_company_status_idx').on(t.companyId, t.status).where(sql`${t.deletedAt} is null`),
    index('service_pos_company_date_idx').on(t.companyId, t.spoDate).where(sql`${t.deletedAt} is null`),
    index('service_pos_vendor_idx').on(t.vendorId).where(sql`${t.deletedAt} is null`),
    pgPolicy('service_pos_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('service_pos_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type ServicePoRow = typeof servicePos.$inferSelect;
export type NewServicePoRow = typeof servicePos.$inferInsert;

export const servicePoLines = pgTable(
  'service_po_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    servicePoId: uuid('service_po_id')
      .notNull()
      .references(() => servicePos.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    description: text('description').notNull(),
    qty: numeric('qty', { precision: 12, scale: 2 }).notNull().default('1'),
    rate: numeric('rate', { precision: 14, scale: 2 }).notNull().default('0'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex('service_po_lines_po_lineno_uq').on(t.servicePoId, t.lineNo),
    pgPolicy('service_po_lines_company_read', {
      for: 'select',
      to: 'authenticated',
      using: sql`company_id = current_company_id()`,
    }),
    pgPolicy('service_po_lines_manager_write', {
      for: 'all',
      to: 'authenticated',
      using: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
      withCheck: sql`current_user_role() IN ('admin', 'manager') AND company_id = current_company_id()`,
    }),
  ],
).enableRLS();

export type ServicePoLineRow = typeof servicePoLines.$inferSelect;
export type NewServicePoLineRow = typeof servicePoLines.$inferInsert;
