// Dashboard config service — per-user home layout preference (widgets +
// quick links). Mirror of legacy _dashConfigScreen / _dashSaveConfig.

import type {
  DashboardConfig,
  DashboardConfigScreen,
  RegistryQuickLink,
  RegistryWidget,
  SaveDashboardConfigInput,
} from '@innovic/shared';
import { DASHBOARD_QUICK_LINKS, DASHBOARD_WIDGETS } from '@innovic/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { dashboardConfig } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { type DashAccess, hasDept, loadAccess } from './access';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

async function loadRow(
  tx: DbTransaction,
  companyId: string,
  userId: string,
): Promise<typeof dashboardConfig.$inferSelect | undefined> {
  const rows = await tx
    .select()
    .from(dashboardConfig)
    .where(
      and(
        eq(dashboardConfig.companyId, companyId),
        eq(dashboardConfig.userId, userId),
        isNull(dashboardConfig.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

export function rowToConfig(
  row: typeof dashboardConfig.$inferSelect | undefined,
): DashboardConfig {
  return {
    widgets: row?.widgets ?? null,
    quickLinks: row?.quickLinks ?? null,
  };
}

export async function getConfig(user: AuthContext): Promise<DashboardConfig> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => rowToConfig(await loadRow(tx, companyId, user.id)));
}

function widgetRegistry(a: DashAccess): RegistryWidget[] {
  return DASHBOARD_WIDGETS.map((w) => ({
    key: w.key,
    label: w.label,
    desc: w.desc,
    icon: w.icon,
    color: w.color,
    dept: w.dept,
    navPage: w.navPage,
    hasAccess: hasDept(a, w.dept),
  }));
}

function quickLinkRegistry(a: DashAccess): RegistryQuickLink[] {
  return DASHBOARD_QUICK_LINKS.map((l) => ({
    page: l.page,
    label: l.label,
    icon: l.icon,
    color: l.color,
    dept: l.dept,
    hasAccess: hasDept(a, l.dept),
  }));
}

export async function getConfigScreen(user: AuthContext): Promise<DashboardConfigScreen> {
  const companyId = requireCompany(user);
  const a = await loadAccess(user);
  return withUserContext(user, async (tx) => ({
    config: rowToConfig(await loadRow(tx, companyId, user.id)),
    widgets: widgetRegistry(a),
    quickLinks: quickLinkRegistry(a),
  }));
}

export async function saveConfig(
  input: SaveDashboardConfigInput,
  user: AuthContext,
): Promise<DashboardConfig> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const existing = await loadRow(tx, companyId, user.id);
    if (existing) {
      await tx
        .update(dashboardConfig)
        .set({ widgets: input.widgets, quickLinks: input.quickLinks, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(dashboardConfig.id, existing.id));
    } else {
      await tx.insert(dashboardConfig).values({
        companyId,
        userId: user.id,
        widgets: input.widgets,
        quickLinks: input.quickLinks,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }
    return rowToConfig(await loadRow(tx, companyId, user.id));
  });
}
