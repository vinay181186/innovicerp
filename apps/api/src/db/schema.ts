import {
  ITEM_TYPES,
  JC_PRIORITIES,
  OP_LOG_TYPES,
  OP_TYPES,
  OUTSOURCE_STATUSES,
  RUNNING_OP_STATUSES,
  SHIFTS,
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
    uniqueIndex('companies_slug_uniq').on(t.slug).where(sql`${t.deletedAt} is null`),
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
    index('users_company_id_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
    uniqueIndex('users_email_uniq').on(t.email).where(sql`${t.deletedAt} is null`),
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
    index('items_company_id_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
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
    index('clients_company_id_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
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
    index('vendors_company_id_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
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
    index('machines_company_id_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
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
    index('operators_company_id_idx').on(t.companyId).where(sql`${t.deletedAt} is null`),
    index('operators_user_id_idx').on(t.userId).where(sql`${t.deletedAt} is null`),
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
    index('route_cards_item_idx').on(t.itemId).where(sql`${t.deletedAt} is null`),
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
    index('route_card_ops_machine_idx').on(t.machineId).where(sql`${t.deletedAt} is null`),
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
    // Source SO/JW link — FKs deferred to Phase 4 per ADR-011 #5
    sourceSoLineId: uuid('source_so_line_id'),
    sourceJwId: uuid('source_jw_id'),
    sourceLegacyRef: text('source_legacy_ref'),
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
    check('job_cards_order_qty_positive', sql`${t.orderQty} > 0`),
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
    outsourcePrNo: text('outsource_pr_no'),
    outsourcePoNo: text('outsource_po_no'),
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
    index('jc_ops_machine_idx').on(t.machineId).where(sql`${t.deletedAt} is null`),
    index('jc_ops_company_type_idx')
      .on(t.companyId, t.opType)
      .where(sql`${t.deletedAt} is null`),
    index('jc_ops_outsource_vendor_idx')
      .on(t.outsourceVendorId)
      .where(sql`${t.deletedAt} is null AND ${t.opType} = 'outsource'`),
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
