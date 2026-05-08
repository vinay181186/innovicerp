import {
  DC_STATUSES,
  GRN_QC_STATUSES,
  ITEM_TYPES,
  JC_PRIORITIES,
  NC_DISPOSITIONS,
  NC_REASON_CATEGORIES,
  NC_STATUSES,
  OP_LOG_TYPES,
  OP_TYPES,
  OUTSOURCE_STATUSES,
  PO_STATUSES,
  PO_TYPES,
  PR_STATUSES,
  RUNNING_OP_STATUSES,
  SHIFTS,
  SO_STATUSES,
  SO_TYPES,
  STORE_TXN_SOURCE_TYPES,
  STORE_TXN_TYPES,
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

export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    gstNumber: text('gst_number'),
    phone: text('phone'),
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    index('op_log_company_op_date_idx').on(t.companyId, t.jcOpId, t.logDate),
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
    clientPoLineNo: text('client_po_line_no'),
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
    uniqueIndex('sales_order_lines_so_line_uniq')
      .on(t.salesOrderId, t.lineNo)
      .where(sql`${t.deletedAt} is null`),
    index('sales_order_lines_item_idx')
      .on(t.itemId)
      .where(sql`${t.deletedAt} is null`),
    index('sales_order_lines_company_status_idx')
      .on(t.companyId, t.status)
      .where(sql`${t.deletedAt} is null`),
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
    dueDate: date('due_date'),
    clientMaterial: text('client_material'),
    clientMaterialQty: numeric('client_material_qty', { precision: 12, scale: 2 }),
    materialReceivedDate: date('material_received_date'),
    materialReceivedQty: numeric('material_received_qty', { precision: 12, scale: 2 }),
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
export type ActivityLog = typeof activityLog.$inferSelect;
export type NewActivityLog = typeof activityLog.$inferInsert;
