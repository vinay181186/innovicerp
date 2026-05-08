// Alerts service (T-041d Phase A, ADR-024).
//
// Three concerns:
//   1. listConfig    — merge registry definitions with per-company override row
//   2. runAll/runOne — evaluate registered alerts and return counts/records
//   3. setActive     — upsert per-company override (admin/manager only)
//
// Eval is parallelised via Promise.all. A failing rule does NOT poison the
// dashboard — it logs + reports count=0 (legacy `_runAlerts` behaviour).
//
// Auth model:
//   read endpoints — any authenticated company member (RLS does isolation;
//                    service requires companyId to be set)
//   setActive      — admin/manager only (RLS would block too via the
//                    `alert_config_manager_write` policy; service-layer
//                    check fires first for a clean 403 instead of an RLS
//                    "row violates" error)

import type { AlertConfigEntry, AlertDept, ListAlertConfigResponse } from '@innovic/shared';
import { eq, sql } from 'drizzle-orm';
import { alertConfig as alertConfigTable } from '../../db/schema';
import { type AuthContext, type DbTransaction, withUserContext } from '../../db/with-user-context';
import { requireWriteRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { ALERTS, listAlertDefinitions, type RegisteredAlert } from './registry';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

interface AlertSummary {
  code: string;
  dept: AlertDept;
  name: string;
  count: number;
}

export interface ListAlertsServiceResponse {
  generatedAt: string;
  alerts: AlertSummary[];
}

interface OverrideRow {
  code: string;
  active: boolean;
}

async function loadOverrides(tx: DbTransaction, companyId: string): Promise<Map<string, boolean>> {
  const rows = await tx
    .select({ code: alertConfigTable.code, active: alertConfigTable.active })
    .from(alertConfigTable)
    .where(eq(alertConfigTable.companyId, companyId));
  const map = new Map<string, boolean>();
  for (const r of rows as OverrideRow[]) map.set(r.code, r.active);
  return map;
}

function effectiveActive(reg: RegisteredAlert, overrides: Map<string, boolean>): boolean {
  const override = overrides.get(reg.definition.code);
  return override === undefined ? reg.definition.defaultActive : override;
}

export async function listAlertConfig(user: AuthContext): Promise<ListAlertConfigResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const overrides = await loadOverrides(tx, companyId);
    const entries: AlertConfigEntry[] = listAlertDefinitions().map((def) => {
      const override = overrides.get(def.code);
      return {
        code: def.code,
        dept: def.dept,
        name: def.name,
        description: def.description,
        defaultActive: def.defaultActive,
        active: override === undefined ? def.defaultActive : override,
        isOverridden: override !== undefined,
      };
    });
    return { entries };
  });
}

export async function runAllAlerts(user: AuthContext): Promise<ListAlertsServiceResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const overrides = await loadOverrides(tx, companyId);
    const active = Object.values(ALERTS).filter((a) => effectiveActive(a, overrides));

    const summaries = await Promise.all(
      active.map(async (a): Promise<AlertSummary> => {
        try {
          const result = await a.run({ tx, companyId });
          return {
            code: a.definition.code,
            dept: a.definition.dept,
            name: a.definition.name,
            count: result.records.length,
          };
        } catch (err) {
          // Mirror legacy `_runAlerts` resilience — log + zero, never let
          // one bad rule break the whole dashboard.
          logger.error(
            { err, alertCode: a.definition.code, companyId },
            'alert evaluation failed; reporting count=0 for this alert',
          );
          return {
            code: a.definition.code,
            dept: a.definition.dept,
            name: a.definition.name,
            count: 0,
          };
        }
      }),
    );

    summaries.sort((x, y) => x.code.localeCompare(y.code));

    return { generatedAt: new Date().toISOString(), alerts: summaries };
  });
}

export interface RunAlertServiceResponse {
  alert: {
    code: string;
    dept: AlertDept;
    name: string;
    count: number;
    records: Array<Record<string, string | number | null>>;
    generatedAt: string;
  };
  columns: RegisteredAlert['definition']['columns'];
}

export async function runAlert(code: string, user: AuthContext): Promise<RunAlertServiceResponse> {
  const companyId = requireCompany(user);
  const reg = ALERTS[code];
  if (!reg) throw new NotFoundError(`Alert "${code}" not found`);

  return withUserContext(user, async (tx) => {
    const result = await reg.run({ tx, companyId });
    return {
      alert: {
        code: reg.definition.code,
        dept: reg.definition.dept,
        name: reg.definition.name,
        count: result.records.length,
        records: result.records,
        generatedAt: new Date().toISOString(),
      },
      columns: reg.definition.columns,
    };
  });
}

export async function setAlertActive(
  code: string,
  active: boolean,
  user: AuthContext,
): Promise<AlertConfigEntry> {
  requireWriteRole(user);
  const companyId = requireCompany(user);
  const reg = ALERTS[code];
  if (!reg) throw new NotFoundError(`Alert "${code}" not found`);

  return withUserContext(user, async (tx) => {
    // Upsert pattern: try update first; insert if no row matched.
    // Drizzle's onConflictDoUpdate would also work but the (company_id, code)
    // unique index is plain (no partial WHERE), so a 2-step upsert keeps
    // the SQL transparent.
    const updated = await tx
      .update(alertConfigTable)
      .set({ active, updatedAt: sql`now()`, updatedBy: user.id })
      .where(
        sql`${alertConfigTable.companyId} = ${companyId}::uuid AND ${alertConfigTable.code} = ${code}`,
      )
      .returning({ code: alertConfigTable.code });

    if (updated.length === 0) {
      await tx.insert(alertConfigTable).values({
        companyId,
        code,
        active,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }

    return {
      code: reg.definition.code,
      dept: reg.definition.dept,
      name: reg.definition.name,
      description: reg.definition.description,
      defaultActive: reg.definition.defaultActive,
      active,
      isOverridden: true,
    };
  });
}
