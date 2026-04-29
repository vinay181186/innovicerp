import { ITEM_TYPES, UOMS, USER_ROLES } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const uomEnum = pgEnum('uom', UOMS);
export const itemTypeEnum = pgEnum('item_type', ITEM_TYPES);

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

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
