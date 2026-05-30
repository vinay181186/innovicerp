// Backup service — admin-only DB stats + JSON dump.
//
// Mirror of legacy renderBackup (HTML L21963). Simplified: most legacy
// features (hash-verified backups, restore, factory reset, auto-backup
// schedule) are deferred. Real backup discipline = Supabase auto +
// daily pg_dump → Backblaze B2 per docs/RUNBOOK.md. This module is the
// in-app convenience: admin can pull a JSON snapshot of the masters +
// recent transactions on demand.

import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError } from '../../lib/errors';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// Tables surfaced in the backup. Order matches legacy collection
// inventory. Each entry: table name + label. Soft-deleted rows are
// included (the dump should be a true snapshot).
const TABLES: readonly { table: string; label: string }[] = [
  { table: 'companies', label: 'Companies' },
  { table: 'users', label: 'Users' },
  { table: 'user_access', label: 'User Access' },
  { table: 'items', label: 'Items' },
  { table: 'clients', label: 'Clients' },
  { table: 'vendors', label: 'Vendors' },
  { table: 'machines', label: 'Machines' },
  { table: 'operators', label: 'Operators' },
  { table: 'cost_centers', label: 'Cost Centers' },
  { table: 'osp_processes', label: 'OSP Processes' },
  { table: 'qc_processes', label: 'QC Processes' },
  { table: 'bom_masters', label: 'BOM Masters' },
  { table: 'route_cards', label: 'Route Cards' },
  { table: 'sales_orders', label: 'Sales Orders' },
  { table: 'sales_order_lines', label: 'SO Lines' },
  { table: 'job_work_orders', label: 'Job Work Orders' },
  { table: 'job_cards', label: 'Job Cards' },
  { table: 'jc_ops', label: 'JC Ops' },
  { table: 'op_log', label: 'Op Log' },
  { table: 'purchase_requests', label: 'Purchase Requests' },
  { table: 'purchase_orders', label: 'Purchase Orders' },
  { table: 'goods_receipt_notes', label: 'Goods Receipt Notes' },
  { table: 'delivery_challans', label: 'Delivery Challans' },
  { table: 'nc_register', label: 'NC Register' },
  { table: 'store_transactions', label: 'Store Transactions' },
  { table: 'item_stock_balances', label: 'Item Stock Balances' },
  { table: 'activity_log', label: 'Activity Log' },
  { table: 'alert_config', label: 'Alert Config' },
  { table: 'approval_config', label: 'Approval Config' },
  { table: 'print_templates', label: 'Print Templates' },
];

export interface BackupCollectionStat {
  table: string;
  label: string;
  count: number;
}

export interface BackupStatsResponse {
  collections: BackupCollectionStat[];
  totalRecords: number;
  lastBackupAt: string | null;
}

export interface BackupDownload {
  exportedAt: string;
  exportedBy: { id: string; email: string };
  companyId: string;
  collections: Record<string, unknown[]>;
}

export async function getBackupStats(user: AuthContext): Promise<BackupStatsResponse> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const collections: BackupCollectionStat[] = [];
    let total = 0;
    for (const t of TABLES) {
      try {
        // Companies row is filtered by id; everything else by company_id.
        const where = t.table === 'companies' ? `id = '${companyId}'::uuid` : `company_id = '${companyId}'::uuid`;
        const r = await tx.execute(
          sql.raw(`SELECT COUNT(*)::int AS c FROM "${t.table}" WHERE ${where}`),
        );
        const rows = r as unknown as { c: number }[];
        const count = Number(rows[0]?.c ?? 0);
        collections.push({ table: t.table, label: t.label, count });
        total += count;
      } catch {
        // Table not present in this dev DB — skip silently.
        collections.push({ table: t.table, label: t.label, count: 0 });
      }
    }
    return { collections, totalRecords: total, lastBackupAt: null };
  });
}

const MAX_ROWS_PER_TABLE = 5000;

export async function downloadBackup(user: AuthContext): Promise<BackupDownload> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  return withUserContext(user, async (tx) => {
    const collections: Record<string, unknown[]> = {};
    for (const t of TABLES) {
      try {
        const where = t.table === 'companies' ? `id = '${companyId}'::uuid` : `company_id = '${companyId}'::uuid`;
        const r = await tx.execute(
          sql.raw(`SELECT * FROM "${t.table}" WHERE ${where} ORDER BY created_at DESC LIMIT ${MAX_ROWS_PER_TABLE}`),
        );
        collections[t.table] = r as unknown as unknown[];
      } catch {
        collections[t.table] = [];
      }
    }
    return {
      exportedAt: new Date().toISOString(),
      exportedBy: { id: user.id, email: user.email },
      companyId,
      collections,
    };
  });
}
